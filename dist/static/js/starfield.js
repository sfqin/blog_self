// starfield.js — the fixed night sky behind every public page (5.2).
//
// ~230 stars (120 on touch) in three depth layers. The pointer offsets each
// star by its depth (z) for parallax and drives the .spotlight glow; touch
// devices get a half-strength scroll parallax and a tap ripple instead.
// Reduced motion draws one still frame. On the post page in paper mode the
// canvas is hidden by CSS, so the loop skips drawing. Requires motion.js.
(function () {
  "use strict";

  var canvas = document.getElementById("starfield");
  var M = window.Motion;
  if (!canvas || !canvas.getContext || !M) return;

  var root = document.documentElement;
  var ctx = canvas.getContext("2d");
  var spot = document.querySelector(".spotlight");
  var stars = [], W = 0, H = 0, dpr = 1;
  var px = 0, py = 0, tx = 0, ty = 0;   // smoothed / target pointer offset (-.5….5)
  var meteor = null, nextMeteor = 0;
  var removeLoop = null;

  function seed() {
    var n = M.touch ? 120 : 230;
    stars = [];
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: 0.2 + Math.random() * 1.2,
        z: 0.1 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        speed: 0.0006 + Math.random() * 0.0024,   // radians per ms
        gold: Math.random() < 0.14
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = root.clientWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (M.reduced) draw(0, 0);
  }

  function paper() { return root.getAttribute("data-reading") === "paper"; }

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);
    var still = M.reduced;
    var sy = still ? 0 : window.scrollY * (M.touch ? 0.06 : 0.12);
    var ox = still ? 0 : px * 24, oy = still ? 0 : py * 16;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (!still) s.phase += s.speed * dt;
      var x = s.x * W - ox * s.z;
      var y = ((s.y * H - oy * s.z - sy * s.z) % H + H) % H;
      var tw = still ? 0.8 : 0.25 + 0.75 * Math.abs(Math.sin(s.phase));
      ctx.globalAlpha = tw * (0.35 + 0.65 * s.z);
      ctx.fillStyle = s.gold ? "#f3dcae" : "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, 6.2832);
      ctx.fill();
    }
    if (!still && !M.touch) drawMeteor(t, dt);
    ctx.globalAlpha = 1;
  }

  // A rare shooting star crossing the upper sky, every 9–16s.
  function drawMeteor(t, dt) {
    if (!nextMeteor) nextMeteor = t + 4000 + Math.random() * 6000;
    if (!meteor && t > nextMeteor) {
      meteor = { x: W * (0.3 + Math.random() * 0.6), y: H * Math.random() * 0.35, life: 0, max: 900 };
    }
    if (!meteor) return;
    meteor.life += dt;
    var k = meteor.life / meteor.max;
    if (k >= 1) { meteor = null; nextMeteor = t + 9000 + Math.random() * 7000; return; }
    var hx = meteor.x - k * 260, hy = meteor.y + k * 120;
    var g = ctx.createLinearGradient(hx, hy, hx + 90, hy - 42);
    g.addColorStop(0, "rgba(243,220,174,.9)");
    g.addColorStop(1, "rgba(243,220,174,0)");
    ctx.globalAlpha = Math.sin(Math.PI * k);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + 90, hy - 42);
    ctx.stroke();
  }

  function frame(t, dt) {
    if (paper()) return;
    px += (tx - px) * 0.06;
    py += (ty - py) * 0.06;
    draw(t, dt);
  }

  function start() {
    if (removeLoop) { removeLoop(); removeLoop = null; }
    if (M.reduced) { draw(0, 0); return; }
    removeLoop = M.loop.add(frame);
  }

  seed();
  resize();
  window.addEventListener("resize", resize);
  M.onChange(start);
  start();
  requestAnimationFrame(function () { canvas.classList.add("is-in"); });

  // Pointer parallax + spotlight (desktop) / tap ripple (touch).
  if (!M.touch) {
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      tx = e.clientX / (W || 1) - 0.5;
      ty = e.clientY / (H || 1) - 0.5;
      if (spot) {
        spot.style.setProperty("--mx", e.clientX + "px");
        spot.style.setProperty("--my", e.clientY + "px");
      }
    }, { passive: true });
    document.addEventListener("pointerleave", function () {
      if (spot) { spot.style.setProperty("--mx", "-999px"); spot.style.setProperty("--my", "-999px"); }
    });
  } else if (spot && !M.reduced) {
    var rippleTimer = 0;
    window.addEventListener("pointerdown", function (e) {
      spot.style.setProperty("--mx", e.clientX + "px");
      spot.style.setProperty("--my", e.clientY + "px");
      spot.classList.remove("is-ripple");
      void spot.offsetWidth;
      spot.classList.add("is-ripple");
      clearTimeout(rippleTimer);
      rippleTimer = setTimeout(function () { spot.classList.remove("is-ripple"); }, 650);
    }, { passive: true });
  }
})();
