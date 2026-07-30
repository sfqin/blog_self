# Footprint Drill Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Footprint 地图中明确提示“ 双击进入下一级 ”，并在没有下一级的城市层自动隐藏。

**Architecture:** 在地图舞台左上角增加一组覆盖层控件，包含现有返回按钮和新的只读提示标签。现有 `updateChrome()` 继续作为层级 UI 的唯一同步入口，根据 `state.layer` 控制返回按钮文案及提示显隐。

**Tech Stack:** Go `html/template`、原生 JavaScript、CSS、Puppeteer Core。

---

### Task 1: 用浏览器测试定义提示显隐规则

**Files:**
- Modify: `scripts/globe_test.mjs`

- [x] **Step 1: 写失败测试**

在地图首屏加载后断言 `#globe-drill-hint` 的文案为 `双击进入下一级` 且可见；进入省份层后再次断言可见；进入城市层后断言隐藏；返回省份层后断言重新显示。

- [x] **Step 2: 运行测试并确认因缺少提示元素而失败**

Run:

```bash
cd scripts
BASE=http://127.0.0.1:8081 npm run test:browser
```

Expected: FAIL，错误指向找不到 `#globe-drill-hint`。

### Task 2: 实现层级提示

**Files:**
- Modify: `web/templates/public/home.html`
- Modify: `web/static/css/crt.css`
- Modify: `web/static/js/globe.js`

- [x] **Step 1: 增加提示元素和控件容器**

在 `.globe-stage` 中使用 `.globe-controls` 包裹返回按钮，并增加：

```html
<span id="globe-drill-hint" class="globe-drill-hint" role="note">双击进入下一级</span>
```

- [x] **Step 2: 增加提示样式**

将左上角绝对定位移到 `.globe-controls`，用横向布局并排返回按钮与提示；提示使用弱化的终端样式，不能带按钮手型。

- [x] **Step 3: 同步层级状态**

在 `updateChrome()` 中获取 `#globe-drill-hint`，地球层和省份层显示，城市层隐藏：

```js
if (hint) {
  hint.style.display = state.layer === "city" ? "none" : "inline-flex";
}
```

- [x] **Step 4: 重启本地服务并验证浏览器测试通过**

Run:

```bash
launchctl remove com.trae.s-blog.personal
launchctl submit -l com.trae.s-blog.personal -- /bin/bash -c \
  "cd '/Users/bytedance/PycharmProjects/s_blog' && exec env HOME='/Users/bytedance' PATH='/Users/bytedance/go/go/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' ADDR='127.0.0.1:8081' DB_PATH='/Users/bytedance/PycharmProjects/s_blog/blog.db' REPO_DIR='/Users/bytedance/PycharmProjects/s_blog' /Users/bytedance/go/go/bin/go run . serve >>/tmp/s_blog-personal-blog.log 2>&1"
cd scripts
BASE=http://127.0.0.1:8081 npm run test:browser
```

Expected: PASS，提示在地球层、省份层和返回省份层时可见，在城市层隐藏。

### Task 3: 本地预览验收

**Files:**
- No code changes.

- [x] **Step 1: 运行快速回归**

Run:

```bash
go test ./...
cd scripts && npm test
```

Expected: 所有 Go 与地图纯逻辑测试通过。

- [x] **Step 2: 检查本地页面**

Run:

```bash
curl -f http://127.0.0.1:8081/
curl -f http://127.0.0.1:8081/admin
```

Expected: 两个地址均返回 HTTP 200；用户可打开 `http://127.0.0.1:8081/#footprint` 预览。
