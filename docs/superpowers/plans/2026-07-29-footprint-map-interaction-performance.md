# Footprint Map Interaction and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Footprint 地图改为“单击选中、双击/双点下钻”，按层级展示足迹笔记与关联瞬间，并通过可去重的分阶段懒加载和导航快照实现快速下钻及完整返回恢复。

**Architecture:** 新增无 DOM 的 `globe-core.js`，集中负责笔记/瞬间聚合、双击判定、状态快照和并发加载队列；现有 `globe.js` 继续负责 Canvas 绘制、浏览器事件和 DOM 渲染。地图数据首屏只加载世界地图，首帧完成后由并发上限为 2 的后台队列加载省市数据；所有前进导航先加载成功再提交状态，所有返回入口统一恢复导航栈快照。

**Tech Stack:** Go 1.23、`net/http`、`html/template`、原生 JavaScript、Canvas 2D、Node.js 纯逻辑测试、Puppeteer Core 浏览器测试。

---

## 文件边界

**新增文件**

- `web/static/js/globe-core.js`
  - 无 DOM 的 Footprint 聚合、点击判定、状态快照、地图加载队列。
  - 使用 UMD 导出：浏览器通过 `window.GlobeCore`，Node 测试通过 `require()`。
- `scripts/globe_core_test.mjs`
  - 纯逻辑测试；不依赖浏览器或本地服务。
- `internal/render/render_test.go`
  - 验证单文件资源版本和 Geo 聚合版本。
- `internal/server/static_cache_test.go`
  - 验证本地服务针对 Geo JSON 的长期缓存策略。
- `internal/export/export_test.go`
  - 验证根路径与 `BASE_URL` 子路径导出的 Geo 缓存规则。

**修改文件**

- `web/static/js/globe.js`
  - 接入 `GlobeCore`。
  - 单击选中、双击/双点下钻。
  - 笔记/瞬间面板。
  - 导航历史与事务式下钻。
  - 分阶段懒加载和加载反馈。
- `web/templates/public/home.html`
  - 在 `globe.js` 前加载 `globe-core.js`。
  - 注入 Geo 聚合版本。
  - 新增足迹笔记容器。
- `web/static/css/crt.css`
  - 足迹笔记面板和地图加载提示样式。
- `internal/render/render.go`
  - 生成整个 `static/geo` 目录的聚合内容哈希。
  - 增加只返回版本值的模板 helper。
- `internal/server/routes.go`
  - `/static/geo/` 使用长期缓存；其他静态代码继续 `no-cache`。
- `internal/export/export.go`
  - 生成静态托管 `_headers`，为 Geo 资源设置长期缓存。
- `scripts/globe_test.mjs`
  - 移除硬编码 DevTools WebSocket 连接，改为直接启动可配置 Chrome。
  - 覆盖单击、双击、笔记、缩放返回和首屏加载时序。

**不修改**

- 数据库 schema。
- `/api/footprints` JSON 结构。
- 后台 Footprint 录入表单。

---

### Task 1: 建立可测试的 Footprint 交互内核

**Files:**
- Create: `web/static/js/globe-core.js`
- Create: `scripts/globe_core_test.mjs`

- [ ] **Step 1: 写足迹内容聚合的失败测试**

在 `scripts/globe_core_test.mjs` 中使用 Node `createRequire` 加载尚不存在的内核，并定义重复城市记录、空笔记和重复瞬间：

```js
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
```

- [ ] **Step 2: 运行测试并确认红灯**

Run:

```bash
node scripts/globe_core_test.mjs
```

Expected: FAIL，错误为 `Cannot find module '../web/static/js/globe-core.js'`。

- [ ] **Step 3: 写双击判定与状态快照的失败测试**

继续在 `scripts/globe_core_test.mjs` 增加：

```js
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
```

- [ ] **Step 4: 实现最小 `globe-core.js`**

创建 UMD 模块，并完整实现以下 API：

```js
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GlobeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function countryByCode(footprints, code) {
    return (footprints || []).find(function (item) { return item.code === code; }) || null;
  }

  function unionMomentIds(cities, cityName) {
    var result = [];
    var seen = Object.create(null);
    (cities || []).forEach(function (city) {
      if (cityName && city.name !== cityName) return;
      (city.momentIds || []).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        result.push(id);
      });
    });
    return result;
  }

  function notesForCities(cities, cityName) {
    var result = [];
    (cities || []).forEach(function (city) {
      if (cityName && city.name !== cityName) return;
      if (!city.note || !city.note.trim()) return;
      result.push({ city: city.name, note: city.note });
    });
    return result;
  }

  function selectionContent(footprints, view) {
    if (!view || !view.selected) return { notes: [], momentIds: [] };
    if (view.layer === "globe") {
      var selectedCountry = countryByCode(footprints, view.selected);
      var countryCities = [];
      if (selectedCountry) {
        selectedCountry.provinces.forEach(function (province) {
          countryCities = countryCities.concat(province.cities || []);
        });
      }
      return { notes: [], momentIds: unionMomentIds(countryCities, null) };
    }

    var country = countryByCode(footprints, view.country && view.country.code);
    if (!country) return { notes: [], momentIds: [] };
    var province = country.provinces.find(function (item) {
      return item.name === (view.layer === "country" ? view.selected : view.province && view.province.name);
    });
    if (!province) return { notes: [], momentIds: [] };
    var cityName = view.layer === "city" ? view.selected : null;
    return {
      notes: notesForCities(province.cities, cityName),
      momentIds: unionMomentIds(province.cities, cityName),
    };
  }

  function createTapTracker(windowMs) {
    var previous = null;
    return {
      register: function (layer, key, now, gestureEpoch) {
        var isDouble = !!previous &&
          previous.layer === layer &&
          previous.key === key &&
          previous.gestureEpoch === gestureEpoch &&
          now - previous.time <= windowMs;
        previous = isDouble ? null : {
          layer: layer, key: key, time: now, gestureEpoch: gestureEpoch,
        };
        return isDouble;
      },
      cancel: function () { previous = null; },
    };
  }

  function snapshotView(state) {
    return {
      layer: state.layer,
      country: state.country && Object.assign({}, state.country),
      province: state.province && Object.assign({}, state.province),
      regionData: state.regionData,
      selected: state.selected,
      hover: state.hover,
      rot: Object.assign({}, state.rot),
      vel: Object.assign({}, state.vel),
      gz: state.gz,
      rv: Object.assign({}, state.rv),
    };
  }

  function restoreView(state, snap) {
    state.layer = snap.layer;
    state.country = snap.country && Object.assign({}, snap.country);
    state.province = snap.province && Object.assign({}, snap.province);
    state.regionData = snap.regionData;
    state.selected = snap.selected;
    state.hover = snap.hover;
    state.rot = Object.assign({}, snap.rot);
    state.vel = Object.assign({}, snap.vel);
    state.gz = snap.gz;
    state.rv = Object.assign({}, snap.rv);
    return state;
  }

  return {
    selectionContent: selectionContent,
    createTapTracker: createTapTracker,
    snapshotView: snapshotView,
    restoreView: restoreView,
  };
});
```

