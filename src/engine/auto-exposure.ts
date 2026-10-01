/**
 * Vista HDR Auto Exposure Engine
 * Evaluative 360° spherical auto-exposure with Reinhard geometric log-average luminance,
 * cumulative distribution percentile clipping (rejecting dark noise & specular highlights),
 * configurable metering modes, and human visual system asymmetric temporal adaptation.
 */

export type AutoExposureMode = 'evaluative' | 'horizon' | 'viewport';

export interface AutoExposureConfig {
  /** Metering mode: 360° evaluative, ±30° horizon band, or viewport cone */
  mode: AutoExposureMode;
  /** Calibration target mid-gray reflectance (standard 18% = 0.18) */
  targetMidGray: number;
  /** User exposure compensation in EV (-5.0 to +5.0) */
  compensationEV: number;
  /** Minimum allowable exposure delta in EV */
  minEV: number;
  /** Maximum allowable exposure delta in EV */
  maxEV: number;
  /** Bottom CDF percentile to reject (sensor noise / crushed blacks, default 5%) */
  lowPercentile: number;
  /** Top CDF percentile to reject (sun specular spikes / hot pixels, default 98%) */
  highPercentile: number;
  /** Temporal adaptation half-life for brightening / pupil constriction (seconds) */
  temporalSpeedBright: number;
  /** Temporal adaptation half-life for darkening / rhodopsin adaptation (seconds) */
  temporalSpeedDark: number;
}

export const DEFAULT_AUTO_EXPOSURE_CONFIG: Readonly<AutoExposureConfig> = {
  mode: 'evaluative',
  targetMidGray: 0.18,
  compensationEV: 0.0,
  minEV: -5.0,
  maxEV: 5.0,
  lowPercentile: 0.05,
  highPercentile: 0.98,
  temporalSpeedBright: 0.4,
  temporalSpeedDark: 1.5,
};

/**
 * Maps a linear HDR radiance value to a histogram bin index [0, 255].
 * Uses the perceptual curve: mapped = clamp(log2(max(v, 0.0001) + 1.0) / 3.46, 0.0, 1.0)
 */
export function linearRadianceToBin(v: number): number {
  const mapped = Math.min(1.0, Math.max(0.0, Math.log2(Math.max(v, 0.0001) + 1.0) / 3.46));
  return Math.min(255, Math.max(0, Math.floor(mapped * 255.0)));
}

/**
 * Maps a 256-bin perceptual log luminance index back to linear HDR radiance.
 * Inverse of value_to_bin: v = exp2(mapped * 3.46) - 1.0
 */
export function binToLinearRadiance(binIndex: number): number {
  const clampedBin = Math.min(255, Math.max(0, binIndex));
  const mapped = Math.min(1.0, Math.max(0.0, (clampedBin + 0.5) / 255.0));
  return Math.max(0.0, Math.pow(2.0, mapped * 3.46) - 1.0);
}

export class AutoExposureEngine {
  private config: AutoExposureConfig;
  private currentEV: number = 0.0;

  constructor(config?: Partial<AutoExposureConfig>) {
    this.config = {
      ...DEFAULT_AUTO_EXPOSURE_CONFIG,
      ...config,
    };
  }

  /**
   * Calculates the Reinhard geometric log-average luminance from the histogram,
   * filtering out the bottom lowPercentile and top (1 - highPercentile) of the CDF.
   *
   * L_bar_w = exp( (sum w_i * ln(L_i + delta)) / sum w_i )
   */
  public calculateLogAverageLuminance(histogram: Uint32Array | number[]): number {
    const numBins = Math.min(256, histogram.length);
    let totalCount = 0;
    for (let i = 0; i < numBins; i++) {
      totalCount += histogram[i] || 0;
    }

    if (totalCount <= 0) {
      return this.config.targetMidGray;
    }

    const lowThreshold = totalCount * this.config.lowPercentile;
    const highThreshold = totalCount * this.config.highPercentile;
    const delta = 0.0001; // Small bias to prevent ln(0)

    let runningCount = 0;
    let sumWeightedLog = 0;
    let effectiveTotalWeight = 0;

    for (let i = 0; i < numBins; i++) {
      const binCount = histogram[i] || 0;
      if (binCount <= 0) continue;

      const binStart = runningCount;
      const binEnd = runningCount + binCount;
      runningCount = binEnd;

      // Overlap with [lowThreshold, highThreshold]
      const overlapStart = Math.max(binStart, lowThreshold);
      const overlapEnd = Math.min(binEnd, highThreshold);
      const weight = Math.max(0, overlapEnd - overlapStart);

      if (weight > 0) {
        const L_i = binToLinearRadiance(i);
        sumWeightedLog += weight * Math.log(L_i + delta);
        effectiveTotalWeight += weight;
      }
    }

    // Fallback if percentile thresholds filtered all counts (e.g. invalid percentiles)
    if (effectiveTotalWeight <= 0) {
      for (let i = 0; i < numBins; i++) {
        const count = histogram[i] || 0;
        if (count > 0) {
          const L_i = binToLinearRadiance(i);
          sumWeightedLog += count * Math.log(L_i + delta);
          effectiveTotalWeight += count;
        }
      }
    }

    if (effectiveTotalWeight <= 0) {
      return this.config.targetMidGray;
    }

    return Math.exp(sumWeightedLog / effectiveTotalWeight);
  }

