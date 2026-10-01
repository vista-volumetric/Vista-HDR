/**
 * Vista HDR Broadcast Scopes Module
 * High-performance HTML5 Canvas renderers for professional broadcast monitoring:
 * - Panoramic Waveform (0°-360° horizontal yaw, 0-100+ IRE vertical scale)
 * - RGB Parade (channel-isolated waveform columns)
 * - Vectorscope (polar chrominance plot with 75% target boxes and 123° I-axis Skin Tone line)
 */

/**
 * Standard Rec.709 YCbCr conversion
 */
export function rgbToYCbCr(r: number, g: number, b: number): { y: number; cb: number; cr: number } {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
  const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
  return { y, cb, cr };
}

/**
 * Converts luminance [0, 1+] to IRE units (1.0 = 100 IRE)
 */
export function lumaToIRE(luma: number): number {
  return luma * 100.0;
}

/**
 * Maps an IRE value to canvas Y coordinate
 * minIRE (e.g. 0) maps to canvas bottom margin, maxIRE (e.g. 100) maps to top margin
 */
export function ireToCanvasY(
  ire: number,
  canvasHeight: number,
  minIRE: number = 0,
  maxIRE: number = 100
): number {
  const padTop = canvasHeight * 0.08;
  const padBottom = canvasHeight * 0.92;
  const plotHeight = padBottom - padTop;
  const t = (ire - minIRE) / (maxIRE - minIRE);
  return padBottom - t * plotHeight;
}

/**
 * Skin Tone reference line angle in standard Vectorscope coordinates
 * +123° counter-clockwise from +Cb (in the upper-left Cr > 0, Cb < 0 flesh tone region)
 */
export const SKIN_TONE_LINE_ANGLE_DEG = 123.0;

export interface VectorscopeTarget {
  name: string;
  label: string;
  cb: number;
  cr: number;
  x: number;
  y: number;
  color: string;
}

/**
 * Computes 75% saturation target box coordinates for standard SMPTE / Rec.709 color bars
 */
export function getVectorscopeTargets(
  radius: number,
  cx: number,
  cy: number
): VectorscopeTarget[] {
  // 75% saturation target colors
  const rawTargets: Array<{ name: string; label: string; rgb: [number, number, number]; color: string }> = [
    { name: 'R', label: 'R', rgb: [0.75, 0.0, 0.0], color: '#ff4444' },
    { name: 'Mg', label: 'Mg', rgb: [0.75, 0.0, 0.75], color: '#ff44ff' },
    { name: 'B', label: 'B', rgb: [0.0, 0.0, 0.75], color: '#4488ff' },
    { name: 'Cy', label: 'Cy', rgb: [0.0, 0.75, 0.75], color: '#00eeee' },
    { name: 'G', label: 'G', rgb: [0.0, 0.75, 0.0], color: '#44ee44' },
    { name: 'Yl', label: 'Yl', rgb: [0.75, 0.75, 0.0], color: '#eeee33' },
  ];

  // Maximum 75% chrominance magnitude in Rec.709 is sqrt(0.375^2 + 0.0343^2) ~ 0.3766
  const target75Mag = 0.3766;
  const scale = (radius * 0.75) / target75Mag;

  return rawTargets.map(t => {
    const { cb, cr } = rgbToYCbCr(t.rgb[0], t.rgb[1], t.rgb[2]);
    const x = cx + cb * scale;
    const y = cy - cr * scale; // inverted canvas Y
    return {
      name: t.name,
      label: t.label,
      cb,
      cr,
      x,
      y,
      color: t.color,
    };
  });
}

/**
 * High-performance HTML5 Canvas Waveform Monitor
 * Visualizes panoramic columns (0° to 360° yaw horizontally) and IRE scale (0 to 100+ IRE vertically).
 */