- [ ] **Step 5: 运行纯逻辑测试**

Run:

```bash
node scripts/globe_core_test.mjs
```

Expected: PASS，进程退出码为 0。

- [ ] **Step 6: 提交纯逻辑内核**

```bash
git add web/static/js/globe-core.js scripts/globe_core_test.mjs
git commit -m "test: 建立足迹地图交互内核" \
  -m "Co-authored-by: TRAE CLI <noreply@bytedance.com>"
```

---

### Task 2: 接入单击选中、双击下钻和笔记面板

**Files:**
- Modify: `web/templates/public/home.html:146-158`
- Modify: `web/templates/public/home.html:204-209`
- Modify: `web/static/css/crt.css:340-398`
- Modify: `web/static/js/globe.js:60-77`
- Modify: `web/static/js/globe.js:263-287`
- Modify: `web/static/js/globe.js:470-584`
- Modify: `web/static/js/globe.js:916-1083`
- Test: `scripts/globe_core_test.mjs`

- [ ] **Step 1: 扩展测试，锁定空选择和 HTML 安全边界**

在 `scripts/globe_core_test.mjs` 增加：

```js
assert.deepEqual(
  Core.selectionContent(footprints, {
    layer: "country",
    selected: null,
    country: { code: "CN" },
    province: null,
  }),
  { notes: [], momentIds: [] },
);
assert.equal(Core.escapeHTML(`<img src=x onerror="boom">&`), "&lt;img src=x onerror=&quot;boom&quot;&gt;&amp;");
```

Run:

```bash
node scripts/globe_core_test.mjs
```

Expected: FAIL，`Core.escapeHTML is not a function`。

- [ ] **Step 2: 在内核增加统一转义函数**

在 `globe-core.js` 增加并导出：

```js
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return {
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;",
    }[char];
  });
}
```

Run:

```bash
node scripts/globe_core_test.mjs
```

Expected: PASS。

- [ ] **Step 3: 在首页模板增加笔记容器并按顺序加载脚本**

将 Footprint 面板改为：

```html
<div class="globe-stats" id="globe-stats"></div>
<div id="globe-notes" class="globe-notes" style="display:none"></div>
<div id="globe-moment-links" class="globe-moment-links" style="display:none"></div>
```

将脚本顺序改为：

```html
<script>window.__BASE__ = "{{.Base}}";</script>
<script src="{{.Base}}{{asset "/static/js/globe-core.js"}}" defer></script>
<script src="{{.Base}}{{asset "/static/js/globe.js"}}" defer></script>
```

Geo 聚合版本在 Task 5 实现并注入；此任务不提前引用尚不存在的模板 helper，保证中间提交仍可启动。

- [ ] **Step 4: 新增笔记面板样式**

在 `.globe-moment-links` 前新增：

```css
.globe-notes {
  margin: 14px auto 0;
  width: 100%;
  max-width: 440px;
  text-align: left;
  background: rgba(var(--overlay-rgb), 0.55);
  border: 1px solid var(--line);
  border-left: 3px solid var(--green);
  border-radius: 0 8px 8px 0;
  padding: 10px 12px;
  animation: gml-in 0.22s ease-out;
}
.globe-notes .gn-head {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  padding-bottom: 7px;
  border-bottom: 1px dashed var(--line);
}
.globe-notes .gn-item {
  display: grid;
  grid-template-columns: minmax(72px, auto) 1fr;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--line);
  font-family: var(--font-mono);
  font-size: 13px;
}
.globe-notes .gn-item:last-child { border-bottom: 0; }
.globe-notes .gn-city { color: var(--amber); }
.globe-notes .gn-text { color: var(--text); white-space: pre-wrap; }
```

- [ ] **Step 5: 在 `globe.js` 接入选中内容统一渲染**

在初始化处校验依赖：

```js
var Core = window.GlobeCore;
if (!Core) {
  console.error("GlobeCore is missing");
  return;
}
```

删除 `cityNote()`、`regionMomentIds()` 和 `unionCityMoments()`，改为：

```js
function contentForTarget(key) {
  return Core.selectionContent(state.footprints, {
    layer: state.layer,
    country: state.country,
    province: state.province,
    selected: key,
  });
}

function selectedContent() {
  return contentForTarget(state.selected);
}

function updateSelectionPanels() {
  var content = selectedContent();
  updateNotes(content.notes);
  updateMomentLinks(content.momentIds);
}

function updateNotes(notes) {
  var box = document.getElementById("globe-notes");
  if (!box) return;
  if (!notes.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  var html = '<div class="gn-head">足迹笔记 ' + notes.length + " 条</div>";
  notes.forEach(function (item) {
    html += '<div class="gn-item"><span class="gn-city">' +
      Core.escapeHTML(item.city) + '</span><span class="gn-text">' +
      Core.escapeHTML(item.note) + "</span></div>";
  });
  box.innerHTML = html;
  box.style.display = "block";
}
```

将 `updateMomentLinks()` 改为接收 `ids` 参数，不再自行读取 `state.selected`。

