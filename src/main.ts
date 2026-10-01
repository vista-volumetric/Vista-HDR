/**
 * Vista HDR Main Studio Application Orchestrator
 * High-end 360° D-Log to Radiometric HDR Studio with real-time WebGPU compute,
 * Three.js spherical & equirectangular viewports, video timeline scrubber,
 * 3D LUT grading, and HDR/EXR exporters.
 */

import { createIcons, icons } from 'lucide';
import { WebGPUEngine, HistogramResult } from './engine/webgpu-engine.js';
import { SphereViewport } from './viewport/sphere-viewport.js';
import { VideoController, formatTimecode, PlaybackState } from './engine/video-controller.js';
import { parseCubeLUT, createCinematicPresetLUT, CubeLUT } from './engine/lut-parser.js';
import { encodeRGBE, encodeEXR, exportSDR, generateExposureBracketSet } from './engine/hdr-exporter.js';
import {
  DEFAULT_GRADING_PARAMS,
  ColorGradingParams,
  calculateAutoWhiteBalance,
  calculateEyedropperBalance,
} from './engine/color-science.js';
import {
  renderWaveform,
  renderRGBParade,
  renderVectorscope,
} from './engine/scopes.js';
import { AutoExposureMode } from './engine/auto-exposure.js';

// Initialize Lucide icons
function refreshIcons() {
  createIcons({ icons });
}

// -------------------------------------------------------------
// DOM Elements Selection
// -------------------------------------------------------------
const projectTitleInput = document.getElementById('project-title-input') as HTMLInputElement;
const btnViewSphere = document.getElementById('btn-view-sphere') as HTMLButtonElement;
const btnViewFlat = document.getElementById('btn-view-flat') as HTMLButtonElement;
const btnViewSplit = document.getElementById('btn-view-split') as HTMLButtonElement;

const gpuStatusBadge = document.getElementById('gpu-status-badge') as HTMLDivElement;
const gpuDeviceName = document.getElementById('gpu-device-name') as HTMLSpanElement;
const videoFileInput = document.getElementById('video-file-input') as HTMLInputElement;
const btnLoadVideo = document.getElementById('btn-load-video') as HTMLButtonElement;
const btnResetAll = document.getElementById('btn-reset-all') as HTMLButtonElement;

const btnExportHDR = document.getElementById('btn-export-hdr') as HTMLButtonElement;
const btnExportEXR = document.getElementById('btn-export-exr') as HTMLButtonElement;
const btnExportSDR = document.getElementById('btn-export-sdr') as HTMLButtonElement;
const btnExportBrackets = document.getElementById('btn-export-brackets') as HTMLButtonElement;
const btnExportMenu = document.getElementById('btn-export-menu') as HTMLButtonElement | null;
const exportDropdownMenu = document.getElementById('export-dropdown-menu') as HTMLDivElement | null;
const iconExportChevron = document.getElementById('icon-export-chevron') as HTMLElement | null;
const btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;
const viewportViewsWrapper = document.getElementById('viewport-views-wrapper') as HTMLElement | null;

// Right Toolbar & Accordion Controls
const rightToolbar = document.getElementById('right-toolbar') as HTMLElement;
const btnToggleToolbar = document.getElementById('btn-toggle-toolbar') as HTMLButtonElement | null;
const btnExpandToolbar = document.getElementById('btn-expand-toolbar') as HTMLButtonElement;
const headingTelemetry = document.getElementById('heading-telemetry') as HTMLSpanElement | null;

// Drawer 1: Input Profile & EOTF
const inputProfileSelect = document.getElementById('input-profile-select') as HTMLSelectElement;
const btnProfileDlog = document.getElementById('btn-profile-dlog') as HTMLButtonElement;
const btnProfileDlogM = document.getElementById('btn-profile-dlogm') as HTMLButtonElement;
const btnProfileLinear = document.getElementById('btn-profile-linear') as HTMLButtonElement;
const btnProfileSrgb = document.getElementById('btn-profile-srgb') as HTMLButtonElement;

// Drawer 2: Radiometric Color Grading
const btnResetGrade = document.getElementById('btn-reset-grade') as HTMLButtonElement;
const btnAeContinuous = document.getElementById('btn-ae-continuous') as HTMLButtonElement;
const aeContinuousDot = document.getElementById('ae-continuous-dot') as HTMLSpanElement;
const aeContinuousText = document.getElementById('ae-continuous-text') as HTMLSpanElement;
const btnAeOneshot = document.getElementById('btn-ae-oneshot') as HTMLButtonElement;
const selectAeMode = document.getElementById('select-ae-mode') as HTMLSelectElement;
const paramAeCompensation = document.getElementById('param-ae-compensation') as HTMLInputElement;
const valAeCompensation = document.getElementById('val-ae-compensation') as HTMLSpanElement;
const paramExposure = document.getElementById('param-exposure') as HTMLInputElement;
const btnAwbOneshot = document.getElementById('btn-awb-oneshot') as HTMLButtonElement;
const btnEyedropper = document.getElementById('btn-eyedropper') as HTMLButtonElement;
const textEyedropper = document.getElementById('text-eyedropper') as HTMLSpanElement;
const paramTemperature = document.getElementById('param-temperature') as HTMLInputElement;
const paramTint = document.getElementById('param-tint') as HTMLInputElement;
const paramHighlights = document.getElementById('param-highlights') as HTMLInputElement;
const paramShadows = document.getElementById('param-shadows') as HTMLInputElement;
const paramContrast = document.getElementById('param-contrast') as HTMLInputElement;
const paramSaturation = document.getElementById('param-saturation') as HTMLInputElement;

const valExposure = document.getElementById('val-exposure') as HTMLSpanElement;
const valTemperature = document.getElementById('val-temperature') as HTMLSpanElement;
const valTint = document.getElementById('val-tint') as HTMLSpanElement;
const valHighlights = document.getElementById('val-highlights') as HTMLSpanElement;
const valShadows = document.getElementById('val-shadows') as HTMLSpanElement;
const valContrast = document.getElementById('val-contrast') as HTMLSpanElement;
const valSaturation = document.getElementById('val-saturation') as HTMLSpanElement;

// 360° Optical Filters (GND & Sky Polarizer)
const btnResetOpticalFilters = document.getElementById('btn-reset-optical-filters') as HTMLButtonElement;
const paramGndExposure = document.getElementById('param-gnd-exposure') as HTMLInputElement;
const valGndExposure = document.getElementById('val-gnd-exposure') as HTMLSpanElement;
const paramGndPivot = document.getElementById('param-gnd-pivot') as HTMLInputElement;
const valGndPivot = document.getElementById('val-gnd-pivot') as HTMLSpanElement;
const paramGndFeather = document.getElementById('param-gnd-feather') as HTMLInputElement;
const valGndFeather = document.getElementById('val-gnd-feather') as HTMLSpanElement;
const paramSkyPolarizer = document.getElementById('param-sky-polarizer') as HTMLInputElement;
const valSkyPolarizer = document.getElementById('val-sky-polarizer') as HTMLSpanElement;

// Drawer 3: Horizon Leveling & Gimbal
const btnResetHorizon = document.getElementById('btn-reset-horizon') as HTMLButtonElement;
const paramPitch = document.getElementById('param-pitch') as HTMLInputElement;
const paramRoll = document.getElementById('param-roll') as HTMLInputElement;
const paramYaw = document.getElementById('param-yaw') as HTMLInputElement;
const valPitch = document.getElementById('val-pitch') as HTMLSpanElement;
const valRoll = document.getElementById('val-roll') as HTMLSpanElement;
const valYaw = document.getElementById('val-yaw') as HTMLSpanElement;
const btnDrawerHorizonGuide = document.getElementById('btn-drawer-horizon-guide') as HTMLButtonElement;
const btnRecenterCamDrawer = document.getElementById('btn-recenter-cam-drawer') as HTMLButtonElement;

// 360 Nadir Mask & Tripod Patch
const btnToggleNadir = document.getElementById('btn-toggle-nadir') as HTMLButtonElement;
const nadirStatusDot = document.getElementById('nadir-status-dot') as HTMLSpanElement;
const nadirStatusText = document.getElementById('nadir-status-text') as HTMLSpanElement;
const selectNadirMode = document.getElementById('select-nadir-mode') as HTMLSelectElement;
const paramNadirRadius = document.getElementById('param-nadir-radius') as HTMLInputElement;
const valNadirRadius = document.getElementById('val-nadir-radius') as HTMLSpanElement;
const paramNadirFeather = document.getElementById('param-nadir-feather') as HTMLInputElement;
const valNadirFeather = document.getElementById('val-nadir-feather') as HTMLSpanElement;

// Drawer 4: 3D LUT (.CUBE)
const btnLutPreset = document.getElementById('btn-lut-preset') as HTMLButtonElement;
const btnLutToggle = document.getElementById('btn-lut-toggle') as HTMLButtonElement;
const lutFileInput = document.getElementById('lut-file-input') as HTMLInputElement;
const lutDropzone = document.getElementById('lut-dropzone') as HTMLDivElement;
const lutFilename = document.getElementById('lut-filename') as HTMLSpanElement;
const lutSizeBadge = document.getElementById('lut-size-badge') as HTMLSpanElement;
const lutStrengthContainer = document.getElementById('lut-strength-container') as HTMLDivElement;
const paramLutStrength = document.getElementById('param-lut-strength') as HTMLInputElement;
const valLutStrength = document.getElementById('val-lut-strength') as HTMLSpanElement;

