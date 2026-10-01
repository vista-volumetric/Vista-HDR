import { describe, it, expect, vi } from 'vitest';
import {
  getFalseColor,
  FALSE_COLOR_PALETTE,
  calculateAutoWhiteBalance,
  calculateEyedropperBalance,
  calculateWhiteBalanceGains,
  calculateNadirMirrorCoord,
} from '../engine/color-science.js';
import {
  lumaToIRE,
  ireToCanvasY,
  rgbToYCbCr,
  getVectorscopeTargets,
  SKIN_TONE_LINE_ANGLE_DEG,
  renderWaveform,
  renderRGBParade,
  renderVectorscope,
} from '../engine/scopes.js';
import { WebGPUEngine } from '../engine/webgpu-engine.js';

describe('ARRI / RED Standardized False Color Palette', () => {
  it('should map crushed blacks (< 0.02) to Purple', () => {
    const color = getFalseColor(0.01);
    expect(color).toEqual([0.5, 0.0, 0.7]);
  });

  it('should map shadows (0.02 to 0.10) to Deep Blue', () => {
    const color = getFalseColor(0.06);
    expect(color).toEqual([0.0, 0.2, 0.8]);
  });

  it('should map shadow mid-tones (0.10 to 0.14) to Cyan', () => {
    const color = getFalseColor(0.12);
    expect(color).toEqual([0.0, 0.7, 0.8]);
  });

  it('should map 18% calibrated mid-gray (0.14 to 0.22) to Green', () => {
    // 0.18 is the standard mid-gray reflectance
    const colorMidGray = getFalseColor(0.18);
    expect(colorMidGray).toEqual([0.0, 0.85, 0.2]);

    const colorLower = getFalseColor(0.145);
    expect(colorLower).toEqual([0.0, 0.85, 0.2]);

    const colorUpper = getFalseColor(0.215);
    expect(colorUpper).toEqual([0.0, 0.85, 0.2]);
  });

  it('should map neutral mid-tones (0.22 to 0.35) to Gray', () => {
    const color = getFalseColor(0.30);
    expect(color).toEqual([0.5, 0.5, 0.5]);
  });

  it('should map skin tones (0.35 to 0.45) to Pink', () => {
    const color = getFalseColor(0.40);
    expect(color).toEqual([0.9, 0.4, 0.6]);
  });

  it('should map upper mids (0.45 to 0.70) to Light Green', () => {
    const color = getFalseColor(0.55);
    expect(color).toEqual([0.6, 0.9, 0.4]);
  });

  it('should map diffuse highlights (0.70 to 0.90) to Yellow', () => {
    const color = getFalseColor(0.80);
    expect(color).toEqual([0.95, 0.9, 0.1]);
  });

  it('should map near-clip warnings (0.90 to 0.98) to Orange', () => {
    const color = getFalseColor(0.95);
    expect(color).toEqual([0.95, 0.5, 0.0]);
  });

  it('should map blown clipping (>= 0.98) to Red', () => {
    const colorClip = getFalseColor(0.99);
    expect(colorClip).toEqual([0.95, 0.05, 0.05]);

    const colorOver = getFalseColor(1.5);
    expect(colorOver).toEqual([0.95, 0.05, 0.05]);
  });

  it('should provide full 10-band FALSE_COLOR_PALETTE definition', () => {
    expect(FALSE_COLOR_PALETTE.length).toBe(10);
    expect(FALSE_COLOR_PALETTE[0].name).toBe('purple');
    expect(FALSE_COLOR_PALETTE[3].name).toBe('green');
    expect(FALSE_COLOR_PALETTE[5].name).toBe('pink');
    expect(FALSE_COLOR_PALETTE[9].name).toBe('red');
  });
});

