// Browser checks for the public-site redesign (spec §6.3 / §8.2).
//
//   scripts/seed_fixture.sh "$tmp/blog.db" long-read
//   ADDR=127.0.0.1:8199 DB_PATH="$tmp/blog.db" REPO_DIR="$tmp" go run . serve &
//   node scripts/redesign_test.mjs [--only wp1,wp3]
//
// Needs the full / long-read fixture (seed_fixture.sh). Set EMPTY_BASE to a
// second server seeded with the "empty" fixture to also run the empty-home case.
// Every case fails on console errors, page errors or failed requests.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:8199";
const EMPTY_BASE = process.env.EMPTY_BASE || "";
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
const executablePath = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean).find(existsSync);
if (!executablePath) throw new Error("Chrome not found; set CHROME_BIN");

const DESK = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath, headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const cases = [];
const test = (wp, name, fn) => cases.push({ wp, name, fn });

// Opens a page and records every console error, page error and failed request.
async function open(path, viewport, { base = BASE, reduced = false, reading = null } = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.setViewport(viewport);
  if (reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  if (reading) await page.evaluateOnNewDocument((m) => localStorage.setItem("reading-mode", m), reading);
  // globe.js only exposes window.__globeDebug under this flag.
  await page.evaluateOnNewDocument(() => { window.__GLOBE_TEST__ = true; });
  page.problems = [];
  page.on("console", (m) => { if (m.type() === "error") page.problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    if (!/\/internal\/alive/.test(r.url())) page.problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => { if (r.status() >= 400) page.problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(base + path, { waitUntil: "networkidle0", timeout: 30000 });
  return page;
}

function clean(page) {
  assert.deepEqual(page.problems, [], "page must load with 0 console errors and 0 failed requests");
}

// Scrolls instantly (smooth scrolling would race the assertions).
async function scrollToY(page, y) {
  await page.evaluate((y) => { document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, y); }, y);
  await sleep(250);
}

async function scrollToSection(page, id) {
  await page.evaluate((id) => {
    document.documentElement.style.scrollBehavior = "auto";
    const el = document.getElementById(id);
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.3);
  }, id);
  await sleep(300);
}

const SECTIONS = ["about", "experience", "footprint", "notes", "projects", "thoughts", "moments"];

// ---------------------------------------------------------------- WP0
test("wp0", "首页无旧主题 / 外链字体 / 后台链接，搜索与 / 快捷键可用", async () => {
  const page = await open("/", DESK);
  const html = await page.content();
  for (const bad of ["themes/", "fonts.googleapis.com", "crt-scanlines", "/admin", "// 暂无"]) {
    assert.ok(!html.includes(bad), `home must not contain ${bad}`);
  }
  await page.keyboard.press("/");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "site-search");
  await page.keyboard.type("lantern");
  await page.waitForFunction(() => document.querySelectorAll("#search-results a, #search-results [role=option], #search-results .sr-item").length > 0);
  clean(page);
  await page.close();
});

// ---------------------------------------------------------------- WP1
test("wp1", "1440：星座停靠、当前章节、点击跳转落在导航下 16px", async () => {
  const page = await open("/", DESK);
  assert.ok(await page.$eval("#constellation", (el) => el.classList.contains("is-live")));
  await scrollToY(page, 0.8 * 900 + 4);
  assert.ok(await page.$eval("#constellation", (el) => el.classList.contains("is-docked")), "docked after 0.8vh");
  for (const id of SECTIONS) {
    await scrollToSection(page, id);
    const cur = await page.$eval("#constellation .star.is-current", (el) => el.dataset.key);
    assert.equal(cur, id, `is-current should follow #${id}`);
  }
  await scrollToY(page, 0);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; });
  await page.click('#constellation .star[data-key="projects"]');
  await page.waitForFunction(() => {
    const navH = document.getElementById("site-nav").offsetHeight;
    return Math.abs(document.getElementById("projects").getBoundingClientRect().top - navH - 16) <= 4;
  }, { timeout: 5000 });
  clean(page);
  await page.close();
});

