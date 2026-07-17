package server

import (
	"context"
	"encoding/json"
	"net/http"
	"os"

	"dev-home-blog/internal/export"
	"dev-home-blog/internal/setup"
)

// writeJSON encodes v as a JSON response.
func (s *Server) writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

// handleSetup renders the beginner wizard. It is reachable without any login —
// the admin runs locally on the user's own machine, so there is no password.
func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	s.writeHTML(w, "setup.html", map[string]any{
		"CSRF": s.ensureCSRF(w, r),
		"OS":   s.goos,
	})
}

// handleSetupStatus returns the current environment detection as JSON.
func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	st := s.detector.Detect(r.Context())
	s.writeJSON(w, map[string]any{
		"status": st,
	})
}

// handleSetupInstall installs a requested tool ("git" or "gh").
func (s *Server) handleSetupInstall(w http.ResponseWriter, r *http.Request) {
	switch r.PostFormValue("tool") {
	case "git":
		s.writeJSON(w, s.actor.InstallGit(r.Context(), s.goos))
	case "gh":
		s.writeJSON(w, s.actor.InstallGH(r.Context(), s.goos))
	default:
		s.writeJSON(w, setup.ActionResult{OK: false, Message: "未知工具。"})
	}
}

// handleSetupGHLogin starts the browser-based GitHub login. It opens the
// browser and returns the one-time code immediately; gh finishes in the
// background and /setup/status flips green once the user authorizes.
func (s *Server) handleSetupGHLogin(w http.ResponseWriter, r *http.Request) {
	s.writeJSON(w, s.actor.GHLoginStart(r.Context(), s.goos))
}


// handleSetupCreateRepo creates (or links) a GitHub repository. The repo is
// always public — GitHub Pages (free) cannot publish from a private repo.
func (s *Server) handleSetupCreateRepo(w http.ResponseWriter, r *http.Request) {
	name := r.PostFormValue("name")
	s.writeJSON(w, s.actor.CreateRepo(r.Context(), name))
}

// handleSetupPublish renders the site (sub-path build for GitHub Pages) and
// pushes it to the gh-pages branch, then reports the live URL.
func (s *Server) handleSetupPublish(w http.ResponseWriter, r *http.Request) {
	st := s.detector.Detect(r.Context())
	owner, repo, ok := setup.ParseOwnerRepo(st.RemoteURL)
	if !ok {
		s.writeJSON(w, setup.ActionResult{OK: false, Message: "尚未关联 GitHub 仓库，请先完成上一步。"})
		return
	}

	// GitHub Pages serves at /<repo>/, so render with that base prefix.
	base := "/" + repo
	tmp, err := os.MkdirTemp("", "dh-pages-*")
	if err != nil {
		s.writeJSON(w, setup.ActionResult{OK: false, Message: "创建临时目录失败。", Detail: err.Error()})
		return
	}
	defer os.RemoveAll(tmp)

	if err := export.Run(s.store, s.render, s.static, tmp, base); err != nil {
		s.writeJSON(w, setup.ActionResult{OK: false, Message: "渲染静态站失败。", Detail: err.Error()})
		return
	}

	msg := r.PostFormValue("message")
	res := s.actor.PublishPages(context.WithoutCancel(r.Context()), tmp, owner, repo, msg)
	s.writeJSON(w, res.ActionResult)
}
