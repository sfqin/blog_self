#!/usr/bin/env node
// WCAG contrast check for the two reading modes in web/static/css/reading.css.
// Body text on the reading panel must reach night >= 13:1 and paper >= 10:1;
// headings the same; quotes, code and muted meta text must stay >= 4.5:1 and the
// accent (rules, list markers, link underlines: non-text UI) >= 3:1.
// Usage: node scripts/contrast_check.mjs   (exit 1 when any pair fails)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../web/static/css/reading.css"), "utf8");

function block(mode) {
  const m = css.match(new RegExp(`html\\[data-reading="${mode}"\\]\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no html[data-reading="${mode}"] block in reading.css`);
  const vars = {};
  for (const [, k, v] of m[1].matchAll(/--read-([\w-]+)\s*:\s*([^;]+);/g)) vars[k] = v.trim();
  return vars;
}

function rgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const MIN = { night: 13, paper: 10 };
let failed = 0;
for (const mode of ["night", "paper"]) {
  const v = block(mode);
  const pairs = [
    ["text", "panel", MIN[mode]],
    ["heading", "panel", MIN[mode]],
    ["accent", "panel", 3],
    ["quote", "panel", 4.5],
    ["code", "code-bg", 4.5],
    ["muted", "panel", 4.5],
  ];
  for (const [fg, bg, min] of pairs) {
    const r = ratio(v[fg], v[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${mode.padEnd(5)} --read-${fg} on --read-${bg}: ${r.toFixed(2)}:1 (min ${min})`);
  }
}
if (failed) {
  console.error(`${failed} contrast pair(s) below threshold`);
  process.exit(1);
}
