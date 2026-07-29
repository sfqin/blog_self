import assert from "node:assert/strict";
import { createRequire } from "node:module";

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

console.log("ALL GLOBE CORE TESTS PASSED");
