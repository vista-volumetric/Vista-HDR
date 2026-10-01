================================================================================
Vista HDR — 360° Radiometric HDR Studio
Offline & Portable Deployment Guide
================================================================================

Vista HDR is a high-end 360° D-Log to Radiometric HDR Studio with real-time 
WebGPU compute, Three.js spherical & equirectangular viewports, 3D LUT grading, 
optical filters, and 32-bit Radiance RGBE / 16-bit OpenEXR export pipelines.

This distribution package is 100% standalone, portable, and designed to run
completely offline anywhere — including USB thumb drives and air-gapped workstations.

--------------------------------------------------------------------------------
QUICK START OPTIONS
--------------------------------------------------------------------------------

OPTION 1: 1-Click Desktop Launcher (Recommended)
-------------------------------------------------
Double-click "Run-Vista-HDR.bat".

• If Node.js is installed on your computer:
  The launcher will automatically start a high-speed local HTTP server on port 3000.

• If Node.js is NOT installed (Zero-Dependency Mode):
  The launcher automatically falls back to the native Windows PowerShell 
  System.Net.HttpListener server. NO installation, NO admin rights, and NO 
  external dependencies are required!

• Security Headers:
  Both servers automatically inject the required WebGPU security headers:
  - Cross-Origin-Opener-Policy: same-origin
  - Cross-Origin-Embedder-Policy: require-corp

• Browser Auto-Launch:
  Your default WebGPU-compatible browser will open automatically to:
  http://127.0.0.1:3000/


OPTION 2: Single-File Standalone HTML Bundle
--------------------------------------------
Open "standalone.html" directly in any modern WebGPU-enabled browser 
(Google Chrome or Microsoft Edge).

• "standalone.html" contains all application logic, WebGPU shaders, CSS styling,
  SVG icons, and branding assets completely inlined into a single file.
• Can be double-clicked directly from Windows Explorer or hosted on any internal
  intranet web server.


OPTION 3: Progressive Web App (PWA) Offline Installation
--------------------------------------------------------
When running via the local server (http://127.0.0.1:3000/):

1. The built-in Cache-First Service Worker will automatically cache the core 
   studio application shell.
2. A toast notification will confirm: "Vista HDR is ready for offline use".
3. An "Install App" button will appear in the top bar (or via your browser's 
   address bar install icon).
4. Click "Install App" to install Vista HDR as a native desktop application with 
   its own desktop shortcut, window frame, and Start Menu entry.


--------------------------------------------------------------------------------
AIR-GAPPED & USB STICK DEPLOYMENT
--------------------------------------------------------------------------------

To run on an air-gapped machine or from a USB stick:

1. Copy this entire "dist" folder onto your USB drive or transfer to the offline PC.
2. Plug the USB drive into the target computer.
3. Double-click "Run-Vista-HDR.bat".
4. The studio starts immediately with zero internet connectivity required.


--------------------------------------------------------------------------------
SYSTEM & BROWSER REQUIREMENTS
--------------------------------------------------------------------------------

• Operating System: Windows 10 / 11 (64-bit)
• Browser: Google Chrome 113+, Microsoft Edge 113+, or Chromium with WebGPU enabled
• GPU: Any modern dedicated GPU (NVIDIA RTX / AMD Radeon) or integrated GPU 
  (Intel Iris Xe / AMD Radeon Graphics / Apple Silicon) with WebGPU hardware support
• Video Formats: 360° MP4 / MOV videos (DJI D-Log, D-Log M, Linear, sRGB)
• Export Formats: .hdr (32-bit Radiance RGBE), .exr (16-bit half OpenEXR), 
  .png (SDR Tonemapped), and ±5 EV Bracket Sets (-5 EV, 0 EV, +5 EV)

================================================================================
Vista HDR Studio — Built for Radiometric Precision Anywhere.
================================================================================
