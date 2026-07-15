// Render a static SVG preview of the globe (layer 1) using the same projection
// as globe.js — a visual sanity check that doesn't need a browser.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const w = JSON.parse(readFileSync(join(ROOT, "web/static/geo/world.json"), "utf8"));

const SIZE = 440, R = SIZE * 0.42, CX = SIZE / 2, CY = SIZE / 2;
const rotX = -0.35, rotY = 1.9; // tilt + spin so Asia faces the viewer

function proj(lon, lat) {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  const x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
  const cx = Math.cos(rotX), sx = Math.sin(rotX);
  const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
  return { x: CX + x1 * R, y: CY - y2 * R, visible: z2 > 0 };
}

function ringPath(ring) {
  const segs = [];
  let cur = "";
  for (const [lon, lat] of ring) {
    const p = proj(lon, lat);
    if (!p.visible) { if (cur) { segs.push(cur); cur = ""; } continue; }
    cur += (cur ? " L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1);
  }
  if (cur) segs.push(cur);
  return segs.join(" ");
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`;
svg += `<rect width="${SIZE}" height="${SIZE}" fill="#0a0e0a"/>`;
svg += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="#0b2416" stroke="#4ade80" stroke-opacity="0.5" stroke-width="1.5"/>`;
svg += `<clipPath id="s"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath><g clip-path="url(#s)">`;
for (const ring of w.land) svg += `<path d="${ringPath(ring)}" fill="#123a24" stroke="#1f5c3a" stroke-width="0.6"/>`;
for (const ring of w.borders) svg += `<path d="${ringPath(ring)}" fill="none" stroke="#2a6b45" stroke-width="0.4"/>`;
svg += `</g>`;
for (const code of ["CN", "JP", "MY", "SG"]) {
  const m = w.countries[code]; if (!m) continue;
  const p = proj(m.c[0], m.c[1]); if (!p.visible) continue;
  svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#fbbf24"/>`;
  svg += `<text x="${(p.x + 7).toFixed(1)}" y="${(p.y + 3).toFixed(1)}" fill="#fbbf24" font-size="11" font-family="monospace">${code}</text>`;
}
svg += `</svg>`;
writeFileSync(join(ROOT, "scripts/globe_preview.svg"), svg);
console.log("wrote scripts/globe_preview.svg (" + (svg.length / 1024).toFixed(1) + " KB)");
