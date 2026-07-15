package store

import "dev-home-blog/internal/models"

// Moments returns all moments, newest first.
func (s *Store) Moments() ([]models.Moment, error) {
	rows, err := s.db.Query(`
		SELECT id, caption, media, place, date FROM moments ORDER BY date DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Moment
	for rows.Next() {
		var m models.Moment
		if err := rows.Scan(&m.ID, &m.Caption, &m.Media, &m.Place, &m.Date); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Moment returns a single moment by id.
func (s *Store) Moment(id int64) (models.Moment, error) {
	var m models.Moment
	err := s.db.QueryRow(`SELECT id, caption, media, place, date FROM moments WHERE id = ?`, id).
		Scan(&m.ID, &m.Caption, &m.Media, &m.Place, &m.Date)
	return m, err
}

// CreateMoment inserts a new moment and returns its id.
func (s *Store) CreateMoment(m models.Moment) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO moments (caption, media, place, date) VALUES (?, ?, ?, ?)`,
		m.Caption, m.Media, m.Place, m.Date)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateMoment updates an existing moment.
func (s *Store) UpdateMoment(m models.Moment) error {
	_, err := s.db.Exec(`UPDATE moments SET caption = ?, media = ?, place = ?, date = ? WHERE id = ?`,
		m.Caption, m.Media, m.Place, m.Date, m.ID)
	return err
}

// DeleteMoment removes a moment.
func (s *Store) DeleteMoment(id int64) error {
	_, err := s.db.Exec(`DELETE FROM moments WHERE id = ?`, id)
	return err
}
