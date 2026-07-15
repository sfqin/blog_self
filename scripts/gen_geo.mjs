// gen_geo.mjs — build-time geographic data generator (run: node scripts/gen_geo.mjs)
//
// Fetches public-domain / open geodata, simplifies with Douglas-Peucker, projects
// admin maps to a normalized viewBox, and writes compact JSON into web/static/geo/.
// Output is committed so the running server needs ZERO network (PRD §5.5).
//
// Sources:
//   - World land + country boundaries: Natural Earth 110m (public domain)
//   - China provinces/cities: DataV aliyun (adcode-based, has parent hierarchy)
//   - Japan / Malaysia / Singapore ADM1 (+ ADM2 where clean): geoBoundaries gbOpen
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "web", "static", "geo");

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "dev-home-blog/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function write(rel, obj) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj));
  console.log(`  wrote ${rel} (${(JSON.stringify(obj).length / 1024).toFixed(1)} KB)`);
}

// --- Douglas-Peucker simplification on [x,y] point arrays ---
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
function dpLine(points, eps) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = dpLine(points.slice(0, idx + 1), eps);
    const right = dpLine(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

// simplify handles closed rings: plain Douglas-Peucker degenerates when the
// first and last vertices coincide (every perpendicular distance is 0). Split
// the ring at its farthest vertex from the start and simplify each half.
function simplify(points, eps) {
  const n = points.length;
  const closed = n > 2 &&
    Math.abs(points[0][0] - points[n - 1][0]) < 1e-9 &&
    Math.abs(points[0][1] - points[n - 1][1]) < 1e-9;
  if (!closed) return dpLine(points, eps);

  const open = points.slice(0, -1); // drop duplicate closing vertex
  if (open.length < 4) return points;
  // Farthest vertex from the anchor becomes the split point.
  let far = 1, farD = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const half1 = dpLine(open.slice(0, far + 1), eps);
  const half2 = dpLine(open.slice(far).concat([open[0]]), eps);
  const ring = half1.slice(0, -1).concat(half2);
  // If the ring collapses below a triangle it is smaller than our detail
  // threshold; return the collapsed ring (callers drop rings with < 3 points)
  // rather than the full-resolution original.
  return ring;
}
function round(pts, dp = 2) {
  const f = 10 ** dp;
  return pts.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}

// --- geometry helpers ---
// Flatten a GeoJSON geometry into an array of rings (each ring = [[lon,lat],...]).
function geomRings(geom) {
  if (!geom) return [];
  const rings = [];
  const push = (poly) => { for (const ring of poly) rings.push(ring); };
  if (geom.type === "Polygon") push(geom.coordinates);
  else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates) push(poly);
  return rings;
}
function ringCentroid(ring) {
  let x = 0, y = 0, a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross; x += (x0 + x1) * cross; y += (y0 + y1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    // fallback: average of vertices
    let sx = 0, sy = 0;
    for (const [px, py] of ring) { sx += px; sy += py; }
    return [sx / ring.length, sy / ring.length];
  }
  return [x / (6 * a), y / (6 * a)];
}
function largestRing(rings) {
  let best = rings[0], bestA = -1;
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    a = Math.abs(a);
    if (a > bestA) { bestA = a; best = r; }
  }
  return best;
}
// Signed-area magnitude of a ring, used to drop negligible islands/slivers.
function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a) / 2;
}
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// --- equirectangular projection of lon/lat regions into a normalized viewBox ---
const VIEW = 1000;
function projectRegions(features, eps) {
  // Compute bounds.
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const f of features) for (const ring of f.rings) for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  const lat0 = ((minLat + maxLat) / 2) * Math.PI / 180;
  const kx = Math.cos(lat0); // latitude cosine correction
  const w = (maxLon - minLon) * kx, h = maxLat - minLat;
  const scale = (VIEW - 40) / Math.max(w, h);
  const offX = (VIEW - w * scale) / 2, offY = (VIEW - h * scale) / 2;
  const viewW = Math.round(w * scale + 40), viewH = Math.round(h * scale + 40);
  const proj = ([lon, lat]) => [
    (lon - minLon) * kx * scale + offX,
    (maxLat - lat) * scale + offY, // flip Y for screen
  ];
  const out = features.map((f) => {
    let polys = f.rings
      .map((ring) => round(simplify(ring.map(proj), eps)))
      .filter((r) => r.length >= 3);
    // Drop tiny slivers/islands (< minArea viewBox units^2) but always keep the
    // largest ring so no region ever vanishes entirely.
    if (polys.length > 1) {
      const areas = polys.map(ringArea);
      const maxA = Math.max(...areas);
      polys = polys.filter((_, i) => areas[i] === maxA || areas[i] >= 6);
    }
    return { name: f.name, key: f.key, drill: !!f.drill, polys };
  });
  return { view: [viewW, viewH], regions: out };
}

