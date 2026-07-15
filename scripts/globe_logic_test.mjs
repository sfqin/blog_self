// Pure-logic tests for the globe's geometry against the real generated geo data.
// Runs in Node (no browser) to validate projection, culling, and hit-testing.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GEO = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "static", "geo");
const load = (p) => JSON.parse(readFileSync(join(GEO, p), "utf8"));
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS" : "FAIL") + " " + msg); if (!cond) failures++; };

// --- replicate globe.js projection ---
function makeProject(rotX, rotY, R, CX, CY) {
  return (lon, lat) => {
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
    const cy = Math.cos(rotY), sy = Math.sin(rotY);
    const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    const cx = Math.cos(rotX), sx = Math.sin(rotX);
    const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
    return { x: CX + x1 * R, y: CY - y2 * R, visible: z2 > 0 };
  };
}

// 1. Projection maps the sub-viewer point to the sphere center-ish and is on-screen.
{
  const R = 185, CX = 220, CY = 220;
  const proj = makeProject(0, 0, R, CX, CY);
  const front = proj(0, 0); // lon0/lat0 faces viewer at rot 0
  ok(front.visible === true, "projection: equator/prime-meridian faces viewer");
  ok(Math.abs(front.x - CX) < 1 && Math.abs(front.y - CY) < 1, "projection: sub-viewer point maps to center");
  const back = proj(180, 0); // opposite side
  ok(back.visible === false, "projection: antipode is back-face culled");
  // all projected points stay within the sphere disc
  let outside = 0;
  for (let lon = -180; lon <= 180; lon += 10) for (let lat = -80; lat <= 80; lat += 10) {
    const p = proj(lon, lat);
    if (p.visible && Math.hypot(p.x - CX, p.y - CY) > R + 0.5) outside++;
  }
  ok(outside === 0, "projection: visible points stay within sphere radius");
}

// 2. World data integrity.
{
  const w = load("world.json");
  ok(w.land.length > 50, `world: ${w.land.length} land rings`);
  ok(w.borders.length > 100, `world: ${w.borders.length} border rings`);
  ["CN", "JP", "MY", "SG"].forEach((c) => {
    ok(w.countries[c] && Array.isArray(w.countries[c].c), `world: centroid for ${c}`);
  });
}

// 3. Region files exist and are well-formed for every target + drill combo.
{
  const targets = { CN: "中国", JP: "日本", MY: "马来西亚", SG: "新加坡" };
  for (const [code, name] of Object.entries(targets)) {
    const d = load(`regions/${code}.json`);
    ok(d.regions.length > 0 && Array.isArray(d.view), `${code}: ${d.regions.length} ADM1 regions`);
    const drillable = d.regions.filter((r) => r.drill);
    if (code === "SG") ok(drillable.length === 0, "SG: no drill (city-level whole country)");
    else ok(drillable.length > 0, `${code}: has drillable provinces (${drillable.map((r) => r.name).join(",")})`);
    // Every polygon has >= 3 points.
    let bad = 0;
    d.regions.forEach((r) => r.polys.forEach((p) => { if (p.length < 3) bad++; }));
    ok(bad === 0, `${code}: all polygons valid (>=3 pts)`);
  }
}

// 4. Province-key mapping (globe.js) resolves to real city files on disk.
{
  const CN_ADCODE = { "北京市": "110000", "湖南省": "430000", "广东省": "440000", "浙江省": "330000", "四川省": "510000", "江苏省": "320000" };
  for (const [prov, code] of Object.entries(CN_ADCODE)) {
    ok(existsSync(join(GEO, `regions/CN/${code}.json`)), `CN drill file exists for ${prov} -> ${code}.json`);
  }
  // JP drill uses ADM1 English name with spaces -> underscores
  const jp = load("regions/JP.json");
  jp.regions.filter((r) => r.drill).forEach((r) => {
    const key = r.name.replace(/\s+/g, "_");
    ok(existsSync(join(GEO, `regions/JP/${key}.json`)), `JP drill file exists for ${r.name} -> ${key}.json`);
  });
  const my = load("regions/MY.json");
  my.regions.filter((r) => r.drill).forEach((r) => {
    const key = r.name.replace(/\s+/g, "_");
    ok(existsSync(join(GEO, `regions/MY/${key}.json`)), `MY drill file exists for ${r.name} -> ${key}.json`);
  });
}

// 5. point-in-polygon (region hit-test) on a known city polygon.
{
  function pip(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const hunan = load("regions/CN/430000.json");
  const reg = hunan.regions[0];
  // centroid of first polygon should be inside it (convex-ish assumption may fail; test bbox center fallback)
  const poly = reg.polys[0];
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  poly.forEach(([x, y]) => { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); });
  // sample many interior points; at least some must be inside
  let hits = 0, tries = 0;
  for (let gx = 0.2; gx < 1; gx += 0.2) for (let gy = 0.2; gy < 1; gy += 0.2) {
    tries++;
    if (pip([minx + (maxx - minx) * gx, miny + (maxy - miny) * gy], poly)) hits++;
  }
  ok(hits > 0, `point-in-polygon: ${hits}/${tries} interior samples hit ${reg.name}`);
}

console.log(failures === 0 ? "\nALL GLOBE LOGIC TESTS PASSED" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
