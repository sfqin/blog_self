package server

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A handler panic must become a logged HTTP 500 with a JSON body, not a dropped
// connection. A dropped connection shows up in the browser as a bare "Failed to
// fetch" with nothing in the server log, which is undiagnosable from a user's
// machine — exactly the failure mode recoverPanic exists to prevent.
func TestRecoverPanicReturns500(t *testing.T) {
	log.SetOutput(io.Discard) // silence the expected panic log line
	defer log.SetOutput(nil)

	s := &Server{} // recoverPanic uses no Server fields
	h := s.recoverPanic(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/setup/gh-login", nil)

	// Must not propagate the panic to the caller (net/http's own recover would
	// otherwise drop the connection).
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if body := rec.Body.String(); !strings.Contains(body, `"ok":false`) {
		t.Errorf("body = %q, want it to contain \"ok\":false", body)
	}
}

// The happy path must pass through untouched.
func TestRecoverPanicPassesThrough(t *testing.T) {
	s := &Server{}
	h := s.recoverPanic(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("hello"))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.String() != "hello" {
		t.Errorf("body = %q, want %q", rec.Body.String(), "hello")
	}
}
