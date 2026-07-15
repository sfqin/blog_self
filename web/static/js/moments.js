// moments.js — click an image in the 瞬间 feed to open it full-size in a
// lightbox overlay. Videos keep their native controls and play inline, so we
// only intercept images. Multi-image moments become a swipeable carousel.
//
// The carousel follows the finger 1:1 while dragging and slides smoothly on
// release. It does NOT loop: at the first/last image a short hint appears and
// the track springs back. A downward fling dismisses the viewer.
//
// Pure progressive enhancement: with JS off, images still render and open via
// their src on right-click/open-in-new-tab. No dependencies.
(function () {
  "use strict";

  var feed = document.getElementById("moments");
  if (!feed) return;

  var imgs = Array.prototype.slice.call(feed.querySelectorAll("img.moment-item"));
  if (!imgs.length) return;

  // The slide transition. Kept in JS (not CSS) so we can toggle it off for
  // 1:1 finger tracking and back on for the release animation deterministically.
  var SLIDE_EASE = "transform 0.36s cubic-bezier(0.22, 0.61, 0.36, 1)";
  var FADE_EASE = "transform 0.3s ease, opacity 0.3s ease";

  var overlay = null, viewport = null, track = null, hintEl = null;
  var prevBtn = null, nextBtn = null;
  var current = -1, group = [], slideW = 0, hintTimer = null;

  function build() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.hidden = true;
    overlay.innerHTML =
      '<button class="lightbox-close" type="button" aria-label="关闭">✕ 关闭</button>' +
      '<button class="lightbox-nav lightbox-prev" type="button" aria-label="上一张">‹</button>' +
      '<div class="lightbox-viewport"><div class="lightbox-track"></div></div>' +
      '<button class="lightbox-nav lightbox-next" type="button" aria-label="下一张">›</button>' +
      '<div class="lightbox-hint" role="status" aria-live="polite"></div>';
    document.body.appendChild(overlay);
    viewport = overlay.querySelector(".lightbox-viewport");
    track = overlay.querySelector(".lightbox-track");
    hintEl = overlay.querySelector(".lightbox-hint");
    prevBtn = overlay.querySelector(".lightbox-prev");
    nextBtn = overlay.querySelector(".lightbox-next");

    overlay.querySelector(".lightbox-close").addEventListener("click", close);
    prevBtn.addEventListener("click", function (e) { e.stopPropagation(); step(-1); });
    nextBtn.addEventListener("click", function (e) { e.stopPropagation(); step(1); });
    // A click on empty backdrop (viewport gutter / a slide's letterbox area)
    // closes; a click on the image itself or a control does not.
    overlay.addEventListener("click", function (e) {
      var t = e.target;
      if (t === overlay || t === viewport || t === track ||
          (t.classList && t.classList.contains("lightbox-slide"))) close();
    });

    bindTouch();
    window.addEventListener("resize", function () {
      if (overlay.hidden || !group.length) return;
      slideW = viewport.clientWidth;
      setTransition(false);
      setTranslate(-current * slideW);
    });
  }

  function setTransition(on) {
    track.style.transition = on ? SLIDE_EASE : "none";
    viewport.style.transition = on ? FADE_EASE : "none";
  }
  function setTranslate(px) {
    track.style.transform = "translate3d(" + px + "px, 0, 0)";
  }

  function bindTouch() {
    var startX = 0, startY = 0, base = 0, dragging = false, axis = null;
    var lastX = 0, lastT = 0, vx = 0;

    viewport.addEventListener("touchstart", function (e) {
      if (!e.touches || e.touches.length !== 1) { dragging = false; return; }
      slideW = viewport.clientWidth;
      startX = lastX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastT = Date.now();
      base = -current * slideW;
      axis = null;
      vx = 0;
      dragging = true;
      setTransition(false);        // follow the finger with no lag
    }, { passive: true });

    viewport.addEventListener("touchmove", function (e) {
      if (!dragging || !e.touches || e.touches.length !== 1) return;
      var x = e.touches[0].clientX, y = e.touches[0].clientY;
      var dx = x - startX, dy = y - startY;
      if (axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;  // wait for real intent
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (e.cancelable) e.preventDefault();                // never scroll the page under the overlay
      if (axis === "x") {
        var off = dx;
        // Rubber-band when pulling past the first/last image.
        if ((current === 0 && dx > 0) ||
            (current === group.length - 1 && dx < 0)) off = dx * 0.32;
        setTranslate(base + off);
        var now = Date.now();
        if (now > lastT) { vx = (x - lastX) / (now - lastT); lastX = x; lastT = now; }
      } else {
        // Vertical drag pulls the whole viewport down and fades the backdrop.
        var ty = dy < 0 ? dy * 0.3 : dy;                   // resist upward
        viewport.style.transform = "translate3d(0," + ty + "px,0)";
        overlay.style.background = "rgba(3,8,4," +
          Math.max(0.35, 0.92 - Math.abs(ty) / 700).toFixed(3) + ")";
      }
    }, { passive: false });

    viewport.addEventListener("touchend", function (e) {
      if (!dragging) return;
      dragging = false;
      setTransition(true);
      var t = e.changedTouches && e.changedTouches[0];
      if (axis === "y") {
        var dy = t ? t.clientY - startY : 0;
        if (dy > 90) { close(); return; }
        viewport.style.transform = "";                     // spring back up
        overlay.style.background = "";
        return;
      }
      var dx = t ? t.clientX - startX : 0;
      var flung = Math.abs(dx) > slideW * 0.18 || Math.abs(vx) > 0.45;
      if (flung && dx < 0 && current < group.length - 1) go(current + 1);
      else if (flung && dx > 0 && current > 0) go(current - 1);
      else {
        if (flung && group.length > 1 &&
            ((dx > 0 && current === 0) || (dx < 0 && current === group.length - 1))) {
          bounceHint(dx > 0 ? "first" : "last");
        }
        setTranslate(-current * slideW);                   // settle on current
      }
    }, { passive: true });
  }

  function renderSlides() {
    track.innerHTML = "";
    group.forEach(function (src) {
      var slide = document.createElement("div");
      slide.className = "lightbox-slide";
      var img = document.createElement("img");
      img.className = "lightbox-img";
      img.src = src;
      img.alt = "";
      img.draggable = false;
      slide.appendChild(img);
      track.appendChild(slide);
    });
  }

  function updateNav() {
    var multi = group.length > 1;
    prevBtn.hidden = !multi;
    nextBtn.hidden = !multi;
    prevBtn.classList.toggle("is-end", current <= 0);
    nextBtn.classList.toggle("is-end", current >= group.length - 1);
  }

  function go(i) {
    current = Math.max(0, Math.min(group.length - 1, i));
    slideW = viewport.clientWidth;
    setTransition(true);
    setTranslate(-current * slideW);
    updateNav();
  }

  // Arrow buttons / keyboard: step without wrapping, hint at the ends.
  function step(d) {
    var t = current + d;
    if (t < 0) { bounceHint("first"); return; }
    if (t > group.length - 1) { bounceHint("last"); return; }
    go(t);
  }

  function bounceHint(which) {
    if (!hintEl) return;
    hintEl.textContent = which === "first" ? "已经是第一张" : "已经是最后一张";
    hintEl.classList.remove("lb-hint-show");
    void hintEl.offsetWidth;                 // restart the fade if shown again
    hintEl.classList.add("lb-hint-show");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hintEl.classList.remove("lb-hint-show"); }, 1100);
  }

  function open(list, i) {
    build();
    group = list.map(function (im) { return im.getAttribute("data-full") || im.src; });
    renderSlides();
    overlay.hidden = false;
    document.body.classList.add("lightbox-open");
    current = Math.max(0, Math.min(group.length - 1, i));
    slideW = viewport.clientWidth;
    setTransition(false);
    setTranslate(-current * slideW);         // jump to the tapped image, no slide
    updateNav();
    requestAnimationFrame(function () { setTransition(true); });
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.style.background = "";
    viewport.style.transform = "";
    track.innerHTML = "";
    group = [];
    current = -1;
    document.body.classList.remove("lightbox-open");
  }

  // Wire each image to open the lightbox scoped to its own moment's images.
  imgs.forEach(function (img) {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", function () {
      var box = img.closest(".moment-media") || feed;
      var siblings = Array.prototype.slice.call(box.querySelectorAll("img.moment-item"));
      open(siblings, siblings.indexOf(img));
    });
  });

  document.addEventListener("keydown", function (e) {
    if (!overlay || overlay.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
})();
