@echo off
REM Start-Blog-console.bat — advanced / troubleshooting launcher for Windows.
REM
REM Normal users should double-click Start-Blog.exe (no window). This file exists
REM only for troubleshooting, and it is SAFE to double-click by mistake:
REM
REM   * Double-click (no args): it just hands off to Start-Blog.exe and closes
REM     immediately — it never leaves a stuck console window.
REM   * Run with the "log" argument (Start-Blog-console.bat log): it runs the
REM     server HERE in this window so you can watch the progress/log text. That
REM     window stays open on purpose — closing it stops the blog.
REM
REM The server keeps all content in %USERPROFILE%\dev-home-blog, picks its own
REM port (auto-bumps if 8080 is busy), and shuts itself down about a minute after
REM the last blog page is closed (heartbeat).
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM Internal helper used by the visible/console mode below (waits for the port
REM then opens the browser). Not meant to be invoked by hand.
if "%~1"=="__openwait" goto openwait

REM --- Default: delegate to the windowless launcher --------------------------
REM A plain double-click must never hang. If Start-Blog.exe is present next to
REM this file, launch it and quit right away (the .exe starts the server hidden
REM and opens the browser itself). Pass "log" to force the visible mode instead.
if /i not "%~1"=="log" (
  if exist "%~dp0Start-Blog.exe" (
    start "" "%~dp0Start-Blog.exe"
    exit /b 0
  )
)

echo ======================================================
echo   dev@home Blog - Console / troubleshooting launcher
echo ======================================================
echo.
echo This window IS the blog server. Keep it open while you use the blog;
echo closing it stops the blog. To run without a window, use Start-Blog.exe.
echo.

REM --- 1. locate a runnable program ------------------------------------------
set "BIN="
if exist "bin\blog-windows-amd64.exe" (
  set "BIN=%~dp0bin\blog-windows-amd64.exe"
  echo Found program: bin\blog-windows-amd64.exe
) else (
  where go >nul 2>nul
  if !errorlevel! == 0 (
    echo Building for you ^(first time takes ~15s^)...
    go build -o blogbin.exe .
    if exist "blogbin.exe" set "BIN=%~dp0blogbin.exe"
  )
)
if "!BIN!" == "" (
  echo.
  echo No runnable program found, and Go is not installed.
  echo   Option A: get a version that includes the bin\ prebuilt files.
  echo   Option B: install Go from https://go.dev/dl/ then double-click again.
  echo.
  mshta "javascript:alert('No blog program found. Please use a package that includes the bin folder, or install Go from https://go.dev/dl/.');close();" 2>nul
  pause
  exit /b 1
)

REM --- 2. stable data folder (all your content lives here) ------------------
set "DATA=%USERPROFILE%\dev-home-blog"
if not exist "%DATA%" mkdir "%DATA%"

REM --- 3. open the browser once the server reports its port. Prefer the instant
REM        loading page (loading.html polls the server and redirects itself) so
REM        there is immediate feedback; fall back to the poll-then-open helper.
if exist "%~dp0loading.html" (
  start "" "%~dp0loading.html"
) else (
  start "" /min cmd /c ""%~f0" __openwait"
)

echo.
echo Starting server. A browser will open shortly.
echo.

REM --- 4. run the server (foreground; it self-selects the port) --------------
set "ADDR=127.0.0.1:8080"
set "REPO_DIR=%DATA%"
set "DB_PATH=%DATA%\blog.db"
cd /d "%DATA%"
"!BIN!" serve
exit /b 0

REM ===========================================================================
:openwait
REM Detached helper: wait for .runtime.json, read the real port, open browser.
set "RT=%USERPROFILE%\dev-home-blog\.runtime.json"
for /l %%i in (1,1,60) do (
  if exist "!RT!" (
    set "PORT="
    for /f "tokens=2 delims=:," %%p in ('findstr /c:"\"port\"" "!RT!"') do set "PORT=%%p"
    set "PORT=!PORT: =!"
    if not "!PORT!"=="" (
      start "" "http://localhost:!PORT!/setup"
      exit /b 0
    )
  )
  timeout /t 1 >nul 2>nul
)
REM Fallback if the runtime file never appeared.
start "" "http://localhost:8080/setup"
exit /b 0
