package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

const immutableCache = "public, max-age=31536000, immutable"

func TestCacheImmutable(t *testing.T) {
	h := cacheImmutable(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/geo/world.json?v=abc", nil))
	if got := rec.Header().Get("Cache-Control"); got != immutableCache {
		t.Fatalf("Cache-Control = %q", got)
	}
}

// The real router must give versioned geo data and self-hosted fonts a one-year
// immutable cache, while every other static asset keeps revalidating. The font
// files here are placeholders in an in-memory FS (no real fonts needed).
func TestStaticRoutesCachePolicy(t *testing.T) {
	staticFS := fstest.MapFS{
		"geo/world.json":                    {Data: []byte(`{}`)},
		"fonts/fonts.css":                   {Data: []byte("/* placeholder */")},
		"fonts/noto-serif-sc/600-000.woff2": {Data: []byte("placeholder")},
		"fonts/bodoni-moda/500.woff2":       {Data: []byte("placeholder")},
		"css/admin.css":                     {Data: []byte("body{}")},
		"js/globe.js":                       {Data: []byte("void 0")},
	}
	srv, err := New(Config{RepoDir: t.TempDir()}, nil, nil, staticFS)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	tests := []struct {
		path string
		want string
	}{
		{"/static/geo/world.json?v=abc", immutableCache},
		{"/static/fonts/fonts.css?v=abc", immutableCache},
		{"/static/fonts/noto-serif-sc/600-000.woff2?v=abc", immutableCache},
		{"/static/fonts/bodoni-moda/500.woff2", immutableCache},
		{"/static/css/admin.css", "no-cache, must-revalidate"},
		{"/static/js/globe.js", "no-cache, must-revalidate"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			srv.mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, test.path, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}
			if got := rec.Header().Get("Cache-Control"); got != test.want {
				t.Fatalf("Cache-Control = %q, want %q", got, test.want)
			}
		})
	}
}