`drawRegions()` 中城市关联瞬间标记和 `onMove()` 中光标判断改为
`contentForTarget(region.name).momentIds.length`。画布底部只保留区域名称；
完整笔记统一在 `.globe-notes` 面板展示，避免一条画布 note 与多条面板 note 冲突。

所有选中变化和 `updateChrome()` 末尾统一调用 `updateSelectionPanels()`。

- [ ] **Step 6: 国家标记增加选中视觉**

在 `drawGlobe()` 的国家标记循环内增加：

```js
var isSelected = state.layer === "globe" && state.selected === fp.code;
var pulse = isSelected ? 7 : 4 + Math.sin(t) * 1.6;
ctx.fillStyle = isSelected ? C.green : C.amber;
ctx.shadowColor = isSelected ? C.green : C.amber;
```

确保国家单击后即使地球继续转动，选中标记仍持续高亮。

- [ ] **Step 7: 接入单击和区域级双击判定**

在输入状态附近增加：

```js
var tapTracker = Core.createTapTracker(360);
var gestureEpoch = 0;

function cancelTapSequence() {
  gestureEpoch++;
  tapTracker.cancel();
}
```

发生拖动超过阈值、滚轮缩放、双指缩放时调用 `cancelTapSequence()`。

将 `onUp()` 的点击分支改为：

```js
function selectTarget(key) {
  state.selected = key;
  if (state.layer === "globe") drawGlobe();
  else drawRegions();
  updateSelectionPanels();
}

function registerTargetTap(layer, key) {
  selectTarget(key);
  return tapTracker.register(layer, key, Date.now(), gestureEpoch);
}

function warmCountryLegacy(fp) {
  return fetchRegion("/static/geo/regions/" + fp.code + ".json").catch(function () {});
}

function drillCountry(fp) { goCountry(fp); }
function drillCity(region) { goCity(region); }

if (state.layer === "globe") {
  var fp = pickCountry(p.x, p.y);
  if (!fp) {
    selectTarget(null);
    tapTracker.cancel();
  } else if (registerTargetTap("globe", fp.code)) {
    drillCountry(fp);
  } else {
    warmCountryLegacy(fp);
  }
} else if (state.layer === "country") {
  var region = pickRegion(p.x, p.y);
  if (!region) {
    selectTarget(null);
    tapTracker.cancel();
  } else if (registerTargetTap("country", region.name) && region.drill) {
    drillCity(region);
  } else if (region.drill) {
    warmDrill(region);
  }
} else if (state.layer === "city") {
  var city = pickRegion(p.x, p.y);
  selectTarget(city ? city.name : null);
  tapTracker.cancel();
}
```

此任务先保留 `drillCountry()` / `drillCity()` 为对现有 `goCountry()` / `goCity()` 的薄包装；Task 3 再改成事务式导航。
`warmCountryLegacy()` 仅用于保证该中间提交可运行；Task 4 会由统一 MapLoader 替换。

删除原有 `canvas.addEventListener("dblclick", ...)`，不再支持双击重置。

- [ ] **Step 8: 运行局部测试并检查静态语法**

Run:

```bash
node scripts/globe_core_test.mjs
node --check web/static/js/globe-core.js
node --check web/static/js/globe.js
go test ./...
```

Expected: 全部 PASS。

- [ ] **Step 9: 提交交互和面板改造**

```bash
git add web/static/js/globe-core.js web/static/js/globe.js \
  web/templates/public/home.html web/static/css/crt.css \
  scripts/globe_core_test.mjs
git commit -m "feat: 足迹地图改为选中后双击下钻" \
  -m "Co-authored-by: TRAE CLI <noreply@bytedance.com>"
```

---

### Task 3: 用导航快照实现完整返回恢复

**Files:**
- Modify: `web/static/js/globe.js:60-77`
- Modify: `web/static/js/globe.js:665-798`
- Modify: `web/static/js/globe.js:1014-1059`
- Modify: `web/templates/public/home.html:150-157`
- Modify: `web/static/css/crt.css:347-365`
- Test: `scripts/globe_core_test.mjs`

- [ ] **Step 1: 写导航栈恢复的失败测试**

在 `scripts/globe_core_test.mjs` 增加一个两级快照场景：

```js
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
```

Run:

```bash
node scripts/globe_core_test.mjs
```

Expected: FAIL，`Core.createHistory is not a function`。

- [ ] **Step 2: 在内核实现历史栈**

在 `globe-core.js` 新增并导出：

```js
function createHistory() {
  var stack = [];
  return {
    push: function (state) { stack.push(snapshotView(state)); },
    pop: function () { return stack.length ? stack.pop() : null; },
    popTo: function (layer) {
      while (stack.length) {
        var snap = stack.pop();
        if (snap.layer === layer) return snap;
      }
      return null;
    },
    size: function () { return stack.length; },
    clear: function () { stack.length = 0; },
  };
}
```

Run:

```bash
node scripts/globe_core_test.mjs
```

Expected: PASS。

- [ ] **Step 3: 把前进导航拆成“加载”和“提交”**

先在 `.globe-stage` 的 canvas 后增加加载状态：

```html
<canvas id="globe-canvas" width="440" height="440"></canvas>
<div id="globe-load-status" class="globe-load-status" hidden role="status"></div>
```

在 `crt.css` 增加：

```css
.globe-load-status {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 4;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 32px);
  padding: 7px 10px;
  color: var(--text);
  background: rgba(var(--overlay-rgb), 0.9);
  border: 1px solid var(--amber);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.globe-load-status.is-error { color: var(--amber); }
```

在 `globe.js` 增加：

