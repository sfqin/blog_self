#!/usr/bin/env bash
# package-release.sh — assemble the double-click releases ("安装包") that a
# non-programmer can use with zero terminal, zero Go, zero git knowledge.
#
# The maintainer runs this ONCE per release. It produces TWO platform-specific
# packages under dist-release/ so each user only downloads what their computer
# needs (no mixing macOS + Windows files in one zip):
#
#   Blog-macOS/                     Blog-Windows/
#     Start-Blog.app      ← 双击      Start-Blog.exe        ← 双击（无黑窗）
#     Start-Blog.command  ← 备用      Start-Blog-console.bat ← 进阶/排错（可见日志）
#     bin/blog-macos-*    ← 程序      bin/blog-windows-amd64.exe ← 程序
#     loading.html                   loading.html
#     使用说明.txt                    README.txt
#   Blog-macOS.zip                 Blog-Windows.zip   ← 可直接发送
#
# There is no Stop-Blog file: the server runs in the background, picks its own
# port, and shuts itself down about five minutes after the last blog page is closed
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

echo ">> building windows/amd64 launcher -> $WIN/Start-Blog.exe"
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
  go build -trimpath -ldflags "-s -w -H=windowsgui" -o "$WIN/Start-Blog.exe" ./cmd/windows-launcher

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
# Windows: Start-Blog.exe is the no-console launcher; the console .bat stays as a
# visible troubleshooting fallback. It is renamed Start-Blog-console.bat and made
# safe to double-click: with no args it just hands off to Start-Blog.exe (never a
# stuck window); run it with the "log" arg to watch progress in a console.
cp "$ROOT/Start-Blog-console.bat"  "$WIN/Start-Blog-console.bat"
cp "$ROOT/packaging/loading.html" "$WIN/loading.html"

# --- 4. ultra-short per-platform pointer -----------------------------------
cat > "$MAC/使用说明.txt" <<'TXT'
欢迎使用 blog_self「星夜远行」博客！（macOS 11 或更新版本，Apple Silicon / Intel）

只需双击：  Start-Blog.app
请先解压整个安装包，不要只复制启动文件。
若被系统拦截，确认来源后在“系统设置 → 隐私与安全性 → 仍要打开”中授权。
备用入口为 Start-Blog.command，可以查看启动日志。

之后浏览器会自动打开一个网页向导，跟着上面的按钮一步步点即可：
装工具 → 连 GitHub → 建仓库 → 写文章 → 一键发布上线。

关于停止：不用手动停。博客在后台运行，关掉所有博客网页后
约 5 分钟它会自动停止。

升级时先下载并解压新安装包，再双击新包里的 Start-Blog.app，会弹出选择——
“打开网页”继续用，或“重启”用最新版重新启动。

内容保存在“主目录/dev-home-blog/blog.db”，不在安装包里，升级会继续使用原数据。
备份时先关闭所有博客网页并等待程序退出，再复制整个 dev-home-blog 文件夹。
博客图片/视频使用外部链接，外部媒体文件需要单独备份。
只在本地写作不需要 GitHub；发布时仅上传公开的静态页面，不上传数据库。

新版下载与说明：https://github.com/sfqin/blog_self/releases
TXT

cat > "$WIN/README.txt" <<'TXT'
欢迎使用 blog_self「星夜远行」博客！（Windows 10 或更新版本，x64）

只需双击：  Start-Blog.exe
请先解压整个安装包，不要只复制启动文件。
排错时在命令提示符里运行 Start-Blog-console.bat log，可查看运行日志。

之后浏览器会自动打开一个网页向导，跟着上面的按钮一步步点即可：
装工具 → 连 GitHub → 建仓库 → 写文章 → 一键发布上线。

关于停止：不用手动停。博客在后台运行，关掉所有博客网页后
约 5 分钟它会自动停止。

升级时先下载并解压新安装包，再双击新包里的 Start-Blog.exe，会弹出选择——
“是”打开网页继续用，“否”用最新版重启。

内容保存在“用户目录\dev-home-blog\blog.db”，不在安装包里，升级会继续使用原数据。
备份时先关闭所有博客网页并等待程序退出，再复制整个 dev-home-blog 文件夹。
博客图片/视频使用外部链接，外部媒体文件需要单独备份。
只在本地写作不需要 GitHub；发布时仅上传公开的静态页面，不上传数据库。

新版下载与说明：https://github.com/sfqin/blog_self/releases
TXT

# Include the license for embedded fonts and traceable build information.
for package in "$MAC" "$WIN"; do
  cp "$ROOT/web/static/fonts/OFL.txt" "$package/FONT-LICENSE.txt"
  {
    echo "Source: https://github.com/sfqin/blog_self"
    echo "Commit: $(git rev-parse HEAD)"
    echo "Toolchain: $(go version)"
    if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
      echo "Working tree: modified"
    else
      echo "Working tree: clean"
    fi
  } > "$package/BUILD-INFO.txt"
done

# --- 5. zip each platform up for easy sending ------------------------------
# Exclude macOS junk (.DS_Store / AppleDouble) so a non-programmer never sees it.
echo "== 打包 zip =="
( cd "$DIST" && zip -q -r -y "Blog-macOS.zip"   "Blog-macOS"   -x '*.DS_Store' -x '*/__MACOSX/*' )
( cd "$DIST" && zip -q -r -y "Blog-Windows.zip" "Blog-Windows" -x '*.DS_Store' -x '*/__MACOSX/*' )
( cd "$DIST" && shasum -a 256 Blog-macOS.zip Blog-Windows.zip > SHA256SUMS.txt )

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
echo "  Windows  → Blog-Windows.zip，解压后双击 Start-Blog.exe"