test("wp1", "390：波浪星座、星点栏出现 / 让位搜索与灯箱、页脚不被遮挡", async () => {
  const page = await open("/", MOBILE);
  assert.ok(await page.$eval("#constellation", (el) => el.classList.contains("is-wave")));
  const heroH = await page.$eval(".hero", (el) => el.offsetHeight);
  await scrollToY(page, heroH * 0.55 + 20);
  assert.ok(await page.$eval("#star-rail", (el) => el.classList.contains("is-on")), "rail on after 55% of hero");
  // On mobile the search row is hidden until the icon opens it.
  await page.tap(".nav-search-btn");
  await sleep(150);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "site-search");
  assert.ok(!(await page.$eval("#star-rail", (el) => el.classList.contains("is-on"))), "rail hides while searching");
  await page.tap(".nav-search-btn");
  await sleep(250);
  assert.ok(await page.$eval("#star-rail", (el) => el.classList.contains("is-on")), "rail returns after search closes");
  await page.evaluate(() => document.body.classList.add("lightbox-open"));
  await sleep(100);
  assert.equal(await page.$eval("#star-rail", (el) => getComputedStyle(el).visibility), "hidden");
  await page.evaluate(() => document.body.classList.remove("lightbox-open"));
  // Lazy images and reveals grow the page on the way down; settle, then hit the real bottom.
  await scrollToY(page, 1e6);
  await sleep(400);
  await scrollToY(page, 1e6);
  const gap = await page.evaluate(() => {
    const rail = document.getElementById("star-rail").getBoundingClientRect();
    const copy = document.querySelector(".footer-copy").getBoundingClientRect();
    return rail.top - copy.bottom;
  });
  assert.ok(gap >= 0, `footer copy overlaps the rail by ${-gap}px`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, "no horizontal overflow");
  clean(page);
  await page.close();
});

test("wp1", "reduced motion：字符无动画，停靠在 40% 直接切换", async () => {
  const page = await open("/", DESK, { reduced: true });
  const anim = await page.$eval(".hero-name .ch", (el) => getComputedStyle(el).animationName);
  assert.equal(anim, "none");
  await scrollToY(page, 0.4 * 900 - 10);
  assert.ok(!(await page.$eval("#constellation", (el) => el.classList.contains("is-docked"))));
  await scrollToY(page, 0.4 * 900 + 10);
  assert.ok(await page.$eval("#constellation", (el) => el.classList.contains("is-docked")));
  clean(page);
  await page.close();
});

if (EMPTY_BASE) {
  test("wp1", "空数据：只有「关于」亮，暗星无 href 且 tabindex=-1，空模块不渲染", async () => {
    const page = await open("/", DESK, { base: EMPTY_BASE });
    const stars = await page.$$eval("#constellation .star", (els) => els.map((el) => ({
      key: el.dataset.key, off: el.hasAttribute("data-off"), href: el.getAttribute("href"), tab: el.getAttribute("tabindex"),
    })));
    assert.equal(stars.length, 7);
    for (const s of stars) {
      if (s.key === "about") { assert.ok(!s.off); continue; }
      assert.ok(s.off, `${s.key} should be dim`);
      assert.equal(s.href, null);
      assert.equal(s.tab, "-1");
    }
    for (const id of SECTIONS.slice(1)) assert.equal(await page.$(`#${id}`), null, `#${id} must not render`);
    clean(page);
    await page.close();
  });
}

// ---------------------------------------------------------------- WP2
test("wp2", "章节入场：每个模块滚入后都可见", async () => {
  const page = await open("/", DESK);
  for (const id of SECTIONS) {
    await scrollToSection(page, id);
    await sleep(1400);
    const hidden = await page.$$eval(`#${id} [data-reveal]`, (els) =>
      els.filter((el) => el.getBoundingClientRect().top < innerHeight && +getComputedStyle(el).opacity < 0.9).length);
    assert.equal(hidden, 0, `#${id} has [data-reveal] items still hidden in view`);
  }
  clean(page);
  await page.close();
});

test("wp2", "N1：悬停文章行出现封面卡（有图显示首图，无图显示首字）", async () => {
  const page = await open("/", DESK);
  await scrollToSection(page, "notes");
  await sleep(1200);
  const withCover = await page.$("#notes .post-row[data-cover]");
  const noCover = await page.$("#notes .post-row:not([data-cover])");
  assert.ok(withCover && noCover, "fixture needs one post with and one without an image");
  await withCover.hover();
  await page.waitForFunction(() => document.querySelector("#notes .post-card.is-on .post-card-art.has-img"));
  await noCover.hover();
  await page.waitForFunction(() => {
    const art = document.querySelector("#notes .post-card.is-on .post-card-art");
    return art && !art.classList.contains("has-img") && art.querySelector(".post-card-glyph").textContent.length === 1;
  });
  clean(page);
  await page.close();
});