```js
var history = Core.createHistory();
var navigationToken = 0;
var pendingNavigation = null;

function setLoadMessage(message, isError) {
  var box = document.getElementById("globe-load-status");
  if (!box) return;
  box.textContent = message;
  box.classList.toggle("is-error", !!isError);
  box.hidden = false;
}

function clearLoadMessage() {
  var box = document.getElementById("globe-load-status");
  if (!box) return;
  box.hidden = true;
  box.textContent = "";
  box.classList.remove("is-error");
}

function cancelPendingNavigation(nextLayer, nextKey) {
  if (!pendingNavigation) return;
  if (pendingNavigation.layer === nextLayer && pendingNavigation.key === nextKey) return;
  navigationToken++;
  pendingNavigation = null;
  clearLoadMessage();
}

function applyCountry(fp, data) {
  state.layer = "country";
  state.country = { code: fp.code, name: fp.name || fp.code };
  state.province = null;
  state.regionData = data;
  state.hover = null;
  state.selected = null;
  state.rv = { zoom: 1, panx: 0, pany: 0 };
  stopLoop();
  updateChrome();
  drawRegions();
  scrollToTop();
}

function applyCity(region, key, data) {
  state.layer = "city";
  state.province = { name: region.name, key: key };
  state.regionData = data;
  state.hover = null;
  state.selected = null;
  state.rv = { zoom: 1, panx: 0, pany: 0 };
  updateChrome();
  drawRegions();
  scrollToTop();
}
```

`drillCountry()` / `drillCity()` 必须遵循：

```js
function drillCountry(fp) {
  var token = ++navigationToken;
  pendingNavigation = { layer: "globe", key: fp.code };
  setLoadMessage("正在加载下一级地图…");
  return fetchRegion("/static/geo/regions/" + fp.code + ".json").then(function (data) {
    if (token !== navigationToken || state.selected !== fp.code) return;
    history.push(state);
    pendingNavigation = null;
    clearLoadMessage();
    applyCountry(fp, data);
  }).catch(function () {
    if (token === navigationToken) {
      pendingNavigation = null;
      setLoadMessage("加载失败，双击重试", true);
    }
  });
}

function drillCity(region) {
  if (!region.drill) return Promise.resolve();
  var key = drillKey(region);
  if (!key) return Promise.resolve();
  var token = ++navigationToken;
  pendingNavigation = { layer: "country", key: region.name };
  setLoadMessage("正在加载下一级地图…");
  var url = "/static/geo/regions/" + state.country.code + "/" + key + ".json";
  return fetchRegion(url).then(function (data) {
    if (token !== navigationToken || state.selected !== region.name) return;
    history.push(state);
    pendingNavigation = null;
    clearLoadMessage();
    applyCity(region, key, data);
  }).catch(function () {
    if (token === navigationToken) {
      pendingNavigation = null;
      setLoadMessage("加载失败，双击重试", true);
    }
  });
}
```

Task 4 再把两处 `fetchRegion()` 换成统一 MapLoader。加载失败时不得修改
`state.layer`、`state.regionData` 或 history。

在 Task 2 的 `selectTarget(key)` 开头调用：

```js
cancelPendingNavigation(state.layer, key);
```

因此用户等待期间改选其他区域或点击空白时，旧请求仍可完成并进入旧缓存，但 token
失效，不会自动切换层级。

- [ ] **Step 4: 实现统一快照恢复**

增加：

```js
function restoreSnapshot(snap) {
  if (!snap) return;
  navigationToken++;
  pendingNavigation = null;
  Core.restoreView(state, snap);
  clearLoadMessage();
  updateChrome();
  applyTouchAction();
  R = RBASE * state.gz;
  if (state.layer === "globe") {
    startLoop();
    drawGlobe();
  } else {
    stopLoop();
    drawRegions();
  }
  scrollToTop();
}

function goBack() {
  restoreSnapshot(history.pop());
}

function goBackTo(layer) {
  if (state.layer === layer) return;
  restoreSnapshot(history.popTo(layer));
}
```

返回按钮调用 `goBack()`；面包屑分别调用 `goBackTo("globe")` 或 `goBackTo("country")`；手机横滑继续调用 `goBack()`。

- [ ] **Step 5: 增加测试调试接口，仅在测试标志开启时暴露**

在 `globe.js` boot 前增加：

```js
if (window.__GLOBE_TEST__) {
  window.__globeDebug = {
    ready: function () { return !!world; },
    state: function () { return Core.snapshotView(state); },
    historySize: function () { return history.size(); },
    goBack: goBack,
    pause: stopLoop,
    focusCountry: function (code) {
      if (!world || !world.countries[code]) return false;
      stopLoop();
      state.rot.y = world.countries[code].c[0] * Math.PI / 180;
      state.vel = { x: 0, y: 0 };
      drawGlobe();
      return true;
    },
    countryPoint: function (code) {
      var fp = state.footprints.find(function (item) { return item.code === code; });
      if (!fp || !world || !world.countries[code]) return null;
      var center = world.countries[code].c;
      var point = project(center[0], center[1]);
      return point.visible ? { x: point.x, y: point.y } : null;
    },
    regionPoint: function (name) {
      if (!state.regionData) return null;
      var region = state.regionData.regions.find(function (item) { return item.name === name; });
      var center = region && largestPolyCentroid(region.polys);
      if (!center) return null;
      var transform = regionTransform();
      return {
        x: transform.ox + center[0] * transform.scale,
        y: transform.oy + center[1] * transform.scale,
      };
    },
  };
}
```

生产页面未设置 `window.__GLOBE_TEST__`，不会暴露接口。

- [ ] **Step 6: 运行测试**

Run:

```bash
node scripts/globe_core_test.mjs
node --check web/static/js/globe.js
```

Expected: PASS。

- [ ] **Step 7: 提交导航状态改造**

```bash
git add web/static/js/globe-core.js web/static/js/globe.js scripts/globe_core_test.mjs
git commit -m "feat: 恢复足迹地图下钻前视图" \
  -m "Co-authored-by: TRAE CLI <noreply@bytedance.com>"
```

---

### Task 4: 实现首帧后分阶段懒加载和请求去重

**Files:**
- Modify: `web/static/js/globe-core.js`
- Modify: `web/static/js/globe.js:630-739`
- Modify: `web/static/js/globe.js:1085-1105`
- Modify: `scripts/globe_core_test.mjs`

- [ ] **Step 1: 写加载队列去重、并发和重试的失败测试**

在 `scripts/globe_core_test.mjs` 增加 deferred fetch 测试：

