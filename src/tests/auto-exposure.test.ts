import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutoExposureEngine,
  binToLinearRadiance,
  linearRadianceToBin,
  DEFAULT_AUTO_EXPOSURE_CONFIG,
} from '../engine/auto-exposure.js';
import { WebGPUEngine } from '../engine/webgpu-engine.js';

describe('Auto Exposure Engine - Perceptual Bin & Radiance Mapping', () => {
  it('should accurately map mid-gray radiance (0.18) back and forth', () => {
    const bin = linearRadianceToBin(0.18);
    // 0.18 should map to bin ~17
    expect(bin).toBeGreaterThanOrEqual(16);
    expect(bin).toBeLessThanOrEqual(18);

    const recoveredRadiance = binToLinearRadiance(bin);
    expect(recoveredRadiance).toBeCloseTo(0.18, 1);
  });

  it('should map monotonically across the full 256-bin range', () => {
    let prevRadiance = -1;
    for (let b = 0; b < 256; b++) {
      const radiance = binToLinearRadiance(b);
      expect(radiance).toBeGreaterThan(prevRadiance);
      prevRadiance = radiance;
    }
  });

  it('should clamp bounds for extreme values', () => {
    expect(linearRadianceToBin(-5.0)).toBe(0);
    expect(linearRadianceToBin(100.0)).toBe(255);
    expect(binToLinearRadiance(0)).toBeGreaterThanOrEqual(0.0);
    expect(binToLinearRadiance(255)).toBeLessThanOrEqual(11.0);
  });
});

