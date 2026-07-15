package store

import "dev-home-blog/internal/models"

// Thoughts returns all thought cards, newest first.
func (s *Store) Thoughts() ([]models.Thought, error) {
	rows, err := s.db.Query(`
		SELECT id, body, topic, date FROM thoughts ORDER BY date DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Thought
	for rows.Next() {
		var t models.Thought
		if err := rows.Scan(&t.ID, &t.Body, &t.Topic, &t.Date); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Thought returns a single thought by id.
func (s *Store) Thought(id int64) (models.Thought, error) {
	var t models.Thought
	err := s.db.QueryRow(`SELECT id, body, topic, date FROM thoughts WHERE id = ?`, id).
		Scan(&t.ID, &t.Body, &t.Topic, &t.Date)
	return t, err
}

// CreateThought inserts a new thought and returns its id.
func (s *Store) CreateThought(t models.Thought) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO thoughts (body, topic, date) VALUES (?, ?, ?)`,
		t.Body, t.Topic, t.Date)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateThought updates an existing thought.
func (s *Store) UpdateThought(t models.Thought) error {
	_, err := s.db.Exec(`UPDATE thoughts SET body = ?, topic = ?, date = ? WHERE id = ?`,
		t.Body, t.Topic, t.Date, t.ID)
	return err
}

// DeleteThought removes a thought.
func (s *Store) DeleteThought(id int64) error {
	_, err := s.db.Exec(`DELETE FROM thoughts WHERE id = ?`, id)
	return err
}
