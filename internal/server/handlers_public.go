package server

import (
	"errors"
	"log"
	"net/http"

	"dev-home-blog/internal/store"
)

// writeHTML renders a template to a buffer then writes it, returning 500 on error.
func (s *Server) writeHTML(w http.ResponseWriter, name string, data any) {
	b, err := s.render.Render(name, data)
	if err != nil {
		log.Printf("render error [%s]: %v", name, err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(b)
}

// homeData is the view model for the public homepage.
type homeData struct {
	Base        string // URL path prefix; empty when served at domain root
	Profile     any
	Experiences any
	Thoughts    any
	Projects    any
	Posts       any
	Footprints  any
	Moments     any
}

// handleHome renders the single-page public site from live DB content.
func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	profile, err := s.store.Profile()
	if err != nil {
		s.serverError(w, "profile", err)
		return
	}
	exps, err := s.store.Experiences()
	if err != nil {
		s.serverError(w, "experiences", err)
		return
	}
	thoughts, err := s.store.Thoughts()
	if err != nil {
		s.serverError(w, "thoughts", err)
		return
	}
	projects, err := s.store.Projects()
	if err != nil {
		s.serverError(w, "projects", err)
		return
	}
	posts, err := s.store.PublishedPosts()
	if err != nil {
		s.serverError(w, "posts", err)
		return
	}
	footprints, err := s.store.Footprints()
	if err != nil {
		s.serverError(w, "footprints", err)
		return
	}
	moments, err := s.store.Moments()
	if err != nil {
		s.serverError(w, "moments", err)
		return
	}
	s.writeHTML(w, "home.html", homeData{
		Profile:     profile,
		Experiences: exps,
		Thoughts:    thoughts,
		Projects:    projects,
		Posts:       posts,
		Footprints:  footprints,
		Moments:     moments,
	})
}

// handlePost renders a single published post by slug.
func (s *Server) handlePost(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	post, err := s.store.PostBySlug(slug)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.serverError(w, "post", err)
		return
	}
	profile, _ := s.store.Profile()
	s.writeHTML(w, "post.html", map[string]any{"Base": "", "Post": post, "Profile": profile})
}

func (s *Server) serverError(w http.ResponseWriter, what string, err error) {
	log.Printf("db error [%s]: %v", what, err)
	http.Error(w, "internal server error", http.StatusInternalServerError)
}
