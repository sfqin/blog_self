#!/usr/bin/env bash
# publish.sh — render the local database into a root-path static site and push
# to GitHub. Both Cloudflare Pages AND Tencent EdgeOne Pages can connect to the
# same GitHub repo and auto-deploy on push, so one run updates both.
#
# For Gitee Pages (served under a sub-path), use publish-gitee.sh instead.
#
# Workflow:
#   1. Write posts / edit data in the LOCAL admin (`./blogbin serve` -> /admin).
#      blog.db stays on your machine (holds your admin password; never committed).
#   2. Run this script: render -> ./dist -> commit -> push to GitHub.
#   3. Cloudflare Pages + EdgeOne Pages (output dir "dist", build command empty)
#      deploy the new ./dist automatically, usually within ~1 minute.
#
# Usage:
#   ./scripts/publish.sh                 # export + commit + push
#   ./scripts/publish.sh "post: hello"   # custom commit message
#   DB_PATH=/path/to/blog.db ./scripts/publish.sh
set -euo pipefail

cd "$(dirname "$0")/.."

DB_PATH="${DB_PATH:-blog.db}"
OUT_DIR="dist"
MSG="${1:-publish: $(date '+%Y-%m-%d %H:%M:%S')}"

if [ ! -f "$DB_PATH" ]; then
	echo "!! database not found at '$DB_PATH'." >&2
	echo "   Run the admin first:  ADMIN_PASSWORD=... ./blogbin serve   (then edit at /admin)" >&2
	exit 1
fi

echo ">> building binary"
go build -o ./blogbin .

echo ">> exporting root-path static site (db=$DB_PATH -> $OUT_DIR/)"
DB_PATH="$DB_PATH" ./blogbin export "$OUT_DIR"   # BASE_URL empty -> root paths

echo ">> committing $OUT_DIR"
git add -A "$OUT_DIR"
if git diff --cached --quiet; then
	echo "   no changes to publish (dist unchanged). Nothing to do."
	exit 0
fi
git commit -q -m "$MSG"

if git remote | grep -q .; then
	branch="$(git rev-parse --abbrev-ref HEAD)"
	echo ">> pushing to $(git remote | head -n1)/$branch"
	git push
	echo ">> done. Cloudflare Pages + EdgeOne Pages will deploy ./dist shortly."
else
	echo "!! no git remote configured. Add your GitHub repo once, e.g.:" >&2
	echo "   git remote add origin git@github.com:<you>/<repo>.git" >&2
	echo "   git push -u origin \$(git rev-parse --abbrev-ref HEAD)" >&2
	echo "   Committed locally; push when the remote is set." >&2
	exit 1
fi
