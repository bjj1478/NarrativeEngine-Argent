@echo off
title Narrative Engine
cd /d "%~dp0"

REM ===== Pre-flight checks =====
where node >nul 2>nul
if not errorlevel 1 goto :node_found

REM Fallback: Explorer sometimes spawns cmd with a stale PATH that
REM predates the Node.js install. Try the default install locations.
if exist "C:\Program Files\nodejs\node.exe" set "PATH=%PATH%;C:\Program Files\nodejs\"

where node >nul 2>nul
if not errorlevel 1 goto :node_found

if exist "C:\Program Files (x86)\nodejs\node.exe" set "PATH=%PATH%;C:\Program Files (x86)\nodejs\"

where node >nul 2>nul
if not errorlevel 1 goto :node_found

echo.
echo [STOP] Node.js is not installed on this computer.
echo.
echo This app needs Node.js to run. To install it:
echo   1. Open your web browser and go to https://nodejs.org/
echo   2. Download the "LTS" version (the green button)
echo   3. Run the installer - just click Next through all the steps
echo   4. Close this window and double-click
echo      Start_Narrative_Engine.bat again
echo.
pause
exit /b 1

:node_found
REM Get clean Node version string (e.g. 22.14.0)
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VERSION=%%v"

REM Guard: if node.exe exists but would not run, NODE_VERSION stays
REM empty and the version compare below would be a syntax error that
REM closes the window with no message.
if defined NODE_VERSION goto :node_version_read
echo [STOP] Node.js is installed but could not be started.
echo.
echo Your Node.js installation may be damaged.
echo Reinstalling it usually fixes this:
echo   1. Open your web browser and go to https://nodejs.org/
echo   2. Download the "LTS" version - the green button
echo   3. Run the installer - just click Next through all steps
echo   4. Come back and double-click this file again
echo.
pause
exit /b 1

:node_version_read

REM Parse major and minor
for /f "tokens=1,2 delims=." %%a in ("%NODE_VERSION%") do (
    set "NODE_MAJOR=%%a"
    set "NODE_MINOR=%%b"
)

REM Remove leading zeros so 09 doesn't break comparison
if "%NODE_MAJOR:~0,1%"=="0" set "NODE_MAJOR=%NODE_MAJOR:~1%"
if "%NODE_MINOR:~0,1%"=="0" set "NODE_MINOR=%NODE_MINOR:~1%"

REM Compare against required 20.19.0
set "REQUIRED_MAJOR=20"
set "REQUIRED_MINOR=19"

REM If major is greater than required, we're fine
if %NODE_MAJOR% GTR %REQUIRED_MAJOR% goto :node_ok
REM If major equals required, check minor
if %NODE_MAJOR% EQU %REQUIRED_MAJOR% (
    if %NODE_MINOR% GEQ %REQUIRED_MINOR% goto :node_ok
)

REM Too old
echo.
echo [STOP] Your version of Node.js is too old for this app.
echo.
echo You have version %NODE_VERSION%. The app needs version 20.19 or newer.
echo.
echo To fix this:
echo   1. Open your web browser and go to https://nodejs.org/
echo   2. Download the "LTS" version (the green button)
echo   3. Run the installer - just click Next through all the steps
echo   4. Close this window and double-click
echo      Start_Narrative_Engine.bat again
echo.
echo --------------------------------------------
echo Already upgraded Node but the app still won't start?
echo --------------------------------------------
echo There is a second file in this folder called
echo "Repair_Narrative_Engine.bat". Double-click it
echo and it will fix the app's database file to match
echo your new Node version. It will:
echo   - Ask you to type YES before doing anything
echo   - NOT change your Node.js version
echo   - NOT delete your saved campaigns or data
echo   - NOT touch any other programs on your computer
echo You must open that file yourself - this window
echo will not do it for you.
echo.
pause
exit /b 1

:node_ok
echo Node %NODE_VERSION% detected - OK.
echo.

REM ===== Pre-flight: is a copy already running? =====
REM Two dev servers against one project root fight over the same Vite dependency
REM cache and the same ports. Worse, closing the console window outright leaves
REM the server and Vite behind holding those ports - which is why the app could
REM look permanently broken no matter how many times it was restarted. Detect
REM that here and offer to clear it, rather than starting a second broken copy.
echo Checking whether the app is already running...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-ports.ps1" -Action list
if not errorlevel 1 goto :not_running

echo.
echo ============================================
echo   The app looks like it is already running
echo ============================================
echo.
echo One of the app ports - 5173 or 3001 - is busy.
echo.
echo That means either the Narrative Engine is still
echo open in another window, or a previous run left a
echo background process behind when its window closed.
echo.
echo Leftovers are the usual reason the app keeps
echo failing however many times you restart it.
echo.
echo If the app IS open in another window, switch to it
echo instead - there is no need to start a second copy.
echo.
set "CLEANUP="
set /p CLEANUP="Type YES to close the leftovers and start fresh, or press Enter to cancel: "
if /i not "%CLEANUP%"=="YES" goto :start_cancelled
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-ports.ps1" -Action stop
if errorlevel 1 goto :cleanup_failed
echo.
goto :not_running

