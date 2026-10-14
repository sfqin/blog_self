import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Core = require("../web/static/js/globe-core.js");

const footprints = [{
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

assert.deepEqual(
  Core.selectionContent(footprints, {
    layer: "globe",
    selected: "CN",
    country: null,
    province: null,
  }),
  { notes: [], momentIds: [9, 10, 11, 12] },
  "国家只聚合瞬间，不展示 note",
);

assert.deepEqual(
  Core.selectionContent(footprints, {
    layer: "country",
    selected: "广东省",
    country: { code: "CN" },
    province: null,
  }),
  {
    notes: [
      { city: "深圳市", note: "第一次到深圳" },
      { city: "深圳市", note: "第二次到深圳" },
    ],
    momentIds: [9, 10, 11, 12],
  },
  "省份保留所有非空 note，并按首次出现顺序去重瞬间",
);

assert.deepEqual(
  Core.selectionContent(footprints, {
    layer: "city",
    selected: "深圳市",
    country: { code: "CN" },
    province: { name: "广东省" },
  }),
  {
    notes: [
      { city: "深圳市", note: "第一次到深圳" },
      { city: "深圳市", note: "第二次到深圳" },
    ],
    momentIds: [9, 10, 11],
  },
  "城市保留同名城市的全部记录",
);

assert.deepEqual(
  Core.selectionContent(footprints, {
    layer: "country",
    selected: null,
    country: { code: "CN" },
    province: null,
  }),
  { notes: [], momentIds: [] },
);
assert.equal(
  Core.escapeHTML(`<img src=x onerror="boom">&`),
  "&lt;img src=x onerror=&quot;boom&quot;&gt;&amp;",
);

const taps = Core.createTapTracker(360);

assert.equal(taps.register("globe", "CN", 1000, 0), false);
assert.equal(taps.register("globe", "CN", 1200, 0), true, "同区域双击下钻");
assert.equal(taps.register("globe", "CN", 2000, 0), false);
assert.equal(taps.register("globe", "JP", 2150, 0), false, "不同区域不下钻");
assert.equal(taps.register("globe", "JP", 2300, 1), false, "发生手势后不延续旧双击");
taps.cancel();
assert.equal(taps.register("globe", "JP", 2400, 1), false);

const source = {
  layer: "country",
  country: { code: "CN", name: "中国" },
  province: null,
  regionData: { id: "cn-map" },
  selected: "广东省",
  hover: "广西壮族自治区",
  rot: { x: -0.4, y: 1.2 },
  vel: { x: 0.01, y: -0.02 },
  gz: 1.8,
  rv: { zoom: 3.2, panx: 81, pany: -34 },
};
const snap = Core.snapshotView(source);
source.rv.zoom = 1;
source.selected = null;
Core.restoreView(source, snap);
assert.deepEqual(source.rv, { zoom: 3.2, panx: 81, pany: -34 });
assert.equal(source.selected, "广东省");
assert.equal(source.regionData.id, "cn-map");
assert.notEqual(source.rv, snap.rv, "恢复时复制可变对象");

const nav = Core.createHistory();
const globe = {
  layer: "globe",
  country: null,
  province: null,
  regionData: null,
  selected: "CN",
  hover: null,
  rot: { x: -0.2, y: 2.1 },
  vel: { x: 0, y: 0 },
  gz: 2.3,
  rv: { zoom: 1, panx: 0, pany: 0 },
};
const province = {
  ...globe,
  layer: "country",
  country: { code: "CN", name: "中国" },
  regionData: { id: "cn" },
  selected: "广东省",
  rv: { zoom: 3.5, panx: 91, pany: -42 },
};

nav.push(globe);
nav.push(province);
const restoredProvince = nav.pop();
assert.equal(restoredProvince.selected, "广东省");
assert.deepEqual(restoredProvince.rv, { zoom: 3.5, panx: 91, pany: -42 });
const restoredGlobe = nav.popTo("globe");
assert.equal(restoredGlobe.selected, "CN");
assert.equal(restoredGlobe.gz, 2.3);
assert.equal(nav.size(), 0);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(function (res, rej) {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const calls = [];
const gates = new Map();
function fakeFetch(url) {
  calls.push(url);
  const gate = deferred();
  gates.set(url, gate);
  return gate.promise;
}

const loader = Core.createMapLoader(fakeFetch, 2);
const a1 = loader.prefetch("A", 10);
const a2 = loader.load("A");
const b = loader.prefetch("B", 10);
const c = loader.prefetch("C", 10);

assert.equal(a1, a2, "相同 URL 复用同一个 Promise");
await Promise.resolve();
assert.deepEqual(calls, ["A", "B"], "并发上限为 2");
gates.get("A").resolve({ id: "A" });
assert.equal((await a1).id, "A");
await Promise.resolve();
assert.deepEqual(calls, ["A", "B", "C"]);

gates.get("B").reject(new Error("network"));
await assert.rejects(b);
const retry = loader.load("B");
assert.notEqual(retry, b, "失败后允许重试");
gates.get("C").resolve({ id: "C" });
assert.equal((await c).id, "C");
await Promise.resolve();
assert.deepEqual(calls, ["A", "B", "C", "B"]);
gates.get("B").resolve({ id: "B retry" });
assert.equal((await retry).id, "B retry");

const pausedCalls = [];
const pausedLoader = Core.createMapLoader(function (url) {
  pausedCalls.push(url);
  return Promise.resolve({ id: url });
}, 2);
pausedLoader.setPaused(true);
const background = pausedLoader.prefetch("background", 1);
await Promise.resolve();
assert.deepEqual(pausedCalls, []);
await pausedLoader.load("urgent");
assert.deepEqual(pausedCalls, ["urgent"]);
pausedLoader.setPaused(false);
await background;
assert.deepEqual(pausedCalls, ["urgent", "background"]);

// ============================================================
// WP4: place names, resolveOrigin, footprint stats, F3 text, great circles
// ============================================================
const here = dirname(fileURLToPath(import.meta.url));
const geo = (path) => JSON.parse(readFileSync(join(here, "..", "web", "static", "geo", path), "utf8"));
const world = geo("world.json");
const cnRegions = geo("regions/CN.json").regions;

// CN_PROVINCE_CENTERS keys mirror regions/CN.json names exactly (minus 100000_JD).
{
  const names = cnRegions.map((region) => region.name).filter(Boolean);
  assert.equal(names.length, 34, "regions/CN.json 应有 34 个省级名称");
  assert.deepEqual(Object.keys(Core.CN_PROVINCE_CENTERS).sort(), [...names].sort(), "省中心表键与 CN.json 逐字一致");
  for (const [name, center] of Object.entries(Core.CN_PROVINCE_CENTERS)) {
    assert.equal(center.length, 2, name);
    const [lon, lat] = center;
    assert.ok(lon > 73 && lon < 136 && lat > 18 && lat < 54, `${name} 坐标在中国范围内`);
    assert.equal(Math.round(lon * 100) / 100, lon, `${name} 经度两位小数`);
    assert.equal(Math.round(lat * 100) / 100, lat, `${name} 纬度两位小数`);
  }
  assert.deepEqual(Core.CN_PROVINCE_CENTERS["北京市"], [116.40, 39.90]);
  assert.deepEqual(Core.CN_PROVINCE_CENTERS["广东省"], [113.27, 23.13]);
  assert.deepEqual(Core.CN_PROVINCE_CENTERS["香港特别行政区"], [114.17, 22.32]);
  assert.deepEqual(Core.CN_PROVINCE_CENTERS["澳门特别行政区"], [113.54, 22.19]);
  assert.deepEqual(Core.CN_PROVINCE_CENTERS["台湾省"], [121.56, 25.04]);
}

// normalizePlace / displayRegionName.
assert.equal(Core.normalizePlace(" 广东省 "), "广东");
assert.equal(Core.normalizePlace("Guangdong Province China"), "guangdongchina");
assert.equal(Core.normalizePlace("New York City"), "newyork");
assert.equal(Core.normalizePlace("广西壮族自治区"), "广西");
assert.equal(Core.normalizePlace("新疆维吾尔自治区"), "新疆");
assert.equal(Core.normalizePlace("香港特别行政区"), "香港");
assert.equal(Core.normalizePlace(null), "");
assert.equal(Core.displayRegionName("广东省"), "广东");
assert.equal(Core.displayRegionName("北京市"), "北京");
assert.equal(Core.displayRegionName("广西壮族自治区"), "广西");
assert.equal(Core.displayRegionName("新疆维吾尔自治区"), "新疆");
assert.equal(Core.displayRegionName("宁夏回族自治区"), "宁夏");
assert.equal(Core.displayRegionName("内蒙古自治区"), "内蒙古");
assert.equal(Core.displayRegionName("香港特别行政区"), "香港");
assert.equal(Core.displayRegionName("深圳市"), "深圳");
assert.equal(Core.displayRegionName("東京都"), "東京都", "非后缀名保持原样");
assert.equal(Core.displayRegionName("Tokyo"), "Tokyo", "非中文名保持原样");
assert.equal(Core.displayRegionName("Kuala Lumpur City"), "Kuala Lumpur City");

// resolveOrigin (spec 5.4 steps 1–4).
{
  const BEIJING = { lon: 116.40, lat: 39.90, code: "CN", label: "北京", matched: false };
  const trip = [
    {
      code: "CN",
      name: "中国",
      provinces: [
        { name: "广东省", cities: [{ name: "深圳市" }, { name: "广州市" }] },
        { name: "北京市", cities: [] },
      ],
    },
    { code: "JP", name: "日本", provinces: [{ name: "東京都", cities: [{ name: "新宿区" }] }] },
  ];

  assert.deepEqual(
    Core.resolveOrigin("广东", trip, world),
    { lon: 113.27, lat: 23.13, code: "CN", label: "广东", matched: true },
    "广东 命中 广东省，使用省会坐标",
  );
  assert.deepEqual(
    Core.resolveOrigin("北京市", trip, world),
    { lon: 116.40, lat: 39.90, code: "CN", label: "北京", matched: true },
  );
  assert.deepEqual(Core.resolveOrigin("Guangdong Province China", trip, world), BEIJING);
  assert.deepEqual(Core.resolveOrigin("", trip, world), BEIJING);
  assert.deepEqual(Core.resolveOrigin(undefined, [], world), BEIJING);
  assert.deepEqual(Core.resolveOrigin("广东", [], world), BEIJING, "足迹不含该地时回退北京");

  const tokyo = Core.resolveOrigin("東京", trip, world);
  assert.deepEqual(
    tokyo,
    { lon: world.countries.JP.c[0], lat: world.countries.JP.c[1], code: "JP", label: "東京都", matched: true },
    "非中国省份使用 world.json 国家中心",
  );

  assert.deepEqual(
    Core.resolveOrigin("深圳", trip, world),
    { lon: 113.27, lat: 23.13, code: "CN", label: "深圳", matched: true },
    "城市命中后使用所在省的省会坐标",
  );
  assert.equal(Core.resolveOrigin("广", trip, world).matched, false, "较短一方不足 2 字不匹配");
  assert.equal(Core.resolveOrigin("中国广东省深圳市", trip, world).label, "广东", "双向包含：长串包含省名");
  assert.equal(
    Core.resolveOrigin("广州", [{ code: "CN", provinces: [{ name: "广州市", cities: [] }, { name: "广东省", cities: [{ name: "广州市" }] }] }], world).label,
    "广州",
    "按顺序命中第一个",
  );
  const provinceFirst = [{
    code: "CN",
    provinces: [
      { name: "江苏省", cities: [{ name: "广州路" }] },
      { name: "广州市", cities: [] },
    ],
  }];
  assert.equal(Core.resolveOrigin("广州", provinceFirst, world).label, "广州", "同一国家先匹配省名，再匹配城市名");
  const noProvinceCenter = Core.resolveOrigin("雄安新区", [{ code: "CN", provinces: [{ name: "雄安新区", cities: [] }] }], world);
  assert.deepEqual(
    [noProvinceCenter.lon, noProvinceCenter.lat, noProvinceCenter.matched],
    [world.countries.CN.c[0], world.countries.CN.c[1], true],
    "省名不在表内时使用国家中心",
  );
}

// footprintStats: same fixture as above / the browser test (深圳 twice).
assert.deepEqual(Core.footprintStats(footprints), { countries: 1, provinces: 1, places: 2 });
assert.deepEqual(Core.footprintStats([]), { countries: 0, provinces: 0, places: 0 });
assert.deepEqual(Core.footprintStats(null), { countries: 0, provinces: 0, places: 0 });
{
  const mixed = [
    {
      code: "CN",
      name: "中国",
      provinces: [
        { name: "广东省", cities: [{ name: "深圳市" }, { name: "深圳市" }, { name: "广州市" }] },
        { name: "北京市", cities: [] },               // province-only row counts as 1 place
        { name: "", cities: [{ name: "无名" }] },      // empty province name is ignored
      ],
    },
    { code: "TH", name: "泰国", provinces: [] },      // country with no provinces
    { code: "JP", name: "日本", provinces: [{ name: "東京都", cities: [{ name: "新宿区" }] }] },
  ];
  assert.deepEqual(Core.footprintStats(mixed), { countries: 3, provinces: 3, places: 4 });
  assert.deepEqual(Core.footprintStatsFor(mixed, "globe"), { countries: 3, provinces: 3, places: 4 });
  assert.deepEqual(Core.footprintStatsFor(mixed, "country", "CN"), { countries: 1, provinces: 2, places: 3 });
  assert.deepEqual(Core.footprintStatsFor(mixed, "country", "TH"), { countries: 1, provinces: 0, places: 0 });
  assert.deepEqual(Core.footprintStatsFor(mixed, "province", "CN", "广东省"), { countries: 1, provinces: 1, places: 2 });
  assert.deepEqual(Core.footprintStatsFor(mixed, "province", "CN", "北京市"), { countries: 1, provinces: 1, places: 1 });
  assert.deepEqual(Core.footprintStatsFor(mixed, "country", "US"), { countries: 0, provinces: 0, places: 0 });
}

// F3 text per layer (「省/州」 for every country, decided by WP4).
{
  const stats = Core.footprintStats(footprints);
  assert.equal(Core.statsText(Core.statsSegments("globe", stats)), "1 国 · 1 省/州 · 2 处");
  assert.equal(
    Core.statsText(Core.statsSegments("country", Core.footprintStatsFor(footprints, "country", "CN"), "中国")),
    "中国 · 1 省/州 · 2 处",
  );
  assert.equal(
    Core.statsText(Core.statsSegments("country", { countries: 1, provinces: 3, places: 5 }, "日本")),
    "日本 · 3 省/州 · 5 处",
    "非中国同样使用「省/州」",
  );
  assert.equal(
    Core.statsText(Core.statsSegments("province", Core.footprintStatsFor(footprints, "province", "CN", "广东省"))),
    "2 处",
  );
  assert.deepEqual(Core.statsSegments("city", stats), []);
  assert.deepEqual(Core.statsSegments("globe", { countries: 5, provinces: 27, places: 49 }), [
    { num: 5 }, { unit: "国" }, { sep: "·" },
    { num: 27 }, { unit: "省/州" }, { sep: "·" },
    { num: 49 }, { unit: "处" },
  ]);
  assert.deepEqual(Core.statsSegments("country", stats, "中国")[0], { text: "中国" }, "国家名是纯文本段");
}

// greatCircle: endpoints, point count, midpoint, degenerate inputs.
{
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
  const toVec = ([lon, lat]) => {
    const lo = lon * Math.PI / 180, la = lat * Math.PI / 180;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  };
  const angle = (a, b) => {
    const va = toVec(a), vb = toVec(b);
    return Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  };

  const equator = Core.greatCircle([0, 0], [90, 0], 4);
  assert.equal(equator.length, 5);
  assert.deepEqual(equator[0], [0, 0]);
  assert.deepEqual(equator[4], [90, 0]);
  assert.ok(near(equator[2][0], 45) && near(equator[2][1], 0), "赤道中点为 45°E");

  const meridian = Core.greatCircle([10, -30], [10, 50], 2);
  assert.ok(near(meridian[1][0], 10) && near(meridian[1][1], 10), "同一经线中点纬度为两端平均");

  const gz = [113.27, 23.13];
  const tokyo = world.countries.JP.c;
  const route = Core.greatCircle(gz, tokyo, 64);
  assert.equal(route.length, 65);
  assert.deepEqual(route[0], gz);
  assert.deepEqual(route[64], tokyo);
  const total = angle(gz, tokyo);
  assert.ok(near(angle(gz, route[32]), total / 2, 1e-9) && near(angle(route[32], tokyo), total / 2, 1e-9), "中点到两端等距");
  for (let i = 1; i < route.length; i++) {
    assert.ok(near(angle(route[i - 1], route[i]), total / 64, 1e-9), "等角步长");
  }

  const same = Core.greatCircle([20, 10], [20, 10], 3);
  assert.equal(same.length, 4);
  same.forEach((point) => assert.ok(near(point[0], 20) && near(point[1], 10), "相同端点退化为一点"));

  const antipodal = Core.greatCircle([0, 0], [180, 0], 4);
  assert.equal(antipodal.length, 5);
  assert.ok(antipodal.every((point) => point.every(Number.isFinite)), "对跖点不产生 NaN");
  assert.ok(near(angle([0, 0], antipodal[2]), Math.PI / 2, 1e-9), "对跖点中点与起点相距 90°");
  assert.deepEqual(antipodal[4], [180, 0]);
}

console.log("ALL GLOBE CORE TESTS PASSED");
