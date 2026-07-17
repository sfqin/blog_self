package store

import (
	"path/filepath"
	"testing"

	"dev-home-blog/internal/models"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestProfileRoundTrip(t *testing.T) {
	s := newTestStore(t)
	// Default row should exist and be empty.
	p, err := s.Profile()
	if err != nil {
		t.Fatalf("profile: %v", err)
	}
	if p.Name != "" {
		t.Fatalf("expected empty name, got %q", p.Name)
	}
	p.Name = "dev@home"
	p.Stack = "Go, SQLite, Linux"
	if err := s.SaveProfile(p); err != nil {
		t.Fatalf("save profile: %v", err)
	}
	got, err := s.Profile()
	if err != nil {
		t.Fatalf("profile: %v", err)
	}
	if got.Name != "dev@home" {
		t.Fatalf("name = %q", got.Name)
	}
	if tags := got.StackTags(); len(tags) != 3 || tags[0] != "Go" {
		t.Fatalf("stack tags = %v", tags)
	}
}

func TestPostCRUDAndPublishing(t *testing.T) {
	s := newTestStore(t)
	id, err := s.CreatePost(models.Post{Slug: "hello", Title: "Hello", Date: "2026-07-13", Tags: "go, sqlite", BodyMD: "# Hi", Published: false})
	if err != nil {
		t.Fatalf("create post: %v", err)
	}
	// Draft: not in published list, not found by slug.
	pub, err := s.PublishedPosts()
	if err != nil {
		t.Fatalf("published: %v", err)
	}
	if len(pub) != 0 {
		t.Fatalf("expected 0 published, got %d", len(pub))
	}
	if _, err := s.PostBySlug("hello"); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound for draft, got %v", err)
	}
	// Publish it.
	post, err := s.Post(id)
	if err != nil {
		t.Fatalf("get post: %v", err)
	}
	post.Published = true
	if err := s.UpdatePost(post); err != nil {
		t.Fatalf("update post: %v", err)
	}
	got, err := s.PostBySlug("hello")
	if err != nil {
		t.Fatalf("by slug: %v", err)
	}
	if !got.Published || got.Title != "Hello" {
		t.Fatalf("unexpected post: %+v", got)
	}
	if tags := got.TagList(); len(tags) != 2 {
		t.Fatalf("tags = %v", tags)
	}
	if err := s.DeletePost(id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	all, _ := s.AllPosts()
	if len(all) != 0 {
		t.Fatalf("expected 0 posts after delete, got %d", len(all))
	}
}

