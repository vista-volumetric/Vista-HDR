/**
 * Vista HDR 360° D-Log Procedural Demo Flight Generator
 * Generates continuous, animated 2:1 equirectangular drone aerial footage
 * simulating raw DJI D-Log sensor data with high dynamic range highlights.
 */

export class DemoSceneGenerator {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(width: number = 1024, height: number = 512) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  resize(width: number, height: number) {
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  getDimensions() {
    return { width: this.width, height: this.height };
  }

  getCanvas() {
    return this.canvas;
  }

  /**
   * Generates a 360 equirectangular DJI D-Log frame for a given animation progress [0.0, 1.0]
   */
  renderFrame(progress: number): ImageData {
    const { width, height, ctx } = this;
    const time = progress * Math.PI * 2;

    ctx.clearRect(0, 0, width, height);

    // 1. Equirectangular Sky Dome Gradient (in D-Log muted baseline)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
    // Upper zenith (deep cyan-tinted atmospheric D-Log tone)
    skyGrad.addColorStop(0.0, 'rgb(35, 60, 90)');
    skyGrad.addColorStop(0.25, 'rgb(55, 80, 110)');
    // Upper horizon haze
    skyGrad.addColorStop(0.44, 'rgb(145, 125, 110)');
    // Horizon sunset glow band
    skyGrad.addColorStop(0.50, 'rgb(215, 175, 130)');
    // Coastal ocean horizon
    skyGrad.addColorStop(0.52, 'rgb(45, 65, 75)');
    // Ocean deep nadir
    skyGrad.addColorStop(0.85, 'rgb(28, 42, 50)');
    skyGrad.addColorStop(1.0, 'rgb(18, 28, 35)');

    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Volumetric Clouds in upper hemisphere
    ctx.save();
    for (let c = 0; c < 5; c++) {
      const cloudPhase = (progress * 0.4 + c * 0.2) % 1.0;
      const cloudX = (cloudPhase * width * 1.5) % (width + 300) - 150;
      const cloudY = height * (0.15 + c * 0.05);
      const cloudRad = 80 + c * 25;

      const cloudGrad = ctx.createRadialGradient(
        cloudX,
        cloudY,
        10,
        cloudX,
        cloudY,
        cloudRad
      );
      cloudGrad.addColorStop(0.0, 'rgba(190, 180, 175, 0.35)');
      cloudGrad.addColorStop(0.6, 'rgba(160, 150, 145, 0.18)');
      cloudGrad.addColorStop(1.0, 'rgba(100, 110, 130, 0.0)');

      ctx.fillStyle = cloudGrad;
      ctx.beginPath();
      ctx.ellipse(cloudX, cloudY, cloudRad * 1.6, cloudRad * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Mirror for 360 equirectangular boundary wrapping
      if (cloudX + cloudRad * 1.6 > width) {
        const wrapX = cloudX - width;
        ctx.beginPath();
        ctx.ellipse(wrapX, cloudY, cloudRad * 1.6, cloudRad * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // 3. Sun highlight (moving in azimuth & elevation, generating extreme HDR radiance)
    const sunAzimuth = (0.35 + Math.sin(time * 0.5) * 0.15) * width;
    const sunElevation = (0.38 + Math.cos(time * 0.5) * 0.04) * height;

    // Wide atmospheric corona
    const coronaGrad = ctx.createRadialGradient(
      sunAzimuth,
      sunElevation,
      4,
      sunAzimuth,
      sunElevation,
      width * 0.25
    );
    coronaGrad.addColorStop(0.0, 'rgba(255, 250, 240, 0.95)');
    coronaGrad.addColorStop(0.15, 'rgba(255, 215, 160, 0.65)');
    coronaGrad.addColorStop(0.4, 'rgba(235, 160, 100, 0.25)');
    coronaGrad.addColorStop(1.0, 'rgba(180, 120, 80, 0.0)');

    ctx.fillStyle = coronaGrad;
    ctx.beginPath();
    ctx.arc(sunAzimuth, sunElevation, width * 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Sun Core Disk (Clamped in 8-bit source, but log-inverts to extreme HDR in WebGPU)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sunAzimuth, sunElevation, 16, 0, Math.PI * 2);
    ctx.fill();

    // 4. Distant Coastal Island & Mountain Silhouettes
    const horizonY = height * 0.50;

    // Distant mountain layer (low contrast, atmospheric haze)
    ctx.fillStyle = 'rgba(75, 88, 98, 0.85)';
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let x = 0; x <= width; x += 20) {
      const nx = (x / width) * Math.PI * 8;
      const elev =
        Math.sin(nx + time * 0.2) * 14 +
        Math.sin(nx * 2.3 + 1.2) * 8 +
        Math.cos(nx * 0.7) * 18;
      ctx.lineTo(x, horizonY - Math.max(0, elev));
    }
    ctx.lineTo(width, horizonY + 20);
    ctx.lineTo(0, horizonY + 20);
    ctx.closePath();
    ctx.fill();

    // Near island coastline layer (richer tone)
    ctx.fillStyle = 'rgba(50, 62, 55, 0.95)';
    ctx.beginPath();
    ctx.moveTo(0, horizonY + 8);
    for (let x = 0; x <= width; x += 15) {
      const nx = (x / width) * Math.PI * 6 + 1.5;
      const elev =
        Math.sin(nx * 1.5) * 12 +
        Math.cos(nx * 3.1) * 6;
      ctx.lineTo(x, horizonY + 4 - Math.max(0, elev));
    }
    ctx.lineTo(width, horizonY + 18);
    ctx.lineTo(0, horizonY + 18);
    ctx.closePath();
    ctx.fill();

    // 5. Ocean Water with Sun Glint / Specular Path
    const glintGrad = ctx.createLinearGradient(0, horizonY, 0, height);
    glintGrad.addColorStop(0.0, 'rgba(255, 230, 180, 0.7)');
    glintGrad.addColorStop(0.3, 'rgba(220, 180, 120, 0.35)');
    glintGrad.addColorStop(1.0, 'rgba(30, 50, 65, 0.0)');

    ctx.save();
    ctx.fillStyle = glintGrad;
    ctx.beginPath();
    const glintHalfWidth = width * 0.08;
    ctx.moveTo(sunAzimuth - 8, horizonY);
    ctx.lineTo(sunAzimuth + 8, horizonY);
    ctx.lineTo(sunAzimuth + glintHalfWidth * 2.5, height);
    ctx.lineTo(sunAzimuth - glintHalfWidth * 2.5, height);
    ctx.closePath();
    ctx.fill();

    // Water wave shimmer ripples
    ctx.strokeStyle = 'rgba(255, 245, 220, 0.4)';
    ctx.lineWidth = 1.2;
    for (let y = horizonY + 4; y < height; y += 8) {
      const rowNorm = (y - horizonY) / (height - horizonY);
      const span = rowNorm * glintHalfWidth * 2.2;
      const waveOffset = Math.sin(y * 0.2 + time * 3.0) * 8;
      const startX = Math.max(0, sunAzimuth - span + waveOffset);
      const endX = Math.min(width, sunAzimuth + span + waveOffset);

      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }
    ctx.restore();

    return ctx.getImageData(0, 0, width, height);
  }
}