```js
function deferred() {
  var resolve;
  var reject;
  var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
  return { promise: promise, resolve: resolve, reject: reject };
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
await a1;
await Promise.resolve();
assert.deepEqual(calls, ["A", "B", "C"]);

gates.get("B").reject(new Error("network"));
await assert.rejects(b);
const retry = loader.load("B");
assert.notEqual(retry, b, "失败后允许重试");
gates.get("C").resolve({ id: "C" });
await c;
await Promise.resolve();
assert.deepEqual(calls, ["A", "B", "C", "B"]);
gates.get("B").resolve({ id: "B retry" });
await retry;
```

- [ ] **Step 2: 写暂停后台任务但允许主动请求的失败测试**

继续增加：

```js
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
```

Run:

```bash
node scripts/globe_core_test.mjs
```

Expected: FAIL，`Core.createMapLoader is not a function`。

- [ ] **Step 3: 实现统一加载器**

在 `globe-core.js` 新增并导出 `createMapLoader(fetchJSON, maxConcurrent)`。实现必须满足：

```js
function createMapLoader(fetchJSON, maxConcurrent) {
  var active = 0;
  var paused = false;
  var entries = Object.create(null);
  var queue = [];

  function pump() {
    queue.sort(function (a, b) { return b.priority - a.priority; });
    while (active < maxConcurrent) {
      var index = queue.findIndex(function (entry) {
        return !paused || !entry.background;
      });
      if (index < 0) return;
      var entry = queue.splice(index, 1)[0];
      entry.status = "pending";
      active++;
      Promise.resolve().then(function (current) {
        return fetchJSON(current.url).then(function (data) {
          current.status = "fulfilled";
          current.data = data;
          current.resolve(data);
        }, function (error) {
          delete entries[current.url];
          current.reject(error);
        }).finally(function () {
          active--;
          pump();
        });
      }.bind(null, entry));
    }
  }

  function request(url, priority, background) {
    var existing = entries[url];
    if (existing) {
      if (existing.status === "fulfilled") return Promise.resolve(existing.data);
      if (!background) existing.background = false;
      existing.priority = Math.max(existing.priority, priority);
      pump();
      return existing.promise;
    }
    var resolve;
    var reject;
    var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
    var entry = {
      url: url,
      priority: priority,
      background: background,
      status: "queued",
      promise: promise,
      resolve: resolve,
      reject: reject,
    };
    entries[url] = entry;
    queue.push(entry);
    pump();
    return promise;
  }

  return {
    load: function (url) { return request(url, 100, false); },
    prefetch: function (url, priority) { return request(url, priority || 1, true); },
    setPaused: function (value) { paused = !!value; pump(); },
    peek: function (url) {
      var entry = entries[url];
      return entry && entry.status === "fulfilled" ? entry.data : null;
    },
  };
}
```

实现时不得在 Promise 回调里捕获错误的循环变量；测试必须覆盖 A/B/C 返回值对应正确 URL。

- [ ] **Step 4: 在 `globe.js` 统一所有地图请求**

替换 `regionCache` / `fetchRegion()`：

```js
var mapLoader = Core.createMapLoader(loadJSON, 2);

function countryMapURL(code) {
  return "/static/geo/regions/" + code + ".json";
}

function cityMapURL(countryCode, region) {
  var key = drillKey(region);
  return key ? "/static/geo/regions/" + countryCode + "/" + key + ".json" : null;
}

function loadCountryMap(fp, urgent) {
  var url = countryMapURL(fp.code);
  return urgent ? mapLoader.load(url) : mapLoader.prefetch(url, 20);
}

function warmCountry(fp) {
  return mapLoader.prefetch(countryMapURL(fp.code), 50).catch(function () {});
}

function warmDrill(region, priority) {
  var url = cityMapURL(state.country.code, region);
  if (!url) return Promise.resolve(null);
  return mapLoader.prefetch(url, priority || 10).catch(function () {});
}
```

`drillCountry()` / `drillCity()` 使用 `mapLoader.load()`。
删除 Task 2 的 `warmCountryLegacy()`，并让单击国家调用 `warmCountry(fp)`；
省份悬停或单击继续调用 `warmDrill(region, 50)`。

- [ ] **Step 5: 首帧完成后启动两阶段后台队列**

增加：

```js
function idle(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 1500 });
  } else {
    window.setTimeout(callback, 200);
  }
}

function prefetchPaused() {
  var connection = navigator.connection || {};
  return document.hidden || navigator.onLine === false || connection.saveData === true;
}

function syncPrefetchPause() {
  mapLoader.setPaused(prefetchPaused());
}

function startBackgroundWarmup() {
  syncPrefetchPause();
  idle(function () {
    state.footprints.forEach(function (fp) {
      loadCountryMap(fp, false).then(function (data) {
        var visitedNames = new Set(fp.provinces.map(function (p) { return p.name; }));
        var visited = [];
        var rest = [];
        data.regions.forEach(function (region) {
          if (!region.drill) return;
          (visitedNames.has(region.name) ? visited : rest).push({
            countryCode: fp.code,
            region: region,
          });
        });
        visited.concat(rest).forEach(function (item, index) {
          var url = cityMapURL(item.countryCode, item.region);
          if (url) mapLoader.prefetch(url, index < visited.length ? 10 : 1).catch(function () {});
        });
      }).catch(function () {});
    });
  });
}
```

监听：

```js
document.addEventListener("visibilitychange", syncPrefetchPause);
window.addEventListener("online", syncPrefetchPause);
window.addEventListener("offline", syncPrefetchPause);
```

Boot 时必须先完成首屏：

```js
Promise.all([loadJSON("/static/geo/world.json"), loadJSON("/api/footprints").catch(function () { return []; })])
  .then(function (res) {
    world = res[0];
    state.footprints = res[1] || [];
    updateChrome();
    drawGlobe();
    requestAnimationFrame(function () {
      startLoop();
      startBackgroundWarmup();
    });
  });
```

首个 `drawGlobe()` 调用前不得调用 `startBackgroundWarmup()`。

- [ ] **Step 6: 运行核心测试和语法检查**

Run:

```bash
node scripts/globe_core_test.mjs
node --check web/static/js/globe-core.js
node --check web/static/js/globe.js
```

Expected: PASS。

