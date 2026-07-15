// Package export renders the live database content into a fully static site
// under an output directory. The result is deployable to any static host
// (e.g. Cloudflare Pages) with no server or database required at runtime.
//
// The key idea: the admin backend runs only on your machine and owns the
// SQLite database. Publishing means rendering the current data to plain
// HTML + a static footprints JSON, which is then pushed to git and served
// by the CDN. The interactive globe keeps working because it fetches
// /api/footprints, which we emit as a static file at that exact path.
package export

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"dev-home-blog/internal/models"
	"dev-home-blog/internal/render"
	"dev-home-blog/internal/store"
)

// homeVM mirrors the fields the public home.html template reads. It is kept
// in sync with the live server's view model by field name.
type homeVM struct {
	Base        string
	Profile     models.Profile
	Experiences []models.Experience
	Thoughts    []models.Thought
	Projects    []models.Project
	Posts       []models.Post
	Footprints  []models.Footprint
	Moments     []models.Moment
}

// Run renders the whole site into outDir. It reads content from st, renders
// with rnd, and copies static assets from staticFS (the embedded web/static).
//
// base is a URL path prefix (e.g. "/repo") for hosts that serve the site under
// a sub-path such as Gitee Pages (user.gitee.io/repo/). Use "" for domain-root
// hosts like Cloudflare Pages and EdgeOne Pages. A trailing slash is trimmed.
func Run(st *store.Store, rnd *render.Renderer, staticFS fs.FS, outDir, base string) error {
	base = strings.TrimSuffix(base, "/")
	if err := resetDir(outDir); err != nil {
		return err
	}

	// Gather live content.
	profile, err := st.Profile()
	if err != nil {
		return fmt.Errorf("profile: %w", err)
	}
	exps, err := st.Experiences()
	if err != nil {
		return fmt.Errorf("experiences: %w", err)
	}
	thoughts, err := st.Thoughts()
	if err != nil {
		return fmt.Errorf("thoughts: %w", err)
	}
	projects, err := st.Projects()
	if err != nil {
		return fmt.Errorf("projects: %w", err)
	}
	posts, err := st.PublishedPosts()
	if err != nil {
		return fmt.Errorf("posts: %w", err)
	}
	footprints, err := st.Footprints()
	if err != nil {
		return fmt.Errorf("footprints: %w", err)
	}
	moments, err := st.Moments()
	if err != nil {
		return fmt.Errorf("moments: %w", err)
	}

	// 1. Homepage -> index.html
	home, err := rnd.Render("home.html", homeVM{
		Base:        base,
		Profile:     profile,
		Experiences: exps,
		Thoughts:    thoughts,
		Projects:    projects,
		Posts:       posts,
		Footprints:  footprints,
		Moments:     moments,
	})
	if err != nil {
		return fmt.Errorf("render home: %w", err)
	}
	if err := writeFile(filepath.Join(outDir, "index.html"), home); err != nil {
		return err
	}

	// 2. Each published post -> posts/{slug}.html
	//    Cloudflare Pages serves foo.html at /foo, matching the /posts/{slug}
	//    links in the templates.
	for _, p := range posts {
		page, err := rnd.Render("post.html", map[string]any{"Base": base, "Post": p, "Profile": profile})
		if err != nil {
			return fmt.Errorf("render post %s: %w", p.Slug, err)
		}
		if err := writeFile(filepath.Join(outDir, "posts", p.Slug+".html"), page); err != nil {
			return err
		}
	}

	// 3. Footprints as a static file at the same path the globe fetches.
	//    fetch().json() ignores content-type, so an extensionless file is fine.
	grouped := models.GroupFootprints(footprints)
	buf, err := json.Marshal(grouped)
	if err != nil {
		return fmt.Errorf("marshal footprints: %w", err)
	}
	if err := writeFile(filepath.Join(outDir, "api", "footprints"), buf); err != nil {
		return err
	}

	// 3b. Search index as a static file at /api/search (published posts only,
	//     so drafts never leak). search.js fetches this in the browser.
	index := models.BuildSearchIndex(models.SearchInput{
		Profile:     profile,
		Experiences: exps,
		Thoughts:    thoughts,
		Projects:    projects,
		Posts:       posts,
		Moments:     moments,
	}, base)
	idxBuf, err := json.Marshal(index)
	if err != nil {
		return fmt.Errorf("marshal search index: %w", err)
	}
	if err := writeFile(filepath.Join(outDir, "api", "search"), idxBuf); err != nil {
		return err
	}

	// 4. Copy the embedded static tree (css/js/geo) into dist/static.
	if err := copyFS(staticFS, filepath.Join(outDir, "static")); err != nil {
		return fmt.Errorf("copy static: %w", err)
	}

	// 5. A no-op .nojekyll marker in case the site is ever served by GitHub
	//    Pages (harmless for Cloudflare).
	if err := writeFile(filepath.Join(outDir, ".nojekyll"), []byte{}); err != nil {
		return err
	}

	return nil
}

// resetDir removes and recreates dir so stale files never linger between runs.
func resetDir(dir string) error {
	if dir == "" || dir == "/" || dir == "." {
		return fmt.Errorf("refusing to reset unsafe output dir %q", dir)
	}
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("clean %s: %w", dir, err)
	}
	return os.MkdirAll(dir, 0o755)
}

// writeFile creates parent dirs then writes data.
func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// copyFS copies every file in src (an fs.FS) into the dst directory tree.
func copyFS(src fs.FS, dst string) error {
	return fs.WalkDir(src, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(dst, p), 0o755)
		}
		in, err := src.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		target := filepath.Join(dst, p)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			return err
		}
		defer out.Close()
		_, err = io.Copy(out, in)
		return err
	})
}
