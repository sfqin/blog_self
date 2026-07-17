package setup

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeRunner is a scripted Runner for tests. It matches on the command name
// plus a substring of the joined args, returning canned output/errors.
type fakeRunner struct {
	present map[string]bool      // binaries found on PATH
	replies map[string]fakeReply // key: "name args-substring" (see match)
	calls   []string             // record of executed "name args" for assertions
}

type fakeReply struct {
	stdout string
	stderr string
	err    error
}

func (f *fakeRunner) Look(name string) (string, bool) {
	if f.present[name] {
		return "/usr/bin/" + name, true
	}
	return "", false
}

func (f *fakeRunner) Run(_ context.Context, name string, args ...string) (string, string, error) {
	joined := name + " " + strings.Join(args, " ")
	f.calls = append(f.calls, joined)
	for key, rep := range f.replies {
		if strings.HasPrefix(key, name) && strings.Contains(joined, strings.TrimSpace(strings.TrimPrefix(key, name))) {
			return rep.stdout, rep.stderr, rep.err
		}
	}
	return "", "", errors.New("no fake reply for: " + joined)
}

func TestDetect_AllReady(t *testing.T) {
	f := &fakeRunner{
		present: map[string]bool{"git": true, "gh": true},
		replies: map[string]fakeReply{
			"git --version":                      {stdout: "git version 2.42.0"},
			"gh --version":                       {stdout: "gh version 2.40.0"},
			"gh api user --jq .login":            {stdout: "alice"},
			"git -C /repo remote get-url origin": {stdout: "https://github.com/alice/blog.git"},
		},
	}
	d := &Detector{Run: f, Repo: "/repo"}
	st := d.Detect(context.Background())

	if st.Git.State != StatusOK {
		t.Errorf("git state = %q, want ok", st.Git.State)
	}
	if st.GH.State != StatusOK {
		t.Errorf("gh state = %q, want ok", st.GH.State)
	}
	if st.GitHubUser != "alice" {
		t.Errorf("github user = %q, want alice", st.GitHubUser)
	}
	if st.RemoteURL != "https://github.com/alice/blog.git" {
		t.Errorf("remote = %q", st.RemoteURL)
	}
	if !st.AllReady {
		t.Error("AllReady = false, want true when git+gh+auth+remote all present")
	}
}

func TestDetect_MissingGitAndNotAuthed(t *testing.T) {
	f := &fakeRunner{
		present: map[string]bool{"git": false, "gh": true},
		replies: map[string]fakeReply{
			"gh --version":                {stdout: "gh version 2.40.0"},
			"gh api user --jq .login":     {stderr: "not logged in", err: errors.New("exit 1")},
			"git -C /repo remote get-url": {stderr: "no remote", err: errors.New("exit 2")},
		},
	}
	d := &Detector{Run: f, Repo: "/repo"}
	st := d.Detect(context.Background())

	if st.Git.State != StatusMissing {
		t.Errorf("git state = %q, want missing", st.Git.State)
	}
	// gh is installed but NOT authenticated -> treated as missing (needs login).
	if st.GH.State != StatusMissing {
		t.Errorf("gh state = %q, want missing (unauthenticated)", st.GH.State)
	}
	if st.GH.Version == "" {
		t.Error("gh version should still be detected even when unauthenticated")
	}
	if st.GitHubUser != "" {
		t.Errorf("github user = %q, want empty", st.GitHubUser)
	}
	if st.AllReady {
		t.Error("AllReady = true, want false")
	}
}

func TestParseOwnerRepo(t *testing.T) {
	cases := []struct {
		in          string
		owner, repo string
		ok          bool
	}{
		{"https://github.com/alice/blog.git", "alice", "blog", true},
		{"https://github.com/alice/blog", "alice", "blog", true},
		{"git@github.com:bob/my-site.git", "bob", "my-site", true},
		{"https://github.com/org/repo/", "org", "repo", true},
		{"https://gitlab.com/x/y.git", "", "", false},
		{"", "", "", false},
	}
	for _, c := range cases {
		owner, repo, ok := ParseOwnerRepo(c.in)
		if ok != c.ok || owner != c.owner || repo != c.repo {
			t.Errorf("ParseOwnerRepo(%q) = (%q,%q,%v), want (%q,%q,%v)",
				c.in, owner, repo, ok, c.owner, c.repo, c.ok)
		}
	}
}

func TestCreateRepo_RejectsBadName(t *testing.T) {
	f := &fakeRunner{present: map[string]bool{"gh": true}}
	a := &Actor{Run: f}
	res := a.CreateRepo(context.Background(), "bad name!")
	if res.OK {
		t.Error("expected rejection of invalid repo name")
	}
	if len(f.calls) != 0 {
		t.Errorf("no commands should run for an invalid name, got %v", f.calls)
	}
}

