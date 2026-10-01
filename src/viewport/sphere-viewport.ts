/**
 * Vista HDR 360° Spherical Viewport
 * Three.js inverted 360° sphere with real-time dynamic texture streaming,
 * smooth damped orbit controls, and quaternion horizon leveling.
 */

import * as THREE from 'three';

export interface ViewportOrientation {
  yaw: number;
  pitch: number;
  fov: number;
}

export class SphereViewport {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private sphereMesh: THREE.Mesh;
  private sphereMaterial: THREE.MeshBasicMaterial;
  private texture: THREE.CanvasTexture | null = null;
  private intermediateCanvas: HTMLCanvasElement;
  private intermediateCtx: CanvasRenderingContext2D;

  // Orbit state
  private yaw: number = 0;
  private pitch: number = 0;
  private fov: number = 75;
  private targetYaw: number = 0;
  private targetPitch: number = 0;
  private targetFov: number = 75;
  private isDragging: boolean = false;
  private prevMouseX: number = 0;
  private prevMouseY: number = 0;

  // Horizon leveling correction
  private horizonPitch: number = 0;
  private horizonRoll: number = 0;
  private horizonYaw: number = 0;

  // Animation frame
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private onOrientationChange?: (orientation: ViewportOrientation) => void;

  constructor(container: HTMLElement, onOrientationChange?: (orientation: ViewportOrientation) => void) {
    this.container = container;
    this.onOrientationChange = onOrientationChange;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    // 1. Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, width / height, 0.1, 2000);
    this.camera.position.set(0, 0, 0);

    // 2. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: true,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.cursor = 'grab';
    this.container.appendChild(this.renderer.domElement);

    // Intermediate 2D canvas for guaranteed cross-browser texture compatibility
    this.intermediateCanvas = document.createElement('canvas');
    this.intermediateCanvas.width = 1024;
    this.intermediateCanvas.height = 512;
    this.intermediateCtx = this.intermediateCanvas.getContext('2d', { willReadFrequently: true })!;

    // 3. Inverted 360 Sphere
    const geometry = new THREE.SphereGeometry(500, 64, 48);
    geometry.scale(-1, 1, 1); // Invert sphere so we see inside

    this.texture = new THREE.CanvasTexture(this.intermediateCanvas);
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.sphereMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
    });

    this.sphereMesh = new THREE.Mesh(geometry, this.sphereMaterial);
    this.scene.add(this.sphereMesh);

    // 4. Setup Input Controls
    this.setupEventListeners();

    // 5. Setup Resize Observer
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);

    // 6. Start Render Loop
    this.updateCameraRotation();
    this.animate();
  }

  private setupEventListeners() {
    const el = this.renderer.domElement;

    el.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;
      el.style.cursor = 'grabbing';
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.prevMouseX;
      const deltaY = e.clientY - this.prevMouseY;
      this.prevMouseX = e.clientX;
      this.prevMouseY = e.clientY;

      // Sensitivity factor
      const speed = 0.18 * (this.targetFov / 75.0);
      this.targetYaw -= deltaX * speed;
      this.targetPitch += deltaY * speed;
      this.targetPitch = Math.max(-85, Math.min(85, this.targetPitch));
    });

    const stopDragging = (e: PointerEvent) => {
      if (this.isDragging) {
        this.isDragging = false;
        el.style.cursor = 'grab';
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    };

    el.addEventListener('pointerup', stopDragging);
    el.addEventListener('pointercancel', stopDragging);

    // Wheel zoom
    el.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const zoomDelta = e.deltaY * 0.05;
        this.targetFov = Math.max(30, Math.min(105, this.targetFov + zoomDelta));
      },
      { passive: false }
    );
  }

  public updateTextureSource(sourceCanvas: HTMLCanvasElement | HTMLVideoElement) {
    const srcWidth = sourceCanvas instanceof HTMLVideoElement ? sourceCanvas.videoWidth : sourceCanvas.width;
    const srcHeight = sourceCanvas instanceof HTMLVideoElement ? sourceCanvas.videoHeight : sourceCanvas.height;

    if (!srcWidth || !srcHeight) return;

    if (this.intermediateCanvas.width !== srcWidth || this.intermediateCanvas.height !== srcHeight) {
      this.intermediateCanvas.width = srcWidth;
      this.intermediateCanvas.height = srcHeight;
      if (this.texture) {
        this.texture.dispose();
      }
      this.texture = new THREE.CanvasTexture(this.intermediateCanvas);
      this.texture.wrapS = THREE.RepeatWrapping;
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;
      this.sphereMaterial.map = this.texture;
    }

    this.intermediateCtx.drawImage(sourceCanvas, 0, 0, srcWidth, srcHeight);
    if (this.texture) {
      this.texture.needsUpdate = true;
    }
  }

  /**
   * Applies Horizon Leveling rotation quaternion to sphere mesh
   * Corrects camera pitch, roll (tilt), and heading yaw.
   */
  public setHorizon(pitchDeg: number, rollDeg: number, yawDeg: number) {
    this.horizonPitch = pitchDeg;
    this.horizonRoll = rollDeg;
    this.horizonYaw = yawDeg;

    const headingRad = THREE.MathUtils.degToRad(-yawDeg);
    const pitchRad = THREE.MathUtils.degToRad(pitchDeg);
    const rollRad = THREE.MathUtils.degToRad(rollDeg);

    const qHeading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    const qLevel = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, 0, rollRad, 'YXZ'));
    const combinedQuat = qHeading.multiply(qLevel);

    this.sphereMesh.quaternion.copy(combinedQuat);
  }

  public resetHorizon() {
    this.setHorizon(0, 0, 0);
  }

  public resetCamera() {
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.targetFov = 75;
  }

  public getOrientation(): ViewportOrientation {
    return {
      yaw: Math.round(((this.yaw % 360) + 360) % 360),
      pitch: Math.round(this.pitch * 10) / 10,
      fov: Math.round(this.fov * 10) / 10,
    };
  }

  public getIntermediateCanvas(): HTMLCanvasElement {
    return this.intermediateCanvas;
  }

  /**
   * Samples normalized RGB from the 360 sphere texture via raycasting
   */
  public samplePixel(clientX: number, clientY: number): { r: number; g: number; b: number } | null {
    if (!this.renderer || !this.intermediateCtx) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersects = raycaster.intersectObject(this.sphereMesh);

    if (intersects.length > 0 && intersects[0].uv) {
      const uv = intersects[0].uv;
      const x = Math.max(0, Math.min(this.intermediateCanvas.width - 1, Math.floor(uv.x * this.intermediateCanvas.width)));
      const y = Math.max(0, Math.min(this.intermediateCanvas.height - 1, Math.floor((1.0 - uv.y) * this.intermediateCanvas.height)));
      const p = this.intermediateCtx.getImageData(x, y, 1, 1).data;
      return { r: p[0] / 255.0, g: p[1] / 255.0, b: p[2] / 255.0 };
    }

    const u = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const x = Math.floor(u * (this.intermediateCanvas.width - 1));
    const y = Math.floor(v * (this.intermediateCanvas.height - 1));
    const p = this.intermediateCtx.getImageData(x, y, 1, 1).data;
    return { r: p[0] / 255.0, g: p[1] / 255.0, b: p[2] / 255.0 };
  }

  private updateCameraRotation() {
    const phi = THREE.MathUtils.degToRad(90 - this.pitch);
    const theta = THREE.MathUtils.degToRad(this.yaw);

    const target = new THREE.Vector3(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );

    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);

    if (this.onOrientationChange) {
      this.onOrientationChange(this.getOrientation());
    }
  }

  private animate = () => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    // Damping interpolation
    const damping = 0.15;
    const prevYaw = this.yaw;
    const prevPitch = this.pitch;
    const prevFov = this.fov;

    this.yaw += (this.targetYaw - this.yaw) * damping;
    this.pitch += (this.targetPitch - this.pitch) * damping;
    this.fov += (this.targetFov - this.fov) * damping;

    if (
      Math.abs(this.yaw - prevYaw) > 0.001 ||
      Math.abs(this.pitch - prevPitch) > 0.001 ||
      Math.abs(this.fov - prevFov) > 0.001
    ) {
      this.updateCameraRotation();
    }

    this.renderer.render(this.scene, this.camera);
  };

  public onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public destroy() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.texture?.dispose();
    this.sphereMaterial.dispose();
    this.sphereMesh.geometry.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
