#!/usr/bin/env bash
# Start-Blog.command — macOS fallback launcher (visible terminal window).
#
# The preferred way to start on macOS is double-clicking Start-Blog.app (no
# terminal window). Use THIS file only if the .app is blocked or missing — it
# does the same thing.
#
# Like the .app, this is a *controller*: it starts the server DETACHED in the
# background, so you can close this window right after and the blog keeps
# running. The server picks its own port and shuts itself down about a minute
# after you close the last blog page (heartbeat) — there is no Stop button.
set -euo pipefail
cd "$(dirname "$0")"

echo "======================================================"
echo "  dev@home 博客 — 启动器（备用/终端方式）"
echo "======================================================"
echo ""

# --- 1. locate a runnable program ------------------------------------------
ARCH="$(uname -m)"   # arm64 (Apple Silicon) or x86_64 (Intel)
BIN=""
for cand in "bin/blog-macos-$ARCH" "bin/blog-macos-arm64" "bin/blog-macos-amd64" \
            "Start-Blog.app/Contents/Resources/blog-macos-$ARCH"; do
  if [ -x "$cand" ]; then BIN="$(cd "$(dirname "$cand")" && pwd)/$(basename "$cand")"; break; fi
done
if [ -z "$BIN" ]; then
  if command -v go >/dev/null 2>&1; then
    echo "· 正在为你编译（首次约需十几秒）…"
    go build -o ./blogbin . && BIN="$(pwd)/blogbin"
    echo "✓ 编译完成。"
  else
    echo "✗ 没有找到可运行的程序，也没有安装 Go。"
    echo "   A. 让提供者给你带 bin/ 预编译文件的完整发布包（无需装 Go）。"
    echo "   B. 从 https://go.dev/dl/ 安装 Go 后，重新双击本文件。"
    read -r -p "按回车键关闭窗口…" _
    exit 1
  fi
fi

# --- 2. stable data folder -------------------------------------------------
DATA="$HOME/dev-home-blog"
mkdir -p "$DATA"
RUNTIME="$DATA/.runtime.json"

running_url() { [ -f "$RUNTIME" ] && sed -n 's/.*"url"[ ]*:[ ]*"\([^"]*\)".*/\1/p' "$RUNTIME" | head -1; }
running_pid() { [ -f "$RUNTIME" ] && sed -n 's/.*"pid"[ ]*:[ ]*\([0-9]*\).*/\1/p' "$RUNTIME" | head -1; }
is_alive()    { curl -s -m 2 "$1/internal/ready" 2>/dev/null | grep -q '"ready"'; }

start_detached() {
  ( cd "$DATA" && ADDR=":8080" REPO_DIR="$DATA" DB_PATH="$DATA/blog.db" \
      nohup "$BIN" serve >"$DATA/server.log" 2>&1 & )
}
open_when_ready() {
  for _ in $(seq 1 40); do
    local u; u="$(running_url)"
    if [ -n "$u" ] && is_alive "$u"; then open "$u/setup"; return 0; fi
    sleep 0.25
  done
  open "http://localhost:8080/setup"
}

# Show the self-contained loading page immediately (it polls the server and
# redirects to /setup itself), so there's a CRT spinner instead of a blank wait.
# Look for it next to this script or inside the .app; fall back to poll-then-open.
open_ui() {
  local cand
  for cand in "$(dirname "$0")/loading.html" \
              "$(dirname "$0")/Start-Blog.app/Contents/Resources/loading.html"; do
    if [ -f "$cand" ]; then open "$cand"; return 0; fi
  done
  open_when_ready
}

# --- 3. already running? offer open / restart ------------------------------
URL="$(running_url || true)"
if [ -n "${URL:-}" ] && is_alive "$URL"; then
  echo "· 博客已在运行：$URL"
  echo "  [1] 打开网页（默认）   [2] 重启（用最新版）"
  read -r -p "选择 1 或 2，回车默认 1： " ANS || ANS=1
  if [ "${ANS:-1}" = "2" ]; then
    PID="$(running_pid || true)"
    [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true
    for _ in $(seq 1 20); do is_alive "$URL" || break; sleep 0.25; done
    echo "· 正在用最新版重启…"
    start_detached
    open_ui
  else
    open "$URL/setup"
  fi
  echo "✓ 完成。可以关闭此窗口，博客在后台运行。"
  exit 0
fi

# --- 4. not running: start detached ----------------------------------------
echo "· 正在后台启动博客，稍后会自动打开浏览器…"
start_detached
open_ui
echo ""
echo "✓ 博客已在后台运行。可以关闭此窗口。"
echo "  关掉所有博客网页约 1 分钟后，它会自动停止。"
echo "  想立刻用最新版：再次双击 Start，选择“重启”。"
