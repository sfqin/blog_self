import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:8199";
const executablePath = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Users/bytedance/.cache/puppeteer/chrome/mac_arm-121.0.6167.85/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
].filter(Boolean).find(existsSync);
if (!executablePath) throw new Error("Chrome not found; set CHROME_BIN");

const TEST_FOOTPRINTS = [{
  code: "CN",
  name: "中国",
  provinces: [{
    name: "广东省",
    cities: [
      { name: "深圳市", note: "第一次到深圳", momentIds: [9, 10] },
      { name: "深圳市", note: "第二次到深圳", momentIds: [10, 11] },
      { name: "广州市", note: "", momentIds: [12] },
    ],
  }],
}];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(50);
  }
  throw new Error(message);
}

async function canvasPoint(page, kind, key) {
  return page.evaluate(({ kind, key }) => {
    const canvas = document.getElementById("globe-canvas");
    const rect = canvas.getBoundingClientRect();
    const point = kind === "country"
      ? window.__globeDebug.countryPoint(key)
      : window.__globeDebug.regionPoint(key);
    return point ? { x: rect.left + point.x, y: rect.top + point.y } : null;
  }, { kind, key });
}

async function doubleTap(page, point) {
  await page.mouse.click(point.x, point.y);
  await sleep(80);
  await page.mouse.click(point.x, point.y);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1000, height: 900 },
});
const errors = [];
const requests = [];

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push("pageerror: " + error.message));

  await page.evaluateOnNewDocument(() => {
    window.__GLOBE_TEST__ = true;
    window.__globeIdleCallbacks = [];
    window.requestIdleCallback = (callback) => {
      window.__globeIdleCallbacks.push(callback);
      return window.__globeIdleCallbacks.length;
    };
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/footprints") {
      request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TEST_FOOTPRINTS),
      });
      return;
    }
    if (url.pathname === "/favicon.ico") {
      request.respond({ status: 204 });
      return;
    }
    if (url.pathname.startsWith("/static/geo/")) requests.push(url.pathname);
    request.continue();
  });

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    window.__globeDebug?.ready() && window.__globeIdleCallbacks.length > 0
  );
  assert.deepEqual(
    requests.filter((path) => path.includes("/regions/")),
    [],
    "首屏绘制前不应请求省市地图",
  );

  await page.evaluate(() => {
    const callbacks = window.__globeIdleCallbacks.splice(0);
    callbacks.forEach((callback) => callback({
      didTimeout: false,
      timeRemaining: () => 50,
    }));
  });
  await waitUntil(
    () => requests.includes("/static/geo/regions/CN.json") &&
      requests.includes("/static/geo/regions/CN/440000.json"),
    "后台懒加载没有请求中国省份和广东城市地图",
  );

  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    document.getElementById("footprint").scrollIntoView();
  });
  await sleep(100);
  await page.evaluate(() => window.__globeDebug.focusCountry("CN"));
  const countryPoint = await canvasPoint(page, "country", "CN");
  assert.ok(countryPoint, "无法定位中国标记");

  await page.mouse.click(countryPoint.x, countryPoint.y);
  assert.equal((await page.evaluate(() => window.__globeDebug.state())).selected, "CN");
  assert.equal(await page.$eval("#globe-breadcrumb", (element) => element.textContent.trim()), "~/globe");
  assert.equal(await page.$eval("#globe-notes", (element) => element.style.display), "none");
  assert.equal(await page.$$eval("#globe-moment-links .gml-item", (items) => items.length), 4);

  await sleep(400);
  await doubleTap(page, countryPoint);
  await page.waitForFunction(() => window.__globeDebug.state().layer === "country");

  const provincePoint = await canvasPoint(page, "region", "广东省");
  assert.ok(provincePoint, "无法定位广东省");
  await page.mouse.click(provincePoint.x, provincePoint.y);
  assert.deepEqual(
    await page.$$eval("#globe-notes .gn-text", (items) => items.map((item) => item.textContent)),
    ["第一次到深圳", "第二次到深圳"],
  );
  assert.equal(await page.$$eval("#globe-moment-links .gml-item", (items) => items.length), 4);

  assert.equal(
    await page.evaluate(() => window.__globeDebug.zoomToRegion("广东省", 3.2)),
    true,
  );
  const before = await page.evaluate(() => window.__globeDebug.state());
  assert.equal(before.rv.zoom, 3.2);
  assert.notDeepEqual({ panx: before.rv.panx, pany: before.rv.pany }, { panx: 0, pany: 0 });
  const zoomedProvincePoint = await canvasPoint(page, "region", "广东省");
  assert.ok(zoomedProvincePoint, "放大后无法定位广东省");
  await doubleTap(page, zoomedProvincePoint);
  await page.waitForFunction(() => window.__globeDebug.state().layer === "city");

  const cityPoint = await canvasPoint(page, "region", "深圳市");
  assert.ok(cityPoint, "无法定位深圳市");
  await page.mouse.click(cityPoint.x, cityPoint.y);
  assert.deepEqual(
    await page.$$eval("#globe-notes .gn-text", (items) => items.map((item) => item.textContent)),
    ["第一次到深圳", "第二次到深圳"],
  );
  assert.equal(await page.$$eval("#globe-moment-links .gml-item", (items) => items.length), 3);

  await page.click("#globe-cd-up");
  await page.waitForFunction(() => window.__globeDebug.state().layer === "country");
  const after = await page.evaluate(() => window.__globeDebug.state());
  assert.deepEqual(after.rv, before.rv);
  assert.equal(after.selected, before.selected);
  assert.equal(await page.$eval("#globe-notes", (element) => element.style.display), "block");

  await page.evaluate(() =>
    window.__globeDebug.setRegionView({ zoom: 1, panx: 0, pany: 0 })
  );
  const fittedProvincePoint = await canvasPoint(page, "region", "广东省");
  await doubleTap(page, fittedProvincePoint);
  await page.waitForFunction(() => window.__globeDebug.state().layer === "city");
  await page.click('[data-nav="globe"]');
  await page.waitForFunction(() => window.__globeDebug.state().layer === "globe");
  assert.equal((await page.evaluate(() => window.__globeDebug.state())).selected, "CN");

  await page.evaluate(() => window.__globeDebug.focusCountry("CN"));
  const countryPointAgain = await canvasPoint(page, "country", "CN");
  await doubleTap(page, countryPointAgain);
  await page.waitForFunction(() => window.__globeDebug.state().layer === "country");
  const provincePointAgain = await canvasPoint(page, "region", "广东省");
  await doubleTap(page, provincePointAgain);
  await page.waitForFunction(() => window.__globeDebug.state().layer === "city");
  assert.equal((await page.evaluate(() => window.__globeDebug.state())).rv.zoom, 1);

  const client = await page.target().createCDPSession();
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  const rect = await page.$eval("#globe-canvas", (canvas) => {
    const box = canvas.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  });
  const y = rect.y + rect.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rect.x + 90, y }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: rect.x + 175, y: y + 2 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForFunction(() => window.__globeDebug.state().layer === "country");
  assert.equal((await page.evaluate(() => window.__globeDebug.state())).selected, "广东省");

  const duplicates = requests.filter((path, index) => requests.indexOf(path) !== index);
  assert.deepEqual(duplicates, [], "Geo 请求不应重复");
  assert.deepEqual(errors, [], "页面不应产生 JS 错误");
  console.log("PASS 首屏仅加载一级，空闲后懒加载省市地图");
  console.log("PASS 单击选中，双击下钻，省市笔记与瞬间聚合正确");
  console.log("PASS 返回按钮、面包屑和横滑均恢复导航快照");
} catch (error) {
  console.error(error);
  console.error("browser errors:", JSON.stringify(errors));
  console.error("geo requests:", JSON.stringify(requests));
  process.exitCode = 1;
} finally {
  await browser.close();
}
