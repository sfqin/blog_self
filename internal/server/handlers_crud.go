package server

import (
	"net/http"
	"strconv"
	"strings"

	"dev-home-blog/internal/models"
)

// crudMeta describes per-collection display metadata for templates.
var crudMeta = map[string]struct {
	Title    string
	ListTmpl string
	FormTmpl string
}{
	"experiences": {"Experiences", "experiences_list.html", "experiences_form.html"},
	"thoughts":    {"Thoughts", "thoughts_list.html", "thoughts_form.html"},
	"projects":    {"Projects", "projects_list.html", "projects_form.html"},
	"posts":       {"Posts", "posts_list.html", "posts_form.html"},
	"footprints":  {"Footprints", "footprints_list.html", "footprints_form.html"},
	"moments":     {"Moments", "moments_list.html", "moments_form.html"},
}

// crudList returns a handler that lists all items of a collection.
func (s *Server) crudList(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := s.listItems(name)
		if err != nil {
			s.serverError(w, name+" list", err)
			return
		}
		meta := crudMeta[name]
		s.writeHTML(w, meta.ListTmpl, adminPage{
			Title:  meta.Title,
			Active: name,
			CSRF:   s.ensureCSRF(w, r),
			Flash:  r.URL.Query().Get("flash"),
			Data:   items,
		})
	}
}

// crudEditForm handles both /new (empty) and /{id}/edit (loaded) forms.
func (s *Server) crudEditForm(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		meta := crudMeta[name]
		var item any
		var isNew = true
		if idStr := r.PathValue("id"); idStr != "" {
			id, err := strconv.ParseInt(idStr, 10, 64)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			item, err = s.getItem(name, id)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			isNew = false
		}
		data := map[string]any{"Item": item, "IsNew": isNew}
		// Footprints can link to a moment; the form needs the list to populate
		// its dropdown.
		if name == "footprints" {
			moments, err := s.store.Moments()
			if err != nil {
				s.serverError(w, "footprints form moments", err)
				return
			}
			data["Moments"] = moments
		}
		s.writeHTML(w, meta.FormTmpl, adminPage{
			Title:  meta.Title,
			Active: name,
			CSRF:   s.ensureCSRF(w, r),
			Data:   data,
		})
	}
}

// crudCreate parses the form, creates the item, and redirects to the list.
func (s *Server) crudCreate(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := s.createFromForm(name, r); err != nil {
			s.serverError(w, name+" create", err)
			return
		}
		http.Redirect(w, r, "/admin/"+name+"?flash=created", http.StatusSeeOther)
	}
}

// crudUpdate parses the form, updates the item, and redirects to the list.
func (s *Server) crudUpdate(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if err := s.updateFromForm(name, id, r); err != nil {
			s.serverError(w, name+" update", err)
			return
		}
		http.Redirect(w, r, "/admin/"+name+"?flash=updated", http.StatusSeeOther)
	}
}

// crudDelete removes an item and redirects to the list.
func (s *Server) crudDelete(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if err := s.deleteItem(name, id); err != nil {
			s.serverError(w, name+" delete", err)
			return
		}
		http.Redirect(w, r, "/admin/"+name+"?flash=deleted", http.StatusSeeOther)
	}
}

// --- collection dispatch helpers ---

func (s *Server) listItems(name string) (any, error) {
	switch name {
	case "experiences":
		return s.store.Experiences()
	case "thoughts":
		return s.store.Thoughts()
	case "projects":
		return s.store.Projects()
	case "posts":
		return s.store.AllPosts()
	case "footprints":
		return s.store.Footprints()
	case "moments":
		return s.store.Moments()
	}
	return nil, nil
}

func (s *Server) getItem(name string, id int64) (any, error) {
	switch name {
	case "experiences":
		return s.store.Experience(id)
	case "thoughts":
		return s.store.Thought(id)
	case "projects":
		return s.store.Project(id)
	case "posts":
		return s.store.Post(id)
	case "footprints":
		return s.store.Footprint(id)
	case "moments":
		return s.store.Moment(id)
	}
	return nil, nil
}

func (s *Server) deleteItem(name string, id int64) error {
	switch name {
	case "experiences":
		return s.store.DeleteExperience(id)
	case "thoughts":
		return s.store.DeleteThought(id)
	case "projects":
		return s.store.DeleteProject(id)
	case "posts":
		return s.store.DeletePost(id)
	case "footprints":
		return s.store.DeleteFootprint(id)
	case "moments":
		return s.store.DeleteMoment(id)
	}
	return nil
}