export function renderWaveform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hdrData: Float32Array,
  imgWidth: number,
  imgHeight: number
): void {
  if (!ctx || width <= 0 || height <= 0 || !hdrData || hdrData.length === 0) return;

  // 1. Draw background
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, width, height);

  // 2. Draw IRE scale grid lines
  const ireLevels = [0, 20, 40, 60, 80, 100];
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (const ire of ireLevels) {
    const y = ireToCanvasY(ire, height);

    ctx.beginPath();
    ctx.strokeStyle = ire === 0 || ire === 100 ? 'rgba(70, 110, 140, 0.7)' : 'rgba(40, 70, 90, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash(ire === 0 || ire === 100 ? [] : [2, 4]);
    ctx.moveTo(30, y);
    ctx.lineTo(width - 10, y);
    ctx.stroke();

    ctx.fillStyle = ire === 0 || ire === 100 ? 'rgba(160, 210, 240, 0.9)' : 'rgba(100, 150, 180, 0.7)';
    ctx.fillText(`${ire}`, 6, y);
  }
  ctx.setLineDash([]);

  // 3. Sub-sampled phosphor accumulation
  const stepX = Math.max(1, Math.floor(imgWidth / Math.min(width, 400)));
  const stepY = Math.max(1, Math.floor(imgHeight / 150));

  ctx.fillStyle = 'rgba(0, 255, 170, 0.16)';

  for (let iy = 0; iy < imgHeight; iy += stepY) {
    const rowOffset = iy * imgWidth * 4;
    for (let ix = 0; ix < imgWidth; ix += stepX) {
      const idx = rowOffset + ix * 4;
      const r = hdrData[idx];
      const g = hdrData[idx + 1];
      const b = hdrData[idx + 2];

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const ire = lumaToIRE(luma);

      const px = 30 + (ix / imgWidth) * (width - 40);
      const py = ireToCanvasY(ire, height);

      if (py >= 0 && py < height) {
        ctx.fillRect(px, py, 1.5, 1.5);
      }
    }
  }

  // Border & Header
  ctx.strokeStyle = 'rgba(60, 90, 120, 0.6)';
  ctx.strokeRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0, 240, 180, 0.85)';
  ctx.textAlign = 'right';
  ctx.fillText('WAVEFORM (IRE)', width - 10, 12);
}

/**
 * High-performance HTML5 Canvas RGB Parade Monitor
 * Splits width into 3 isolated columns: Red parade, Green parade, Blue parade.
 */
export function renderRGBParade(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hdrData: Float32Array,
  imgWidth: number,
  imgHeight: number
): void {
  if (!ctx || width <= 0 || height <= 0 || !hdrData || hdrData.length === 0) return;

  // 1. Draw background
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, width, height);

  const colWidth = width / 3.0;
  const colPad = 6;
  const ireLevels = [0, 20, 40, 60, 80, 100];

  ctx.font = '10px monospace';
  ctx.lineWidth = 1;

  // Draw grid & channels
  const channels: Array<{ name: string; color: string; phosphor: string }> = [
    { name: 'RED', color: 'rgba(255, 80, 80, 0.9)', phosphor: 'rgba(255, 70, 70, 0.22)' },
    { name: 'GREEN', color: 'rgba(80, 255, 110, 0.9)', phosphor: 'rgba(70, 255, 100, 0.22)' },
    { name: 'BLUE', color: 'rgba(80, 170, 255, 0.9)', phosphor: 'rgba(70, 160, 255, 0.22)' },
  ];

  for (let c = 0; c < 3; c++) {
    const colX = c * colWidth;

    // Divider line between columns
    if (c > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(50, 70, 90, 0.8)';
      ctx.setLineDash([]);
      ctx.moveTo(colX, 0);
      ctx.lineTo(colX, height);
      ctx.stroke();
    }

    // IRE Grid lines
    for (const ire of ireLevels) {
      const y = ireToCanvasY(ire, height);
      ctx.beginPath();
      ctx.strokeStyle = ire === 0 || ire === 100 ? 'rgba(70, 100, 120, 0.6)' : 'rgba(40, 60, 80, 0.35)';
      ctx.setLineDash(ire === 0 || ire === 100 ? [] : [2, 4]);
      ctx.moveTo(colX + colPad + 18, y);
      ctx.lineTo(colX + colWidth - colPad, y);
      ctx.stroke();

      if (c === 0) {
        ctx.fillStyle = 'rgba(120, 160, 190, 0.7)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${ire}`, colX + 4, y);
      }
    }

    // Column label
    ctx.setLineDash([]);
    ctx.fillStyle = channels[c].color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(channels[c].name, colX + colWidth * 0.5, 6);
  }

  // 2. Sub-sampled phosphor accumulation per channel
  const stepX = Math.max(1, Math.floor(imgWidth / Math.min(colWidth, 160)));
  const stepY = Math.max(1, Math.floor(imgHeight / 140));

  for (let iy = 0; iy < imgHeight; iy += stepY) {
    const rowOffset = iy * imgWidth * 4;
    for (let ix = 0; ix < imgWidth; ix += stepX) {
      const idx = rowOffset + ix * 4;
      const rgb = [hdrData[idx], hdrData[idx + 1], hdrData[idx + 2]];

      for (let c = 0; c < 3; c++) {
        const val = rgb[c];
        const ire = lumaToIRE(val);
        const colX = c * colWidth;
        const px = colX + colPad + 20 + (ix / imgWidth) * (colWidth - colPad * 2 - 24);
        const py = ireToCanvasY(ire, height);

        if (py >= 0 && py < height) {
          ctx.fillStyle = channels[c].phosphor;
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      }
    }
  }

  // Border
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(60, 90, 120, 0.6)';
  ctx.strokeRect(0, 0, width, height);
}

