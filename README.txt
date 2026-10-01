================================================================================
Vista HDR — 360° Radiometric HDR Studio
Offline & Portable Deployment Guide
================================================================================

Vista HDR is a high-end 360° D-Log to Radiometric HDR Studio with real-time 
WebGPU compute, Three.js spherical & equirectangular viewports, 3D LUT grading, 
optical filters, and 32-bit Radiance RGBE / 16-bit OpenEXR export pipelines.

This distribution package is 100% standalone, portable, and designed to run
completely offline anywhere — as a standalone web application or as a standalone
native desktop application (.exe).

--------------------------------------------------------------------------------
DEPLOYMENT MODES & LAUNCHERS
--------------------------------------------------------------------------------

1. STANDALONE NATIVE DESKTOP APPLICATION (.EXE)
-----------------------------------------------
Run Vista HDR as a full-fledged native Windows desktop application with
dedicated hardware acceleration, borderless window frame, Vulkan & Direct3D 12
WebGPU pipeline, and zero browser dependencies.

• Method A (Direct Executable):
  Double-click "Vista HDR.exe" located in:
  release-builds\Vista HDR-win32-x64\Vista HDR.exe

• Method B (Convenience Launcher):
  Double-click "Launch-Vista-HDR-Desktop.bat" in the project root.

Features:
- Dedicated Electron runtime with hardware-accelerated WebGPU/Vulkan flags enabled.
- Auto-hidden menu bar, custom application icon, and full keyboard shortcut handling (F11 Fullscreen).
- Complete isolation from external network or browser extensions.


2. STANDALONE WEB APPLICATION
-----------------------------
Run Vista HDR in any modern WebGPU-capable browser, or host on any web server.

• Method A (Dedicated App Mode Launcher):
  Double-click "Launch-Vista-HDR-Web.bat".
  - Automatically spins up a high-performance local HTTP server (using Node.js or
    the built-in zero-dependency Windows PowerShell System.Net.HttpListener).
  - Automatically launches Microsoft Edge or Google Chrome in dedicated application
    window mode (`--app=http://127.0.0.1:3000/ --enable-unsafe-webgpu`).
  - Automatically injects essential WebGPU security headers:
    * Cross-Origin-Opener-Policy: same-origin
    * Cross-Origin-Embedder-Policy: require-corp

• Method B (Self-Contained Single-File standalone.html):
  Open "standalone.html" directly in any WebGPU-enabled browser (Edge / Chrome).
  - Fully inlined bundle containing JS, CSS, shaders, and assets in a single file.
  - Zero external web server or node runtime required.

• Method C (Any Web Host / Subdirectory / CDN):
  Host the contents of the "dist" directory on any web server (Apache, Nginx,
  Caddy, GitHub Pages, Netlify, Cloudflare Pages, S3).
  - Relative asset paths (`./assets/...`) allow hosting at any root or subfolder path.


3. PROGRESSIVE WEB APP (PWA) OFFLINE INSTALLATION
-------------------------------------------------
When running via the local web server (http://127.0.0.1:3000/):
1. The built-in Cache-First Service Worker automatically caches the core studio shell.
2. A toast notification confirms: "Vista HDR is ready for offline use".
3. An "Install App" button appears in the top bar (or browser install prompt).
4. Click to install Vista HDR directly to your desktop and Start Menu.


--------------------------------------------------------------------------------
AIR-GAPPED & USB STICK DEPLOYMENT
--------------------------------------------------------------------------------

To run on an air-gapped machine or from a USB stick:

1. Copy the "release-builds\Vista HDR-win32-x64" folder or "dist" folder onto your USB drive.
2. Plug the USB drive into the target computer.
3. For Native Desktop: Double-click "Vista HDR.exe" or "Launch-Vista-HDR-Desktop.bat".
   For Web Studio: Double-click "Launch-Vista-HDR-Web.bat" or open "standalone.html".
4. The studio starts immediately with zero internet connectivity required.


--------------------------------------------------------------------------------
SYSTEM & BROWSER REQUIREMENTS
--------------------------------------------------------------------------------

• Operating System: Windows 10 / 11 (64-bit)
• Native Desktop: release-builds\Vista HDR-win32-x64\Vista HDR.exe (Pre-packaged)
• Web Studio: Google Chrome 113+, Microsoft Edge 113+, or Chromium with WebGPU
• GPU: Any modern dedicated GPU (NVIDIA RTX / AMD Radeon) or integrated GPU 
  (Intel Iris Xe / AMD Radeon Graphics) with WebGPU hardware support
• Video Formats: 360° MP4 / MOV videos (DJI D-Log, D-Log M, Linear, sRGB)
• Export Formats: .hdr (32-bit Radiance RGBE), .exr (16-bit half OpenEXR), 
  .png (SDR Tonemapped), and ±5 EV Bracket Sets (-5 EV, 0 EV, +5 EV)

================================================================================
Vista HDR Studio — Built for Radiometric Precision Anywhere.
================================================================================
