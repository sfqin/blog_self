package setup

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ActionResult is the uniform outcome of a wizard action, serialized to JSON.
type ActionResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`        // human-facing summary (zh)
	Detail  string `json:"detail"`         // command output / error detail
	URL     string `json:"url,omitempty"`  // resulting URL, when relevant
	Code    string `json:"code,omitempty"` // one-time device code, for GitHub login
}

// actionTimeout bounds long-running actions (install, publish, deploy).
const actionTimeout = 10 * time.Minute

// Actor performs the wizard's state-changing operations. It shares the Runner
// and repo path with the Detector. BinDir is the app-managed directory where
// self-downloaded tools (the GitHub CLI) are placed, so beginners never need a
// package manager like Homebrew.
type Actor struct {
	Run    Runner
	Repo   string
	BinDir string

	login loginProc // tracks an in-flight GitHub device-flow login
}

func (a *Actor) runRepoGit(ctx context.Context, args ...string) (string, string, error) {
	full := append([]string{"-C", a.Repo}, args...)
	return a.Run.Run(ctx, "git", full...)
}

// InstallGit installs git using the platform package manager. On macOS this
// triggers the Xcode Command Line Tools installer (a native GUI dialog); on
// Windows it uses winget. Both may prompt the user — we surface guidance
// rather than pretending it is fully silent.
func (a *Actor) InstallGit(ctx context.Context, goos string) ActionResult {
	cctx, cancel := context.WithTimeout(ctx, actionTimeout)
	defer cancel()
	switch goos {
	case "darwin":
		// Triggers the OS "Install Command Line Developer Tools" dialog.
		_, stderr, err := a.Run.Run(cctx, "xcode-select", "--install")
		if err != nil && !strings.Contains(stderr, "already installed") {
			return ActionResult{
				OK:      false,
				Message: "已请求安装 Git（命令行工具）。请在弹出的系统对话框中点“安装”，完成后回到本页点“重新检测”。",
				Detail:  fmtErr(err, stderr),
			}
		}
		return ActionResult{OK: true, Message: "已触发 macOS 命令行工具安装。装好后点“重新检测”。"}
	case "windows":
		out, stderr, err := a.Run.Run(cctx, "winget", "install", "--id", "Git.Git", "-e", "--source", "winget",
			"--accept-package-agreements", "--accept-source-agreements")
		if err != nil {
			return ActionResult{OK: false, Message: "自动安装 Git 失败，请手动安装。", Detail: fmtErr(err, stderr+"\n"+out)}
		}
		return ActionResult{OK: true, Message: "Git 安装完成。请点“重新检测”。", Detail: out}
	default:
		return ActionResult{OK: false, Message: "请用系统包管理器安装 git 后重试。"}
	}
}

// InstallGH installs the GitHub CLI (gh) by downloading the official release
// binary straight from github.com and dropping it into our managed BinDir.
// This deliberately avoids Homebrew, winget, and manual installers: a beginner
// clicks one button and gets a working gh with no other software to install.
func (a *Actor) InstallGH(ctx context.Context, goos string) ActionResult {
	cctx, cancel := context.WithTimeout(ctx, actionTimeout)
	defer cancel()

	path, err := installGHDirect(cctx, a.BinDir, goos, currentArch())
	if err != nil {
		return ActionResult{
			OK:      false,
			Message: "自动下载 GitHub CLI 失败。请确认能正常访问 github.com，然后点“重新检测 / 重试”。",
			Detail:  err.Error(),
		}
	}
	return ActionResult{
		OK:      true,
		Message: "GitHub CLI 已下载并就绪（无需安装其他软件）。请点“重新检测”。",
		Detail:  "已安装到 " + path,
	}
}

var repoNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)

// CreateRepo creates a GitHub repo via gh and wires it as the "origin" remote.
// The repo is always public: GitHub Pages on the free plan only works for
// public repos, so a beginner following this wizard must have one. If a repo of
// that name already exists under the user, it links to it instead of failing —
// but a pre-existing PRIVATE repo is reported so the user knows Pages will not
// work until it is made public (we never flip visibility for them, since that
// would expose their code without asking).
func (a *Actor) CreateRepo(ctx context.Context, name string) ActionResult {
	name = strings.TrimSpace(name)
	if !repoNameRe.MatchString(name) {
		return ActionResult{OK: false, Message: "仓库名只能含字母、数字、点、下划线、连字符（1–100 字符）。"}
	}
	cctx, cancel := context.WithTimeout(ctx, actionTimeout)
	defer cancel()

	// Resolve the login so we can build the remote URL and detect existing repo.
	login, _, err := a.Run.Run(cctx, "gh", "api", "user", "--jq", ".login")
	login = firstLine(login)
	if err != nil || login == "" {
		return ActionResult{OK: false, Message: "无法读取 GitHub 账号，请先在上一步连接 GitHub。"}
	}
	full := login + "/" + name

	// If it already exists, link it — but warn when it is private, since GitHub
	// Pages (free) cannot publish from a private repo.
	if out, _, err := a.Run.Run(cctx, "gh", "repo", "view", full, "--json", "visibility", "--jq", ".visibility"); err == nil {
		if res := a.setOrigin(cctx, full); !res.OK {
			return res
		}
		if strings.EqualFold(firstLine(out), "private") {
			return ActionResult{
				OK:      false,
				Message: fmt.Sprintf("仓库 %s 已存在，但它是【私有】的，GitHub Pages 免费版无法发布私有仓库。请在 GitHub 上把它改为 Public，或换一个新仓库名重新创建。", full),
				URL:     "https://github.com/" + full + "/settings",
			}
		}
		return ActionResult{
			OK:      true,
			Message: fmt.Sprintf("仓库 %s 已存在（公开），已关联为 origin。", full),
			URL:     "https://github.com/" + full,
		}
	}

	// Create the repo (no push yet; publish step pushes dist/gh-pages). Always
	// public so GitHub Pages can serve it on the free plan.
	out, stderr, err := a.Run.Run(cctx, "gh", "repo", "create", full,
		"--public", "--description", "My dev@home blog", "--disable-wiki")
	if err != nil {
		return ActionResult{OK: false, Message: "创建仓库失败。", Detail: fmtErr(err, stderr+"\n"+out)}
	}
	if res := a.setOrigin(cctx, full); !res.OK {
		return res
	}
	return ActionResult{
		OK:      true,
		Message: fmt.Sprintf("已创建【公开】仓库 %s 并关联为 origin。", full),
		Detail:  out,
		URL:     "https://github.com/" + full,
	}
}

// setOrigin points the local origin remote at the given full repo (owner/name)
// over HTTPS, adding or updating as needed. It first makes sure the working dir
// is itself a git repository, so a brand-new beginner folder works and git can
// never "bubble up" to a parent repo's origin.
func (a *Actor) setOrigin(ctx context.Context, full string) ActionResult {
	if res := a.ensureGitRepo(ctx); !res.OK {
		return res
	}
	url := "https://github.com/" + full + ".git"
	// Try update first, then add.
	if _, _, err := a.runRepoGit(ctx, "remote", "set-url", "origin", url); err == nil {
		return ActionResult{OK: true}
	}
	if _, stderr, err := a.runRepoGit(ctx, "remote", "add", "origin", url); err != nil {
		return ActionResult{OK: false, Message: "设置 origin 远端失败。", Detail: fmtErr(err, stderr)}
	}
	return ActionResult{OK: true}
}

// ensureGitRepo makes a.Repo a self-contained git repository if it isn't one
// already. A beginner's blog folder starts as plain files; without this,
// `git remote add` would either fail or (worse) resolve against a parent repo.
// `git init` is idempotent, so re-running is harmless.
func (a *Actor) ensureGitRepo(ctx context.Context) ActionResult {
	// `rev-parse --is-inside-work-tree` succeeds only inside a work tree, but it
	// walks upward — so we check that the toplevel is exactly a.Repo. If the
	// toplevel differs (a parent repo) or there is no repo, we init our own.
	out, _, err := a.runRepoGit(ctx, "rev-parse", "--show-toplevel")
	if err == nil {
		if top, want := absClean(firstLine(out)), absClean(a.Repo); top != "" && top == want {
			return ActionResult{OK: true} // already our own repo
		}
	}
	if _, stderr, err := a.runRepoGit(ctx, "init", "-q"); err != nil {
		return ActionResult{OK: false, Message: "初始化本地仓库失败。", Detail: fmtErr(err, stderr)}
	}
	return ActionResult{OK: true}
}

// absClean returns the cleaned absolute form of p, or "" if it cannot resolve.
func absClean(p string) string {
	if p == "" {
		return ""
	}
	if abs, err := filepath.Abs(p); err == nil {
		return filepath.Clean(abs)
	}
	return filepath.Clean(p)
}
