@echo off
cd /d "%~dp0"
echo Starting server... Close this window to stop it.
echo.
call npm run dev
echo.
echo Server stopped. If you see an error above, send it to Claude.
pause
