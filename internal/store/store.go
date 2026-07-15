// Package store is the SQLite persistence layer for the blog.
package store

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// Store wraps the SQLite database connection.
type Store struct {
	db *sql.DB
}

// Open opens (creating if needed) the SQLite database at path and applies the schema.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	// modernc.org/sqlite is safe for concurrent use, but a single writer avoids
	// SQLITE_BUSY under WAL for this small workload.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	if err := ensureProfileRow(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

// migrate applies additive changes to databases created before a column
// existed. CREATE TABLE IF NOT EXISTS never alters an existing table, so new
// columns must be added here. Each step is idempotent (guarded by a column
// existence check), so booting an already-migrated DB is a no-op.
func migrate(db *sql.DB) error {
	// footprints.moment_ids: comma-separated links to moments (many-to-many).
	if err := addColumnIfMissing(db, "footprints", "moment_ids", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	// Backfill from the earlier single-link column (moment_id) if it exists,
	// then it's simply left unused. Only copies non-zero, not-yet-migrated rows.
	if hasColumn(db, "footprints", "moment_id") {
		if _, err := db.Exec(
			`UPDATE footprints SET moment_ids = CAST(moment_id AS TEXT)
			 WHERE moment_ids = '' AND moment_id != 0`); err != nil {
			return fmt.Errorf("backfill moment_ids: %w", err)
		}
	}
	return nil
}

// hasColumn reports whether table has the named column.
func hasColumn(db *sql.DB, table, column string) bool {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil && name == column {
			return true
		}
	}
	return false
}

// addColumnIfMissing runs ALTER TABLE ADD COLUMN only when the column is absent.
func addColumnIfMissing(db *sql.DB, table, column, decl string) error {
	rows, err := db.Query(`SELECT name FROM pragma_table_info(?)`, table)
	if err != nil {
		return fmt.Errorf("inspect %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return err
		}
		if name == column {
			return nil // already present
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if _, err := db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + decl); err != nil {
		return fmt.Errorf("add %s.%s: %w", table, column, err)
	}
	return nil
}

// Close closes the underlying database.
func (s *Store) Close() error { return s.db.Close() }

// ensureProfileRow guarantees the single profile row exists.
func ensureProfileRow(db *sql.DB) error {
	_, err := db.Exec(`INSERT OR IGNORE INTO profile (id) VALUES (1)`)
	if err != nil {
		return fmt.Errorf("seed profile row: %w", err)
	}
	return nil
}
