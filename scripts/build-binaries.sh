#!/usr/bin/env bash
# build-binaries.sh — cross-compile ready-to-run blog binaries so end users
# never need to install Go.
#
# The maintainer runs this ONCE per release. It produces:
#   bin/blog-macos-arm64     (Apple Silicon Macs)
#   bin/blog-macos-amd64     (Intel Macs)
#   bin/blog-windows-amd64.exe
#
# Ship the whole folder (including Start-Blog.command / Start-Blog-console.bat and
# bin/) to a non-programmer. They double-click the launcher for their OS; it picks
# the matching prebuilt binary from bin/ — no Go, no terminal.
#
# All templates/CSS/JS/geo data are embedded via //go:embed, so each binary is
# fully self-contained.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p bin

# -trimpath + "-s -w" strip paths and debug info for smaller binaries.
# CGO is disabled because modernc.org/sqlite is pure Go (cross-compiles cleanly).
build() {
  local goos="$1" goarch="$2" out="$3"
  echo ">> building ${goos}/${goarch} -> bin/${out}"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "-s -w" -o "bin/${out}" .
}

build darwin  arm64 "blog-macos-arm64"
build darwin  amd64 "blog-macos-amd64"
build windows amd64 "blog-windows-amd64.exe"

echo ""
echo ">> done. Contents of bin/:"
ls -lh bin/
echo ""
echo "Ship these to a beginner along with the launchers:"
echo "   Start-Blog.command       (macOS — double-click)"
echo "   Start-Blog.exe           (Windows — double-click; Start-Blog-console.bat is the console fallback)"
echo "   bin/                 (the prebuilt programs above)"
echo "   web/, docs/          (optional; binaries already embed web assets)"
