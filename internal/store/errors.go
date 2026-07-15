package store

import "errors"

// ErrNotFound is returned when a lookup finds no matching row.
var ErrNotFound = errors.New("not found")