// ============ World globe (layer 1) ============
async function buildWorld() {
  console.log("world (Natural Earth 110m)…");
  const land = await fetchJSON("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson");
  const countries = await fetchJSON("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson");

  const landRings = [];
  for (const f of land.features) for (const ring of geomRings(f.geometry)) {
    const s = round(simplify(ring, 0.5), 1);
    if (s.length >= 3) landRings.push(s);
  }
  const borders = [];
  const centroids = {};
  for (const f of countries.features) {
    const p = f.properties || {};
    const code = p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : (p.ISO_A2_EH || "");
    const rings = geomRings(f.geometry);
    for (const ring of rings) {
      const s = round(simplify(ring, 0.6), 1);
      if (s.length >= 3) borders.push(s);
    }
    if (code) {
      const big = largestRing(rings);
      centroids[code] = { name: p.NAME || p.ADMIN || code, c: round([ringCentroid(big)], 2)[0] };
    }
  }
  // Manual centroids for target countries too small / mislabeled at 110m scale.
  const manual = {
    SG: { name: "Singapore", c: [103.82, 1.35] },
  };
  for (const [k, v] of Object.entries(manual)) if (!centroids[k]) centroids[k] = v;
  write("world.json", { land: landRings, borders, countries: centroids });
}

// ============ China (DataV, full drill) ============
const CN_DRILL = {
  "110000": "北京市", "430000": "湖南省", "440000": "广东省",
  "330000": "浙江省", "510000": "四川省", "320000": "江苏省",
};
async function buildChina() {
  console.log("China (DataV)…");
  const prov = await fetchJSON("https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json");
  const drillCodes = new Set(Object.keys(CN_DRILL));
  const features = prov.features.map((f) => {
    const code = String(f.properties.adcode);
    return { name: f.properties.name, key: code, drill: drillCodes.has(code), rings: geomRings(f.geometry) };
  });
  write("regions/CN.json", { code: "CN", name: "中国", ...projectRegions(features, 1.6) });

  // City drill files for each supported province.
  for (const [code, name] of Object.entries(CN_DRILL)) {
    const data = await fetchJSON(`https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`);
    const cityFeatures = data.features
      .filter((f) => String(f.properties.adcode) !== code) // drop the province outline itself
      .map((f) => ({ name: f.properties.name, key: String(f.properties.adcode), rings: geomRings(f.geometry) }));
    const projected = projectRegions(cityFeatures, 1.0);
    write(`regions/CN/${code}.json`, { name, ...projected });
  }
}

// ============ geoBoundaries countries (ADM1 + optional ADM2 via point-in-polygon) ============
async function gbGeoJSON(iso, adm) {
  const meta = await fetchJSON(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`);
  return fetchJSON(meta.gjDownloadURL);
}

// Build an ADM1 country map; mark listed provinces drillable and, when adm2 given,
// assign each ADM2 unit to its parent ADM1 by centroid point-in-polygon and emit city files.
async function buildGB(iso, code, name, drillNames, provKey) {
  console.log(`${name} (geoBoundaries ${iso})…`);
  const adm1 = await gbGeoJSON(iso, "ADM1");
  // Match drill targets by case-insensitive substring so "Osaka" matches
  // "Osaka Prefecture", "Tokyo" matches "Tokyo", etc.
  const isDrill = (nm) => drillNames.some((d) => nm.toLowerCase().includes(d.toLowerCase()));
  const adm1Features = adm1.features.map((f) => {
    const nm = f.properties.shapeName;
    return { name: nm, key: nm, drill: isDrill(nm), rings: geomRings(f.geometry) };
  });
  write(`regions/${code}.json`, { code, name, ...projectRegions(adm1Features, 1.4) });

  if (!drillNames.length) return;
  let adm2;
  try { adm2 = await gbGeoJSON(iso, "ADM2"); }
  catch (e) { console.log(`  (no ADM2 for ${iso}: ${e.message})`); return; }

  // Parent rings for each drillable ADM1 (largest ring).
  const parents = adm1Features
    .filter((f) => f.drill)
    .map((f) => ({ name: f.name, ring: largestRing(f.rings) }));

  const byParent = new Map(parents.map((p) => [p.name, []]));
  for (const f of adm2.features) {
    const rings = geomRings(f.geometry);
    if (!rings.length) continue;
    const c = ringCentroid(largestRing(rings));
    for (const p of parents) {
      if (pointInRing(c, p.ring)) {
        byParent.get(p.name).push({ name: f.properties.shapeName, key: f.properties.shapeName, rings });
        break;
      }
    }
  }
  for (const [pname, cities] of byParent) {
    if (!cities.length) { console.log(`  (no ADM2 matched ${pname})`); continue; }
    write(`regions/${code}/${provKey(pname)}.json`, { name: pname, ...projectRegions(cities, 0.8) });
  }
}

async function main() {
  await buildWorld();
  await buildChina();
  // Japan: drillable Tokyo / Osaka (PRD §5.3).
  await buildGB("JPN", "JP", "日本", ["Tokyo", "Osaka"], (n) => n.replace(/\s+/g, "_"));
  // Malaysia: drillable Selangor / Sabah.
  await buildGB("MYS", "MY", "马来西亚", ["Selangor", "Sabah"], (n) => n.replace(/\s+/g, "_"));
  // Singapore: whole country (planning areas as ADM1/ADM2); no deeper drill.
  await buildGB("SGP", "SG", "新加坡", [], (n) => n);
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
