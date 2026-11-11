@echo off
cd /d "%~dp0"
echo Running Kakao API test...
echo.
call npm run test:kakao
echo.
echo Result saved to kakao-test-result.txt
pause
