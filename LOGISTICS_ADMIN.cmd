@echo off
setlocal
title Logistics Hub - Owner Console
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required. Install the LTS version from https://nodejs.org and try again. & pause & exit /b 1)
if not exist node_modules\wrangler (echo Installing dependencies, one moment... & call npm ci || (pause & exit /b 1))
node scripts\admin.mjs %*
echo.
pause
endlocal
