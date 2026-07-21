package server

import (
	"net/http"

	"dev-home-blog/internal/models"
	"dev-home-blog/internal/setup"
)

// adminPage is the shared layout data for admin templates.
type adminPage struct {
	Title   string
	Active  string
	CSRF    string
	Flash   string
	Data    any
}

// handleDashboard shows counts and quick links.
func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	exps, _ := s.store.Experiences()
	thoughts, _ := s.store.Thoughts()
	projects, _ := s.store.Projects()
	posts, _ := s.store.AllPosts()
	footprints, _ := s.store.Footprints()
	moments, _ := s.store.Moments()
	profile, _ := s.store.Profile()

	counts := map[string]int{
		"experiences": len(exps),
		"thoughts":    len(thoughts),
		"projects":    len(projects),
		"posts":       len(posts),
		"footprints":  len(footprints),
		"moments":     len(moments),
	}
	s.writeHTML(w, "dashboard.html", adminPage{
		Title:  "Dashboard",
		Active: "dashboard",
		CSRF:   s.ensureCSRF(w, r),
		Data:   map[string]any{"Counts": counts, "Profile": profile},
	})
}

// handlePublishPage shows the "发布上线" page: whether a GitHub repo is linked,
// where the site will publish, and a button that renders + pushes to GitHub
// Pages (the same action the first-run wizard uses). This gives a logged-in
// user a permanent place to re-publish after editing content.
func (s *Server) handlePublishPage(w http.ResponseWriter, r *http.Request) {
	st := s.detector.Detect(r.Context())
	owner, repo, linked := setup.ParseOwnerRepo(st.RemoteURL)
	data := map[string]any{
		"Linked":     linked && st.GitHubUser != "",
		"GitHubUser": st.GitHubUser,
		"RemoteURL":  st.RemoteURL,
	}
	if linked {
		data["Owner"] = owner
		data["Repo"] = repo
		data["LiveURL"] = "https://" + owner + ".github.io/" + repo + "/"
	}
	s.writeHTML(w, "publish.html", adminPage{
		Title:  "Publish",
		Active: "publish",
		CSRF:   s.ensureCSRF(w, r),
		Data:   data,
	})
}

// handleProfileForm shows the profile editor.
func (s *Server) handleProfileForm(w http.ResponseWriter, r *http.Request) {	profile, err := s.store.Profile()
	if err != nil {
		s.serverError(w, "profile", err)
		return
	}
	s.writeHTML(w, "profile_form.html", adminPage{
		Title:  "Profile",
		Active: "profile",
		CSRF:   s.ensureCSRF(w, r),
		Flash:  r.URL.Query().Get("flash"),
		Data:   profile,
	})
}

// handleProfileSave persists the profile edits.
func (s *Server) handleProfileSave(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	p := models.Profile{
		Name:      r.PostForm.Get("name"),
		Title:     r.PostForm.Get("title"),
		Tagline:   r.PostForm.Get("tagline"),
		AboutMD:   r.PostForm.Get("about_md"),
		Stack:     r.PostForm.Get("stack"),
		GitHubURL: r.PostForm.Get("github_url"),
		Email:     r.PostForm.Get("email"),
		Location:  r.PostForm.Get("location"),
	}
	if err := s.store.SaveProfile(p); err != nil {
		s.serverError(w, "save profile", err)
		return
	}
	http.Redirect(w, r, "/admin/profile?flash=saved", http.StatusSeeOther)
}

// handleThemeForm shows the site-theme picker (its own admin tab).
func (s *Server) handleThemeForm(w http.ResponseWriter, r *http.Request) {
	profile, err := s.store.Profile()
	if err != nil {
		s.serverError(w, "theme", err)
		return
	}
	theme := profile.Theme
	if theme == "" {
		theme = "F"
	}
	s.writeHTML(w, "theme_form.html", adminPage{
		Title:  "Theme",
		Active: "theme",
		CSRF:   s.ensureCSRF(w, r),
		Flash:  r.URL.Query().Get("flash"),
		Data:   map[string]any{"Theme": theme},
	})
}

// handleThemeSave persists the selected site-wide theme.
func (s *Server) handleThemeSave(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := s.store.SaveTheme(r.PostForm.Get("theme")); err != nil {
		s.serverError(w, "save theme", err)
		return
	}
	http.Redirect(w, r, "/admin/theme?flash=saved", http.StatusSeeOther)
}
