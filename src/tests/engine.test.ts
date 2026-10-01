import { describe, it, expect } from 'vitest';
import {
  dlogToLinear,
  linearToDLog,
  dlogMToLinear,
  calculateWhiteBalanceGains,
  acesFilmicToneMapping,
  linearToSRGB,
  sRGBToLinear,
  gradePixelCPU,
  DEFAULT_GRADING_PARAMS,
} from '../engine/color-science.js';
import {
  encodeRGBE,
  decodeRGBE,
  floatToRGBE,
  rgbeToFloat,
  floatToHalf,
  halfToFloat,
  encodeEXR,
  exportSDR,
} from '../engine/hdr-exporter.js';

describe('DJI D-Log & D-Log M Color Science', () => {
  it('should maintain mathematical continuity at the D-Log boundary x = 0.14', () => {
    const xBoundary = 0.14;
    // Linear segment: (x - 0.0929) / 6.025
    const valLow = (xBoundary - 0.0929) / 6.025;
    // Log segment: (10^((x - 0.584555) / 0.256663) - 0.0108) / 0.9892
    const exp = (xBoundary - 0.584555) / 0.256663;
    const valHigh = (Math.pow(10.0, exp) - 0.0108) / 0.9892;

    expect(valLow).toBeCloseTo(0.0078174, 5);
    expect(valHigh).toBeCloseTo(0.0078174, 5);
    expect(Math.abs(valLow - valHigh)).toBeLessThan(1e-6);
  });

  it('should perfectly round-trip D-Log (Linear -> D-Log -> Linear)', () => {
    const testRadianceValues = [0.001, 0.005, 0.0078, 0.01, 0.05, 0.18, 0.5, 1.0, 2.5, 5.0];

    for (const val of testRadianceValues) {
      const dlog = linearToDLog(val);
      const recovered = dlogToLinear(dlog);
      expect(recovered).toBeCloseTo(val, 4);
    }
  });

  it('should perfectly round-trip D-Log (D-Log -> Linear -> D-Log)', () => {
    const testCodeValues = [0.05, 0.10, 0.14, 0.20, 0.35, 0.50, 0.65, 0.80, 0.95];

    for (const code of testCodeValues) {
      const linear = dlogToLinear(code);
      const recovered = linearToDLog(linear);
      expect(recovered).toBeCloseTo(code, 4);
    }
  });

  it('should evaluate calibrated D-Log M inverse transfer function monotonically', () => {
    let prevLinear = -1;
    for (let code = 0.0; code <= 1.0; code += 0.05) {
      const linear = dlogMToLinear(code);
      expect(linear).toBeGreaterThanOrEqual(0);
      expect(linear).toBeGreaterThanOrEqual(prevLinear);
      prevLinear = linear;
    }
    // Mid-gray reference test: code ~0.40 maps close to scene linear ~0.18
    const midGrayLinear = dlogMToLinear(0.40);
    expect(midGrayLinear).toBeGreaterThan(0.05);
    expect(midGrayLinear).toBeLessThan(0.30);
  });

  it('should compute neutral white balance gains near 6504K (D65)', () => {
    const [r, g, b] = calculateWhiteBalanceGains(6504, 0);
    expect(r).toBeCloseTo(1.0, 1);
    expect(g).toBeCloseTo(1.0, 1);
    expect(b).toBeCloseTo(1.0, 1);
  });

  it('should adjust white balance gains appropriately for warm and cool temperatures', () => {
    // 3200K (Tungsten): cool down by increasing blue gain relative to red
    const [rWarm, gWarm, bWarm] = calculateWhiteBalanceGains(3200, 0);
    expect(bWarm).toBeGreaterThan(rWarm);

    // 9000K (Overcast / Shade): warm up by increasing red gain relative to blue
    const [rCool, gCool, bCool] = calculateWhiteBalanceGains(9000, 0);
    expect(rCool).toBeGreaterThan(bCool);
  });

  it('should evaluate ACES filmic tone mapping curve smoothly', () => {
    expect(acesFilmicToneMapping(0.0)).toBe(0.0);
    expect(acesFilmicToneMapping(0.18)).toBeGreaterThan(0.10);
    expect(acesFilmicToneMapping(1.0)).toBeGreaterThan(0.70);
    expect(acesFilmicToneMapping(10.0)).toBeLessThanOrEqual(1.0);
    expect(acesFilmicToneMapping(100.0)).toBeCloseTo(1.0, 2);
  });

  it('should accurately round-trip sRGB EOTF', () => {
    const testValues = [0.0, 0.001, 0.01, 0.05, 0.18, 0.5, 0.8, 1.0];
    for (const val of testValues) {
      const srgb = linearToSRGB(val);
      const linear = sRGBToLinear(srgb);
      expect(linear).toBeCloseTo(val, 4);
    }
  });

  it('should apply exposure stops correctly in gradePixelCPU', () => {
    const inputRGB: [number, number, number] = [0.18, 0.18, 0.18];
    const baseGrade = gradePixelCPU(inputRGB, { ...DEFAULT_GRADING_PARAMS, inputLogType: 'linear' });
    const plusOneStop = gradePixelCPU(inputRGB, {
      ...DEFAULT_GRADING_PARAMS,
      inputLogType: 'linear',
      exposure: 1.0,
    });
    const minusOneStop = gradePixelCPU(inputRGB, {
      ...DEFAULT_GRADING_PARAMS,
      inputLogType: 'linear',
      exposure: -1.0,
    });

    expect(plusOneStop[0]).toBeCloseTo(baseGrade[0] * 2.0, 3);
    expect(minusOneStop[0]).toBeCloseTo(baseGrade[0] / 2.0, 3);
  });
});

