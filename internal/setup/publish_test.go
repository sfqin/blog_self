package setup

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// The publish push has no terminal to prompt on, so it must carry credentials
// itself. These tests lock in that the token gh holds is embedded in the push
// URL, and that it is never leaked back to the UI on failure.

// baseGitReplies returns success replies for the non-push git steps plus the
// Pages enable (POST) and verify (GET) API calls. Keys are chosen to be
// mutually unambiguous under the fakeRunner's "name + args-substring" matcher.
func baseGitReplies() map[string]fakeReply {
	return map[string]fakeReply{
		"git -C /site init":     {stdout: ""},
		"git -C /site checkout": {stdout: ""},
		"git -C /site add":      {stdout: ""},
		"git commit":            {stdout: ""},
		"gh api -X POST":        {stdout: ""},
		// Verify step: Pages is enabled and returns its live URL.
		"gh api repos/alice/blog/pages --jq .html_url": {stdout: "https://alice.github.io/blog/"},
	}
}

func pushCall(calls []string) string {
	var pushed string
	for _, c := range calls {
		if strings.Contains(c, "push") {
			pushed = c
		}
	}
	return pushed
}

func TestPublishPages_EmbedsGHToken(t *testing.T) {
	reps := baseGitReplies()
	reps["gh auth token"] = fakeReply{stdout: "ghp_secrettoken123"}
	reps["git -C /site push"] = fakeReply{stdout: ""}
	f := &fakeRunner{present: map[string]bool{"git": true, "gh": true}, replies: reps}

	a := &Actor{Run: f, Repo: "/repo"}
	res := a.PublishPages(context.Background(), "/site", "alice", "blog", "msg")
	if !res.OK {
		t.Fatalf("publish should succeed, got: %s / %s", res.Message, res.Detail)
	}
	if res.URL != "https://alice.github.io/blog/" {
		t.Errorf("live URL = %q", res.URL)
	}
	pushed := pushCall(f.calls)
	if !strings.Contains(pushed, "x-access-token:ghp_secrettoken123@github.com/alice/blog.git") {
		t.Errorf("push did not embed gh token; call=%q", pushed)
	}
}

func TestPublishPages_RedactsTokenOnError(t *testing.T) {
	reps := baseGitReplies()
	reps["gh auth token"] = fakeReply{stdout: "ghp_secrettoken123"}
	// push fails, echoing the URL back in stderr as real git does.
	reps["git -C /site push"] = fakeReply{
		stderr: "fatal: unable to access https://x-access-token:ghp_secrettoken123@github.com/alice/blog.git",
		err:    errors.New("exit 128"),
	}
	f := &fakeRunner{present: map[string]bool{"git": true, "gh": true}, replies: reps}

	a := &Actor{Run: f, Repo: "/repo"}
	res := a.PublishPages(context.Background(), "/site", "alice", "blog", "msg")
	if res.OK {
		t.Fatal("publish should fail when push fails")
	}
	if strings.Contains(res.Detail, "ghp_secrettoken123") {
		t.Errorf("token leaked into error detail: %q", res.Detail)
	}
}

// Even if gh has no token, publish should still attempt a plain push rather
// than crashing — it just falls back to the un-authenticated URL.
func TestPublishPages_NoTokenFallsBack(t *testing.T) {
	reps := baseGitReplies()
	reps["gh auth token"] = fakeReply{stderr: "not logged in", err: errors.New("exit 1")}
	reps["git -C /site push"] = fakeReply{stdout: ""}
	f := &fakeRunner{present: map[string]bool{"git": true, "gh": true}, replies: reps}

	a := &Actor{Run: f, Repo: "/repo"}
	res := a.PublishPages(context.Background(), "/site", "alice", "blog", "msg")
	if !res.OK {
		t.Fatalf("publish should still succeed via fake, got: %s / %s", res.Message, res.Detail)
	}
	pushed := pushCall(f.calls)
	if !strings.Contains(pushed, "https://github.com/alice/blog.git") {
		t.Errorf("fallback push should use clean URL; call=%q", pushed)
	}
	if strings.Contains(pushed, "x-access-token") {
		t.Errorf("fallback push should not contain token placeholder; call=%q", pushed)
	}
}

// The content push succeeds but auto-enabling Pages does not stick (the verify
// GET returns nothing). Publish must report NOT-OK and guide the user to the
// manual Settings → Pages toggle rather than a URL that would 404.
func TestPublishPages_PagesEnableFailsGuidesUser(t *testing.T) {
	reps := baseGitReplies()
	reps["gh auth token"] = fakeReply{stdout: "ghp_secrettoken123"}
	reps["git -C /site push"] = fakeReply{stdout: ""}
	// Verify step returns empty → Pages not actually enabled.
	reps["gh api repos/alice/blog/pages --jq .html_url"] = fakeReply{stderr: "Not Found", err: errors.New("exit 1")}
	f := &fakeRunner{present: map[string]bool{"git": true, "gh": true}, replies: reps}

	a := &Actor{Run: f, Repo: "/repo"}
	res := a.PublishPages(context.Background(), "/site", "alice", "blog", "msg")
	if res.OK {
		t.Fatal("publish should report not-OK when Pages did not enable")
	}
	if !strings.Contains(res.Message, "Settings") && !strings.Contains(res.Message, "Pages") {
		t.Errorf("message should guide the user to manual Pages setup, got: %q", res.Message)
	}
	// The content was still pushed, so we still surface the eventual URL.
	if res.URL != "https://alice.github.io/blog/" {
		t.Errorf("should still surface the eventual live URL; url=%q", res.URL)
	}
}
