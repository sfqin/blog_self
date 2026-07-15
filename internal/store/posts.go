package store

import (
	"database/sql"

	"dev-home-blog/internal/models"
)

// PublishedPosts returns published posts, newest first (for the public site).
func (s *Store) PublishedPosts() ([]models.Post, error) {
	return s.queryPosts(`
		SELECT id, slug, title, date, tags, body_md, published, created_at, updated_at
		FROM posts WHERE published = 1 ORDER BY date DESC, id DESC`)
}

// AllPosts returns every post including drafts (for the admin list).
func (s *Store) AllPosts() ([]models.Post, error) {
	return s.queryPosts(`
		SELECT id, slug, title, date, tags, body_md, published, created_at, updated_at
		FROM posts ORDER BY date DESC, id DESC`)
}

func (s *Store) queryPosts(query string, args ...any) ([]models.Post, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Post
	for rows.Next() {
		p, err := scanPost(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func scanPost(sc scanner) (models.Post, error) {
	var p models.Post
	err := sc.Scan(&p.ID, &p.Slug, &p.Title, &p.Date, &p.Tags, &p.BodyMD, &p.Published, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

// Post returns a single post by id.
func (s *Store) Post(id int64) (models.Post, error) {
	row := s.db.QueryRow(`
		SELECT id, slug, title, date, tags, body_md, published, created_at, updated_at
		FROM posts WHERE id = ?`, id)
	return scanPost(row)
}

// PostBySlug returns a single published post by slug.
func (s *Store) PostBySlug(slug string) (models.Post, error) {
	row := s.db.QueryRow(`
		SELECT id, slug, title, date, tags, body_md, published, created_at, updated_at
		FROM posts WHERE slug = ? AND published = 1`, slug)
	p, err := scanPost(row)
	if err == sql.ErrNoRows {
		return models.Post{}, ErrNotFound
	}
	return p, err
}

// CreatePost inserts a new post and returns its id.
func (s *Store) CreatePost(p models.Post) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO posts (slug, title, date, tags, body_md, published)
		VALUES (?, ?, ?, ?, ?, ?)`,
		p.Slug, p.Title, p.Date, p.Tags, p.BodyMD, p.Published)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdatePost updates an existing post.
func (s *Store) UpdatePost(p models.Post) error {
	_, err := s.db.Exec(`
		UPDATE posts SET slug = ?, title = ?, date = ?, tags = ?, body_md = ?, published = ?,
			updated_at = datetime('now')
		WHERE id = ?`,
		p.Slug, p.Title, p.Date, p.Tags, p.BodyMD, p.Published, p.ID)
	return err
}

// DeletePost removes a post.
func (s *Store) DeletePost(id int64) error {
	_, err := s.db.Exec(`DELETE FROM posts WHERE id = ?`, id)
	return err
}
