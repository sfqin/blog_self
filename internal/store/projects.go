package store

import "dev-home-blog/internal/models"

// Projects returns all projects ordered for display.
func (s *Store) Projects() ([]models.Project, error) {
	rows, err := s.db.Query(`
		SELECT id, name, description, language, stars, license, url, sort_order
		FROM projects ORDER BY sort_order ASC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Project
	for rows.Next() {
		var p models.Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Language, &p.Stars, &p.License, &p.URL, &p.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Project returns a single project by id.
func (s *Store) Project(id int64) (models.Project, error) {
	var p models.Project
	err := s.db.QueryRow(`
		SELECT id, name, description, language, stars, license, url, sort_order
		FROM projects WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.Description, &p.Language, &p.Stars, &p.License, &p.URL, &p.SortOrder)
	return p, err
}

// CreateProject inserts a new project and returns its id.
func (s *Store) CreateProject(p models.Project) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO projects (name, description, language, stars, license, url, sort_order)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		p.Name, p.Description, p.Language, p.Stars, p.License, p.URL, p.SortOrder)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateProject updates an existing project.
func (s *Store) UpdateProject(p models.Project) error {
	_, err := s.db.Exec(`
		UPDATE projects SET name = ?, description = ?, language = ?, stars = ?, license = ?, url = ?, sort_order = ?
		WHERE id = ?`,
		p.Name, p.Description, p.Language, p.Stars, p.License, p.URL, p.SortOrder, p.ID)
	return err
}

// DeleteProject removes a project.
func (s *Store) DeleteProject(id int64) error {
	_, err := s.db.Exec(`DELETE FROM projects WHERE id = ?`, id)
	return err
}
