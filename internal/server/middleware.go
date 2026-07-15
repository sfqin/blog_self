package server

import (
	"log"
	"net/http"
	"time"

	"dev-home-blog/internal/auth"
)

const (
	sessionCookie = "dh_session"
	csrfCookie    = "dh_csrf"
	sessionTTL    = 7 * 24 * time.Hour
)

// logRequests logs method, path, status, and duration.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// requireAuth wraps a handler, redirecting to the login page (or 403 for
// state-changing requests) when the session is missing/invalid, and enforces
// CSRF on unsafe methods.
func (s *Server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.isAuthed(r) {
			if r.Method == http.MethodGet {
				http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
			} else {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
			}
			return
		}
		// CSRF check for unsafe methods: double-submit cookie pattern.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if !s.csrfValid(r) {
				http.Error(w, "invalid CSRF token", http.StatusForbidden)
				return
			}
		}
		next(w, r)
	}
}

// isAuthed reports whether the request carries a valid session cookie.
func (s *Server) isAuthed(r *http.Request) bool {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return false
	}
	ok, err := s.store.SessionValid(c.Value)
	return err == nil && ok
}

// csrfValid checks the double-submit CSRF token (cookie value == form field).
func (s *Server) csrfValid(r *http.Request) bool {
	c, err := r.Cookie(csrfCookie)
	if err != nil || c.Value == "" {
		return false
	}
	if err := r.ParseForm(); err != nil {
		return false
	}
	return auth.ConstantTimeEqual(c.Value, r.PostForm.Get("csrf_token"))
}

// ensureCSRF returns the current CSRF token, setting a fresh cookie if absent.
func (s *Server) ensureCSRF(w http.ResponseWriter, r *http.Request) string {
	if c, err := r.Cookie(csrfCookie); err == nil && c.Value != "" {
		return c.Value
	}
	tok, _ := auth.RandomToken(24)
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookie,
		Value:    tok,
		Path:     "/",
		HttpOnly: false, // readable so it can be echoed into forms; not the session secret
		SameSite: http.SameSiteLaxMode,
		Secure:   s.cfg.Secure,
		MaxAge:   int(sessionTTL.Seconds()),
	})
	return tok
}

// startSession creates a session and sets the session cookie.
func (s *Server) startSession(w http.ResponseWriter) error {
	tok, err := auth.RandomToken(32)
	if err != nil {
		return err
	}
	if err := s.store.CreateSession(tok, time.Now().Add(sessionTTL)); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.cfg.Secure,
		MaxAge:   int(sessionTTL.Seconds()),
	})
	return nil
}

// clearSession deletes the session server-side and expires the cookie.
func (s *Server) clearSession(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		_ = s.store.DeleteSession(c.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   s.cfg.Secure,
		MaxAge:   -1,
	})
}