- [ ] **Step 7: 提交懒加载实现**

```bash
git add web/static/js/globe-core.js web/static/js/globe.js scripts/globe_core_test.mjs
git commit -m "perf: 首帧后懒加载足迹地图" \
  -m "Co-authored-by: TRAE CLI <noreply@bytedance.com>"
```

---

### Task 5: 为 Geo 数据增加版本与长期缓存

**Files:**
- Modify: `internal/render/render.go:18-105`
- Create: `internal/render/render_test.go`
- Modify: `internal/server/routes.go:8-15`
- Create: `internal/server/static_cache_test.go`
- Modify: `internal/export/export.go:140-154`
- Create: `internal/export/export_test.go`
- Modify: `web/templates/public/home.html:204-210`
- Modify: `web/static/js/globe.js:17-20`

- [ ] **Step 1: 写 Geo 聚合版本失败测试**

创建 `internal/render/render_test.go`：

```go
package render

import (
	"testing"
	"testing/fstest"
)

func TestBuildAssetVersionsIncludesGeoAggregate(t *testing.T) {
	staticFS := fstest.MapFS{
		"geo/world.json":          {Data: []byte(`{"world":1}`)},
		"geo/regions/CN.json":     {Data: []byte(`{"cn":1}`)},
		"js/globe.js":             {Data: []byte("console.log(1)")},
	}
	first := buildAssetVersions(staticFS)
	if first["/static/geo"] == "" {
		t.Fatal("missing aggregate geo version")
	}

	staticFS["geo/regions/CN.json"] = &fstest.MapFile{Data: []byte(`{"cn":2}`)}
	second := buildAssetVersions(staticFS)
	if first["/static/geo"] == second["/static/geo"] {
		t.Fatal("geo aggregate version did not change")
	}
	if first["/static/js/globe.js"] != second["/static/js/globe.js"] {
		t.Fatal("unrelated asset version changed")
	}
}

func TestAssetVersionHelperReturnsRawVersion(t *testing.T) {
	r := &Renderer{assetVer: map[string]string{"/static/geo": "abc123"}}
	if got := r.assetVersion("/static/geo"); got != "abc123" {
		t.Fatalf("assetVersion = %q, want abc123", got)
	}
}
```

Run:

```bash
go test ./internal/render -run 'TestBuildAssetVersionsIncludesGeoAggregate|TestAssetVersionHelper' -v
```

Expected: FAIL，缺少 Geo 聚合版本和 `assetVersion()`。

- [ ] **Step 2: 实现确定性的 Geo 聚合哈希**

在 `buildAssetVersions()` 中使用第二个 SHA-256 hasher；`fs.WalkDir` 按词法顺序遍历，因此按 `path + NUL + bytes + NUL` 写入即可：

```go
geoHash := sha256.New()
geoFiles := 0

// WalkDir 回调内：
if strings.HasPrefix(path, "geo/") {
	_, _ = io.WriteString(geoHash, path)
	_, _ = geoHash.Write([]byte{0})
	_, _ = geoHash.Write(b)
	_, _ = geoHash.Write([]byte{0})
	geoFiles++
}

// WalkDir 结束后：
if geoFiles > 0 {
	m["/static/geo"] = hex.EncodeToString(geoHash.Sum(nil))[:10]
}
```

新增：

```go
func (r *Renderer) assetVersion(path string) string {
	return r.assetVer[path]
}
```

并在 `funcMap()` 注册：

```go
"assetver": r.assetVersion,
```

补充 import：`io`、`strings`。

- [ ] **Step 3: 运行渲染测试**

Run:

```bash
go test ./internal/render -v
```

Expected: PASS。

- [ ] **Step 4: 写静态缓存中间件失败测试**

创建 `internal/server/static_cache_test.go`：

```go
package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCacheImmutable(t *testing.T) {
	h := cacheImmutable(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/geo/world.json?v=abc", nil))
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q", got)
	}
}
```

Run:

```bash
go test ./internal/server -run TestCacheImmutable -v
```

Expected: FAIL，`undefined: cacheImmutable`。

- [ ] **Step 5: 区分 Geo 与代码资源缓存**

在 `routes.go` 注册更具体的 Geo 路由：

```go
staticHandler := http.StripPrefix("/static/", http.FileServer(http.FS(s.static)))
s.mux.Handle("GET /static/geo/", cacheImmutable(staticHandler))
s.mux.Handle("GET /static/", noCache(staticHandler))
```

增加：

```go
func cacheImmutable(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		next.ServeHTTP(w, r)
	})
}
```

Run:

```bash
go test ./internal/server -run 'TestCacheImmutable|TestRecoverPanic' -v
```

Expected: PASS。

- [ ] **Step 6: 静态导出生成缓存规则**

在 `export.go` 增加基于 `base` 的规则生成函数：