:start_cancelled
echo.
echo Cancelled - nothing was changed and nothing was started.
echo.
pause
exit /b 0

:cleanup_failed
echo.
echo ============================================
echo   [STOP] Could not free the app ports
echo ============================================
echo.
echo Something is still holding port 5173 or 3001.
echo.
echo What to do:
echo   1. Close any black terminal/command windows
echo      that say "Narrative Engine" in the title,
echo      and any browser tabs showing the app.
echo   2. If that does not help, restart your computer
echo      and run this file again.
echo.
pause
exit /b 1

:not_running

REM ===== Install dependencies only when they actually changed =====
REM Running npm install on every launch rewrites files that Vite watches, and
REM touches package.json - which Vite treats as a config dependency, so a running
REM dev server restarts itself mid-session. Stamp the lockfile hash and skip the
REM install when nothing has changed.
set "STAMP_FILE=node_modules\.install-stamp"
set "LOCK_HASH="
for /f "delims=" %%h in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 package-lock.json).Hash" 2^>nul') do set "LOCK_HASH=%%h"
set "PREV_HASH="
if exist "%STAMP_FILE%" for /f "usebackq delims=" %%h in ("%STAMP_FILE%") do set "PREV_HASH=%%h"

if not exist "node_modules" goto :do_install
if not defined LOCK_HASH goto :do_install
if not "%LOCK_HASH%"=="%PREV_HASH%" goto :do_install
echo Dependencies are already up to date - skipping install.
echo.
goto :install_done

:do_install
echo Installing dependencies...
call npm install
if errorlevel 1 goto :install_failed
REM Parenthesised so a hash ending in a digit is not parsed as a redirect handle.
if defined LOCK_HASH (echo %LOCK_HASH%)>"%STAMP_FILE%"
echo.

:install_done

REM ===== Build the local engine package if its output is missing =====
REM The app imports @narrative/engine from packages/engine, whose
REM compiled dist/ output is git-ignored and must be built locally.
REM Without it the app fails on startup with:
REM   Failed to resolve import "@narrative/engine"
REM Only built when missing, so normal starts stay fast.
if not exist "packages\engine\package.json" goto :engine_ok
if exist "packages\engine\dist\index.js" goto :engine_ok
echo.
echo Building the game engine - this only happens
echo when it is missing, usually just the first run...
echo.
call npm run build --prefix packages/engine
if errorlevel 1 goto :engine_build_failed
if not exist "packages\engine\dist\index.js" goto :engine_build_failed
echo.
echo Engine build complete - OK.
echo.
goto :engine_ok

:install_failed
echo.
echo ============================================
echo   [STOP] Dependencies could not be installed.
echo ============================================
echo.
echo This is usually a network problem - the
echo installer could not download some files.
echo.
echo What to do:
echo   1. Check your internet connection and
echo      double-click this file again.
echo   2. If it keeps failing, run
echo      Repair_Narrative_Engine.bat and choose
echo      option 2 - Full clean reinstall.
echo.
pause
exit /b 1

:engine_build_failed
echo.
echo ============================================
echo   [STOP] The game engine could not be built.
echo ============================================
echo.
echo One part of the app - the game engine - could
echo not be compiled, so the app cannot start yet.
echo.
echo Your saved campaigns and settings are safe.
echo.
echo What to do:
echo   1. Close this window and double-click this
echo      file again - this can be a one-off problem.
echo   2. If it fails again, take a screenshot or
echo      photo of ALL the text in this window -
echo      especially any lines containing the word
echo      "error" - and send it to support.
echo.
pause
exit /b 1

:engine_ok

REM ===== Keep a copy of this run on disk =====
REM Vite and the API only ever wrote to this console window, so when the window
REM was closed there was nothing left to diagnose. logs/ is already gitignored.
if not exist "logs" mkdir "logs"
set "LOGSTAMP="
for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "LOGSTAMP=%%t"
if not defined LOGSTAMP set "LOGSTAMP=latest"
set "DEVLOG=logs\dev-%LOGSTAMP%.log"

echo Starting the application...
echo.
echo A copy of everything printed below is being saved to:
echo   %DEVLOG%
echo If the app ever breaks, that file is what to send to support.
echo.
start cmd /c "timeout /t 3 /nobreak > nul & start http://localhost:5173"

REM stderr is merged into stdout by cmd BEFORE PowerShell sees it. Letting
REM PowerShell do the merge instead would wrap every error line in an
REM ErrorRecord and bury the actual message.
cmd /c "npm run dev 2>&1" | powershell -NoProfile -Command "$input | Tee-Object -FilePath '%DEVLOG%'"

echo.
echo The app has stopped. The log above was saved to:
echo   %DEVLOG%
echo.
pause