func TestCreateRepo_LinksExisting(t *testing.T) {
	f := &fakeRunner{
		present: map[string]bool{"gh": true, "git": true},
		replies: map[string]fakeReply{
			"gh api user --jq .login":                {stdout: "alice"},
			"gh repo view alice/blog":                {stdout: "public"}, // exists & public
			"git -C /repo rev-parse --show-toplevel": {stdout: "/repo"},  // already our repo
			"git -C /repo remote set-url origin":     {stdout: ""},       // link succeeds
		},
	}
	a := &Actor{Run: f, Repo: "/repo"}
	res := a.CreateRepo(context.Background(), "blog")
	if !res.OK {
		t.Fatalf("expected OK linking existing repo, got: %s / %s", res.Message, res.Detail)
	}
	if res.URL != "https://github.com/alice/blog" {
		t.Errorf("url = %q", res.URL)
	}
	// It must NOT attempt to create when the repo already exists.
	for _, c := range f.calls {
		if strings.Contains(c, "repo create") {
			t.Errorf("should not call 'repo create' for existing repo; calls=%v", f.calls)
		}
	}
	// Since the toplevel already equals the repo, it must NOT re-init.
	for _, c := range f.calls {
		if strings.Contains(c, "init") {
			t.Errorf("should not 'git init' when repo already exists; calls=%v", f.calls)
		}
	}
}

// A pre-existing PRIVATE repo cannot host free GitHub Pages, so linking it must
// fail with a clear message rather than silently proceeding to a doomed publish.
func TestCreateRepo_RejectsExistingPrivate(t *testing.T) {
	f := &fakeRunner{
		present: map[string]bool{"gh": true, "git": true},
		replies: map[string]fakeReply{
			"gh api user --jq .login":                {stdout: "alice"},
			"gh repo view alice/blog":                {stdout: "private"}, // exists but private
			"git -C /repo rev-parse --show-toplevel": {stdout: "/repo"},
			"git -C /repo remote set-url origin":     {stdout: ""},
		},
	}
	a := &Actor{Run: f, Repo: "/repo"}
	res := a.CreateRepo(context.Background(), "blog")
	if res.OK {
		t.Fatal("expected failure linking an existing private repo")
	}
	if !strings.Contains(res.Message, "私有") {
		t.Errorf("message should explain the private-repo problem, got: %q", res.Message)
	}
	for _, c := range f.calls {
		if strings.Contains(c, "repo create") {
			t.Errorf("must not create over an existing repo; calls=%v", f.calls)
		}
	}
}

// A brand-new repo must be created public (--public), never private.
func TestCreateRepo_CreatesPublic(t *testing.T) {
	f := &fakeRunner{
		present: map[string]bool{"gh": true, "git": true},
		replies: map[string]fakeReply{
			"gh api user --jq .login":                {stdout: "alice"},
			"gh repo view alice/blog":                {stderr: "not found", err: errors.New("exit 1")},
			"gh repo create alice/blog":              {stdout: "created"},
			"git -C /repo rev-parse --show-toplevel": {stdout: "/repo"},
			"git -C /repo remote set-url origin":     {stdout: ""},
		},
	}
	a := &Actor{Run: f, Repo: "/repo"}
	res := a.CreateRepo(context.Background(), "blog")
	if !res.OK {
		t.Fatalf("expected OK creating repo, got: %s / %s", res.Message, res.Detail)
	}
	var created string
	for _, c := range f.calls {
		if strings.Contains(c, "repo create") {
			created = c
		}
	}
	if !strings.Contains(created, "--public") {
		t.Errorf("repo must be created public; call=%q", created)
	}
	if strings.Contains(created, "--private") {
		t.Errorf("repo must never be created private; call=%q", created)
	}
}

// When the folder is NOT its own git repo (rev-parse fails, or resolves to a
// PARENT repo), setOrigin must `git init` locally first so publishing can never
// bubble up to and clobber a surrounding repository's origin.
func TestSetOrigin_InitsWhenNotOwnRepo(t *testing.T) {
	f := &fakeRunner{
		present: map[string]bool{"git": true},
		replies: map[string]fakeReply{
			// No repo here at all -> rev-parse fails.
			"git -C /fresh rev-parse --show-toplevel": {stderr: "not a git repository", err: errors.New("exit 128")},
			"git -C /fresh init":                      {stdout: ""},
			"git -C /fresh remote set-url origin":     {stderr: "no origin", err: errors.New("exit 2")},
			"git -C /fresh remote add origin":         {stdout: ""},
		},
	}
	a := &Actor{Run: f, Repo: "/fresh"}
	res := a.setOrigin(context.Background(), "alice/blog")
	if !res.OK {
		t.Fatalf("setOrigin should succeed after init, got: %s / %s", res.Message, res.Detail)
	}
	var didInit, didAdd bool
	for _, c := range f.calls {
		if strings.Contains(c, "-C /fresh init") {
			didInit = true
		}
		if strings.Contains(c, "remote add origin") {
			didAdd = true
		}
	}
	if !didInit {
		t.Errorf("expected 'git init' for a non-repo folder; calls=%v", f.calls)
	}
	if !didAdd {
		t.Errorf("expected 'git remote add origin' after init; calls=%v", f.calls)
	}
}

func TestInstallGit_UnsupportedOS(t *testing.T) {
	a := &Actor{Run: &fakeRunner{}}
	res := a.InstallGit(context.Background(), "plan9")
	if res.OK {
		t.Error("unsupported OS should not report success")
	}
}
