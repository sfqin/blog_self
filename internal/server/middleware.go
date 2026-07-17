package server

import (
	"log"
	"net/http"
	"time"

	"dev-home-blog/internal/auth"
)

const (
	csrfCookie = "dh_csrf"
	// cookieTTL is how long the CSRF cookie lives. There is no login session —
	// the admin runs locally on the user's own machine — so this only bounds the
	// CSRF token's freshness.
	cookieTTL = 7 * 24 * time.Hour
)

// logRequests logs method, path, status, and duration.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The liveness heartbeat fires every few seconds from every open page;
		// logging it would bury the useful lines, so skip it.
		if r.URL.Path == heartbeatPath {
			next.ServeHTTP(w, r)
			return
		}
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

// guard wraps a handler and enforces CSRF on unsafe (non-GET/HEAD) methods.
// The admin panel is intentionally unauthenticated — it runs locally on the
// user's own machine, so there is no password or login session. guard's only
// job is to reject cross-site POSTs via the double-submit CSRF token.
func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if !s.csrfValid(r) {
				http.Error(w, "invalid CSRF token", http.StatusForbidden)
				return
			}
		}
		next(w, r)
	}
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
		HttpOnly: false, // readable so it can be echoed into forms
		SameSite: http.SameSiteLaxMode,
		Secure:   s.cfg.Secure,
		MaxAge:   int(cookieTTL.Seconds()),
	})
	return tok
}
