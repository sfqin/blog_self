package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	// idleTimeout is how long the server keeps running after the last browser
	// heartbeat. Browsers throttle background tabs, so this is generous enough
	// to survive the user switching to the GitHub authorization page (~1 min).
	idleTimeout = 75 * time.Second
	// watchdogTick is how often the idle watchdog checks the last heartbeat.
	watchdogTick = 10 * time.Second
	// heartbeatPath is pinged by heartbeat.js from every open blog page.
	heartbeatPath = "/internal/alive"
	// readyPath is an ultra-light liveness probe for the double-click launchers.
	// Unlike /setup/status it does NO environment or network detection, so it
	// answers in microseconds even on a slow connection — the launcher must not
	// block on the (possibly multi-second) gh/git probes just to learn whether
	// the server process is up.
	readyPath = "/internal/ready"
)

// runtimeInfo is written to <data>/.runtime.json while the server runs, so the
// double-click launcher can discover the live port/URL and PID (to "open" or
// "restart") without guessing. It is removed on graceful shutdown.
type runtimeInfo struct {
	Port    int    `json:"port"`
	PID     int    `json:"pid"`
	URL     string `json:"url"`
	Started string `json:"started"`
}

// beat records a browser heartbeat; the watchdog reads it to decide when the
// last page has gone away.
func (s *Server) beat() { s.lastBeat.Store(time.Now().UnixNano()) }

// handleAlive records a heartbeat from an open page and returns 204. It is the
// endpoint heartbeat.js pings on a timer; logRequests skips it to avoid noise.
func (s *Server) handleAlive(w http.ResponseWriter, r *http.Request) {
	s.beat()
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

// idleFor reports how long it has been since the last heartbeat.
func (s *Server) idleFor() time.Duration {
	return time.Since(time.Unix(0, s.lastBeat.Load()))
}

// handleReady is the launcher's liveness probe. It intentionally does no work
// beyond confirming the process serves HTTP, so it returns instantly even when
// the environment (gh/git/network) is slow. It sets a permissive CORS header so
// the file:// loading page (packaging/loading.html) can read it while polling.
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write([]byte(`{"ready":true}`))
}

// runtimePath is the sidecar file next to the database, e.g.
// ~/dev-home-blog/.runtime.json.
func (s *Server) runtimePath() string {
	return filepath.Join(filepath.Dir(s.cfg.DBPath), ".runtime.json")
}

// listen binds the configured port, or the next free one if it is taken. This
// makes the server own port selection: if something else grabbed 8080, we
// transparently move to 8081, 8082, … and report the port we actually got.
func (s *Server) listen() (net.Listener, int, error) {
	host, portStr, err := net.SplitHostPort(s.cfg.Addr)
	if err != nil {
		// Addr like ":8080" splits fine; a bare value is treated as the port.
		host, portStr = "", strings.TrimPrefix(s.cfg.Addr, ":")
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		port = 8080
	}
	for tries := 0; tries < 50; tries++ {
		addr := net.JoinHostPort(host, strconv.Itoa(port))
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			return ln, port, nil
		}
		if !errors.Is(err, syscall.EADDRINUSE) {
			return nil, 0, err
		}
		port++
	}
	return nil, 0, errors.New("no free port found near " + s.cfg.Addr)
}

// writeRuntime persists the live port/PID/URL so the launcher can find us.
func (s *Server) writeRuntime(port int) {
	info := runtimeInfo{
		Port:    port,
		PID:     os.Getpid(),
		URL:     "http://localhost:" + strconv.Itoa(port),
		Started: time.Now().Format(time.RFC3339),
	}
	b, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return
	}
	if err := os.WriteFile(s.runtimePath(), b, 0o644); err != nil {
		log.Printf("runtime file: %v", err)
	}
}

// Run binds a port, advertises it via the runtime file, and serves until either
// the browser goes idle (heartbeat watchdog) or the process is signalled. It
// replaces the old ListenAndServe so the server can pick its own port and shut
// itself down when every blog tab is closed.
func (s *Server) Run() error {
	ln, port, err := s.listen()
	if err != nil {
		return err
	}
	s.beat() // fresh start counts as activity until the first page pings
	s.writeRuntime(port)
	defer os.Remove(s.runtimePath())

	httpSrv := &http.Server{Handler: s.logRequests(s.gzipStatic(s.mux))}

	// Reason we stopped, for a friendlier log line.
	stop := make(chan string, 1)

	// Idle watchdog: quit once no page has pinged for idleTimeout.
	go func() {
		t := time.NewTicker(watchdogTick)
		defer t.Stop()
		for range t.C {
			if s.idleFor() > idleTimeout {
				stop <- "空闲超时（所有网页已关闭）"
				return
			}
		}
	}()

	// OS signals: Ctrl-C, or the launcher killing us on "restart".
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() { <-sigCh; stop <- "收到停止信号" }()

	// Graceful shutdown when either trigger fires.
	go func() {
		reason := <-stop
		log.Printf("shutting down: %s", reason)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(ctx)
	}()

	log.Printf("dev@home blog listening on http://localhost:%d (db=%s)", port, s.cfg.DBPath)
	if err := httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
