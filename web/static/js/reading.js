// reading.js — post page: reading progress, nav title, TOC, h2 rules, M1
// images and the night / paper toggle (5.5). Requires motion.js.
(function () {
  "use strict";

  var M = window.Motion;
  if (!M) return;
  var root = document.documentElement;
  var article = document.querySelector(".reading-panel .article");
  var panel = document.querySelector(".reading-panel");
  var bar = document.getElementById("read-progress");
  var nav = document.getElementById("site-nav");
  var h1 = document.querySelector(".post-title");
  var tocBox = document.getElementById("reading-toc");
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  // ---------- night / paper ----------
  var toggle = document.getElementById("reading-toggle");
  function syncToggle() {
    if (!toggle) return;
    var paper = root.getAttribute("data-reading") === "paper";
    toggle.setAttribute("aria-pressed", paper ? "true" : "false");
    toggle.setAttribute("aria-label", paper ? "切换到夜间" : "切换到纸页");
    toggle.title = paper ? "切换到夜间" : "切换到纸页";
  }
  function setMode(mode) {
    root.setAttribute("data-reading", mode);
    try { localStorage.setItem("reading-mode", mode); } catch (e) { /* private mode */ }
    syncToggle();
  }
  if (toggle) {
    syncToggle();
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-reading") === "paper" ? "night" : "paper";
      if (M.reduced) { setMode(next); return; }
      if (document.startViewTransition) {
        var r = toggle.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
        root.style.setProperty("--vt-x", cx + "px");
        root.style.setProperty("--vt-y", cy + "px");
        root.style.setProperty("--vt-r", Math.ceil(far) + "px");
        root.classList.add("vt-reading");
        var vt = document.startViewTransition(function () { setMode(next); });
        vt.finished.then(function () { root.classList.remove("vt-reading"); }, function () { root.classList.remove("vt-reading"); });
      } else {
        root.classList.add("is-fading");
        setMode(next);
        setTimeout(function () { root.classList.remove("is-fading"); }, 320);
      }
    });
  }

  if (!article) return;

  // ---------- headings: ids, rule reveal ----------
  var h2s = $$("h2", article);
  var heads = h2s.length ? h2s : $$("h3", article);
  heads.forEach(function (h, i) { h.id = "sec-" + (i + 1); });
  h2s.forEach(function (h) {
    if (M.reduced) { h.classList.add("is-in"); return; }
    M.observe(h, function () { h.classList.add("is-in"); }, { threshold: 0.6 });
  });

  // ---------- M1 images ----------
  $$("img", article).forEach(function (img) { M.develop(img); });

  // ---------- wide tables scroll inside their own box ----------
  $$("table", article).forEach(function (t) {
    if (t.parentNode.classList && t.parentNode.classList.contains("table-wrap")) return;
    var w = document.createElement("div");
    w.className = "table-wrap";
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
  });

  // ---------- TOC ----------
  var tocLinks = [];
  if (tocBox && heads.length >= 2) {
    var html = '<p class="toc-title">目录</p><ol class="toc-list"><i class="toc-rail" aria-hidden="true"></i>';
    heads.forEach(function (h, i) {
      html += '<li><a href="#' + h.id + '" data-i="' + i + '"></a></li>';
    });
    tocBox.innerHTML = html + "</ol>";
    $$("a", tocBox).forEach(function (a, i) {
      a.textContent = heads[i].textContent;
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var navH = nav ? nav.offsetHeight : 64;
        var top = heads[i].getBoundingClientRect().top + window.scrollY - navH - 16;
        window.scrollTo({ top: Math.max(0, top), behavior: M.reduced ? "auto" : "smooth" });
        if (history.replaceState) history.replaceState(null, "", "#" + heads[i].id);
      });
      tocLinks.push(a);
    });
    tocBox.hidden = false;
    tocBox.classList.add("has-items");
  }
  var tocRail = tocBox ? tocBox.querySelector(".toc-rail") : null;

  // ---------- scroll-bound bits (progress bar, nav title, current TOC item) ----------
  var startY = 0, endY = 1, h1Bottom = 0, headTops = [];
  function measure() {
    var sy = window.scrollY;
    var r = article.getBoundingClientRect();
    startY = r.top + sy - window.innerHeight * 0.2;
    // Reaches 1 when the end of the body hits the bottom of the viewport.
    endY = Math.max(startY + 1, r.bottom + sy - window.innerHeight);
    h1Bottom = h1 ? h1.getBoundingClientRect().bottom + sy - (nav ? nav.offsetHeight : 64) : 0;
    headTops = heads.map(function (h) { return h.getBoundingClientRect().top + sy; });
    schedule();
  }
  var cur = -2, titled = null;
  function update() {
    M.loop.remove(update);
    queued = false;
    var y = window.scrollY;
    if (bar) {
      var p = M.clamp((y - startY) / (endY - startY), 0, 1);
      if (y + window.innerHeight >= root.scrollHeight - 2) p = 1;
      bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
    }
    var t = y > h1Bottom;
    if (t !== titled && nav) { titled = t; nav.classList.toggle("has-title", t); }
    if (tocLinks.length) {
      var line = y + window.innerHeight * 0.3, c = -1;
      headTops.forEach(function (top, i) { if (top <= line) c = i; });
      if (c !== cur) {
        cur = c;
        tocLinks.forEach(function (a, i) {
          a.classList.toggle("is-current", i === c);
          a.classList.toggle("is-past", i < c);
        });
        if (tocRail) tocRail.style.transform = "scaleY(" + (c < 0 ? 0 : (c + 1) / tocLinks.length).toFixed(3) + ")";
      }
    }
  }
  var queued = false;
  function schedule() { if (!queued) { queued = true; M.loop.add(update); } }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  if ("ResizeObserver" in window && panel) new ResizeObserver(measure).observe(panel);
  measure();
})();
