@echo off
REM ============================================================
REM  CRES Marketing Hub - dev server launcher / restarter
REM  Double-click anytime to (re)start the app at localhost:3000.
REM  It first stops any server already running on port 3000, so
REM  double-clicking again is a clean RESTART -- no need to hunt
REM  for and close the old window.
REM  Keep THIS window open while you use the app. Close it to stop.
REM ============================================================

cd /d "%~dp0"

REM Clear the empty ANTHROPIC_API_KEY so the real key in .env.local wins.
set "ANTHROPIC_API_KEY="
REM More heap headroom for long testing sessions.
set "NODE_OPTIONS=--max-old-space-size=4096"

echo Stopping any existing server on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
REM Give the port a moment to free up.
ping -n 2 127.0.0.1 >nul

echo ============================================================
echo   Starting CRES Marketing Hub...
echo   Open http://localhost:3000 once it says Ready.
echo   KEEP THIS WINDOW OPEN. Close it to stop the server.
echo   To RESTART later: just double-click start-dev.cmd again.
echo ============================================================
echo.

call npm run dev

echo.
echo The server has stopped. Press any key to close this window.
pause >nul
