@echo off
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-hosted.ps1"
if errorlevel 1 (echo Packaging failed. Existing configuration and data were preserved.) else (echo Packaging complete. See deploy\hosted\output.)
pause
