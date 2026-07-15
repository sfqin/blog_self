// Render a static SVG preview of a country/city drill map (layers 2/3).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || "regions/CN.json";
const visited = (process.argv[3] || "湖南省,北京市").split(",");
const d = JSON.parse(readFileSync(join(ROOT, "web/static/geo", file), "utf8"));

const SIZE = 440, pad = 16;
const [vw, vh] = d.view;
const scale = Math.min((SIZE - pad * 2) / vw, (SIZE - pad * 2) / vh);
const ox = (SIZE - vw * scale) / 2, oy = (SIZE - vh * scale) / 2;
const tx = (x) => (ox + x * scale).toFixed(1);
const ty = (y) => (oy + y * scale).toFixed(1);
const vset = new Set(visited);

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`;
svg += `<rect width="${SIZE}" height="${SIZE}" fill="#0a0e0a"/>`;
for (const reg of d.regions) {
  const isV = vset.has(reg.name);
  const fill = isV ? "rgba(74,222,128,0.42)" : (reg.drill ? "rgba(251,191,36,0.16)" : "rgba(30,60,40,0.55)");
  const line = isV ? "#4ade80" : (reg.drill ? "#fbbf24" : "#2a6b45");
  for (const poly of reg.polys) {
    let dstr = "";
    poly.forEach((pt, i) => { dstr += (i ? " L" : "M") + tx(pt[0]) + " " + ty(pt[1]); });
    dstr += " Z";
    svg += `<path d="${dstr}" fill="${fill}" stroke="${line}" stroke-width="${reg.drill || isV ? 1.1 : 0.6}"/>`;
  }
}
svg += `</svg>`;
const out = "scripts/region_preview.svg";
writeFileSync(join(ROOT, out), svg);
console.log("wrote " + out + " (" + (svg.length / 1024).toFixed(1) + " KB) regions=" + d.regions.length);