/**
 * High-performance HTML5 Canvas Vectorscope Monitor
 * Circular polar chrominance plot with 75% target boxes and +123° I-axis Skin Tone line.
 */
export function renderVectorscope(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  hdrData: Float32Array,
  imgWidth: number,
  imgHeight: number
): void {
  if (!ctx || width <= 0 || height <= 0 || !hdrData || hdrData.length === 0) return;

  // 1. Draw background
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, width, height);

  const cx = width * 0.5;
  const cy = height * 0.5;
  const radius = Math.min(width, height) * 0.42;

  // 2. Draw circular reticle
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(50, 80, 100, 0.5)';

  // 100% outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // 75% saturation target circle
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(70, 110, 140, 0.6)';
  ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshairs (center axes)
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(40, 70, 90, 0.4)';
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // 3. Draw +123° I-Axis Skin Tone Line
  const skinAngleRad = (SKIN_TONE_LINE_ANGLE_DEG * Math.PI) / 180.0;
  const skinDx = Math.cos(skinAngleRad);
  const skinDy = -Math.sin(skinAngleRad); // inverted canvas Y

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255, 175, 60, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + skinDx * radius, cy + skinDy * radius);
  ctx.stroke();

  ctx.font = '10px monospace';
  ctx.fillStyle = 'rgba(255, 175, 60, 0.9)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('I / SKIN', cx + skinDx * radius * 0.95 - 4, cy + skinDy * radius * 0.95);

  // 4. Draw 75% saturation target boxes
  const targets = getVectorscopeTargets(radius, cx, cy);
  const boxSize = 6;

  for (const t of targets) {
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(t.x - boxSize * 0.5, t.y - boxSize * 0.5, boxSize, boxSize);

    ctx.fillStyle = t.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.label, t.x + (t.x >= cx ? 10 : -10), t.y + (t.y >= cy ? 8 : -8));
  }

  // 5. Chrominance plot (subsampled for interactive frame-rate)
  const target75Mag = 0.3766;
  const scale = (radius * 0.75) / target75Mag;

  const stepX = Math.max(1, Math.floor(imgWidth / 180));
  const stepY = Math.max(1, Math.floor(imgHeight / 140));

  ctx.fillStyle = 'rgba(0, 245, 185, 0.16)';

  for (let iy = 0; iy < imgHeight; iy += stepY) {
    const rowOffset = iy * imgWidth * 4;
    for (let ix = 0; ix < imgWidth; ix += stepX) {
      const idx = rowOffset + ix * 4;
      const r = hdrData[idx];
      const g = hdrData[idx + 1];
      const b = hdrData[idx + 2];

      const { cb, cr } = rgbToYCbCr(r, g, b);
      const px = cx + cb * scale;
      const py = cy - cr * scale;

      const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d2 <= radius * radius * 1.2) {
        ctx.fillRect(px, py, 1.5, 1.5);
      }
    }
  }

  // Border & Header
  ctx.strokeStyle = 'rgba(60, 90, 120, 0.6)';
  ctx.strokeRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0, 240, 180, 0.85)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('VECTORSCOPE', width - 10, 8);
}
