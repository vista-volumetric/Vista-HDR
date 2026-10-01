/**
 * Vista HDR WGSL Shaders
 * Real-time WebGPU compute shaders for color grading, 3D LUT evaluation,
 * and parallel histogram calculation, plus render shaders for display tone-mapping.
 */

export const colorGradingComputeWGSL = /* wgsl */ `
struct GradingUniforms {
  exposureGain: f32,
  wbR: f32,
  wbG: f32,
  wbB: f32,
  highlights: f32,
  shadows: f32,
  contrast: f32,
  saturation: f32,
  inputLogType: u32, // 0 = dlog, 1 = dlog_m, 2 = linear, 3 = srgb
  width: u32,
  height: u32,
  hasLut: u32,       // 0 = disabled, 1 = active
  lutStrength: f32,  // 0.0 to 1.0
  lutSize: f32,      // e.g. 17.0, 33.0, 65.0
  nadirMode: u32,    // 0 = off, 1 = mirror ground, 2 = vignette, 3 = logo plate
  nadirRadius: f32,  // in normalized latitude radians or texture Y fraction (default ~0.12)
  nadirFeather: f32, // edge smoothing fraction (default ~0.04)
  gndExposure: f32,       // Sky EV offset (-4.0 to +2.0)
  gndHorizonOffset: f32,  // Lat pivot in radians (-0.52 to +0.52 / ±30°)
  gndFeather: f32,        // Softness in radians (0.08 to 0.78 / 5° to 45°)
  skyPolarizer: f32,      // Polarizer intensity (0.0 to 1.0)
  _padding1: f32,
  _padding2: f32,
  _padding3: f32,
};

@group(0) @binding(0) var<uniform> uniforms: GradingUniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var lutTexture: texture_3d<f32>;

// Official DJI D-Log Inverse Transfer Function
fn dlog_to_linear(x: f32) -> f32 {
  if (x <= 0.14) {
    return (x - 0.0929) / 6.025;
  }
  let exponent = (x - 0.584555) / 0.256663;
  return (pow(10.0, exponent) - 0.0108) / 0.9892;
}

// Calibrated DJI D-Log M Inverse Transfer Function
fn dlog_m_to_linear(x: f32) -> f32 {
  let x_shift: f32 = -2.43005943;
  let y_shift: f32 = 0.95234954;
  let scale: f32 = 5.40350771;
  let slope: f32 = 0.91658592;
  let slope2: f32 = 1.76695871;
  let intercept: f32 = 0.44757313;
  let cut: f32 = 0.52632576;
  let mid_gray_scaling: f32 = 0.01636136;

  let tmp = pow(2.0, x * scale + y_shift) + x_shift;
  var out: f32;
  if (tmp < cut) {
    out = tmp * slope + intercept;
  } else {
    out = tmp * slope2;
  }
  return max(0.0, out * mid_gray_scaling);
}

// sRGB Inverse EOTF
fn srgb_to_linear(srgb: f32) -> f32 {
  if (srgb <= 0.04045) {
    return max(0.0, srgb / 12.92);
  }
  return pow((srgb + 0.055) / 1.055, 2.4);
}

// Trilinear 3D LUT sampling with hardware-portable textureLoad
fn sample_lut_3d(tex: texture_3d<f32>, coords: vec3<f32>, size: f32) -> vec3<f32> {
  let scaled = clamp(coords, vec3<f32>(0.0), vec3<f32>(1.0)) * (size - 1.0);
  let base = vec3<i32>(floor(scaled));
  let frac = fract(scaled);
  let next = min(base + vec3<i32>(1), vec3<i32>(i32(size) - 1));

  let c000 = textureLoad(tex, vec3<i32>(base.x, base.y, base.z), 0).rgb;
  let c100 = textureLoad(tex, vec3<i32>(next.x, base.y, base.z), 0).rgb;
  let c010 = textureLoad(tex, vec3<i32>(base.x, next.y, base.z), 0).rgb;
  let c110 = textureLoad(tex, vec3<i32>(next.x, next.y, base.z), 0).rgb;
  let c001 = textureLoad(tex, vec3<i32>(base.x, base.y, next.z), 0).rgb;
  let c101 = textureLoad(tex, vec3<i32>(next.x, base.y, next.z), 0).rgb;
  let c011 = textureLoad(tex, vec3<i32>(base.x, next.y, next.z), 0).rgb;
  let c111 = textureLoad(tex, vec3<i32>(next.x, next.y, next.z), 0).rgb;

  let c00 = mix(c000, c100, frac.x);
  let c10 = mix(c010, c110, frac.x);
  let c01 = mix(c001, c101, frac.x);
  let c11 = mix(c011, c111, frac.x);

  let c0 = mix(c00, c10, frac.y);
  let c1 = mix(c01, c11, frac.y);

  return mix(c0, c1, frac.z);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  if (global_id.x >= uniforms.width || global_id.y >= uniforms.height) {
    return;
  }

  var coords = vec2<i32>(global_id.xy);

  // 360° Nadir Mask & Tripod Patch
  let normY = f32(coords.y) / f32(uniforms.height);
  let startY = 1.0 - uniforms.nadirRadius;

  // Nadir Mode 1: Mirror Ground (reflect coordinate before texture sampling)
  if (uniforms.nadirMode == 1u && normY >= startY) {
    let y_boundary = i32(round(startY * f32(uniforms.height)));
    let mirroredY = clamp(y_boundary - (coords.y - y_boundary), 0, i32(uniforms.height) - 1);
    coords = vec2<i32>(coords.x, mirroredY);
  }

  let rawColor = textureLoad(inputTexture, coords, 0);

  var r = rawColor.r;
  var g = rawColor.g;
  var b = rawColor.b;
  let a = rawColor.a;

  // 1. Inverse Log / Transfer Function to Radiometric Linear
  if (uniforms.inputLogType == 0u) {
    r = dlog_to_linear(r);
    g = dlog_to_linear(g);
    b = dlog_to_linear(b);
  } else if (uniforms.inputLogType == 1u) {
    r = dlog_m_to_linear(r);
    g = dlog_m_to_linear(g);
    b = dlog_m_to_linear(b);
  } else if (uniforms.inputLogType == 3u) {
    r = srgb_to_linear(r);
    g = srgb_to_linear(g);
    b = srgb_to_linear(b);
  }

  // 2. Exposure adjustment (2^exposure)
  r *= uniforms.exposureGain;
  g *= uniforms.exposureGain;
  b *= uniforms.exposureGain;

  // 3. White Balance (Kelvin & Tint)
  r *= uniforms.wbR;
  g *= uniforms.wbG;
  b *= uniforms.wbB;

  // 4. Shadow Lift & Highlight Recovery
  var luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  if (uniforms.shadows != 0.0) {
    let shadowWeight = max(0.0, 1.0 - min(1.0, luma / 0.38));
    let lift = uniforms.shadows * 0.2 * (shadowWeight * shadowWeight);
    r += lift;
    g += lift;
    b += lift;
  }

  if (uniforms.highlights != 0.0) {
    let hlWeight = max(0.0, min(1.0, (luma - 0.5) / 1.5));
    let factor = 1.0 + uniforms.highlights * 0.5 * hlWeight;
    r *= factor;
    g *= factor;
    b *= factor;
  }

  // 5. Contrast around mid-gray pivot (0.18)
  if (uniforms.contrast != 1.0) {
    let pivot: f32 = 0.18;
    let eps: f32 = 0.000001;
    r = pow(max(0.0, r) / pivot + eps, uniforms.contrast) * pivot;
    g = pow(max(0.0, g) / pivot + eps, uniforms.contrast) * pivot;
    b = pow(max(0.0, b) / pivot + eps, uniforms.contrast) * pivot;
  }

  // 6. Saturation
  if (uniforms.saturation != 1.0) {
    luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + uniforms.saturation * (r - luma);
    g = luma + uniforms.saturation * (g - luma);
    b = luma + uniforms.saturation * (b - luma);
  }

  // 7. 3D LUT Application
  if (uniforms.hasLut == 1u) {
    let lutInput = clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
    let lutOutput = sample_lut_3d(lutTexture, lutInput, uniforms.lutSize);
    let blended = mix(vec3<f32>(r, g, b), lutOutput, uniforms.lutStrength);
    r = blended.r;
    g = blended.g;
    b = blended.b;
  }

  // 8. 360° Optical Filters: Graduated Neutral Density (GND) & Sky Polarizer
  var color = vec3<f32>(r, g, b);
  let lat = (0.5 - (f32(global_id.y) + 0.5) / f32(uniforms.height)) * 3.14159265;
  let skyWeight = smoothstep(uniforms.gndHorizonOffset - uniforms.gndFeather, uniforms.gndHorizonOffset + uniforms.gndFeather, lat);

  // Graduated ND attenuation
  color = color * pow(2.0, uniforms.gndExposure * skyWeight);

  // Sky Polarizer
  let polDarken = 1.0 - uniforms.skyPolarizer * skyWeight * 0.3;
  let blueExcess = max(color.b - max(color.r, color.g), 0.0);
  color.b = color.b * (1.0 + uniforms.skyPolarizer * skyWeight * blueExcess * 1.5);
  color = color * polDarken;

  r = color.r;
  g = color.g;
  b = color.b;

  // Nadir Mode 2: Vignette Fade (smoothstep falloff to pure dark)
  if (uniforms.nadirMode == 2u && normY >= (startY - uniforms.nadirFeather)) {
    let feather = max(0.0001, uniforms.nadirFeather);
    let fade = 1.0 - smoothstep(startY - feather, min(1.0, startY + feather), normY);
    r *= fade;
    g *= fade;
    b *= fade;
  }

  // Nadir Mode 3: Logo Plate (circular emblem plate with cyan concentric rings)
  if (uniforms.nadirMode == 3u) {
    let center = vec2<f32>(f32(uniforms.width) * 0.5, f32(uniforms.height));
    let dist = length(vec2<f32>(f32(global_id.x) - center.x, f32(global_id.y) - center.y));
    let maxRadius = uniforms.nadirRadius * f32(uniforms.height);
    let feather = max(1.0, uniforms.nadirFeather * f32(uniforms.height));
    if (dist <= maxRadius + feather) {
      let ring = sin(dist * 0.25);
      var emblemColor = vec3<f32>(0.05, 0.08, 0.12); // dark slate plate backing
      if (ring > 0.2) {
        emblemColor = mix(emblemColor, vec3<f32>(0.0, 0.85, 0.95), 0.9); // cyan concentric rings
      }
      let ring2 = sin(dist * 0.05);
      if (abs(ring2) < 0.15) {
        emblemColor = mix(emblemColor, vec3<f32>(0.9, 0.95, 1.0), 0.8); // bright accent
      }
      let blend = 1.0 - smoothstep(maxRadius - feather, maxRadius, dist);
      r = mix(r, emblemColor.r, blend);
      g = mix(g, emblemColor.g, blend);
      b = mix(b, emblemColor.b, blend);
    }
  }

  // Guard against non-finite or negative values
  let finalColor = vec4<f32>(max(0.0, r), max(0.0, g), max(0.0, b), a);
  textureStore(outputTexture, vec2<i32>(global_id.xy), finalColor);
}
`;

