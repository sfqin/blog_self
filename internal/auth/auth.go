// Package auth provides the CSRF token helpers used by the admin forms:
// random token generation and constant-time comparison. There is no login or
// password — the admin runs locally on the user's own machine.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
)

// RandomToken returns a URL-safe random token with n bytes of entropy.
func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ConstantTimeEqual compares two tokens without leaking timing information.
func ConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
