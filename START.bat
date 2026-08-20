@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || goto missing_node
where npm >nul 2>&1 || goto missing_node
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing locked dependencies for the first launch...
  call npm ci || goto failed
)
call npm start
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo Node.js 22.12 or newer is required.
echo Install the current LTS release from https://nodejs.org and run START.bat again.
pause
exit /b 1

:failed
echo.
echo PokeRevolution Packs could not start. Review the error above, then try again.
pause
exit /b 1