```go
func hostingHeaders(base string) string {
	base = strings.TrimSuffix(base, "/")
	return fmt.Sprintf(`%s/static/geo/*
  Cache-Control: public, max-age=31536000, immutable
`, base)
}
```

在 `export.Run()` 复制静态资源后写入：

```go
if err := writeFile(filepath.Join(outDir, "_headers"), []byte(hostingHeaders(base))); err != nil {
	return err
}
```

创建 `internal/export/export_test.go`：

```go
package export

import "testing"

func TestHostingHeadersUsesBasePath(t *testing.T) {
	tests := []struct {
		name string
		base string
		want string
	}{
		{name: "root", base: "", want: "/static/geo/*"},
		{name: "subpath", base: "/personal-blog", want: "/personal-blog/static/geo/*"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := hostingHeaders(test.base)
			if !strings.Contains(got, test.want) {
				t.Fatalf("hostingHeaders(%q) = %q, want path %q", test.base, got, test.want)
			}
			if !strings.Contains(got, "max-age=31536000") {
				t.Fatalf("hostingHeaders(%q) = %q, missing one-year cache", test.base, got)
			}
		})
	}
}
```

补充 test import：`strings`。

- [ ] **Step 7: 动态地图 URL 使用 Geo 版本**

先在 `home.html` 把脚本配置改为：

```html
<script>
window.__BASE__ = "{{.Base}}";
window.__GEO_VERSION__ = "{{assetver "/static/geo"}}";
</script>
```

在 `globe.js` 初始化：

```js
var GEO_VERSION = window.__GEO_VERSION__ || "";

function versionedDataURL(url) {
  if (GEO_VERSION && url.indexOf("/static/geo/") === 0) {
    url += (url.indexOf("?") >= 0 ? "&" : "?") + "v=" + encodeURIComponent(GEO_VERSION);
  }
  return BASE && url.charAt(0) === "/" ? BASE + url : url;
}

function loadJSON(url) {
  var requestURL = versionedDataURL(url);
  var isGeo = url.indexOf("/static/geo/") === 0;
  return fetch(requestURL, { cache: isGeo ? "force-cache" : "default" }).then(function (response) {
    if (!response.ok) throw new Error(response.status + " " + requestURL);
    return response.json();
  });
}
```

MapLoader 的 key 继续使用未加 `BASE` 的逻辑 URL；版本化只发生在 `loadJSON()`，避免同一资源因 URL 拼接顺序不同而失去去重。
`force-cache` 让不支持 `_headers` 的静态托管也优先复用本机 HTTP 缓存；内容哈希版本变化后 URL 改变，不会复用旧地图。

- [ ] **Step 8: 运行 Go 和 JS 测试**

Run:

```bash
gofmt -w internal/render/render.go internal/render/render_test.go \
  internal/server/routes.go internal/server/static_cache_test.go \
  internal/export/export.go internal/export/export_test.go
go test ./internal/render ./internal/server ./internal/export
node scripts/globe_core_test.mjs
```

Expected: PASS。

- [ ] **Step 9: 提交资源缓存改造**

```bash
git add internal/render/render.go internal/render/render_test.go \
  internal/server/routes.go internal/server/static_cache_test.go \
  internal/export/export.go internal/export/export_test.go \
  web/templates/public/home.html web/static/js/globe.js
git commit -m "perf: 缓存版本化足迹地图资源" \
  -m "Co-authored-by: TRAE CLI <noreply@bytedance.com>"
```

---

### Task 6: 浏览器回归测试与端到端验证

**Files:**
- Modify: `scripts/globe_test.mjs`
- Modify: `scripts/package.json`
- Modify: `scripts/globe_logic_test.mjs`
- Test: all changed files

- [ ] **Step 1: 重写浏览器启动，先复现现有硬编码失败**

先运行现有脚本：

```bash
BASE=http://127.0.0.1:8199 node scripts/globe_test.mjs
```

Expected: 当前环境 FAIL，表现为 Chrome 121 DevTools WebSocket `ECONNRESET`。保存该输出作为测试工具修复的红灯证据。

- [ ] **Step 2: 改用 `puppeteer.launch()` 和可配置 Chrome**

将硬编码远程调试端口替换为：

```js
import { existsSync } from "node:fs";

const candidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Users/bytedance/.cache/puppeteer/chrome/mac_arm-121.0.6167.85/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
].filter(Boolean);
const executablePath = candidates.find(existsSync);
if (!executablePath) throw new Error("Chrome not found; set CHROME_BIN");

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1000, height: 900 },
});
```

使用 `try/finally` 保证 `await browser.close()`。

- [ ] **Step 3: 在浏览器测试注入 Footprint 数据和请求计数**

在页面加载前：

```js
await page.evaluateOnNewDocument(() => {
  window.__GLOBE_TEST__ = true;
  window.__globeIdleCallbacks = [];
  window.requestIdleCallback = (callback) => {
    window.__globeIdleCallbacks.push(callback);
    return window.__globeIdleCallbacks.length;
  };
});
await page.setRequestInterception(true);
const requests = [];
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
  if (url.pathname.startsWith("/static/geo/")) requests.push(url.pathname);
  request.continue();
});
```

- [ ] **Step 4: 验证首屏与后台懒加载时序**

等待首屏状态和 idle 任务已排队，但先不执行 idle callback：

```js
await page.waitForFunction(() =>
  window.__globeDebug?.ready() && window.__globeIdleCallbacks.length > 0
);
assert.deepEqual(
  requests.filter((path) => path.includes("/regions/")),
  [],
  "首屏国家地球绘制前不请求省市地图",
);
await page.evaluate(() => {
  const callbacks = window.__globeIdleCallbacks.splice(0);
  callbacks.forEach((callback) => callback({
    didTimeout: false,
    timeRemaining: () => 50,
  }));
});
```

随后等待后台队列，确认 `/static/geo/regions/CN.json` 及广东城市地图最终被请求，且每个 pathname 只出现一次。

- [ ] **Step 5: 验证单击、双击和笔记面板**

使用 `window.__globeDebug.focusCountry()`、`countryPoint()` 和 `regionPoint()` 获取稳定的
canvas 相对坐标；点击前先聚焦并停止地球自转。坐标直接在页面上下文中读取：

```js
await page.evaluate(() => window.__globeDebug.focusCountry("CN"));
const countryPoint = await page.evaluate(() => {
  const canvas = document.getElementById("globe-canvas");
  const rect = canvas.getBoundingClientRect();
  const point = window.__globeDebug.countryPoint("CN");
  return { x: rect.left + point.x, y: rect.top + point.y };
});
```

省份和城市坐标直接使用同样的 `getBoundingClientRect() + regionPoint(name)` 模式，
不使用 `Function` 或像素颜色猜测。操作顺序：

1. 单击 CN。
2. 断言 breadcrumb 仍为 `~/globe`。
3. 断言笔记面板隐藏、瞬间面板显示。
4. 等待 400ms 让单击窗口过期，再对同一坐标快速点击两次（间隔 80ms）。
5. 等待 breadcrumb 进入 `~/globe/CN`。
6. 使用 `window.__globeDebug.regionPoint("广东省")` 得到点击坐标。
7. 单击广东省。
8. 断言 `.globe-notes` 含两条深圳笔记且顺序正确。
9. 断言 `.globe-moment-links` 去重显示关联瞬间。
10. 等待 400ms，再快速点击广东省两次，进入城市层级。

- [ ] **Step 6: 验证缩放、选中和返回恢复**

进入城市前通过滚轮放大并拖动省份地图，记录：

```js
const before = await page.evaluate(() => window.__globeDebug.state());
```

城市层级点击返回按钮后：

```js
const after = await page.evaluate(() => window.__globeDebug.state());
assert.deepEqual(after.rv, before.rv);
assert.equal(after.selected, before.selected);
assert.equal(after.layer, "country");
assert.equal(await page.$eval("#globe-notes", (el) => el.style.display), "block");
```

重复一次面包屑跨级返回。横滑返回使用 Chrome DevTools Protocol 发送真实触摸序列：

```js
const client = await page.target().createCDPSession();
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
```

执行横滑前先通过调试状态确认当前平面地图 `rv.zoom === 1`，符合产品约定的横滑返回条件。

- [ ] **Step 7: 为 Node 测试增加统一命令**

修改 `scripts/package.json`：

```json
{
  "scripts": {
    "test": "node globe_core_test.mjs && node globe_logic_test.mjs",
    "test:browser": "node globe_test.mjs"
  }
}
```

- [ ] **Step 8: 运行专项测试**

Run:

```bash
cd scripts && npm test
```

Expected: `globe_core_test.mjs` 和 `globe_logic_test.mjs` 全部 PASS。

- [ ] **Step 9: 使用临时数据库启动服务并运行浏览器测试**

Run:

```bash
tmp_dir="$(mktemp -d /tmp/s-blog-footprint-test.XXXXXX)"
trap 'kill "${server_pid:-}" 2>/dev/null || true; rm -rf "$tmp_dir"' EXIT
ADDR=127.0.0.1:8199 DB_PATH="$tmp_dir/blog.db" REPO_DIR="$tmp_dir" \
  go run . serve >"$tmp_dir/server.log" 2>&1 &
server_pid=$!
for _ in $(seq 1 80); do
  curl -fsS http://127.0.0.1:8199/internal/ready >/dev/null && break
  sleep 0.25
done
BASE=http://127.0.0.1:8199 node scripts/globe_test.mjs
```

Expected: PASS，退出码 0；失败时输出浏览器 console、请求列表和服务日志。

- [ ] **Step 10: 验证静态导出及子路径**

Run:

```bash
tmp_dir="$(mktemp -d /tmp/s-blog-export-test.XXXXXX)"
DB_PATH="$tmp_dir/blog.db" go run . export "$tmp_dir/root"
BASE_URL=/personal-blog DB_PATH="$tmp_dir/blog.db" go run . export "$tmp_dir/subpath"
rg -n '__GEO_VERSION__|globe-core.js|globe.js' \
  "$tmp_dir/root/index.html" "$tmp_dir/subpath/index.html"
cat "$tmp_dir/root/_headers"
```

Expected:

- 根路径脚本为 `/static/js/...`。
- 子路径脚本为 `/personal-blog/static/js/...`。
- 两者都注入非空 `__GEO_VERSION__`。
- `_headers` 包含 `/static/geo/*` 和一年缓存。

- [ ] **Step 11: 运行全量验证**

Run:

```bash
gofmt -w internal/render/render.go internal/render/render_test.go \
  internal/server/routes.go internal/server/static_cache_test.go \
  internal/export/export.go internal/export/export_test.go
go test ./...
node scripts/globe_core_test.mjs
node scripts/globe_logic_test.mjs
git diff --check
git status --short
```

Expected:

- 所有 Go package PASS。
- 两个 Node 逻辑测试 PASS。
- `git diff --check` 无输出。
- `git status --short` 只包含本任务预期文件。

- [ ] **Step 12: 重启本地后台并做人工检查**

停止并重新提交当前 `launchd` 任务，让新代码生效：

```bash
launchctl remove com.trae.s-blog.personal 2>/dev/null || true
launchctl submit -l com.trae.s-blog.personal \
  -o /tmp/s_blog-personal-blog.log \
  -e /tmp/s_blog-personal-blog.log -- \
  /bin/bash -c "cd '$PWD' && exec env HOME='$HOME' \
  PATH='/Users/bytedance/go/go/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' \
  ADDR='127.0.0.1:8081' DB_PATH='$PWD/blog.db' REPO_DIR='$PWD' \
  /Users/bytedance/go/go/bin/go run . serve"
open http://127.0.0.1:8081/#footprint
```

人工检查桌面鼠标和触控板：

- 单击国家、双击国家。
- 单击省份、双击省份。
- 省份笔记和关联瞬间顺序。
- 放大/平移后进入城市并返回。
- 面包屑返回。

- [ ] **Step 13: 提交浏览器回归和最终实现**

```bash
git add scripts/globe_test.mjs scripts/globe_logic_test.mjs scripts/package.json \
  web/static/js/globe.js web/static/js/globe-core.js \
  web/templates/public/home.html web/static/css/crt.css \
  internal/render internal/server internal/export
git commit -m "test: 覆盖足迹地图下钻与返回流程" \
  -m "Co-authored-by: TRAE CLI <noreply@bytedance.com>"
```

---

## 最终验收清单

- [ ] 国家单击只选中并显示瞬间，不显示笔记、不下钻。
- [ ] 国家双击或双点才进入省份层级。
- [ ] 省份单击展示所有非空城市笔记和去重瞬间。
- [ ] 省份双击或双点才进入城市层级。
- [ ] 城市单击展示该城市全部记录；城市双击无动作。
- [ ] 双击重置缩放已移除。
- [ ] 返回按钮、面包屑、横滑均恢复完整快照。
- [ ] 加载失败不切层、不压栈，可双击重试。
- [ ] 首屏只加载 `world.json` 和 `/api/footprints`。
- [ ] 首帧后才启动省市后台队列。
- [ ] 队列并发不超过 2，后台与主动请求去重。
- [ ] 隐藏页、离线、节省流量暂停后台请求，主动请求仍可执行。
- [ ] Geo URL 带聚合内容版本。
- [ ] 本地服务和静态托管对 Geo 使用长期缓存。
- [ ] `go test ./...`、Node 逻辑测试和浏览器回归测试全部通过。
