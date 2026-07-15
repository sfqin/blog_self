package store

import (
	"database/sql"
	"time"
)

// AdminPasswordHash returns the stored bcrypt hash for the admin account
// (empty string if no password has been set yet).
func (s *Store) AdminPasswordHash() (string, error) {
	var hash string
	err := s.db.QueryRow(`SELECT password_hash FROM admin_user WHERE id = 1`).Scan(&hash)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return hash, err
}

// SetAdminPassword stores the admin username + bcrypt password hash (id=1 upsert).
func (s *Store) SetAdminPassword(username, hash string) error {
	_, err := s.db.Exec(`
		INSERT INTO admin_user (id, username, password_hash) VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash`,
		username, hash)
	return err
}

// CreateSession stores a session token with an expiry.
func (s *Store) CreateSession(token string, expires time.Time) error {
	_, err := s.db.Exec(`INSERT INTO sessions (token, expires_at) VALUES (?, ?)`,
		token, expires.UTC().Format(time.RFC3339))
	return err
}

// SessionValid reports whether the token exists and has not expired.
func (s *Store) SessionValid(token string) (bool, error) {
	if token == "" {
		return false, nil
	}
	var expiresStr string
	err := s.db.QueryRow(`SELECT expires_at FROM sessions WHERE token = ?`, token).Scan(&expiresStr)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	expires, err := time.Parse(time.RFC3339, expiresStr)
	if err != nil {
		return false, nil
	}
	if time.Now().After(expires) {
		_ = s.DeleteSession(token)
		return false, nil
	}
	return true, nil
}

// DeleteSession removes a session token (logout).
func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}

// PurgeExpiredSessions removes all sessions past their expiry.
func (s *Store) PurgeExpiredSessions() error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, time.Now().UTC().Format(time.RFC3339))
	return err
}
