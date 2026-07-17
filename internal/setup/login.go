package setup

import (
	"bufio"
	"context"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// This file makes "连接 GitHub" a one-click experience. GitHub's device flow
// requires the user to paste a one-time code on github.com/login/device — that
// step is mandatory for any app that does NOT embed a secret client key (and
// embedding a secret in a downloadable app would be a security anti-pattern).
//
// So we keep the single code paste but remove every other rough edge:
//   1. we run `gh auth login --web` OURSELVES and stream its output,
//   2. the instant the one-time code appears we grab it and return it to the
//      browser (shown big, with a copy button),
//   3. we open the system browser straight to the device page — the user does
//      not have to find or type any URL,
//   4. gh keeps polling in the background; once the user authorizes, the normal
//      /setup/status detection turns the step green on its own — no manual
//      "recheck" needed.

// deviceCodeRe matches gh's one-time code, e.g. "045A-EDC0".
var deviceCodeRe = regexp.MustCompile(`\b[0-9A-Z]{4}-[0-9A-Z]{4}\b`)

// deviceURL is GitHub's fixed device-authorization page.
const deviceURL = "https://github.com/login/device"

// codeWaitTimeout bounds how long we wait for gh to emit the one-time code
// before giving up on this attempt. gh prints it within a second or two.
const codeWaitTimeout = 25 * time.Second

// loginProc tracks the currently-running gh login so a second click can cancel
// the first instead of spawning duplicate device flows.
type loginProc struct {
	mu  sync.Mutex
	cmd *exec.Cmd
}

// parseDeviceCode extracts the one-time code from a line of gh output, if any.
func parseDeviceCode(line string) string {
	return deviceCodeRe.FindString(strings.ToUpper(line))
}

// browserOpenCmd returns the OS command that opens url in the default browser.
// Split out as a pure function so it can be unit-tested per platform.
func browserOpenCmd(goos, url string) (name string, args []string) {
	switch goos {
	case "darwin":
		return "open", []string{url}
	case "windows":
		// rundll32 avoids a flashing cmd window and handles URLs reliably.
		return "rundll32", []string{"url.dll,FileProtocolHandler", url}
	default: // linux and friends
		return "xdg-open", []string{url}
	}
}

// openBrowser best-effort opens url; failures are non-fatal (the UI also shows
// the link, so the user can click it manually).
func (a *Actor) openBrowser(goos, url string) {
	name, args := browserOpenCmd(goos, url)
	cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = exec.CommandContext(cctx, name, args...).Start()
}

// alreadyAuthed reports whether gh is already logged in (so we can skip the
// whole flow and just report success).
func (a *Actor) alreadyAuthed(ctx context.Context) (string, bool) {
	cctx, cancel := context.WithTimeout(ctx, netTimeout)
	defer cancel()
	if out, _, err := a.Run.Run(cctx, "gh", "api", "user", "--jq", ".login"); err == nil {
		if login := firstLine(out); login != "" {
			return login, true
		}
	}
	return "", false
}

// GHLoginStart begins the browser-based GitHub login and returns as soon as the
// one-time code is known, having already opened the browser. gh keeps running
// in the background to complete the login once the user authorizes.
func (a *Actor) GHLoginStart(ctx context.Context, goos string) ActionResult {
	// Already connected? Nothing to do.
	if login, ok := a.alreadyAuthed(ctx); ok {
		return ActionResult{OK: true, Message: "GitHub 账号已连接（" + login + "），无需重复登录。"}
	}

	ghPath, ok := a.Run.Look("gh")
	if !ok {
		return ActionResult{OK: false, Message: "尚未安装 GitHub CLI，请先回到第①步下载。"}
	}

	// Cancel any previous in-flight login so we never run two device flows.
	a.login.mu.Lock()
	if a.login.cmd != nil && a.login.cmd.Process != nil {
		_ = a.login.cmd.Process.Kill()
	}

	// gh writes the code to stderr and keeps polling on stdout; merge both.
	cmd := exec.Command(ghPath, "auth", "login", "--hostname", "github.com",
		"--git-protocol", "https", "--web")
	if a.BinDir != "" {
		cmd.Env = append(os.Environ(), "PATH="+a.BinDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	}
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		a.login.cmd = nil
		a.login.mu.Unlock()
		pw.Close()
		return ActionResult{OK: false, Message: "启动 GitHub 登录失败。", Detail: err.Error()}
	}
	a.login.cmd = cmd
	a.login.mu.Unlock()

	// Reap the process when it exits (after the user authorizes, or on kill),
	// and unblock the reader by closing the pipe.
	go func() {
		_ = cmd.Wait()
		_ = pw.Close()
	}()

	// Scan output for the one-time code, then keep draining so gh never blocks
	// on a full pipe while it polls for authorization.
	codeCh := make(chan string, 1)
	go func() {
		sc := bufio.NewScanner(pr)
		found := false
		for sc.Scan() {
			if !found {
				if code := parseDeviceCode(sc.Text()); code != "" {
					found = true
					codeCh <- code
				}
			}
			// keep reading (and discarding) until gh exits
		}
		if !found {
			close(codeCh) // signal "no code" on EOF
		}
	}()

	select {
	case code, ok := <-codeCh:
		if !ok || code == "" {
			return ActionResult{
				OK:      false,
				Message: "没能获取到登录代码，请重试；若多次失败，请确认能访问 github.com。",
			}
		}
		a.openBrowser(goos, deviceURL)
		return ActionResult{
			OK:      true,
			Code:    code,
			URL:     deviceURL,
			Message: "已为你打开 GitHub 授权页。请把下面的代码粘贴进去并点授权——授权后本页会自动变绿，无需其他操作。",
		}
	case <-time.After(codeWaitTimeout):
		a.cancelLogin()
		return ActionResult{OK: false, Message: "登录启动超时，请重试。"}
	case <-ctx.Done():
		a.cancelLogin()
		return ActionResult{OK: false, Message: "登录已取消。"}
	}
}

// cancelLogin kills any running gh login process.
func (a *Actor) cancelLogin() {
	a.login.mu.Lock()
	defer a.login.mu.Unlock()
	if a.login.cmd != nil && a.login.cmd.Process != nil {
		_ = a.login.cmd.Process.Kill()
		a.login.cmd = nil
	}
}