export const histogramComputeWGSL = /* wgsl */ `
struct HistUniforms {
  width: u32,
  height: u32,
  meteringMode: u32, // 0 = evaluative (cosine-latitude weighted), 1 = horizon band (±30°), 2 = directional
  _padding: u32,
  cameraDirection: vec4<f32>, // xyz = forward direction, w = cos(halfFov)
};

// Global histogram buffer: 1024 bins
// 0..255: Luminance, 256..511: Red, 512..767: Green, 768..1023: Blue
@group(0) @binding(0) var<uniform> uniforms: HistUniforms;
@group(0) @binding(1) var hdrTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> globalHistogram: array<atomic<u32>, 1024>;

// Workgroup shared memory for local bins (256 threads * 4 bins = 1024 entries)
var<workgroup> local_bins: array<atomic<u32>, 1024>;

// Tone mapper for histogram bin allocation (logarithmic / tonemapped distribution)
fn value_to_bin(v: f32) -> u32 {
  // Map linear HDR [0.0, 10.0+] into 0..255 using a perceptual log-like curve
  let mapped = clamp(log2(max(v, 0.0001) + 1.0) / 3.46, 0.0, 1.0);
  return clamp(u32(mapped * 255.0), 0u, 255u);
}

@compute @workgroup_size(16, 16)
fn main(
  @builtin(local_invocation_index) local_idx: u32,
  @builtin(global_invocation_id) global_id: vec3<u32>
) {
  // 1. Initialize workgroup shared bins (256 threads init 1024 entries, 4 per thread)
  atomicStore(&local_bins[local_idx * 4u + 0u], 0u);
  atomicStore(&local_bins[local_idx * 4u + 1u], 0u);
  atomicStore(&local_bins[local_idx * 4u + 2u], 0u);
  atomicStore(&local_bins[local_idx * 4u + 3u], 0u);

  workgroupBarrier();

  // 2. Accumulate pixel values into local shared histogram with solid-angle weighting
  if (global_id.x < uniforms.width && global_id.y < uniforms.height) {
    let lat = (0.5 - (f32(global_id.y) + 0.5) / f32(uniforms.height)) * 3.14159265;
    var latWeight = clamp(cos(lat), 0.05, 1.0);

    // Metering modes:
    // 0 = evaluative full sphere (cosine-latitude weighted)
    // 1 = horizon band ±30° latitude (abs(lat) <= 0.5236)
    // 2 = directional cone around camera direction
    if (uniforms.meteringMode == 1u) {
      if (abs(lat) > 0.5236) {
        latWeight = 0.0;
      }
    } else if (uniforms.meteringMode == 2u) {
      let lon = ((f32(global_id.x) + 0.5) / f32(uniforms.width) * 2.0 - 1.0) * 3.14159265;
      let pxDir = vec3<f32>(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
      var camDir = uniforms.cameraDirection.xyz;
      let camLen = length(camDir);
      if (camLen > 0.001) {
        camDir = camDir / camLen;
      } else {
        camDir = vec3<f32>(0.0, 0.0, -1.0);
      }
      var cosCone = uniforms.cameraDirection.w;
      if (cosCone <= 0.0) {
        cosCone = 0.7071; // default ~45° half-angle cone
      }
      if (dot(pxDir, camDir) < cosCone) {
        latWeight = 0.0;
      }
    }

    let weight = u32(round(latWeight * 100.0));

    if (weight > 0u) {
      let color = textureLoad(hdrTexture, vec2<i32>(global_id.xy), 0);
      let luma = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

      let binL = value_to_bin(luma);
      let binR = 256u + value_to_bin(color.r);
      let binG = 512u + value_to_bin(color.g);
      let binB = 768u + value_to_bin(color.b);

      atomicAdd(&local_bins[binL], weight);
      atomicAdd(&local_bins[binR], weight);
      atomicAdd(&local_bins[binG], weight);
      atomicAdd(&local_bins[binB], weight);
    }
  }

  workgroupBarrier();

  // 3. Atomically add workgroup bins to global histogram buffer
  for (var i: u32 = 0u; i < 4u; i = i + 1u) {
    let bin_idx = local_idx * 4u + i;
    let count = atomicLoad(&local_bins[bin_idx]);
    if (count > 0u) {
      atomicAdd(&globalHistogram[bin_idx], count);
    }
  }
}
`;

