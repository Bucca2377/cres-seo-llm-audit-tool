@echo off
REM ============================================================
REM  CRES Marketing Hub - dev server launcher
REM  Double-click this file to start the app at localhost:3000.
REM  Keep the window OPEN while you use the app.
REM  Close the window (or press Ctrl+C) to stop the server.
REM ============================================================

cd /d "%~dp0"

REM Clear the empty ANTHROPIC_API_KEY from the environment so the real
REM key in .env.local takes effect (otherwise Claude calls fail).
set "ANTHROPIC_API_KEY="

REM More heap headroom so long testing sessions don't run out of memory.
set "NODE_OPTIONS=--max-old-space-size=4096"

echo ============================================================
echo   Starting CRES Marketing Hub...
echo   Open http://localhost:3000 in your browser once it says Ready.
echo   KEEP THIS WINDOW OPEN. Close it to stop the server.
echo ============================================================
echo.

call npm run dev

echo.
echo The server has stopped. Press any key to close this window.
pause >nul
