package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dev-home-blog/internal/models"
	"dev-home-blog/internal/render"
	"dev-home-blog/internal/store"
)

// newPublicTestServer builds a real Server for page-level tests: a fresh SQLite
// store under t.TempDir(), templates parsed from the repo's web/ tree (so tests
// always see the current templates, not the embedded copy) and web/static as
// the static FS. The returned store lets callers seed data before requesting.
// Shared fixture for the redesign WPs — append assertions, don't fork it.
func newPublicTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "blog.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })

	static := os.DirFS("../../web/static")
	rnd, err := render.New(os.DirFS("../../web"), static)
	if err != nil {
		t.Fatalf("render.New: %v", err)
	}
	srv, err := New(Config{RepoDir: t.TempDir()}, st, rnd, static)
	if err != nil {
		t.Fatalf("server.New: %v", err)
	}
	return srv, st
}

// doRequest sends one request through the server's router and returns the
// recorded response.
func doRequest(t *testing.T, srv *Server, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	srv.mux.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

// The admin theme picker is retired: the route must not exist at all.
func TestAdminThemeRouteRemoved(t *testing.T) {
	srv, _ := newPublicTestServer(t)
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		rec := doRequest(t, srv, method, "/admin/theme")
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s /admin/theme status = %d, want %d", method, rec.Code, http.StatusNotFound)
		}
	}
}

// Self-hosted fonts (web/static/fonts, added by WP0) must be served with the
// one-year immutable cache. Skips until fonts.css exists in the repo tree; the
// router-level policy is covered unconditionally in static_cache_test.go.
func TestFontsCSSIsImmutable(t *testing.T) {
	if _, err := os.Stat("../../web/static/fonts/fonts.css"); err != nil {
		t.Skip("web/static/fonts/fonts.css not present yet (WP0)")
	}
	srv, _ := newPublicTestServer(t)
	rec := doRequest(t, srv, http.MethodGet, "/static/fonts/fonts.css")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /static/fonts/fonts.css status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") || !strings.Contains(got, "max-age=31536000") {
		t.Fatalf("Cache-Control = %q, want one-year immutable", got)
	}
}

// The admin sidebar must no longer link to the retired theme page.
func TestAdminNavHasNoThemeLink(t *testing.T) {
	srv, _ := newPublicTestServer(t)
	rec := doRequest(t, srv, http.MethodGet, "/admin")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /admin status = %d, want %d", rec.Code, http.StatusOK)
	}
	body := rec.Body.String()
	for _, bad := range []string{`href="/admin/theme"`, `<span class="nav-zh">主题</span>`} {
		if strings.Contains(body, bad) {
			t.Errorf("admin page still contains %q", bad)
		}
	}
	if !strings.Contains(body, `data-theme="F"`) {
		t.Error(`admin page lost <html data-theme="F"> (crt.css scanlines depend on it)`)
	}
}

// seedFullHome fills every home-page module with fictional data (mirrors the
// "full" mode of scripts/seed_fixture.sh at a smaller scale).
func seedFullHome(t *testing.T, st *store.Store) {
	t.Helper()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(st.SaveProfile(models.Profile{Name: "星野", Title: "独立开发者", Tagline: "白天写代码，夜里写字。", Location: "广东", Stack: "Go,SQLite"}))
	_, err := st.CreateExperience(models.Experience{Period: "2024 — 至今", Company: "星港工作室", Role: "独立开发者"})
	must(err)
	_, err = st.CreateFootprint(models.Footprint{CountryCode: "CN", CountryName: "中国", Province: "广东省", City: "深圳市"})
	must(err)
	_, err = st.CreatePost(models.Post{Slug: "harbor-morning", Title: "港口的早晨", Date: "2026-10-01", BodyMD: "正文", Published: true})
	must(err)
	_, err = st.CreateProject(models.Project{Name: "lantern", Description: "星图小工具", Language: "Go", Stars: 12})
	must(err)
	_, err = st.CreateThought(models.Thought{Body: "慢一点没关系。", Topic: "日常", Date: "2026-09-30"})
	must(err)
	_, err = st.CreateMoment(models.Moment{Caption: "末班电车", Date: "2026-07-08"})
	must(err)
}

func getOK(t *testing.T, srv *Server, target string) string {
	t.Helper()
	rec := doRequest(t, srv, http.MethodGet, target)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s status = %d, want %d", target, rec.Code, http.StatusOK)
	}
	return rec.Body.String()
}

// Empty modules are hidden and their constellation stars render dim; the
// public page never leaks admin links, retired theme assets or CLI-style
// placeholders.
func TestHomeEmptyStore(t *testing.T) {
	srv, st := newPublicTestServer(t)
	if err := st.SaveProfile(models.Profile{Name: "星野", Location: "广东"}); err != nil {
		t.Fatal(err)
	}
	body := getOK(t, srv, "/")
	for _, bad := range []string{"/admin", "themes/", "fonts.googleapis", "crt-scanlines", "// 暂无"} {
		if strings.Contains(body, bad) {
			t.Errorf("empty home contains %q", bad)
		}
	}
	if !strings.Contains(body, `class="constellation"`) {
		t.Error(`empty home lacks class="constellation"`)
	}
	start := strings.Index(body, `class="constellation"`)
	end := strings.Index(body[start:], "</nav>")
	if got := strings.Count(body[start:start+end], "data-off"); got != 6 {
		t.Errorf("constellation dim stars = %d, want 6", got)
	}
	for _, id := range []string{"experience", "footprint", "notes", "projects", "thoughts", "moments"} {
		if strings.Contains(body, `id="`+id+`"`) {
			t.Errorf("empty home still renders section #%s", id)
		}
	}
}

func TestHomeFullStore(t *testing.T) {
	srv, st := newPublicTestServer(t)
	seedFullHome(t, st)
	body := getOK(t, srv, "/")
	for _, id := range []string{"about", "experience", "footprint", "notes", "projects", "thoughts", "moments"} {
		if !strings.Contains(body, `id="`+id+`"`) {
			t.Errorf("full home lacks section #%s", id)
		}
	}
	start := strings.Index(body, `class="constellation"`)
	end := strings.Index(body[start:], "</nav>")
	if got := strings.Count(body[start:start+end], "data-off"); got != 0 {
		t.Errorf("full home constellation dim stars = %d, want 0", got)
	}
	for _, want := range []string{`data-home="广东"`, `id="globe-drill-hint"`, "双击进入下一级"} {
		if !strings.Contains(body, want) {
			t.Errorf("full home lacks %q", want)
		}
	}
	if strings.Contains(body, "/admin") {
		t.Error("full home contains /admin")
	}
}

func TestPostPageReadingHooks(t *testing.T) {
	srv, st := newPublicTestServer(t)
	seedFullHome(t, st)
	body := getOK(t, srv, "/posts/harbor-morning")
	for _, want := range []string{"data-reading=", "view-transition-name:post-", "reading.css"} {
		if !strings.Contains(body, want) {
			t.Errorf("post page lacks %q", want)
		}
	}
	if strings.Contains(body, "/admin") {
		t.Error("post page contains /admin")
	}
}
