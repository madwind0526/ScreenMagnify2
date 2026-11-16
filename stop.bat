@echo off
setlocal
echo Stopping ScreenMagnify2...

rem Only this app's windows, never other Electron apps (they all share the image name electron.exe).
taskkill /IM electron.exe /FI "WINDOWTITLE eq ScreenMagnify2*" >nul 2>&1

echo Done.
