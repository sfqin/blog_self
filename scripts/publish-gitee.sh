#!/usr/bin/env bash
# publish-gitee.sh — build a SUB-PATH static site and push it to a Gitee repo,
# for hosting on Gitee Pages (served at https://<user>.gitee.io/<repo>/).
#
# Why separate from publish.sh:
#   - Gitee Pages (free) serves under a sub-path, so assets/links must be
#     prefixed. We build with BASE_URL="/<repo>".
#   - Gitee is a different git host, so we push to its own remote.
#   - IMPORTANT: Gitee Pages FREE tier does NOT auto-deploy. After pushing you
#     must click "更新/部署" in the repo's 服务 -> Gitee Pages page. (Auto-deploy
#     needs the paid Gitee Pages Pro.)
#
# One-time setup:
#   1. Create a PUBLIC repo on Gitee, e.g. https://gitee.com/<you>/<repo>
#   2. Complete Gitee 实名认证 (required to enable Pages).
#   3. Add the remote here:
#        git remote add gitee git@gitee.com:<you>/<repo>.git
#
# Usage:
#   ./scripts/publish-gitee.sh <repo> [remote] [branch]
#     <repo>   Gitee repo name -> becomes the URL sub-path (BASE_URL=/<repo>)
#     remote   git remote name (default: gitee)
#     branch   branch Gitee Pages serves from (default: master)
#
# Example:
#   ./scripts/publish-gitee.sh myblog
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${1:-}"
REMOTE="${2:-gitee}"
BRANCH="${3:-master}"
DB_PATH="${DB_PATH:-blog.db}"

if [ -z "$REPO" ]; then
	echo "usage: $0 <gitee-repo-name> [remote] [branch]" >&2
	echo "  the repo name becomes the URL sub-path (BASE_URL=/<repo>)" >&2
	exit 1
fi
if [ ! -f "$DB_PATH" ]; then
	echo "!! database not found at '$DB_PATH'. Run ./blogbin serve and edit at /admin first." >&2
	exit 1
fi
if ! git remote | grep -qx "$REMOTE"; then
	echo "!! git remote '$REMOTE' not found. Add it once, e.g.:" >&2
	echo "   git remote add $REMOTE git@gitee.com:<you>/$REPO.git" >&2
	exit 1
fi

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

echo ">> building binary"
go build -o ./blogbin .

echo ">> exporting sub-path static site (BASE_URL=/$REPO)"
DB_PATH="$DB_PATH" BASE_URL="/$REPO" ./blogbin export "$BUILD_DIR/site"

# Publish the built site as the sole content of BRANCH on the Gitee remote,
# using a temporary throwaway git repo so our main history stays untouched.
echo ">> pushing built site to $REMOTE/$BRANCH"
url="$(git remote get-url "$REMOTE")"
(
	cd "$BUILD_DIR/site"
	git init -q
	git checkout -q -b "$BRANCH"
	git add -A
	git -c user.email=publish@local -c user.name=publish commit -q -m "publish: $(date '+%Y-%m-%d %H:%M:%S')"
	git push -q --force "$url" "$BRANCH"
)

echo ">> done pushing. NOW open your Gitee repo -> 服务 -> Gitee Pages -> click 更新"
echo "   (Gitee free tier does not auto-deploy.)"
echo "   Site will be at: https://<you>.gitee.io/$REPO/"
