@echo off
setlocal
cd /d "%~dp0"
echo Starting HAU-USC Logistics Hub local full-stack preview...
echo.
echo Preview URL: http://127.0.0.1:8791
echo Press Ctrl+C to stop.
echo.
call npm run dev:live
endlocal
