/**
 * Vista HDR WebGPU Engine
 * Hardware-accelerated 32-bit radiometric HDR processing, log inversion,
 * 3D LUT evaluation, color grading, and parallel histogram computation.
 */

import {
  ColorGradingParams,
  DEFAULT_GRADING_PARAMS,
  calculateWhiteBalanceGains,
} from './color-science.js';
import {
  colorGradingComputeWGSL,
  histogramComputeWGSL,
  displayRenderWGSL,
} from './shaders.js';
import { CubeLUT } from './lut-parser.js';
import {
  AutoExposureEngine,
  AutoExposureConfig,
  AutoExposureMode,
} from './auto-exposure.js';

export interface WebGPUCapabilities {
  adapterName: string;
  hasRGBA32Float: boolean;
  hasFloat32Filterable: boolean;
  hasShaderF16: boolean;
  maxTextureDimension2D: number;
}

export interface HistogramResult {
  luma: Uint32Array;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
}

export class WebGPUEngine {
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private presentationFormat: GPUTextureFormat = 'bgra8unorm';

  // Capabilities
  public capabilities: WebGPUCapabilities = {
    adapterName: 'Unknown',
    hasRGBA32Float: false,
    hasFloat32Filterable: false,
    hasShaderF16: false,
    maxTextureDimension2D: 8192,
  };

  // Textures
  private inputTexture: GPUTexture | null = null;
  private hdrTexture: GPUTexture | null = null;
  private dummyLutTexture: GPUTexture | null = null;
  private activeLutTexture: GPUTexture | null = null;
  private activeLut: CubeLUT | null = null;
  private lutStrength: number = 1.0;
  private lutEnabled: boolean = true;

  private currentWidth: number = 0;
  private currentHeight: number = 0;
  private hdrFormat: GPUTextureFormat = 'rgba32float';

  // Compute Pipelines & Bind Groups
  private gradingPipeline: GPUComputePipeline | null = null;
  private gradingUniformBuffer: GPUBuffer | null = null;
  private gradingBindGroup: GPUBindGroup | null = null;

  private histPipeline: GPUComputePipeline | null = null;
  private histUniformBuffer: GPUBuffer | null = null;
  private histGlobalBuffer: GPUBuffer | null = null;
  private histStagingBuffer: GPUBuffer | null = null;
  private histBindGroup: GPUBindGroup | null = null;

  // Render Pipeline
  private displayPipeline: GPURenderPipeline | null = null;
  private displayUniformBuffer: GPUBuffer | null = null;
  private displaySampler: GPUSampler | null = null;
  private displayBindGroup: GPUBindGroup | null = null;

  // State
  private gradingParams: ColorGradingParams = { ...DEFAULT_GRADING_PARAMS };
  private toneMappingMode: number = 0; // 0 = ACES, 1 = Reinhard, 2 = Linear, 3 = SDR Clamp
  private displayExposureOffset: number = 0.0;
  public isInitialized: boolean = false;

  // Diagnostic Mode & Zebras
  private diagnosticModeStr: 'normal' | 'false_color' | 'zebras' = 'normal';
  private diagnosticMode: number = 0; // 0 = normal, 1 = false_color, 2 = zebras
  private zebraThreshold: number = 0.95;

  // Nadir Mask & Tripod Patch
  private nadirConfig: { mode: 'off' | 'mirror' | 'vignette' | 'plate'; radius: number; feather: number } = {
    mode: 'off',
    radius: 0.12,
    feather: 0.04,
  };

  // A/B Wipe Comparison
  private wipeConfig: {
    mode: 'off' | 'vertical' | 'horizontal' | 'bypass';
    position: number;
    showDividerLine: boolean;
  } = {
    mode: 'off',
    position: 0.5,
    showDividerLine: true,
  };

  // 360° Optical Filters
  private opticalFilters: {
    gndExposure: number;
    gndHorizonOffset: number;
    gndFeather: number;
    skyPolarizer: number;
  } = {
    gndExposure: 0.0,
    gndHorizonOffset: 0.0,
    gndFeather: 0.26,
    skyPolarizer: 0.0,
  };

