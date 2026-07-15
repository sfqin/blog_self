#!/usr/bin/env bash
# deploy.sh — build the dev@home blog and deploy it to a Linux server.
#
# Two modes:
#   ./scripts/deploy.sh build            Cross-compile the linux/amd64 binary
#                                         into ./dist/s_blog (run locally).
#   ./scripts/deploy.sh push user@host   Build, then rsync binary + config to
#                                         the server and restart the service.
#
# The Go binary embeds all templates, CSS, JS, and geo JSON (//go:embed), so
# the ONLY artifact that needs to ship is the single executable.
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE_DIR=/opt/s_blog
BIN=dist/s_blog

build() {
	echo ">> building linux/amd64 binary -> ${BIN}"
	mkdir -p dist
	# CGO is not needed: modernc.org/sqlite is pure Go.
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "${BIN}" .
	ls -lh "${BIN}"
}

push() {
	local target="$1"
	build
	echo ">> uploading to ${target}:${REMOTE_DIR}"
	# Ensure remote layout exists (idempotent).
	ssh "${target}" "sudo mkdir -p ${REMOTE_DIR}/data && sudo chown -R \$USER ${REMOTE_DIR}"
	# Ship the binary to a staging path, then atomically move it into place.
	rsync -avz "${BIN}" "${target}:${REMOTE_DIR}/s_blog.new"
	rsync -avz Caddyfile s_blog.service "${target}:${REMOTE_DIR}/"
	ssh "${target}" "sudo mv ${REMOTE_DIR}/s_blog.new ${REMOTE_DIR}/s_blog && sudo chmod +x ${REMOTE_DIR}/s_blog && sudo systemctl restart s_blog && sudo systemctl --no-pager status s_blog | head -n 5"
	echo ">> done. If this is the first deploy, install the unit + Caddy first (see README.md)."
}

cmd="${1:-build}"
case "${cmd}" in
	build) build ;;
	push)
		[ $# -ge 2 ] || { echo "usage: $0 push user@host" >&2; exit 1; }
		push "$2"
		;;
	*) echo "usage: $0 {build|push user@host}" >&2; exit 1 ;;
esac
