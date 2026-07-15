#!/usr/bin/env bash
# publish-all.sh — one command, all four free hosts.
#
# Renders TWO builds from the local blog.db and pushes them to the right places:
#
#   ┌─ root-path build  → GitHub master  dist/     → Cloudflare Pages  (auto)
#   │                                               → EdgeOne Pages    (auto)
#   └─ /blog sub-path build ─┬→ GitHub  gh-pages branch → GitHub Pages (auto)
#                            └→ Gitee   master  (whole repo) → Gitee Pages
#                                                              (then click 更新)
#
# Why two builds:
#   - Cloudflare / EdgeOne serve at a domain ROOT, so assets use /static, /posts.
#   - GitHub Pages (sfqin.github.io/blog) and Gitee Pages (qzcsu.gitee.io/blog)
#     both serve under the SAME "/blog" sub-path (the repo name), so ONE
#     BASE_URL=/blog build feeds both.
#
# The SQLite DB (with your admin password) never leaves your machine; only the
# rendered static files are pushed.
#
# Prerequisites (one-time):
#   git remote add origin git@github.com:sfqin/blog.git      # GitHub
#   git remote add gitee  git@gitee.com:qzcsu/blog.git       # Gitee
#
# Usage:
#   ./scripts/publish-all.sh                    # publish everything
#   ./scripts/publish-all.sh "post: hello"      # custom commit message
#   SUBPATH=/blog ./scripts/publish-all.sh      # override sub-path (default /blog)
#   SKIP_GITEE=1 ./scripts/publish-all.sh       # skip a target
#   SKIP_GH_PAGES=1 ./scripts/publish-all.sh
set -euo pipefail

cd "$(dirname "$0")/.."

DB_PATH="${DB_PATH:-blog.db}"
SUBPATH="${SUBPATH:-/blog}"          # URL sub-path for GitHub Pages + Gitee Pages
GH_REMOTE="${GH_REMOTE:-origin}"     # GitHub remote
GH_PAGES_BRANCH="${GH_PAGES_BRANCH:-gh-pages}"
GITEE_REMOTE="${GITEE_REMOTE:-gitee}"
GITEE_BRANCH="${GITEE_BRANCH:-master}"
MSG="${1:-publish: $(date '+%Y-%m-%d %H:%M:%S')}"

if [ ! -f "$DB_PATH" ]; then
	echo "!! database not found at '$DB_PATH'." >&2
	echo "   Run the admin first:  ADMIN_PASSWORD=... ./blogbin serve   (edit at /admin)" >&2
	exit 1
fi

echo ">> building binary"
go build -o ./blogbin .

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ---------------------------------------------------------------------------
# Target 1 — root-path build → GitHub master dist/ (Cloudflare + EdgeOne).
# ---------------------------------------------------------------------------
echo ""
echo ">> [1/3] GitHub master dist/  (root-path → Cloudflare + EdgeOne)"
DB_PATH="$DB_PATH" ./blogbin export "dist"   # BASE_URL empty → root paths
git add -A dist
if git diff --cached --quiet; then
	echo "   dist/ unchanged — nothing to commit."
else
	git commit -q -m "$MSG"
fi
if git remote | grep -qx "$GH_REMOTE"; then
	branch="$(git rev-parse --abbrev-ref HEAD)"
	echo "   pushing source+dist to $GH_REMOTE/$branch"
	git push -q "$GH_REMOTE" "$branch"
	echo "   ✓ Cloudflare + EdgeOne will auto-deploy dist/ shortly."
else
	echo "   !! remote '$GH_REMOTE' not set; skipped. Add: git remote add origin git@github.com:sfqin/blog.git" >&2
fi

# ---------------------------------------------------------------------------
# Build the shared /blog sub-path site once, reuse for GitHub Pages + Gitee.
# ---------------------------------------------------------------------------
echo ""
echo ">> building sub-path site (BASE_URL=$SUBPATH) for GitHub Pages + Gitee"
DB_PATH="$DB_PATH" BASE_URL="$SUBPATH" ./blogbin export "$WORK/site"

# Helper: force-push the built site as the sole content of a branch on a remote,
# using a throwaway git repo so our main history stays clean.
push_site() {
	local remote_url="$1" branch="$2" label="$3"
	(
		cd "$WORK/site"
		rm -rf .git
		git init -q
		git checkout -q -b "$branch"
		git add -A
		git -c user.email=publish@local -c user.name=publish commit -q -m "$MSG"
		git push -q --force "$remote_url" "$branch"
	)
	echo "   ✓ $label"
}

# ---------------------------------------------------------------------------
# Target 2 — /blog build → GitHub gh-pages branch (GitHub Pages).
# ---------------------------------------------------------------------------
echo ""
if [ "${SKIP_GH_PAGES:-0}" = "1" ]; then
	echo ">> [2/3] GitHub Pages — SKIPPED (SKIP_GH_PAGES=1)"
elif git remote | grep -qx "$GH_REMOTE"; then
	echo ">> [2/3] GitHub Pages  ($GH_REMOTE/$GH_PAGES_BRANCH, sub-path $SUBPATH)"
	push_site "$(git remote get-url "$GH_REMOTE")" "$GH_PAGES_BRANCH" \
		"pushed to $GH_REMOTE/$GH_PAGES_BRANCH — enable once: Settings → Pages → Source = Deploy from branch → $GH_PAGES_BRANCH /(root)"
else
	echo ">> [2/3] GitHub Pages — remote '$GH_REMOTE' not set; skipped." >&2
fi

# ---------------------------------------------------------------------------
# Target 3 — /blog build → Gitee master (Gitee Pages, manual 更新).
# ---------------------------------------------------------------------------
echo ""
if [ "${SKIP_GITEE:-0}" = "1" ]; then
	echo ">> [3/3] Gitee Pages — SKIPPED (SKIP_GITEE=1)"
elif git remote | grep -qx "$GITEE_REMOTE"; then
	echo ">> [3/3] Gitee Pages  ($GITEE_REMOTE/$GITEE_BRANCH, sub-path $SUBPATH)"
	push_site "$(git remote get-url "$GITEE_REMOTE")" "$GITEE_BRANCH" \
		"pushed to $GITEE_REMOTE/$GITEE_BRANCH — NOW open Gitee repo → 服务 → Gitee Pages → click 更新 (free tier does not auto-deploy)"
else
	echo ">> [3/3] Gitee Pages — remote '$GITEE_REMOTE' not set; skipped." >&2
fi

echo ""
echo ">> done. Summary of live URLs (after each platform finishes deploying):"
echo "   Cloudflare : https://<your-project>.pages.dev            (root, auto)"
echo "   EdgeOne    : https://<edgeone-domain>                    (root, auto)"
echo "   GitHub     : https://sfqin.github.io${SUBPATH}/          (sub-path, auto after enable)"
echo "   Gitee      : https://qzcsu.gitee.io${SUBPATH}/           (sub-path, after clicking 更新)"