  /**
   * Calculates the target optimal exposure EV from the histogram:
   * deltaEV = log2( (targetMidGray * 2^compensationEV) / L_bar_w )
   * Clamped to [minEV, maxEV].
   */
  public calculateTargetEV(histogram: Uint32Array | number[]): number {
    const logAvgLuma = this.calculateLogAverageLuminance(histogram);
    const targetLuma = this.config.targetMidGray * Math.pow(2.0, this.config.compensationEV);
    const rawDeltaEV = Math.log2(targetLuma / Math.max(1e-6, logAvgLuma));

    return Math.max(this.config.minEV, Math.min(this.config.maxEV, rawDeltaEV));
  }

  /**
   * Updates temporal exposure smoothing using an asymmetric exponential IIR filter:
   * currentEV += (targetEV - currentEV) * (1 - exp(-dt / tau))
   *
   * Fast pupil constriction (temporalSpeedBright) when targetEV < currentEV.
   * Slower dark adaptation (temporalSpeedDark) when targetEV > currentEV.
   */
  public updateTemporal(targetEV: number, dtSeconds: number, isContinuous: boolean = true): number {
    if (!isContinuous || dtSeconds <= 0) {
      this.currentEV = targetEV;
      return this.currentEV;
    }

    // Determine time constant based on adaptation direction:
    // targetEV < currentEV means scene got brighter (exposure drops / eye constricts)
    // targetEV > currentEV means scene got darker (exposure increases / eye dilates)
    const tau = targetEV < this.currentEV
      ? this.config.temporalSpeedBright
      : this.config.temporalSpeedDark;

    if (tau <= 0) {
      this.currentEV = targetEV;
      return this.currentEV;
    }

    const alpha = 1.0 - Math.exp(-dtSeconds / tau);
    this.currentEV += (targetEV - this.currentEV) * alpha;

    // Guard against floating point drift beyond bounds
    this.currentEV = Math.max(this.config.minEV, Math.min(this.config.maxEV, this.currentEV));

    return this.currentEV;
  }

  /**
   * Single-step update: calculates target EV from histogram and applies temporal smoothing
   */
  public update(histogram: Uint32Array | number[], dtSeconds: number, isContinuous: boolean = true): number {
    const targetEV = this.calculateTargetEV(histogram);
    return this.updateTemporal(targetEV, dtSeconds, isContinuous);
  }

  /**
   * Resets the current exposure value
   */
  public reset(ev: number = 0.0): void {
    this.currentEV = Math.max(this.config.minEV, Math.min(this.config.maxEV, ev));
  }

  /**
   * Sets exposure compensation in EV [-5.0, +5.0]
   */
  public setCompensation(ev: number): void {
    this.config.compensationEV = Math.max(-5.0, Math.min(5.0, ev));
  }

  /**
   * Sets metering mode ('evaluative' | 'horizon' | 'viewport')
   */
  public setMode(mode: AutoExposureMode): void {
    this.config.mode = mode;
  }

  /**
   * Returns current configuration
   */
  public getConfig(): AutoExposureConfig {
    return { ...this.config };
  }

  /**
   * Updates partial configuration parameters
   */
  public setConfig(config: Partial<AutoExposureConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Returns current smoothed EV value
   */
  public getCurrentEV(): number {
    return this.currentEV;
  }
}
