package main

import (
	"embed"
	"io/fs"
	"log"
	"os"

	"dev-home-blog/internal/export"
	"dev-home-blog/internal/render"
	"dev-home-blog/internal/server"
	"dev-home-blog/internal/store"
)

//go:embed all:web
var webFS embed.FS

func main() {
	// Subcommand dispatch: `serve` (default) runs the admin+site server;
	// `export <dir>` renders the current DB content into a static site.
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	switch cmd {
	case "export":
		runExport()
	case "serve":
		runServe()
	default:
		log.Fatalf("unknown command %q (use: serve | export <dir>)", cmd)
	}
}

// deps opens the store and builds the renderer + static FS shared by both
// subcommands. Callers own closing the store.
func deps(dbPath string) (*store.Store, *render.Renderer, fs.FS) {
	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	tmplFS, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("template fs: %v", err)
	}
	rnd, err := render.New(tmplFS)
	if err != nil {
		log.Fatalf("render: %v", err)
	}
	staticFS, err := fs.Sub(webFS, "web/static")
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}
	return st, rnd, staticFS
}

func runServe() {
	cfg := server.Config{
		Addr:          envOr("ADDR", ":8080"),
		DBPath:        envOr("DB_PATH", "blog.db"),
		AdminUsername: envOr("ADMIN_USERNAME", "admin"),
		AdminPassword: os.Getenv("ADMIN_PASSWORD"), // sets/updates initial password when non-empty
		Secure:        os.Getenv("SECURE_COOKIES") == "1",
	}

	st, rnd, staticFS := deps(cfg.DBPath)
	defer st.Close()

	srv, err := server.New(cfg, st, rnd, staticFS)
	if err != nil {
		log.Fatalf("server: %v", err)
	}

	log.Printf("dev@home blog listening on %s (db=%s)", cfg.Addr, cfg.DBPath)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func runExport() {
	outDir := "dist"
	if len(os.Args) > 2 {
		outDir = os.Args[2]
	}
	dbPath := envOr("DB_PATH", "blog.db")
	// BASE_URL is a URL path prefix for sub-path hosts (e.g. Gitee Pages
	// "/repo"); empty for domain-root hosts (Cloudflare / EdgeOne).
	base := os.Getenv("BASE_URL")

	st, rnd, staticFS := deps(dbPath)
	defer st.Close()

	if err := export.Run(st, rnd, staticFS, outDir, base); err != nil {
		log.Fatalf("export: %v", err)
	}
	log.Printf("exported static site from db=%s to %s/ (base=%q)", dbPath, outDir, base)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
