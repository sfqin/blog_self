package server

import (
	"net/http"
)

// routes registers all HTTP handlers. Go 1.22+ pattern routing is used.
func (s *Server) routes() {
	// Static assets (CSS/JS/geo data).
	s.mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(s.static))))

	// Public site.
	s.mux.HandleFunc("GET /{$}", s.handleHome)
	s.mux.HandleFunc("GET /posts/{slug}", s.handlePost)
	s.mux.HandleFunc("GET /api/footprints", s.handleFootprintsAPI)
	s.mux.HandleFunc("GET /api/search", s.handleSearchAPI)

	// Admin auth.
	s.mux.HandleFunc("GET /admin/login", s.handleLoginForm)
	s.mux.HandleFunc("POST /admin/login", s.handleLoginSubmit)
	s.mux.HandleFunc("POST /admin/logout", s.requireAuth(s.handleLogout))

	// Admin dashboard.
	s.mux.HandleFunc("GET /admin", s.requireAuth(s.handleDashboard))
	s.mux.HandleFunc("GET /admin/{$}", s.requireAuth(s.handleDashboard))

	// Profile (single row).
	s.mux.HandleFunc("GET /admin/profile", s.requireAuth(s.handleProfileForm))
	s.mux.HandleFunc("POST /admin/profile", s.requireAuth(s.handleProfileSave))

	// Generic CRUD sections. Each collection has list/new/create/edit/update/delete.
	s.registerCRUD("experiences")
	s.registerCRUD("thoughts")
	s.registerCRUD("projects")
	s.registerCRUD("posts")
	s.registerCRUD("footprints")
	s.registerCRUD("moments")
}

// registerCRUD wires the standard admin CRUD routes for a collection name.
func (s *Server) registerCRUD(name string) {
	base := "/admin/" + name
	s.mux.HandleFunc("GET "+base, s.requireAuth(s.crudList(name)))
	s.mux.HandleFunc("GET "+base+"/new", s.requireAuth(s.crudEditForm(name)))
	s.mux.HandleFunc("POST "+base, s.requireAuth(s.crudCreate(name)))
	s.mux.HandleFunc("GET "+base+"/{id}/edit", s.requireAuth(s.crudEditForm(name)))
	s.mux.HandleFunc("POST "+base+"/{id}", s.requireAuth(s.crudUpdate(name)))
	s.mux.HandleFunc("POST "+base+"/{id}/delete", s.requireAuth(s.crudDelete(name)))
}
