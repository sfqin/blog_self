// Local-only puppeteer smoke test for the globe. Its lone dependency
// (puppeteer-core) lives in this scripts/ dir — run `npm install` HERE first:
//   cd scripts && npm install && node globe_test.mjs
// (package.json is kept out of the repo root so Cloudflare/EdgeOne Pages treat
//  the project as a pure static site and skip npm install; see DEPLOY.md.)
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const CHROME = "/Users/bytedance/.cache/puppeteer/chrome/mac_arm-121.0.6167.85/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.env.BASE || "http://localhost:8199";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  "--remote-debugging-port=9224", "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let ws = null;
await new Promise((resolve) => {
  const onData = (buf) => {
    const s = buf.toString();
    const m = s.match(/ws:\/\/127\.0\.0\.1:9224\/devtools\/browser\/[a-z0-9-]+/);
    if (m && !ws) { ws = m[0]; resolve(); }
  };
  proc.stderr.on("data", onData);
  proc.stdout.on("data", onData);
  setTimeout(resolve, 5000);
});
console.log("ws endpoint:", ws);
if (!ws) { proc.kill(); process.exit(2); }

const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: { width: 1000, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(BASE + "/", { waitUntil: "networkidle2" });
await sleep(1400);

const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById("globe-canvas");
  if (!c) return { ok: false };
  const ctx = c.getContext("2d");
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let nonBlack = 0, amber = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r + g + b > 20) nonBlack++;
    if (r > 210 && g > 150 && g < 215 && b < 90) amber++;
  }
  return { ok: true, w: c.width, h: c.height, nonBlack, amber };
});
console.log("globe canvas:", JSON.stringify(canvasInfo));

const chrome = await page.evaluate(() => ({
  bc: document.getElementById("globe-breadcrumb")?.textContent,
  stats: document.getElementById("globe-stats")?.textContent,
}));
console.log("chrome:", JSON.stringify(chrome));

// Find an amber marker pixel and click it to drill into a country.
const marker = await page.evaluate(() => {
  const c = document.getElementById("globe-canvas");
  const ctx = c.getContext("2d");
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const dpr = window.devicePixelRatio || 1;
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      const i = (y * c.width + x) * 4;
      const r = img[i], g = img[i + 1], b = img[i + 2];
      if (r > 215 && g > 155 && g < 215 && b < 85) return { x: x / dpr, y: y / dpr };
    }
  }
  return null;
});
console.log("marker:", JSON.stringify(marker));

let afterCountry = null, regionPixels = 0, afterCity = null;
if (marker) {
  const rect = await page.evaluate(() => {
    const r = document.getElementById("globe-canvas").getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  await page.mouse.click(rect.x + marker.x, rect.y + marker.y);
  await sleep(1000);
  afterCountry = await page.evaluate(() => document.getElementById("globe-breadcrumb")?.textContent);
  regionPixels = await page.evaluate(() => {
    const c = document.getElementById("globe-canvas");
    const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 20) n++;
    return n;
  });

  // Try clicking a drillable (amber-outlined) region to reach city layer.
  const drillPt = await page.evaluate(() => {
    const c = document.getElementById("globe-canvas");
    const ctx = c.getContext("2d");
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const dpr = window.devicePixelRatio || 1;
    // amber fill of drillable regions is rgba(251,191,36,0.16) over dark bg -> pick amber-tinted pixel
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        const r = img[i], g = img[i + 1], b = img[i + 2];
        if (r > 90 && r < 210 && g > 70 && b < 70 && r > b + 40) return { x: x / dpr, y: y / dpr };
      }
    }
    return null;
  });
  if (drillPt) {
    await page.mouse.click(rect.x + drillPt.x, rect.y + drillPt.y);
    await sleep(1000);
    afterCity = await page.evaluate(() => document.getElementById("globe-breadcrumb")?.textContent);
  }
}
console.log("after country click breadcrumb:", JSON.stringify(afterCountry));
console.log("country region pixels:", regionPixels);
console.log("after city click breadcrumb:", JSON.stringify(afterCity));
console.log("JS errors:", errors.length ? JSON.stringify(errors) : "none");

await browser.disconnect();
proc.kill();

const fail = !canvasInfo.ok || canvasInfo.nonBlack < 500 || canvasInfo.amber < 3 || errors.length > 0;
process.exit(fail ? 1 : 0);