func (s *Server) createFromForm(name string, r *http.Request) error {
	switch name {
	case "experiences":
		_, err := s.store.CreateExperience(experienceFromForm(r))
		return err
	case "thoughts":
		_, err := s.store.CreateThought(thoughtFromForm(r))
		return err
	case "projects":
		_, err := s.store.CreateProject(projectFromForm(r))
		return err
	case "posts":
		_, err := s.store.CreatePost(postFromForm(r))
		return err
	case "footprints":
		_, err := s.store.CreateFootprint(footprintFromForm(r))
		return err
	case "moments":
		_, err := s.store.CreateMoment(momentFromForm(r))
		return err
	}
	return nil
}

func (s *Server) updateFromForm(name string, id int64, r *http.Request) error {
	switch name {
	case "experiences":
		e := experienceFromForm(r)
		e.ID = id
		return s.store.UpdateExperience(e)
	case "thoughts":
		t := thoughtFromForm(r)
		t.ID = id
		return s.store.UpdateThought(t)
	case "projects":
		p := projectFromForm(r)
		p.ID = id
		return s.store.UpdateProject(p)
	case "posts":
		p := postFromForm(r)
		p.ID = id
		return s.store.UpdatePost(p)
	case "footprints":
		f := footprintFromForm(r)
		f.ID = id
		return s.store.UpdateFootprint(f)
	case "moments":
		m := momentFromForm(r)
		m.ID = id
		return s.store.UpdateMoment(m)
	}
	return nil
}

// --- form parsers ---

func experienceFromForm(r *http.Request) models.Experience {
	return models.Experience{
		Period:      r.PostForm.Get("period"),
		Company:     r.PostForm.Get("company"),
		Role:        r.PostForm.Get("role"),
		Description: r.PostForm.Get("description"),
		SortOrder:   atoi(r.PostForm.Get("sort_order")),
	}
}

func thoughtFromForm(r *http.Request) models.Thought {
	return models.Thought{
		Body:  r.PostForm.Get("body"),
		Topic: r.PostForm.Get("topic"),
		Date:  r.PostForm.Get("date"),
	}
}

func projectFromForm(r *http.Request) models.Project {
	return models.Project{
		Name:        r.PostForm.Get("name"),
		Description: r.PostForm.Get("description"),
		Language:    r.PostForm.Get("language"),
		Stars:       atoi(r.PostForm.Get("stars")),
		License:     r.PostForm.Get("license"),
		URL:         r.PostForm.Get("url"),
		SortOrder:   atoi(r.PostForm.Get("sort_order")),
	}
}

func postFromForm(r *http.Request) models.Post {
	title := strings.TrimSpace(r.PostForm.Get("title"))
	slug := strings.TrimSpace(r.PostForm.Get("slug"))
	if slug == "" {
		slug = slugify(title)
	}
	return models.Post{
		Slug:      slug,
		Title:     title,
		Date:      r.PostForm.Get("date"),
		Tags:      r.PostForm.Get("tags"),
		BodyMD:    r.PostForm.Get("body_md"),
		Published: r.PostForm.Get("published") == "on" || r.PostForm.Get("published") == "1",
	}
}

func footprintFromForm(r *http.Request) models.Footprint {
	// moment_ids arrives as repeated checkbox values; join into the stored CSV.
	ids := make([]string, 0, len(r.PostForm["moment_ids"]))
	for _, v := range r.PostForm["moment_ids"] {
		if v = strings.TrimSpace(v); v != "" && v != "0" {
			ids = append(ids, v)
		}
	}
	return models.Footprint{
		CountryCode: strings.ToUpper(strings.TrimSpace(r.PostForm.Get("country_code"))),
		CountryName: r.PostForm.Get("country_name"),
		Province:    r.PostForm.Get("province"),
		City:        r.PostForm.Get("city"),
		Note:        r.PostForm.Get("note"),
		MomentIDs:   strings.Join(ids, ","),
		SortOrder:   atoi(r.PostForm.Get("sort_order")),
	}
}

func momentFromForm(r *http.Request) models.Moment {
	// Normalize newlines so MediaList() splits reliably (browsers send CRLF).
	media := strings.ReplaceAll(r.PostForm.Get("media"), "\r\n", "\n")
	return models.Moment{
		Caption: r.PostForm.Get("caption"),
		Media:   strings.TrimSpace(media),
		Place:   strings.TrimSpace(r.PostForm.Get("place")),
		Date:    r.PostForm.Get("date"),
	}
}

func atoi(s string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(s))
	return n
}

// slugify produces a URL-safe slug from a title (ASCII-focused; keeps CJK as-is).
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	prevDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		case r > 127: // keep non-ASCII (e.g. CJK) intact
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "post"
	}
	return out
}