// Drawer 5: Scopes & Histogram
const tonemapSelect = document.getElementById('tonemap-select') as HTMLSelectElement;
const btnScopeHist = document.getElementById('btn-scope-hist') as HTMLButtonElement;
const btnScopeWaveform = document.getElementById('btn-scope-waveform') as HTMLButtonElement;
const btnScopeParade = document.getElementById('btn-scope-parade') as HTMLButtonElement;
const btnScopeVector = document.getElementById('btn-scope-vector') as HTMLButtonElement;
const scopeModeLabel = document.getElementById('scope-mode-label') as HTMLSpanElement | null;
const histLegend = document.getElementById('hist-legend') as HTMLElement | null;
const histCanvas = document.getElementById('hist-canvas') as HTMLCanvasElement;
const histFps = document.getElementById('hist-fps') as HTMLSpanElement;
const histCtx = histCanvas.getContext('2d');
const paramZebraThreshold = document.getElementById('param-zebra-threshold') as HTMLInputElement;
const valZebraThreshold = document.getElementById('val-zebra-threshold') as HTMLSpanElement;

// Viewport Stage & HUD
const viewportStage = document.getElementById('viewport-stage') as HTMLElement;
const dropOverlay = document.getElementById('drop-overlay') as HTMLElement;
const sphereViewContainer = document.getElementById('sphere-view-container') as HTMLElement;
const threeContainer = document.getElementById('three-container') as HTMLElement;
const hudYawPitch = document.getElementById('hud-yaw-pitch') as HTMLSpanElement;
const btnRecenterCam = document.getElementById('btn-recenter-cam') as HTMLButtonElement;
const btnToggleHorizonGuide = document.getElementById('btn-toggle-horizon-guide') as HTMLButtonElement;
const btnToggleFalseColor = document.getElementById('btn-toggle-false-color') as HTMLButtonElement;
const btnToggleZebras = document.getElementById('btn-toggle-zebras') as HTMLButtonElement;
const btnToggleAbWipe = document.getElementById('btn-toggle-ab-wipe') as HTMLButtonElement;
const abWipeOverlay = document.getElementById('ab-wipe-overlay') as HTMLElement;
const abWipeDivider = document.getElementById('ab-wipe-divider') as HTMLElement;
const horizonReticle = document.getElementById('horizon-reticle') as HTMLElement;

const flatViewContainer = document.getElementById('flat-view-container') as HTMLElement;
const hdrCanvas = document.getElementById('hdr-canvas') as HTMLCanvasElement;
const flatHorizonLine = document.getElementById('flat-horizon-line') as HTMLElement;

// Timeline & Transport
const bottomTransportWrapper = document.getElementById('bottom-transport-wrapper') as HTMLElement | null;
const timelineTrackContainer = document.getElementById('timeline-track-container') as HTMLElement;
const timelineProgressBar = document.getElementById('timeline-progress-bar') as HTMLElement;
const timelineThumb = document.getElementById('timeline-thumb') as HTMLElement;
const timelineHoverTooltip = document.getElementById('timeline-hover-tooltip') as HTMLElement;

const btnStepBack = document.getElementById('btn-step-back') as HTMLButtonElement;
const btnPlayPause = document.getElementById('btn-play-pause') as HTMLButtonElement;
const iconPlayPause = document.getElementById('icon-play-pause') as HTMLElement;
const textPlayPause = document.getElementById('text-play-pause') as HTMLSpanElement;
const btnStepForward = document.getElementById('btn-step-forward') as HTMLButtonElement;

const displayTimecode = document.getElementById('display-timecode') as HTMLSpanElement;
const displayDuration = document.getElementById('display-duration') as HTMLSpanElement;
const displayFrame = document.getElementById('display-frame') as HTMLSpanElement;
const btnToggleLoop = document.getElementById('btn-toggle-loop') as HTMLButtonElement;
const selectPlaybackRate = document.getElementById('select-playback-rate') as HTMLSelectElement;

// Notification Toasts
const toastContainer = document.getElementById('toast-container') as HTMLDivElement;

// -------------------------------------------------------------
// Engine & Viewport Instances
// -------------------------------------------------------------
const engine = new WebGPUEngine();
let sphereViewport: SphereViewport | null = null;
const videoController = new VideoController();

type ViewMode = 'sphere' | 'flat' | 'split';
let currentViewMode: ViewMode = 'sphere';

let currentGrading: ColorGradingParams = { ...DEFAULT_GRADING_PARAMS };
let horizonAngles = { pitch: 0, roll: 0, yaw: 0 };
let currentLUT: CubeLUT | null = null;
let isLutBypassed = false;
let isHorizonGuideVisible = true;

// Diagnostic & Viewport Monitoring State
let diagnosticMode: 'normal' | 'false_color' | 'zebras' = 'normal';
let zebraThreshold = 0.95;

// A/B Wipe Comparison State
let isAbWipeActive: boolean = false;
let wipePosition: number = 0.5;
let isDraggingWipe: boolean = false;

// White Balance & Eyedropper State
let isEyedropperActive = false;

// Nadir Mask & Tripod Patch State
let isNadirActive = false;
let nadirMode: 'mirror' | 'vignette' | 'plate' = 'mirror';

// Scope View Mode State & HDR Cache
type ScopeMode = 'hist' | 'waveform' | 'parade' | 'vector';
let currentScopeMode: ScopeMode = 'hist';
let cachedHdrData: Float32Array | null = null;
let cachedHdrWidth = 0;
let cachedHdrHeight = 0;
let isHdrReadbackBusy = false;
let lastHdrReadbackTime = 0;

// Auto Exposure State & Caching
let latestHistogram: HistogramResult | null = null;
let isContinuousAE = false;
let lastAETime = performance.now();

function getCameraDirectionVector(): [number, number, number] {
  const orient = sphereViewport ? sphereViewport.getOrientation() : { yaw: 0, pitch: 0, fov: 75 };
  const yawRad = (orient.yaw * Math.PI) / 180;
  const pitchRad = (orient.pitch * Math.PI) / 180;
  return [
    Math.cos(pitchRad) * Math.sin(yawRad),
    Math.sin(pitchRad),
    -Math.cos(pitchRad) * Math.cos(yawRad),
  ];
}

// Histogram throttling
let lastHistTime = performance.now();
let histFrameCount = 0;
let isHistBusy = false;

// -------------------------------------------------------------
// Notification Toasts
// -------------------------------------------------------------
function showToast(message: string, type: 'info' | 'success' | 'error' = 'info', durationMs = 3500) {
  const toast = document.createElement('div');
  const borderCol =
    type === 'success'
      ? 'border-emerald-500/50 text-emerald-300'
      : type === 'error'
      ? 'border-red-500/50 text-red-300'
      : 'border-cyan-500/50 text-cyan-200';

  toast.className = `glass-panel px-4 py-2.5 rounded-xl border ${borderCol} text-xs font-medium shadow-2xl flex items-center gap-2.5 backdrop-blur-xl transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto`;
  toast.innerHTML = `
    <span class="w-2 h-2 rounded-full ${
      type === 'success' ? 'bg-emerald-400' : type === 'error' ? 'bg-red-400' : 'bg-cyan-400'
    } animate-pulse"></span>
    <span>${message}</span>
  `;

  toastContainer.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => {
      if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 300);
  }, durationMs);
}

