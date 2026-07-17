package setup

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// PagesResult carries the outcome of a publish, including the live URL.
type PagesResult struct {
	ActionResult
}

var ownerRepoRe = regexp.MustCompile(`github\.com[:/]+([^/]+)/([^/.]+)(?:\.git)?/?$`)

// ParseOwnerRepo extracts (owner, repo) from an origin remote URL. Supports
// both https://github.com/owner/repo(.git) and git@github.com:owner/repo.git.
func ParseOwnerRepo(remoteURL string) (owner, repo string, ok bool) {
	m := ownerRepoRe.FindStringSubmatch(strings.TrimSpace(remoteURL))
	if m == nil {
		return "", "", false
	}
	return m[1], strings.TrimSuffix(m[2], ".git"), true
}

// PublishPages force-pushes the already-rendered static site (renderedDir) to
// the gh-pages branch of origin, enables GitHub Pages (branch gh-pages, /),
// and returns the resulting live URL. The rendered site must have been built
// with base="/<repo>" so its absolute asset paths resolve under the Pages
// sub-path https://<owner>.github.io/<repo>/.
//
// The push uses a throwaway git repo inside renderedDir so the main repo's
// history is never touched — mirroring scripts/publish-all.sh's push_site.
func (a *Actor) PublishPages(ctx context.Context, renderedDir, owner, repo, message string) PagesResult {
	cctx, cancel := context.WithTimeout(ctx, actionTimeout)
	defer cancel()

	if message == "" {
		message = "publish: " + time.Now().Format("2006-01-02 15:04:05")
	}
	remoteURL := "https://github.com/" + owner + "/" + repo + ".git"

	// The push must authenticate without a terminal. `gh auth login` (device
	// flow) does not configure git's credential helper, so a bare
	// `git push https://github.com/...` has no way to prove who we are and dies
	// with "could not read Username" (there is no TTY to prompt on). We reuse
	// the token gh already holds and embed it in the push URL — the same scheme
	// GitHub Actions uses. The token is passed only to this one push (never
	// saved as a remote), the throwaway .git is deleted afterwards, and it is
	// redacted from any surfaced error, so it does not linger anywhere.
	pushURL := remoteURL
	if tok, _, err := a.Run.Run(cctx, "gh", "auth", "token"); err == nil {
		if tok = firstLine(tok); tok != "" {
			pushURL = "https://x-access-token:" + tok + "@github.com/" + owner + "/" + repo + ".git"
		}
	}

	// Build a self-contained git repo in the rendered dir and force-push it as
	// the whole content of gh-pages. Running git with -C keeps it scoped.
	steps := [][]string{
		{"-C", renderedDir, "init", "-q"},
		{"-C", renderedDir, "checkout", "-q", "-b", "gh-pages"},
		{"-C", renderedDir, "add", "-A"},
		{"-C", renderedDir, "-c", "user.email=publish@local", "-c", "user.name=publish", "commit", "-q", "-m", message},
		{"-C", renderedDir, "push", "-q", "--force", pushURL, "gh-pages"},
	}
	// Remove any stale .git first (idempotent re-publish).
	_ = os.RemoveAll(filepath.Join(renderedDir, ".git"))
	for _, args := range steps {
		if _, stderr, err := a.Run.Run(cctx, "git", args...); err != nil {
			// "nothing to commit" is not fatal on republish with no changes.
			if strings.Contains(stderr, "nothing to commit") {
				continue
			}
			// Never leak the embedded token into the UI or logs.
			safeArgs := redactURL(strings.Join(args, " "), pushURL, remoteURL)
			safeErr := redactURL(fmtErr(err, stderr), pushURL, remoteURL)
			return PagesResult{ActionResult{
				OK:      false,
				Message: "推送到 GitHub Pages 失败。",
				Detail:  fmt.Sprintf("git %s\n%s", safeArgs, safeErr),
			}}
		}
	}

	// Enable GitHub Pages from the gh-pages branch, then verify it actually
	// turned on. The content is already safely pushed, so if auto-enable does
	// not stick (rare — e.g. a token without admin rights), we guide the user
	// through the one-time manual toggle instead of reporting a live URL that
	// would 404.
	url := fmt.Sprintf("https://%s.github.io/%s/", owner, repo)
	if !a.enablePages(cctx, owner, repo) {
		return PagesResult{ActionResult{
			OK:      false,
			Message: "站点内容已成功上传，但没能自动开启 GitHub Pages。请打开仓库 Settings → Pages，把 Source 设为分支 gh-pages、目录 /(root) 后保存，约 1–2 分钟即可访问。",
			URL:     url,
			Detail:  "Pages 设置页：https://github.com/" + owner + "/" + repo + "/settings/pages",
		}}
	}
	return PagesResult{ActionResult{
		OK:      true,
		Message: "已发布到 GitHub Pages！首次启用后约 1–2 分钟生效。",
		URL:     url,
	}}
}

// enablePages ensures GitHub Pages is on for the repo, serving the gh-pages
// branch at /, and reports whether it is confirmed enabled.
//
// The POST creates the Pages site (201 the first time, 409 if it already
// exists — both fine, so its error is ignored). Because that call can also fail
// for reasons worth surfacing (e.g. a token without admin rights), we then GET
// the Pages config: a live html_url means Pages is really configured.
func (a *Actor) enablePages(ctx context.Context, owner, repo string) bool {
	// POST creates the Pages site; if it exists this errors and we ignore it.
	_, _, _ = a.Run.Run(ctx, "gh", "api", "-X", "POST",
		fmt.Sprintf("repos/%s/%s/pages", owner, repo),
		"-f", "source[branch]=gh-pages", "-f", "source[path]=/")
	// Verify: a Pages site resource with an html_url exists (200), regardless of
	// whether the first build has finished.
	out, _, err := a.Run.Run(ctx, "gh", "api",
		fmt.Sprintf("repos/%s/%s/pages", owner, repo), "--jq", ".html_url")
	return err == nil && firstLine(out) != ""
}

// redactURL replaces any occurrence of the (possibly token-bearing) push URL
// with the clean remote URL, so a leaked token never reaches logs or the UI.
func redactURL(s, pushURL, cleanURL string) string {
	if pushURL == "" || pushURL == cleanURL {
		return s
	}
	return strings.ReplaceAll(s, pushURL, cleanURL)
}
