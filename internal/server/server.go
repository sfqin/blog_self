// Package server wires HTTP routing, middleware, and handlers together.
package server

import (
	"io/fs"
	"log"
	"net/http"

	"dev-home-blog/internal/auth"
	"dev-home-blog/internal/render"
	"dev-home-blog/internal/store"
)

// Config holds runtime configuration for the server.
type Config struct {
	Addr          string
	DBPath        string
	AdminUsername string
	AdminPassword string // if non-empty, (re)sets the admin password on startup
	Secure        bool   // set Secure flag on cookies (HTTPS deployments)
}

// Server holds shared dependencies for all handlers.
type Server struct {
	cfg    Config
	store  *store.Store
	render *render.Renderer
	mux    *http.ServeMux
	static fs.FS
}

// New constructs the server, seeds the admin password if provided, and registers routes.
func New(cfg Config, st *store.Store, rnd *render.Renderer, static fs.FS) (*Server, error) {
	s := &Server{cfg: cfg, store: st, render: rnd, static: static, mux: http.NewServeMux()}

	if err := s.seedAdmin(); err != nil {
		return nil, err
	}
	s.routes()
	return s, nil
}

// seedAdmin sets the admin password from config when provided, or warns when
// no password has ever been set (admin login would be impossible otherwise).
func (s *Server) seedAdmin() error {
	if s.cfg.AdminPassword != "" {
		hash, err := auth.HashPassword(s.cfg.AdminPassword)
		if err != nil {
			return err
		}
		if err := s.store.SetAdminPassword(s.cfg.AdminUsername, hash); err != nil {
			return err
		}
		log.Printf("admin password set for user %q", s.cfg.AdminUsername)
		return nil
	}
	hash, err := s.store.AdminPasswordHash()
	if err != nil {
		return err
	}
	if hash == "" {
		log.Printf("WARNING: no admin password set. Start once with ADMIN_PASSWORD=... to enable /admin login.")
	}
	return nil
}

// ListenAndServe starts the HTTP server.
func (s *Server) ListenAndServe() error {
	return http.ListenAndServe(s.cfg.Addr, s.logRequests(s.gzipStatic(s.mux)))
}
