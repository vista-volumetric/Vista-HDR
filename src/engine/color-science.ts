/**
 * Vista HDR Color Science Module
 * Precision color space transforms, inverse transfer functions, and radiometric conversions.
 */

export interface ColorGradingParams {
  exposure: number;       // In stops, e.g. -5.0 to +5.0 (gain = 2^exposure)
  temperature: number;    // Kelvin: 2000K to 12000K, default 6500K
  tint: number;           // Green (-100) to Magenta (+100), default 0
  highlights: number;     // Highlight recovery/compression: -1.0 to 1.0, default 0
  shadows: number;        // Shadow lift: -1.0 to 1.0, default 0
  contrast: number;       // Mid-gray pivot contrast: 0.5 to 2.0, default 1.0
  saturation: number;     // 0.0 (monochrome) to 2.0 (vibrant), default 1.0
  inputLogType: 'dlog' | 'dlog_m' | 'linear' | 'srgb';
}

export const DEFAULT_GRADING_PARAMS: ColorGradingParams = {
  exposure: 0.0,
  temperature: 6500,
  tint: 0.0,
  highlights: 0.0,
  shadows: 0.0,
  contrast: 1.0,
  saturation: 1.0,
  inputLogType: 'dlog',
};

/**
 * Official DJI D-Log Inverse Transfer Function (D-Log to Radiometric Linear)
 * Based on DJI D-Log White Paper specifications.
 * 
 * @param x Normalized D-Log code value [0.0, 1.0] (e.g. 10-bit raw / 1023.0)
 * @returns 32-bit linear radiometric reflectance value
 */
export function dlogToLinear(x: number): number {
  if (x <= 0.14) {
    return (x - 0.0929) / 6.025;
  }
  // Formula: (10^((x - 0.584555) / 0.256663) - 0.0108) / 0.9892
  // Note: 1 / 0.256663 = 3.8961609f, 0.584555 / 0.256663 = 2.277520f
  const exponent = (x - 0.584555) / 0.256663;
  return (Math.pow(10.0, exponent) - 0.0108) / 0.9892;
}

/**
 * Official DJI D-Log Forward Transfer Function (Linear to D-Log)
 * Based on DJI D-Log White Paper specifications.
 * 
 * @param y Linear radiometric value
 * @returns Normalized D-Log code value [0.0, 1.0]
 */
export function linearToDLog(y: number): number {
  if (y <= 0.0078) {
    return 6.025 * y + 0.0929;
  }
  return Math.log10(y * 0.9892 + 0.0108) * 0.256663 + 0.584555;
}

/**
 * Calibrated DJI D-Log M Inverse Transfer Function (D-Log M to Radiometric Linear)
 * Derived from sensor profiling and calibrated regression models.
 * Maps normalized D-Log M code values [0.0, 1.0] to linear scene radiometric values.
 * 
 * @param x Normalized D-Log M code value [0.0, 1.0]
 * @returns 32-bit linear radiometric reflectance value
 */
export function dlogMToLinear(x: number): number {
  const x_shift = -2.4300594329833984;
  const y_shift = 0.9523495435714722;
  const scale = 5.403507709503174;
  const slope = 0.9165859222412109;
  const slope2 = 1.7669587135314941;
  const intercept = 0.44757312536239624;
  const cut = 0.5263257622718811;
  const mid_gray_scaling = 0.016361355781555176;

  const tmp = Math.pow(2.0, x * scale + y_shift) + x_shift;
  let out: number;
  if (tmp < cut) {
    out = tmp * slope + intercept;
  } else {
    out = tmp * slope2;
  }
  out *= mid_gray_scaling;
  return Math.max(0.0, out);
}

/**
 * Compute Planckian Locus Correlated Color Temperature chromaticity coordinates (CIE 1931 xy)
 * Analytic approximation based on Kang et al. / Krystek.
 * 
 * @param kelvin Color temperature in Kelvin (1667K to 25000K)
 * @returns [x, y] CIE chromaticity coordinates
 */
