// constellation.js — hero star map that docks into a side rail (5.2), plus
// the mobile bottom star rail (5.6).
//
// The server renders .constellation as a row of plain anchors (works without
// JS). Here we add .is-live, draw the connecting lines in an SVG and place
// every star on each scroll frame:
//   ≥768px  the layer is fixed to the viewport; stars interpolate from their
//           hero coordinates to a zig-zag column on the right edge as the
//           first 0.8 viewport heights scroll by, then .is-docked.
//   <768px  stars sit on a wave under the name and scroll away with the hero;
//           #star-rail takes over once the hero is 55% gone.
// The star (and rail star) of the section crossing the 45% line gets
// .is-current; line.prog fills up to it and partway towards the next one.
(function () {
  "use strict";

  var M = window.Motion;
  var cst = document.getElementById("constellation");
  var hero = document.querySelector(".hero");
  if (!M || !cst || !hero) return;

  var NS = "http://www.w3.org/2000/svg";
  var HERO_PTS = [[.56, .66], [.64, .42], [.74, .56], [.80, .30], [.88, .50], [.93, .72], [.84, .84]];
  var root = document.documentElement;
  var nav = document.getElementById("site-nav");
  var rail = document.getElementById("star-rail");
  var heroText = hero.querySelector(".hero-text");
  var cue = hero.querySelector(".scroll-cue");
  var mqMobile = matchMedia("(max-width: 767px)");

  var stars = Array.prototype.map.call(cst.querySelectorAll("a.star"), function (a, i) {
    var off = a.hasAttribute("data-off");
    var key = a.getAttribute("data-key");
    return { el: a, i: i, key: key, off: off, sec: off ? null : document.getElementById(key), top: null, x: 0, y: 0, left: null };
  });
  if (!stars.length) return;
  stars.forEach(function (s) { s.el.style.setProperty("--n", s.i); });
  var railStars = rail ? Array.prototype.slice.call(rail.querySelectorAll("a.rail-star")) : [];

  // A finite, wordless click cue after the entrance; browsing dismisses it.
  var guide = null, guideTimer = null, guideDone = false;
  function dismissGuide() {
    guideDone = true;
    clearTimeout(guideTimer);
    if (guide) { guide.remove(); guide = null; }
    window.removeEventListener("pointerdown", dismissGuide);
    window.removeEventListener("keydown", dismissGuide);
  }
  function showGuide() {
    if (guideDone || M.reduced || window.scrollY > 8 || location.hash || root.classList.contains("no-intro")) return dismissGuide();
    var target = stars.find(function (s) { return !s.off && s.sec; });
    if (!target) return dismissGuide();
    guide = document.createElement("span");
    guide.className = "star-guide";
    guide.setAttribute("aria-hidden", "true");
    var hand = mk("svg", { viewBox: "0 0 28 32", focusable: "false" }, guide);
    mk("path", { d: "M7 17V5a2.5 2.5 0 0 1 5 0v7a2.5 2.5 0 0 1 5 0v2a2.5 2.5 0 0 1 5 0v2a2 2 0 0 1 4 0v5c0 6-3 9-8 9h-2c-3 0-5-2-7-4l-6-7a2.5 2.5 0 0 1 3.5-3.5L7 17Z" }, hand);
    target.el.appendChild(guide);
    guideTimer = setTimeout(dismissGuide, 8000);
  }
  window.addEventListener("pointerdown", dismissGuide, { passive: true });
  window.addEventListener("keydown", dismissGuide);
  guideTimer = setTimeout(showGuide, 2400);

  // ---- lines ----
  var svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "cst-lines");
  svg.setAttribute("aria-hidden", "true");
  var defs = mk("defs", {}, svg);
  var fl = mk("filter", { id: "cst-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
  mk("feGaussianBlur", { stdDeviation: "2.2", result: "b" }, fl);
  var fm = mk("feMerge", {}, fl);
  mk("feMergeNode", { "in": "b" }, fm);
  mk("feMergeNode", { "in": "SourceGraphic" }, fm);
  var gBase = mk("g", {}, svg), gProg = mk("g", {}, svg);
  var segs = [];
  for (var i = 1; i < stars.length; i++) {
    var a = stars[i - 1], b = stars[i];
    var dim = a.off || b.off;
    var base = mk("line", { "class": "base" + (dim ? " dim" : "") }, gBase);
    if (!dim) base.setAttribute("pathLength", "1");
    base.style.setProperty("--n", i - 1);
    var prog = dim ? null : mk("line", { "class": "prog", pathLength: "1", filter: "url(#cst-glow)" }, gProg);
    segs.push({ a: a, b: b, base: base, prog: prog });
  }
  cst.insertBefore(svg, cst.firstChild);
  cst.classList.add("is-live");

  function mk(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function setLine(l, a, b) {
    l.setAttribute("x1", a.x.toFixed(1));
    l.setAttribute("y1", a.y.toFixed(1));
    l.setAttribute("x2", b.x.toFixed(1));
    l.setAttribute("y2", b.y.toFixed(1));
  }

  // ---- measurement (layout reads stay out of the scroll path) ----
  var mobile = false, vw = 0, vh = 0, heroH = 0, boxW = 0, boxH = 0;
  function measure() {
    mobile = mqMobile.matches;
    cst.classList.toggle("is-wave", mobile);
    vw = root.clientWidth;
    vh = window.innerHeight;
    heroH = hero.offsetHeight;
    if (mobile) { boxW = cst.clientWidth; boxH = cst.clientHeight; }
    var sy = window.scrollY;
    stars.forEach(function (s) { s.top = s.sec ? s.sec.getBoundingClientRect().top + sy : null; });
    schedule();
  }

  // ---- per-frame update ----
  var cur = -2, docked = null, railOn = null, lastPar = -1;
  var searchFocus = false;

  function update() {
    var y = window.scrollY;
    if (!guideDone && (y > 8 || M.reduced)) dismissGuide();
    var p;
    if (mobile) p = 0;
    else if (M.reduced) p = y > 0.4 * vh ? 1 : 0;
    else p = M.easeInOutCubic(M.clamp(y / (0.8 * vh), 0, 1));
    var k = M.lerp(1, 0.58, p);
    var lab = mobile ? 1 : Math.abs(p - 0.5) * 2;

    stars.forEach(function (s, i) {
      var x, sy;
      if (mobile) {
        x = (0.08 + i * 0.14) * boxW;
        sy = (0.5 + 0.18 * Math.sin(i * 1.1)) * boxH;
      } else {
        var h = HERO_PTS[Math.min(i, HERO_PTS.length - 1)];
        x = M.lerp(h[0] * vw, vw - 44 + (i % 2 ? 14 : 0), p);
        sy = M.lerp(h[1] * heroH - y, vh * (0.20 + i * 0.09), p);
      }
      s.x = x;
      s.y = sy;
      var st = s.el.style;
      st.transform = "translate3d(" + x.toFixed(1) + "px," + sy.toFixed(1) + "px,0)";
      st.setProperty("--k", k.toFixed(3));
      st.setProperty("--lab", lab.toFixed(2));
      var left = !mobile && (p > 0.5 || x > vw - 120);
      if (left !== s.left) { s.left = left; s.el.classList.toggle("is-left", left); }
    });

    // Current section: last one whose top has crossed the 45% line; at the
    // very bottom of the page the last lit section wins.
    var anchor = y + 0.45 * vh, c = -1, lastLit = -1;
    stars.forEach(function (s) {
      if (s.top == null) return;
      lastLit = s.i;
      if (s.top <= anchor) c = s.i;
    });
    if (y > 0 && y + vh >= root.scrollHeight - 2) c = lastLit;

    segs.forEach(function (g) {
      setLine(g.base, g.a, g.b);
      if (!g.prog) return;
      setLine(g.prog, g.a, g.b);
      var v = 0;
      if (c >= g.b.i) v = 1;
      else if (c === g.a.i && g.a.top != null && g.b.top != null) {
        v = M.clamp((anchor - g.a.top) / Math.max(1, g.b.top - g.a.top), 0, 1);
      }
      g.prog.style.strokeDashoffset = (1 - v).toFixed(3);
    });

    if (c !== cur) {
      cur = c;
      stars.forEach(function (s) {
        s.el.classList.toggle("is-current", s.i === c);
        s.el.classList.toggle("is-lit", !s.off && s.i <= c);
        if (s.i === c) s.el.setAttribute("aria-current", "location");
        else s.el.removeAttribute("aria-current");
      });
      railStars.forEach(function (r, i) { r.classList.toggle("is-current", i === c); });
    }

    var d = !mobile && p >= 1;
    if (d !== docked) { docked = d; cst.classList.toggle("is-docked", d); }

    // Hero text drifts up at 0.3× and fades; nothing to do past the hero.
    var py = Math.min(y, heroH);
    if (py !== lastPar) {
      lastPar = py;
      if (heroText && !M.reduced) {
        heroText.style.transform = py ? "translate3d(0," + (py * 0.3).toFixed(1) + "px,0)" : "";
        heroText.style.opacity = py ? (1 - M.clamp(py / (0.6 * heroH), 0, 1)).toFixed(3) : "";
      }
      if (cue) cue.style.opacity = py ? (1 - M.clamp(py / 80, 0, 1)).toFixed(2) : "";
    }

    syncRail(y);
  }

  function syncRail(y) {
    if (!rail) return;
    if (y == null) y = window.scrollY;
    var past = y > 0.55 * heroH;
    var on = past && !searchFocus && !document.body.classList.contains("lightbox-open");
    if (on !== railOn) { railOn = on; rail.classList.toggle("is-on", on); }
    if (past !== hasRail) { hasRail = past; document.body.classList.toggle("has-rail", past); }
  }
  var hasRail = null;

  var queued = false;
  function tick() { M.loop.remove(tick); queued = false; update(); }
  function schedule() { if (!queued) { queued = true; M.loop.add(tick); } }

  // ---- navigation ----
  function go(key, e) {
    dismissGuide();
    var sec = key && document.getElementById(key);
    if (e) e.preventDefault();
    if (!sec) return;
    var navH = nav ? nav.offsetHeight : 64;
    var top = sec.getBoundingClientRect().top + window.scrollY - navH - 16;
    window.scrollTo({ top: Math.max(0, top), behavior: M.reduced ? "auto" : "smooth" });
    if (history.replaceState) history.replaceState(null, "", "#" + key);
  }
  stars.forEach(function (s) {
    s.el.addEventListener("click", function (e) { go(s.off ? null : s.key, e); });
  });
  railStars.forEach(function (r) {
    r.addEventListener("click", function (e) { go(r.hasAttribute("data-off") ? null : r.getAttribute("data-key"), e); });
  });

  // ---- wiring ----
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  if (mqMobile.addEventListener) mqMobile.addEventListener("change", measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  var main = document.querySelector("main");
  if (main && "ResizeObserver" in window) new ResizeObserver(measure).observe(main);
  M.onChange(measure);

  document.addEventListener("focusin", function (e) {
    if (e.target && e.target.id === "site-search") { searchFocus = true; syncRail(); }
  });
  document.addEventListener("focusout", function (e) {
    if (e.target && e.target.id === "site-search") { searchFocus = false; syncRail(); }
  });
  if ("MutationObserver" in window) {
    new MutationObserver(function () { syncRail(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  measure();
  update();
})();
