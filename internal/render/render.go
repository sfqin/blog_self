// Package render loads HTML templates and renders Markdown for the blog.
package render

import (
	"bytes"
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
	tmpl *template.Template
	md   goldmark.Markdown
}

// New parses every *.html template under fsys (recursively) and builds the
// Markdown converter. funcs are shared helper functions available in templates.
func New(fsys fs.FS) (*Renderer, error) {
	md := goldmark.New(
		goldmark.WithExtensions(extension.GFM),
		goldmark.WithRendererOptions(gmhtml.WithHardWraps()),
	)
	r := &Renderer{md: md}

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
	}
}
