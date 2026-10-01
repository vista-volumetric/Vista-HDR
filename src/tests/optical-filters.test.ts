import { describe, it, expect } from 'vitest';
import {
  calculateLatitude,
  smoothstep,
  calculateSkyWeight,
  applyGraduatedND,
  applySkyPolarizer,
  applyOpticalFilters,
} from '../engine/color-science.js';
import { WebGPUEngine } from '../engine/webgpu-engine.js';
import {
  displayRenderWGSL,
  colorGradingComputeWGSL,
} from '../engine/shaders.js';

describe('360° Graduated Neutral Density (GND) Math', () => {
  it('should calculate correct latitude in radians for equirectangular spherical image', () => {
    const height = 1000;
    // Top row (y = 0): near +pi/2 (+90° zenith sky)
    const latZenith = calculateLatitude(0, height);
    expect(latZenith).toBeCloseTo(Math.PI / 2, 2);

    // Center row (y = 500): near 0.0 (0° horizon)
    const latHorizon = calculateLatitude(500, height);
    expect(latHorizon).toBeCloseTo(0.0, 2);

    // Bottom row (y = 999): near -pi/2 (-90° nadir ground)
    const latNadir = calculateLatitude(999, height);
    expect(latNadir).toBeCloseTo(-Math.PI / 2, 2);
  });

  it('should evaluate skyWeight = 1.0 at lat = 1.0 (zenith sky) and attenuate exposure by 2^gndExposure', () => {
    const lat = 1.0; // Zenith sky
    const horizonOffset = 0.0;
    const feather = 0.26;

    const skyWeight = calculateSkyWeight(lat, horizonOffset, feather);
    expect(skyWeight).toBe(1.0);

    const testColor: [number, number, number] = [0.8, 0.6, 0.4];
    const gndExposure = -2.0; // -2 stops sky attenuation

    const attenuated = applyGraduatedND(testColor, gndExposure, skyWeight);
    const expectedFactor = Math.pow(2.0, -2.0); // 0.25 (1/4 brightness)

    expect(attenuated[0]).toBeCloseTo(testColor[0] * expectedFactor, 5);
    expect(attenuated[1]).toBeCloseTo(testColor[1] * expectedFactor, 5);
    expect(attenuated[2]).toBeCloseTo(testColor[2] * expectedFactor, 5);
  });

  it('should evaluate skyWeight = 0.0 at lat = -1.0 (nadir ground) and leave exposure 100% unchanged', () => {
    const lat = -1.0; // Nadir ground
    const horizonOffset = 0.0;
    const feather = 0.26;

    const skyWeight = calculateSkyWeight(lat, horizonOffset, feather);
    expect(skyWeight).toBe(0.0);

    const testColor: [number, number, number] = [0.75, 0.5, 0.25];
    const gndExposure = -3.0; // -3 stops sky attenuation

    const unchanged = applyGraduatedND(testColor, gndExposure, skyWeight);

    expect(unchanged[0]).toBe(testColor[0]);
    expect(unchanged[1]).toBe(testColor[1]);
    expect(unchanged[2]).toBe(testColor[2]);
  });

  it('should smoothly transition skyWeight across horizon feather band', () => {
    const horizonOffset = 0.0;
    const feather = 0.2;

    // Exactly at horizon (lat = 0): smoothstep midpoint is 0.5
    const midWeight = calculateSkyWeight(0.0, horizonOffset, feather);
    expect(midWeight).toBeCloseTo(0.5, 5);

    // Below transition zone (lat <= -0.2): 0.0
    expect(calculateSkyWeight(-0.25, horizonOffset, feather)).toBe(0.0);

    // Above transition zone (lat >= +0.2): 1.0
    expect(calculateSkyWeight(0.25, horizonOffset, feather)).toBe(1.0);
  });

  it('should shift transition zone when horizonOffset is adjusted', () => {
    const horizonOffset = 0.3; // Tilted or elevated horizon (+17°)
    const feather = 0.1;

    // At old horizon (0.0): should now be below transition (0.0 weight)
    expect(calculateSkyWeight(0.0, horizonOffset, feather)).toBe(0.0);

    // At new horizon (0.3): should be 0.5
    expect(calculateSkyWeight(0.3, horizonOffset, feather)).toBeCloseTo(0.5, 5);

    // Above new horizon (0.45): should be 1.0
    expect(calculateSkyWeight(0.45, horizonOffset, feather)).toBe(1.0);
  });
});