describe('Auto Exposure Engine - Photometric Calculations', () => {
  let engine: AutoExposureEngine;

  beforeEach(() => {
    engine = new AutoExposureEngine();
  });

  it('should calculate positive EV boost for dark scenes', () => {
    // Synthetic dark scene: pixels clustered in low bins (bins 4 to 8, radiance ~ 0.03)
    const darkHist = new Uint32Array(256);
    for (let b = 4; b <= 8; b++) {
      darkHist[b] = 2000;
    }

    const logAvg = engine.calculateLogAverageLuminance(darkHist);
    expect(logAvg).toBeLessThan(0.18);

    const targetEV = engine.calculateTargetEV(darkHist);
    expect(targetEV).toBeGreaterThan(1.0); // Needs brightening boost
  });

  it('should calculate negative EV attenuation for bright outdoor scenes', () => {
    // Synthetic bright scene: pixels clustered in high bins (bins 80 to 120, radiance ~ 1.5 to 4.0)
    const brightHist = new Uint32Array(256);
    for (let b = 80; b <= 120; b++) {
      brightHist[b] = 1000;
    }

    const logAvg = engine.calculateLogAverageLuminance(brightHist);
    expect(logAvg).toBeGreaterThan(0.18);

    const targetEV = engine.calculateTargetEV(brightHist);
    expect(targetEV).toBeLessThan(-1.0); // Needs darkening attenuation
  });

  it('should yield close to 0.0 EV for an ideally exposed 18% mid-gray scene', () => {
    const midBin = linearRadianceToBin(0.18);
    const midHist = new Uint32Array(256);
    midHist[midBin] = 10000;

    const targetEV = engine.calculateTargetEV(midHist);
    expect(targetEV).toBeCloseTo(0.0, 1);
  });

  it('should ignore direct sun specular spike (top 2% CDF) and not depress mid-tones', () => {
    // Base scene: 10,000 mid-tone pixels clustered around bin 18
    const baseHist = new Uint32Array(256);
    baseHist[18] = 10000;

    const baseEV = engine.calculateTargetEV(baseHist);

    // Contaminated scene: add 150 pixels (1.47% <= 2% top threshold) of blinding sun in bin 255
    const sunHist = new Uint32Array(baseHist);
    sunHist[255] = 150;

    const sunEV = engine.calculateTargetEV(sunHist);

    // The sun spike must be completely filtered out by top 2% percentile rejection
    expect(sunEV).toBeCloseTo(baseEV, 2);
  });

  it('should ignore dead-black sensor noise (bottom 5% CDF) and not over-boost exposure', () => {
    // Base scene: 10,000 normal pixels clustered around bin 25
    const baseHist = new Uint32Array(256);
    baseHist[25] = 10000;

    const baseEV = engine.calculateTargetEV(baseHist);

    // Contaminated scene: add 400 pixels (3.8% <= 5% bottom threshold) of dead black sensor noise in bin 0
    const noiseHist = new Uint32Array(baseHist);
    noiseHist[0] = 400;

    const noiseEV = engine.calculateTargetEV(noiseHist);

    // Dead-black sensor noise must be filtered out
    expect(noiseEV).toBeCloseTo(baseEV, 2);
  });

  it('should apply exposure compensation precisely in EV stops up to ±5.0 EV', () => {
    const hist = new Uint32Array(256);
    hist[20] = 5000;

    engine.setCompensation(0.0);
    const ev0 = engine.calculateTargetEV(hist);

    engine.setCompensation(+1.0);
    const evPlus1 = engine.calculateTargetEV(hist);
    expect(evPlus1 - ev0).toBeCloseTo(1.0, 4);

    engine.setCompensation(-1.5);
    const evMinus1_5 = engine.calculateTargetEV(hist);
    expect(evMinus1_5 - ev0).toBeCloseTo(-1.5, 4);

    // Verify up to ±5.0 EV compensation
    engine.setCompensation(+5.0);
    expect(engine.getConfig().compensationEV).toBe(5.0);

    engine.setCompensation(-5.0);
    expect(engine.getConfig().compensationEV).toBe(-5.0);

    // Verify clamping at ±5.0 EV bounds
    engine.setCompensation(+6.5);
    expect(engine.getConfig().compensationEV).toBe(5.0);

    engine.setCompensation(-6.5);
    expect(engine.getConfig().compensationEV).toBe(-5.0);
  });

  it('should verify default minEV is -5.0 and maxEV is 5.0', () => {
    expect(DEFAULT_AUTO_EXPOSURE_CONFIG.minEV).toBe(-5.0);
    expect(DEFAULT_AUTO_EXPOSURE_CONFIG.maxEV).toBe(5.0);
    expect(engine.getConfig().minEV).toBe(-5.0);
    expect(engine.getConfig().maxEV).toBe(5.0);
  });

  it('should clamp calculated target EV to [minEV, maxEV]', () => {
    const customEngine = new AutoExposureEngine({
      minEV: -2.5,
      maxEV: +3.0,
    });

    // Extremely dark scene
    const ultraDark = new Uint32Array(256);
    ultraDark[1] = 1000;
    expect(customEngine.calculateTargetEV(ultraDark)).toBe(3.0);

    // Extremely bright scene
    const ultraBright = new Uint32Array(256);
    ultraBright[240] = 1000;
    expect(customEngine.calculateTargetEV(ultraBright)).toBe(-2.5);
  });

  it('should gracefully handle empty histograms without NaN or crash', () => {
    const emptyHist = new Uint32Array(256);
    const targetEV = engine.calculateTargetEV(emptyHist);
    expect(Number.isFinite(targetEV)).toBe(true);
    expect(targetEV).toBeCloseTo(0.0, 2);
  });
});

