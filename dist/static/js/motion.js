// motion.js — shared motion primitives for the public site (window.Motion).
//
// Every animated module reads capability flags from here instead of probing
// media queries itself, shares one IntersectionObserver per option set, and
// hangs its per-frame work on one rAF loop that pauses while the tab is
// hidden. The globe keeps its own loop. No dependencies.
(function () {
  "use strict";

  var mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  var mqTouch = matchMedia("(hover: none), (pointer: coarse)");
  var changeFns = [];

  var Motion = {
    reduced: mqReduce.matches,
    touch: mqTouch.matches,
    onChange: function (fn) { changeFns.push(fn); },
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    easeInOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    easeOut: function (t) { return 1 - Math.pow(1 - t, 3); }
  };

  function listen(mq, fn) {
    if (mq.addEventListener) mq.addEventListener("change", fn);
    else if (mq.addListener) mq.addListener(fn);
  }
  listen(mqReduce, function () {
    Motion.reduced = mqReduce.matches;
    changeFns.forEach(function (fn) { try { fn(Motion.reduced); } catch (e) { setTimeout(function () { throw e; }); } });
  });
  listen(mqTouch, function () { Motion.touch = mqTouch.matches; });

  // ---- shared IntersectionObserver, one instance per threshold|rootMargin ----
  // An element may carry several callbacks (e.g. [data-reveal] plus a module's
  // own count-up), each removed on its own when it is a once-callback.
  var observers = {};   // key -> { io, cbs: Map(el -> [{cb, once}]) }
  var owner = new Map(); // el -> Set(key)

  function drop(entry, el, rec) {
    var recs = entry.cbs.get(el);
    if (!recs) return;
    var i = recs.indexOf(rec);
    if (i !== -1) recs.splice(i, 1);
    if (recs.length) return;
    entry.cbs.delete(el);
    entry.io.unobserve(el);
    var keys = owner.get(el);
    if (keys) { keys.delete(entry.key); if (!keys.size) owner.delete(el); }
  }

  function observerFor(threshold, rootMargin) {
    var key = threshold + "|" + rootMargin;
    if (observers[key]) return observers[key];
    var entry = { cbs: new Map() };
    entry.io = new IntersectionObserver(function (list) {
      list.forEach(function (e) {
        var recs = entry.cbs.get(e.target);
        if (!recs) return;
        recs.slice().forEach(function (rec) {
          if (rec.once && !e.isIntersecting) return;
          if (rec.once) drop(entry, e.target, rec);
          rec.cb(e);
        });
      });
    }, { threshold: threshold, rootMargin: rootMargin });
    observers[key] = entry;
    entry.key = key;
    return entry;
  }

  // observe(el, cb, {threshold=0.2, once=true, rootMargin="0px"}). With once,
  // cb fires a single time when el first intersects; otherwise on every change.
  Motion.observe = function (el, cb, opts) {
    if (!el || typeof cb !== "function") return;
    opts = opts || {};
    var threshold = opts.threshold == null ? 0.2 : opts.threshold;
    var rootMargin = opts.rootMargin || "0px";
    var once = opts.once !== false;
    if (!("IntersectionObserver" in window)) {
      cb({ target: el, isIntersecting: true, intersectionRatio: 1 });
      return;
    }
    var entry = observerFor(threshold, rootMargin);
    var recs = entry.cbs.get(el);
    if (!recs) { recs = []; entry.cbs.set(el, recs); }
    recs.push({ cb: cb, once: once });
    if (!owner.has(el)) owner.set(el, new Set());
    owner.get(el).add(entry.key);
    // A fresh observe() call always reports the current state, so a second
    // callback on an already-observed element still gets its first entry.
    entry.io.unobserve(el);
    entry.io.observe(el);
  };

  // unobserve(el): drop every callback registered for el.
  Motion.unobserve = function (el) {
    var keys = owner.get(el);
    if (!keys) return;
    keys.forEach(function (key) {
      var entry = observers[key];
      entry.cbs.delete(el);
      entry.io.unobserve(el);
    });
    owner.delete(el);
  };

  // ---- shared rAF loop; stops itself when nothing is registered ----
  var fns = [];
  var rafId = 0, last = 0;

  function frame(t) {
    rafId = 0;
    if (document.hidden || !fns.length) return;
    var dt = last ? Math.min(t - last, 50) : 16;
    last = t;
    fns.slice().forEach(function (fn) {
      try { fn(t, dt); } catch (e) { Motion.loop.remove(fn); setTimeout(function () { throw e; }); }
    });
    if (fns.length) rafId = requestAnimationFrame(frame);
  }
  function kick() {
    if (!rafId && fns.length && !document.hidden) { last = 0; rafId = requestAnimationFrame(frame); }
  }

  Motion.loop = {
    add: function (fn) {
      if (fns.indexOf(fn) === -1) fns.push(fn);
      kick();
      return function () { Motion.loop.remove(fn); };
    },
    remove: function (fn) {
      var i = fns.indexOf(fn);
      if (i !== -1) fns.splice(i, 1);
    }
  };

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      kick(); // last resets to 0, so the first dt after resuming is clamped
    }
  });

  // countUp(el, to, ms=900): roll a number from 0 to `to` (F3 / P1). Reduced
  // motion writes the final value at once.
  Motion.countUp = function (el, to, ms) {
    if (!el) return;
    to = Number(to) || 0;
    ms = ms || 900;
    if (el.__countStop) el.__countStop();
    if (Motion.reduced || to === 0) { el.textContent = String(to); return; }
    var start = 0;
    el.textContent = "0";
    var step = function (t) {
      if (!start) start = t;
      var k = Motion.clamp((t - start) / ms, 0, 1);
      el.textContent = String(Math.round(to * Motion.easeOut(k)));
      if (k >= 1) stop();
    };
    var stop = Motion.loop.add(step);
    el.__countStop = function () { stop(); el.__countStop = null; };
    // A hidden tab never runs the loop; make sure the final value still lands.
    setTimeout(function () { if (el.__countStop) { el.__countStop(); el.textContent = String(to); } }, ms + 1500);
  };

  // ---- generic [data-reveal] (+ [data-reveal-group] stagger) and G2 heads ----
  function initReveal() {
    document.querySelectorAll("[data-reveal-group]").forEach(function (g) {
      g.querySelectorAll("[data-reveal]").forEach(function (el, i) { el.style.setProperty("--i", i); });
    });
    var targets = document.querySelectorAll("[data-reveal], .sec-head");
    targets.forEach(function (el) {
      if (Motion.reduced) { el.classList.add("is-in"); return; }
      Motion.observe(el, function () { el.classList.add("is-in"); }, { threshold: 0.2 });
    });
  }

  // ---- glass nav: transparent until 40px of scroll ----
  function initNav() {
    var nav = document.getElementById("site-nav");
    if (!nav) return;
    var solid = null;
    var sync = function () {
      var s = window.scrollY > 40;
      if (s !== solid) { solid = s; nav.classList.toggle("is-solid", s); }
    };
    window.addEventListener("scroll", sync, { passive: true });
    sync();
    // O6: low-end touch devices skip backdrop-filter.
    if (Motion.touch && (navigator.hardwareConcurrency || 8) <= 4) document.documentElement.classList.add("no-blur");

    // Mobile search: the icon expands a full-width search row. The "/" hotkey
    // (search.js) focuses #site-search, so open the row on any focus too.
    var btn = nav.querySelector(".nav-search-btn");
    var input = document.getElementById("site-search");
    var setOpen = function (open) {
      nav.classList.toggle("search-open", open);
      if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    if (btn && input) {
      btn.addEventListener("click", function () {
        var open = !nav.classList.contains("search-open");
        setOpen(open);
        if (open) input.focus(); else input.blur();
      });
    }
    if (input) {
      input.addEventListener("focus", function () { setOpen(true); });
      input.addEventListener("blur", function () {
        setTimeout(function () { if (document.activeElement !== input && !input.value) setOpen(false); }, 150);
      });
    }
  }

  window.Motion = Motion;

  // ---- M1 darkroom: develop(img) wraps an image in .darkroom and, once it has
  // loaded and scrolled into view, lets it develop from over-exposed + grainy
  // to normal (CSS does the 1.2s transition). Used by sections.js and
  // reading.js. Reduced motion leaves the image untouched.
  Motion.develop = function (img) {
    if (!img || Motion.reduced || img.closest(".darkroom")) return;
    var wrap = document.createElement("span");
    wrap.className = "darkroom";
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    var loaded = img.complete && img.naturalWidth > 0, seen = false;
    var done = function () { if (loaded && seen) requestAnimationFrame(function () { wrap.classList.add("is-dev"); }); };
    if (!loaded) {
      img.addEventListener("load", function () { loaded = true; done(); }, { once: true });
      img.addEventListener("error", function () { wrap.classList.add("is-dev"); }, { once: true });
    }
    Motion.observe(wrap, function () { seen = true; done(); }, { threshold: 0.25 });
  };

  // ---- G1 stardust cursor: ≤3 falling gold motes per pointermove, 0.8s life,
  // 120 max, on one fixed canvas. Not over inputs, the reading panel or the
  // globe. Off on touch and reduced motion.
  function initStardust() {
    if (Motion.touch || Motion.reduced) return;
    var cv = document.createElement("canvas");
    cv.className = "stardust";
    cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    var ctx = cv.getContext("2d"), W = 0, H = 0, motes = [], lx = 0, ly = 0, running = false;
    var root = document.documentElement;
    var size = function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = root.clientWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);
    var draw = function (t, dt) {
      ctx.clearRect(0, 0, W, H);
      var paper = root.getAttribute("data-reading") === "paper";
      ctx.fillStyle = paper ? "#8a6a3a" : "#f3dcae";
      for (var i = motes.length - 1; i >= 0; i--) {
        var m = motes[i];
        m.life += dt;
        if (m.life >= 800) { motes.splice(i, 1); continue; }
        m.vy += 0.0009 * dt;
        m.x += m.vx * dt; m.y += m.vy * dt;
        var k = 1 - m.life / 800;
        ctx.globalAlpha = k * 0.9;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * (0.4 + 0.6 * k), 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!motes.length) { Motion.loop.remove(draw); running = false; ctx.clearRect(0, 0, W, H); }
    };
    var skip = "input, textarea, select, .reading-panel, .globe-stage, .lightbox";
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch" || Motion.reduced) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      var dist = Math.sqrt(dx * dx + dy * dy);
      lx = e.clientX; ly = e.clientY;
      if (dist < 6) return;
      var t = e.target;
      if (t && t.closest && t.closest(skip)) return;
      var n = Math.min(3, Math.ceil(dist / 24));
      for (var i = 0; i < n && motes.length < 120; i++) {
        motes.push({
          x: e.clientX + (Math.random() - 0.5) * 6,
          y: e.clientY + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * 0.06,
          vy: -0.02 + Math.random() * 0.03,
          r: 0.6 + Math.random() * 1.3,
          life: 0
        });
      }
      if (!running) { running = true; Motion.loop.add(draw); }
    }, { passive: true });
  }

  // ---- G3 magnetic: [data-magnetic] leans towards a pointer within reach
  // (≤30% of its own size, scale 1.04) and springs back. Off on touch/reduced.
  function initMagnetic() {
    if (Motion.touch || Motion.reduced) return;
    var items = Array.prototype.map.call(document.querySelectorAll("[data-magnetic]"), function (el) {
      return { el: el, x: 0, y: 0, vx: 0, vy: 0, s: 1, vs: 0, tx: 0, ty: 0, ts: 1 };
    });
    if (!items.length) return;
    var running = false, px = -1e4, py = -1e4;
    var step = function (t, dt) {
      var k = dt / 16, moving = false;
      items.forEach(function (it) {
        // Critically-damped-ish spring; a little overshoot reads as "spring".
        it.vx = (it.vx + (it.tx - it.x) * 0.16 * k) * 0.72;
        it.vy = (it.vy + (it.ty - it.y) * 0.16 * k) * 0.72;
        it.vs = (it.vs + (it.ts - it.s) * 0.16 * k) * 0.72;
        it.x += it.vx * k; it.y += it.vy * k; it.s += it.vs * k;
        var still = Math.abs(it.tx - it.x) < 0.05 && Math.abs(it.ty - it.y) < 0.05 && Math.abs(it.ts - it.s) < 0.001 &&
          Math.abs(it.vx) < 0.05 && Math.abs(it.vy) < 0.05;
        if (still) { it.x = it.tx; it.y = it.ty; it.s = it.ts; }
        else moving = true;
        it.el.style.transform = it.x || it.y || it.s !== 1
          ? "translate3d(" + it.x.toFixed(2) + "px," + it.y.toFixed(2) + "px,0) scale(" + it.s.toFixed(4) + ")"
          : "";
      });
      if (!moving) { Motion.loop.remove(step); running = false; }
    };
    var aim = function () {
      items.forEach(function (it) {
        var r = it.el.getBoundingClientRect();
        if (!r.width) { it.tx = it.ty = 0; it.ts = 1; return; }
        var cx = r.left + r.width / 2 - it.x, cy = r.top + r.height / 2 - it.y;
        var dx = px - cx, dy = py - cy;
        var reach = Math.max(80, Math.max(r.width, r.height) / 2 + 24);
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < reach) {
          var f = 0.45 * (1 - d / reach * 0.4);
          it.tx = Motion.clamp(dx * f, -r.width * 0.3, r.width * 0.3);
          it.ty = Motion.clamp(dy * f, -r.height * 0.3, r.height * 0.3);
          it.ts = 1.04;
        } else { it.tx = it.ty = 0; it.ts = 1; }
      });
      if (!running) { running = true; Motion.loop.add(step); }
    };
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      px = e.clientX; py = e.clientY;
      aim();
    }, { passive: true });
    document.addEventListener("pointerleave", function () { px = py = -1e4; aim(); });
    window.addEventListener("scroll", function () { if (px > -1e4) aim(); }, { passive: true });
  }

  function init() { initNav(); initReveal(); initStardust(); initMagnetic(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