// -------------------------------------------------------------
// File Download Helper
// -------------------------------------------------------------
function downloadFile(blobOrBytes: Blob | Uint8Array, filename: string, mimeType: string) {
  const blob =
    blobOrBytes instanceof Blob
      ? blobOrBytes
      : new Blob([blobOrBytes as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------
// Scopes & Histogram Renderers
// -------------------------------------------------------------
function drawHistogram(hist: { luma: Uint32Array; r: Uint32Array; g: Uint32Array; b: Uint32Array }) {
  if (!histCtx) return;
  const w = histCanvas.width;
  const h = histCanvas.height;

  histCtx.clearRect(0, 0, w, h);

  let maxCount = 1;
  for (let i = 0; i < 256; i++) {
    if (hist.luma[i] > maxCount) maxCount = hist.luma[i];
    if (hist.r[i] > maxCount) maxCount = hist.r[i];
    if (hist.g[i] > maxCount) maxCount = hist.g[i];
    if (hist.b[i] > maxCount) maxCount = hist.b[i];
  }

  const drawChannel = (bins: Uint32Array, color: string) => {
    histCtx.strokeStyle = color;
    histCtx.fillStyle = color.replace(')', ', 0.15)').replace('rgb', 'rgba');
    histCtx.lineWidth = 1;
    histCtx.beginPath();
    histCtx.moveTo(0, h);

    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const normHeight = Math.sqrt(bins[i] / maxCount) * (h - 4);
      const y = h - normHeight;
      histCtx.lineTo(x, y);
    }
    histCtx.lineTo(w, h);
    histCtx.closePath();
    histCtx.fill();
    histCtx.stroke();
  };

  drawChannel(hist.r, 'rgb(239, 68, 68)');
  drawChannel(hist.g, 'rgb(34, 197, 94)');
  drawChannel(hist.b, 'rgb(59, 130, 246)');
  drawChannel(hist.luma, 'rgb(244, 244, 245)');
}

function renderCurrentScope() {
  if (!histCtx) return;
  const w = histCanvas.width;
  const h = histCanvas.height;

  if (currentScopeMode === 'hist') {
    if (latestHistogram) {
      drawHistogram(latestHistogram);
    }
    return;
  }

  // Waveform, Parade, Vectorscope require hdrData
  let data = cachedHdrData;
  let imgW = cachedHdrWidth;
  let imgH = cachedHdrHeight;

  if (!data && sphereViewport) {
    const intermediate = sphereViewport.getIntermediateCanvas();
    if (intermediate && intermediate.width > 0 && intermediate.height > 0) {
      const ctx2d = intermediate.getContext('2d');
      if (ctx2d) {
        const imgData = ctx2d.getImageData(0, 0, intermediate.width, intermediate.height);
        data = new Float32Array(imgData.data.length);
        for (let i = 0; i < imgData.data.length; i++) {
          data[i] = imgData.data[i] / 255.0;
        }
        imgW = intermediate.width;
        imgH = intermediate.height;
      }
    }
  }

  if (data && imgW > 0 && imgH > 0) {
    if (currentScopeMode === 'waveform') {
      renderWaveform(histCtx, w, h, data, imgW, imgH);
    } else if (currentScopeMode === 'parade') {
      renderRGBParade(histCtx, w, h, data, imgW, imgH);
    } else if (currentScopeMode === 'vector') {
      renderVectorscope(histCtx, w, h, data, imgW, imgH);
    }
  }
}

// -------------------------------------------------------------
// Pipeline Execution & Viewport Texture Update
// -------------------------------------------------------------
async function processCurrentFrame() {
  const source = videoController.getCurrentSource();
  const state = videoController.getState();

  // Resize WebGPU canvas if needed
  if (hdrCanvas.width !== state.videoWidth || hdrCanvas.height !== state.videoHeight) {
    hdrCanvas.width = state.videoWidth;
    hdrCanvas.height = state.videoHeight;
  }

  await engine.setInputSource(source, state.videoWidth, state.videoHeight);
  engine.updateGrading(currentGrading);
  engine.compute();
  engine.render();

  // Feed tone-mapped WebGPU output into Three.js 360 sphere texture
  if (sphereViewport && (currentViewMode === 'sphere' || currentViewMode === 'split')) {
    sphereViewport.updateTextureSource(hdrCanvas);
  }

  // Update Flat View Horizon guide line
  if (currentViewMode === 'flat' || currentViewMode === 'split') {
    const pitchOffsetPx = (horizonAngles.pitch / 45.0) * (hdrCanvas.clientHeight * 0.25);
    flatHorizonLine.style.transform = `translateY(calc(-50% + ${pitchOffsetPx}px)) rotate(${-horizonAngles.roll}deg)`;
    flatHorizonLine.style.display = isHorizonGuideVisible ? 'block' : 'none';
  }

  // Asynchronous readback histogram and scopes (every ~250ms)
  const now = performance.now();
  histFrameCount++;
  if (now - lastHistTime >= 250) {
    const fps = Math.round((histFrameCount * 1000) / (now - lastHistTime));
    histFps.textContent = `${fps} FPS`;
    lastHistTime = now;
    histFrameCount = 0;

    if (!isHistBusy) {
      isHistBusy = true;
      engine.readbackHistogram()
        .then((hist) => {
          latestHistogram = hist;
          if (currentScopeMode === 'hist') {
            drawHistogram(hist);
          }
          if (isContinuousAE) {
            const dt = Math.min((now - lastAETime) / 1000, 0.5);
            const smoothedEV = engine.updateAutoExposure(hist.luma, dt, true);
            currentGrading.exposure = smoothedEV;
            paramExposure.value = smoothedEV.toFixed(2);
            valExposure.textContent = (smoothedEV >= 0 ? '+' : '') + smoothedEV.toFixed(2) + ' EV';
            engine.updateGrading(currentGrading);
            engine.compute();
            engine.render();
            if (sphereViewport && (currentViewMode === 'sphere' || currentViewMode === 'split')) {
              sphereViewport.updateTextureSource(hdrCanvas);
            }
          }
          lastAETime = now;
        })
        .catch(() => {})
        .finally(() => {
          isHistBusy = false;
        });
    }

    // Scopes readback for waveform, parade, and vectorscope
    if (currentScopeMode !== 'hist' && !isHdrReadbackBusy) {
      isHdrReadbackBusy = true;
      lastHdrReadbackTime = now;
      engine.readbackHDR()
        .then(({ data, width, height }) => {
          cachedHdrData = data;
          cachedHdrWidth = width;
          cachedHdrHeight = height;
          renderCurrentScope();
        })
        .catch(() => {
          renderCurrentScope();
        })
        .finally(() => {
          isHdrReadbackBusy = false;
        });
    }
  }
}

// -------------------------------------------------------------
// View Mode Switching Logic
// -------------------------------------------------------------
function setViewMode(mode: ViewMode) {
  currentViewMode = mode;

  const activeBtnClass =
    'relative px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200 flex items-center gap-2 cursor-pointer text-white bg-gradient-to-r from-cyan-600/90 to-blue-600/90 shadow-[0_0_15px_rgba(6,182,212,0.45)] border border-cyan-300/40';
  const inactiveBtnClass =
    'relative px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200 flex items-center gap-2 cursor-pointer text-slate-300 hover:text-cyan-200 hover:bg-slate-800/50 border border-transparent';

  const updateTabButton = (btn: HTMLButtonElement, isActive: boolean) => {
    btn.className = isActive ? activeBtnClass : inactiveBtnClass;
    const icon = btn.querySelector('i, svg');
    if (icon) {
      icon.setAttribute(
        'class',
        `w-3.5 h-3.5 transition-colors ${isActive ? 'text-cyan-100' : 'text-slate-400 group-hover:text-cyan-300'}`
      );
    }
    const indicator = btn.querySelector('.tab-indicator');
    if (isActive && !indicator) {
      const pill = document.createElement('span');
      pill.className =
        'tab-indicator absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3.5 h-[2px] bg-cyan-300 rounded-full shadow-[0_0_8px_#38bdf8]';
      btn.appendChild(pill);
    } else if (!isActive && indicator) {
      indicator.remove();
    }
  };

  updateTabButton(btnViewSphere, mode === 'sphere');
  updateTabButton(btnViewFlat, mode === 'flat');
  updateTabButton(btnViewSplit, mode === 'split');

  if (viewportViewsWrapper) {
    viewportViewsWrapper.className =
      mode === 'split'
        ? 'flex-1 relative flex items-center justify-center gap-3 p-3 overflow-hidden bg-black/60 w-full min-h-0'
        : 'flex-1 relative flex items-center justify-center p-3 overflow-hidden bg-black/60 w-full min-h-0';
  }

  if (mode === 'sphere') {
    sphereViewContainer.className =
      'relative w-full h-full rounded-xl overflow-hidden border border-cyan-500/20 shadow-2xl flex items-center justify-center bg-slate-950 block';
    flatViewContainer.className = 'hidden';
  } else if (mode === 'flat') {
    sphereViewContainer.className = 'hidden';
    flatViewContainer.className =
      'relative w-full h-full rounded-xl overflow-hidden border border-cyan-500/20 shadow-2xl flex items-center justify-center bg-slate-950 block';
  } else if (mode === 'split') {
    sphereViewContainer.className =
      'relative w-1/2 h-full rounded-xl overflow-hidden border border-cyan-500/20 shadow-2xl flex items-center justify-center bg-slate-950 block';
    flatViewContainer.className =
      'relative w-1/2 h-full rounded-xl overflow-hidden border border-cyan-500/20 shadow-2xl flex items-center justify-center bg-slate-950 block';
  }

  // Trigger resize on Three.js
  setTimeout(() => {
    sphereViewport?.onResize();
    processCurrentFrame();
  }, 50);
}

// -------------------------------------------------------------
// Timeline UI Sync
// -------------------------------------------------------------
function syncTimelineUI(state: PlaybackState) {
  // Update timecode texts
  displayTimecode.textContent = formatTimecode(state.currentTime, state.fps);
  displayDuration.textContent = formatTimecode(state.duration, state.fps);
  displayFrame.textContent = `(Frame: ${state.currentFrame} / ${state.totalFrames})`;

  // Progress bar & thumb
  const progressRatio = state.duration > 0 ? state.currentTime / state.duration : 0;
  const progressPercent = (progressRatio * 100).toFixed(2);
  timelineProgressBar.style.width = `${progressPercent}%`;
  timelineThumb.style.left = `${progressPercent}%`;

  // Play / Pause Icon & Text
  if (state.isPlaying) {
    iconPlayPause.setAttribute('data-lucide', 'pause');
    textPlayPause.textContent = 'Pause';
  } else {
    iconPlayPause.setAttribute('data-lucide', 'play');
    textPlayPause.textContent = 'Play';
  }
  refreshIcons();

  processCurrentFrame();
}

// -------------------------------------------------------------
// Right Toolbar Collapse / Expand Management
// -------------------------------------------------------------
function toggleToolbar(forceCollapse?: boolean) {
  const isCurrentlyCollapsed = rightToolbar.classList.contains('collapsed');
  const shouldCollapse = forceCollapse !== undefined ? forceCollapse : !isCurrentlyCollapsed;

  if (shouldCollapse) {
    rightToolbar.classList.add('collapsed');
    btnExpandToolbar.classList.remove('hidden');
    if (bottomTransportWrapper) {
      bottomTransportWrapper.classList.remove('md:right-[calc(24rem+1.5rem)]');
      bottomTransportWrapper.classList.add('md:right-3');
    }
    showToast('Editing tools collapsed — Viewport maximized', 'info', 2000);
  } else {
    rightToolbar.classList.remove('collapsed');
    btnExpandToolbar.classList.add('hidden');
    if (bottomTransportWrapper) {
      bottomTransportWrapper.classList.remove('md:right-3');
      bottomTransportWrapper.classList.add('md:right-[calc(24rem+1.5rem)]');
    }
  }

  // Trigger viewport resize calculation
  sphereViewport?.onResize();
  processCurrentFrame();
  setTimeout(() => {
    sphereViewport?.onResize();
    processCurrentFrame();
  }, 50);
}

// -------------------------------------------------------------
// Accordion Drawers Setup (Matching Vista Spatial)
// -------------------------------------------------------------
function setupAccordions() {
  const drawerHeaders = document.querySelectorAll<HTMLButtonElement>('.drawer-header');

  const updateHeaderStyle = (btn: HTMLButtonElement, isOpen: boolean) => {
    const chevron = btn.querySelector('.drawer-chevron');
    if (isOpen) {
      btn.className =
        'drawer-header w-full px-3 py-2.5 flex items-center justify-between cursor-pointer transition-colors bg-gradient-to-r from-cyan-950/80 to-slate-900/80 border-b border-cyan-500/25 text-white';
      chevron?.classList.add('rotate-180');
      chevron?.classList.add('rotated');
    } else {
      btn.className =
        'drawer-header w-full px-3 py-2.5 flex items-center justify-between cursor-pointer transition-colors text-slate-300 hover:text-white bg-slate-950/30 hover:bg-slate-900/40';
      chevron?.classList.remove('rotate-180');
      chevron?.classList.remove('rotated');
    }
  };

  drawerHeaders.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-drawer-target');
      if (!targetId) return;
      const content = document.getElementById(targetId);
      if (!content) return;

      const isCurrentlyOpen = !content.classList.contains('hidden');

      // Toggle clicked drawer
      if (isCurrentlyOpen) {
        content.classList.add('hidden');
        updateHeaderStyle(btn, false);
      } else {
        content.classList.remove('hidden');
        updateHeaderStyle(btn, true);
      }
    });
  });
}

