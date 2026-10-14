// sections.js — per-module motion for the home page chapters (5.3).
//
//   A   #about tags light up one by one (CSS, triggered by .is-in)
//   E1  #experience gold line follows the section's scroll progress; nodes
//       the line has reached get .is-lit
//   N1  #notes floating cover card that follows the pointer over a row
//   P1  #projects 3D tilt + light spot + count-up stars
//   T1  #thoughts ink reveal, char by char (first 120 chars only)
//   M1  #moments darkroom develop + FLIP ghost into the moments.js lightbox
// G1 / G3 live in motion.js because the post page needs them too.
// Must load before thoughts.js / moments.js (see the script order in 7.6).
(function () {
  "use strict";

  var M = window.Motion;
  if (!M) return;
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- A: about tags ----------
  function initAbout() {
    var meta = document.querySelector("#about .about-meta");
    if (!meta) return;
    $$(".tags span", meta).forEach(function (s, i) { s.style.setProperty("--i", i); });
  }

  // ---------- E1: timeline ----------
  function initTimeline() {
    var tl = document.querySelector("#experience .timeline");
    if (!tl) return;
    var nodes = $$(".tl-item", tl);
    if (M.reduced) {
      tl.style.setProperty("--tl", "1");
      nodes.forEach(function (n) { n.classList.add("is-lit"); });
      return;
    }
    var on = false, queued = false, top = 0, h = 0, marks = [];
    var measure = function () {
      var r = tl.getBoundingClientRect();
      top = r.top + window.scrollY;
      h = tl.offsetHeight || 1;
      marks = nodes.map(function (n) {
        var dot = n.querySelector(".tl-node") || n;
        var rr = dot.getBoundingClientRect();
        return rr.top + rr.height / 2 + window.scrollY - top;
      });
    };
    var update = function () {
      M.loop.remove(update);
      queued = false;
      // The line's head sits at 60% of the viewport.
      var head = window.scrollY + window.innerHeight * 0.6 - top;
      var v = M.clamp(head / h, 0, 1);
      tl.style.setProperty("--tl", v.toFixed(4));
      nodes.forEach(function (n, i) { n.classList.toggle("is-lit", head >= marks[i]); });
    };
    var schedule = function () { if (on && !queued) { queued = true; M.loop.add(update); } };
    measure();
    M.observe(tl, function (e) { on = e.isIntersecting; if (on) { measure(); schedule(); } }, { once: false, threshold: 0 });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", function () { measure(); schedule(); });
    window.addEventListener("load", function () { measure(); schedule(); });
  }

  // ---------- N1: hover cover card ----------
  function initNotes() {
    var list = document.querySelector("#notes .post-list");
    if (!list || M.touch) return;
    var rows = $$(".post-row", list);
    if (!rows.length) return;
    var card = document.createElement("div");
    card.className = "post-card";
    card.setAttribute("aria-hidden", "true");
    card.innerHTML = '<div class="post-card-art"><b class="post-card-glyph"></b></div>';
    var art = card.firstChild, glyph = art.firstChild;
    var img = null;
    list.appendChild(card);

    var x = 0, y = 0, tx = 0, ty = 0, rot = 0, active = null, running = false, hideTimer = 0;
    var fill = function (row) {
      var cover = row.getAttribute("data-cover");
      var hue = parseInt(row.getAttribute("data-hue"), 10) || 0;
      card.style.setProperty("--h", hue);
      if (cover) {
        if (!img) { img = document.createElement("img"); img.alt = ""; img.decoding = "async"; art.appendChild(img); }
        img.src = cover;
        art.classList.add("has-img");
      } else {
        art.classList.remove("has-img");
      }
      glyph.textContent = row.getAttribute("data-glyph") || "";
    };
    var step = function () {
      x = M.lerp(x, tx, 0.18);
      y = M.lerp(y, ty, 0.18);
      var vx = tx - x;
      rot = M.lerp(rot, M.clamp(vx * 0.12, -6, 6), 0.18);
      card.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0) rotate(" + rot.toFixed(2) + "deg)";
      if (!active && Math.abs(tx - x) < 0.3 && Math.abs(ty - y) < 0.3) { M.loop.remove(step); running = false; }
    };
    var place = function (row, e) {
      var lr = list.getBoundingClientRect();
      if (M.reduced) {
        // Fixed at the right end of the row, no follow.
        var rr = row.getBoundingClientRect();
        tx = x = lr.width - 240 - 56;
        ty = y = rr.top - lr.top + rr.height / 2 - 75;
        card.style.transform = "translate3d(" + x + "px," + y + "px,0)";
        return;
      }
      tx = e.clientX - lr.left + 28;
      ty = e.clientY - lr.top - 75;
      if (tx + 240 > lr.width + 40) tx = e.clientX - lr.left - 240 - 28;
      if (!running) { running = true; M.loop.add(step); }
    };
    rows.forEach(function (row) {
      row.addEventListener("pointerenter", function (e) {
        if (e.pointerType === "touch") return;
        clearTimeout(hideTimer);
        var first = !active;
        active = row;
        fill(row);
        if (first && !M.reduced) {
          var lr = list.getBoundingClientRect();
          x = tx = e.clientX - lr.left + 28;
          y = ty = e.clientY - lr.top - 75;
        }
        place(row, e);
        card.classList.add("is-on");
      });
      row.addEventListener("pointermove", function (e) { if (active === row) place(row, e); });
      row.addEventListener("pointerleave", function () {
        if (active !== row) return;
        active = null;
        hideTimer = setTimeout(function () { if (!active) card.classList.remove("is-on"); }, 40);
      });
    });
  }

  // ---------- P1: project cards ----------
  function initProjects() {
    var cards = $$("#projects .project-card");
    if (!cards.length) return;
    cards.forEach(function (c) {
      var num = c.querySelector(".pj-stars .num[data-to]");
      if (num && !M.reduced) {
        var to = parseInt(num.getAttribute("data-to"), 10) || 0;
        M.observe(c, function () { M.countUp(num, to, 1100); }, { threshold: 0.4 });
      }
      if (M.touch) {
        c.addEventListener("pointerdown", function () { c.classList.add("is-press"); }, { passive: true });
        ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
          c.addEventListener(ev, function () { c.classList.remove("is-press"); }, { passive: true });
        });
        return;
      }
      var raf = 0, ex = 0, ey = 0;
      var apply = function () {
        raf = 0;
        var r = c.getBoundingClientRect();
        var nx = (ex - r.left) / r.width, ny = (ey - r.top) / r.height;
        c.style.setProperty("--cx", (nx * 100).toFixed(1) + "%");
        c.style.setProperty("--cy", (ny * 100).toFixed(1) + "%");
        if (!M.reduced) {
          c.style.setProperty("--ry", ((nx - 0.5) * 16).toFixed(2) + "deg");
          c.style.setProperty("--rx", ((0.5 - ny) * 16).toFixed(2) + "deg");
        }
      };
      c.addEventListener("pointermove", function (e) {
        if (e.pointerType === "touch") return;
        ex = e.clientX; ey = e.clientY;
        c.classList.add("is-hot");
        if (!raf) raf = requestAnimationFrame(apply);
      });
      c.addEventListener("pointerleave", function () {
        c.classList.remove("is-hot");
        c.style.setProperty("--rx", "0deg");
        c.style.setProperty("--ry", "0deg");
      });
    });
  }

  // ---------- T1: ink reveal ----------
  // Only the first 120 characters are wrapped in inline spans (inline spans
  // never change line boxes, so thoughts.js still measures the true height);
  // the remainder sits in one span that fades in after the last char.
  var INK_CHARS = 120;
  function initThoughts() {
    var bodies = $$("#thoughts .thought-body");
    if (!bodies.length || M.reduced) return;
    bodies.forEach(function (body) {
      var text = body.textContent;
      if (!text) return;
      var chars = Array.from(text);
      var head = chars.slice(0, INK_CHARS), rest = chars.slice(INK_CHARS).join("");
      var frag = document.createDocumentFragment();
      head.forEach(function (ch, i) {
        if (/\s/.test(ch)) { frag.appendChild(document.createTextNode(ch)); return; }
        var s = document.createElement("span");
        s.className = "ink";
        s.style.setProperty("--d", (i * 60) + "ms");
        s.textContent = ch;
        frag.appendChild(s);
      });
      if (rest) {
        var tail = document.createElement("span");
        tail.className = "ink ink-rest";
        tail.style.setProperty("--d", (head.length * 60) + "ms");
        tail.textContent = rest;
        frag.appendChild(tail);
      }
      body.textContent = "";
      body.appendChild(frag);
      body.setAttribute("aria-label", text);
      body.classList.add("is-ink");
      var card = body.closest(".thought") || body;
      M.observe(card, function () {
        body.classList.add("is-inked");
        // Restore the plain text once the reveal is done; keeps the DOM light
        // and selection/copy identical to the server markup.
        setTimeout(function () {
          body.textContent = text;
          body.removeAttribute("aria-label");
          body.classList.remove("is-ink", "is-inked");
        }, head.length * 60 + 1400);
      }, { threshold: 0.25 });
    });
  }

  // ---------- M1: darkroom + FLIP into the lightbox ----------
  function initMoments() {
    var feed = document.getElementById("moments");
    if (!feed) return;
    var imgs = $$("img.moment-item", feed);
    imgs.forEach(function (img) { M.develop(img); });
    if (M.reduced) return;
    // moments.js opens the lightbox on the same click (it binds after us), so
    // we fly a ghost copy from the thumbnail to the slide's final rect while
    // the real lightbox image fades in under it.
    imgs.forEach(function (img) {
      img.addEventListener("click", function () {
        var from = img.getBoundingClientRect();
        if (!from.width) return;
        var src = img.getAttribute("data-full") || img.currentSrc || img.src;
        requestAnimationFrame(function () {
          var box = document.querySelector(".lightbox:not([hidden])");
          if (!box) return;
          var slides = $$(".lightbox-slide", box);
          var siblings = $$("img.moment-item", img.closest(".moment-media") || feed);
          var target = slides[siblings.indexOf(img)];
          var timg = target && target.querySelector(".lightbox-img");
          if (!timg) return;
          var fly = function () {
            var to = timg.getBoundingClientRect();
            if (!to.width) return;
            var ghost = document.createElement("img");
            ghost.className = "flip-ghost";
            ghost.src = src;
            ghost.alt = "";
            ghost.style.left = to.left + "px";
            ghost.style.top = to.top + "px";
            ghost.style.width = to.width + "px";
            ghost.style.height = to.height + "px";
            var sx = from.width / to.width, sy = from.height / to.height;
            ghost.style.transform = "translate(" + (from.left - to.left) + "px," + (from.top - to.top) + "px) scale(" + sx + "," + sy + ")";
            document.body.appendChild(ghost);
            timg.style.opacity = "0";
            box.classList.add("is-flip");
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                ghost.classList.add("is-go");
                ghost.style.transform = "none";
              });
            });
            var end = function () {
              if (!ghost.parentNode) return;
              timg.style.opacity = "";
              box.classList.remove("is-flip");
              ghost.parentNode.removeChild(ghost);
            };
            ghost.addEventListener("transitionend", end, { once: true });
            setTimeout(end, 700);
          };
          if (timg.complete && timg.naturalWidth) fly();
          else timg.addEventListener("load", fly, { once: true });
        });
      });
    });
  }

  function init() {
    initAbout();
    initTimeline();
    initNotes();
    initProjects();
    initThoughts();
    initMoments();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
