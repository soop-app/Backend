@echo off
cd /d "%~dp0"
echo Installing packages (npm install)... please wait 1-2 minutes.
echo.
call npm install
if errorlevel 1 (
  echo.
  echo [FAILED] Copy the messages above and send them to Claude.
) else (
  echo.
  echo [DONE] Install finished. Go back to VS Code.
)
pause