export const displayRenderWGSL = /* wgsl */ `
struct DisplayUniforms {
  toneMappingMode: u32,  // 0 = aces, 1 = reinhard, 2 = linear, 3 = clamp
  exposureOffset: f32,
  diagnosticMode: u32,   // 0 = normal, 1 = false_color, 2 = zebras
  zebraThreshold: f32,   // e.g. 0.95
  time: f32,
  wipeMode: u32,         // 0 = off, 1 = vertical_wipe, 2 = horizontal_wipe, 3 = bypass
  wipePosition: f32,     // 0.0 to 1.0 (default 0.5)
  showDividerLine: u32,  // 1 = show glowing line
};

@group(0) @binding(0) var<uniform> uniforms: DisplayUniforms;
@group(0) @binding(1) var hdrTexture: texture_2d<f32>;
@group(0) @binding(2) var textureSampler: sampler;
@group(0) @binding(3) var rawTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var output: VertexOutput;
  // Full-screen triangle covering [-1, 3] to [-1, -1]
  let x = f32((vertex_index << 1u) & 2u);
  let y = f32(vertex_index & 2u);
  output.uv = vec2<f32>(x, 1.0 - y);
  output.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  return output;
}

fn aces_filmic(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
  let low = c * 12.92;
  let high = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
  return select(high, low, c <= vec3<f32>(0.0031308));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Sample textures in uniform control flow to satisfy WGSL implicit derivative rules
  let rawColor = textureSample(rawTexture, textureSampler, input.uv).rgb;
  let rawHDR = textureSample(hdrTexture, textureSampler, input.uv).rgb;

  var isRaw: bool = false;
  var isDivider: bool = false;

  if (uniforms.wipeMode == 1u) {
    isRaw = input.uv.x < uniforms.wipePosition;
    isDivider = uniforms.showDividerLine == 1u && abs(input.uv.x - uniforms.wipePosition) < 0.002;
  } else if (uniforms.wipeMode == 2u) {
    isRaw = input.uv.y < uniforms.wipePosition;
    isDivider = uniforms.showDividerLine == 1u && abs(input.uv.y - uniforms.wipePosition) < 0.002;
  } else if (uniforms.wipeMode == 3u) {
    isRaw = true;
    isDivider = false;
  } else {
    isRaw = false;
    isDivider = false;
  }

  if (isDivider) {
    return vec4<f32>(0.06, 0.75, 0.9, 1.0);
  }

  if (isRaw) {
    return vec4<f32>(rawColor, 1.0);
  }

  var color = rawHDR * pow(2.0, uniforms.exposureOffset);

  if (uniforms.toneMappingMode == 0u) {
    color = aces_filmic(color);
  } else if (uniforms.toneMappingMode == 1u) {
    color = color / (color + vec3<f32>(1.0));
  } else if (uniforms.toneMappingMode == 3u) {
    color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  }

  // Diagnostic Modes
  if (uniforms.diagnosticMode == 1u) {
    // False Color (ARRI/RED standardized False Color palette)
    let y = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    var fc = vec3<f32>(0.5, 0.5, 0.5);
    if (y < 0.02) {
      fc = vec3<f32>(0.5, 0.0, 0.7); // Purple (crushed blacks)
    } else if (y < 0.10) {
      fc = vec3<f32>(0.0, 0.2, 0.8); // Deep Blue (shadows)
    } else if (y < 0.14) {
      fc = vec3<f32>(0.0, 0.7, 0.8); // Cyan (shadow mid)
    } else if (y < 0.22) {
      fc = vec3<f32>(0.0, 0.85, 0.2); // Green (18% calibrated mid-gray!)
    } else if (y < 0.35) {
      fc = vec3<f32>(0.5, 0.5, 0.5); // Gray (neutral mid-tones)
    } else if (y < 0.45) {
      fc = vec3<f32>(0.9, 0.4, 0.6); // Pink (skin tones)
    } else if (y < 0.70) {
      fc = vec3<f32>(0.6, 0.9, 0.4); // Light Green (upper mids)
    } else if (y < 0.90) {
      fc = vec3<f32>(0.95, 0.9, 0.1); // Yellow (diffuse highlight)
    } else if (y < 0.98) {
      fc = vec3<f32>(0.95, 0.5, 0.0); // Orange (near clip warning)
    } else {
      fc = vec3<f32>(0.95, 0.05, 0.05); // Red (blown clip)
    }
    return vec4<f32>(fc, 1.0);
  } else if (uniforms.diagnosticMode == 2u) {
    // Zebras
    let y = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
    if (y >= uniforms.zebraThreshold) {
      let hash = sin((input.position.x + input.position.y + uniforms.time * 60.0) * 0.3);
      if (hash > 0.0) {
        return vec4<f32>(1.0, 1.0, 1.0, 1.0);
      } else {
        return vec4<f32>(0.1, 0.1, 0.1, 1.0);
      }
    }
  }

  let finalSDR = linear_to_srgb(color);
  return vec4<f32>(finalSDR, 1.0);
}
`;
