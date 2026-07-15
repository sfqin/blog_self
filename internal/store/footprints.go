package store

import "dev-home-blog/internal/models"

// Footprints returns all visited-city rows ordered for display.
func (s *Store) Footprints() ([]models.Footprint, error) {
	rows, err := s.db.Query(`
		SELECT id, country_code, country_name, province, city, note, moment_ids, sort_order
		FROM footprints ORDER BY country_code ASC, sort_order ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Footprint
	for rows.Next() {
		var f models.Footprint
		if err := rows.Scan(&f.ID, &f.CountryCode, &f.CountryName, &f.Province, &f.City, &f.Note, &f.MomentIDs, &f.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// Footprint returns a single footprint by id.
func (s *Store) Footprint(id int64) (models.Footprint, error) {
	var f models.Footprint
	err := s.db.QueryRow(`
		SELECT id, country_code, country_name, province, city, note, moment_ids, sort_order
		FROM footprints WHERE id = ?`, id).
		Scan(&f.ID, &f.CountryCode, &f.CountryName, &f.Province, &f.City, &f.Note, &f.MomentIDs, &f.SortOrder)
	return f, err
}

// CreateFootprint inserts a new footprint and returns its id.
func (s *Store) CreateFootprint(f models.Footprint) (int64, error) {
	res, err := s.db.Exec(`
		INSERT INTO footprints (country_code, country_name, province, city, note, moment_ids, sort_order)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		f.CountryCode, f.CountryName, f.Province, f.City, f.Note, f.MomentIDs, f.SortOrder)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateFootprint updates an existing footprint.
func (s *Store) UpdateFootprint(f models.Footprint) error {
	_, err := s.db.Exec(`
		UPDATE footprints SET country_code = ?, country_name = ?, province = ?, city = ?, note = ?, moment_ids = ?, sort_order = ?
		WHERE id = ?`,
		f.CountryCode, f.CountryName, f.Province, f.City, f.Note, f.MomentIDs, f.SortOrder, f.ID)
	return err
}

// DeleteFootprint removes a footprint.
func (s *Store) DeleteFootprint(id int64) error {
	_, err := s.db.Exec(`DELETE FROM footprints WHERE id = ?`, id)
	return err
}
