package server

import (
	"net/http"
)

// routes registers all HTTP handlers. Go 1.22+ pattern routing is used.
func (s *Server) routes() {
	// Static assets (CSS/JS/geo data). Embedded files (//go:embed) have a zero
	// ModTime, so net/http can't send Last-Modified/ETag and browsers fall back
	// to heuristic caching — which pins an OLD globe.js/admin.css after we ship a
	// fix. For a local single-user app the assets are tiny and served from
	// memory, so we tell the browser to always revalidate (no-cache). This makes
	// edits show up on the next refresh instead of being silently cached.
	s.mux.Handle("GET /static/", noCache(http.StripPrefix("/static/", http.FileServer(http.FS(s.static)))))

	// Liveness heartbeat: every open blog page pings this (heartbeat.js). When
	// pings stop (all tabs closed), the idle watchdog shuts the server down.
	s.mux.HandleFunc("GET "+heartbeatPath, s.handleAlive)

	// Ultra-light readiness probe for the double-click launchers. Does no env
	// detection, so it stays instant even when gh/git/network are slow.
	s.mux.HandleFunc("GET "+readyPath, s.handleReady)

	// Public site.
	s.mux.HandleFunc("GET /{$}", s.handleHome)
	s.mux.HandleFunc("GET /posts/{slug}", s.handlePost)
	s.mux.HandleFunc("GET /api/footprints", s.handleFootprintsAPI)
	s.mux.HandleFunc("GET /api/search", s.handleSearchAPI)

	// First-run setup wizard (beginner-friendly onboarding). The page and
	// status probe are readable; state-changing actions enforce CSRF via guard.
	s.mux.HandleFunc("GET /setup", s.handleSetup)
	s.mux.HandleFunc("GET /setup/status", s.handleSetupStatus)
	s.mux.HandleFunc("POST /setup/install", s.guard(s.handleSetupInstall))
	s.mux.HandleFunc("POST /setup/gh-login", s.guard(s.handleSetupGHLogin))
	s.mux.HandleFunc("POST /setup/create-repo", s.guard(s.handleSetupCreateRepo))
	s.mux.HandleFunc("POST /setup/publish", s.guard(s.handleSetupPublish))

	// Admin dashboard. The admin panel is unauthenticated (local single-user
	// app); guard only enforces CSRF on the state-changing POSTs below.
	s.mux.HandleFunc("GET /admin", s.handleDashboard)
	s.mux.HandleFunc("GET /admin/{$}", s.handleDashboard)

	// Publish-online page (renders + pushes to GitHub Pages). The publish action
	// itself reuses POST /setup/publish.
	s.mux.HandleFunc("GET /admin/publish", s.handlePublishPage)

	// Profile (single row).
	s.mux.HandleFunc("GET /admin/profile", s.handleProfileForm)
	s.mux.HandleFunc("POST /admin/profile", s.guard(s.handleProfileSave))

	// Site theme (single setting, its own tab).
	s.mux.HandleFunc("GET /admin/theme", s.handleThemeForm)
	s.mux.HandleFunc("POST /admin/theme", s.guard(s.handleThemeSave))

	// Generic CRUD sections. Each collection has list/new/create/edit/update/delete.
	s.registerCRUD("experiences")
	s.registerCRUD("thoughts")
	s.registerCRUD("projects")
	s.registerCRUD("posts")
	s.registerCRUD("footprints")
	s.registerCRUD("moments")
}

// registerCRUD wires the standard admin CRUD routes for a collection name.
// GETs are open (unauthenticated local admin); state-changing POSTs enforce CSRF.
func (s *Server) registerCRUD(name string) {
	base := "/admin/" + name
	s.mux.HandleFunc("GET "+base, s.crudList(name))
	s.mux.HandleFunc("GET "+base+"/new", s.crudEditForm(name))
	s.mux.HandleFunc("POST "+base, s.guard(s.crudCreate(name)))
	s.mux.HandleFunc("GET "+base+"/{id}/edit", s.crudEditForm(name))
	s.mux.HandleFunc("POST "+base+"/{id}", s.guard(s.crudUpdate(name)))
	s.mux.HandleFunc("POST "+base+"/{id}/delete", s.guard(s.crudDelete(name)))
}

// noCache wraps a handler so browsers always revalidate the response instead of
// serving a heuristically-cached copy. Used for embedded static assets, whose
// zero ModTime otherwise defeats normal cache validation and pins stale JS/CSS.
func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		next.ServeHTTP(w, r)
	})
}
