@echo off
setlocal
cd /d "%~dp0"

rem Prefer this checkout's portable Node; otherwise use an installed Node/npm.
if exist "%~dp0.tools\node\node.exe" set "PATH=%~dp0.tools\node;%PATH%"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 with npm, reopen PowerShell, and run demo.cmd again.
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js 22 including npm, reopen PowerShell, and run demo.cmd again.
  exit /b 1
)

if not exist ".env.local" (
  copy ".env.example" ".env.local" >nul
  if errorlevel 1 exit /b 1
)
if not exist "node_modules\next\dist\bin\next" (
  call npm.cmd ci
  if errorlevel 1 exit /b 1
)

echo Starting SongNexus. Open http://127.0.0.1:3000/accounts
echo Keep this window open. Press Ctrl+C to stop the demo.
call npm.cmd run dev -- --hostname 127.0.0.1 %*
exit /b %errorlevel%
