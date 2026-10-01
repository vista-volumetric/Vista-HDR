import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Standalone & Offline Package Infrastructure', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const publicDir = path.resolve(rootDir, 'public');
  const distDir = path.resolve(rootDir, 'dist');
  const htmlPath = path.resolve(rootDir, 'index.html');
  const mainTsPath = path.resolve(__dirname, '../main.ts');

  it('should include PWA manifest and theme-color meta tag in index.html', () => {
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    expect(htmlContent).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(htmlContent).toContain('<meta name="theme-color" content="#070d18" />');
  });

  it('should provide a valid manifest.webmanifest in public directory', () => {
    const manifestPath = path.resolve(publicDir, 'manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('Vista HDR — 360° Radiometric HDR Studio');
    expect(manifest.short_name).toBe('Vista HDR');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#070d18');
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons[0].src).toBe('/logo.jpg');
  });

  it('should provide a robust Cache-First Service Worker in sw.js', () => {
    const swPath = path.resolve(publicDir, 'sw.js');
    expect(fs.existsSync(swPath)).toBe(true);

    const swContent = fs.readFileSync(swPath, 'utf-8');
    expect(swContent).toContain('vista-hdr-v1');
    expect(swContent).toContain('caches.match(event.request)');
    expect(swContent).toContain('self.addEventListener(\'install\'');
    expect(swContent).toContain('self.addEventListener(\'activate\'');
    expect(swContent).toContain('self.addEventListener(\'fetch\'');
  });

  it('should register Service Worker and handle beforeinstallprompt in main.ts', () => {
    const mainContent = fs.readFileSync(mainTsPath, 'utf-8');
    expect(mainContent).toContain(".register('/sw.js')");
    expect(mainContent).toContain('Vista HDR is ready for offline use');
    expect(mainContent).toContain('beforeinstallprompt');
  });

  it('should have 1-click desktop launchers in root and dist', () => {
    const rootBat = path.resolve(rootDir, 'Run-Vista-HDR.bat');
    const distBat = path.resolve(distDir, 'Run-Vista-HDR.bat');
    expect(fs.existsSync(rootBat)).toBe(true);
    expect(fs.existsSync(distBat)).toBe(true);

    const batContent = fs.readFileSync(rootBat, 'utf-8');
    expect(batContent).toContain('System.Net.HttpListener');
    expect(batContent).toContain('Cross-Origin-Opener-Policy');
    expect(batContent).toContain('Cross-Origin-Embedder-Policy');
  });

  it('should have offline deployment instructions README in dist', () => {
    const distReadme = path.resolve(distDir, 'README.txt');
    expect(fs.existsSync(distReadme)).toBe(true);

    const readmeContent = fs.readFileSync(distReadme, 'utf-8');
    expect(readmeContent).toContain('Offline & Portable Deployment Guide');
    expect(readmeContent).toContain('Run-Vista-HDR.bat');
    expect(readmeContent).toContain('standalone.html');
  });

  it('should produce a self-contained standalone HTML bundle', () => {
    const standalonePath = path.resolve(distDir, 'standalone.html');
    expect(fs.existsSync(standalonePath)).toBe(true);

    const stat = fs.statSync(standalonePath);
    expect(stat.size).toBeGreaterThan(500 * 1024); // Over 500 KB (fully bundled)
  });
});