describe('360° Sky Polarizer Math', () => {
  it('should boost saturation of blue sky while giving 0 blue excess to neutral gray or warm ground', () => {
    const skyWeight = 1.0;
    const polarizerIntensity = 0.8;

    // 1. Blue sky pixel: high blue, low red and green
    const skyPixel: [number, number, number] = [0.2, 0.4, 0.8];
    const polarizedSky = applySkyPolarizer(skyPixel, polarizerIntensity, skyWeight);

    // Blue excess = 0.8 - 0.4 = 0.4 > 0
    // Relative blue / green ratio should increase (saturation boost)
    const origRatio = skyPixel[2] / skyPixel[1]; // 2.0
    const polarizedRatio = polarizedSky[2] / polarizedSky[1];
    expect(polarizedRatio).toBeGreaterThan(origRatio);

    // 2. Neutral gray pixel: R == G == B
    const grayPixel: [number, number, number] = [0.5, 0.5, 0.5];
    const polarizedGray = applySkyPolarizer(grayPixel, polarizerIntensity, skyWeight);

    // Blue excess = max(0.5 - 0.5, 0) = 0.0
    // No chromatic shift: R, G, B should all be scaled by identical polDarken
    expect(polarizedGray[0]).toBeCloseTo(polarizedGray[1], 5);
    expect(polarizedGray[1]).toBeCloseTo(polarizedGray[2], 5);

    // 3. Warm ground pixel: high red and green, low blue
    const warmGround: [number, number, number] = [0.8, 0.6, 0.2];
    const polarizedGroundAtNadir = applySkyPolarizer(warmGround, polarizerIntensity, 0.0);

    // At ground (skyWeight = 0), completely untouched
    expect(polarizedGroundAtNadir[0]).toBe(warmGround[0]);
    expect(polarizedGroundAtNadir[1]).toBe(warmGround[1]);
    expect(polarizedGroundAtNadir[2]).toBe(warmGround[2]);

    // Even if skyWeight > 0, warm ground has blue excess = max(0.2 - 0.8, 0) = 0.0
    const polarizedWarmInSky = applySkyPolarizer(warmGround, polarizerIntensity, 1.0);
    const polDarken = 1.0 - polarizerIntensity * 1.0 * 0.3; // 0.76
    expect(polarizedWarmInSky[0]).toBeCloseTo(warmGround[0] * polDarken, 5);
    expect(polarizedWarmInSky[1]).toBeCloseTo(warmGround[1] * polDarken, 5);
    expect(polarizedWarmInSky[2]).toBeCloseTo(warmGround[2] * polDarken, 5);
  });

  it('should darken sky luminance to cut atmospheric haze', () => {
    const skyPixel: [number, number, number] = [0.3, 0.5, 0.9];
    const skyWeight = 1.0;

    // With 0 polarizer: no darkening
    const p0 = applySkyPolarizer(skyPixel, 0.0, skyWeight);
    expect(p0[0]).toBeCloseTo(skyPixel[0], 5);
    expect(p0[1]).toBeCloseTo(skyPixel[1], 5);

    // With 1.0 polarizer: polDarken = 1.0 - 0.3 = 0.70
    const p1 = applySkyPolarizer(skyPixel, 1.0, skyWeight);
    expect(p1[0]).toBeCloseTo(skyPixel[0] * 0.70, 5);
    expect(p1[1]).toBeCloseTo(skyPixel[1] * 0.70, 5);
  });

  it('should combine GND and Sky Polarizer seamlessly via applyOpticalFilters', () => {
    const skyPixel: [number, number, number] = [0.2, 0.4, 0.8];
    const latZenith = 1.2;

    const result = applyOpticalFilters(skyPixel, latZenith, {
      gndExposure: -1.0,   // -1 EV (0.5x exposure)
      skyPolarizer: 0.5,  // 50% polarizer
    });

    // Both GND and Polarizer are active: result brightness should be lower than original
    expect(result[0]).toBeLessThan(skyPixel[0]);
    expect(result[1]).toBeLessThan(skyPixel[1]);
  });
});

