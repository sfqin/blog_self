package server

import (
	"net/http"

	"dev-home-blog/internal/auth"
)

// handleLoginForm renders the admin login page.
func (s *Server) handleLoginForm(w http.ResponseWriter, r *http.Request) {
	if s.isAuthed(r) {
		http.Redirect(w, r, "/admin", http.StatusSeeOther)
		return
	}
	csrf := s.ensureCSRF(w, r)
	s.writeHTML(w, "login.html", map[string]any{
		"CSRF":  csrf,
		"Error": r.URL.Query().Get("error"),
	})
}

// handleLoginSubmit verifies credentials and starts a session.
func (s *Server) handleLoginSubmit(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// CSRF: double-submit check on the (currently unauthenticated) request.
	if !s.csrfValid(r) {
		http.Redirect(w, r, "/admin/login?error=csrf", http.StatusSeeOther)
		return
	}
	username := r.PostForm.Get("username")
	password := r.PostForm.Get("password")

	hash, err := s.store.AdminPasswordHash()
	if err != nil {
		s.serverError(w, "login", err)
		return
	}
	if !auth.CheckPassword(hash, password) || username != s.cfg.AdminUsername {
		http.Redirect(w, r, "/admin/login?error=1", http.StatusSeeOther)
		return
	}
	if err := s.startSession(w); err != nil {
		s.serverError(w, "session", err)
		return
	}
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}

// handleLogout ends the session.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.clearSession(w, r)
	http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
}
