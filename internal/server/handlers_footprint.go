package server

import (
	"encoding/json"
	"net/http"

	"dev-home-blog/internal/models"
)

// handleFootprintsAPI returns visited places grouped country -> province -> cities.
func (s *Server) handleFootprintsAPI(w http.ResponseWriter, r *http.Request) {
	fps, err := s.store.Footprints()
	if err != nil {
		s.serverError(w, "footprints", err)
		return
	}
	out := models.GroupFootprints(fps)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(out)
}

// handleSearchAPI returns the client-side search index built from all public
// content (published posts only). Mirrors the static /api/search file emitted
// by the exporter so the search box behaves identically live and deployed.
func (s *Server) handleSearchAPI(w http.ResponseWriter, r *http.Request) {
	profile, err := s.store.Profile()
	if err != nil {
		s.serverError(w, "search profile", err)
		return
	}
	exps, err := s.store.Experiences()
	if err != nil {
		s.serverError(w, "search experiences", err)
		return
	}
	thoughts, err := s.store.Thoughts()
	if err != nil {
		s.serverError(w, "search thoughts", err)
		return
	}
	projects, err := s.store.Projects()
	if err != nil {
		s.serverError(w, "search projects", err)
		return
	}
	posts, err := s.store.PublishedPosts()
	if err != nil {
		s.serverError(w, "search posts", err)
		return
	}
	moments, err := s.store.Moments()
	if err != nil {
		s.serverError(w, "search moments", err)
		return
	}
	out := models.BuildSearchIndex(models.SearchInput{
		Profile:     profile,
		Experiences: exps,
		Thoughts:    thoughts,
		Projects:    projects,
		Posts:       posts,
		Moments:     moments,
	}, "")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(out)
}
