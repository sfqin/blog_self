package setup

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// This file installs the GitHub CLI (gh) WITHOUT any third-party package
// manager. A beginner should never have to install Homebrew, MacPorts, winget
// sources, or download an installer by hand. Instead we fetch gh's official,
// signed release archive straight from github.com/cli/cli and unpack the single
// `gh` binary into our app-managed BinDir, which the Runner searches first.
//
// The only external dependency is a network connection to GitHub — the same
// place the user is publishing to anyway.

// ghDownloadTimeout bounds the whole download+extract. gh archives are ~10–15MB.
const ghDownloadTimeout = 5 * time.Minute

// ghLatestAPI resolves the newest release (tag + assets) without pinning a
// version, so this keeps working as gh publishes updates.
const ghLatestAPI = "https://api.github.com/repos/cli/cli/releases/latest"

// httpClient is used for all outbound release traffic.
var httpClient = &http.Client{Timeout: ghDownloadTimeout}

// ghRelease mirrors the fields we need from the GitHub releases API. We only
// read each asset's download URL; its file name is derived from the URL base.
type ghRelease struct {
	TagName string `json:"tag_name"`
	Assets  []struct {
		URL string `json:"browser_download_url"`
	} `json:"assets"`
}

// assetInfo is the resolved archive for the current OS/arch.
type assetInfo struct {
	url   string
	isZip bool // true = .zip (macOS/Windows), false = .tar.gz (Linux)
}

// installGHDirect downloads the official gh release for goos/goarch and unpacks
// the gh binary into binDir. It returns the resolved binary path on success.
//
// goos/goarch use Go's naming ("darwin","windows","linux" and "arm64","amd64");
// gh's asset names use "macOS"/"windows"/"linux", handled in assetName.
func installGHDirect(ctx context.Context, binDir, goos, goarch string) (string, error) {
	if binDir == "" {
		return "", fmt.Errorf("no managed bin directory configured")
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return "", fmt.Errorf("创建工具目录失败: %w", err)
	}

	rel, err := fetchLatestRelease(ctx)
	if err != nil {
		return "", err
	}
	asset, err := pickAsset(rel, goos, goarch)
	if err != nil {
		return "", err
	}

	// Download to a temp file first so a partial download never looks installed.
	tmp, err := os.CreateTemp(binDir, "gh-dl-*")
	if err != nil {
		return "", fmt.Errorf("创建临时文件失败: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := downloadTo(ctx, asset.url, tmp); err != nil {
		tmp.Close()
		return "", err
	}
	tmp.Close()

	dst := filepath.Join(binDir, exeName("gh"))
	if asset.isZip {
		if err := extractGHFromZip(tmpPath, dst); err != nil {
			return "", err
		}
	} else {
		if err := extractGHFromTarGz(tmpPath, dst); err != nil {
			return "", err
		}
	}
	if err := os.Chmod(dst, 0o755); err != nil {
		return "", fmt.Errorf("设置可执行权限失败: %w", err)
	}
	return dst, nil
}

// fetchLatestRelease queries the GitHub API for the newest gh release.
func fetchLatestRelease(ctx context.Context) (*ghRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ghLatestAPI, nil)
	if err != nil {
		return nil, err
	}
	// The API prefers a UA and this header; anonymous calls are rate-limited but
	// fine for a one-off install.
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "dev-home-blog-setup")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("连接 GitHub 失败，请检查网络: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("获取 GitHub CLI 版本信息失败 (HTTP %d)", resp.StatusCode)
	}
	var rel ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("解析版本信息失败: %w", err)
	}
	if len(rel.Assets) == 0 {
		return nil, fmt.Errorf("未找到可下载的 GitHub CLI 安装包")
	}
	return &rel, nil
}

// pickAsset selects the archive matching the current platform. gh publishes
// per-release names like:
//
//	gh_2.96.0_macOS_arm64.zip     (macOS, .zip)
//	gh_2.96.0_windows_amd64.zip   (Windows, .zip — no installer needed)
//	gh_2.96.0_linux_amd64.tar.gz  (Linux, .tar.gz)
func pickAsset(rel *ghRelease, goos, goarch string) (assetInfo, error) {
	osToken := map[string]string{"darwin": "macOS", "windows": "windows", "linux": "linux"}[goos]
	if osToken == "" {
		return assetInfo{}, fmt.Errorf("暂不支持在该系统上自动安装 GitHub CLI (%s)", goos)
	}
	wantZip := goos == "darwin" || goos == "windows"
	suffix := ".tar.gz"
	if wantZip {
		suffix = ".zip"
	}
	// Match on OS + arch + extension. We tolerate either amd64/x86_64 spellings.
	archTokens := []string{goarch}
	if goarch == "amd64" {
		archTokens = append(archTokens, "x86_64")
	}
	for _, a := range rel.Assets {
		name := path.Base(a.URL)
		if !strings.Contains(name, "_"+osToken+"_") || !strings.HasSuffix(name, suffix) {
			continue
		}
		for _, at := range archTokens {
			if strings.Contains(name, "_"+at) {
				return assetInfo{url: a.URL, isZip: wantZip}, nil
			}
		}
	}
	return assetInfo{}, fmt.Errorf("未找到匹配 %s/%s 的 GitHub CLI 安装包", goos, goarch)
}

// downloadTo streams url into w.
func downloadTo(ctx context.Context, url string, w io.Writer) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "dev-home-blog-setup")
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("下载 GitHub CLI 失败，请检查网络: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载 GitHub CLI 失败 (HTTP %d)", resp.StatusCode)
	}
	if _, err := io.Copy(w, resp.Body); err != nil {
		return fmt.Errorf("写入下载文件失败: %w", err)
	}
	return nil
}

// ghEntryName reports whether a path inside an archive is the gh binary we want.
// Archives lay out as gh_<ver>_<os>_<arch>/bin/gh (or bin/gh.exe on Windows).
func ghEntryName(name string) bool {
	base := path.Base(filepath.ToSlash(name))
	dir := path.Base(path.Dir(filepath.ToSlash(name)))
	return dir == "bin" && (base == "gh" || base == "gh.exe")
}

// extractGHFromZip pulls bin/gh(.exe) out of a .zip archive into dst.
func extractGHFromZip(archivePath, dst string) error {
	zr, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("解压安装包失败: %w", err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.FileInfo().IsDir() || !ghEntryName(f.Name) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("读取安装包失败: %w", err)
		}
		err = writeFile(dst, rc)
		rc.Close()
		return err
	}
	return fmt.Errorf("安装包中未找到 gh 可执行文件")
}

// extractGHFromTarGz pulls bin/gh out of a .tar.gz archive into dst.
func extractGHFromTarGz(archivePath, dst string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("解压安装包失败: %w", err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("读取安装包失败: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg || !ghEntryName(hdr.Name) {
			continue
		}
		return writeFile(dst, tr)
	}
	return fmt.Errorf("安装包中未找到 gh 可执行文件")
}

// writeFile creates/overwrites dst with the contents of r, executable.
func writeFile(dst string, r io.Reader) error {
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fmt.Errorf("写入 gh 失败: %w", err)
	}
	defer out.Close()
	if _, err := io.Copy(out, r); err != nil {
		return fmt.Errorf("写入 gh 失败: %w", err)
	}
	return nil
}

// currentArch returns Go's runtime arch, isolated for testability.
func currentArch() string { return runtime.GOARCH }
