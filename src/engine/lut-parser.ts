/**
 * Vista HDR 3D LUT (.cube) Parser & Generator
 * Complies with Adobe .cube 3D LUT specification.
 */

export interface CubeLUT {
  title: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Float32Array; // N x N x N x 4 (RGBA Float32)
}

/**
 * Parses Adobe .cube format string into 3D LUT metadata and RGBA Float32Array texture buffer
 */
export function parseCubeLUT(content: string): CubeLUT {
  const lines = content.split(/\r?\n/);
  let title = 'Custom LUT';
  let size = 0;
  let domainMin: [number, number, number] = [0.0, 0.0, 0.0];
  let domainMax: [number, number, number] = [1.0, 1.0, 1.0];
  const rgbValues: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;

    if (raw.toUpperCase().startsWith('TITLE')) {
      const match = raw.match(/TITLE\s+["']?([^"']+)["']?/i);
      if (match) title = match[1].trim();
    } else if (raw.toUpperCase().startsWith('LUT_3D_SIZE')) {
      const parts = raw.split(/\s+/);
      size = parseInt(parts[1], 10);
    } else if (raw.toUpperCase().startsWith('DOMAIN_MIN')) {
      const parts = raw.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3) domainMin = [parts[0], parts[1], parts[2]];
    } else if (raw.toUpperCase().startsWith('DOMAIN_MAX')) {
      const parts = raw.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3) domainMax = [parts[0], parts[1], parts[2]];
    } else {
      const parts = raw.split(/\s+/).map(Number);
      if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        rgbValues.push(parts[0], parts[1], parts[2], 1.0); // Pack RGBA
      }
    }
  }

  const numEntries = rgbValues.length / 4;
  if (size <= 0) {
    const computedSize = Math.round(Math.cbrt(numEntries));
    if (computedSize * computedSize * computedSize === numEntries && computedSize > 1) {
      size = computedSize;
    } else {
      throw new Error(`Invalid .cube file: size is missing or invalid (${numEntries} points parsed)`);
    }
  }

  if (numEntries !== size * size * size) {
    throw new Error(`LUT dimension mismatch: expected ${size * size * size} entries, found ${numEntries}`);
  }

  return {
    title,
    size,
    domainMin,
    domainMax,
    data: new Float32Array(rgbValues),
  };
}

/**
 * Creates an identity 3D LUT (e.g. 17x17x17) where output == input
 */
export function createIdentityLUT(size: number = 17): CubeLUT {
  const data = new Float32Array(size * size * size * 4);
  let idx = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[idx++] = r / (size - 1);
        data[idx++] = g / (size - 1);
        data[idx++] = b / (size - 1);
        data[idx++] = 1.0;
      }
    }
  }

  return {
    title: 'Identity Passthrough',
    size,
    domainMin: [0.0, 0.0, 0.0],
    domainMax: [1.0, 1.0, 1.0],
    data,
  };
}

/**
 * Generates a high quality cinematic DJI D-Log to Rec.709 film look preset
 */
export function createCinematicPresetLUT(size: number = 17): CubeLUT {
  const data = new Float32Array(size * size * size * 4);
  let idx = 0;

  for (let b = 0; b < size; b++) {
    const bNorm = b / (size - 1);
    for (let g = 0; g < size; g++) {
      const gNorm = g / (size - 1);
      for (let r = 0; r < size; r++) {
        const rNorm = r / (size - 1);

        // Film S-curve with slight warm highlights and teal shadows
        const sCurve = (v: number) => Math.pow(v, 1.15) * (1.0 + 0.15 * Math.sin(v * Math.PI));
        let rOut = sCurve(rNorm) * 1.05;
        let gOut = sCurve(gNorm) * 1.00;
        let bOut = sCurve(bNorm) * 0.95;

        // Teal shadow tint
        const shadowMask = Math.max(0.0, 1.0 - (rNorm + gNorm + bNorm) / 1.5);
        bOut += 0.03 * shadowMask;
        gOut += 0.015 * shadowMask;

        // Warm highlight tint
        const hlMask = Math.max(0.0, ((rNorm + gNorm + bNorm) / 3.0 - 0.5) * 2.0);
        rOut += 0.04 * hlMask;
        gOut += 0.02 * hlMask;

        data[idx++] = Math.min(1.0, Math.max(0.0, rOut));
        data[idx++] = Math.min(1.0, Math.max(0.0, gOut));
        data[idx++] = Math.min(1.0, Math.max(0.0, bOut));
        data[idx++] = 1.0;
      }
    }
  }

  return {
    title: 'DJI D-Log Cinematic Film (Built-in)',
    size,
    domainMin: [0.0, 0.0, 0.0],
    domainMax: [1.0, 1.0, 1.0],
    data,
  };
}