test("wp2", "P1：项目星数滚动到最终值", async () => {
  const page = await open("/", DESK);
  await scrollToSection(page, "projects");
  await page.waitForFunction(() => [...document.querySelectorAll("#projects .pj-stars .num")]
    .every((el) => el.textContent.replace(/\D/g, "") === el.dataset.to), { timeout: 6000 });
  clean(page);
  await page.close();
});

test("wp2", "T1 + thoughts.js：长思考折叠、展开、浮动收起", async () => {
  const page = await open("/", DESK);
  await scrollToSection(page, "thoughts");
  await sleep(600);
  const btn = await page.waitForSelector("#thoughts .thought-toggle:not([hidden])");
  const collapsedH = await page.$eval("#thoughts .thought-toggle:not([hidden])", (b) => b.closest(".thought").querySelector(".thought-body").offsetHeight);
  assert.ok(collapsedH <= 180, `collapsed body is ${collapsedH}px`);
  await btn.click();
  await sleep(200);
  const open1 = await page.$eval("#thoughts .thought-toggle:not([hidden])", (b) => ({
    text: b.textContent, h: b.closest(".thought").querySelector(".thought-body").offsetHeight,
  }));
  assert.ok(open1.text.includes("收起") && open1.h > collapsedH);
  assert.equal(await page.$eval(".thought-collapse-float", (b) => b.hidden), false);
  await page.click(".thought-collapse-float");
  await sleep(200);
  assert.ok((await page.$eval("#thoughts .thought-toggle:not([hidden])", (b) => b.textContent)).includes("展开"));
  // The ink reveal restores the plain text once it has run.
  await page.waitForFunction(() => !document.querySelector("#thoughts .thought-body.is-ink"), { timeout: 15000 });
  clean(page);
  await page.close();
});

test("wp2", "moments.js + M1：灯箱打开、左右切换、Esc 关闭", async () => {
  const page = await open("/", DESK);
  await scrollToSection(page, "moments");
  await sleep(1500);
  const multi = await page.$('#moments .moment-media[data-count="3"] img.moment-item');
  assert.ok(multi, "fixture needs a moment with 3 images");
  await multi.click();
  await page.waitForFunction(() => document.body.classList.contains("lightbox-open"));
  await sleep(600);
  await page.keyboard.press("ArrowRight");
  await sleep(400);
  assert.equal(await page.$eval(".lightbox-prev", (b) => b.classList.contains("is-end")), false);
  await page.keyboard.press("ArrowLeft");
  await sleep(400);
  assert.equal(await page.$eval(".lightbox-prev", (b) => b.classList.contains("is-end")), true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.classList.contains("lightbox-open"));
  assert.equal(await page.$(".is-flip, .lightbox-ghost"), null, "no FLIP ghost left behind");
  clean(page);
  await page.close();
});

test("wp2", "地球关联瞬间：跳到 #moment-{id} 并闪烁", async () => {
  const page = await open("/", DESK);
  await scrollToSection(page, "footprint");
  await page.waitForFunction(() => window.__globeDebug?.ready());
  // CN carries the linked moment (深圳); province-only rows such as JP have none.
  await page.evaluate(() => window.__globeDebug.focusCountry("CN"));
  await sleep(300);
  const pt = await page.evaluate(() => {
    const r = document.getElementById("globe-canvas").getBoundingClientRect();
    const p = window.__globeDebug.countryPoint("CN");
    return p && { x: r.left + p.x, y: r.top + p.y };
  });
  assert.ok(pt, "CN marker must be visible");
  await page.mouse.click(pt.x, pt.y);
  const link = await page.waitForSelector("#globe-moment-links .gml-item");
  const mid = await link.evaluate((a) => a.dataset.mid);
  await link.click();
  await page.waitForFunction((mid) => document.getElementById("moment-" + mid)?.classList.contains("moment-flash"), {}, mid);
  clean(page);
  await page.close();
});

// ---------------------------------------------------------------- WP3
test("wp3", "阅读模式：首帧已有 data-reading，切换后刷新保持", async () => {
  const page = await browser.newPage();
  await page.setViewport(DESK);
  page.problems = [];
  page.on("pageerror", (e) => page.problems.push(e.message));
  await page.goto(BASE + "/posts/long-read", { waitUntil: "domcontentloaded" });
  const first = await page.evaluate(() => document.documentElement.getAttribute("data-reading"));
  assert.ok(first === "night" || first === "paper");
  await page.waitForNetworkIdle();
  await page.evaluate(() => localStorage.setItem("reading-mode", "night"));
  await page.reload({ waitUntil: "networkidle0" });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.reading), "night");
  await page.click("#reading-toggle");
  await sleep(900);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.reading), "paper");
  assert.equal(await page.$eval("#reading-toggle", (b) => b.getAttribute("aria-pressed")), "true");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.reading), "paper");
  assert.deepEqual(page.problems, []);
  await page.close();
});

