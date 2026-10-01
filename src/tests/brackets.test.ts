import { describe, it, expect } from 'vitest';
import {
  generateExposureBracket,
  generateExposureBracketSet,
  applyBracketToneMapping,
  formatEVLabel,
  ExposureBracket,
} from '../engine/hdr-exporter.js';
import { linearToSRGB } from '../engine/color-science.js';

describe('Exposure Brackets Architecture (±5 EV)', () => {
  describe('Mathematical Scale Verification', () => {
    it('should verify -5 EV stop scales linear values by 2^(-5) = 0.03125', () => {
      const evOffset = -5;
      const scale = Math.pow(2.0, evOffset);
      expect(scale).toBe(0.03125);
      expect(scale).toBe(1 / 32);
    });

    it('should verify -3 EV stop scales linear values by 2^(-3) = 0.125', () => {
      const evOffset = -3;
      const scale = Math.pow(2.0, evOffset);
      expect(scale).toBe(0.125);
      expect(scale).toBe(1 / 8);
    });

    it('should verify 0 EV stop scales linear values by 2^0 = 1.0', () => {
      const evOffset = 0;
      const scale = Math.pow(2.0, evOffset);
      expect(scale).toBe(1.0);
    });

    it('should verify +3 EV stop scales linear values by 2^(+3) = 8.0', () => {
      const evOffset = 3;
      const scale = Math.pow(2.0, evOffset);
      expect(scale).toBe(8.0);
    });

    it('should verify +5 EV stop scales linear values by 2^(+5) = 32.0', () => {
      const evOffset = 5;
      const scale = Math.pow(2.0, evOffset);
      expect(scale).toBe(32.0);
    });

    it('should accurately compute scale for arbitrary fractional and integer stops', () => {
      expect(Math.pow(2.0, -1)).toBe(0.5);
      expect(Math.pow(2.0, 1)).toBe(2.0);
      expect(Math.pow(2.0, 2)).toBe(4.0);
      expect(Math.pow(2.0, -2)).toBe(0.25);
    });
  });

  describe('Dynamic Range Compression & Highlight/Shadow Preserving', () => {
    it('should bring an intense highlight (L = 5.0) down to 0.625 at -3 EV, preserving detail below clipping', () => {
      const highlight = 5.0;
      const scaleMinus3 = Math.pow(2.0, -3); // 0.125
      const scaledHighlight = highlight * scaleMinus3;

      expect(scaledHighlight).toBeCloseTo(0.625, 5);
      // Below 1.0 (unclipped headroom preserved!)
      expect(scaledHighlight).toBeLessThan(1.0);
    });

    it('should lift shadow details (L = 0.02) up to 0.16 at +3 EV', () => {
      const shadow = 0.02;
      const scalePlus3 = Math.pow(2.0, 3); // 8.0
      const scaledShadow = shadow * scalePlus3;

      expect(scaledShadow).toBeCloseTo(0.16, 5);
      expect(scaledShadow).toBeGreaterThan(shadow);
    });

    it('should preserve highlight details below 255 in 8-bit output for L = 5.0 in -3 EV bracket', async () => {
      const width = 2;
      const height = 2;
      const linearData = new Float32Array(width * height * 4);
      // Fill with intense highlight L = 5.0 in Red, mid-gray 0.18 in Green, shadow 0.02 in Blue
      for (let i = 0; i < linearData.length; i += 4) {
        linearData[i] = 5.0;     // Highlight
        linearData[i + 1] = 0.18; // Mid-tone
        linearData[i + 2] = 0.02; // Shadow
        linearData[i + 3] = 1.0;  // Alpha
      }

      // Generate -3 EV bracket with linear tone mapping
      const bracketMinus3 = await generateExposureBracket(linearData, width, height, -3, 'linear');
      expect(bracketMinus3.uint8Data).toBeDefined();
      const u8Minus3 = bracketMinus3.uint8Data!;

      // Highlight 5.0 * 0.125 = 0.625. linearToSRGB(0.625) ~ 0.817 * 255 ~ 208
      // Crucially, it must be < 255 (unclipped detail preserved!)
      const expectedSrgb8Bit = Math.round(linearToSRGB(0.625) * 255);
      expect(u8Minus3[0]).toBe(expectedSrgb8Bit);
      expect(u8Minus3[0]).toBeLessThan(255);
      expect(u8Minus3[0]).toBeGreaterThan(180);

      // In contrast, at 0 EV with linear mapping, 5.0 is hard clamped to 1.0 (255)
      const bracketZero = await generateExposureBracket(linearData, width, height, 0, 'linear');
      const u8Zero = bracketZero.uint8Data!;
      expect(u8Zero[0]).toBe(255); // Completely clipped at 0 EV!
    });

    it('should lift shadow details from near-black to visible mid-tones in +3 EV bracket', async () => {
      const width = 2;
      const height = 2;
      const linearData = new Float32Array(width * height * 4);
      for (let i = 0; i < linearData.length; i += 4) {
        linearData[i] = 0.02;     // Deep shadow in Red
        linearData[i + 1] = 0.02;
        linearData[i + 2] = 0.02;
        linearData[i + 3] = 1.0;
      }

      const bracketZero = await generateExposureBracket(linearData, width, height, 0, 'linear');
      const bracketPlus3 = await generateExposureBracket(linearData, width, height, 3, 'linear');

      const u8Zero = bracketZero.uint8Data!;
      const u8Plus3 = bracketPlus3.uint8Data!;

      // At 0 EV: 0.02 -> linearToSRGB(0.02) ~ 0.153 * 255 ~ 39
      // At +3 EV: 0.02 * 8 = 0.16 -> linearToSRGB(0.16) ~ 0.435 * 255 ~ 111
      expect(u8Plus3[0]).toBeGreaterThan(u8Zero[0] * 2);
      expect(u8Plus3[0]).toBeCloseTo(Math.round(linearToSRGB(0.16) * 255), -1);
    });
  });

  describe('Label Formatting (EV-5, EV-3, EV+0, EV+3, EV+5)', () => {
    it('should format negative stops with EV prefix and minus sign', () => {
      expect(formatEVLabel(-5)).toBe('EV-5');
      expect(formatEVLabel(-3)).toBe('EV-3');
      expect(formatEVLabel(-1)).toBe('EV-1');
      expect(formatEVLabel(-0.5)).toBe('EV-0.5');
    });

    it('should format zero stop with EV+0', () => {
      expect(formatEVLabel(0)).toBe('EV+0');
    });

    it('should format positive stops with EV+ prefix', () => {
      expect(formatEVLabel(5)).toBe('EV+5');
      expect(formatEVLabel(3)).toBe('EV+3');
      expect(formatEVLabel(1)).toBe('EV+1');
      expect(formatEVLabel(2.5)).toBe('EV+2.5');
    });
  });

  describe('Tone Mapping Modes for Brackets', () => {
    it('should support ACES filmic curve', () => {
      // 0 maps to 0
      expect(applyBracketToneMapping(0, 'aces')).toBe(0);
      // 1.0 maps to ~0.7-0.9
      const aces1 = applyBracketToneMapping(1.0, 'aces');
      expect(aces1).toBeGreaterThan(0.7);
      expect(aces1).toBeLessThan(1.0);
      // Extreme values gracefully compress to <= 1.0
      expect(applyBracketToneMapping(100.0, 'aces')).toBeLessThanOrEqual(1.0);
    });

    it('should support Reinhard extended tone mapping x / (x + 1)', () => {
      expect(applyBracketToneMapping(0, 'reinhard')).toBe(0);
      expect(applyBracketToneMapping(1.0, 'reinhard')).toBe(0.5);
      expect(applyBracketToneMapping(2.0, 'reinhard')).toBeCloseTo(2 / 3, 5);
      expect(applyBracketToneMapping(9.0, 'reinhard')).toBe(0.9);
      expect(applyBracketToneMapping(1000.0, 'reinhard')).toBeLessThanOrEqual(1.0);
    });

    it('should support linear tone mapping with clamping [0, 1]', () => {
      expect(applyBracketToneMapping(0.25, 'linear')).toBe(0.25);
      expect(applyBracketToneMapping(0.75, 'linear')).toBe(0.75);
      expect(applyBracketToneMapping(1.5, 'linear')).toBe(1.0);
      expect(applyBracketToneMapping(-0.5, 'linear')).toBe(0.0);
    });
  });

  describe('generateExposureBracketSet', () => {
    it('should produce 3 brackets with labels EV-5, EV+0, EV+5 by default', async () => {
      const width = 4;
      const height = 4;
      const linearData = new Float32Array(width * height * 4);
      for (let i = 0; i < linearData.length; i += 4) {
        linearData[i] = 0.5;
        linearData[i + 1] = 0.5;
        linearData[i + 2] = 0.5;
        linearData[i + 3] = 1.0;
      }

      const brackets: ExposureBracket[] = await generateExposureBracketSet(
        linearData,
        width,
        height
      );

      expect(brackets).toHaveLength(3);

      // Verify Bracket 1: -5 EV
      expect(brackets[0].evStop).toBe(-5);
      expect(brackets[0].label).toBe('EV-5');
      expect(brackets[0].blob).toBeDefined();
      expect(brackets[0].dataUrl).toBeDefined();
      expect(brackets[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);

      // Verify Bracket 2: 0 EV
      expect(brackets[1].evStop).toBe(0);
      expect(brackets[1].label).toBe('EV+0');
      expect(brackets[1].blob).toBeDefined();
      expect(brackets[1].dataUrl).toBeDefined();
      expect(brackets[1].dataUrl.startsWith('data:image/png;base64,')).toBe(true);

      // Verify Bracket 3: +5 EV
      expect(brackets[2].evStop).toBe(5);
      expect(brackets[2].label).toBe('EV+5');
      expect(brackets[2].blob).toBeDefined();
      expect(brackets[2].dataUrl).toBeDefined();
      expect(brackets[2].dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('should support custom exposure stops (e.g. 5-shot bracket -2, -1, 0, +1, +2 EV and custom ±5 EV)', async () => {
      const width = 2;
      const height = 2;
      const linearData = new Float32Array(width * height * 4).fill(0.18);
      const customStops = [-2, -1, 0, 1, 2];

      const brackets = await generateExposureBracketSet(linearData, width, height, customStops);
      expect(brackets).toHaveLength(5);
      expect(brackets.map((b) => b.label)).toEqual(['EV-2', 'EV-1', 'EV+0', 'EV+1', 'EV+2']);
      expect(brackets.map((b) => b.evStop)).toEqual([-2, -1, 0, 1, 2]);

      // Assertion for custom ±5 EV brackets
      const brackets5EV = await generateExposureBracketSet(linearData, width, height, [-5, 0, 5]);
      expect(brackets5EV).toHaveLength(3);
      expect(brackets5EV.map((b) => b.label)).toEqual(['EV-5', 'EV+0', 'EV+5']);
      expect(brackets5EV.map((b) => b.evStop)).toEqual([-5, 0, 5]);
    });

    it('should correctly handle 3-channel RGB float buffers without alpha', async () => {
      const width = 2;
      const height = 2;
      const rgbData = new Float32Array(width * height * 3).fill(0.5);

      const bracket = await generateExposureBracket(rgbData, width, height, 0, 'aces');
      expect(bracket.evStop).toBe(0);
      expect(bracket.label).toBe('EV+0');
      expect(bracket.uint8Data).toBeDefined();
      expect(bracket.uint8Data!.length).toBe(width * height * 4);
      // Alpha channel should be defaulted to 255
      expect(bracket.uint8Data![3]).toBe(255);
    });
  });
});
