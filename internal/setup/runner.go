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

// managed returns the path of name inside BinDir if we manage it there.
//
// Most tools (gh) live flat as <BinDir>/<name>(.exe). Git is special: the
// Windows installer (install_git.go) unpacks the portable MinGit tree into
// <BinDir>/git, whose runnable entry point is <BinDir>/git/cmd/git.exe. So for
// "git" we also probe that nested location.
func (e ExecRunner) managed(name string) (string, bool) {
	if e.BinDir == "" {
		return "", false
	}
	if flat := filepath.Join(e.BinDir, exeName(name)); isFile(flat) {
		return flat, true
	}
	if base := strings.ToLower(strings.TrimSuffix(name, ".exe")); base == "git" {
		if nested := filepath.Join(e.BinDir, gitSubdir, "cmd", exeName("git")); isFile(nested) {
			return nested, true
		}
	}
	return "", false
}

// isFile reports whether p exists and is a regular file (not a directory).
func isFile(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && !fi.IsDir()
}

// childPATH builds the PATH handed to child processes: our managed dirs first,
// then the inherited system PATH. Besides BinDir (where gh lives), it includes
// the portable MinGit dirs when present so that (a) a bare "git" resolves to our
// copy and (b) git's own subprocesses — git-remote-https, credential helpers —
// are found during a push.
func (e ExecRunner) childPATH() string {
	sep := string(os.PathListSeparator)
	dirs := []string{e.BinDir}
	if gitCmd := filepath.Join(e.BinDir, gitSubdir, "cmd"); isDir(gitCmd) {
		dirs = append(dirs, gitCmd, filepath.Join(e.BinDir, gitSubdir, "mingw64", "bin"))
	}
	return strings.Join(dirs, sep) + sep + os.Getenv("PATH")
}

// isDir reports whether p exists and is a directory.
func isDir(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

// Run executes the command, capturing stdout and stderr separately. If name is
// a tool we manage in BinDir, it runs that exact binary; either way our managed
// dirs are prepended to the child's PATH so any tool it shells out to is found.
func (e ExecRunner) Run(ctx context.Context, name string, args ...string) (string, string, error) {
	resolved := name
	if p, ok := e.managed(name); ok {
		resolved = p
	}
	cmd := exec.CommandContext(ctx, resolved, args...)
	if e.BinDir != "" {
		cmd.Env = append(os.Environ(), "PATH="+e.childPATH())
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
