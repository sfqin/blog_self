// Package render loads HTML templates and renders Markdown for the blog.
package render

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html/template"
	"io/fs"
	"time"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	gmhtml "github.com/yuin/goldmark/renderer/html"
)

// Renderer holds the parsed template set and Markdown converter.
type Renderer struct {
	tmpl     *template.Template
	md       goldmark.Markdown
	assetVer map[string]string // "/static/js/globe.js" -> content hash
}

// New parses every *.html template under fsys (recursively) and builds the
// Markdown converter. staticFS (the embedded web/static tree, may be nil) is
// walked to precompute per-file content hashes so the `asset` helper can emit
// cache-busting `?v=` query strings — critical for phones that aggressively
// cache embedded JS/CSS (which carry no ModTime/ETag).
func New(fsys fs.FS, staticFS fs.FS) (*Renderer, error) {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithRendererOptions(gmhtml.WithHardWraps()),
	)
	r := &Renderer{md: md, assetVer: buildAssetVersions(staticFS)}

	tmpl := template.New("").Funcs(funcMap(r))
	// Parse all templates in the tree so {{template "..."}} partials resolve.
	tmpl, err := tmpl.ParseFS(fsys, "templates/*/*.html")
	if err != nil {
		return nil, fmt.Errorf("parse templates: %w", err)
	}
	r.tmpl = tmpl
	return r, nil
}

// Render executes the named top-level template with data into a buffer, then
// writes it out — so a mid-render error never emits a half-written page.
func (r *Renderer) Render(name string, data any) ([]byte, error) {
	var buf bytes.Buffer
	if err := r.tmpl.ExecuteTemplate(&buf, name, data); err != nil {
		return nil, fmt.Errorf("render %s: %w", name, err)
	}
	return buf.Bytes(), nil
}

// Markdown converts a Markdown string to sanitized-enough HTML for our use.
func (r *Renderer) Markdown(src string) template.HTML {
	var buf bytes.Buffer
	if err := r.md.Convert([]byte(src), &buf); err != nil {
		return template.HTML(template.HTMLEscapeString(src))
	}
	return template.HTML(buf.String())
}

// funcMap returns the template helper functions.
func funcMap(r *Renderer) template.FuncMap {
	return template.FuncMap{
		"markdown": func(s string) template.HTML { return r.Markdown(s) },
		"year":     func() int { return time.Now().Year() },
		"now":      func() string { return time.Now().Format("2006-01-02 15:04:05") },
		"asset":    r.asset,
	}
}

// asset appends a short content-hash query to a static path so browsers refetch
// it whenever the file changes. `p` is the path after any Base prefix, e.g.
// "/static/js/globe.js". Unknown paths are returned unchanged.
func (r *Renderer) asset(p string) string {
	if v := r.assetVer[p]; v != "" {
		return p + "?v=" + v
	}
	return p
}

// buildAssetVersions walks staticFS and maps "/static/<path>" to a short hash
// of the file's bytes. A nil FS yields an empty map (asset() becomes a no-op).
func buildAssetVersions(staticFS fs.FS) map[string]string {
	m := map[string]string{}
	if staticFS == nil {
		return m
	}
	_ = fs.WalkDir(staticFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		b, err := fs.ReadFile(staticFS, path)
		if err != nil {
			return nil
		}
		sum := sha256.Sum256(b)
		m["/static/"+path] = hex.EncodeToString(sum[:])[:10]
		return nil
	})
	return m
}

