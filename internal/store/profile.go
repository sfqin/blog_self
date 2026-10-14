package store

import (
	"database/sql"

	"dev-home-blog/internal/models"
)

// Profile returns the single-row site profile.
func (s *Store) Profile() (models.Profile, error) {
	var p models.Profile
	err := s.db.QueryRow(`
		SELECT name, title, tagline, about_md, stack, github_url, email, location, theme, updated_at
		FROM profile WHERE id = 1`).
		Scan(&p.Name, &p.Title, &p.Tagline, &p.AboutMD, &p.Stack, &p.GitHubURL, &p.Email, &p.Location, &p.Theme, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return models.Profile{}, nil
	}
	return p, err
}

// SaveProfile updates the single-row profile. It deliberately does NOT touch
// the deprecated theme column: the public site now has a single design, and the
// column is kept (with its stored value untouched) only for old-database compat.
func (s *Store) SaveProfile(p models.Profile) error {
	_, err := s.db.Exec(`
		UPDATE profile SET
			name = ?, title = ?, tagline = ?, about_md = ?, stack = ?,
			github_url = ?, email = ?, location = ?, updated_at = datetime('now')
		WHERE id = 1`,
		p.Name, p.Title, p.Tagline, p.AboutMD, p.Stack, p.GitHubURL, p.Email, p.Location)
	return err
}
