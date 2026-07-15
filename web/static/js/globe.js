// globe.js — interactive 3D footprint globe (Canvas 2D), per PRD §5.
//
// Three layers, replaced (not stacked):
//   1. Globe   — draggable/auto-rotating sphere, amber pulse markers on visited countries.
//   2. Country — real ADM1 boundaries; visited regions highlighted; drillable ones glow.
//   3. City    — real ADM2 boundaries within a province; visited cities highlighted.
//
// Geo data lives in /static/geo/ and is lazy-loaded per layer (zero network until
// the user drills in). Visited places come from /api/footprints (live from the DB).
(function () {
  "use strict";

  var canvas = document.getElementById("globe-canvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");

  // Base path prefix for all data fetches. Empty when the site is served at a
  // domain root (Cloudflare / EdgeOne); set to e.g. "/repo" via window.__BASE__
  // when hosted under a sub-path (Gitee Pages: user.gitee.io/repo/).
  var BASE = (window.__BASE__ || "").replace(/\/$/, "");

  // ---- theme colors (mirror crt.css tokens) ----
  var C = {
    ocean1: "#0e2a1a", ocean2: "#061309",
    land: "#123a24", landLine: "#1f5c3a",
    border: "#2a6b45", rim: "rgba(74,222,128,0.55)",
    green: "#4ade80", amber: "#fbbf24", text: "#c8f5d3", muted: "#5a7d63",
    visited: "rgba(74,222,128,0.42)", visitedLine: "#4ade80",
    drill: "rgba(251,191,36,0.16)", drillLine: "#fbbf24",
    region: "rgba(30,60,40,0.55)", regionLine: "#2a6b45",
  };

  // ---- province-name -> drill-file key mapping (admin stores localized names) ----
  // China uses adcode; JP/MY files are keyed by English ADM1 name (spaces -> _).
  var CN_ADCODE = {
    "北京市": "110000", "湖南省": "430000", "广东省": "440000",
    "浙江省": "330000", "四川省": "510000", "江苏省": "320000",
  };

  // ============================================================
  // State
  // ============================================================
  var state = {
    layer: "globe",      // globe | country | city
    country: null,       // {code,name}
    province: null,      // {name,key}
    footprints: [],      // grouped [{code,name,provinces:[{name,cities:[]}]}]
    rot: { x: -0.35, y: 0 },   // x=tilt, y=spin
    spin: 0.0016,        // auto-rotation speed
    gz: 1,               // globe zoom (1 = fit; pinch/wheel to magnify the sphere)
    dragging: false,
    lastPt: null,
    vel: { x: 0, y: 0 },
    raf: null,
    regionData: null,    // loaded country/city geojson-ish {view,regions}
    hover: null,         // region under the cursor (desktop hover highlight)
    selected: null,      // region pinned by a click/tap (drives the 瞬间 list)
    // Region-layer (country/city) pan & zoom for touch/wheel. zoom=1 fits view.
    rv: { zoom: 1, panx: 0, pany: 0 },
  };

  var world = null;      // world.json
  var R;                 // effective sphere radius (base * globe zoom)
  var RBASE;             // fit radius at zoom=1 (set on resize)
  var SIZE;              // canvas CSS size in px (square)
  var CX, CY;            // canvas center

  // ============================================================
  // Sizing (PRD §3.4: min(innerWidth-40, 440))
  // ============================================================
  function resize() {
    var size = Math.min(window.innerWidth - 40, 440);
    var dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    SIZE = size;
    RBASE = size * 0.42;
    R = RBASE * state.gz;
    CX = size / 2;
    CY = size / 2;
  }

  // ============================================================
  // Sphere projection: lon/lat -> rotated 3D -> screen.
  // Returns {x,y,visible} where visible=false means back-facing (culled).
  // ============================================================
  function project(lon, lat) {
    var la = (lat * Math.PI) / 180;
    var lo = (lon * Math.PI) / 180;
    // Unit sphere point.
    var x = Math.cos(la) * Math.sin(lo);
    var y = Math.sin(la);
    var z = Math.cos(la) * Math.cos(lo);
    // Rotate around Y (spin), then X (tilt).
    var cosy = Math.cos(state.rot.y), siny = Math.sin(state.rot.y);
    var x1 = x * cosy - z * siny;
    var z1 = x * siny + z * cosy;
    var cosx = Math.cos(state.rot.x), sinx = Math.sin(state.rot.x);
    var y2 = y * cosx - z1 * sinx;
    var z2 = y * sinx + z1 * cosx;
    return { x: CX + x1 * R, y: CY - y2 * R, visible: z2 > 0, z: z2 };
  }

  // Apply the same Y-then-X rotation as project(), but to a raw unit vector
  // (no screen mapping). Used to rotate the sun direction into the view frame
  // so day/night shading lines up with the rotated land.
  function rotateVec(x, y, z) {
    var cosy = Math.cos(state.rot.y), siny = Math.sin(state.rot.y);
    var x1 = x * cosy - z * siny;
    var z1 = x * siny + z * cosy;
    var cosx = Math.cos(state.rot.x), sinx = Math.sin(state.rot.x);
    var y2 = y * cosx - z1 * sinx;
    var z2 = y * sinx + z1 * cosx;
    return { x: x1, y: y2, z: z2 };
  }

  // Sub-solar point (where the sun is directly overhead) for a given instant.
  // Longitude tracks UTC time (sun crosses a meridian at local solar noon);
  // latitude is the solar declination, which swings ±23.44° over the year.
  // Returns the point as both lon/lat (deg) and a world-space unit vector using
  // the SAME axis convention as project().
  function sunDirWorld(date) {
    var dayMs = 86400000;
    var N = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / dayMs); // day of year (Jan 1 = 1)
    var decl = -23.44 * Math.cos((2 * Math.PI / 365) * (N + 10));               // solar declination (deg)
    var utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    var subLon = -15 * (utcH - 12);                                            // subsolar longitude (deg)
    if (subLon > 180) subLon -= 360; else if (subLon < -180) subLon += 360;
    var la = (decl * Math.PI) / 180, lo = (subLon * Math.PI) / 180;
    return {
      lon: subLon, lat: decl,
      x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo),
    };
  }

  // ---- day/night shadow buffer (small, upscaled; rebuilt each frame) ----
  var NIGHT_N = 140;              // buffer resolution (smooth gradient → cheap)
  var nightCanvas = null, nightCtx = null, nightImg = null, nightData = null;
  function ensureNightBuffer() {
    if (nightCanvas) return;
    nightCanvas = document.createElement("canvas");
    nightCanvas.width = NIGHT_N;
    nightCanvas.height = NIGHT_N;
    nightCtx = nightCanvas.getContext("2d");
    nightImg = nightCtx.createImageData(NIGHT_N, NIGHT_N);
    nightData = nightImg.data;
  }

  // Shade the sphere by the current real-world day/night terminator, then add a
  // warm sun glow on the lit side. Must be called inside the sphere clip so it
  // darkens ocean+land but not the rim/markers.
  function drawDayNight() {
    ensureNightBuffer();
    var sun = sunDirWorld(new Date());
    var S = rotateVec(sun.x, sun.y, sun.z);   // sun direction in the view frame

    // Per-pixel illumination over the disk: illum = dot(surfacePoint, sun).
    var data = nightData, N = NIGHT_N, step = 2 / N;
    var maxDark = 0.6;              // darkest the night side gets (keep land faintly visible)
    var dayEnd = 0.12, nightEnd = -0.22;   // twilight band in illumination units
    var span = dayEnd - nightEnd;
    var idx = 0;
    for (var j = 0; j < N; j++) {
      var y2 = 1 - (j + 0.5) * step;
      for (var i = 0; i < N; i++) {
        var x1 = (i + 0.5) * step - 1;
        var rr = x1 * x1 + y2 * y2;
        if (rr > 1) { data[idx + 3] = 0; idx += 4; continue; }  // outside sphere
        var illum = x1 * S.x + y2 * S.y + Math.sqrt(1 - rr) * S.z;
        var a;
        if (illum >= dayEnd) a = 0;
        else if (illum <= nightEnd) a = maxDark;
        else a = maxDark * (dayEnd - illum) / span;
        data[idx] = 1; data[idx + 1] = 7; data[idx + 2] = 6;   // dark cool-green night
        data[idx + 3] = (a * 255) | 0;
        idx += 4;
      }
    }
    nightCtx.putImageData(nightImg, 0, 0);
    var smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(nightCanvas, CX - R, CY - R, 2 * R, 2 * R);
    ctx.imageSmoothingEnabled = smooth;

    // Warm sun glow centered on the subsolar point (only if it faces us).
    var sp = project(sun.lon, sun.lat);
    if (sp.visible) {
      var pulse = 0.9 + 0.1 * Math.sin(Date.now() / 900);   // gentle breathing
      var g = ctx.createRadialGradient(sp.x, sp.y, 2, sp.x, sp.y, R * 1.05);
      g.addColorStop(0, "rgba(255,238,180," + (0.60 * pulse).toFixed(3) + ")");
      g.addColorStop(0.22, "rgba(255,214,110," + (0.34 * pulse).toFixed(3) + ")");
      g.addColorStop(0.55, "rgba(251,191,36," + (0.16 * pulse).toFixed(3) + ")");
      g.addColorStop(1, "rgba(251,191,36,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(CX, CY, R, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ============================================================
  // Layer 1 — the globe
  // ============================================================
  function drawGlobe() {
    var size = SIZE;
    ctx.clearRect(0, 0, size, size);

    // Ocean sphere with radial shading (near-bright -> far-dark).
    var grad = ctx.createRadialGradient(CX - R * 0.3, CY - R * 0.3, R * 0.1, CX, CY, R);
    grad.addColorStop(0, C.ocean1);
    grad.addColorStop(1, C.ocean2);
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Glowing rim.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = C.rim;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = C.green;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

    // Clip to sphere for land/borders.
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.clip();

    drawRings(world.land, C.land, C.landLine, 0.6, true);
    drawRings(world.borders, null, C.border, 0.4, false);

    // Real-time day/night shading + sun glow (still inside the sphere clip so
    // it darkens ocean + land, then the amber markers draw on top, unshaded).
    drawDayNight();

    ctx.restore();

    // Amber pulse markers for visited countries.
    var t = Date.now() / 600;
    state.footprints.forEach(function (fp) {
      var meta = world.countries[fp.code];
      if (!meta) return;
      var p = project(meta.c[0], meta.c[1]);
      if (!p.visible) return;
      var pulse = 4 + Math.sin(t) * 1.6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(251,191,36,0.18)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2);
      ctx.fillStyle = C.amber;
      ctx.shadowColor = C.amber;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.restore();
      // Country code label.
      ctx.fillStyle = C.amber;
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillText(fp.code, p.x + pulse + 4, p.y + 3);
    });
  }

  // Draw an array of rings [[ [lon,lat], ... ], ...] on the sphere with back-face
  // culling: break the path whenever a vertex rotates behind the globe.
  function drawRings(rings, fill, stroke, lw, doFill) {
    if (!rings) return;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      ctx.beginPath();
      var penDown = false;
      for (var i = 0; i < ring.length; i++) {
        var p = project(ring[i][0], ring[i][1]);
        if (!p.visible) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
        else ctx.lineTo(p.x, p.y);
      }
      if (doFill && fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    }
  }

  // Hit-test: which visited country marker (if any) is near screen point.
  function pickCountry(mx, my) {    var best = null, bestD = 16 * 16;
    state.footprints.forEach(function (fp) {
      var meta = world.countries[fp.code];
      if (!meta) return;
      var p = project(meta.c[0], meta.c[1]);
      if (!p.visible) return;
      var d = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my);
      if (d < bestD) { bestD = d; best = fp; }
    });
    return best;
  }

  // ============================================================
  // Layers 2 & 3 — flat region maps (country / city)
  // ============================================================
  // Shared viewBox→screen mapping for the flat region layers, folding in the
  // user's pan/zoom (state.rv). pickRegion() inverts this exact transform.
  function regionTransform() {
    var data = state.regionData;
    var size = SIZE;
    var vw = data.view[0], vh = data.view[1];
    var pad = 16;
    var base = Math.min((size - pad * 2) / vw, (size - pad * 2) / vh);
    var scale = base * state.rv.zoom;
    // Center the (zoomed) map, then apply pan. Panning is in screen pixels.
    var ox = (size - vw * scale) / 2 + state.rv.panx;
    var oy = (size - vh * scale) / 2 + state.rv.pany;
    return { scale: scale, ox: ox, oy: oy, size: size };
  }

  function drawRegions() {
    var data = state.regionData;
    var size = SIZE;
    ctx.clearRect(0, 0, size, size);
    if (!data) {
      ctx.fillStyle = C.muted;
      ctx.font = "13px 'IBM Plex Mono', monospace";
      ctx.fillText("loading…", CX - 30, CY);
      return;
    }
    var T = regionTransform();
    var tx = function (x) { return T.ox + x * T.scale; };
    var ty = function (y) { return T.oy + y * T.scale; };

    var visitedSet = currentVisitedSet();

    data.regions.forEach(function (reg) {
      var visited = visitedSet.has(reg.name);
      var isSel = state.selected === reg.name;
      var fill = visited ? C.visited : (reg.drill ? C.drill : C.region);
      var line = visited ? C.visitedLine : (reg.drill ? C.drillLine : C.regionLine);
      var isHover = state.hover === reg.name;
      ctx.save();
      reg.polys.forEach(function (poly) {
        ctx.beginPath();
        for (var i = 0; i < poly.length; i++) {
          var X = tx(poly[i][0]), Y = ty(poly[i][1]);
          if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.closePath();
        ctx.fillStyle = isSel ? C.drill : fill;
        ctx.fill();
        ctx.lineWidth = isSel ? 1.6 : (reg.drill || visited ? 1.1 : 0.6);
        ctx.strokeStyle = isSel ? C.amber : line;
        if (reg.drill || visited || isHover || isSel) { ctx.shadowColor = isSel ? C.amber : line; ctx.shadowBlur = isSel ? 16 : (isHover ? 12 : 6); }
        ctx.stroke();
      });
      ctx.restore();

      // City layer: mark cities linked to a moment with an amber dot, so it's
      // discoverable that tapping them reveals the 瞬间 links below the globe.
      if (state.layer === "city" && visited && regionMomentIds(reg.name).length) {
        var c = largestPolyCentroid(reg.polys);
        if (c) {
          var mx = tx(c[0]), my = ty(c[1]);
          ctx.save();
          ctx.beginPath();
          ctx.arc(mx, my, 3.4, 0, Math.PI * 2);
          ctx.fillStyle = C.amber;
          ctx.shadowColor = C.amber;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.restore();
        }
      }
    });

    // Bottom label — the hovered region (desktop) or the pinned one (mobile);
    // on the city layer, append the visited city's note.
    var labelName = state.hover || state.selected;
    if (labelName) {
      var label = labelName;
      var note = cityNote(labelName);
      ctx.font = "12px 'IBM Plex Mono', monospace";
      if (note) {
        // Draw a translucent backdrop so the note stays readable over the map.
        var full = label + " — " + note;
        var tw = ctx.measureText(full).width;
        ctx.save();
        ctx.fillStyle = "rgba(6,19,9,0.82)";
        ctx.fillRect(8, size - 28, Math.min(tw + 16, size - 16), 22);
        ctx.restore();
        ctx.fillStyle = C.amber;
        ctx.fillText(label, 12, size - 12);
        var lw = ctx.measureText(label + " — ").width;
        ctx.fillStyle = C.text;
        ctx.fillText("— " + note, 12 + ctx.measureText(label + " ").width, size - 12);
      } else {
        ctx.fillStyle = C.text;
        ctx.fillText(label, 12, size - 12);
      }
    }
  }

  // Set of visited region names for the current layer.
  function currentVisitedSet() {
    var set = new Set();
    if (state.layer === "country" && state.country) {
      var fp = state.footprints.find(function (f) { return f.code === state.country.code; });
      if (fp) fp.provinces.forEach(function (p) { set.add(p.name); });
    } else if (state.layer === "city" && state.country && state.province) {
      var fp2 = state.footprints.find(function (f) { return f.code === state.country.code; });
      if (fp2) {
        var prov = fp2.provinces.find(function (p) { return p.name === state.province.name; });
        if (prov) prov.cities.forEach(function (c) { set.add(c.name); });
      }
    }
    return set;
  }

  // Note for a visited city in the current province layer (empty if none).
  function cityNote(cityName) {
    if (state.layer !== "city" || !state.country || !state.province) return "";
    var fp = state.footprints.find(function (f) { return f.code === state.country.code; });
    if (!fp) return "";
    var prov = fp.provinces.find(function (p) { return p.name === state.province.name; });
    if (!prov) return "";
    var city = prov.cities.find(function (c) { return c.name === cityName; });
    return city && city.note ? city.note : "";
  }

  // Linked moment ids for a region at the current layer.
  //   city layer    → the visited city's own links.
  //   country layer → union of every linked moment across the province's cities.
  // The same city can appear in multiple footprint rows, so links are unioned.
  function regionMomentIds(name) {
    if (!name || !state.country) return [];
    var fp = state.footprints.find(function (f) { return f.code === state.country.code; });
    if (!fp) return [];
    if (state.layer === "city" && state.province) {
      var prov = fp.provinces.find(function (p) { return p.name === state.province.name; });
      return prov ? unionCityMoments(prov.cities, name) : [];
    }
    if (state.layer === "country") {
      var prov2 = fp.provinces.find(function (p) { return p.name === name; });
      return prov2 ? unionCityMoments(prov2.cities, null) : [];
    }
    return [];
  }

  // Union the momentIds of the given cities. When cityName is set, restrict to
  // rows for that city; when null, aggregate the whole list (province level).
  function unionCityMoments(cities, cityName) {
    var out = [], seen = {};
    cities.forEach(function (c) {
      if (cityName && c.name !== cityName) return;
      if (!c.momentIds) return;
      c.momentIds.forEach(function (id) { if (!seen[id]) { seen[id] = 1; out.push(id); } });
    });
    return out;
  }

  // Scroll to a moment in the feed and flash it so the jump is obvious.
  function flashMoment(id) {
    var el = document.getElementById("moment-" + id);
    if (!el) return null;
    el.classList.remove("moment-flash");
    void el.offsetWidth;           // restart the CSS animation
    el.classList.add("moment-flash");
    return el;
  }

  // Jump to a single linked moment: scroll to it and flash it.
  function jumpToMoment(id) {
    var el = flashMoment(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Caption preview for a moment, read straight from the rendered feed so it
  // works identically live and on the static export (no extra API call).
  function momentPreview(id) {
    var node = document.querySelector("#moment-" + id + " .moment-caption");
    var cap = node ? node.textContent.trim().replace(/\s+/g, " ") : "";
    if (!cap) {
      var place = document.querySelector("#moment-" + id + " .moment-place");
      cap = place ? place.textContent.trim() : "查看瞬间";
    }
    return cap.length > 24 ? cap.slice(0, 24) + "…" : cap;
  }

  // Show the linked-瞬间 list for the pinned (clicked) region below the globe.
  // Selection is sticky: a click pins it, so it survives the mouse moving away.
  // Rather than jumping immediately, we render one clickable row per moment and
  // let the user choose which to open (their explicit request).
  function updateMomentLinks() {
    var box = document.getElementById("globe-moment-links");
    if (!box) return;
    var sel = state.selected;
    var ids = sel && (state.layer === "city" || state.layer === "country")
      ? regionMomentIds(sel) : [];
    if (!ids.length) { box.style.display = "none"; box.innerHTML = ""; return; }
    // No place label here — the breadcrumb and canvas label already show where
    // we are (footprint carries the location), so the panel only needs the count.
    var html = '<div class="gml-head"><span class="gml-count">关联瞬间 ' + ids.length + ' 条</span></div>';
    ids.forEach(function (id) {
      html += '<a class="gml-item" data-mid="' + id + '" href="#moment-' + id +
        '"><span class="gml-arrow">↗</span><span class="gml-cap">' + esc(momentPreview(id)) + "</span></a>";
    });
    box.innerHTML = html;
    box.style.display = "block";
    box.querySelectorAll(".gml-item").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        jumpToMoment(parseInt(a.getAttribute("data-mid"), 10));
      });
    });
  }

  // Region hit-test via point-in-polygon in viewBox space.
  function pickRegion(mx, my) {
    var data = state.regionData;
    if (!data) return null;
    var T = regionTransform();
    var px = (mx - T.ox) / T.scale, py = (my - T.oy) / T.scale;
    for (var r = 0; r < data.regions.length; r++) {
      var reg = data.regions[r];
      for (var q = 0; q < reg.polys.length; q++) {
        if (pointInPoly([px, py], reg.polys[q])) return reg;
      }
    }
    return null;
  }
  function pointInPoly(pt, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Centroid (in viewBox space) of a region's largest ring — used to place the
  // linked-moment marker somewhere sensible inside multi-part regions.
  function largestPolyCentroid(polys) {
    if (!polys || !polys.length) return null;
    var best = null, bestArea = -1;
    for (var k = 0; k < polys.length; k++) {
      var poly = polys[k];
      var a = 0, cx = 0, cy = 0;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var cross = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
        a += cross;
        cx += (poly[j][0] + poly[i][0]) * cross;
        cy += (poly[j][1] + poly[i][1]) * cross;
      }
      var area = Math.abs(a / 2);
      if (area > bestArea && a !== 0) {
        bestArea = area;
        best = [cx / (3 * a), cy / (3 * a)];
      }
    }
    return best;
  }

  // ============================================================
  // Data loading
  // ============================================================
  function loadJSON(url) {
    // Prepend BASE for absolute paths so the same build works at a domain
    // root or under a sub-path.
    if (BASE && url.charAt(0) === "/") url = BASE + url;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + url);
      return r.json();
    });
  }

  function provinceKey(countryCode, provinceName) {
    if (countryCode === "CN") return CN_ADCODE[provinceName] || null;
    return provinceName.replace(/\s+/g, "_"); // JP/MY use English ADM1 name
  }

  // Reset region pan/zoom (called on every layer change so each map opens fitted).
  function resetView() { state.rv = { zoom: 1, panx: 0, pany: 0 }; }

  // Prefetch cache for region JSON so a second visit (and prefetched drills) are instant.
  var regionCache = {};
  function fetchRegion(url) {
    if (regionCache[url]) return Promise.resolve(regionCache[url]);
    return loadJSON(url).then(function (d) { regionCache[url] = d; return d; });
  }

  // ============================================================
  // Navigation between layers
  // ============================================================
  function goGlobe() {
    state.layer = "globe";
    state.country = null;
    state.province = null;
    state.regionData = null;
    state.hover = null;
    state.selected = null;
    setGlobeZoom(1);     // open the globe fitted
    resetView();
    updateChrome();
    startLoop();
    scrollToTop();
  }

  function goCountry(fp) {
    state.layer = "country";
    state.country = { code: fp.code, name: fp.name || fp.code };
    state.province = null;
    state.regionData = null;
    state.hover = null;
    state.selected = null;
    resetView();
    updateChrome();
    stopLoop();
    drawRegions();
    fetchRegion("/static/geo/regions/" + fp.code + ".json")
      .then(function (d) {
        state.regionData = d;
        drawRegions();
        prefetchDrills(fp.code, d);   // warm the cache for likely next taps
      })
      .catch(function () { renderError("该国家版图数据缺失"); });
    scrollToTop();
  }

  // Quietly pre-load the city JSON for every drillable province in the current
  // country, so the first drill-in feels instant (main fix for P1 slowness).
  function prefetchDrills(countryCode, data) {
    if (!data || !data.regions) return;
    data.regions.forEach(function (reg) {
      if (!reg.drill) return;
      var key = provinceKey(countryCode, reg.name);
      if (!key) return;
      var url = "/static/geo/regions/" + countryCode + "/" + key + ".json";
      if (!regionCache[url]) fetchRegion(url).catch(function () {});
    });
  }

  function goCity(reg) {
    if (!reg.drill) return;
    var key = provinceKey(state.country.code, reg.name);
    if (!key) return;
    state.layer = "city";
    state.province = { name: reg.name, key: key };
    state.regionData = null;
    state.hover = null;
    state.selected = null;
    resetView();
    updateChrome();
    drawRegions();
    fetchRegion("/static/geo/regions/" + state.country.code + "/" + key + ".json")
      .then(function (d) { state.regionData = d; drawRegions(); })
      .catch(function () { renderError("该地区城市数据缺失"); });
    scrollToTop();
  }

  function renderError(msg) {
    var size = SIZE;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = C.muted;
    ctx.font = "13px 'IBM Plex Mono', monospace";
    ctx.fillText(msg, CX - ctx.measureText(msg).width / 2, CY);
  }

  function scrollToTop() {
    var sec = document.getElementById("footprint");
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Breadcrumb + back button chrome.
  function updateChrome() {
    var bc = document.getElementById("globe-breadcrumb");
    var back = document.getElementById("globe-cd-up");
    var stats = document.getElementById("globe-stats");
    var parts = ['<a data-nav="globe">~/globe</a>'];
    if (state.country) parts.push('<a data-nav="country">' + esc(state.country.code) + "</a>");
    if (state.province) parts.push('<span>' + esc(state.province.name) + "</span>");
    if (bc) {
      bc.innerHTML = parts.join('<span class="sep">/</span>');
      bc.querySelectorAll("[data-nav]").forEach(function (a) {
        a.addEventListener("click", function () {
          if (a.getAttribute("data-nav") === "globe") goGlobe();
          else if (a.getAttribute("data-nav") === "country") goCountry(currentCountryFp());
        });
      });
    }
    if (back) {
      if (state.layer === "globe") {
        back.style.display = "none";
      } else {
        back.style.display = "inline-block";
        // Label the destination so it's obvious where "back" goes (P5).
        back.textContent = state.layer === "city"
          ? "← 返回 " + state.country.code
          : "← 返回地球";
      }
      back.onclick = function () {
        if (state.layer === "city") goCountry(currentCountryFp());
        else goGlobe();
      };
    }
    if (stats) {
      if (state.layer === "globe") {
        var nCountry = state.footprints.length;
        var nCity = 0;
        state.footprints.forEach(function (f) { f.provinces.forEach(function (p) { nCity += p.cities.length; }); });
        stats.textContent = nCountry ? "去过 " + nCountry + " 国 · " + nCity + " 城" : "";
      } else stats.textContent = "";
    }
    applyTouchAction();   // keep canvas gesture mode in sync with the layer (P4)
    updateMomentLinks();  // hide/refresh the linked-瞬间 list for this layer
  }
  function currentCountryFp() {
    return state.footprints.find(function (f) { return f.code === state.country.code; }) ||
      { code: state.country.code, name: state.country.name, provinces: [] };
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }

  // ============================================================
  // Animation loop (globe only)
  // ============================================================
  function startLoop() {
    if (state.raf) return;
    var step = function () {
      if (state.layer !== "globe") { state.raf = null; return; }
      if (!state.dragging) {
        state.rot.y += state.spin + state.vel.y;
        state.rot.x += state.vel.x;
        state.rot.x = Math.max(-1.2, Math.min(1.2, state.rot.x));
        state.vel.x *= 0.94; state.vel.y *= 0.94; // inertia decay
      }
      drawGlobe();
      state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }
  function stopLoop() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  }

  // Pause the loop when the globe scrolls out of view (PRD §5.2).
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (state.layer !== "globe") return;
        if (e.isIntersecting) startLoop(); else stopLoop();
      });
    }, { threshold: 0.05 });
    io.observe(canvas);
  }

  // ============================================================
  // Input: globe = drag-rotate; region = pinch-zoom + pan (P2/P3/P4/P5)
  // ============================================================
  function pointer(e) {
    var rect = canvas.getBoundingClientRect();
    var t = e.touches && e.touches.length ? e.touches[0]
          : e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function touchDist(e) {
    var a = e.touches[0], b = e.touches[1];
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function touchMid(e) {
    var rect = canvas.getBoundingClientRect();
    var a = e.touches[0], b = e.touches[1];
    return { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
  }

  // touch-action decides which gestures the browser keeps for itself. Globe:
  // none (we rotate). Region fitted (zoom≈1): pan-y, so a vertical swipe scrolls
  // the PAGE to other sections (P4). Region zoomed-in: none, so a one-finger
  // drag pans the magnified map instead of scrolling the page.
  function applyTouchAction() {
    canvas.style.touchAction =
      (state.layer !== "globe" && state.rv.zoom <= 1.01) ? "pan-y" : "none";
  }

  var MIN_ZOOM = 1, MAX_ZOOM = 6;
  var GLOBE_MIN = 1, GLOBE_MAX = 3;

  // Zoom the whole globe (magnify the sphere in place). Keeps the center fixed;
  // simplest sensible behavior for a rotating globe. Rebuilds R from RBASE.
  function setGlobeZoom(z) {
    z = Math.max(GLOBE_MIN, Math.min(GLOBE_MAX, z));
    state.gz = z;
    R = RBASE * z;
    if (state.layer === "globe" && !state.raf) drawGlobe();
  }

  // Zoom the region map to `z`, keeping the map point under (cx,cy) fixed.
  function setZoom(z, cx, cy) {
    var data = state.regionData;
    if (!data) return;
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    var T = regionTransform();
    var vx = (cx - T.ox) / T.scale, vy = (cy - T.oy) / T.scale;
    var size = SIZE, vw = data.view[0], vh = data.view[1], pad = 16;
    var base = Math.min((size - pad * 2) / vw, (size - pad * 2) / vh);
    var scale2 = base * z;
    state.rv.zoom = z;
    state.rv.panx = cx - vx * scale2 - (size - vw * scale2) / 2;
    state.rv.pany = cy - vy * scale2 - (size - vh * scale2) / 2;
    clampPan();
    applyTouchAction();
    drawRegions();
  }

  // Keep the map from being dragged completely off-screen.
  function clampPan() {
    if (state.rv.zoom <= 1.01) { state.rv.panx = 0; state.rv.pany = 0; return; }
    var data = state.regionData; if (!data) return;
    var size = SIZE, vw = data.view[0], vh = data.view[1], pad = 16;
    var base = Math.min((size - pad * 2) / vw, (size - pad * 2) / vh), scale = base * state.rv.zoom;
    var limX = Math.max(0, (vw * scale - (size - pad * 2)) / 2) + size * 0.12;
    var limY = Math.max(0, (vh * scale - (size - pad * 2)) / 2) + size * 0.12;
    state.rv.panx = Math.max(-limX, Math.min(limX, state.rv.panx));
    state.rv.pany = Math.max(-limY, Math.min(limY, state.rv.pany));
  }

  var downPt = null, moved = false, panLast = null, pinch = null, mvPt = null;

  function onDown(e) {
    if (e.touches && e.touches.length === 2) {
      // Two fingers: pinch-zoom. On the globe we scale the sphere; on region
      // maps we zoom+pan (handled in onMove by the layer check).
      pinch = { dist: touchDist(e), mid: touchMid(e) };
      state.dragging = false;
      moved = true;               // a pinch is never a tap
      return;
    }
    downPt = pointer(e);
    mvPt = downPt;
    moved = false;
    if (state.layer === "globe") {
      state.dragging = true;
      state.lastPt = downPt;
      state.vel = { x: 0, y: 0 };
    } else {
      panLast = downPt;           // may become a pan if zoomed in
    }
  }

  function onMove(e) {
    // Two-finger pinch.
    if (pinch && e.touches && e.touches.length === 2) {
      var d = touchDist(e), mid = touchMid(e);
      if (state.layer === "globe") {
        // Scale the whole sphere. Multiply the CURRENT zoom by the per-frame
        // distance ratio so it accumulates (pinch.dist is refreshed each frame).
        if (pinch.dist > 0) setGlobeZoom(state.gz * (d / pinch.dist));
      } else {
        // Region map: zoom toward the pinch midpoint, plus two-finger pan.
        if (pinch.dist > 0) setZoom(state.rv.zoom * (d / pinch.dist), mid.x, mid.y);
        state.rv.panx += mid.x - pinch.mid.x;
        state.rv.pany += mid.y - pinch.mid.y;
        clampPan();
        drawRegions();
      }
      pinch.dist = d; pinch.mid = mid;
      moved = true;
      if (e.cancelable) e.preventDefault();
      return;
    }
    var p = pointer(e);
    mvPt = p;
    if (downPt && (Math.abs(p.x - downPt.x) > 4 || Math.abs(p.y - downPt.y) > 4)) moved = true;
    if (state.layer === "globe" && state.dragging && state.lastPt) {
      var dx = p.x - state.lastPt.x, dy = p.y - state.lastPt.y;
      state.rot.y -= dx * 0.006;                 // P2: inverted → globe follows finger
      state.rot.x += dy * 0.006;
      state.rot.x = Math.max(-1.2, Math.min(1.2, state.rot.x));
      state.vel = { x: dy * 0.0009, y: -dx * 0.0009 };
      state.lastPt = p;
      if (e.cancelable) e.preventDefault();
    } else if (state.layer !== "globe") {
      if (state.rv.zoom > 1.01 && panLast) {     // pan the magnified map
        state.rv.panx += p.x - panLast.x;
        state.rv.pany += p.y - panLast.y;
        clampPan();
        panLast = p;
        if (e.cancelable) e.preventDefault();
        drawRegions();
      } else if (!e.touches) {                   // desktop hover highlight only
        var reg = pickRegion(p.x, p.y);
        var name = reg ? reg.name : null;
        if (name !== state.hover) {
          state.hover = name;
          var linkable = reg && ((reg.drill && state.layer === "country") ||
            ((state.layer === "city" || state.layer === "country") && regionMomentIds(name).length));
          canvas.style.cursor = linkable ? "pointer" : "default";
          drawRegions();   // hover highlight; the 瞬间 list is pinned by click, not hover
        }
      }
    }
  }

  function onUp(e) {
    // End of a pinch.
    if (pinch && (!e.touches || e.touches.length < 2)) {
      pinch = null;
      if (state.layer === "globe") {
        if (state.gz <= 1.01) setGlobeZoom(1);   // snap back to fit
      } else if (state.rv.zoom <= 1.01) {
        resetView(); applyTouchAction(); drawRegions();
      }
      downPt = null; panLast = null;
      return;
    }
    state.dragging = false;
    panLast = null;
    // P5: horizontal swipe on a fitted region map goes back one level.
    if (state.layer !== "globe" && state.rv.zoom <= 1.01 && downPt && mvPt) {
      var sdx = mvPt.x - downPt.x, sdy = mvPt.y - downPt.y;
      if (Math.abs(sdx) > 55 && Math.abs(sdx) > Math.abs(sdy) * 1.8) {
        downPt = null;
        goBack();
        return;
      }
    }
    if (moved) { downPt = null; return; }
    // Only a press that STARTED on the canvas counts as a tap. onDown is bound to
    // the canvas, but onUp is on window — so a click on the 瞬间 links below the
    // globe also lands here with downPt=null; bail so we don't clear the pinned
    // selection (which would detach the link before its own click handler runs).
    if (!downPt) return;
    var p = downPt;
    downPt = null;
    if (state.layer === "globe") {
      var fp = pickCountry(p.x, p.y);
      if (fp) goCountry(fp);
    } else if (state.layer === "country") {
      var reg2 = pickRegion(p.x, p.y);
      if (reg2 && reg2.drill) { goCity(reg2); return; }
      // Non-drillable province: pin it. If it has linked moments, the 瞬间 list
      // shows below the globe (no auto-jump); clicking empty space clears it.
      state.selected = reg2 ? reg2.name : null;
      drawRegions();
      updateMomentLinks();
    } else if (state.layer === "city") {
      var creg = pickRegion(p.x, p.y);
      // A tap PINS the city; its linked 瞬间 show as a clickable list below the
      // globe. The user then picks which moment to open (their explicit request
      // — no immediate jump). Tapping empty space clears the selection.
      state.selected = creg ? creg.name : null;
      drawRegions();
      updateMomentLinks();
    }
  }

  // Go up exactly one level (city → country → globe).
  function goBack() {
    if (state.layer === "city") goCountry(currentCountryFp());
    else if (state.layer === "country") goGlobe();
  }

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", function (e) { if (state.dragging || state.layer !== "globe") onMove(e); });
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("touchstart", onDown, { passive: true });
  canvas.addEventListener("touchmove", onMove, { passive: false });
  canvas.addEventListener("touchend", onUp);
  canvas.addEventListener("touchcancel", onUp);

  // Desktop: wheel to zoom (globe or region maps), double-click to reset zoom.
  canvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (state.layer === "globe") {
      setGlobeZoom(state.gz * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
      return;
    }
    var rect = canvas.getBoundingClientRect();
    setZoom(state.rv.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  canvas.addEventListener("dblclick", function () {
    if (state.layer === "globe") { if (state.gz > 1.01) setGlobeZoom(1); return; }
    if (state.rv.zoom > 1.01) { resetView(); applyTouchAction(); drawRegions(); }
  });

  // ============================================================
  // Boot
  // ============================================================
  window.addEventListener("resize", function () {
    resize();
    if (state.layer === "globe") drawGlobe(); else drawRegions();
  });

  resize();
  Promise.all([
    loadJSON("/static/geo/world.json"),
    loadJSON("/api/footprints").catch(function () { return []; }),
  ]).then(function (res) {
    world = res[0];
    state.footprints = res[1] || [];
    updateChrome();
    startLoop();
  }).catch(function (err) {
    renderError("地球数据加载失败");
    console.error(err);
  });
})();
