package models

import "strings"

// SearchDoc is one entry in the client-side search index. The public site is a
// static export with no server, so search runs entirely in the browser against
// a JSON index emitted at /api/search (mirroring how the globe consumes
// /api/footprints). Keep the JSON field names stable: search.js depends on them.
type SearchDoc struct {
	Type  string `json:"type"`            // profile | experience | thought | project | post
	Title string `json:"title"`           // primary label shown in results
	Text  string `json:"text"`            // body/haystack used for fuzzy matching
	Tags  string `json:"tags,omitempty"`  // comma-separated, also searchable
	URL   string `json:"url"`             // anchor (#section) or post path, prefixed with base
	Date  string `json:"date,omitempty"`  // optional right-aligned meta
	Badge string `json:"badge,omitempty"` // short zh label for the result row
}

// SearchInput carries the published content the index is built from. Posts must
// already be filtered to published-only by the caller (same contract the
// exporter relies on) so drafts never leak into the static index.
type SearchInput struct {
	Profile     Profile
	Experiences []Experience
	Thoughts    []Thought
	Projects    []Project
	Posts       []Post
	Moments     []Moment
}

// BuildSearchIndex flattens all public content into a list of SearchDocs.
// base is the URL path prefix (e.g. "/repo" for Gitee sub-path hosting, ""
// for domain-root hosts) applied to every URL so links work under any host.
func BuildSearchIndex(in SearchInput, base string) []SearchDoc {
	base = strings.TrimSuffix(base, "/")
	docs := make([]SearchDoc, 0, 8+len(in.Experiences)+len(in.Thoughts)+len(in.Projects)+len(in.Posts)+len(in.Moments))

	if in.Profile.Name != "" || in.Profile.AboutMD != "" {
		docs = append(docs, SearchDoc{
			Type:  "profile",
			Title: firstNonEmpty(in.Profile.Name, "whoami"),
			Text:  joinNonEmpty(" ", in.Profile.Title, in.Profile.Tagline, in.Profile.AboutMD, in.Profile.Stack, in.Profile.Location),
			URL:   base + "/#about",
			Badge: "简介",
		})
	}
	for _, e := range in.Experiences {
		docs = append(docs, SearchDoc{
			Type:  "experience",
			Title: joinNonEmpty(" · ", e.Company, e.Role),
			Text:  joinNonEmpty(" ", e.Period, e.Company, e.Role, e.Description),
			URL:   base + "/#experience",
			Date:  e.Period,
			Badge: "经历",
		})
	}
	for _, t := range in.Thoughts {
		docs = append(docs, SearchDoc{
			Type:  "thought",
			Title: truncateRunes(t.Body, 24),
			Text:  joinNonEmpty(" ", t.Topic, t.Body),
			Tags:  t.Topic,
			URL:   base + "/#thoughts",
			Date:  t.Date,
			Badge: "思考",
		})
	}
	for _, p := range in.Projects {
		docs = append(docs, SearchDoc{
			Type:  "project",
			Title: p.Name,
			Text:  joinNonEmpty(" ", p.Name, p.Description, p.Language, p.License),
			Tags:  p.Language,
			URL:   projectURL(base, p),
			Badge: "项目",
		})
	}
	for _, p := range in.Posts {
		docs = append(docs, SearchDoc{
			Type:  "post",
			Title: p.Title,
			Text:  joinNonEmpty(" ", p.Title, p.Tags, p.BodyMD),
			Tags:  p.Tags,
			URL:   base + "/posts/" + p.Slug,
			Date:  p.Date,
			Badge: "文章",
		})
	}
	for _, m := range in.Moments {
		docs = append(docs, SearchDoc{
			Type:  "moment",
			Title: truncateRunes(m.Caption, 24),
			Text:  joinNonEmpty(" ", m.Place, m.Caption),
			Tags:  m.Place,
			URL:   base + "/#moments",
			Date:  m.Date,
			Badge: "瞬间",
		})
	}
	return docs
}

// projectURL links to the external repo when set, else to the projects section.
func projectURL(base string, p Project) string {
	if p.URL != "" {
		return p.URL
	}
	return base + "/#projects"
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func joinNonEmpty(sep string, vals ...string) string {
	parts := make([]string, 0, len(vals))
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, sep)
}

// truncateRunes shortens s to at most n runes, appending an ellipsis when cut.
func truncateRunes(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}
