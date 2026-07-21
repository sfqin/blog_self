package setup

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

// mingitRelease builds a release payload mirroring git-for-windows' real asset
// naming for a given version, including the busybox variants we must skip.
func mingitRelease(ver string) *ghRelease {
	base := "https://github.com/git-for-windows/git/releases/download/v" + ver + ".windows.1/"
	names := []string{
		"MinGit-" + ver + "-64-bit.zip",
		"MinGit-" + ver + "-32-bit.zip",
		"MinGit-" + ver + "-arm64.zip",
		"MinGit-" + ver + "-busybox-64-bit.zip",
		"MinGit-" + ver + "-busybox-32-bit.zip",
		"PortableGit-" + ver + "-64-bit.7z.exe",
		"Git-" + ver + "-64-bit.exe",
	}
	rel := &ghRelease{TagName: "v" + ver}
	for _, n := range names {
		rel.Assets = append(rel.Assets, struct {
			URL string `json:"browser_download_url"`
		}{URL: base + n})
	}
	return rel
}

func TestPickMinGitAsset(t *testing.T) {
	rel := mingitRelease("2.55.0.3")
	cases := []struct {
		goarch   string
		wantName string
		wantErr  bool
	}{
		{"amd64", "MinGit-2.55.0.3-64-bit.zip", false},
		{"arm64", "MinGit-2.55.0.3-arm64.zip", false},
		{"386", "MinGit-2.55.0.3-32-bit.zip", false},
		{"mips", "", true},
	}
	for _, c := range cases {
		url, err := pickMinGitAsset(rel, c.goarch)
		if c.wantErr {
			if err == nil {
				t.Errorf("pickMinGitAsset(%s) expected error", c.goarch)
			}
			continue
		}
		if err != nil {
			t.Errorf("pickMinGitAsset(%s) unexpected error: %v", c.goarch, err)
			continue
		}
		if got := filepath.Base(url); got != c.wantName {
			t.Errorf("pickMinGitAsset(%s) = %q, want %q", c.goarch, got, c.wantName)
		}
	}
}

// The busybox MinGit must never be chosen (it trims tools we may rely on).
func TestPickMinGitAsset_SkipsBusybox(t *testing.T) {
	base := "https://example/"
	rel := &ghRelease{Assets: []struct {
		URL string `json:"browser_download_url"`
	}{
		{URL: base + "MinGit-2.55.0.3-busybox-64-bit.zip"},
		{URL: base + "MinGit-2.55.0.3-64-bit.zip"},
	}}
	url, err := pickMinGitAsset(rel, "amd64")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if filepath.Base(url) != "MinGit-2.55.0.3-64-bit.zip" {
		t.Errorf("picked %q, want the non-busybox MinGit", filepath.Base(url))
	}
}

// extractZipTree must reproduce the MinGit layout (cmd/git.exe + nested dirs)
// and keep the extracted git.exe present under <root>/cmd.
func TestExtractZipTree(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "mingit.zip")
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	mustZip(t, zw, "cmd/git.exe", "GIT-EXE")
	mustZip(t, zw, "mingw64/bin/git.exe", "GIT-CORE")
	mustZip(t, zw, "mingw64/bin/git-remote-https.exe", "HTTPS-HELPER")
	mustZip(t, zw, "etc/gitconfig", "[core]\n")
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	root := filepath.Join(dir, "git")
	if err := extractZipTree(archive, root); err != nil {
		t.Fatalf("extractZipTree: %v", err)
	}
	gitExe := filepath.Join(root, "cmd", "git.exe")
	got, err := os.ReadFile(gitExe)
	if err != nil {
		t.Fatalf("expected cmd/git.exe extracted: %v", err)
	}
	if string(got) != "GIT-EXE" {
		t.Errorf("cmd/git.exe content = %q", got)
	}
	if _, err := os.Stat(filepath.Join(root, "mingw64", "bin", "git-remote-https.exe")); err != nil {
		t.Errorf("push helper git-remote-https.exe should be extracted: %v", err)
	}
}

// A Zip-Slip entry (path escaping the destination) must be rejected.
func TestExtractZipTree_RejectsZipSlip(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "evil.zip")
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	mustZip(t, zw, "../escape.exe", "PWNED")
	zw.Close()
	os.WriteFile(archive, buf.Bytes(), 0o644)
	if err := extractZipTree(archive, filepath.Join(dir, "git")); err == nil {
		t.Error("expected extractZipTree to reject a path escaping the destination")
	}
}

// The Runner must resolve a bare "git" to the nested MinGit path
// (<BinDir>/git/cmd/git.exe) that install_git.go lays down.
func TestExecRunner_ManagedNestedGit(t *testing.T) {
	dir := t.TempDir()
	cmdDir := filepath.Join(dir, gitSubdir, "cmd")
	if err := os.MkdirAll(cmdDir, 0o755); err != nil {
		t.Fatal(err)
	}
	gitExe := filepath.Join(cmdDir, exeName("git"))
	if err := os.WriteFile(gitExe, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	r := ExecRunner{BinDir: dir}
	got, ok := r.Look("git")
	if !ok {
		t.Fatal("Look(git) should find the nested MinGit binary")
	}
	if got != gitExe {
		t.Errorf("Look(git) = %q, want nested MinGit path %q", got, gitExe)
	}
}

func TestInstallGitWindows_NoBinDir(t *testing.T) {
	if _, err := installGitWindows(context.Background(), "", "amd64"); err == nil {
		t.Error("installGitWindows should fail without a bin dir")
	}
}
