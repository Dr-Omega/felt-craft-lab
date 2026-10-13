@echo off
setlocal
cd /d "%~dp0"
title Felt Craft Lab - Local Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-local.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Please keep this window and share the error message, not your .env file.
  pause
)
endlocal
