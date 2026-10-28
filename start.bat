@echo off
rem Quick start for Windows:  start.bat   (or double-click it)
rem Installs what is missing (Node.js LTS via winget after asking, pnpm, dependencies), starts the app and opens the browser.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "NODE_MAJOR=0"
where node >nul 2>nul && for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"

if !NODE_MAJOR! LSS 24 (
  echo.
  echo PhuongDong POS needs Node.js 24 or newer ^(found: !NODE_MAJOR!^).
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Please install Node.js LTS from https://nodejs.org and double-click this file again.
    goto :fail
  )
  set /p "ANSWER=Install Node.js LTS now with winget? [Y/n] "
  if /i "!ANSWER!"=="n" goto :fail
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :fail
  rem The new install is not on this window's PATH yet.
  set "PATH=%ProgramFiles%\nodejs;!PATH!"
  set "NODE_MAJOR=0"
  for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
  if !NODE_MAJOR! LSS 24 (
    echo Node.js was installed but an older version is still first on PATH. Close this window and double-click the file again.
    goto :fail
  )
)

node scripts\launch.mjs %*
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
pause
exit /b 1