test("wp3", "TOC：≥1200 显示并高亮当前项，<1200 隐藏；进度条到底为 1", async () => {
  const page = await open("/posts/long-read", DESK, { reading: "night" });
  assert.equal(await page.$eval("#reading-toc", (el) => getComputedStyle(el).display !== "none"), true);
  const n = await page.$$eval("#reading-toc .toc-list a", (as) => as.length);
  assert.equal(n, 4, "TOC lists the 4 h2");
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; });
  await page.click("#reading-toc .toc-list a:nth-of-type(1)");
  const links = await page.$$("#reading-toc .toc-list a");
  await links[2].click();
  await page.waitForFunction(() => {
    const a = document.querySelectorAll("#reading-toc .toc-list a")[2];
    return a.classList.contains("is-current");
  }, { timeout: 5000 });
  await scrollToY(page, 1e6);
  await sleep(300);
  const p = await page.$eval("#read-progress", (el) => el.style.transform);
  assert.match(p, /^scaleX\(1(\.0+)?\)$/);
  await page.setViewport({ width: 1100, height: 900 });
  await sleep(200);
  assert.equal(await page.$eval("#reading-toc", (el) => getComputedStyle(el).display), "none");
  clean(page);
  await page.close();
});

test("wp3", "长文 390：无横向溢出、正文 17px、代码块内滚动", async () => {
  const page = await open("/posts/long-read", MOBILE, { reading: "night" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  assert.equal(await page.$eval(".reading-panel .article p", (p) => getComputedStyle(p).fontSize), "17px");
  const pre = await page.$eval(".article pre", (el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
  assert.ok(pre.sw > pre.cw && (pre.ox === "auto" || pre.ox === "scroll"), "wide code scrolls inside its block");
  clean(page);
  await page.close();
});

test("wp3", "paper 模式：星空隐藏，阅读面板为纸色", async () => {
  const page = await open("/posts/long-read", DESK, { reading: "paper" });
  assert.equal(await page.$eval("#starfield", (el) => getComputedStyle(el).display), "none");
  assert.equal(await page.$eval(".reading-panel", (el) => getComputedStyle(el).backgroundColor), "rgb(243, 238, 228)");
  clean(page);
  await page.close();
});

// ---------------------------------------------------------------- WP4
test("wp4", "地球：两栏、出发地与航线、面包屑与下钻提示", async () => {
  const page = await open("/", DESK);
  await scrollToSection(page, "footprint");
  await page.waitForFunction(() => window.__globeDebug?.ready() && window.__globeDebug.routes()?.drawn, { timeout: 15000 });
  const routes = await page.evaluate(() => window.__globeDebug.routes());
  assert.equal(routes.origin.code, "CN");
  assert.deepEqual(routes.targets, ["JP"]);
  const cols = await page.$eval(".footprint-grid", (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  assert.equal(cols, 2);
  assert.equal(await page.$eval("#globe-breadcrumb", (el) => el.textContent.trim()), "地球");
  assert.equal(await page.$eval("#globe-drill-hint", (el) => el.textContent.trim()), "双击进入下一级");
  await page.waitForFunction(() => document.getElementById("globe-stats").textContent === "2 国 · 3 省/州 · 4 处", { timeout: 6000 });
  clean(page);
  await page.close();
});

test("wp4", "地球 390：单栏，画布宽 350", async () => {
  const page = await open("/", MOBILE);
  await scrollToSection(page, "footprint");
  await page.waitForFunction(() => window.__globeDebug?.ready());
  assert.equal(await page.$eval("#globe-canvas", (c) => Math.round(c.getBoundingClientRect().width)), 350);
  const cols = await page.$eval(".footprint-grid", (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  assert.equal(cols, 1);
  clean(page);
  await page.close();
});

// ---------------------------------------------------------------- run
let failed = 0, ran = 0;
for (const c of cases) {
  if (ONLY && !ONLY.has(c.wp)) continue;
  ran++;
  try {
    await c.fn();
    console.log(`PASS [${c.wp}] ${c.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL [${c.wp}] ${c.name}\n  ${String(e && e.message || e).split("\n").join("\n  ")}`);
  }
}
await browser.close();
console.log(`\n${ran - failed}/${ran} passed${EMPTY_BASE ? "" : " (set EMPTY_BASE to include the empty-fixture case)"}`);
if (failed) process.exit(1);
