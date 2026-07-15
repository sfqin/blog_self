package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

// gzipPool reuses gzip writers to avoid per-request allocation.
var gzipPool = sync.Pool{New: func() any { return gzip.NewWriter(io.Discard) }}

// compressible reports whether a path is worth gzipping. The geo JSON files are
// 40–60 KB of text that compress to roughly a fifth, which is the main win for
// slow mobile connections when drilling into a region for the first time.
func compressible(path string) bool {
	switch {
	case strings.HasSuffix(path, ".json"),
		strings.HasSuffix(path, ".js"),
		strings.HasSuffix(path, ".css"),
		strings.HasSuffix(path, ".svg"),
		strings.HasSuffix(path, ".html"):
		return true
	}
	return false
}

type gzipWriter struct {
	http.ResponseWriter
	gz     *gzip.Writer
	status int
}

func (w *gzipWriter) WriteHeader(code int) {
	w.status = code
	w.Header().Del("Content-Length") // length changes after compression
	w.Header().Set("Content-Encoding", "gzip")
	w.ResponseWriter.WriteHeader(code)
}

func (w *gzipWriter) Write(b []byte) (int, error) {
	if w.Header().Get("Content-Encoding") != "gzip" {
		w.WriteHeader(http.StatusOK)
	}
	return w.gz.Write(b)
}

// gzipStatic transparently gzip-compresses responses for compressible asset
// paths when the client advertises support. Non-matching requests pass through
// untouched, so HTML pages and admin routes are unaffected.
func (s *Server) gzipStatic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") || !compressible(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Vary", "Accept-Encoding")
		gz := gzipPool.Get().(*gzip.Writer)
		gz.Reset(w)
		defer func() {
			_ = gz.Close()
			gzipPool.Put(gz)
		}()
		next.ServeHTTP(&gzipWriter{ResponseWriter: w, gz: gz}, r)
	})
}