export function kelvinToCIE1931xy(kelvin: number): [number, number] {
  const T = Math.min(25000, Math.max(1667, kelvin));
  let x: number;
  if (T <= 4000) {
    x = -0.2661239 * 1e9 / (T * T * T) - 0.2343580 * 1e6 / (T * T) + 0.8776956 * 1e3 / T + 0.179910;
  } else {
    x = -3.0258469 * 1e9 / (T * T * T) + 2.1070379 * 1e6 / (T * T) + 0.2226347 * 1e3 / T + 0.240390;
  }

  let y: number;
  if (T <= 4000) {
    y = -1.1063814 * (x * x * x) - 1.34811020 * (x * x) + 2.18555832 * x - 0.20219683;
  } else {
    // Standard CIE Daylight / Planckian locus equation (CIE 15:2004)
    y = -3.000 * (x * x) + 2.870 * x - 0.275;
  }

  return [x, y];
}

/**
 * Calculates RGB gain multipliers for Kelvin temperature and Green-Magenta tint
 * using chromatic adaptation relative to standard D65 (6504K).
 * 
 * @param kelvin Temperature in Kelvin (2000 - 12000K)
 * @param tint Tint in range [-100, 100] (negative = green, positive = magenta)
 * @returns [rGain, gGain, bGain]
 */
export function calculateWhiteBalanceGains(kelvin: number, tint: number = 0.0): [number, number, number] {
  // Approximate RGB multipliers relative to D65
  // For warm (low K), we need more blue / less red to neutralize, or for rendering:
  // Warmer scene = increase red gain, decrease blue gain.
  // We model the standard photographic white-balance transform:
  const [x_t, y_t] = kelvinToCIE1931xy(kelvin);
  const [x_d65, y_d65] = kelvinToCIE1931xy(6504);

  // Convert (x, y) to XYZ with Y=1
  const X_t = x_t / y_t;
  const Y_t = 1.0;
  const Z_t = (1.0 - x_t - y_t) / y_t;

  const X_ref = x_d65 / y_d65;
  const Y_ref = 1.0;
  const Z_ref = (1.0 - x_d65 - y_d65) / y_d65;

  // Bradford CAT cone response matrix
  // [ Ma ] * [ X, Y, Z ]
  const Ma = [
    0.8951,  0.2664, -0.1614,
   -0.7502,  1.7135,  0.0367,
    0.0389, -0.0685,  1.0296,
  ];

  const R_t = Ma[0]*X_t + Ma[1]*Y_t + Ma[2]*Z_t;
  const G_t = Ma[3]*X_t + Ma[4]*Y_t + Ma[5]*Z_t;
  const B_t = Ma[6]*X_t + Ma[7]*Y_t + Ma[8]*Z_t;

  const R_ref = Ma[0]*X_ref + Ma[1]*Y_ref + Ma[2]*Z_ref;
  const G_ref = Ma[3]*X_ref + Ma[4]*Y_ref + Ma[5]*Z_ref;
  const B_ref = Ma[6]*X_ref + Ma[7]*Y_ref + Ma[8]*Z_ref;

  // White balance correction factor (relative to reference D65)
  // When kelvin > 6500 (cool), we warm it up by raising red and lowering blue
  // When kelvin < 6500 (warm), we cool it down by raising blue and lowering red
  let rGain = (R_ref / R_t);
  let gGain = (G_ref / G_t);
  let bGain = (B_ref / B_t);

  // Apply tint along Green-Magenta axis
  // Tint > 0 adds Magenta (boosts R and B, lowers G)
  // Tint < 0 adds Green (boosts G, lowers R and B)
  const tintFactor = tint / 100.0;
  const tintR = 1.0 + 0.18 * tintFactor;
  const tintG = 1.0 - 0.36 * tintFactor;
  const tintB = 1.0 + 0.18 * tintFactor;

  rGain *= tintR;
  gGain *= tintG;
  bGain *= tintB;

  // Normalize so Green gain is roughly 1.0 for luminance stability
  rGain /= gGain;
  bGain /= gGain;
  gGain = 1.0;

  return [rGain, gGain, bGain];
}

