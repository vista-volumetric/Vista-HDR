@echo off
setlocal enabledelayedexpansion
title Vista HDR Studio — Offline Launcher

:: Resolve directory containing Vista HDR build
set "SCRIPT_DIR=%~dp0"
set "SERVE_DIR=%SCRIPT_DIR%"

if exist "%SCRIPT_DIR%dist\index.html" (
    set "SERVE_DIR=%SCRIPT_DIR%dist\"
)

if not exist "%SERVE_DIR%index.html" (
    echo [ERROR] Could not find Vista HDR web assets (index.html) in:
    echo "%SERVE_DIR%"
    echo.
    echo Please make sure you have run 'npm run build' or that index.html is present.
    pause
    exit /b 1
)

set "PORT=3000"
set "URL=http://127.0.0.1:%PORT%/"

echo ======================================================================
echo           Vista HDR - 360 Radiometric HDR Studio Launcher
echo ======================================================================
echo Web Root: %SERVE_DIR%
echo Studio URL: %URL%
echo.

:: Automatically launch the default web browser after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start %URL%"

:: Priority 1: Check for Node.js runtime
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Node.js runtime detected.
    echo [INFO] Launching high-performance local HTTP server on port %PORT%...
    echo.
    node -e "const http=require('http'),fs=require('fs'),path=require('path');const root=process.argv[1],port=parseInt(process.argv[2],10);const mimes={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm','.mp4':'video/mp4','.cube':'text/plain'};http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');let relPath=decodeURIComponent(req.url.split('?')[0]);if(relPath==='/'||relPath==='')relPath='/index.html';const filePath=path.join(root,relPath);if(!fs.existsSync(filePath)||fs.statSync(filePath).isDirectory()){res.writeHead(404,{'Content-Type':'text/plain'});res.end('404 Not Found');return;}const ext=path.extname(filePath).toLowerCase();res.writeHead(200,{'Content-Type':mimes[ext]||'application/octet-stream'});fs.createReadStream(filePath).pipe(res);}).listen(port,'127.0.0.1',()=>{console.log('[Vista HDR] Studio server active at http://127.0.0.1:'+port+'/');console.log('[Vista HDR] Press Ctrl+C to stop.');});" "%SERVE_DIR%" %PORT%
    exit /b 0
)

:: Priority 2: Zero-Dependency Fallback using Windows native PowerShell System.Net.HttpListener
echo [INFO] Node.js not detected on system.
echo [INFO] Launching native Windows PowerShell HTTP server (Zero-Dependency)...
echo [INFO] All WebGPU security headers enabled (COOP & COEP).
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = [int]%PORT%; $root = '%SERVE_DIR%'.TrimEnd('\'); $listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add('http://127.0.0.1:' + $port + '/'); try { $listener.Start() } catch { Write-Error $_; exit 1 }; Write-Host ('[Vista HDR] Native HTTP Server active at http://127.0.0.1:' + $port + '/') -ForegroundColor Cyan; Write-Host '[Vista HDR] Press Ctrl+C to stop.' -ForegroundColor DarkGray; $mimes = @{ '.html'='text/html; charset=utf-8'; '.js'='application/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.svg'='image/svg+xml'; '.wasm'='application/wasm'; '.mp4'='video/mp4'; '.cube'='text/plain' }; while ($listener.IsListening) { try { $context = $listener.GetContext(); $req = $context.Request; $res = $context.Response; $res.Headers.Add('Cross-Origin-Opener-Policy', 'same-origin'); $res.Headers.Add('Cross-Origin-Embedder-Policy', 'require-corp'); $urlPath = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath); if ($urlPath -eq '/' -or $urlPath -eq '') { $urlPath = '/index.html' }; $filePath = [System.IO.Path]::Combine($root, $urlPath.TrimStart('/')); if ([System.IO.File]::Exists($filePath)) { $ext = [System.IO.Path]::GetExtension($filePath).ToLower(); $res.ContentType = if ($mimes.ContainsKey($ext)) { $mimes[$ext] } else { 'application/octet-stream' }; $bytes = [System.IO.File]::ReadAllBytes($filePath); $res.ContentLength64 = $bytes.Length; $res.StatusCode = 200; $res.OutputStream.Write($bytes, 0, $bytes.Length); } else { $res.StatusCode = 404; $notFound = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found'); $res.OutputStream.Write($notFound, 0, $notFound.Length); }; $res.OutputStream.Close(); } catch { } }"
