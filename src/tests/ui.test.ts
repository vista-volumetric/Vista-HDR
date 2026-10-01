import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Broadcast Cinematography & Studio Tools UI Integration', () => {
  const htmlPath = path.resolve(__dirname, '../../index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  it('should include False Color and Zebras HUD toggle buttons in viewport stage', () => {
    expect(htmlContent).toContain('id="btn-toggle-false-color"');
    expect(htmlContent).toContain('title="Toggle ARRI/RED Radiometric False Color (F)"');
    expect(htmlContent).toContain('id="btn-toggle-zebras"');
    expect(htmlContent).toContain('title="Toggle Highlight Exposure Zebras (Z)"');
  });

  it('should include White Balance quick actions row in Drawer 2', () => {
    expect(htmlContent).toContain('White Balance Tools');
    expect(htmlContent).toContain('id="btn-awb-oneshot"');
    expect(htmlContent).toContain('id="btn-eyedropper"');
    expect(htmlContent).toContain('id="text-eyedropper"');
  });

  it('should include 360 Nadir Mask & Tripod Patch card in Drawer 3', () => {
    expect(htmlContent).toContain('360° Nadir Patch');
    expect(htmlContent).toContain('id="btn-toggle-nadir"');
    expect(htmlContent).toContain('id="nadir-status-dot"');
    expect(htmlContent).toContain('id="nadir-status-text"');
    expect(htmlContent).toContain('id="select-nadir-mode"');
    expect(htmlContent).toContain('id="param-nadir-radius"');
    expect(htmlContent).toContain('id="val-nadir-radius"');
    expect(htmlContent).toContain('id="param-nadir-feather"');
    expect(htmlContent).toContain('id="val-nadir-feather"');
  });

  it('should include Scope View Mode selector pills and Zebra Threshold slider in Drawer 5', () => {
    expect(htmlContent).toContain('id="btn-scope-hist"');
    expect(htmlContent).toContain('id="btn-scope-waveform"');
    expect(htmlContent).toContain('id="btn-scope-parade"');
    expect(htmlContent).toContain('id="btn-scope-vector"');
    expect(htmlContent).toContain('id="param-zebra-threshold"');
    expect(htmlContent).toContain('id="val-zebra-threshold"');
  });

  it('should include A/B Wipe HUD toggle button and draggable divider overlay in viewport stage', () => {
    expect(htmlContent).toContain('id="btn-toggle-ab-wipe"');
    expect(htmlContent).toContain('title="Toggle Interactive A/B Before/After Split Wipe (\\)"');
    expect(htmlContent).toContain('id="ab-wipe-overlay"');
    expect(htmlContent).toContain('id="ab-wipe-divider"');
    expect(htmlContent).toContain('RAW LOG');
    expect(htmlContent).toContain('GRADED HDR');
  });

  it('should include 360° Optical Filters sub-card in Drawer 2 (Grading)', () => {
    expect(htmlContent).toContain('360° Optical Filters');
    expect(htmlContent).toContain('id="btn-reset-optical-filters"');
    expect(htmlContent).toContain('id="param-gnd-exposure"');
    expect(htmlContent).toContain('id="val-gnd-exposure"');
    expect(htmlContent).toContain('id="param-gnd-pivot"');
    expect(htmlContent).toContain('id="val-gnd-pivot"');
    expect(htmlContent).toContain('id="param-gnd-feather"');
    expect(htmlContent).toContain('id="val-gnd-feather"');
    expect(htmlContent).toContain('id="param-sky-polarizer"');
    expect(htmlContent).toContain('id="val-sky-polarizer"');
  });

  it('should standardize all EV sliders and export brackets to ±5 EV range', () => {
    // #param-ae-compensation has min="-5.0" and max="5.0"
    expect(htmlContent).toMatch(/id="param-ae-compensation"[\s\S]*?min="-5\.0"[\s\S]*?max="5\.0"/);

    // #param-gnd-exposure has min="-5.0" and max="5.0"
    expect(htmlContent).toMatch(/id="param-gnd-exposure"[\s\S]*?min="-5\.0"[\s\S]*?max="5\.0"/);

    // #param-exposure has min="-5.0" and max="5.0"
    expect(htmlContent).toMatch(/id="param-exposure"[\s\S]*?min="-5\.0"[\s\S]*?max="5\.0"/);

    // #btn-export-brackets displays ±5 EV
    expect(htmlContent).toContain('id="btn-export-brackets"');
    expect(htmlContent).toContain('Export Brackets (±5 EV)');
    expect(htmlContent).toContain('3-Shot Set: -5, 0, +5 EV');
    expect(htmlContent).toContain('title="Export 3-shot Exposure Brackets (-5 EV, 0 EV, +5 EV) for HDR merge software"');
  });
});