/**
 * ACES Filmic Tone Mapping curve
 * Maps arbitrary HDR linear values [0, Inf) into SDR [0, 1] range.
 */
export function acesFilmicToneMapping(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return Math.min(1.0, Math.max(0.0, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

/**
 * Standard IEC 61966-2-1 sRGB EOTF (linear to sRGB gamma)
 */
export function linearToSRGB(linear: number): number {
  if (linear <= 0.0031308) {
    return Math.max(0.0, linear * 12.92);
  }
  return 1.055 * Math.pow(Math.max(0.0, linear), 1.0 / 2.4) - 0.055;
}

/**
 * Standard IEC 61966-2-1 sRGB Inverse EOTF (sRGB gamma to linear)
 */
export function sRGBToLinear(srgb: number): number {
  if (srgb <= 0.04045) {
    return Math.max(0.0, srgb / 12.92);
  }
  return Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/**
 * Full CPU reference evaluation of color grading pipeline
 * Matches the WebGPU WGSL shader pipeline identically.
 */
export function gradePixelCPU(
  rgb: [number, number, number],
  params: ColorGradingParams
): [number, number, number] {
  let [r, g, b] = rgb;

  // 1. Inverse transfer function (Log to Radiometric Linear)
  if (params.inputLogType === 'dlog') {
    r = dlogToLinear(r);
    g = dlogToLinear(g);
    b = dlogToLinear(b);
  } else if (params.inputLogType === 'dlog_m') {
    r = dlogMToLinear(r);
    g = dlogMToLinear(g);
    b = dlogMToLinear(b);
  } else if (params.inputLogType === 'srgb') {
    r = sRGBToLinear(r);
    g = sRGBToLinear(g);
    b = sRGBToLinear(b);
  }

  // 2. Exposure adjustment (2^exposure)
  const exposureGain = Math.pow(2.0, params.exposure);
  r *= exposureGain;
  g *= exposureGain;
  b *= exposureGain;

  // 3. White Balance (Kelvin & Tint)
  const [wbR, wbG, wbB] = calculateWhiteBalanceGains(params.temperature, params.tint);
  r *= wbR;
  g *= wbG;
  b *= wbB;

  // 4. Shadow Lift & Highlight Recovery
  // Rec.709 luminance weights
  let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  if (params.shadows !== 0.0) {
    // Lift shadows smoothly below 0.38
    const shadowWeight = Math.max(0.0, 1.0 - Math.min(1.0, luma / 0.38));
    const lift = params.shadows * 0.2 * (shadowWeight * shadowWeight);
    r += lift;
    g += lift;
    b += lift;
  }

  if (params.highlights !== 0.0) {
    // Compress / recover highlights above 0.5
    const hlWeight = Math.max(0.0, Math.min(1.0, (luma - 0.5) / 1.5));
    const factor = 1.0 + params.highlights * 0.5 * hlWeight;
    r *= factor;
    g *= factor;
    b *= factor;
  }

  // 5. Contrast around mid-gray pivot (0.18)
  if (params.contrast !== 1.0) {
    const pivot = 0.18;
    const eps = 1e-6;
    r = Math.max(0.0, r);
    g = Math.max(0.0, g);
    b = Math.max(0.0, b);
    r = Math.pow(r / pivot + eps, params.contrast) * pivot;
    g = Math.pow(g / pivot + eps, params.contrast) * pivot;
    b = Math.pow(b / pivot + eps, params.contrast) * pivot;
  }

  // 6. Saturation
  if (params.saturation !== 1.0) {
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + params.saturation * (r - luma);
    g = luma + params.saturation * (g - luma);
    b = luma + params.saturation * (b - luma);
  }

  return [Math.max(0.0, r), Math.max(0.0, g), Math.max(0.0, b)];
}

/**
 * Solves for White Balance Kelvin temperature [2500, 10000] and Tint [-50, +50]
 * matching the target R/B gain ratio and G/Mid gain ratio.
 */
export function solveWhiteBalance(
  targetRatioRB: number,
  targetRatioGMid: number
): { temperature: number; tint: number } {
  // 1. Monotonic binary search for Kelvin in [2500, 10000]
  // In calculateWhiteBalanceGains: rGain / bGain strictly increases with Kelvin
  let lowK = 2500;
  let highK = 10000;
  let bestK = 6500;

  const [rMin, , bMin] = calculateWhiteBalanceGains(2500, 0);
  const ratioMin = rMin / Math.max(1e-6, bMin);
  const [rMax, , bMax] = calculateWhiteBalanceGains(10000, 0);
  const ratioMax = rMax / Math.max(1e-6, bMax);

  if (targetRatioRB <= ratioMin) {
    bestK = 2500;
  } else if (targetRatioRB >= ratioMax) {
    bestK = 10000;
  } else {
    for (let iter = 0; iter < 24; iter++) {
      const midK = (lowK + highK) * 0.5;
      const [r, , b] = calculateWhiteBalanceGains(midK, 0);
      const ratio = r / Math.max(1e-6, b);
      if (ratio < targetRatioRB) {
        lowK = midK;
      } else {
        highK = midK;
      }
      bestK = midK;
    }
  }

  // 2. Monotonic binary search for Tint in [-50, 50]
  // In calculateWhiteBalanceGains: positive tint decreases green gain (adds magenta),
  // negative tint increases green gain (adds green).
  let lowTint = -50;
  let highTint = 50;
  let bestTint = 0;

  for (let iter = 0; iter < 20; iter++) {
    const midTint = (lowTint + highTint) * 0.5;
    const [r, g, b] = calculateWhiteBalanceGains(bestK, midTint);
    const appliedGMidRatio = (2.0 * g) / Math.max(1e-6, r + b);
    if (appliedGMidRatio > targetRatioGMid) {
      lowTint = midTint;
    } else {
      highTint = midTint;
    }
    bestTint = midTint;
  }

  const temperature = Math.round(Math.max(2500, Math.min(10000, bestK)));
  const tint = Math.round(Math.max(-50, Math.min(50, bestTint)) * 10) / 10;
  return { temperature, tint };
}

/**
 * Calculates Auto White Balance Kelvin and Tint using Gray-World assumption
 * over input channel histograms.
 * 
 * If Red > Blue (warm cast), decreases temperature (cooler Kelvin) to compensate.
 * If Blue > Red (cool cast), increases temperature (warmer Kelvin) to compensate.
 * 
 * @param rHist Red channel histogram (256 bins)
 * @param gHist Green channel histogram (256 bins)
 * @param bHist Blue channel histogram (256 bins)
 * @param currentTemp Current active temperature (Kelvin)
 * @param currentTint Current active tint (-50 to +50)
 * @returns Balanced { temperature, tint } within [2500, 10000] K and [-50, +50] Tint
 */
export function calculateAutoWhiteBalance(
  rHist: Uint32Array | number[],
  gHist: Uint32Array | number[],
  bHist: Uint32Array | number[],
  currentTemp: number = 6500,
  currentTint: number = 0.0
): { temperature: number; tint: number } {
  let rSum = 0, gSum = 0, bSum = 0;
  let rWeighted = 0, gWeighted = 0, bWeighted = 0;

  const binCount = Math.min(rHist.length, gHist.length, bHist.length, 256);
  for (let i = 0; i < binCount; i++) {
    const rVal = rHist[i] || 0;
    const gVal = gHist[i] || 0;
    const bVal = bHist[i] || 0;

    rWeighted += i * rVal;
    rSum += rVal;

    gWeighted += i * gVal;
    gSum += gVal;

    bWeighted += i * bVal;
    bSum += bVal;
  }

  const meanR = rSum > 0 ? rWeighted / rSum : 128;
  const meanG = gSum > 0 ? gWeighted / gSum : 128;
  const meanB = bSum > 0 ? bWeighted / bSum : 128;

  // Current active gains
  const [currR, currG, currB] = calculateWhiteBalanceGains(currentTemp, currentTint);

  // Gray-World target reciprocal gain
  const targetR = currR / Math.max(1e-4, meanR);
  const targetG = currG / Math.max(1e-4, meanG);
  const targetB = currB / Math.max(1e-4, meanB);

  const targetRatioRB = targetR / Math.max(1e-6, targetB);
  const targetRatioGMid = (2.0 * targetG) / Math.max(1e-6, targetR + targetB);

  return solveWhiteBalance(targetRatioRB, targetRatioGMid);
}

/**
 * Calculates Kelvin temperature and Tint neutralization from an eyedropper-picked pixel.
 * Calculates reciprocal gain adjustments to bring R, G, B into balance.
 * 
 * @param pickedR Picked red value [0, 1] or raw
 * @param pickedG Picked green value [0, 1] or raw
 * @param pickedB Picked blue value [0, 1] or raw
 * @param currentTemp Current active temperature (Kelvin)
 * @param currentTint Current active tint (-50 to +50)
 * @returns Balanced { temperature, tint } within [2500, 10000] K and [-50, +50] Tint
 */
export function calculateEyedropperBalance(
  pickedR: number,
  pickedG: number,
  pickedB: number,
  currentTemp: number = 6500,
  currentTint: number = 0.0
): { temperature: number; tint: number } {
  const [currR, currG, currB] = calculateWhiteBalanceGains(currentTemp, currentTint);

  // Un-white-balanced raw pixel values
  const r0 = Math.max(1e-5, pickedR / currR);
  const g0 = Math.max(1e-5, pickedG / currG);
  const b0 = Math.max(1e-5, pickedB / currB);

  // Rec.709 luminance target Y = 0.2126*R + 0.7152*G + 0.0722*B
  const lumaY = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;

  // Reciprocal gain adjustments: R_gain = Y / R, G_gain = Y / G, B_gain = Y / B
  const rGain = lumaY / r0;
  const gGain = lumaY / g0;
  const bGain = lumaY / b0;

  const targetRatioRB = rGain / Math.max(1e-6, bGain);
  const targetRatioGMid = (2.0 * gGain) / Math.max(1e-6, rGain + bGain);

  return solveWhiteBalance(targetRatioRB, targetRatioGMid);
}

/**
 * ARRI / RED Standardized False Color Palette
 */
export interface FalseColorBand {
  min: number;
  max: number;
  color: [number, number, number];
  name: string;
  description: string;
}

export const FALSE_COLOR_PALETTE: FalseColorBand[] = [
  { min: 0.0, max: 0.02, color: [0.5, 0.0, 0.7], name: 'purple', description: 'Crushed Blacks (< 2%)' },
  { min: 0.02, max: 0.10, color: [0.0, 0.2, 0.8], name: 'blue', description: 'Shadows (2-10%)' },
  { min: 0.10, max: 0.14, color: [0.0, 0.7, 0.8], name: 'cyan', description: 'Shadow Mid (10-14%)' },
  { min: 0.14, max: 0.22, color: [0.0, 0.85, 0.2], name: 'green', description: '18% Calibrated Mid-Gray (14-22%)' },
  { min: 0.22, max: 0.35, color: [0.5, 0.5, 0.5], name: 'gray', description: 'Neutral Mid-Tones (22-35%)' },
  { min: 0.35, max: 0.45, color: [0.9, 0.4, 0.6], name: 'pink', description: 'Skin Tones (35-45%)' },
  { min: 0.45, max: 0.70, color: [0.6, 0.9, 0.4], name: 'light_green', description: 'Upper Mids (45-70%)' },
  { min: 0.70, max: 0.90, color: [0.95, 0.9, 0.1], name: 'yellow', description: 'Diffuse Highlight (70-90%)' },
  { min: 0.90, max: 0.98, color: [0.95, 0.5, 0.0], name: 'orange', description: 'Near Clip Warning (90-98%)' },
  { min: 0.98, max: Infinity, color: [0.95, 0.05, 0.05], name: 'red', description: 'Blown Clip (>= 98%)' },
];

/**
 * Returns the standardized False Color RGB triple for a given luminance level [0, 1].
 */
export function getFalseColor(luma: number): [number, number, number] {
  if (luma < 0.02) return [0.5, 0.0, 0.7];       // Purple
  if (luma < 0.10) return [0.0, 0.2, 0.8];       // Deep Blue
  if (luma < 0.14) return [0.0, 0.7, 0.8];       // Cyan
  if (luma < 0.22) return [0.0, 0.85, 0.2];      // Green (18% mid-gray)
  if (luma < 0.35) return [0.5, 0.5, 0.5];       // Gray
  if (luma < 0.45) return [0.9, 0.4, 0.6];       // Pink (Skin tones)
  if (luma < 0.70) return [0.6, 0.9, 0.4];       // Light Green
  if (luma < 0.90) return [0.95, 0.9, 0.1];      // Yellow
  if (luma < 0.98) return [0.95, 0.5, 0.0];      // Orange
  return [0.95, 0.05, 0.05];                     // Red
}

/**
 * Computes mirrored Y coordinate for 360° nadir mask patch
 */
export function calculateNadirMirrorCoord(y: number, height: number, radius: number): number {
  const boundaryY = Math.round(height * (1.0 - radius));
  if (y < boundaryY) return y;
  const mirrored = boundaryY - (y - boundaryY);
  return Math.max(0, Math.min(height - 1, mirrored));
}

/**
 * Computes equirectangular spherical latitude in radians from image coordinate Y and height.
 * Top (y=0) = +pi/2 (zenith sky), equator = 0, bottom (y=height-1) = -pi/2 (nadir ground).
 */
export function calculateLatitude(y: number, height: number): number {
  return (0.5 - (y + 0.5) / height) * Math.PI;
}

/**
 * Smoothstep interpolation function [0.0, 1.0] matching WGSL smoothstep
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Computes sky transition weight for 360° Graduated Neutral Density filter and Polarizer
 */
export function calculateSkyWeight(
  lat: number,
  horizonOffset: number = 0.0,
  feather: number = 0.26
): number {
  return smoothstep(horizonOffset - feather, horizonOffset + feather, lat);
}

/**
 * Applies 360° Graduated Neutral Density (GND) filter attenuation
 * Attenuates sky by 2^(gndExposure * skyWeight)
 */
export function applyGraduatedND(
  color: [number, number, number],
  gndExposure: number,
  skyWeight: number
): [number, number, number] {
  const factor = Math.pow(2.0, gndExposure * skyWeight);
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

/**
 * Applies 360° Sky Polarizer filter
 * Selectively boosts blue saturation and deepens sky luminance
 */
export function applySkyPolarizer(
  color: [number, number, number],
  polarizerIntensity: number,
  skyWeight: number
): [number, number, number] {
  const polDarken = 1.0 - polarizerIntensity * skyWeight * 0.3;
  const blueExcess = Math.max(color[2] - Math.max(color[0], color[1]), 0.0);
  const boostedB = color[2] * (1.0 + polarizerIntensity * skyWeight * blueExcess * 1.5);
  return [
    color[0] * polDarken,
    color[1] * polDarken,
    boostedB * polDarken,
  ];
}

/**
 * Combined 360° Optical Filters application matching WGSL compute shader
 */
export function applyOpticalFilters(
  color: [number, number, number],
  lat: number,
  options: {
    gndExposure?: number;
    gndHorizonOffset?: number;
    gndFeather?: number;
    skyPolarizer?: number;
  }
): [number, number, number] {
  const gndExposure = options.gndExposure ?? 0.0;
  const horizonOffset = options.gndHorizonOffset ?? 0.0;
  const feather = options.gndFeather ?? 0.26;
  const skyPolarizer = options.skyPolarizer ?? 0.0;

  const skyWeight = calculateSkyWeight(lat, horizonOffset, feather);
  const gndColor = applyGraduatedND(color, gndExposure, skyWeight);
  return applySkyPolarizer(gndColor, skyPolarizer, skyWeight);
}
