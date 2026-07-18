//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	messageBoxOK           = 0x00000000
	messageBoxYesNoCancel  = 0x00000003
	messageBoxIconError    = 0x00000010
	messageBoxIconQuestion = 0x00000020
	messageBoxTopMost      = 0x00040000

	answerYes    = 6
	answerNo     = 7
	answerCancel = 2

	createNoWindow = 0x08000000
	showNormal     = 1
)

var (
	user32            = syscall.NewLazyDLL("user32.dll")
	shell32           = syscall.NewLazyDLL("shell32.dll")
	procMessageBoxW   = user32.NewProc("MessageBoxW")
	procShellExecuteW = shell32.NewProc("ShellExecuteW")
)

type runtimeInfo struct {
	Port int    `json:"port"`
	PID  int    `json:"pid"`
	URL  string `json:"url"`
}

func main() {
	root, err := launcherDir()
	if err != nil {
		showError("无法定位启动器位置。\r\n\r\n" + err.Error())
		os.Exit(1)
	}

	bin := findServerBin(root)
	if bin == "" {
		showError("没有找到博客程序。\r\n\r\n请确认解压的是完整的 Blog-Windows 文件夹，里面需要有 bin 文件夹。")
		os.Exit(1)
	}

	data, err := dataDir()
	if err != nil {
		showError("无法定位用户目录。\r\n\r\n" + err.Error())
		os.Exit(1)
	}
	runtimePath := filepath.Join(data, ".runtime.json")

	if info, ok := readRuntime(runtimePath); ok && info.URL != "" && isAlive(info.URL) {
		switch askAlreadyRunning() {
		case answerYes:
			_ = openTarget(info.URL + "/setup")
			return
		case answerNo:
			killPID(info.PID)
			waitUntilStopped(info.URL)
			if err := startServer(bin, data); err != nil {
				showError("重启博客失败。\r\n\r\n" + err.Error())
				os.Exit(1)
			}
			openUI(root, runtimePath)
			return
		case answerCancel:
			return
		default:
			return
		}
	}

	if err := startServer(bin, data); err != nil {
		showError("启动博客失败。\r\n\r\n" + err.Error())
		os.Exit(1)
	}
	openUI(root, runtimePath)
}

func launcherDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

func findServerBin(root string) string {
	candidates := []string{
		filepath.Join(root, "bin", "blog-windows-amd64.exe"),
		filepath.Join(root, "bin", "blog.exe"),
	}
	for _, cand := range candidates {
		if fileExists(cand) {
			return cand
		}
	}
	return ""
}

func dataDir() (string, error) {
	home := os.Getenv("USERPROFILE")
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	return filepath.Join(home, "dev-home-blog"), nil
}

func readRuntime(path string) (runtimeInfo, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return runtimeInfo{}, false
	}
	var info runtimeInfo
	if err := json.Unmarshal(b, &info); err != nil {
		return runtimeInfo{}, false
	}
	if info.URL == "" && info.Port > 0 {
		info.URL = "http://localhost:" + strconv.Itoa(info.Port)
	}
	return info, info.URL != "" || info.PID > 0
}

func isAlive(url string) bool {
	if url == "" {
		return false
	}
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(strings.TrimRight(url, "/") + "/internal/ready")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return resp.StatusCode == http.StatusOK && strings.Contains(string(body), `"ready"`)
}

func askAlreadyRunning() int {
	return messageBox(
		"博客已经在运行中。\r\n\r\n"+
			"是(Y)：打开网页，继续使用当前博客。\r\n"+
			"否(N)：重启，用最新版本重新启动。\r\n"+
			"取消：什么都不做。",
		"dev@home 博客",
		messageBoxYesNoCancel|messageBoxIconQuestion|messageBoxTopMost,
	)
}

func startServer(bin, data string) error {
	if err := os.MkdirAll(data, 0o755); err != nil {
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(data, "server.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}

	cmd := exec.Command(bin, "serve")
	cmd.Dir = data
	cmd.Env = os.Environ()
	// Loopback-only avoids a Windows Firewall prompt; the admin is local-only.
	cmd.Env = setEnv(cmd.Env, "ADDR", "127.0.0.1:8080")
	cmd.Env = setEnv(cmd.Env, "REPO_DIR", data)
	cmd.Env = setEnv(cmd.Env, "DB_PATH", filepath.Join(data, "blog.db"))
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = hiddenProcessAttrs()

	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	err = cmd.Process.Release()
	_ = logFile.Close()
	return err
}

func openUI(root, runtimePath string) {
	page := filepath.Join(root, "loading.html")
	if fileExists(page) {
		if err := openTarget(page); err == nil {
			return
		}
	}
	openWhenReady(runtimePath)
}

func openWhenReady(runtimePath string) {
	for i := 0; i < 60; i++ {
		info, ok := readRuntime(runtimePath)
		if ok && info.URL != "" && isAlive(info.URL) {
			_ = openTarget(info.URL + "/setup")
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	_ = openTarget("http://localhost:8080/setup")
}

func waitUntilStopped(url string) {
	for i := 0; i < 20; i++ {
		if !isAlive(url) {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func killPID(pid int) {
	if pid <= 0 {
		return
	}
	cmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/F")
	cmd.SysProcAttr = hiddenProcessAttrs()
	_ = cmd.Run()
}

func openTarget(target string) error {
	ret, _, err := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr("open"))),
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(target))),
		0,
		0,
		showNormal,
	)
	if ret <= 32 {
		return fmt.Errorf("open %q failed: %v", target, err)
	}
	return nil
}

func messageBox(text, title string, flags uintptr) int {
	ret, _, _ := procMessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(text))),
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(title))),
		flags,
	)
	return int(ret)
}

func showError(text string) {
	messageBox(text, "dev@home 博客", messageBoxOK|messageBoxIconError|messageBoxTopMost)
}

func hiddenProcessAttrs() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}

func setEnv(env []string, key, value string) []string {
	prefix := strings.ToUpper(key) + "="
	for i, entry := range env {
		if strings.HasPrefix(strings.ToUpper(entry), prefix) {
			env[i] = key + "=" + value
			return env
		}
	}
	return append(env, key+"="+value)
}

func fileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}
