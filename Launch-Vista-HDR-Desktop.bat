@echo off
setlocal enabledelayedexpansion
title Vista HDR — Desktop Launcher

set "SCRIPT_DIR=%~dp0"
set "EXE_PATH=%SCRIPT_DIR%release-builds\Vista HDR-win32-x64\Vista HDR.exe"

if not exist "!EXE_PATH!" (
    echo [ERROR] Native desktop executable not found at:
    echo "!EXE_PATH!"
    echo.
    echo Please run 'npm run package:desktop' to package the native desktop executable.
    pause
    exit /b 1
)

echo Starting Vista HDR Desktop Application...
start "" "!EXE_PATH!"
exit /b 0