// -------------------------------------------------------------
// Application Initialization
// -------------------------------------------------------------
async function initApp() {
  refreshIcons();
  setupAccordions();

  // Initialize WebGPU
  const gpuOk = await engine.init(hdrCanvas);
  if (!gpuOk) {
    gpuStatusBadge.className =
      'px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold tracking-wider border flex items-center gap-1.5 shadow-sm select-none bg-red-950/80 border-red-500/40 text-red-300';
    gpuDeviceName.textContent = 'WebGPU Unavailable (Hardware Required)';
    showToast('WebGPU is not supported on this browser. Try Chrome/Edge with hardware acceleration.', 'error', 6000);
    return;
  }

  gpuDeviceName.textContent = `${engine.capabilities.adapterName} (RGBA32Float)`;

  // Initialize Three.js 360 Viewport
  sphereViewport = new SphereViewport(threeContainer, (orientation) => {
    hudYawPitch.textContent = `Yaw: ${orientation.yaw}° | Pitch: ${orientation.pitch}° | FOV: ${orientation.fov}°`;
    if (headingTelemetry) {
      headingTelemetry.textContent = `${orientation.yaw}°`;
    }

    if (selectAeMode.value === 'viewport') {
      const yawRad = (orientation.yaw * Math.PI) / 180;
      const pitchRad = (orientation.pitch * Math.PI) / 180;
      const fovRad = ((orientation.fov * Math.PI) / 180) / 2;
      const x = Math.cos(pitchRad) * Math.sin(yawRad);
      const y = Math.sin(pitchRad);
      const z = -Math.cos(pitchRad) * Math.cos(yawRad);
      engine.setMeteringMode('viewport', [x, y, z], fovRad);
    }
  });

  // Setup ResizeObserver for responsive canvas updates when toolbar collapses or window resizes
  const resizeObserver = new ResizeObserver(() => {
    sphereViewport?.onResize();
    if (currentViewMode === 'flat' || currentViewMode === 'split') {
      const pitchOffsetPx = (horizonAngles.pitch / 45.0) * (hdrCanvas.clientHeight * 0.25);
      flatHorizonLine.style.transform = `translateY(calc(-50% + ${pitchOffsetPx}px)) rotate(${-horizonAngles.roll}deg)`;
    }
  });
  resizeObserver.observe(viewportStage);
  if (document.body) resizeObserver.observe(document.body);
  resizeObserver.observe(threeContainer);
  if (viewportViewsWrapper) resizeObserver.observe(viewportViewsWrapper);

  window.addEventListener('resize', () => {
    sphereViewport?.onResize();
    processCurrentFrame();
  });

  // Setup VideoController callbacks
  videoController.onUpdate((state) => {
    syncTimelineUI(state);
  });
  videoController.init();

  // Export Dropdown Menu toggle and outside click
  const toggleExportDropdown = (forceClose?: boolean) => {
    if (!exportDropdownMenu) return;
    const isCurrentlyOpen = !exportDropdownMenu.classList.contains('hidden');
    const shouldOpen = forceClose ? false : !isCurrentlyOpen;
    if (shouldOpen) {
      exportDropdownMenu.classList.remove('hidden');
      iconExportChevron?.classList.add('rotate-180');
    } else {
      exportDropdownMenu.classList.add('hidden');
      iconExportChevron?.classList.remove('rotate-180');
    }
  };

  btnExportMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExportDropdown();
  });

  window.addEventListener('click', (e) => {
    if (!exportDropdownMenu?.contains(e.target as Node) && e.target !== btnExportMenu) {
      toggleExportDropdown(true);
    }
  });

  // Wire up View Mode Switcher Pills
  btnViewSphere.addEventListener('click', () => setViewMode('sphere'));
  btnViewFlat.addEventListener('click', () => setViewMode('flat'));
  btnViewSplit.addEventListener('click', () => setViewMode('split'));

  // Wire up Toolbar Collapse / Expand Buttons
  btnToggleToolbar?.addEventListener('click', () => toggleToolbar(true));
  btnExpandToolbar.addEventListener('click', () => toggleToolbar(false));

  // Wire up Color Grading Sliders
  const bindSlider = (
    slider: HTMLInputElement,
    display: HTMLSpanElement,
    unit: string,
    key: keyof ColorGradingParams,
    formatter: (v: number) => string = (v) => v.toFixed(2)
  ) => {
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      display.textContent = `${formatter(val)} ${unit}`.trim();
      (currentGrading as any)[key] = val;
      if (key === 'exposure') {
        engine.getAutoExposureEngine().reset(val);
      }
      processCurrentFrame();
    });
  };

  bindSlider(paramExposure, valExposure, 'EV', 'exposure', (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)));
  bindSlider(paramTemperature, valTemperature, 'K', 'temperature', (v) => Math.round(v).toString());
  bindSlider(paramTint, valTint, '', 'tint', (v) => (v >= 0 ? `+${Math.round(v)}` : Math.round(v).toString()));
  bindSlider(paramHighlights, valHighlights, '', 'highlights');
  bindSlider(paramShadows, valShadows, '', 'shadows');
  bindSlider(paramContrast, valContrast, '', 'contrast');
  bindSlider(paramSaturation, valSaturation, '', 'saturation');

  // -------------------------------------------------------------
  // Auto Exposure (AE) Controls
  // -------------------------------------------------------------
  // One-Shot AE Match
  btnAeOneshot.addEventListener('click', async () => {
    try {
      const hist = latestHistogram || (await engine.readbackHistogram());
      latestHistogram = hist;
      let targetEV = engine.calculateAutoExposureFromHistogram(hist.luma);
      targetEV = Math.max(-5.0, Math.min(5.0, targetEV));
      currentGrading.exposure = targetEV;
      paramExposure.value = targetEV.toFixed(2);
      valExposure.textContent = (targetEV >= 0 ? '+' : '') + targetEV.toFixed(2) + ' EV';
      engine.updateGrading(currentGrading);
      processCurrentFrame();
      showToast(`Auto Exposure: ${targetEV >= 0 ? '+' : ''}${targetEV.toFixed(2)} EV calibrated`, 'success', 2500);
    } catch (err: any) {
      showToast(`Auto Exposure failed: ${err.message}`, 'error', 3000);
    }
  });

  // Continuous AE Toggle
  btnAeContinuous.addEventListener('click', () => {
    isContinuousAE = !isContinuousAE;
    lastAETime = performance.now();
    if (isContinuousAE) {
      engine.getAutoExposureEngine().reset(currentGrading.exposure);
      btnAeContinuous.className =
        'px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all cursor-pointer flex items-center gap-1.5 bg-cyan-950/80 border-cyan-400/60 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]';
      aeContinuousDot.className = 'w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse';
    } else {
      btnAeContinuous.className =
        'px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all cursor-pointer flex items-center gap-1.5 bg-slate-900 border-slate-700/80 text-slate-400 hover:border-cyan-500/40';
      aeContinuousDot.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
    }
  });

  // Metering Mode Selector
  selectAeMode.addEventListener('change', () => {
    const fovRadians = ((sphereViewport?.getOrientation().fov || 75) * Math.PI) / 180;
    const halfFovRad = fovRadians / 2;
    engine.setMeteringMode(selectAeMode.value as AutoExposureMode, getCameraDirectionVector(), halfFovRad);
    showToast(`AE Metering Mode: ${selectAeMode.options[selectAeMode.selectedIndex].text}`, 'info', 1500);
  });

  // Target EV Compensation Slider
  paramAeCompensation.addEventListener('input', () => {
    const val = parseFloat(paramAeCompensation.value);
    valAeCompensation.textContent = (val >= 0 ? '+' : '') + val.toFixed(1) + ' EV';
    engine.getAutoExposureEngine().setCompensation(val);
  });

  // -------------------------------------------------------------
  // White Balance Tools (Auto WB & Eyedropper)
  // -------------------------------------------------------------
  btnAwbOneshot.addEventListener('click', async () => {
    try {
      const hist = latestHistogram || (await engine.readbackHistogram());
      latestHistogram = hist;
      const { temperature, tint } = calculateAutoWhiteBalance(
        hist.r,
        hist.g,
        hist.b,
        currentGrading.temperature,
        currentGrading.tint
      );
      currentGrading.temperature = temperature;
      currentGrading.tint = tint;
      paramTemperature.value = temperature.toString();
      valTemperature.textContent = `${Math.round(temperature)} K`;
      paramTint.value = tint.toString();
      valTint.textContent = `${tint >= 0 ? '+' : ''}${Math.round(tint)}`;
      engine.updateGrading(currentGrading);
      processCurrentFrame();
      showToast(`Auto WB: ${temperature}K, Tint ${tint >= 0 ? '+' : ''}${tint}`, 'success');
    } catch (err: any) {
      showToast(`Auto WB failed: ${err.message}`, 'error', 3000);
    }
  });

  const setEyedropperState = (active: boolean) => {
    isEyedropperActive = active;
    if (active) {
      btnEyedropper.className =
        'px-2 py-0.5 rounded-md text-[10px] font-bold text-white bg-cyan-600 border border-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.8)] flex items-center gap-1 transition cursor-pointer active:scale-95 animate-pulse';
      textEyedropper.textContent = 'Pick 360 Neutral';
      viewportStage.style.cursor = 'crosshair';
      threeContainer.style.cursor = 'crosshair';
      hdrCanvas.style.cursor = 'crosshair';
      showToast('Click anywhere on 360 view or canvas to sample neutral gray', 'info', 3000);
    } else {
      btnEyedropper.className =
        'px-2 py-0.5 rounded-md text-[10px] font-bold text-slate-300 bg-slate-900 border border-slate-700 hover:border-cyan-400 hover:text-white flex items-center gap-1 transition cursor-pointer active:scale-95';
      textEyedropper.textContent = 'Eyedropper';
      viewportStage.style.cursor = '';
      threeContainer.style.cursor = '';
      hdrCanvas.style.cursor = '';
    }
  };

  btnEyedropper.addEventListener('click', () => {
    setEyedropperState(!isEyedropperActive);
  });

  const handleEyedropperSample = (e: MouseEvent) => {
    if (!isEyedropperActive) return;
    e.stopPropagation();

    let sample: { r: number; g: number; b: number } | null = null;
    if (sphereViewport && (currentViewMode === 'sphere' || currentViewMode === 'split')) {
      sample = sphereViewport.samplePixel(e.clientX, e.clientY);
    }

    if (!sample && sphereViewport) {
      const intermediate = sphereViewport.getIntermediateCanvas();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const x = Math.floor(u * (intermediate.width - 1));
      const y = Math.floor(v * (intermediate.height - 1));
      const ctx2d = intermediate.getContext('2d');
      if (ctx2d) {
        const p = ctx2d.getImageData(x, y, 1, 1).data;
        sample = { r: p[0] / 255.0, g: p[1] / 255.0, b: p[2] / 255.0 };
      }
    }

    if (sample) {
      const { temperature, tint } = calculateEyedropperBalance(
        sample.r,
        sample.g,
        sample.b,
        currentGrading.temperature,
        currentGrading.tint
      );
      currentGrading.temperature = temperature;
      currentGrading.tint = tint;
      paramTemperature.value = temperature.toString();
      valTemperature.textContent = `${Math.round(temperature)} K`;
      paramTint.value = tint.toString();
      valTint.textContent = `${tint >= 0 ? '+' : ''}${Math.round(tint)}`;
      engine.updateGrading(currentGrading);
      processCurrentFrame();
      showToast(`Eyedropper: Balanced to ${temperature}K, Tint ${tint >= 0 ? '+' : ''}${tint}`, 'success');
    }
    setEyedropperState(false);
  };

  threeContainer.addEventListener('click', handleEyedropperSample, true);
  hdrCanvas.addEventListener('click', handleEyedropperSample, true);

  // -------------------------------------------------------------
  // Diagnostic Monitoring Mode (False Color & Zebras)
  // -------------------------------------------------------------
  const updateDiagnosticButtons = () => {
    const isFC = diagnosticMode === 'false_color';
    const isZB = diagnosticMode === 'zebras';

    btnToggleFalseColor.className = isFC
      ? 'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-bold text-white bg-gradient-to-r from-cyan-600 to-blue-600 border border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.6)] cursor-pointer transition active:scale-95 flex items-center gap-1.5'
      : 'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400/60 shadow-lg cursor-pointer transition active:scale-95 flex items-center gap-1.5';

    btnToggleZebras.className = isZB
      ? 'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-bold text-amber-100 bg-gradient-to-r from-amber-600 to-yellow-600 border border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.6)] cursor-pointer transition active:scale-95 flex items-center gap-1.5'
      : 'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400/60 shadow-lg cursor-pointer transition active:scale-95 flex items-center gap-1.5';

    engine.setDiagnosticMode(diagnosticMode, zebraThreshold);
    processCurrentFrame();
  };

  btnToggleFalseColor.addEventListener('click', () => {
    diagnosticMode = diagnosticMode === 'false_color' ? 'normal' : 'false_color';
    updateDiagnosticButtons();
    showToast(`False Color: ${diagnosticMode === 'false_color' ? 'Enabled (ARRI/RED)' : 'Disabled'}`, 'info', 1500);
  });

  btnToggleZebras.addEventListener('click', () => {
    diagnosticMode = diagnosticMode === 'zebras' ? 'normal' : 'zebras';
    updateDiagnosticButtons();
    showToast(
      `Zebras: ${diagnosticMode === 'zebras' ? `Enabled (${Math.round(zebraThreshold * 100)}% IRE)` : 'Disabled'}`,
      'info',
      1500
    );
  });

  paramZebraThreshold.addEventListener('input', () => {
    const val = parseInt(paramZebraThreshold.value, 10);
    valZebraThreshold.textContent = `${val}% IRE`;
    zebraThreshold = val / 100.0;
    engine.setDiagnosticMode(diagnosticMode, zebraThreshold);
    if (diagnosticMode === 'zebras') {
      processCurrentFrame();
    }
  });

  // -------------------------------------------------------------
  // A/B Wipe Comparison Controls & Dragging
  // -------------------------------------------------------------
  const toggleAbWipe = () => {
    isAbWipeActive = !isAbWipeActive;
    if (isAbWipeActive) {
      abWipeOverlay.classList.remove('hidden');
      btnToggleAbWipe.className =
        'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-semibold text-white bg-gradient-to-r from-cyan-600/90 to-blue-600/90 border border-cyan-300/40 shadow-[0_0_12px_rgba(6,182,212,0.45)] cursor-pointer transition active:scale-95 flex items-center gap-1.5';
      engine.setWipeMode('vertical', wipePosition, true);
    } else {
      abWipeOverlay.classList.add('hidden');
      btnToggleAbWipe.className =
        'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400/60 shadow-lg cursor-pointer transition active:scale-95 flex items-center gap-1.5';
      engine.setWipeMode('off');
    }
    processCurrentFrame();
  };

  btnToggleAbWipe.addEventListener('click', toggleAbWipe);

  // Wire interactive dragging on #ab-wipe-divider
  abWipeDivider.addEventListener('pointerdown', (e) => {
    isDraggingWipe = true;
    e.stopPropagation();
  });
  abWipeDivider.addEventListener('mousedown', (e) => {
    isDraggingWipe = true;
    e.stopPropagation();
  });

  const handleWipeMove = (clientX: number) => {
    if (!isDraggingWipe) return;
    const wrapper = viewportViewsWrapper || viewportStage;
    const wrapperRect = wrapper.getBoundingClientRect();
    if (wrapperRect.width <= 0) return;
    const x = (clientX - wrapperRect.left) / wrapperRect.width;
    const pos = Math.max(0.05, Math.min(0.95, x));
    wipePosition = pos;
    abWipeDivider.style.left = (pos * 100).toFixed(1) + '%';
    engine.setWipeMode('vertical', wipePosition, true);
    processCurrentFrame();
  };

  window.addEventListener('pointermove', (e) => {
    if (isDraggingWipe) handleWipeMove(e.clientX);
  });
  window.addEventListener('mousemove', (e) => {
    if (isDraggingWipe) handleWipeMove(e.clientX);
  });

  window.addEventListener('pointerup', () => {
    isDraggingWipe = false;
  });
  window.addEventListener('mouseup', () => {
    isDraggingWipe = false;
  });

  // -------------------------------------------------------------
  // 360° Optical Filters (GND & Sky Polarizer)
  // -------------------------------------------------------------
  const updateOpticalFilters = () => {
    const gndExposure = parseFloat(paramGndExposure.value);
    const pivotDeg = parseFloat(paramGndPivot.value);
    const featherDeg = parseFloat(paramGndFeather.value);
    const polarizerPct = parseFloat(paramSkyPolarizer.value);

    valGndExposure.textContent = `${gndExposure >= 0 ? '+' : ''}${gndExposure.toFixed(2)} EV`;
    valGndPivot.textContent = `${pivotDeg}°`;
    valGndFeather.textContent = `${featherDeg}°`;
    valSkyPolarizer.textContent = `${polarizerPct}%`;

    const pivotRad = (pivotDeg * Math.PI) / 180;
    const featherRad = (featherDeg * Math.PI) / 180;
    const skyPolarizer = polarizerPct / 100.0;

    engine.setOpticalFilters({
      gndExposure,
      gndHorizonOffset: pivotRad,
      gndFeather: featherRad,
      skyPolarizer,
    });
    processCurrentFrame();
  };

  paramGndExposure.addEventListener('input', updateOpticalFilters);
  paramGndPivot.addEventListener('input', updateOpticalFilters);
  paramGndFeather.addEventListener('input', updateOpticalFilters);
  paramSkyPolarizer.addEventListener('input', updateOpticalFilters);

  const resetOpticalFilters = (showNotification: boolean = true) => {
    paramGndExposure.value = '0.0';
    paramGndPivot.value = '0';
    paramGndFeather.value = '20';
    paramSkyPolarizer.value = '0';

    valGndExposure.textContent = '0.00 EV';
    valGndPivot.textContent = '0°';
    valGndFeather.textContent = '20°';
    valSkyPolarizer.textContent = '0%';

    engine.setOpticalFilters({
      gndExposure: 0,
      gndHorizonOffset: 0,
      gndFeather: 0.35,
      skyPolarizer: 0,
    });
    processCurrentFrame();
    if (showNotification) {
      showToast('Optical filters reset', 'info', 1500);
    }
  };

  btnResetOpticalFilters.addEventListener('click', () => resetOpticalFilters(true));

  // Input Profile Pill Sync & Selection
  const profilePills: { btn: HTMLButtonElement; val: string }[] = [
    { btn: btnProfileDlog, val: 'dlog' },
    { btn: btnProfileDlogM, val: 'dlog_m' },
    { btn: btnProfileLinear, val: 'linear' },
    { btn: btnProfileSrgb, val: 'srgb' },
  ];

  const updateProfilePillStyles = (activeVal: string) => {
    profilePills.forEach(({ btn, val }) => {
      if (val === activeVal) {
        btn.className =
          'profile-pill-btn px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border border-cyan-400/40 bg-cyan-950/70 text-cyan-200 hover:text-white transition cursor-pointer text-center';
      } else {
        btn.className =
          'profile-pill-btn px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border border-slate-700/60 bg-slate-900/60 text-slate-300 hover:text-white transition cursor-pointer text-center';
      }
    });
  };

  profilePills.forEach(({ btn, val }) => {
    btn.addEventListener('click', () => {
      inputProfileSelect.value = val;
      inputProfileSelect.dispatchEvent(new Event('change'));
    });
  });

  inputProfileSelect.addEventListener('change', () => {
    currentGrading.inputLogType = inputProfileSelect.value as any;
    updateProfilePillStyles(inputProfileSelect.value);
    processCurrentFrame();
  });

  // Tone Mapping Change
  tonemapSelect.addEventListener('change', () => {
    engine.setDisplayOptions(tonemapSelect.value as any);
    processCurrentFrame();
  });

  // Reset Color Grade
  btnResetGrade.addEventListener('click', () => {
    currentGrading = { ...DEFAULT_GRADING_PARAMS };
    paramExposure.value = '0.0';
    paramTemperature.value = '6500';
    paramTint.value = '0';
    paramHighlights.value = '0.0';
    paramShadows.value = '0.0';
    paramContrast.value = '1.0';
    paramSaturation.value = '1.0';

    valExposure.textContent = '0.00 EV';
    valTemperature.textContent = '6500 K';
    valTint.textContent = '0';
    valHighlights.textContent = '0.00';
    valShadows.textContent = '0.00';
    valContrast.textContent = '1.00';
    valSaturation.textContent = '1.00';

    paramAeCompensation.value = '0.0';
    valAeCompensation.textContent = '0.0 EV';
    engine.getAutoExposureEngine().setCompensation(0.0);
    engine.getAutoExposureEngine().reset(0.0);

    resetOpticalFilters(false);

    processCurrentFrame();
    showToast('Color grading reset to neutral baseline', 'info');
  });

  // Horizon Leveling Sliders & Orientation
  const updateHorizonFromSliders = () => {
    horizonAngles.pitch = parseFloat(paramPitch.value);
    horizonAngles.roll = parseFloat(paramRoll.value);
    horizonAngles.yaw = parseFloat(paramYaw.value);

    valPitch.textContent = `${horizonAngles.pitch >= 0 ? '+' : ''}${horizonAngles.pitch.toFixed(1)}°`;
    valRoll.textContent = `${horizonAngles.roll >= 0 ? '+' : ''}${horizonAngles.roll.toFixed(1)}°`;
    valYaw.textContent = `${horizonAngles.yaw.toFixed(1)}°`;

    sphereViewport?.setHorizon(horizonAngles.pitch, horizonAngles.roll, horizonAngles.yaw);
    processCurrentFrame();
  };

  paramPitch.addEventListener('input', updateHorizonFromSliders);
  paramRoll.addEventListener('input', updateHorizonFromSliders);
  paramYaw.addEventListener('input', updateHorizonFromSliders);

  btnResetHorizon.addEventListener('click', () => {
    paramPitch.value = '0.0';
    paramRoll.value = '0.0';
    paramYaw.value = '0.0';
    updateHorizonFromSliders();
    showToast('Horizon leveling reset to 0°', 'info');
  });

  // Horizon Guide Reticle Toggle Sync (HUD + Drawer 3)
  const updateHorizonGuideState = (visible: boolean) => {
    isHorizonGuideVisible = visible;
    horizonReticle.style.display = isHorizonGuideVisible ? 'flex' : 'none';
    btnToggleHorizonGuide.textContent = `Horizon Guide: ${isHorizonGuideVisible ? 'ON' : 'OFF'}`;
    btnDrawerHorizonGuide.textContent = `Reticle: ${isHorizonGuideVisible ? 'ON' : 'OFF'}`;
    if (currentViewMode === 'flat' || currentViewMode === 'split') {
      flatHorizonLine.style.display = isHorizonGuideVisible ? 'block' : 'none';
    }
  };

  btnToggleHorizonGuide.addEventListener('click', () => {
    updateHorizonGuideState(!isHorizonGuideVisible);
  });

  btnDrawerHorizonGuide.addEventListener('click', () => {
    updateHorizonGuideState(!isHorizonGuideVisible);
  });

  // Recenter Camera (HUD + Drawer 3)
  btnRecenterCam.addEventListener('click', () => {
    sphereViewport?.resetCamera();
    showToast('Camera recentered to forward view', 'info');
  });

  btnRecenterCamDrawer.addEventListener('click', () => {
    sphereViewport?.resetCamera();
    showToast('Camera recentered to forward view', 'info');
  });

  // -------------------------------------------------------------
  // 3D LUT (.cube) Integration
  // -------------------------------------------------------------
  const applyLoadedLUT = (lut: CubeLUT) => {
    currentLUT = lut;
    lutFilename.textContent = lut.title;
    lutSizeBadge.textContent = `${lut.size}×${lut.size}×${lut.size}`;
    lutStrengthContainer.classList.remove('opacity-50', 'pointer-events-none');
    isLutBypassed = false;
    btnLutToggle.textContent = 'Bypass';
    btnLutToggle.className =
      'px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-950 border border-cyan-500/40 text-cyan-300 transition cursor-pointer';

    const strength = parseFloat(paramLutStrength.value) / 100.0;
    engine.set3DLUT(lut, strength, true);
    processCurrentFrame();
    showToast(`Loaded 3D LUT: "${lut.title}" (${lut.size}³)`, 'success');
  };

  btnLutPreset.addEventListener('click', () => {
    const preset = createCinematicPresetLUT(17);
    applyLoadedLUT(preset);
  });

  btnLutToggle.addEventListener('click', () => {
    if (!currentLUT) return;
    isLutBypassed = !isLutBypassed;
    engine.setLUTEnabled(!isLutBypassed);
    btnLutToggle.textContent = isLutBypassed ? 'Enable' : 'Bypass';
    btnLutToggle.className = isLutBypassed
      ? 'px-2 py-0.5 rounded text-[10px] font-medium bg-red-950 border border-red-500/40 text-red-300 transition cursor-pointer'
      : 'px-2 py-0.5 rounded text-[10px] font-medium bg-cyan-950 border border-cyan-500/40 text-cyan-300 transition cursor-pointer';
    processCurrentFrame();
  });

  paramLutStrength.addEventListener('input', () => {
    const val = parseFloat(paramLutStrength.value);
    valLutStrength.textContent = `${Math.round(val)}%`;
    engine.setLUTStrength(val / 100.0);
    processCurrentFrame();
  });

  lutDropzone.addEventListener('click', () => lutFileInput.click());

  lutFileInput.addEventListener('change', async () => {
    const file = lutFileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCubeLUT(text);
      if (!parsed.title || parsed.title === 'Custom LUT') {
        parsed.title = file.name.replace(/\.[^/.]+$/, '');
      }
      applyLoadedLUT(parsed);
    } catch (err: any) {
      showToast(`Error parsing .cube file: ${err.message}`, 'error', 5000);
    }
  });

  // -------------------------------------------------------------
  // 360° Nadir Mask & Tripod Patch
  // -------------------------------------------------------------
  const updateNadirState = () => {
    if (isNadirActive) {
      btnToggleNadir.className =
        'px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all cursor-pointer flex items-center gap-1 bg-cyan-950/80 border-cyan-400/60 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.3)]';
      nadirStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse';
      nadirStatusText.textContent = 'ON';
    } else {
      btnToggleNadir.className =
        'px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all cursor-pointer flex items-center gap-1 bg-slate-950 border-slate-700 text-slate-400 hover:border-cyan-500/40';
      nadirStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
      nadirStatusText.textContent = 'OFF';
    }

    const radiusNorm = parseFloat(paramNadirRadius.value) / 100.0;
    const featherNorm = (parseFloat(paramNadirFeather.value) / 100.0) * 0.15;
    engine.setNadirPatch(isNadirActive ? nadirMode : 'off', radiusNorm, featherNorm);
    processCurrentFrame();
  };

  btnToggleNadir.addEventListener('click', () => {
    isNadirActive = !isNadirActive;
    updateNadirState();
    showToast(`360° Nadir Patch: ${isNadirActive ? 'ON (' + nadirMode + ')' : 'OFF'}`, 'info', 1500);
  });

  selectNadirMode.addEventListener('change', () => {
    nadirMode = selectNadirMode.value as any;
    updateNadirState();
  });

  paramNadirRadius.addEventListener('input', () => {
    const val = parseInt(paramNadirRadius.value, 10);
    valNadirRadius.textContent = `${val}°`;
    updateNadirState();
  });

  paramNadirFeather.addEventListener('input', () => {
    const val = parseInt(paramNadirFeather.value, 10);
    valNadirFeather.textContent = `${val}%`;
    updateNadirState();
  });

  // -------------------------------------------------------------
  // Scope View Mode Tabs
  // -------------------------------------------------------------
  const scopeTabs: { btn: HTMLButtonElement; mode: ScopeMode; label: string }[] = [
    { btn: btnScopeHist, mode: 'hist', label: 'WebGPU Live Histogram' },
    { btn: btnScopeWaveform, mode: 'waveform', label: 'WebGPU Panoramic Waveform (0°-360°)' },
    { btn: btnScopeParade, mode: 'parade', label: 'WebGPU RGB Parade (IRE)' },
    { btn: btnScopeVector, mode: 'vector', label: 'WebGPU Vectorscope (SMPTE 75% + Skin)' },
  ];

  const setScopeMode = (mode: ScopeMode) => {
    currentScopeMode = mode;
    scopeTabs.forEach(({ btn, mode: tabMode, label }) => {
      if (tabMode === mode) {
        btn.className =
          'scope-tab-btn py-1 px-1 rounded-md text-[10px] font-bold text-center transition cursor-pointer bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-sm';
        if (scopeModeLabel) scopeModeLabel.textContent = label;
      } else {
        btn.className =
          'scope-tab-btn py-1 px-1 rounded-md text-[10px] font-bold text-center transition cursor-pointer text-slate-400 hover:text-slate-200';
      }
    });

    if (histLegend) {
      if (mode === 'hist') {
        histLegend.innerHTML = '<span>0 (Shadows)</span><span>Mid (0.18)</span><span>1.0+ (Highlights)</span>';
      } else if (mode === 'waveform') {
        histLegend.innerHTML = '<span>0° (Yaw)</span><span>180° (Center)</span><span>360° (Yaw)</span>';
      } else if (mode === 'parade') {
        histLegend.innerHTML =
          '<span class="text-red-400">RED</span><span class="text-green-400">GREEN</span><span class="text-blue-400">BLUE</span>';
      } else if (mode === 'vector') {
        histLegend.innerHTML =
          '<span>-Cb (Cyan)</span><span class="text-amber-400">+Cr / I-Axis (Skin)</span><span>+Cb (Magenta)</span>';
      }
    }

    renderCurrentScope();
    if (mode !== 'hist' && !isHdrReadbackBusy) {
      isHdrReadbackBusy = true;
      engine.readbackHDR()
        .then(({ data, width, height }) => {
          cachedHdrData = data;
          cachedHdrWidth = width;
          cachedHdrHeight = height;
          renderCurrentScope();
        })
        .catch(() => {})
        .finally(() => {
          isHdrReadbackBusy = false;
        });
    }
  };

  scopeTabs.forEach(({ btn, mode }) => {
    btn.addEventListener('click', () => setScopeMode(mode));
  });

  // -------------------------------------------------------------
  // TopBar Reset All Action
  // -------------------------------------------------------------
  btnResetAll.addEventListener('click', () => {
    // Reset grade
    currentGrading = { ...DEFAULT_GRADING_PARAMS };
    paramExposure.value = '0.0';
    paramTemperature.value = '6500';
    paramTint.value = '0';
    paramHighlights.value = '0.0';
    paramShadows.value = '0.0';
    paramContrast.value = '1.0';
    paramSaturation.value = '1.0';

    valExposure.textContent = '0.00 EV';
    valTemperature.textContent = '6500 K';
    valTint.textContent = '0';
    valHighlights.textContent = '0.00';
    valShadows.textContent = '0.00';
    valContrast.textContent = '1.00';
    valSaturation.textContent = '1.00';

    // Reset horizon
    paramPitch.value = '0.0';
    paramRoll.value = '0.0';
    paramYaw.value = '0.0';
    horizonAngles = { pitch: 0, roll: 0, yaw: 0 };
    valPitch.textContent = '0.0°';
    valRoll.textContent = '0.0°';
    valYaw.textContent = '0.0°';
    sphereViewport?.setHorizon(0, 0, 0);

    // Reset profile & tonemap
    inputProfileSelect.value = 'dlog';
    currentGrading.inputLogType = 'dlog';
    updateProfilePillStyles('dlog');

    tonemapSelect.value = 'aces';
    engine.setDisplayOptions('aces');

    // Reset LUT strength
    paramLutStrength.value = '100';
    valLutStrength.textContent = '100%';
    engine.setLUTStrength(1.0);

    // Reset Auto Exposure
    paramAeCompensation.value = '0.0';
    valAeCompensation.textContent = '0.0 EV';
    selectAeMode.value = 'evaluative';
    engine.setMeteringMode('evaluative');
    engine.getAutoExposureEngine().setCompensation(0.0);
    engine.getAutoExposureEngine().reset(0.0);
    if (isContinuousAE) {
      isContinuousAE = false;
      btnAeContinuous.className =
        'px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all cursor-pointer flex items-center gap-1.5 bg-slate-900 border-slate-700/80 text-slate-400 hover:border-cyan-500/40';
      aeContinuousDot.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
    }

    // Reset Diagnostic Mode
    diagnosticMode = 'normal';
    zebraThreshold = 0.95;
    paramZebraThreshold.value = '95';
    valZebraThreshold.textContent = '95% IRE';
    btnToggleFalseColor.className =
      'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400/60 shadow-lg cursor-pointer transition active:scale-95 flex items-center gap-1.5';
    btnToggleZebras.className =
      'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400/60 shadow-lg cursor-pointer transition active:scale-95 flex items-center gap-1.5';
    engine.setDiagnosticMode('normal', 0.95);

    // Reset Nadir Patch
    isNadirActive = false;
    nadirMode = 'mirror';
    selectNadirMode.value = 'mirror';
    paramNadirRadius.value = '12';
    valNadirRadius.textContent = '12°';
    paramNadirFeather.value = '30';
    valNadirFeather.textContent = '30%';
    btnToggleNadir.className =
      'px-2 py-0.5 rounded-full text-[10px] font-mono border transition-all cursor-pointer flex items-center gap-1 bg-slate-950 border-slate-700 text-slate-400 hover:border-cyan-500/40';
    nadirStatusDot.className = 'w-1.5 h-1.5 rounded-full bg-slate-500';
    nadirStatusText.textContent = 'OFF';
    engine.setNadirPatch('off', 0.12, 0.04);

    // Reset Scope Mode
    setScopeMode('hist');

    // Reset Optical Filters
    resetOpticalFilters(false);

    // Reset A/B Wipe
    if (isAbWipeActive) {
      isAbWipeActive = false;
      abWipeOverlay.classList.add('hidden');
      btnToggleAbWipe.className =
        'glass-pill px-2.5 py-1 rounded-lg text-[10px] font-semibold text-slate-300 hover:text-white border border-cyan-500/30 hover:border-cyan-400/60 shadow-lg cursor-pointer transition active:scale-95 flex items-center gap-1.5';
      engine.setWipeMode('off');
    }

    processCurrentFrame();
    showToast('All grading & horizon settings reset to defaults', 'info');
  });

  // -------------------------------------------------------------
  // Video Loading & Drag & Drop Handling
  // -------------------------------------------------------------
  btnLoadVideo.addEventListener('click', () => videoFileInput.click());

  const handleSelectedVideo = async (file: File) => {
    try {
      showToast(`Loading video "${file.name}"...`, 'info', 2500);
      await videoController.loadVideoFile(file);
      projectTitleInput.value = file.name.replace(/\.[^/.]+$/, '');
      showToast(`Loaded ${file.name} successfully`, 'success');
      processCurrentFrame();
    } catch (err: any) {
      showToast(err.message || 'Failed to load video', 'error', 5000);
    }
  };

  videoFileInput.addEventListener('change', () => {
    const file = videoFileInput.files?.[0];
    if (file) handleSelectedVideo(file);
  });

  // Window Drag and Drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    dropOverlay.classList.remove('hidden');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth--;
    if (dragDepth <= 0) {
      dropOverlay.classList.add('hidden');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.add('hidden');

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.cube')) {
      file
        .text()
        .then((text) => {
          const parsed = parseCubeLUT(text);
          applyLoadedLUT(parsed);
        })
        .catch((err) => {
          showToast(`Failed to parse LUT: ${err.message}`, 'error');
        });
    } else if (file.type.startsWith('video/') || file.name.match(/\.(mp4|mov|webm)$/i)) {
      handleSelectedVideo(file);
    } else {
      showToast('Unsupported file type. Please drop a video (MP4/MOV) or .cube LUT.', 'error');
    }
  });

  // -------------------------------------------------------------
  // Timeline Track Scrubbing & Hover
  // -------------------------------------------------------------
  let isScrubbing = false;

  const seekFromMouseEvent = (e: MouseEvent) => {
    const rect = timelineTrackContainer.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const state = videoController.getState();
    videoController.seek(ratio * state.duration);
  };

  timelineTrackContainer.addEventListener('mousedown', (e) => {
    isScrubbing = true;
    seekFromMouseEvent(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isScrubbing) {
      seekFromMouseEvent(e);
    }
  });

  window.addEventListener('mouseup', () => {
    if (isScrubbing) {
      isScrubbing = false;
    }
  });

  timelineTrackContainer.addEventListener('mousemove', (e) => {
    const rect = timelineTrackContainer.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const state = videoController.getState();
    const hoverSeconds = ratio * state.duration;

    timelineHoverTooltip.classList.remove('hidden');
    timelineHoverTooltip.style.left = `${(ratio * 100).toFixed(2)}%`;
    timelineHoverTooltip.textContent = formatTimecode(hoverSeconds, state.fps);
  });

  timelineTrackContainer.addEventListener('mouseleave', () => {
    if (!isScrubbing) {
      timelineHoverTooltip.classList.add('hidden');
    }
  });

  // -------------------------------------------------------------
  // Transport Controls
  // -------------------------------------------------------------
  btnPlayPause.addEventListener('click', () => {
    videoController.togglePlay();
  });

  btnStepBack.addEventListener('click', () => {
    videoController.stepBackward();
  });

  btnStepForward.addEventListener('click', () => {
    videoController.stepForward();
  });

  btnToggleLoop.addEventListener('click', () => {
    const isLooping = videoController.toggleLoop();
    btnToggleLoop.className = isLooping
      ? 'p-2 rounded-lg text-cyan-300 bg-cyan-950/60 border border-cyan-500/40 transition-all cursor-pointer shadow-sm active:scale-95'
      : 'p-2 rounded-lg text-slate-500 bg-slate-900 border border-slate-700 transition-all cursor-pointer shadow-sm active:scale-95';
    showToast(`Playback Loop: ${isLooping ? 'Enabled' : 'Disabled'}`, 'info', 1500);
  });

  selectPlaybackRate.addEventListener('change', () => {
    const rate = parseFloat(selectPlaybackRate.value);
    videoController.setPlaybackRate(rate);
    showToast(`Playback Speed: ${rate}×`, 'info', 1500);
  });

  // -------------------------------------------------------------
  // Fullscreen & Keyboard Shortcuts
  // -------------------------------------------------------------
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  btnFullscreen.addEventListener('click', toggleFullscreen);

  window.addEventListener('keydown', (e) => {
    // Ignore keystrokes when typing in inputs
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

    if (e.code === 'Space') {
      e.preventDefault();
      videoController.togglePlay();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      videoController.stepBackward();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      videoController.stepForward();
    } else if (e.code === 'KeyR') {
      sphereViewport?.resetCamera();
    } else if (e.code === 'KeyH') {
      btnResetHorizon.click();
    } else if (e.code === 'KeyF') {
      btnToggleFalseColor.click();
    } else if (e.code === 'KeyZ') {
      btnToggleZebras.click();
    } else if (e.code === 'Backslash' && !e.ctrlKey) {
      e.preventDefault();
      if (engine.getWipeConfig().mode === 'bypass') {
        engine.setWipeMode('off');
        showToast('Bypass: OFF (Graded HDR)', 'info', 1500);
      } else {
        engine.setWipeMode('bypass');
        showToast('Bypass: ON (Raw D-Log)', 'info', 1500);
      }
      processCurrentFrame();
    } else if (e.ctrlKey && (e.code === 'Backslash' || e.code === 'KeyB')) {
      e.preventDefault();
      toggleToolbar();
    }
  });

  // -------------------------------------------------------------
  // High-Fidelity Exporters
  // -------------------------------------------------------------
  btnExportHDR.addEventListener('click', async () => {
    toggleExportDropdown(true);
    showToast('Encoding 32-bit Radiance RGBE RLE...', 'info', 4000);
    btnExportHDR.disabled = true;
    try {
      const { data, width, height } = await engine.readbackHDR();
      const hdrBytes = encodeRGBE(data, width, height, true);
      const filename = `${projectTitleInput.value || 'vista_360'}_radiance.hdr`;
      downloadFile(hdrBytes, filename, 'image/vnd.radiance');
      showToast(`Exported ${filename} (${width}×${height})`, 'success');
    } catch (err: any) {
      showToast(`HDR Export error: ${err.message}`, 'error', 5000);
    } finally {
      btnExportHDR.disabled = false;
    }
  });

  btnExportEXR.addEventListener('click', async () => {
    toggleExportDropdown(true);
    showToast('Encoding OpenEXR (16-bit Half with 360 latlong)...', 'info', 4000);
    btnExportEXR.disabled = true;
    try {
      const { data, width, height } = await engine.readbackHDR();
      const exrBytes = encodeEXR(data, width, height, { halfPrecision: true, is360: true });
      const filename = `${projectTitleInput.value || 'vista_360'}_latlong.exr`;
      downloadFile(exrBytes, filename, 'image/x-exr');
      showToast(`Exported ${filename} (${width}×${height})`, 'success');
    } catch (err: any) {
      showToast(`EXR Export error: ${err.message}`, 'error', 5000);
    } finally {
      btnExportEXR.disabled = false;
    }
  });

  btnExportSDR.addEventListener('click', async () => {
    toggleExportDropdown(true);
    showToast('Exporting Tone-Mapped SDR (PNG)...', 'info', 3000);
    btnExportSDR.disabled = true;
    try {
      const { data, width, height } = await engine.readbackHDR();
      const { blob } = await exportSDR(data, width, height, { format: 'image/png' });
      if (blob) {
        const filename = `${projectTitleInput.value || 'vista_360'}_tonemapped.png`;
        downloadFile(blob, filename, 'image/png');
        showToast(`Exported ${filename} (${width}×${height})`, 'success');
      }
    } catch (err: any) {
      showToast(`SDR Export error: ${err.message}`, 'error', 5000);
    } finally {
      btnExportSDR.disabled = false;
    }
  });

  btnExportBrackets?.addEventListener('click', async () => {
    toggleExportDropdown(true);
    showToast('Capturing 32-bit linear radiometric HDR frame...', 'info');
    btnExportBrackets.disabled = true;
    try {
      const hdr = await engine.readbackHDR();
      showToast('Rendering ±5 EV exposure brackets (-5, 0, +5 EV)...', 'info', 3000);
      const rawToneMode = tonemapSelect?.value;
      const activeToneMapMode: 'aces' | 'reinhard' | 'linear' =
        rawToneMode === 'reinhard' || rawToneMode === 'linear' ? rawToneMode : 'aces';
      const brackets = await generateExposureBracketSet(
        hdr.data,
        hdr.width,
        hdr.height,
        [-5, 0, 5],
        activeToneMapMode
      );
      const projectTitle = projectTitleInput?.value?.trim() || 'vista_360';
      for (const bracket of brackets) {
        const url = URL.createObjectURL(bracket.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectTitle}_${bracket.label}.png`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      showToast('Exported 3-shot exposure bracket set (±5 EV)', 'success', 4000);
    } catch (err: any) {
      showToast(`Bracket Export error: ${err.message}`, 'error', 5000);
    } finally {
      btnExportBrackets.disabled = false;
    }
  });

  // Initial render
  processCurrentFrame();

  // -------------------------------------------------------------
  // PWA Service Worker & Offline Capability
  // -------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    const registerSW = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          if (reg.installing) {
            const sw = reg.installing;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed') {
                showToast('Vista HDR is ready for offline use', 'success', 4000);
              }
            });
          } else if (reg.active && !navigator.onLine) {
            showToast('Vista HDR is ready for offline use', 'success', 3500);
          }
        })
        .catch((err) => {
          console.warn('PWA ServiceWorker registration failed:', err);
        });
    };

    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }
  }

  // -------------------------------------------------------------
  // Native PWA Desktop App Installation
  // -------------------------------------------------------------
  const btnInstallPwa = document.getElementById('btn-install-pwa') as HTMLButtonElement | null;
  let deferredInstallPrompt: any = null;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallPwa) {
      btnInstallPwa.classList.remove('hidden');
      refreshIcons();
      btnInstallPwa.onclick = async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          showToast('Vista HDR installed successfully', 'success', 3500);
        }
        deferredInstallPrompt = null;
        btnInstallPwa.classList.add('hidden');
      };
    }
  });

  window.addEventListener('appinstalled', () => {
    if (btnInstallPwa) btnInstallPwa.classList.add('hidden');
    showToast('Vista HDR is ready for offline use', 'success', 3500);
  });
}

window.addEventListener('DOMContentLoaded', initApp);
