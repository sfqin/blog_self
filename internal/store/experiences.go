package store

import "dev-home-blog/internal/models"

// Experiences returns all career entries ordered for display.
func (s *Store) Experiences() ([]models.Experience, error) {
	rows, err := s.db.Query(`
		SELECT id, period, company, role, description, sort_order
		FROM experiences ORDER BY sort_order ASC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Experience
	for rows.Next() {
		var e models.Experience
		if err := rows.Scan(&e.ID, &e.Period, &e.Company, &e.Role, &e.Description, &e.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Experience returns a single career entry by id.
func (s *Store) Experience(id int64) (models.Experience, error) {
	var e models.Experience
	err := s.db.QueryRow(`
		SELECT id, period, company, role, description, sort_order
		FROM experiences WHERE id = ?`, id).
		Scan(&e.ID, &e.Period, &e.Company, &e.Role, &e.Description, &e.SortOrder)
	return e, err
}

// CreateExperience inserts a new career entry and returns its id.
func (s *Store) CreateExperience(e models.Experience) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO experiences (period, company, role, description, sort_order)
		VALUES (?, ?, ?, ?, ?)`,
		e.Period, e.Company, e.Role, e.Description, e.SortOrder)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateExperience updates an existing career entry.
func (s *Store) UpdateExperience(e models.Experience) error {
	_, err := s.db.Exec(`
		UPDATE experiences SET period = ?, company = ?, role = ?, description = ?, sort_order = ?
		WHERE id = ?`,
		e.Period, e.Company, e.Role, e.Description, e.SortOrder, e.ID)
	return err
}

// DeleteExperience removes a career entry.
func (s *Store) DeleteExperience(id int64) error {
	_, err := s.db.Exec(`DELETE FROM experiences WHERE id = ?`, id)
	return err
}
