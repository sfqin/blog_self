// search.js — dependency-free fuzzy search over the static /api/search index.
//
// The public site is a static export, so there is no server to query: we fetch
// the whole index once (same trick as the globe's /api/footprints) and match
// in the browser. Fuzzy matching is subsequence-based, which works for both
// Latin ("gcnv" -> globe-canvas) and CJK (matching any run of characters).
(function () {
  "use strict";

  var input = document.getElementById("site-search");
  if (!input) return;
  var panel = document.getElementById("search-results");
  if (!panel) return;

  // Same base-prefix convention as globe.js so it works at a domain root or
  // under a sub-path (Gitee Pages).
  var BASE = (window.__BASE__ || "").replace(/\/$/, "");

  var docs = null;      // loaded index
  var loading = false;
  var items = [];       // current rendered results (DOM + doc)
  var active = -1;      // keyboard-highlighted index

  function load() {
    if (docs || loading) return;
    loading = true;
    fetch(BASE + "/api/search")
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (d) { docs = Array.isArray(d) ? d : []; })
      .catch(function () { docs = []; })
      .then(function () { loading = false; if (input.value) run(input.value); });
  }

  // Subsequence fuzzy score: every needle char must appear in order in the
  // haystack. Contiguous runs and early matches score higher. Returns -1 for
  // no match. Case-insensitive; CJK is unaffected by lowercasing.
  function score(needle, hay) {
    if (!needle) return 0;
    needle = needle.toLowerCase();
    hay = hay.toLowerCase();
    var n = 0, h = 0, s = 0, streak = 0, firstAt = -1;
    while (n < needle.length && h < hay.length) {
      if (needle[n] === hay[h]) {
        if (firstAt < 0) firstAt = h;
        streak++;
        s += 1 + streak;      // reward consecutive matches
        n++;
      } else {
        streak = 0;
      }
      h++;
    }
    if (n < needle.length) return -1; // not all chars matched
    s -= firstAt * 0.05;              // prefer matches nearer the start
    return s;
  }

  // Best score across a doc's searchable fields (title weighted highest).
  function docScore(q, d) {
    var t = score(q, d.title || "");
    var body = score(q, d.text || "");
    var tags = score(q, d.tags || "");
    var best = Math.max(t >= 0 ? t + 6 : -1, body, tags >= 0 ? tags + 2 : -1);
    return best;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  // Highlight the fuzzy-matched needle chars in a short snippet of the title.
  function mark(title, q) {
    if (!q) return esc(title);
    var out = "", ti = 0, qi = 0, ql = q.toLowerCase(), tl = title.toLowerCase();
    for (; ti < title.length; ti++) {
      if (qi < ql.length && tl[ti] === ql[qi]) {
        out += "<mark>" + esc(title[ti]) + "</mark>";
        qi++;
      } else {
        out += esc(title[ti]);
      }
    }
    return out;
  }

  function hide() { panel.style.display = "none"; panel.innerHTML = ""; items = []; active = -1; }

  function run(q) {
    q = q.trim();
    if (!q) { hide(); return; }
    if (!docs) { load(); return; }

    var scored = [];
    for (var i = 0; i < docs.length; i++) {
      var sc = docScore(q, docs[i]);
      if (sc >= 0) scored.push({ d: docs[i], s: sc });
    }
    scored.sort(function (a, b) { return b.s - a.s; });
    scored = scored.slice(0, 8);

    if (!scored.length) {
      panel.innerHTML = '<div class="sr-empty">// 无匹配结果</div>';
      panel.style.display = "block";
      items = []; active = -1;
      return;
    }

    panel.innerHTML = "";
    items = [];
    scored.forEach(function (row, idx) {
      var d = row.d;
      var a = document.createElement("a");
      a.className = "sr-item";
      a.href = d.url;
      if (d.type === "project" && /^https?:/.test(d.url)) { a.target = "_blank"; a.rel = "noopener"; }
      a.innerHTML =
        '<span class="sr-badge">' + esc(d.badge || d.type) + "</span>" +
        '<span class="sr-title">' + mark(d.title || "", q) + "</span>" +
        (d.date ? '<span class="sr-date">' + esc(d.date) + "</span>" : "");
      a.addEventListener("mouseenter", function () { setActive(idx); });
      a.addEventListener("click", function () { setTimeout(hide, 0); });
      panel.appendChild(a);
      items.push(a);
    });
    active = -1;
    panel.style.display = "block";
  }

  function setActive(i) {
    if (active >= 0 && items[active]) items[active].classList.remove("active");
    active = i;
    if (active >= 0 && items[active]) items[active].classList.add("active");
  }

  input.addEventListener("focus", load);
  input.addEventListener("input", function () { run(input.value); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (items.length) setActive((active + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { if (active >= 0 && items[active]) { items[active].click(); } }
    else if (e.key === "Escape") { input.blur(); hide(); }
  });

  // Click-away closes the panel.
  document.addEventListener("click", function (e) {
    if (!panel.contains(e.target) && e.target !== input) hide();
  });

  // "/" focuses search from anywhere (unless already typing in a field).
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== input) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); input.focus(); }
    }
  });
})();