describe('WebGPUEngine A/B Wipe Configuration & Boundary Checks', () => {
  it('should initialize with default A/B wipe configuration', () => {
    const engine = new WebGPUEngine();
    expect(engine.getWipeConfig()).toEqual({
      mode: 'off',
      position: 0.5,
      showDividerLine: true,
    });
  });

  it('should allow setting vertical, horizontal, bypass, and off wipe modes', () => {
    const engine = new WebGPUEngine();

    engine.setWipeMode('vertical', 0.4);
    expect(engine.getWipeConfig()).toEqual({
      mode: 'vertical',
      position: 0.4,
      showDividerLine: true,
    });

    engine.setWipeMode('horizontal', 0.7, false);
    expect(engine.getWipeConfig()).toEqual({
      mode: 'horizontal',
      position: 0.7,
      showDividerLine: false,
    });

    engine.setWipeMode('bypass');
    expect(engine.getWipeConfig().mode).toBe('bypass');

    engine.setWipeMode('off');
    expect(engine.getWipeConfig().mode).toBe('off');
  });

  it('should enforce boundary checks on wipe position (0 <= position <= 1)', () => {
    const engine = new WebGPUEngine();

    // Below lower boundary (< 0.0) -> clamped to 0.0
    engine.setWipeMode('vertical', -0.5);
    expect(engine.getWipeConfig().position).toBe(0.0);

    // Above upper boundary (> 1.0) -> clamped to 1.0
    engine.setWipeMode('vertical', 1.8);
    expect(engine.getWipeConfig().position).toBe(1.0);

    // Valid positions
    engine.setWipeMode('vertical', 0.0);
    expect(engine.getWipeConfig().position).toBe(0.0);

    engine.setWipeMode('vertical', 1.0);
    expect(engine.getWipeConfig().position).toBe(1.0);

    engine.setWipeMode('vertical', 0.65);
    expect(engine.getWipeConfig().position).toBe(0.65);
  });
});

describe('WebGPUEngine Optical Filters API & Boundaries', () => {
  it('should initialize with default optical filters configuration', () => {
    const engine = new WebGPUEngine();
    expect(engine.getOpticalFilters()).toEqual({
      gndExposure: 0.0,
      gndHorizonOffset: 0.0,
      gndFeather: 0.26,
      skyPolarizer: 0.0,
    });
  });

  it('should allow configuring optical filters with partial updates and range clamping', () => {
    const engine = new WebGPUEngine();

    // Partial update
    engine.setOpticalFilters({ gndExposure: -2.5 });
    const filters = engine.getOpticalFilters();
    expect(filters.gndExposure).toBe(-2.5);
    expect(filters.gndHorizonOffset).toBe(0.0);
    expect(filters.gndFeather).toBe(0.26);
    expect(filters.skyPolarizer).toBe(0.0);

    // Clamping boundaries
    engine.setOpticalFilters({
      gndExposure: -10.0,     // clamped to -4.0
      gndHorizonOffset: 2.0,  // clamped to 0.52
      gndFeather: -0.1,       // clamped to 0.01
      skyPolarizer: 3.0,      // clamped to 1.0
    });

    const clamped = engine.getOpticalFilters();
    expect(clamped.gndExposure).toBe(-4.0);
    expect(clamped.gndHorizonOffset).toBe(0.52);
    expect(clamped.gndFeather).toBe(0.01);
    expect(clamped.skyPolarizer).toBe(1.0);
  });
});

describe('WGSL Shader Structural Integrity', () => {
  it('should define DisplayUniforms with wipe parameters and rawTexture binding in displayRenderWGSL', () => {
    expect(displayRenderWGSL).toContain('wipeMode: u32');
    expect(displayRenderWGSL).toContain('wipePosition: f32');
    expect(displayRenderWGSL).toContain('showDividerLine: u32');
    expect(displayRenderWGSL).toContain('@binding(3) var rawTexture: texture_2d<f32>');
    expect(displayRenderWGSL).toContain('uniforms.wipeMode == 1u');
    expect(displayRenderWGSL).toContain('uniforms.wipeMode == 2u');
    expect(displayRenderWGSL).toContain('uniforms.wipeMode == 3u');
    expect(displayRenderWGSL).toContain('vec4<f32>(0.06, 0.75, 0.9, 1.0)'); // Glowing cyan divider
  });

  it('should define GradingUniforms with optical filter uniforms and compute logic in colorGradingComputeWGSL', () => {
    expect(colorGradingComputeWGSL).toContain('gndExposure: f32');
    expect(colorGradingComputeWGSL).toContain('gndHorizonOffset: f32');
    expect(colorGradingComputeWGSL).toContain('gndFeather: f32');
    expect(colorGradingComputeWGSL).toContain('skyPolarizer: f32');
    expect(colorGradingComputeWGSL).toContain('uniforms.gndExposure * skyWeight');
    expect(colorGradingComputeWGSL).toContain('uniforms.skyPolarizer * skyWeight');
  });
});
