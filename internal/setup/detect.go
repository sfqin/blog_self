package setup

import (
	"context"
	"runtime"
	"strings"
	"sync"
	"time"
)

// StepState is the status of a single wizard step.
type StepState string

const (
	StatusOK      StepState = "ok"      // requirement satisfied
	StatusMissing StepState = "missing" // needs action (install / login / create)
	StatusUnknown StepState = "unknown" // could not be determined
)

// Tool reports whether a required CLI tool is present and, when relevant,
// whether it is authenticated. It also carries a human hint for fixing it.
type Tool struct {
	Name    string    `json:"name"`    // e.g. "git", "gh"
	Label   string    `json:"label"`   // display name, e.g. "GitHub CLI"
	State   StepState `json:"state"`   // ok / missing / unknown
	Version string    `json:"version"` // detected version line, when found
	Path    string    `json:"path"`    // resolved PATH location, when found
	Detail  string    `json:"detail"`  // extra info (e.g. logged-in GitHub user)
}

// Status is the aggregate wizard state the browser renders.
type Status struct {
	OS         string `json:"os"` // darwin / windows / ...
	Git        Tool   `json:"git"`
	GH         Tool   `json:"gh"`         // GitHub CLI
	GitHubUser string `json:"githubUser"` // authenticated login, when known
	RemoteURL  string `json:"remoteUrl"`  // origin remote, when configured
	// AllReady is true when git+gh exist, gh is authenticated, and an origin
	// remote is configured — i.e. publishing is possible.
	AllReady bool `json:"allReady"`
}

// Detector inspects the local environment. Repo is the working directory of
// the blog checkout (where git commands run).
type Detector struct {
	Run  Runner
	Repo string

	// cache holds the last Detect() result for a short window so rapid polling
	// (the wizard refreshes every ~2.5s, and the launcher probes repeatedly)
	// doesn't re-run the slow, network-bound `gh api user` on every hit.
	mu       sync.Mutex
	cached   Status
	cachedAt time.Time
}

// localTimeout bounds the fast, offline commands (git/gh --version, git remote).
const localTimeout = 8 * time.Second

// netTimeout bounds the network-bound gh calls (gh api user). It is short so a
// weak connection (e.g. a phone hotspot) fails fast instead of blocking the
// wizard/launcher for many seconds.
const netTimeout = 2500 * time.Millisecond

// detectCacheTTL is how long a Detect() result is reused. Kept below the
// wizard's 2.5s poll so a freshly-authorized GitHub login still turns the step
// green promptly, while collapsing bursts of probes into one detection.
const detectCacheTTL = 2 * time.Second

// Detect gathers the full wizard status. It never returns an error; failures
// are represented as StatusMissing/StatusUnknown so the UI can always render.
// Results are cached for detectCacheTTL to keep rapid polling cheap.
func (d *Detector) Detect(ctx context.Context) Status {
	d.mu.Lock()
	if !d.cachedAt.IsZero() && time.Since(d.cachedAt) < detectCacheTTL {
		st := d.cached
		d.mu.Unlock()
		return st
	}
	d.mu.Unlock()

	st := d.detectNow(ctx)

	d.mu.Lock()
	d.cached = st
	d.cachedAt = time.Now()
	d.mu.Unlock()
	return st
}

// detectNow performs the actual environment probing without caching.
func (d *Detector) detectNow(ctx context.Context) Status {
	st := Status{OS: runtime.GOOS}
	st.Git = d.detectGit(ctx)
	st.GH = d.detectGH(ctx)
	if st.GH.State == StatusOK {
		st.GitHubUser = st.GH.Detail
	}
	st.RemoteURL = d.originRemote(ctx)

	st.AllReady = st.Git.State == StatusOK &&
		st.GH.State == StatusOK &&
		st.GitHubUser != "" &&
		st.RemoteURL != ""
	return st
}

// detectGit checks for the git binary and its version.
func (d *Detector) detectGit(ctx context.Context) Tool {
	t := Tool{Name: "git", Label: "Git"}
	path, ok := d.Run.Look("git")
	if !ok {
		t.State = StatusMissing
		return t
	}
	t.Path = path
	cctx, cancel := context.WithTimeout(ctx, localTimeout)
	defer cancel()
	out, _, err := d.Run.Run(cctx, "git", "--version")
	if err != nil {
		t.State = StatusUnknown
		return t
	}
	t.State = StatusOK
	t.Version = firstLine(out)
	return t
}

// detectGH checks for the GitHub CLI, its version, and login state. gh is the
// piece that lets a beginner connect GitHub via a browser (gh auth login)
// without ever touching SSH keys or personal access tokens.
func (d *Detector) detectGH(ctx context.Context) Tool {
	t := Tool{Name: "gh", Label: "GitHub CLI"}
	path, ok := d.Run.Look("gh")
	if !ok {
		t.State = StatusMissing
		return t
	}
	t.Path = path
	cctx, cancel := context.WithTimeout(ctx, localTimeout)
	defer cancel()
	if out, _, err := d.Run.Run(cctx, "gh", "--version"); err == nil {
		t.Version = firstLine(out)
	}
	// gh auth status exits 0 only when logged in. Parse the account name.
	if user, ok := d.ghUser(ctx); ok {
		t.State = StatusOK
		t.Detail = user
	} else {
		// Installed but not logged in — still "missing" from the user's POV,
		// because publishing needs auth. The handler shows a "login" action.
		t.State = StatusMissing
		t.Detail = "" // not authenticated
	}
	return t
}

// ghUser returns the authenticated GitHub login, if any.
func (d *Detector) ghUser(ctx context.Context) (string, bool) {
	cctx, cancel := context.WithTimeout(ctx, netTimeout)
	defer cancel()
	// `gh api user --jq .login` is the most robust way to read the login.
	if out, _, err := d.Run.Run(cctx, "gh", "api", "user", "--jq", ".login"); err == nil {
		if login := strings.TrimSpace(firstLine(out)); login != "" {
			return login, true
		}
	}
	return "", false
}

// originRemote returns the configured origin remote URL (empty if none).
func (d *Detector) originRemote(ctx context.Context) string {
	cctx, cancel := context.WithTimeout(ctx, localTimeout)
	defer cancel()
	out, _, err := d.runInRepo(cctx, "git", "remote", "get-url", "origin")
	if err != nil {
		return ""
	}
	return firstLine(out)
}

// runInRepo runs a command with the repo as working dir. git honours -C.
func (d *Detector) runInRepo(ctx context.Context, name string, args ...string) (string, string, error) {
	if name == "git" && d.Repo != "" {
		args = append([]string{"-C", d.Repo}, args...)
	}
	return d.Run.Run(ctx, name, args...)
}

// firstLine returns the first non-empty line of s, trimmed.
func firstLine(s string) string {
	for _, ln := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(ln); t != "" {
			return t
		}
	}
	return ""
}

// fmtErr collapses a command failure into a single user-facing line.
func fmtErr(err error, stderr string) string {
	if stderr != "" {
		return firstLine(stderr)
	}
	if err != nil {
		return err.Error()
	}
	return "unknown error"
}
