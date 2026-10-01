/**
 * Vista HDR Video Timeline & Playback Controller
 * Manages video streaming, procedural D-Log demo simulation, frame stepping,
 * scrubbing, loop, playback speeds, and timecode calculation.
 */

import { DemoSceneGenerator } from './demo-generator.js';

export function formatTimecode(seconds: number, fps: number = 30): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f)}`;
}

export type PlaybackSourceType = 'demo' | 'video';

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  fps: number;
  currentFrame: number;
  totalFrames: number;
  playbackRate: number;
  isLooping: boolean;
  sourceType: PlaybackSourceType;
  videoWidth: number;
  videoHeight: number;
  fileName: string;
}

export class VideoController {
  private videoElement: HTMLVideoElement | null = null;
  private demoGenerator: DemoSceneGenerator;
  private sourceType: PlaybackSourceType = 'demo';
  private fileName: string = 'Demo_DJI_360_DLog.mp4';

  private isPlaying: boolean = false;
  private currentTime: number = 0;
  private duration: number = 10.0; // 10s default for demo
  private fps: number = 30;
  private playbackRate: number = 1.0;
  private isLooping: boolean = true;

  private animationFrameId: number | null = null;
  private lastTimestamp: number = 0;
  private onFrameCallbacks: Array<(state: PlaybackState) => void> = [];

  constructor() {
    this.demoGenerator = new DemoSceneGenerator(1024, 512);
  }

  public init() {
    // Generate initial frame for demo
    this.demoGenerator.renderFrame(0);
    this.notifyUpdate();
  }

  public getSourceType(): PlaybackSourceType {
    return this.sourceType;
  }

  public getState(): PlaybackState {
    const totalFrames = Math.max(1, Math.round(this.duration * this.fps));
    const currentFrame = Math.min(totalFrames - 1, Math.max(0, Math.floor(this.currentTime * this.fps)));

    let videoWidth = 1024;
    let videoHeight = 512;
    if (this.sourceType === 'video' && this.videoElement) {
      videoWidth = this.videoElement.videoWidth || 3840;
      videoHeight = this.videoElement.videoHeight || 1920;
    } else {
      const dim = this.demoGenerator.getDimensions();
      videoWidth = dim.width;
      videoHeight = dim.height;
    }

    return {
      isPlaying: this.isPlaying,
      currentTime: this.currentTime,
      duration: this.duration,
      fps: this.fps,
      currentFrame,
      totalFrames,
      playbackRate: this.playbackRate,
      isLooping: this.isLooping,
      sourceType: this.sourceType,
      videoWidth,
      videoHeight,
      fileName: this.fileName,
    };
  }

  public onUpdate(callback: (state: PlaybackState) => void) {
    this.onFrameCallbacks.push(callback);
  }

  private notifyUpdate() {
    const state = this.getState();
    for (const cb of this.onFrameCallbacks) {
      cb(state);
    }
  }

  public getCurrentSource(): HTMLCanvasElement | HTMLVideoElement | ImageData {
    if (this.sourceType === 'video' && this.videoElement) {
      return this.videoElement;
    }
    const progress = (this.currentTime % this.duration) / this.duration;
    return this.demoGenerator.renderFrame(progress);
  }

  public play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.lastTimestamp = performance.now();

    if (this.sourceType === 'video' && this.videoElement) {
      this.videoElement.playbackRate = this.playbackRate;
      this.videoElement.loop = this.isLooping;
      this.videoElement.play().catch((err) => {
        console.warn('Video play interrupted:', err);
      });
    }

    this.tick();
    this.notifyUpdate();
  }

  public pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.sourceType === 'video' && this.videoElement) {
      this.videoElement.pause();
    }

    this.notifyUpdate();
  }

  public togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  public seek(seconds: number) {
    this.currentTime = Math.max(0, Math.min(this.duration, seconds));
    if (this.sourceType === 'video' && this.videoElement) {
      this.videoElement.currentTime = this.currentTime;
    }
    this.notifyUpdate();
  }

  public seekFrame(frame: number) {
    const total = Math.max(1, Math.round(this.duration * this.fps));
    const target = Math.max(0, Math.min(total - 1, frame));
    this.seek(target / this.fps);
  }

  public stepForward() {
    this.pause();
    const frame = Math.floor(this.currentTime * this.fps) + 1;
    this.seekFrame(frame);
  }

  public stepBackward() {
    this.pause();
    const frame = Math.floor(this.currentTime * this.fps) - 1;
    this.seekFrame(frame);
  }

  public setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    if (this.sourceType === 'video' && this.videoElement) {
      this.videoElement.playbackRate = rate;
    }
    this.notifyUpdate();
  }

  public toggleLoop(): boolean {
    this.isLooping = !this.isLooping;
    if (this.sourceType === 'video' && this.videoElement) {
      this.videoElement.loop = this.isLooping;
    }
    this.notifyUpdate();
    return this.isLooping;
  }

  public async loadVideoFile(file: File): Promise<void> {
    this.pause();

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.load();
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.muted = true;
    video.preload = 'auto';

    const url = URL.createObjectURL(file);
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        resolve();
      };
      video.onerror = (e) => {
        reject(new Error(`Failed to load video: ${file.name}`));
      };
    });

    this.videoElement = video;
    this.sourceType = 'video';
    this.fileName = file.name;
    this.duration = video.duration || 10.0;
    this.currentTime = 0;
    video.currentTime = 0;
    video.playbackRate = this.playbackRate;
    video.loop = this.isLooping;

    this.notifyUpdate();
  }

  public loadDemo() {
    this.pause();
    if (this.videoElement) {
      this.videoElement.src = '';
      this.videoElement = null;
    }

    this.sourceType = 'demo';
    this.fileName = 'DJI_Mavic3_360_Sunset_DLog.mp4 (Simulated)';
    this.duration = 10.0;
    this.currentTime = 0;
    this.demoGenerator.renderFrame(0);
    this.notifyUpdate();
  }

  private tick = () => {
    if (!this.isPlaying) return;

    const now = performance.now();
    const deltaSeconds = (now - this.lastTimestamp) / 1000.0;
    this.lastTimestamp = now;

    if (this.sourceType === 'video' && this.videoElement) {
      this.currentTime = this.videoElement.currentTime;
      if (this.videoElement.ended) {
        if (this.isLooping) {
          this.videoElement.currentTime = 0;
          this.videoElement.play().catch(() => {});
        } else {
          this.pause();
          return;
        }
      }
    } else {
      // Demo playback
      this.currentTime += deltaSeconds * this.playbackRate;
      if (this.currentTime >= this.duration) {
        if (this.isLooping) {
          this.currentTime = this.currentTime % this.duration;
        } else {
          this.currentTime = this.duration;
          this.pause();
          return;
        }
      }
    }

    this.notifyUpdate();
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  public destroy() {
    this.pause();
    if (this.videoElement) {
      this.videoElement.src = '';
      this.videoElement = null;
    }
    this.onFrameCallbacks = [];
  }
}
