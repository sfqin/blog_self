@echo off
REM Start-Blog.bat — Windows engine for the dev@home blog.
REM
REM Usually launched invisibly by Start-Blog.vbs (no console window). You can also
REM double-click this .bat directly if you prefer seeing progress text.
REM
REM It finds a self-contained program (bin\blog-windows-amd64.exe), keeps all
REM content in a stable folder (%USERPROFILE%\dev-home-blog), and runs the server.
REM The server picks its own port (auto-bumps if 8080 is busy) and shuts itself
REM down about a minute after the last blog page is closed (heartbeat), so there
REM is no Stop step. Closing this window also stops it.
REM
REM Arg "noopen": don't open the browser (Start-Blog.vbs opens it itself). Arg
REM "__openwait": internal — the detached helper that waits for the port then
REM opens the browser.
setlocal enabledelayedexpansion
cd /d "%~dp0"

if "%~1"=="__openwait" goto openwait

echo ======================================================
echo   dev@home Blog - Launcher
echo ======================================================
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

REM --- 3. open the browser once the server reports its port (unless told not
REM        to; Start-Blog.vbs opens it itself). Prefer the instant loading page
REM        (loading.html polls the server and redirects itself) so there is
REM        immediate feedback; fall back to the poll-then-open helper.
if /i not "%~1"=="noopen" (
  if exist "%~dp0loading.html" (
    start "" "%~dp0loading.html"
  ) else (
    start "" /min cmd /c ""%~f0" __openwait"
  )
)

echo.
echo Starting server. A browser will open shortly.
echo Keep this program running - closing it stops the blog. It also stops on its
echo own about a minute after you close the last blog page.
echo.

REM --- 4. run the server (foreground; it self-selects the port) --------------
set "ADDR=:8080"
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