describe('Auto White Balance (AWB) Gray-World Centroid Math', () => {
  function makeHistogram(peakBin: number): Uint32Array {
    const hist = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const dist = Math.abs(i - peakBin);
      hist[i] = Math.max(0, 1000 - dist * 40);
    }
    return hist;
  }

  it('should preserve neutral ~6500K and 0 tint when histograms are identical', () => {
    const neutralHist = makeHistogram(128);
    const result = calculateAutoWhiteBalance(neutralHist, neutralHist, neutralHist, 6500, 0);

    expect(result.temperature).toBeCloseTo(6500, -2);
    expect(Math.abs(result.tint)).toBeLessThan(2.0);
  });

  it('should calculate cooler Kelvin (< 6500K) to neutralize warm cast (Red > Blue)', () => {
    // Warm cast: high Red energy (peak 180), low Blue energy (peak 80)
    const rHist = makeHistogram(180);
    const gHist = makeHistogram(128);
    const bHist = makeHistogram(80);

    const result = calculateAutoWhiteBalance(rHist, gHist, bHist, 6500, 0);
    // Compensating Kelvin must be cooler to increase Blue gain and decrease Red gain
    expect(result.temperature).toBeLessThan(6500);
    expect(result.temperature).toBeGreaterThanOrEqual(2500);
  });

  it('should calculate warmer Kelvin (> 6500K) to neutralize cool cast (Blue > Red)', () => {
    // Cool cast: low Red energy (peak 80), high Blue energy (peak 180)
    const rHist = makeHistogram(80);
    const gHist = makeHistogram(128);
    const bHist = makeHistogram(180);

    const result = calculateAutoWhiteBalance(rHist, gHist, bHist, 6500, 0);
    // Compensating Kelvin must be warmer to increase Red gain and decrease Blue gain
    expect(result.temperature).toBeGreaterThan(6500);
    expect(result.temperature).toBeLessThanOrEqual(10000);
  });

  it('should clamp extreme histogram casts to safe [2500, 10000] K and [-50, +50] Tint', () => {
    // Extreme warm cast (pure Red only)
    const rExtreme = makeHistogram(250);
    const gExtreme = makeHistogram(10);
    const bExtreme = makeHistogram(5);

    const resultWarm = calculateAutoWhiteBalance(rExtreme, gExtreme, bExtreme, 6500, 0);
    expect(resultWarm.temperature).toBe(2500); // clamped lower bound
    expect(resultWarm.tint).toBeGreaterThanOrEqual(-50);
    expect(resultWarm.tint).toBeLessThanOrEqual(50);

    // Extreme cool cast (pure Blue only)
    const rCool = makeHistogram(5);
    const gCool = makeHistogram(10);
    const bCool = makeHistogram(250);

    const resultCool = calculateAutoWhiteBalance(rCool, gCool, bCool, 6500, 0);
    expect(resultCool.temperature).toBe(10000); // clamped upper bound
  });
});

describe('Eyedropper White Balance Neutralization', () => {
  it('should keep neutral settings when clicking a neutral gray pixel', () => {
    const result = calculateEyedropperBalance(0.5, 0.5, 0.5, 6500, 0);
    expect(result.temperature).toBeCloseTo(6500, -2);
    expect(Math.abs(result.tint)).toBeLessThan(2.0);
  });

  it('should return compensating cooler Kelvin when clicking a warm tinted pixel', () => {
    // Clicking a warm pixel (R=0.75, G=0.55, B=0.35)
    const result = calculateEyedropperBalance(0.75, 0.55, 0.35, 6500, 0);
    // Must return cooler Kelvin to cool down the scene
    expect(result.temperature).toBeLessThan(6500);
    expect(result.temperature).toBeGreaterThanOrEqual(2500);

    // Verify resulting white balance gains neutralize the warm pixel
    const [rGain, , bGain] = calculateWhiteBalanceGains(result.temperature, result.tint);
    const balancedR = 0.75 * rGain;
    const balancedB = 0.35 * bGain;
    expect(balancedR / balancedB).toBeCloseTo(1.0, 1);
  });

  it('should return compensating warmer Kelvin when clicking a cool tinted pixel', () => {
    // Clicking a cool tinted pixel (R=0.48, G=0.55, B=0.60)
    const result = calculateEyedropperBalance(0.48, 0.55, 0.60, 6500, 0);
    // Must return warmer Kelvin to warm up the scene
    expect(result.temperature).toBeGreaterThan(6500);
    expect(result.temperature).toBeLessThanOrEqual(10000);

    const [rGain, , bGain] = calculateWhiteBalanceGains(result.temperature, result.tint);
    const balancedR = 0.48 * rGain;
    const balancedB = 0.60 * bGain;
    expect(balancedR / balancedB).toBeCloseTo(1.0, 1);

    // Extreme cool pixel clamps to 10000K upper bound
    const extremeResult = calculateEyedropperBalance(0.2, 0.5, 0.9, 6500, 0);
    expect(extremeResult.temperature).toBe(10000);
  });

  it('should adjust tint appropriately for green and magenta color casts', () => {
    // Green tinted pixel: needs magenta boost (positive tint)
    const resultGreen = calculateEyedropperBalance(0.5, 0.75, 0.5, 6500, 0);
    expect(resultGreen.tint).toBeGreaterThan(0);

    // Magenta tinted pixel: needs green boost (negative tint)
    const resultMagenta = calculateEyedropperBalance(0.75, 0.45, 0.75, 6500, 0);
    expect(resultMagenta.tint).toBeLessThan(0);
  });
});