describe('Auto Exposure Engine - Asymmetric Temporal Adaptation', () => {
  let engine: AutoExposureEngine;

  beforeEach(() => {
    engine = new AutoExposureEngine({
      temporalSpeedBright: 0.4, // 400ms for pupil constriction
      temporalSpeedDark: 1.5,   // 1500ms for rhodopsin dark adaptation
    });
    engine.reset(0.0);
  });

  it('should adapt faster when transitioning to bright scenes than to dark scenes', () => {
    const dt = 0.4; // 1 time constant for bright adaptation

    // Case A: Transition into bright scene (targetEV = -2.0 from currentEV = 0.0)
    engine.reset(0.0);
    const evBright = engine.updateTemporal(-2.0, dt, true);
    // alpha = 1 - exp(-0.4 / 0.4) = 1 - exp(-1) ~= 0.6321
    // expected = 0 + (-2 - 0) * 0.6321 = -1.264
    expect(evBright).toBeCloseTo(-2.0 * (1 - Math.exp(-1)), 3);

    // Case B: Transition into dark scene (targetEV = +2.0 from currentEV = 0.0)
    engine.reset(0.0);
    const evDark = engine.updateTemporal(2.0, dt, true);
    // alpha = 1 - exp(-0.4 / 1.5) = 1 - exp(-0.2667) ~= 0.234
    // expected = 0 + (2 - 0) * 0.234 = 0.468
    expect(evDark).toBeCloseTo(2.0 * (1 - Math.exp(-0.4 / 1.5)), 3);

    // Bright adaptation progress (63.2%) should be significantly greater than dark progress (23.4%)
    const brightProgress = Math.abs(evBright / -2.0);
    const darkProgress = Math.abs(evDark / 2.0);
    expect(brightProgress).toBeGreaterThan(darkProgress * 2.0);
  });

  it('should converge monotonically without overshoot or oscillation', () => {
    engine.reset(0.0);
    const targetEV = 2.5;
    const dt = 0.016; // 60 FPS
    let prevEV = engine.getCurrentEV();

    for (let step = 0; step < 120; step++) {
      const current = engine.updateTemporal(targetEV, dt, true);
      // Strictly monotonic increase towards target
      expect(current).toBeGreaterThanOrEqual(prevEV);
      // Strictly never overshoots target
      expect(current).toBeLessThanOrEqual(targetEV);
      prevEV = current;
    }

    // After 120 steps (1.92s) with tau = 1.5s:
    // analytical value = 2.5 * (1 - exp(-1.92 / 1.5)) ~= 1.805
    const expectedAt120 = targetEV * (1.0 - Math.exp(-(120 * dt) / 1.5));
    expect(prevEV).toBeCloseTo(expectedAt120, 2);

    // Run further to 500 steps (~8s, > 5 time constants)
    for (let step = 120; step < 500; step++) {
      prevEV = engine.updateTemporal(targetEV, dt, true);
    }
    expect(prevEV).toBeCloseTo(targetEV, 1);
  });

  it('should instantly snap to target EV when isContinuous is false', () => {
    engine.reset(0.0);
    const targetEV = -3.2;
    const result = engine.updateTemporal(targetEV, 0.016, false);
    expect(result).toBe(targetEV);
    expect(engine.getCurrentEV()).toBe(targetEV);
  });

  it('should reset properly with reset() method', () => {
    engine.reset(1.75);
    expect(engine.getCurrentEV()).toBe(1.75);

    engine.reset();
    expect(engine.getCurrentEV()).toBe(0.0);
  });

  it('should update config and modes dynamically', () => {
    engine.setMode('horizon');
    expect(engine.getConfig().mode).toBe('horizon');

    engine.setConfig({ minEV: -2.0, maxEV: 2.0 });
    expect(engine.getConfig().minEV).toBe(-2.0);
    expect(engine.getConfig().maxEV).toBe(2.0);
  });
});

describe('WebGPUEngine Auto Exposure Integration', () => {
  it('should expose AutoExposureEngine and synchronous calculation methods', () => {
    const webgpu = new WebGPUEngine();
    expect(webgpu.autoExposure).toBeInstanceOf(AutoExposureEngine);
    expect(webgpu.getAutoExposureEngine()).toBe(webgpu.autoExposure);

    // Test synchronous histogram auto-exposure
    const testHist = new Uint32Array(256);
    testHist[linearRadianceToBin(0.18)] = 5000;
    const targetEV = webgpu.calculateAutoExposureFromHistogram(testHist);
    expect(targetEV).toBeCloseTo(0.0, 1);

    // Test metering mode configuration
    webgpu.setMeteringMode('horizon');
    expect(webgpu.autoExposure.getConfig().mode).toBe('horizon');

    webgpu.setMeteringMode('viewport', [0, 1, 0], Math.PI / 4);
    expect(webgpu.autoExposure.getConfig().mode).toBe('viewport');

    // Test temporal update through WebGPUEngine
    webgpu.autoExposure.reset(0.0);
    const updatedEV = webgpu.updateAutoExposure(testHist, 0.5, true);
    expect(Number.isFinite(updatedEV)).toBe(true);
  });
});
