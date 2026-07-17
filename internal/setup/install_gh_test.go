package setup

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// sampleAssets builds a release payload mirroring gh's real asset naming for a
// given version, covering the platforms we auto-install on.
func sampleRelease(ver string) *ghRelease {
	base := "https://github.com/cli/cli/releases/download/v" + ver + "/"
	names := []string{
		"gh_" + ver + "_macOS_arm64.zip",
		"gh_" + ver + "_macOS_amd64.zip",
		"gh_" + ver + "_windows_amd64.zip",
		"gh_" + ver + "_windows_arm64.zip",
		"gh_" + ver + "_windows_amd64.msi",
		"gh_" + ver + "_linux_amd64.tar.gz",
		"gh_" + ver + "_linux_arm64.tar.gz",
	}
	rel := &ghRelease{TagName: "v" + ver}
	for _, n := range names {
		rel.Assets = append(rel.Assets, struct {
			URL string `json:"browser_download_url"`
		}{URL: base + n})
	}
	return rel
}

func TestPickAsset(t *testing.T) {
	rel := sampleRelease("2.96.0")
	cases := []struct {
		goos, goarch string
		wantSuffix   string
		wantZip      bool
		wantErr      bool
	}{
		{"darwin", "arm64", "_macOS_arm64.zip", true, false},
		{"darwin", "amd64", "_macOS_amd64.zip", true, false},
		{"windows", "amd64", "_windows_amd64.zip", true, false}, // prefer .zip, never .msi
		{"linux", "amd64", "_linux_amd64.tar.gz", false, false},
		{"linux", "arm64", "_linux_arm64.tar.gz", false, false},
		{"plan9", "amd64", "", false, true},
	}
	for _, c := range cases {
		got, err := pickAsset(rel, c.goos, c.goarch)
		if c.wantErr {
			if err == nil {
				t.Errorf("pickAsset(%s/%s) expected error", c.goos, c.goarch)
			}
			continue
		}
		if err != nil {
			t.Errorf("pickAsset(%s/%s) unexpected error: %v", c.goos, c.goarch, err)
			continue
		}
		if got.isZip != c.wantZip {
			t.Errorf("pickAsset(%s/%s) isZip=%v want %v", c.goos, c.goarch, got.isZip, c.wantZip)
		}
		if filepath.Base(got.url) != "gh_2.96.0"+c.wantSuffix {
			t.Errorf("pickAsset(%s/%s) url=%q want suffix %q", c.goos, c.goarch, got.url, c.wantSuffix)
		}
	}
}

// pickAsset should tolerate the x86_64 spelling some tools use for amd64.
func TestPickAsset_X86Alias(t *testing.T) {
	base := "https://example/"
	rel := &ghRelease{Assets: []struct {
		URL string `json:"browser_download_url"`
	}{{URL: base + "gh_2.0.0_macOS_x86_64.zip"}}}
	got, err := pickAsset(rel, "darwin", "amd64")
	if err != nil {
		t.Fatalf("expected x86_64 to match amd64, got %v", err)
	}
	if !got.isZip {
		t.Errorf("macOS asset should be zip")
	}
}

func TestGHEntryName(t *testing.T) {
	yes := []string{
		"gh_2.96.0_macOS_arm64/bin/gh",
		"gh_2.96.0_windows_amd64/bin/gh.exe",
		"bin/gh",
	}
	no := []string{
		"gh_2.96.0_macOS_arm64/share/man/gh.1",
		"bin/ghost",
		"README.md",
		"gh", // not under bin/
	}
	for _, n := range yes {
		if !ghEntryName(n) {
			t.Errorf("ghEntryName(%q) = false, want true", n)
		}
	}
	for _, n := range no {
		if ghEntryName(n) {
			t.Errorf("ghEntryName(%q) = true, want false", n)
		}
	}
}

func TestExtractGHFromZip(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "gh.zip")
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	// A noise file plus the real binary under bin/.
	mustZip(t, zw, "gh_x/share/readme.txt", "noise")
	mustZip(t, zw, "gh_x/bin/gh", "#!/bin/sh\necho GH-BINARY\n")
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(dir, "gh")
	if err := extractGHFromZip(archive, dst); err != nil {
		t.Fatalf("extractGHFromZip: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(got, []byte("GH-BINARY")) {
		t.Errorf("extracted content = %q, want the gh binary", got)
	}
	if fi, _ := os.Stat(dst); runtime.GOOS != "windows" && fi.Mode().Perm()&0o100 == 0 {
		t.Errorf("extracted gh should be executable, mode=%v", fi.Mode())
	}
}

func TestExtractGHFromTarGz(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "gh.tar.gz")
	buf := &bytes.Buffer{}
	gz := gzip.NewWriter(buf)
	tw := tar.NewWriter(gz)
	mustTar(t, tw, "gh_x/share/readme.txt", "noise")
	mustTar(t, tw, "gh_x/bin/gh", "GH-BINARY-TGZ")
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	dst := filepath.Join(dir, "gh")
	if err := extractGHFromTarGz(archive, dst); err != nil {
		t.Fatalf("extractGHFromTarGz: %v", err)
	}
	got, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "GH-BINARY-TGZ" {
		t.Errorf("extracted content = %q", got)
	}
}

// extraction must fail clearly when there is no gh binary in the archive.
func TestExtractGH_MissingBinary(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "gh.zip")
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	mustZip(t, zw, "gh_x/share/readme.txt", "noise")
	zw.Close()
	os.WriteFile(archive, buf.Bytes(), 0o644)
	if err := extractGHFromZip(archive, filepath.Join(dir, "gh")); err == nil {
		t.Error("expected error when archive lacks a gh binary")
	}
}

// The managed BinDir must be preferred over PATH by both Look and Run.
func TestExecRunner_ManagedBinDir(t *testing.T) {
	dir := t.TempDir()
	ghPath := filepath.Join(dir, exeName("gh"))
	if err := os.WriteFile(ghPath, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	r := ExecRunner{BinDir: dir}
	got, ok := r.Look("gh")
	if !ok {
		t.Fatal("Look(gh) should find the managed binary")
	}
	if got != ghPath {
		t.Errorf("Look(gh) = %q, want managed path %q", got, ghPath)
	}
	// A tool not in BinDir falls through to PATH (git is virtually always present
	// in CI); we only assert it does not resolve to BinDir.
	if p, ok := r.Look("definitely-not-a-real-tool-xyz"); ok {
		t.Errorf("unexpected resolution %q for a nonexistent tool", p)
	}
}

func TestInstallGHDirect_NoBinDir(t *testing.T) {
	if _, err := installGHDirect(context.Background(), "", "darwin", "arm64"); err == nil {
		t.Error("installGHDirect should fail without a bin dir")
	}
}

// --- helpers --------------------------------------------------------------

func mustZip(t *testing.T, zw *zip.Writer, name, body string) {
	t.Helper()
	w, err := zw.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
}

func mustTar(t *testing.T, tw *tar.Writer, name, body string) {
	t.Helper()
	if err := tw.WriteHeader(&tar.Header{
		Name: name, Mode: 0o755, Size: int64(len(body)), Typeflag: tar.TypeReg,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
}