describe('Radiance .hdr (RGBE 32-bit RLE) Encoder & Decoder', () => {
  it('should accurately convert between linear floats and RGBE bytes', () => {
    const testCases: [number, number, number][] = [
      [0.0, 0.0, 0.0],
      [1.0, 1.0, 1.0],
      [0.5, 0.25, 0.125],
      [10.5, 2.3, 0.01],
      [128.0, 64.0, 32.0],
    ];

    for (const [r, g, b] of testCases) {
      const [rB, gB, bB, exp] = floatToRGBE(r, g, b);
      if (r === 0 && g === 0 && b === 0) {
        expect(exp).toBe(0);
        continue;
      }
      expect(exp).toBeGreaterThan(0);
      const [recR, recG, recB] = rgbeToFloat(rB, gB, bB, exp);

      // RGBE has an 8-bit mantissa relative to the maximum channel (1/256 precision ~ 0.4%)
      const maxChannel = Math.max(r, Math.max(g, b));
      const tolerance = (maxChannel / 256) * 1.5; // quantization step bound
      expect(Math.abs(recR - r)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(recG - g)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(recB - b)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('should encode and decode a full HDR image with adaptive RLE compression', () => {
    const width = 32;
    const height = 16;
    const testImage = new Float32Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Create repeating runs and gradients to thoroughly exercise RLE
        if (x < 16) {
          testImage[idx] = 1.5; // Constant run
          testImage[idx + 1] = 0.8;
          testImage[idx + 2] = 0.2;
          testImage[idx + 3] = 1.0;
        } else {
          testImage[idx] = x * 0.1; // Gradient literals
          testImage[idx + 1] = y * 0.2;
          testImage[idx + 2] = (x + y) * 0.05;
          testImage[idx + 3] = 1.0;
        }
      }
    }

    const encoded = encodeRGBE(testImage, width, height, true);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    // Verify Radiance header
    const headerPrefix = new TextDecoder().decode(encoded.subarray(0, 10));
    expect(headerPrefix).toBe('#?RADIANCE');

    // Decode and verify round-trip
    const decoded = decodeRGBE(encoded);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.data.length).toBe(width * height * 4);

    // Compare values (within RGBE 8-bit mantissa precision)
    for (let i = 0; i < testImage.length; i += 4) {
      expect(decoded.data[i]).toBeCloseTo(testImage[i], 1);
      expect(decoded.data[i + 1]).toBeCloseTo(testImage[i + 1], 1);
      expect(decoded.data[i + 2]).toBeCloseTo(testImage[i + 2], 1);
    }
  });

  it('should handle uncompressed fallback for small widths (< 8)', () => {
    const width = 4;
    const height = 4;
    const smallImage = new Float32Array(width * height * 4);
    for (let i = 0; i < smallImage.length; i += 4) {
      smallImage[i] = 2.0;
      smallImage[i + 1] = 1.0;
      smallImage[i + 2] = 0.5;
      smallImage[i + 3] = 1.0;
    }

    const encoded = encodeRGBE(smallImage, width, height, true);
    const decoded = decodeRGBE(encoded);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(decoded.data[0]).toBeCloseTo(2.0, 1);
  });
});

describe('OpenEXR (.exr) Binary Generator', () => {
  it('should convert Float32 to Half-Float (16-bit) and back accurately', () => {
    const testFloats = [0.0, 1.0, -1.0, 0.5, 2.0, 16.0, 100.0, 1000.0, 65504.0];
    for (const val of testFloats) {
      const half = floatToHalf(val);
      expect(half).toBeGreaterThanOrEqual(0);
      expect(half).toBeLessThanOrEqual(65535);

      const recovered = halfToFloat(half);
      expect(recovered).toBeCloseTo(val, val > 100 ? 0 : 2);
    }
  });

  it('should generate valid OpenEXR binary file with all required attributes', () => {
    const width = 16;
    const height = 8;
    const testHDR = new Float32Array(width * height * 4);
    for (let i = 0; i < testHDR.length; i += 4) {
      testHDR[i] = 1.25;
      testHDR[i + 1] = 0.75;
      testHDR[i + 2] = 0.5;
      testHDR[i + 3] = 1.0;
    }

    const exrData = encodeEXR(testHDR, width, height, { halfPrecision: true, is360: true });
    expect(exrData).toBeInstanceOf(Uint8Array);
    expect(exrData.length).toBeGreaterThan(0);

    // Verify OpenEXR Magic Number: 0x76, 0x2f, 0x31, 0x01
    expect(exrData[0]).toBe(0x76);
    expect(exrData[1]).toBe(0x2f);
    expect(exrData[2]).toBe(0x31);
    expect(exrData[3]).toBe(0x01);

    // Verify Version: 2
    expect(exrData[4]).toBe(0x02);
    expect(exrData[5]).toBe(0x00);
    expect(exrData[6]).toBe(0x00);
    expect(exrData[7]).toBe(0x00);

    // Verify presence of required header attribute names in the binary file
    const asString = new TextDecoder('latin1').decode(exrData);
    expect(asString).toContain('channels');
    expect(asString).toContain('compression');
    expect(asString).toContain('dataWindow');
    expect(asString).toContain('displayWindow');
    expect(asString).toContain('lineOrder');
    expect(asString).toContain('pixelAspectRatio');
    expect(asString).toContain('screenWindowCenter');
    expect(asString).toContain('screenWindowWidth');
    expect(asString).toContain('envmap'); // 360 metadata
  });

  it('should support 32-bit full float OpenEXR export', () => {
    const width = 8;
    const height = 4;
    const testHDR = new Float32Array(width * height * 4);
    const exr32 = encodeEXR(testHDR, width, height, { halfPrecision: false });
    expect(exr32[0]).toBe(0x76);
    expect(exr32[1]).toBe(0x2f);
    expect(exr32[2]).toBe(0x31);
    expect(exr32[3]).toBe(0x01);
  });
});

describe('Tone-mapped SDR Exporter', () => {
  it('should convert linear HDR data to 8-bit SDR clamped array', async () => {
    const width = 4;
    const height = 4;
    const testHDR = new Float32Array(width * height * 4);
    for (let i = 0; i < testHDR.length; i += 4) {
      testHDR[i] = 10.0; // Extreme bright highlight
      testHDR[i + 1] = 0.18; // Mid-gray
      testHDR[i + 2] = 0.0; // Black
      testHDR[i + 3] = 1.0;
    }

    const { uint8Data } = await exportSDR(testHDR, width, height);
    expect(uint8Data.length).toBe(width * height * 4);

    // Red highlight should be tone-mapped close to 255 without blowing up or NaN
    expect(uint8Data[0]).toBeGreaterThan(200);
    expect(uint8Data[0]).toBeLessThanOrEqual(255);

    // Green mid-gray should be mapped around 100-150 in sRGB
    expect(uint8Data[1]).toBeGreaterThan(80);
    expect(uint8Data[1]).toBeLessThan(180);

    // Blue black should be 0
    expect(uint8Data[2]).toBe(0);

    // Alpha should be 255
    expect(uint8Data[3]).toBe(255);
  });
});