describe('360° Nadir Mask & Mirror Coordinate Math', () => {
  it('should not mirror pixels above the nadir boundary', () => {
    const height = 1000;
    const radius = 0.12; // boundary at 1000 * 0.88 = 880
    const yAbove = 800;

    const mirrored = calculateNadirMirrorCoord(yAbove, height, radius);
    expect(mirrored).toBe(800);
  });

  it('should accurately reflect coordinates across the nadir boundary', () => {
    const height = 1000;
    const radius = 0.12; // boundary at 880
    // Boundary pixel
    expect(calculateNadirMirrorCoord(880, height, radius)).toBe(880);

    // 10 pixels below boundary -> reflects to 10 pixels above boundary
    expect(calculateNadirMirrorCoord(890, height, radius)).toBe(870);

    // 50 pixels below boundary -> reflects to 50 pixels above boundary
    expect(calculateNadirMirrorCoord(930, height, radius)).toBe(830);

    // Bottom-most pixel (y = 999) -> reflects to 880 - 119 = 761
    expect(calculateNadirMirrorCoord(999, height, radius)).toBe(761);
  });

  it('should clamp mirrored coordinates within [0, height - 1]', () => {
    const height = 100;
    const radius = 0.6; // boundary at 40
    // 50 pixels below boundary (y = 90) -> 40 - 50 = -10 -> clamped to 0
    expect(calculateNadirMirrorCoord(90, height, radius)).toBe(0);
  });
});

