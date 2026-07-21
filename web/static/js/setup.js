// setup.js — drives the beginner first-run wizard (/setup).
//
// Each step reads the server's environment detection (/setup/status) and lets
// the user fix red ✗ items with a button that POSTs to a /setup/* action.
// Everything talks JSON; no terminal needed.
//
// While any action runs, its button enters a loading state (spinner + "…中",
// disabled) and the step shows a clear working/ok/error note, so a beginner
// always knows something is happening and whether it succeeded.
(function () {
  "use strict";

  const csrf = document.getElementById("csrf").value;
  const os = document.querySelector(".setup-wrap").dataset.os;

  // POST helper: sends form-encoded body with the CSRF token, returns JSON.
  async function post(path, params) {
    const body = new URLSearchParams(params || {});
    body.set("csrf_token", csrf);
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return r.json();
  }

  async function getStatus() {
    const r = await fetch("/setup/status", { headers: { "Cache-Control": "no-store" } });
    return r.json();
  }

  // --- loading-state helpers ------------------------------------------------

  // Put a button into a loading state: disabled, spinner + label, remember the
  // original label so we can restore it.
  function startLoading(btn, label) {
    if (!btn) return;
    if (btn.dataset.orig === undefined) btn.dataset.orig = btn.innerHTML;
    btn.classList.add("is-loading");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = '<span class="spin"></span> ' + (label || "处理中…");
  }

  // Restore a button to its normal, clickable state.
  function stopLoading(btn) {
    if (!btn) return;
    btn.classList.remove("is-loading");
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    if (btn.dataset.orig !== undefined) btn.innerHTML = btn.dataset.orig;
  }

  // Show a colored note under a step. state: "working" | "ok" | "error" | "".
  function note(id, state, msg, detail) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = "check-note show" + (state ? " " + state : "");
    const spin = state === "working" ? '<span class="spin"></span> ' : "";
    const body = (msg || "") + (detail ? "\n" + detail : "");
    // Use textContent for the body (safe), but allow the leading spinner span.
    el.innerHTML = spin + "<span></span>";
    el.querySelector("span:last-child").textContent = body;
  }

  function clearNote(id) {
    const el = document.getElementById(id);
    if (el) el.className = "check-note";
  }

  // Paint a .check row: dot glyph + colour, detail text, and optional button.
  function paintCheck(id, ok, detail, showBtn) {
    const el = document.getElementById(id);
    if (!el) return;
    const dot = el.querySelector(".dot");
    dot.textContent = ok ? "✓" : "✗";
    dot.className = "dot " + (ok ? "dot-ok" : "dot-bad");
    el.querySelector(".check-detail").textContent = detail;
    const btn = el.querySelector("button[data-install], button");
    if (btn && btn.hasAttribute("data-install")) btn.hidden = !showBtn;
  }

  // Mark a .check row's dot as actively working (amber pulse).
  function markDotWorking(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const dot = el.querySelector(".dot");
    dot.textContent = "…";
    dot.className = "dot dot-working";
  }

  // Enable/disable a step visually based on whether prerequisites are met.
  function setStepReady(step, ready) {
    const el = document.getElementById("step-" + step);
    const rail = document.querySelector('#rail li[data-step="' + step + '"]');
    if (el) el.classList.toggle("locked", !ready);
    if (rail) rail.classList.toggle("done", ready);
  }

  // Refresh the whole wizard from server state.
  async function refresh() {
    let data;
    try {
      data = await getStatus();
    } catch (e) {
      return;
    }
    const s = data.status;

    // Step 1: git + gh presence.
    const gitOK = s.git.state === "ok";
    paintCheck("check-git", gitOK, gitOK ? (s.git.version || "已安装") : "未安装", !gitOK);
    const ghInstalled = s.gh.state === "ok" || (s.gh.version || "") !== "";
    paintCheck("check-gh", s.gh.state === "ok" || ghInstalled,
      ghInstalled ? (s.gh.version || "已安装") : "未安装", !ghInstalled);
    setStepReady("env", gitOK && ghInstalled);

    // Step 2: GitHub auth.
    const authed = !!s.githubUser;
    paintCheck("check-auth", authed,
      authed ? ("已登录：" + s.githubUser) : "尚未登录 GitHub", false);
    setStepReady("github", authed);

    // Step 3: repo linked.
    const hasRepo = !!s.remoteUrl;
    setStepReady("repo", hasRepo);
    if (hasRepo) {
      document.getElementById("repo-result").textContent = "已关联：" + s.remoteUrl;
    }

    // Step 5 readiness (all prerequisites for publishing).
    setStepReady("publish", s.allReady);
  }

  // --- Wire buttons ---------------------------------------------------------

  // Install git / gh.
  document.querySelectorAll("button[data-install]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tool = btn.dataset.install;
      const rowId = tool === "git" ? "check-git" : "check-gh";
      // On macOS, installing git triggers the system CLT installer dialog. On
      // Windows, git (like gh) is downloaded directly by us — no dialog, no
      // package manager — so the guidance differs per tool AND per OS.
      const loadingLabel = tool === "git" && os === "darwin" ? "安装中…" : "下载中…";
      let workingMsg;
      if (tool === "git") {
        workingMsg =
          os === "darwin"
            ? "正在安装 Git…可能会弹出系统对话框，请按提示点“安装/继续”。这一步可能需要几分钟，请耐心等待。"
            : "正在从 github.com 下载 Git（约 40MB，无需安装其他软件）…请保持网络畅通，稍候片刻。";
      } else {
        workingMsg =
          "正在从 github.com 下载 GitHub CLI（约 10–15MB，无需安装其他软件）…请保持网络畅通，稍候片刻。";
      }
      markDotWorking(rowId);
      startLoading(btn, loadingLabel);
      note("env-note", "working", workingMsg);
      try {
        const res = await post("/setup/install", { tool });
        note("env-note", res.ok ? "ok" : "error", res.message, res.detail);
      } catch (e) {
        note("env-note", "error", "请求失败，请检查网络后重试。", String(e));
      } finally {
        stopLoading(btn);
        await refresh();
      }
    });
  });

  // GitHub login (browser device flow). We start gh, show the one-time code
  // (big, copyable), auto-open the browser, then poll status until the user
  // authorizes — so the step turns green with no manual "recheck".
  let authPoll = null;
  function startAuthPolling() {
    if (authPoll) return;
    let elapsed = 0;
    authPoll = setInterval(async () => {
      elapsed += 2500;
      let s;
      try {
        s = (await getStatus()).status;
      } catch (e) {
        return;
      }
      if (s.githubUser) {
        clearInterval(authPoll);
        authPoll = null;
        note("gh-note", "ok", "GitHub 账号已连接：" + s.githubUser + "。可以进行下一步了。");
        const box = document.getElementById("ghcode-box");
        if (box) box.hidden = true;
        await refresh();
      } else if (elapsed >= 5 * 60 * 1000) {
        // Give up after 5 minutes; the user can click login again.
        clearInterval(authPoll);
        authPoll = null;
      }
    }, 2500);
  }

  document.getElementById("btn-ghlogin").addEventListener("click", async () => {
    const btn = document.getElementById("btn-ghlogin");
    markDotWorking("check-auth");
    startLoading(btn, "正在打开授权页…");
    note("gh-note", "working", "正在启动 GitHub 登录并打开授权页，请稍候…");
    try {
      const res = await post("/setup/gh-login", {});
      if (res.ok && res.code) {
        // Show the code prominently and begin auto-detecting success.
        const box = document.getElementById("ghcode-box");
        document.getElementById("ghcode").textContent = res.code;
        if (res.url) document.getElementById("ghcode-url").href = res.url;
        box.hidden = false;
        note("gh-note", "working", res.message + "（正在等待你完成授权…）");
        startAuthPolling();
      } else if (res.ok) {
        // Already authenticated.
        note("gh-note", "ok", res.message);
        await refresh();
      } else {
        note("gh-note", "error", res.message, res.detail);
      }
    } catch (e) {
      note("gh-note", "error", "启动登录失败，请重试。", String(e));
    } finally {
      stopLoading(btn);
    }
  });

  // Copy the one-time code to the clipboard.
  document.getElementById("btn-copycode").addEventListener("click", async () => {
    const btn = document.getElementById("btn-copycode");
    const code = document.getElementById("ghcode").textContent;
    try {
      await navigator.clipboard.writeText(code);
      const orig = btn.textContent;
      btn.textContent = "已复制 ✓";
      setTimeout(() => (btn.textContent = orig), 1500);
    } catch (e) {
      // Clipboard may be blocked; select the code so the user can copy manually.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("ghcode"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  // Create repo.
  document.getElementById("btn-createrepo").addEventListener("click", async () => {
    const btn = document.getElementById("btn-createrepo");
    const name = document.getElementById("repo-name").value.trim();
    startLoading(btn, "创建中…");
    note("repo-note", "working", "正在创建 / 关联公开仓库 “" + name + "”…");
    try {
      const res = await post("/setup/create-repo", { name });
      note("repo-note", res.ok ? "ok" : "error", res.message, res.detail);
    } catch (e) {
      note("repo-note", "error", "创建仓库失败，请重试。", String(e));
    } finally {
      stopLoading(btn);
      await refresh();
    }
  });

  // Publish to GitHub Pages.
  document.getElementById("btn-publish").addEventListener("click", async () => {
    const btn = document.getElementById("btn-publish");
    const message = document.getElementById("pub-msg").value.trim();
    startLoading(btn, "发布中…");
    note("pub-note", "working",
      "正在渲染静态站并推送到 GitHub Pages…首次可能需要 1–2 分钟，请不要关闭本页。");
    try {
      const res = await post("/setup/publish", { message });
      note("pub-note", res.ok ? "ok" : "error", res.message, res.detail);
      if (res.ok && res.url) {
        const live = document.getElementById("pub-live");
        const a = document.getElementById("pub-url");
        a.href = res.url;
        a.textContent = res.url;
        live.hidden = false;
      }
    } catch (e) {
      note("pub-note", "error", "发布失败，请重试。", String(e));
    } finally {
      stopLoading(btn);
    }
  });

  // Recheck buttons: brief loading state so the click feels responsive.
  ["btn-recheck"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener("click", async () => {
      startLoading(b, "检测中…");
      try {
        await refresh();
      } finally {
        stopLoading(b);
      }
    });
  });

  // Initial paint.
  refresh();
})();
