#!/usr/bin/env bash
# package-release.sh — assemble the double-click release ("安装包") that a
# non-programmer can use with zero terminal, zero Go, zero git knowledge.
#
# The maintainer runs this ONCE per release. It produces dist-release/ :
#
#   Blog/
#     Start-Blog.app        ← macOS: double-click. No terminal window.
#     Start-Blog.command    ← macOS fallback (visible terminal) if .app is blocked
#     Start-Blog.vbs        ← Windows: double-click. No console window.
#     Start-Blog.bat        ← Windows engine / visible fallback
#     bin/                  ← prebuilt self-contained binaries (no Go needed)
#     loading.html          ← instant CRT spinner shown while the server boots
#     docs/新手指南.md      ← the zero-basics guide
#     使用说明.txt          ← ultra-short "which file do I click" note
#   Blog.zip                ← the same, zipped for easy sending
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
OUT="$ROOT/dist-release/Blog"

echo "== 清理旧的发布目录 =="
rm -rf "$ROOT/dist-release"
mkdir -p "$OUT/bin"

# --- 1. cross-compile the self-contained binaries --------------------------
# CGO off because modernc.org/sqlite is pure Go, so cross-compiling is clean.
build() {
  local goos="$1" goarch="$2" out="$3"
  echo ">> building ${goos}/${goarch} -> bin/${out}"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "-s -w" -o "$OUT/bin/${out}" .
}
build darwin  arm64 "blog-macos-arm64"
build darwin  amd64 "blog-macos-amd64"
build windows amd64 "blog-windows-amd64.exe"

# --- 2. assemble the macOS .app --------------------------------------------
# Layout:
#   Start-Blog.app/Contents/Info.plist
#                          /MacOS/launch          (the executable)
#                          /Resources/blog-macos-*  (both arch binaries)
echo "== 组装 macOS Start-Blog.app =="
APP="$OUT/Start-Blog.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/packaging/mac/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/packaging/mac/launch"     "$APP/Contents/MacOS/launch"
chmod +x "$APP/Contents/MacOS/launch"
# Ship both Mac architectures inside the app; launch picks the right one.
cp "$OUT/bin/blog-macos-arm64" "$APP/Contents/Resources/blog-macos-arm64"
cp "$OUT/bin/blog-macos-amd64" "$APP/Contents/Resources/blog-macos-amd64"
chmod +x "$APP/Contents/Resources/blog-macos-arm64" "$APP/Contents/Resources/blog-macos-amd64"
# The instant loading page the .app launcher opens on start (it polls the server
# and redirects to /setup itself, so the user sees a spinner during boot).
cp "$ROOT/packaging/loading.html" "$APP/Contents/Resources/loading.html"
# Optional custom icon: drop packaging/mac/AppIcon.icns to brand it.
if [ -f "$ROOT/packaging/mac/AppIcon.icns" ]; then
  cp "$ROOT/packaging/mac/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
fi

# --- 3. copy the double-click launchers ------------------------------------
echo "== 复制启动器与说明 =="
cp "$ROOT/Start-Blog.command"   "$OUT/Start-Blog.command"
cp "$ROOT/Start-Blog.bat"       "$OUT/Start-Blog.bat"
cp "$ROOT/packaging/windows/Start-Blog.vbs" "$OUT/Start-Blog.vbs"
chmod +x "$OUT/Start-Blog.command"
# Instant loading page opened by the Windows (.vbs/.bat) and macOS fallback
# (.command) launchers, so a spinner shows immediately while the server boots.
cp "$ROOT/packaging/loading.html" "$OUT/loading.html"

# --- 4. docs + ultra-short pointer -----------------------------------------
mkdir -p "$OUT/docs"
cp "$ROOT/docs/新手指南.md" "$OUT/docs/新手指南.md"
cat > "$OUT/使用说明.txt" <<'TXT'
欢迎使用 dev@home 博客！只需双击一个文件：

  苹果电脑（macOS）：双击  Start-Blog.app
  Windows 电脑：      双击  Start-Blog.vbs

之后浏览器会自动打开一个网页向导，跟着上面的按钮一步步点即可：
装工具 → 连 GitHub → 建仓库 → 写文章 → 一键发布上线。

关于停止：不用手动停。博客在后台运行，关掉所有博客网页后
约 1 分钟它会自动停止。

想立刻用最新版本：再次双击 Start（macOS 是 Start-Blog.app，
Windows 是 Start-Blog.vbs），会弹出选择——“打开网页”继续用，
或“重启”用最新版重新启动。

你的全部内容保存在“主目录/dev-home-blog/blog.db”，只在本地，想备份就复制它。
更详细的图文说明见 docs/新手指南.md。
TXT

# --- 5. zip it up for easy sending -----------------------------------------
# Exclude macOS junk (.DS_Store / AppleDouble) so a non-programmer never sees it.
echo "== 打包 zip =="
( cd "$ROOT/dist-release" && zip -q -r -y "Blog.zip" "Blog" -x '*.DS_Store' -x '*/__MACOSX/*' )

echo ""
echo ">> 完成！发布目录：dist-release/Blog/"
echo ">> 可直接发送的压缩包：dist-release/Blog.zip"
echo ""
echo "内容："
ls -la "$OUT"
echo ""
echo "把 Blog.zip 发给完全不懂编程的人即可。他们解压后："
echo "  macOS 双击 Start-Blog.app  /  Windows 双击 Start-Blog.vbs"