  // Auto Exposure Engine & Metering
  public autoExposure: AutoExposureEngine = new AutoExposureEngine();
  private meteringMode: number = 0; // 0 = evaluative, 1 = horizon, 2 = directional
  private cameraDirection: [number, number, number, number] = [0, 0, -1, 0.7071]; // xyz, w = cos(halfFov)

  constructor() {}

  /**
   * Initializes WebGPU with comprehensive feature detection and fallback logic
   */
  async init(canvas?: HTMLCanvasElement): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      console.warn('[WebGPUEngine] WebGPU not supported on this browser/platform.');
      return false;
    }

    try {
      this.adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!this.adapter) {
        console.warn('[WebGPUEngine] Failed to acquire high-performance GPUAdapter.');
        return false;
      }

      // Feature detection
      const requiredFeatures: GPUFeatureName[] = [];
      const hasFloat32Filterable = this.adapter.features.has('float32-filterable');
      const hasShaderF16 = this.adapter.features.has('shader-f16');

      if (hasFloat32Filterable) {
        requiredFeatures.push('float32-filterable');
      }

      this.device = await this.adapter.requestDevice({
        requiredFeatures,
      });

      const adapterAny = this.adapter as any;
      const adapterInfo = adapterAny.info || (await adapterAny.requestAdapterInfo?.());
      this.capabilities = {
        adapterName: adapterInfo?.description || adapterInfo?.device || 'WebGPU Device',
        hasRGBA32Float: true,
        hasFloat32Filterable,
        hasShaderF16,
        maxTextureDimension2D: this.device.limits.maxTextureDimension2D,
      };

      // Set canvas context if provided
      if (canvas) {
        this.canvas = canvas;
        this.context = canvas.getContext('webgpu') as GPUCanvasContext;
        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        this.context.configure({
          device: this.device,
          format: this.presentationFormat,
          alphaMode: 'opaque',
        });
      }

      // Create fallback 1x1x1 dummy 3D LUT texture
      this.dummyLutTexture = this.device.createTexture({
        label: 'Dummy3DLUT',
        size: [1, 1, 1],
        dimension: '3d',
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const dummyData = new Float32Array([0.0, 0.0, 0.0, 1.0]);
      this.device.queue.writeTexture(
        { texture: this.dummyLutTexture },
        dummyData.buffer,
        { bytesPerRow: 256, rowsPerImage: 1 },
        [1, 1, 1]
      );

      await this.initPipelines();
      this.isInitialized = true;
      return true;
    } catch (err) {
      console.error('[WebGPUEngine] WebGPU initialization failed:', err);
      return false;
    }
  }

  private async initPipelines() {
    if (!this.device) return;

    // 1. Grading Compute Pipeline
    const gradingModule = this.device.createShaderModule({
      label: 'GradingComputeShader',
      code: colorGradingComputeWGSL,
    });

    this.gradingPipeline = this.device.createComputePipeline({
      label: 'GradingComputePipeline',
      layout: 'auto',
      compute: {
        module: gradingModule,
        entryPoint: 'main',
      },
    });

    // Uniform buffer (96 bytes: 24 floats/uint32s)
    this.gradingUniformBuffer = this.device.createBuffer({
      label: 'GradingUniformsBuffer',
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 2. Histogram Compute Pipeline
    const histModule = this.device.createShaderModule({
      label: 'HistogramComputeShader',
      code: histogramComputeWGSL,
    });

    this.histPipeline = this.device.createComputePipeline({
      label: 'HistogramComputePipeline',
      layout: 'auto',
      compute: {
        module: histModule,
        entryPoint: 'main',
      },
    });

    this.histUniformBuffer = this.device.createBuffer({
      label: 'HistUniformsBuffer',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 1024 bins * 4 bytes each = 4096 bytes
    this.histGlobalBuffer = this.device.createBuffer({
      label: 'HistGlobalBuffer',
      size: 4096,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    this.histStagingBuffer = this.device.createBuffer({
      label: 'HistStagingBuffer',
      size: 4096,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // 3. Display Render Pipeline
    if (this.context) {
      const displayModule = this.device.createShaderModule({
        label: 'DisplayRenderShader',
        code: displayRenderWGSL,
      });

      this.displayPipeline = this.device.createRenderPipeline({
        label: 'DisplayRenderPipeline',
        layout: 'auto',
        vertex: {
          module: displayModule,
          entryPoint: 'vs_main',
        },
        fragment: {
          module: displayModule,
          entryPoint: 'fs_main',
          targets: [{ format: this.presentationFormat }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      });

      this.displayUniformBuffer = this.device.createBuffer({
        label: 'DisplayUniformsBuffer',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.displaySampler = this.device.createSampler({
        magFilter: this.capabilities.hasFloat32Filterable ? 'linear' : 'nearest',
        minFilter: this.capabilities.hasFloat32Filterable ? 'linear' : 'nearest',
      });
    }
  }

  /**
   * Loads an input image, canvas, or video element and prepares GPU textures
   */
  async setInputSource(
    source: ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageData,
    width?: number,
    height?: number
  ): Promise<void> {
    if (!this.device) throw new Error('WebGPUEngine not initialized');

    let srcWidth = width || 0;
    let srcHeight = height || 0;

    if (!srcWidth || !srcHeight) {
      if (source instanceof HTMLVideoElement) {
        srcWidth = source.videoWidth;
        srcHeight = source.videoHeight;
      } else if (source instanceof HTMLImageElement) {
        srcWidth = source.naturalWidth;
        srcHeight = source.naturalHeight;
      } else if (source instanceof ImageBitmap || source instanceof HTMLCanvasElement || source instanceof ImageData) {
        srcWidth = source.width;
        srcHeight = source.height;
      }
    }

    if (!srcWidth || !srcHeight) {
      return;
    }

    const sizeChanged = this.currentWidth !== srcWidth || this.currentHeight !== srcHeight;
    this.currentWidth = srcWidth;
    this.currentHeight = srcHeight;

    if (sizeChanged || !this.inputTexture || !this.hdrTexture) {
      if (this.inputTexture) this.inputTexture.destroy();
      this.inputTexture = this.device.createTexture({
        label: 'InputImageTexture',
        size: [srcWidth, srcHeight, 1],
        format: 'rgba8unorm',
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });

      if (this.hdrTexture) this.hdrTexture.destroy();
      this.hdrTexture = this.device.createTexture({
        label: 'HDRLinearRadiometricTexture',
        size: [srcWidth, srcHeight, 1],
        format: this.hdrFormat,
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_SRC,
      });

      this.rebuildBindGroups();
    }

    // Write / copy source data to texture
    if (source instanceof ImageData) {
      this.device.queue.writeTexture(
        { texture: this.inputTexture },
        source.data.buffer,
        { bytesPerRow: srcWidth * 4, rowsPerImage: srcHeight },
        [srcWidth, srcHeight, 1]
      );
    } else {
      this.device.queue.copyExternalImageToTexture(
        { source: source as ImageBitmap | HTMLCanvasElement | HTMLVideoElement },
        { texture: this.inputTexture },
        [srcWidth, srcHeight, 1]
      );
    }
  }

  /**
   * Applies or updates an Adobe .cube 3D LUT
   */
  public set3DLUT(lut: CubeLUT | null, strength: number = 1.0, enabled: boolean = true) {
    if (!this.device) return;

    this.activeLut = lut;
    this.lutStrength = Math.max(0.0, Math.min(1.0, strength));
    this.lutEnabled = enabled;

    if (this.activeLutTexture) {
      this.activeLutTexture.destroy();
      this.activeLutTexture = null;
    }

    if (lut && enabled) {
      const size = lut.size;
      this.activeLutTexture = this.device.createTexture({
        label: `LUT3D_${lut.title}`,
        size: [size, size, size],
        dimension: '3d',
        format: 'rgba32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });

      this.device.queue.writeTexture(
        { texture: this.activeLutTexture },
        lut.data.buffer,
        {
          bytesPerRow: size * 16,
          rowsPerImage: size,
        },
        [size, size, size]
      );
    }

    this.rebuildBindGroups();
    this.writeGradingUniforms();
  }

  public setLUTStrength(strength: number) {
    this.lutStrength = Math.max(0.0, Math.min(1.0, strength));
    this.writeGradingUniforms();
  }

  public setLUTEnabled(enabled: boolean) {
    this.lutEnabled = enabled;
    this.rebuildBindGroups();
    this.writeGradingUniforms();
  }

  /**
   * Rebuilds all pipeline bind groups when textures change
   */
  private rebuildBindGroups() {
    if (!this.device || !this.gradingPipeline || !this.inputTexture || !this.hdrTexture) return;

    const lutTexToBind = (this.lutEnabled && this.activeLutTexture)
      ? this.activeLutTexture
      : this.dummyLutTexture!;

    // 1. Grading Bind Group
    this.gradingBindGroup = this.device.createBindGroup({
      label: 'GradingBindGroup',
      layout: this.gradingPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.gradingUniformBuffer! } },
        { binding: 1, resource: this.inputTexture.createView() },
        { binding: 2, resource: this.hdrTexture.createView() },
        { binding: 3, resource: lutTexToBind.createView({ dimension: '3d' }) },
      ],
    });

    // 2. Histogram Bind Group
    if (this.histPipeline && this.histUniformBuffer && this.histGlobalBuffer) {
      this.histBindGroup = this.device.createBindGroup({
        label: 'HistBindGroup',
        layout: this.histPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.histUniformBuffer } },
          { binding: 1, resource: this.hdrTexture.createView() },
          { binding: 2, resource: { buffer: this.histGlobalBuffer } },
        ],
      });
    }

    // 3. Display Bind Group
    if (this.displayPipeline && this.displayUniformBuffer && this.displaySampler && this.inputTexture) {
      this.displayBindGroup = this.device.createBindGroup({
        label: 'DisplayBindGroup',
        layout: this.displayPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.displayUniformBuffer } },
          { binding: 1, resource: this.hdrTexture.createView() },
          { binding: 2, resource: this.displaySampler },
          { binding: 3, resource: this.inputTexture.createView() },
        ],
      });
    }
  }

  /**
   * Updates color grading settings
   */
  updateGrading(params: Partial<ColorGradingParams>) {
    this.gradingParams = { ...this.gradingParams, ...params };
    this.writeGradingUniforms();
  }

  public getGradingParams(): ColorGradingParams {
    return { ...this.gradingParams };
  }

  private writeGradingUniforms() {
    if (!this.device || !this.gradingUniformBuffer) return;

    const [wbR, wbG, wbB] = calculateWhiteBalanceGains(
      this.gradingParams.temperature,
      this.gradingParams.tint
    );
    const exposureGain = Math.pow(2.0, this.gradingParams.exposure);

    let logTypeCode = 0; // dlog
    if (this.gradingParams.inputLogType === 'dlog_m') logTypeCode = 1;
    else if (this.gradingParams.inputLogType === 'linear') logTypeCode = 2;
    else if (this.gradingParams.inputLogType === 'srgb') logTypeCode = 3;

    // 96 bytes buffer: 24 values * 4 bytes
    const arrayBuffer = new ArrayBuffer(96);
    const floatView = new Float32Array(arrayBuffer);
    const uintView = new Uint32Array(arrayBuffer);

    floatView[0] = exposureGain;
    floatView[1] = wbR;
    floatView[2] = wbG;
    floatView[3] = wbB;
    floatView[4] = this.gradingParams.highlights;
    floatView[5] = this.gradingParams.shadows;
    floatView[6] = this.gradingParams.contrast;
    floatView[7] = this.gradingParams.saturation;

    uintView[8] = logTypeCode;
    uintView[9] = this.currentWidth;
    uintView[10] = this.currentHeight;
    uintView[11] = this.activeLut && this.lutEnabled ? 1 : 0;

    floatView[12] = this.lutStrength;
    floatView[13] = this.activeLut ? this.activeLut.size : 1.0;

    const nadirModes: Record<string, number> = { off: 0, mirror: 1, vignette: 2, plate: 3 };
    uintView[14] = nadirModes[this.nadirConfig.mode] ?? 0;
    floatView[15] = this.nadirConfig.radius;
    floatView[16] = this.nadirConfig.feather;

    // 360° Optical Filters: Graduated ND & Sky Polarizer
    floatView[17] = this.opticalFilters.gndExposure;
    floatView[18] = this.opticalFilters.gndHorizonOffset;
    floatView[19] = this.opticalFilters.gndFeather;
    floatView[20] = this.opticalFilters.skyPolarizer;
    floatView[21] = 0; // padding
    floatView[22] = 0; // padding
    floatView[23] = 0; // padding

    this.device.queue.writeBuffer(this.gradingUniformBuffer, 0, arrayBuffer);
  }

  /**
   * Dispatches color grading and histogram compute passes
   */
  compute(): void {
    if (!this.device || !this.gradingPipeline || !this.gradingBindGroup || !this.currentWidth) return;

    this.writeGradingUniforms();

    const commandEncoder = this.device.createCommandEncoder({ label: 'ComputePassEncoder' });

    // 1. Color Grading Pass
    const computePass = commandEncoder.beginComputePass({ label: 'ColorGradingPass' });
    computePass.setPipeline(this.gradingPipeline);
    computePass.setBindGroup(0, this.gradingBindGroup);
    const workgroupsX = Math.ceil(this.currentWidth / 16);
    const workgroupsY = Math.ceil(this.currentHeight / 16);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
    computePass.end();

    // 2. Histogram Pass
    if (this.histPipeline && this.histBindGroup && this.histGlobalBuffer && this.histUniformBuffer) {
      commandEncoder.clearBuffer(this.histGlobalBuffer);

      const histUniformBufferData = new ArrayBuffer(32);
      const histUintView = new Uint32Array(histUniformBufferData);
      const histFloatView = new Float32Array(histUniformBufferData);
      histUintView[0] = this.currentWidth;
      histUintView[1] = this.currentHeight;
      histUintView[2] = this.meteringMode;
      histUintView[3] = 0; // padding
      histFloatView[4] = this.cameraDirection[0];
      histFloatView[5] = this.cameraDirection[1];
      histFloatView[6] = this.cameraDirection[2];
      histFloatView[7] = this.cameraDirection[3];
      this.device.queue.writeBuffer(this.histUniformBuffer, 0, histUniformBufferData);

      const histPass = commandEncoder.beginComputePass({ label: 'HistogramComputePass' });
      histPass.setPipeline(this.histPipeline);
      histPass.setBindGroup(0, this.histBindGroup);
      histPass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
      histPass.end();
    }

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Renders the processed HDR image to the canvas display
   */
  render(): void {
    if (!this.device || !this.context || !this.displayPipeline || !this.displayBindGroup) return;

    const displayData = new ArrayBuffer(32);
    const uintView = new Uint32Array(displayData);
    const floatView = new Float32Array(displayData);
    uintView[0] = this.toneMappingMode;
    floatView[1] = this.displayExposureOffset;
    uintView[2] = this.diagnosticMode;
    floatView[3] = this.zebraThreshold;
    floatView[4] = typeof performance !== 'undefined' ? performance.now() / 1000.0 : 0.0;
    const wipeModes: Record<string, number> = {
      off: 0,
      vertical: 1,
      horizontal: 2,
      bypass: 3,
    };
    uintView[5] = wipeModes[this.wipeConfig.mode] ?? 0;
    floatView[6] = this.wipeConfig.position;
    uintView[7] = this.wipeConfig.showDividerLine ? 1 : 0;
    this.device.queue.writeBuffer(this.displayUniformBuffer!, 0, displayData);

    const commandEncoder = this.device.createCommandEncoder({ label: 'DisplayRenderEncoder' });
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      label: 'DisplayRenderPass',
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.displayPipeline);
    renderPass.setBindGroup(0, this.displayBindGroup);
    renderPass.draw(3, 1, 0, 0);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Sets display tone mapping parameters
   */
  setDisplayOptions(mode: 'aces' | 'reinhard' | 'linear' | 'clamp', exposureOffset: number = 0.0) {
    const modes: Record<string, number> = { aces: 0, reinhard: 1, linear: 2, clamp: 3 };
    this.toneMappingMode = modes[mode] ?? 0;
    this.displayExposureOffset = exposureOffset;
  }

  /**
   * Configures diagnostic monitoring mode (False Color, Zebras)
   */
  public setDiagnosticMode(
    mode: 'normal' | 'false_color' | 'zebras',
    zebraThreshold?: number
  ): void {
    this.diagnosticModeStr = mode;
    const modes: Record<string, number> = { normal: 0, false_color: 1, zebras: 2 };
    this.diagnosticMode = modes[mode] ?? 0;
    if (zebraThreshold !== undefined) {
      this.zebraThreshold = zebraThreshold;
    }
  }

  public getDiagnosticMode(): string {
    return this.diagnosticModeStr;
  }

  /**
   * Configures 360° Nadir Mask & Tripod Patch
   */
  public setNadirPatch(
    mode: 'off' | 'mirror' | 'vignette' | 'plate',
    radius?: number,
    feather?: number
  ): void {
    this.nadirConfig = {
      mode,
      radius: radius !== undefined ? Math.max(0.0, Math.min(1.0, radius)) : this.nadirConfig.radius,
      feather: feather !== undefined ? Math.max(0.0, Math.min(0.5, feather)) : this.nadirConfig.feather,
    };
    this.writeGradingUniforms();
  }

  public getNadirConfig(): { mode: string; radius: number; feather: number } {
    return { ...this.nadirConfig };
  }

  /**
   * Configures interactive A/B Wipe comparison mode between Raw Camera Log and Graded HDR
   */
  public setWipeMode(
    mode: 'off' | 'vertical' | 'horizontal' | 'bypass',
    position?: number,
    showDividerLine?: boolean
  ): void {
    this.wipeConfig.mode = mode;
    if (position !== undefined) {
      this.wipeConfig.position = Math.max(0.0, Math.min(1.0, position));
    }
    if (showDividerLine !== undefined) {
      this.wipeConfig.showDividerLine = showDividerLine;
    }
  }

  public getWipeConfig(): { mode: string; position: number; showDividerLine: boolean } {
    return { ...this.wipeConfig };
  }

  /**
   * Configures 360° Optical Filters: Graduated Neutral Density (GND) and Sky Polarizer
   */
  public setOpticalFilters(filters: {
    gndExposure?: number;
    gndHorizonOffset?: number;
    gndFeather?: number;
    skyPolarizer?: number;
  }): void {
    if (filters.gndExposure !== undefined) {
      this.opticalFilters.gndExposure = Math.max(-4.0, Math.min(2.0, filters.gndExposure));
    }
    if (filters.gndHorizonOffset !== undefined) {
      this.opticalFilters.gndHorizonOffset = Math.max(-0.52, Math.min(0.52, filters.gndHorizonOffset));
    }
    if (filters.gndFeather !== undefined) {
      this.opticalFilters.gndFeather = Math.max(0.01, Math.min(1.0, filters.gndFeather));
    }
    if (filters.skyPolarizer !== undefined) {
      this.opticalFilters.skyPolarizer = Math.max(0.0, Math.min(1.0, filters.skyPolarizer));
    }
    this.writeGradingUniforms();
  }

  public getOpticalFilters(): {
    gndExposure: number;
    gndHorizonOffset: number;
    gndFeather: number;
    skyPolarizer: number;
  } {
    return { ...this.opticalFilters };
  }

  public getDimensions(): { width: number; height: number } {
    return { width: this.currentWidth, height: this.currentHeight };
  }

  /**
   * Asynchronously reads back the calculated histogram (1024 bins)
   */
  async readbackHistogram(): Promise<HistogramResult> {
    if (!this.device || !this.histGlobalBuffer || !this.histStagingBuffer) {
      throw new Error('Histogram buffer not available');
    }

    const commandEncoder = this.device.createCommandEncoder({ label: 'ReadbackHistEncoder' });
    commandEncoder.copyBufferToBuffer(this.histGlobalBuffer, 0, this.histStagingBuffer, 0, 4096);
    this.device.queue.submit([commandEncoder.finish()]);

    await this.histStagingBuffer.mapAsync(GPUMapMode.READ);
    const copy = new Uint32Array(this.histStagingBuffer.getMappedRange().slice(0));
    this.histStagingBuffer.unmap();

    return {
      luma: copy.subarray(0, 256),
      r: copy.subarray(256, 512),
      g: copy.subarray(512, 768),
      b: copy.subarray(768, 1024),
    };
  }

  /**
   * Configures auto exposure metering mode and optional camera direction
   */
  public setMeteringMode(
    mode: AutoExposureMode,
    cameraDirection?: [number, number, number],
    halfFovRad?: number
  ): void {
    const modeCodes: Record<AutoExposureMode, number> = {
      evaluative: 0,
      horizon: 1,
      viewport: 2,
    };
    this.meteringMode = modeCodes[mode] ?? 0;
    this.autoExposure.setMode(mode);
    if (cameraDirection) {
      const cosCone = halfFovRad !== undefined ? Math.cos(halfFovRad) : 0.7071;
      this.cameraDirection = [
        cameraDirection[0],
        cameraDirection[1],
        cameraDirection[2],
        cosCone,
      ];
    }
  }

  /**
   * Returns the auto exposure engine instance
   */
  public getAutoExposureEngine(): AutoExposureEngine {
    return this.autoExposure;
  }

  /**
   * Reads back the histogram and calculates optimal auto-exposure EV
   * Optionally takes exposure compensation EV and delta time in seconds for temporal smoothing
   */
  public async getAutoExposureEV(compensationEV?: number, dtSeconds?: number): Promise<number> {
    const hist = await this.readbackHistogram();
    if (compensationEV !== undefined) {
      this.autoExposure.setCompensation(compensationEV);
    }
    if (dtSeconds !== undefined && dtSeconds > 0) {
      return this.autoExposure.update(hist.luma, dtSeconds, true);
    }
    return this.autoExposure.calculateTargetEV(hist.luma);
  }

  /**
   * Synchronously calculates target EV from a given luma histogram
   */
  public calculateAutoExposureFromHistogram(lumaHist: Uint32Array | number[]): number {
    return this.autoExposure.calculateTargetEV(lumaHist);
  }

  /**
   * Synchronously updates auto exposure with temporal smoothing from a given luma histogram
   */
  public updateAutoExposure(
    lumaHist: Uint32Array | number[],
    dtSeconds: number,
    isContinuous: boolean = true
  ): number {
    return this.autoExposure.update(lumaHist, dtSeconds, isContinuous);
  }

  /**
   * Reads back the 32-bit linear radiometric HDR pixel values
   */
  async readbackHDR(): Promise<{ data: Float32Array; width: number; height: number }> {
    if (!this.device || !this.hdrTexture || !this.currentWidth || !this.currentHeight) {
      throw new Error('HDR texture not available for readback');
    }

    const width = this.currentWidth;
    const height = this.currentHeight;

    const bytesPerPixel = 16;
    const unpaddedBytesPerRow = width * bytesPerPixel;
    const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const bufferSize = paddedBytesPerRow * height;

    const readBuffer = this.device.createBuffer({
      label: 'HDRReadbackBuffer',
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = this.device.createCommandEncoder({ label: 'ReadbackHDREncoder' });
    commandEncoder.copyTextureToBuffer(
      { texture: this.hdrTexture },
      { buffer: readBuffer, bytesPerRow: paddedBytesPerRow, rowsPerImage: height },
      [width, height, 1]
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const mapped = new Float32Array(readBuffer.getMappedRange());

    const output = new Float32Array(width * height * 4);
    const floatsPerUnpaddedRow = width * 4;
    const floatsPerPaddedRow = paddedBytesPerRow / 4;

    for (let y = 0; y < height; y++) {
      const srcOffset = y * floatsPerPaddedRow;
      const dstOffset = y * floatsPerUnpaddedRow;
      output.set(mapped.subarray(srcOffset, srcOffset + floatsPerUnpaddedRow), dstOffset);
    }

    readBuffer.unmap();
    readBuffer.destroy();

    return { data: output, width, height };
  }

  destroy() {
    this.inputTexture?.destroy();
    this.hdrTexture?.destroy();
    this.dummyLutTexture?.destroy();
    this.activeLutTexture?.destroy();
    this.gradingUniformBuffer?.destroy();
    this.histUniformBuffer?.destroy();
    this.histGlobalBuffer?.destroy();
    this.histStagingBuffer?.destroy();
    this.displayUniformBuffer?.destroy();
    this.device?.destroy();
    this.isInitialized = false;
  }
}
