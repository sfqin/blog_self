// Regression: loading a deep link or interacting before the map response must
// not start drawing against null data or leave the animation loop stalled.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE || "http://127.0.0.1:8199").replace(/\/$/, "");
const executablePath = [process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean).find(existsSync);
if (!executablePath) throw new Error("Chrome not found; set CHROME_BIN");
const browser = await puppeteer.launch({ executablePath, headless: "new" });
let failures = 0;

try {
  for (const scenario of ["slow-world", "slow-footprints", "failed-world", "failed-footprints"]) {
    const page = await browser.newPage();
    const errors = [];
    let held;
    let requested;
    const pending = new Promise(resolve => { requested = resolve; });
    const path = scenario.endsWith("footprints") ? "/api/footprints" : "/static/geo/world.json";
    const url = new URL(BASE + path).href;
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewport({ width: 1000, height: 900 });
    await page.evaluateOnNewDocument(() => {
      window.__GLOBE_TEST__ = true;
      // This suite exercises boot, not background prefetching.
      window.requestIdleCallback = () => 1;
    });
    await page.setRequestInterception(true);
    page.on("request", request => {
      if (request.url().split("?")[0] === url) {
        held = request;
        requested();
      } else request.continue();
    });
    try {
      await page.goto(BASE + "/#footprint", { waitUntil: "domcontentloaded" });
      await pending;
      await page.waitForFunction(() => !!window.__globeDebug);
      await page.evaluate(async () => {
        document.getElementById("footprint").scrollIntoView({ behavior: "instant" });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const box = await page.$eval("#globe-canvas", el => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.move(box.x, box.y);
      await page.mouse.wheel({ deltaY: -100 });
      await page.mouse.click(box.x, box.y);
      const before = errors.slice();
      if (scenario.startsWith("failed-")) {
        await held.respond({ status: 429, contentType: "text/plain", body: "Too Many Requests" });
        held = null;
        await page.waitForFunction(() => {
          const status = document.getElementById("globe-load-status");
          return status && !status.hidden && status.textContent.includes("失败");
        }, { timeout: 5000 });
      } else {
        await held.continue();
        held = null;
        await page.waitForFunction(() => window.__globeDebug.ready());
        assert.ok(await page.evaluate(() => window.__globeDebug.countryPoint("CN")), "China faces the initial view");
        const rotation = await page.evaluate(() => window.__globeDebug.state().rot.y);
        await page.waitForFunction(previous => window.__globeDebug.state().rot.y !== previous, { timeout: 3000 }, rotation);
        await page.evaluate(() => window.__globeDebug.focusCountry("CN"));
        assert.ok(await page.evaluate(() => window.__globeDebug.countryPoint("CN")), "footprints render after loading");
      }
      assert.deepEqual(before, [], "loading must not draw null map data");
      assert.deepEqual(errors, [], "no uncaught error after response");
      console.log("PASS " + scenario);
    } catch (error) {
      failures++;
      console.error("FAIL " + scenario + ": " + error.message, errors);
    } finally {
      await page.close();
    }
  }
} finally { await browser.close(); }
process.exitCode = failures ? 1 : 0;
