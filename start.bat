@echo off
title VOXELSPACE - Voxel Space Game
cd /d "%~dp0"
echo.
echo  ================================================
echo   VOXELSPACE  -  Minecraft x No Man's Sky Demo
echo  ================================================
echo.
echo  Starting game server (http://localhost:8080) ...
echo  If the browser does not open automatically,
echo  please visit  http://localhost:8080  manually.
echo.
echo  Press Ctrl+C or close this window to stop.
echo.
node server.js
if errorlevel 1 (
  echo.
  echo  [Error] Failed to start the server.
  echo  Please make sure Node.js is installed:  https://nodejs.org
  echo.
  pause
)
