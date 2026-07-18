#!/usr/bin/env bash
# package-release.sh — assemble the double-click releases ("安装包") that a
# non-programmer can use with zero terminal, zero Go, zero git knowledge.
#
# The maintainer runs this ONCE per release. It produces TWO platform-specific
# packages under dist-release/ so each user only downloads what their computer
# needs (no mixing macOS + Windows files in one zip):
#
#   Blog-macOS/                     Blog-Windows/
#     Start-Blog.app      ← 双击      Start-Blog.vbs   ← 双击（无黑窗）
#     Start-Blog.command  ← 备用      Start-Blog.bat   ← 引擎/可见备用
#     bin/blog-macos-*    ← 程序      bin/blog-windows-amd64.exe ← 程序
#     loading.html                   loading.html
#     docs/新手指南.md               docs/新手指南.md
#     使用说明.txt                    使用说明.txt
#   Blog-macOS.zip                 Blog-Windows.zip   ← 可直接发送
#
# There is no Stop-Blog file: the server runs in the background, picks its own
# port, and shuts itself down about a minute after the last blog page is closed
# (a heartbeat from every open page keeps it alive). Re-running Start offers to
# open or restart a running instance.
#
# Everything (templates/CSS/JS/geo data) is embedded in each binary via
# //go:embed, so the binaries are fully self-contained.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DIST="$ROOT/dist-release"
MAC="$DIST/Blog-macOS"
WIN="$DIST/Blog-Windows"

echo "== 清理旧的发布目录 =="
rm -rf "$DIST"
mkdir -p "$MAC/bin" "$WIN/bin"

# --- 1. cross-compile the self-contained binaries --------------------------
# CGO off because modernc.org/sqlite is pure Go, so cross-compiling is clean.
build() {
  local goos="$1" goarch="$2" out="$3"
  echo ">> building ${goos}/${goarch} -> ${out}"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "-s -w" -o "$out" .
}
build darwin  arm64 "$MAC/bin/blog-macos-arm64"
build darwin  amd64 "$MAC/bin/blog-macos-amd64"
build windows amd64 "$WIN/bin/blog-windows-amd64.exe"
chmod +x "$MAC/bin/blog-macos-arm64" "$MAC/bin/blog-macos-amd64"

# --- 2. assemble the macOS .app --------------------------------------------
# Layout:
#   Start-Blog.app/Contents/Info.plist
#                          /MacOS/launch          (the executable)
#                          /Resources/blog-macos-*  (both arch binaries)
echo "== 组装 macOS Start-Blog.app =="
APP="$MAC/Start-Blog.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/packaging/mac/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/packaging/mac/launch"     "$APP/Contents/MacOS/launch"
chmod +x "$APP/Contents/MacOS/launch"
# Ship both Mac architectures inside the app; launch picks the right one.
cp "$MAC/bin/blog-macos-arm64" "$APP/Contents/Resources/blog-macos-arm64"
cp "$MAC/bin/blog-macos-amd64" "$APP/Contents/Resources/blog-macos-amd64"
chmod +x "$APP/Contents/Resources/blog-macos-arm64" "$APP/Contents/Resources/blog-macos-amd64"
# The instant loading page the .app launcher opens on start (it polls the server
# and redirects to /setup itself, so the user sees a spinner during boot).
cp "$ROOT/packaging/loading.html" "$APP/Contents/Resources/loading.html"
# Optional custom icon: drop packaging/mac/AppIcon.icns to brand it.
if [ -f "$ROOT/packaging/mac/AppIcon.icns" ]; then
  cp "$ROOT/packaging/mac/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
fi

# --- 3. copy the double-click launchers ------------------------------------
echo "== 复制启动器与加载页 =="
# macOS: the visible-terminal fallback next to the .app.
cp "$ROOT/Start-Blog.command" "$MAC/Start-Blog.command"
chmod +x "$MAC/Start-Blog.command"
cp "$ROOT/packaging/loading.html" "$MAC/loading.html"
# Windows: the .vbs (no console) and the .bat engine / visible fallback.
cp "$ROOT/packaging/windows/Start-Blog.vbs" "$WIN/Start-Blog.vbs"
cp "$ROOT/Start-Blog.bat"                    "$WIN/Start-Blog.bat"
cp "$ROOT/packaging/loading.html"            "$WIN/loading.html"

# --- 4. docs + ultra-short per-platform pointer ----------------------------
mkdir -p "$MAC/docs" "$WIN/docs"
cp "$ROOT/docs/新手指南.md" "$MAC/docs/新手指南.md"
cp "$ROOT/docs/新手指南.md" "$WIN/docs/新手指南.md"

cat > "$MAC/使用说明.txt" <<'TXT'
欢迎使用 dev@home 博客！（苹果电脑 macOS 版）

只需双击：  Start-Blog.app
（若被系统拦截，改双击备用的 Start-Blog.command）

之后浏览器会自动打开一个网页向导，跟着上面的按钮一步步点即可：
装工具 → 连 GitHub → 建仓库 → 写文章 → 一键发布上线。

关于停止：不用手动停。博客在后台运行，关掉所有博客网页后
约 1 分钟它会自动停止。

想立刻用最新版本：再次双击 Start-Blog.app，会弹出选择——
“打开网页”继续用，或“重启”用最新版重新启动。

你的全部内容保存在“主目录/dev-home-blog/blog.db”，只在本地，想备份就复制它。
更详细的图文说明见 docs/新手指南.md。
TXT

cat > "$WIN/使用说明.txt" <<'TXT'
欢迎使用 dev@home 博客！（Windows 版）

只需双击：  Start-Blog.vbs
（想看运行进度，可改双击 Start-Blog.bat）

之后浏览器会自动打开一个网页向导，跟着上面的按钮一步步点即可：
装工具 → 连 GitHub → 建仓库 → 写文章 → 一键发布上线。

关于停止：不用手动停。博客在后台运行，关掉所有博客网页后
约 1 分钟它会自动停止。

想立刻用最新版本：再次双击 Start-Blog.vbs，会弹出选择——
“是”打开网页继续用，“否”用最新版重启。

你的全部内容保存在“用户目录\dev-home-blog\blog.db”，只在本地，想备份就复制它。
更详细的图文说明见 docs/新手指南.md。
TXT

# --- 5. zip each platform up for easy sending ------------------------------
# Exclude macOS junk (.DS_Store / AppleDouble) so a non-programmer never sees it.
echo "== 打包 zip =="
( cd "$DIST" && zip -q -r -y "Blog-macOS.zip"   "Blog-macOS"   -x '*.DS_Store' -x '*/__MACOSX/*' )
( cd "$DIST" && zip -q -r -y "Blog-Windows.zip" "Blog-Windows" -x '*.DS_Store' -x '*/__MACOSX/*' )

echo ""
echo ">> 完成！发布目录："
echo "   macOS  ：dist-release/Blog-macOS/    →  dist-release/Blog-macOS.zip"
echo "   Windows：dist-release/Blog-Windows/  →  dist-release/Blog-Windows.zip"
echo ""
echo "内容（macOS）："
ls -la "$MAC"
echo ""
echo "内容（Windows）："
ls -la "$WIN"
echo ""
echo "把对应系统的压缩包发给完全不懂编程的人即可："
echo "  苹果电脑 → Blog-macOS.zip，解压后双击 Start-Blog.app"
echo "  Windows  → Blog-Windows.zip，解压后双击 Start-Blog.vbs"