describe('Broadcast Scopes (Waveform, RGB Parade, Vectorscope)', () => {
  it('should calculate IRE from linear luminance correctly', () => {
    expect(lumaToIRE(0.0)).toBe(0.0);
    expect(lumaToIRE(0.18)).toBeCloseTo(18.0, 5);
    expect(lumaToIRE(1.0)).toBe(100.0);
    expect(lumaToIRE(1.2)).toBe(120.0);
  });

  it('should map IRE scale to canvas Y monotonically (higher IRE is higher on screen)', () => {
    const canvasHeight = 300;
    const y0 = ireToCanvasY(0, canvasHeight);
    const y50 = ireToCanvasY(50, canvasHeight);
    const y100 = ireToCanvasY(100, canvasHeight);

    // Canvas coordinates: 0 is top, height is bottom
    // Higher IRE must have lower canvas Y coordinate
    expect(y100).toBeLessThan(y50);
    expect(y50).toBeLessThan(y0);
    // 50 IRE is exactly midway
    expect((y0 + y100) / 2).toBeCloseTo(y50, 4);
  });

  it('should evaluate Rec.709 YCbCr chrominance matrix accurately', () => {
    // Neutral gray: Cb=0, Cr=0
    const gray = rgbToYCbCr(0.5, 0.5, 0.5);
    expect(gray.y).toBeCloseTo(0.5, 4);
    expect(gray.cb).toBeCloseTo(0.0, 4);
    expect(gray.cr).toBeCloseTo(0.0, 4);

    // Pure Red (1, 0, 0): Y=0.2126, Cb=-0.1146, Cr=0.5
    const red = rgbToYCbCr(1.0, 0.0, 0.0);
    expect(red.y).toBeCloseTo(0.2126, 4);
    expect(red.cb).toBeCloseTo(-0.1146, 4);
    expect(red.cr).toBeCloseTo(0.5000, 4);

    // Pure Blue (0, 0, 1): Y=0.0722, Cb=0.5, Cr=-0.0458
    const blue = rgbToYCbCr(0.0, 0.0, 1.0);
    expect(blue.y).toBeCloseTo(0.0722, 4);
    expect(blue.cb).toBeCloseTo(0.5000, 4);
    expect(blue.cr).toBeCloseTo(-0.0458, 4);
  });

  it('should compute symmetric 75% Vectorscope target boxes', () => {
    const targets = getVectorscopeTargets(100, 150, 150);
    expect(targets.length).toBe(6);

    const redTarget = targets.find(t => t.name === 'R')!;
    const cyanTarget = targets.find(t => t.name === 'Cy')!;
    const blueTarget = targets.find(t => t.name === 'B')!;
    const yellowTarget = targets.find(t => t.name === 'Yl')!;

    // Red and Cyan are exact opposites
    expect(redTarget.x - 150).toBeCloseTo(-(cyanTarget.x - 150), 3);
    expect(redTarget.y - 150).toBeCloseTo(-(cyanTarget.y - 150), 3);

    // Blue and Yellow are exact opposites
    expect(blueTarget.x - 150).toBeCloseTo(-(yellowTarget.x - 150), 3);
    expect(blueTarget.y - 150).toBeCloseTo(-(yellowTarget.y - 150), 3);
  });

  it('should define the standard +123° I-Axis Skin Tone Line', () => {
    expect(SKIN_TONE_LINE_ANGLE_DEG).toBe(123.0);
    // At 123°, dx = cos(123°) < 0 and dy = -sin(123°) < 0 (canvas Y goes up/left into orange region)
    const rad = (SKIN_TONE_LINE_ANGLE_DEG * Math.PI) / 180.0;
    expect(Math.cos(rad)).toBeLessThan(0); // negative Cb
    expect(Math.sin(rad)).toBeGreaterThan(0); // positive Cr
  });

  it('should execute Waveform, RGB Parade, and Vectorscope renderers without error', () => {
    // Create mock CanvasRenderingContext2D
    const mockCtx = {
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
    } as unknown as CanvasRenderingContext2D;

    // Create 4x4 test HDR pixel buffer
    const testHDR = new Float32Array(4 * 4 * 4);
    for (let i = 0; i < testHDR.length; i += 4) {
      testHDR[i] = 0.8;     // R
      testHDR[i + 1] = 0.5; // G
      testHDR[i + 2] = 0.2; // B
      testHDR[i + 3] = 1.0; // A
    }

    expect(() => renderWaveform(mockCtx, 300, 200, testHDR, 4, 4)).not.toThrow();
    expect(() => renderRGBParade(mockCtx, 300, 200, testHDR, 4, 4)).not.toThrow();
    expect(() => renderVectorscope(mockCtx, 300, 200, testHDR, 4, 4)).not.toThrow();

    expect(mockCtx.fillRect).toHaveBeenCalled();
    expect(mockCtx.stroke).toHaveBeenCalled();
  });
});

describe('WebGPUEngine Diagnostic Mode & Nadir Patch API', () => {
  it('should initialize with default diagnostic mode and nadir patch configuration', () => {
    const engine = new WebGPUEngine();
    expect(engine.getDiagnosticMode()).toBe('normal');
    expect(engine.getNadirConfig()).toEqual({
      mode: 'off',
      radius: 0.12,
      feather: 0.04,
    });
  });

  it('should allow setting diagnostic mode and zebra threshold', () => {
    const engine = new WebGPUEngine();

    engine.setDiagnosticMode('false_color');
    expect(engine.getDiagnosticMode()).toBe('false_color');

    engine.setDiagnosticMode('zebras', 0.85);
    expect(engine.getDiagnosticMode()).toBe('zebras');

    engine.setDiagnosticMode('normal');
    expect(engine.getDiagnosticMode()).toBe('normal');
  });

  it('should configure 360° nadir patch with clamping', () => {
    const engine = new WebGPUEngine();

    engine.setNadirPatch('mirror', 0.15, 0.05);
    expect(engine.getNadirConfig()).toEqual({
      mode: 'mirror',
      radius: 0.15,
      feather: 0.05,
    });

    engine.setNadirPatch('vignette', 0.2, 0.08);
    expect(engine.getNadirConfig()).toEqual({
      mode: 'vignette',
      radius: 0.2,
      feather: 0.08,
    });

    engine.setNadirPatch('plate', 1.5, -0.1);
    const clamped = engine.getNadirConfig();
    expect(clamped.mode).toBe('plate');
    expect(clamped.radius).toBe(1.0); // clamped to 1.0
    expect(clamped.feather).toBe(0.0); // clamped to 0.0
  });
});
