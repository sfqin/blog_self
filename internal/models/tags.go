package models

import (
	"strconv"
	"strings"
)

// splitTags splits a comma-separated string into trimmed, non-empty values.
func splitTags(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// splitIDs parses a comma-separated string into int64 IDs, skipping blanks and
// non-numeric entries and de-duplicating while preserving first-seen order.
func splitIDs(s string) []int64 {
	seen := map[int64]bool{}
	out := make([]int64, 0)
	for _, p := range strings.Split(s, ",") {
		t := strings.TrimSpace(p)
		if t == "" {
			continue
		}
		n, err := strconv.ParseInt(t, 10, 64)
		if err != nil || n == 0 || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}
