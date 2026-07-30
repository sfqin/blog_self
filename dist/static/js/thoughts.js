// thoughts.js — collapse long "思考" cards on the home page.
//
// A thought's body renders in full, but if it's taller than COLLAPSED_PX we
// clamp it with a fade and show a 展开/收起 toggle. When any thought is
// expanded, a floating 收起 button appears (bottom-right) so you never have to
// scroll to the very bottom to collapse a long one. Pure progressive
// enhancement: with JS off, every thought just shows in full.
(function () {
  "use strict";

  var COLLAPSED_PX = 168; // ~7 lines; must match .thought-body.collapsed max-height

  var expanded = [];      // currently-expanded cards, in expand order
  var floatBtn = null;

  function ensureFloatBtn() {
    if (floatBtn) return floatBtn;
    floatBtn = document.createElement("button");
    floatBtn.type = "button";
    floatBtn.className = "thought-collapse-float";
    floatBtn.textContent = "收起 ▴";
    floatBtn.hidden = true;
    floatBtn.addEventListener("click", function () {
      // Collapse the expanded thought the reader is currently looking at
      // (topmost one intersecting the viewport), else the last expanded.
      var target = readingCard() || expanded[expanded.length - 1];
      if (target) collapse(target);
    });
    document.body.appendChild(floatBtn);
    return floatBtn;
  }

  // The expanded card most likely being read: the one whose body overlaps the
  // viewport and sits nearest the top.
  function readingCard() {
    var best = null, bestTop = Infinity;
    expanded.forEach(function (card) {
      var r = card.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) {
        var t = Math.abs(r.top);
        if (t < bestTop) { bestTop = t; best = card; }
      }
    });
    return best;
  }

  function syncFloat() {
    ensureFloatBtn().hidden = expanded.length === 0;
  }

  function expand(card, body, btn) {
    body.classList.remove("collapsed");
    btn.textContent = "收起 ▴";
    if (expanded.indexOf(card) === -1) expanded.push(card);
    syncFloat();
  }

  function collapse(card) {
    var body = card.querySelector(".thought-body");
    var btn = card.querySelector(".thought-toggle");
    if (body) body.classList.add("collapsed");
    if (btn) btn.textContent = "展开 ▾";
    var i = expanded.indexOf(card);
    if (i !== -1) expanded.splice(i, 1);
    syncFloat();
    card.scrollIntoView({ block: "nearest" });
  }

  function setup(card) {
    var body = card.querySelector(".thought-body");
    var btn = card.querySelector(".thought-toggle");
    if (!body || !btn) return;

    // Only clamp when the content genuinely overflows the collapsed height.
    if (body.scrollHeight <= COLLAPSED_PX + 8) return;

    body.classList.add("collapsed");
    btn.hidden = false;
    btn.addEventListener("click", function () {
      if (body.classList.contains("collapsed")) expand(card, body, btn);
      else collapse(card);
    });
  }

  function init() {
    document.querySelectorAll("#thoughts .thought").forEach(setup);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
