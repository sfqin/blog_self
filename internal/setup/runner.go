// Package setup powers the beginner-friendly first-run wizard: it detects the
// tools a non-programmer needs (git, GitHub CLI), guides their installation,
// connects a GitHub account, creates a repository, and publishes the rendered
// static site to GitHub Pages — all driven from buttons in the browser instead
// of the terminal.
//
// Everything that touches the outside world goes through the Runner interface
// so the detection/orchestration logic can be unit-tested with a fake.
package setup

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Runner abstracts executing external commands and looking them up on PATH.
// The real implementation shells out; tests supply a fake.
type Runner interface {
	// Run executes name+args and returns trimmed stdout, trimmed stderr, and
	// the error (if the process exited non-zero or could not start).
	Run(ctx context.Context, name string, args ...string) (stdout, stderr string, err error)
	// Look reports the absolute path of name on PATH and whether it was found.
	Look(name string) (path string, ok bool)
}

// ExecRunner is the production Runner backed by os/exec.
//
// BinDir is a private, app-managed directory (e.g. ~/.dev-home-blog/bin) where
// the wizard drops tools it downloads itself — chiefly the GitHub CLI. Looking
// here first means a beginner never has to install Homebrew or any other
// package manager: we fetch the official binary and run it straight from here.
// It is always searched before the system PATH.
type ExecRunner struct {
	BinDir string
}

// exeName adds the platform executable suffix (".exe" on Windows).
func exeName(name string) string {
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(name), ".exe") {
		return name + ".exe"
	}
	return name
}

// managed returns the path of name inside BinDir if it exists and is a file.
func (e ExecRunner) managed(name string) (string, bool) {
	if e.BinDir == "" {
		return "", false
	}
	p := filepath.Join(e.BinDir, exeName(name))
	if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
		return p, true
	}
	return "", false
}

// Run executes the command, capturing stdout and stderr separately. If name is
// a tool we manage in BinDir, it runs that exact binary; either way BinDir is
// prepended to the child's PATH so any tool it shells out to is found too.
func (e ExecRunner) Run(ctx context.Context, name string, args ...string) (string, string, error) {
	resolved := name
	if p, ok := e.managed(name); ok {
		resolved = p
	}
	cmd := exec.CommandContext(ctx, resolved, args...)
	if e.BinDir != "" {
		cmd.Env = append(os.Environ(), "PATH="+e.BinDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	return strings.TrimSpace(out.String()), strings.TrimSpace(errb.String()), err
}

// Look resolves a binary, preferring our managed BinDir over the system PATH.
func (e ExecRunner) Look(name string) (string, bool) {
	if p, ok := e.managed(name); ok {
		return p, true
	}
	p, err := exec.LookPath(name)
	if err != nil {
		return "", false
	}
	return p, true
}
