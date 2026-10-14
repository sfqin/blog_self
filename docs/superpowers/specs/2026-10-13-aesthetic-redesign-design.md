# 博客公开站「星夜远行」美学重构设计

> 日期：2026-10-13
> 状态：8 个设计小节已逐节确认；用户已授权直接实现并发布 GitHub Pages
> 角色：TRAE CLI 是项目 owner 和架构负责人，负责拆包、合并和验收；各工作包（WP）可以分给不同 agent 并行实现
> 仓库：`blog_self` 是开源模板（本仓库，上游）；`s_blog` 是个人实例（下游，最终使用方）

## 0. 执行 agent 必读

- 本文是唯一事实来源。原型页只用来看「长什么样、怎么动」；原型和本文冲突时，以本文为准。
- 只改自己 WP 名下的文件（见第 6 节）。需要改别人的文件时，停下来找 owner，不要顺手改。
- 一个 WP 算完成，需要同时满足两条：该 WP 的「验收」全部通过；第 9 节的通用检查全部通过。
- 不得 push，不得合并到 `master`，不得发布或部署，不得改 `s_blog`。这些操作都需要用户单独授权，由 owner 执行。
- blog_self 是开源仓库。提交中不得出现以下内容：
  - 个人数据：真实姓名、邮箱、备案号、`s_blog` 的足迹
  - 原型页（`.superpowers/`）
  - 任何 `*.db` 文件
- 没有运行时依赖，也没有构建步骤：只用原生 JS 和 CSS，不引入框架、CDN 或打包器。
- 每条 commit message 用中文 Conventional 风格（如 `feat: …`、`test: …`），结尾带：
  `Co-authored-by: TRAE CLI <noreply@bytedance.com>`

## 1. 目标

1. 公开站（首页 + 文章页）整体改为「星夜远行」视觉：深夜星空背景、流金衬线大字、金色细线，替换现有的 CRT 终端风。
2. 每个模块各配一个有记忆点的动效，并且都能降级：在 `prefers-reduced-motion`、触屏、无 JS 三种情况下，内容都能完整阅读。
3. 保留星座导航：
   - 首屏显示星座。
   - 滚动后，桌面端停靠为右侧星轨，手机端变为底部星点栏。
   - 停靠后它同时承担章节导航和阅读进度。
4. 足迹地球放在第三章「III · 足迹」，不做首屏。
   - 保留单击选中、双击下钻，以及「双击进入下一级」提示。
   - 新增出发地航线（F1）和数字滚动（F3）。
5. 文章页适合长时间阅读：使用不透明阅读面板，可一键切换夜间 / 纸页。
6. 退役 26 套主题（A–Z）和后台「主题」入口，公开站只保留这一套设计。
7. 完成后通过 Git 合并进 `s_blog`，保留它的备案号和运维网关差异。

## 2. 非目标

- 不改后台（`/admin`、`/setup`）外观；只删除主题入口。
- 不改数据库结构。`profile.theme` 列保留但不再使用。
- 足迹地图的以下机制保持不变：
  - 下钻判定
  - 地图懒加载
  - 返回快照
  - geo 缓存版本化
  - 后台预热顺序
- 不新增文章封面字段。文章悬停封面从正文第一张图推导。
- 首页不提供亮色模式。纸页模式只在文章页提供。

## 3. 现状速览（`2c159ec`）

| 关注点 | 位置 | 现状 |
|---|---|---|
| 模板加载 | `internal/render/render.go` | 解析 `templates/*/*.html`，新增 `public/_*.html` 会自动生效；`define` 名全局唯一（后台已用 `admin_head`、`admin_foot`）。funcMap 有 `markdown`、`year`、`now`、`asset`（自动加 `?v=hash`）、`assetver` |
| Markdown | 同上 | goldmark + GFM + 硬换行；**不生成标题 id** |
| 首页视图模型 | `internal/server/handlers_public.go` 的 `homeData`（字段全是 `any`）；`internal/export/export.go` 的 `homeVM`（强类型） | 两边字段名必须一致 |
| 文章页数据 | 在线：`{"Base":"","Live":true,"Post","Profile"}`；导出：`{"Base","Post","Profile"}` | map 缺少的键取零值，不报错 |
| 静态资源缓存 | `internal/server/routes.go:16-17` | `/static/geo/` 为 immutable，其余 `/static/` 为 no-cache；导出时 `hostingHeaders(base)` 只给 geo 写 immutable 规则 |
| 主题 | `profile.theme`、`ValidTheme`、`?preview_theme=`、`/admin/theme`、`web/static/css/themes/A–Z.css`、`crt.css` 的 token 契约 | 本次退役（见 5.7） |
| 公开页样式 | 只依赖 `crt.css` + 主题文件 + Google Fonts | 新公开页**不再加载** `crt.css`。凡是 JS 生成、原先由 `crt.css` 负责样式的类，都要在新 CSS 里重写（清单见 7.2） |
| 地球 | `web/static/js/globe.js`（1322 行）、`globe-core.js`（纯函数，Node 可测） | `readTheme()` 从 `:root` 读取 CSS 变量；`resize()` 写死为 `min(innerWidth-40, 440)`；画布字体写死 IBM Plex Mono |
| 测试 | `go test ./...`；`scripts/globe_core_test.mjs`、`globe_logic_test.mjs`（Node）；`scripts/globe_test.mjs`（puppeteer，默认 `http://127.0.0.1:8199`） | 浏览器测试会拦截 `/api/footprints`，返回广东 3 条测试数据 |
| `dist/` | 在 blog_self 中被跟踪（Pages 用） | 当前内容是用含个人资料的数据导出的，见 11 节 O1 |

## 4. 视觉系统（§1 已确认）

### 4.1 设计 token（定义在 `site.css` 的 `:root`）

公开页的颜色、字体、动效时长一律通过以下变量引用，不在组件里写死色值（canvas 除外，canvas 也从变量读取）。

```css
:root {
  /* 背景与文字 */
  --bg-0: #030305;            /* 最深 */
  --bg-1: #07080d;            /* 页面主背景 */
  --bg-glow: #16203a;         /* 径向辉光 */
  --text: #e9e7e2;
  --text-strong: #fbf5e6;
  --muted: #8b8fa0;
  --muted-2: #5d6070;

  /* 金 */
  --gold: #e8c58a;
  --gold-hi: #f3dcae;
  --gold-lo: #c99a52;
  --gold-rgb: 232, 197, 138;
  --hairline: rgba(232, 197, 138, .18);
  --glass: rgba(10, 12, 20, .72);   /* 玻璃导航 / 星点栏底色 */

  /* 字体 */
  --font-serif: "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif;   /* 标题 / 大名字 */
  --font-num: "Bodoni Moda", "Didot", "Bodoni 72", Georgia, serif;          /* 罗马数字 / 日期 / 统计数字 */
  --font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;  /* 正文 / UI */
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;          /* 代码 / 小标签 */

  /* 动效 */
  --ease: cubic-bezier(.2, .8, .2, 1);
  --t-fast: 180ms;
  --t-mid: 480ms;
  --t-slow: 900ms;

  /* 布局 */
  --nav-h: 64px;
  --container: 1080px;
  --read-w: 680px;

  /* 地球（globe.js readTheme() 读取，名称不得改动） */
  --accent: #e8c58a;          /* 选中 / 主强调（原绿色位） */
  --accent-2: #f3dcae;        /* 标记 / 下钻高亮（原琥珀位） */
  --accent-rgb: 232, 197, 138;
  --accent-2-rgb: 243, 220, 174;
  --overlay-rgb: 10, 12, 20;  /* 画布标签底 / 返回按钮 / 灯箱 */
  --globe-ocean1: #0d1426;
  --globe-ocean2: #05070d;
  --globe-land: #1a2236;
  --globe-land-line: #2a3450;
  --globe-border: #2f3a58;
  --globe-region: rgba(26, 34, 54, .7);
  --globe-region-line: #34405f;
}
```

文章页在 `<html data-reading="night|paper">` 下额外覆盖以下 token：

| token | night | paper |
|---|---|---|
| `--read-page` | `#0e1017` | `#f3eee4` |
| `--read-panel` | `#131622` | `#f3eee4`（与页面同色，靠细线分隔） |
| `--read-text` | `#e4ddcc` | `#3d362b` |
| `--read-heading` | `#fbf5e6` | `#2a241b` |
| `--read-accent` | `#e8c58a` | `#8a6a3a` |
| `--read-accent-2` | `#f3dcae` | `#c99a52` |
| `--read-code-bg` | `#0b0d14` | `#ebe4d6` |
| `--read-hairline` | `rgba(232,197,138,.18)` | `rgba(138,106,58,.22)` |

对比度要求：正文对面板，night ≥ 13:1，paper ≥ 10:1。WP3 用 `scripts/contrast_check.mjs` 计算并写入测试（第 8 节）。

### 4.2 字体（WP0）

- **Noto Serif SC SemiBold（600）**，只这一个字重，用于标题、大名字、导航品牌和首字下沉。
  - 子集范围：GB2312 一级 + 二级 6763 个汉字 + 中文标点 + 基本拉丁（U+0020–007E）+ `·—…「」『』《》`。
  - 用 `pyftsubset` 切成约 100 个 `unicode-range` 分片（woff2），`font-display: swap`。
  - 首屏通常只命中 2–5 个分片（约 200–500KB），仓库总增量约 3–6MB。
- **Bodoni Moda**：只取拉丁数字、罗马数字字母、`·.—/` 子集，字重 500 与 700 各一份，用于数字。
- 正文和 UI 用系统无衬线（`--font-sans`），代码用系统等宽，不下载。
- 文件布局：

  ```
  web/static/fonts/
    fonts.css                       # 全部 @font-face，site.css 之前加载
    OFL.txt                         # 两个字体的 SIL OFL 1.1 许可全文 + 版权行
    noto-serif-sc/600-000.woff2 …   # 分片，序号三位
    bodoni-moda/500.woff2
    bodoni-moda/700.woff2
  scripts/fonts/
    build-fonts.sh                  # 开发期脚本：下载源字体 → pyftsubset 切片 → 生成 fonts.css；输出提交进仓库
    README.md                       # 依赖（python3 + fonttools + brotli）、源字体 URL 与校验和、重建步骤
  ```

- 生成产物必须可复现：脚本固定源字体的版本 URL 和 sha256，脚本不提交下载下来的源字体。
- 公开页删除所有 `fonts.googleapis.com` / `fonts.gstatic.com` 引用。后台模板保留 Google Fonts，不在本次范围内。

### 4.3 背景与外框

- 页面背景：`radial-gradient(120% 90% at 70% 0%, var(--bg-glow) 0%, var(--bg-1) 55%, var(--bg-0) 100%)`，固定在视口，不随滚动。
- 星空 `#starfield` 是 `position:fixed` 的全屏 canvas，`z-index:-2`，`pointer-events:none`。
- 光标聚光 `.spotlight` 也是 fixed，背景为 `radial-gradient(380px circle at var(--mx) var(--my), rgba(var(--gold-rgb), .11), transparent 65%)`，由 `starfield.js` 写入 `--mx` / `--my`。
- 不再使用 CRT 扫描线和暗角，公开页不输出 `.crt-scanlines` / `.crt-vignette`。
- 玻璃导航 `.site-nav`：
  - 固定在顶部，高度 `--nav-h`。
  - 滚动不足 40px 时背景透明；超过 40px 后加 `.is-solid`，背景 `--glass`，配 `backdrop-filter: blur(16px)` 和底部 1px `--hairline`。
- 容器 `.container`：`max-width: var(--container)`，左右内边距 `clamp(20px, 5vw, 48px)`。

### 4.4 动效总则

- 只对 `transform`、`opacity`、`filter`、`clip-path` 做动画，不对 `width`、`height`、`top`、`left`、`box-shadow` 做动画。
- 全站共用：
  - 一个 IntersectionObserver：`motion.js` 中的 `Motion.observe`。
  - 一个 rAF 循环：`motion.js` 中的 `Motion.loop`。
  - 地球保留自己的循环，不并入。
- 页面隐藏（`visibilitychange`）时暂停循环。
- 能力判定统一由 `motion.js` 导出，其他模块不自行判断：

  ```js
  Motion.reduced  // matchMedia("(prefers-reduced-motion: reduce)").matches，并监听变化
  Motion.touch    // matchMedia("(hover: none), (pointer: coarse)").matches
  ```

- 不用宽度判断设备能力。宽度只决定布局：≥768 用星轨，<768 用星点栏，<600 时地球全宽。
- 无 JS 时，所有 `[data-reveal]`、逐字动画元素都直接可见。实现方式是：CSS 只在 `html.js` 下才设置初始隐藏态；`<head>` 里的内联脚本第一行执行 `document.documentElement.classList.add("js")`。

## 5. 已确认的设计（§2–§8）

### 5.1 首页结构与章节顺序

章节顺序（星座顺序与 DOM 顺序一致）：

| # | 中文标题 | 英文副标题 | section id | 星座计数文案 | 空判定（为空则不渲染 section，星座显示暗星） |
|---|---|---|---|---|---|
| 1 | 关于 | ABOUT | `about` | `whoami` | `AboutMD`、`StackTags`、`Location` 全为空 |
| 2 | 经历 | JOURNEY | `experience` | `N 段` | `len(Experiences)==0` |
| 3 | 足迹 | FOOTPRINTS | `footprint` | `X 国 · Z 处` | `len(Footprints)==0` |
| 4 | 文章 | WRITING | `notes` | `N 篇` | `len(Posts)==0` |
| 5 | 项目 | WORKS | `projects` | `N 个` | `len(Projects)==0` |
| 6 | 思考 | THOUGHTS | `thoughts` | `N 条` | `len(Thoughts)==0` |
| 7 | 瞬间 | MOMENTS | `moments` | `N 刻` | `len(Moments)==0` |

- 罗马数字按**实际渲染的章节**连续编号。例如文章为空时，项目编号为 IV。
  - 编号由 `homeNav` 生成（见 7.4），模板只读取 `.Numeral`，不自己计数。
- 足迹的 `X`、`Z` 与 F3 同口径（见 5.4）。
- section id 一律保持原值。`search.js` 的锚点（`/#about` 等）和地球的 `#moment-{id}` 都依赖这些 id。
- 公开页不再出现：
  - 任何 `/admin` 文案或链接
  - 「// 暂无…」空态
  - 命令行前缀（`$ `、`cat …`、`ls -lt …`）
- 页脚：`© {year} {Name 或 "dev@home"} · built with blog_self`，上方一条金色细线。s_blog 会在页脚追加备案行（见 5.8）。

### 5.2 Hero 与星座导航（§2）

**Hero `<header class="hero" id="top">`**

- 高度 `100svh`，最小 560px。
- **小标签 `.hero-eyebrow`**：`{Title} · EST. {Location}`。
  - Location 为空时省略后半段。
  - 字体 mono，10px，字距 .34em，`--gold` 70%。
- **大名字 `h1.hero-name`**：Noto Serif SC 600，`clamp(44px, 9vw, 112px)`，字距 .06em。
  - 每个字一个 `<span class="ch" style="--i:N">`，由 `splitChars` 生成（见 7.4），依次升起，间隔 0.12s。
  - 升起关键帧：`opacity:0; transform:translateY(40%) rotateX(-60deg); filter:blur(10px)` → 无变换，1.3s，`--ease`。
  - 字面金色流光：`linear-gradient(100deg, #a8854c 0%, #f3dcae 32%, #fff 46%, #f3dcae 60%, #a8854c 100%)`，`background-size: 300% 100%`，配 `background-clip: text`，7s 线性循环。
- **职位 `.hero-title`**：sans，字距 .3em，`--muted`。
- **标语 `.hero-tagline`**：serif。服务端用 `splitPhrases` 按 `，。—` 切成短语（标点留在前一个短语末尾），每个短语一个 `<span style="--i:N">`，依次淡入，间隔 0.12s。
- **按钮 `.hero-actions`**：GitHub / Email，字段为空就不输出，带 `data-magnetic`（G3）。不再有 `./modules/footprint` 按钮。
- **底部 `.scroll-cue`**：`SCROLL` + 一条伸缩细线。
- **视差**：滚动时 hero 文本以 0.3 倍速上移并淡出；滚过 hero 高度后停止计算。
- **星空 `#starfield`**（`starfield.js`）：
  - 约 230 颗星，触屏约 120 颗。
  - 每颗星属性 `{x, y, r: .2–1.4, z: .1–1, phase, speed}`。
  - 鼠标偏移 × `z` 形成三层视差；按 `phase` 闪烁。
  - 鼠标位置写入 `--mx` / `--my`，驱动 `.spotlight`。

**星座 `<nav class="constellation">`（服务端渲染，由 `site_constellation` partial 输出）**

```html
<nav class="constellation" id="constellation" aria-label="站点导航">
  <a class="star" href="#about" data-key="about" data-count="whoami" data-weight="1.00" style="--w:1.00"><i></i><b>关于</b><em>whoami</em></a>
  <a class="star" href="#experience" data-key="experience" data-count="3 段" data-weight="1.32" style="--w:1.32"><i></i><b>经历</b><em>3 段</em></a>
  <a class="star" data-key="notes" data-off aria-disabled="true" tabindex="-1"><i></i><b>文章</b><em>即将点亮</em></a>
  …
</nav>
```

- **`data-weight`**：`1 + 0.45·ln(1+n)/ln(1+max_n)`，保留两位小数。
  - `n` 为该模块条数；足迹取「处」数 Z；关于固定为 1.00。
  - `max_n` 取所有亮星模块中最大的 n；`max_n==0` 时全部为 1.00。
- **`data-off` 暗星**：缩放 0.75，透明度 .35，文案「即将点亮」。
  - 没有 `href`，不可点击，不可聚焦。
  - 与相邻星的连线为虚线暗线。
- **无 JS 时**：星座是一排普通锚点，可以正常跳转。
- **`constellation.js` 的职责**：
  - 读取这些 `<a>`，在 `.constellation` 内插入一个 SVG，画出连线 `line.base`（底线）和 `line.prog`（进度线）以及光晕。
  - 把 `<a>` 绝对定位到计算出的坐标。
  - 悬停显示 `data-count`。

**首屏布局（≥768px）**

- 7 颗星分布在 hero 右侧约 45% 的区域，排成斜向折线。
- 相对坐标（以 hero 宽高为单位）：`[[.56,.66],[.64,.42],[.74,.56],[.80,.30],[.88,.50],[.93,.72],[.84,.84]]`。
- 星的直径为 `6px × weight × 1.6`。
- 标签默认在星的右侧；距右边缘不足 120px 时换到左侧。

**停靠（≥768px，原型方案 A「停靠侧栏」）**

- 进度：`p = easeInOutCubic(clamp(scrollY / (0.8·innerHeight)))`。
- 每颗星从首屏坐标插值到 `dockAt(i) = [vw - 44 + (i%2 ? 14 : 0), vh·(.20 + i·.09)]`，形成右缘 14px 的锯齿竖排。
- 缩放从 1 变到 0.58，标签换到左侧；停靠后计数文案只在悬停时显示。
- `p ≥ 1` 时 `.constellation` 加 `.is-docked`（`position:fixed`）。
- **当前章节**：视口 45% 高度线所在的 section。
  - 对应星加 `.is-current`，呼吸发光，周期 2.4s。
  - 当前星之前的 `line.prog` 全亮；当前星到下一颗星之间的线按章节内阅读进度点亮。
- **点击亮星**：`scrollTo(section.offsetTop - navH - 16)`；`Motion.reduced` 时用 `behavior:"auto"`。

**入场时间线（首次加载，`html.js` 下）**

| 时间 | 事件 |
|---|---|
| 0s | 星空淡入 |
| 0.15s | 名字逐字升起 |
| 0.4s + i·0.25s | 第 i 颗星点亮 |
| 0.5s | 连线描出 |
| 0.7s | 标语逐短语淡入 |
| 之后 | 按钮、滚动提示淡入 |

- 总长不超过 2.6s。
- URL 带 hash（如 `/#footprint`）时跳过入场，直接定位。

**降级**

- `Motion.reduced`：
  - 名字直接显示，流光静止。
  - 星空不视差、不闪烁。
  - 停靠不插值：`scrollY > 0.4·innerHeight` 时直接切换为停靠态。
  - 呼吸改为静态高亮。
- `<768px`：不停靠，改用星点栏（5.6）。

### 5.3 各模块动效（§3）

| 代号 | 范围 | 行为 | 触屏 | reduced |
|---|---|---|---|---|
| G1 星尘光标 | 首页全页；文章页正文面板以外 | 每次 `pointermove` 最多 3 颗金色星尘，寿命 0.8s，下落后熄灭，上限 120 颗；用一个 fixed canvas 绘制。光标在 `input`、`textarea`、`.reading-panel`、`.globe-stage` 上时不生成 | 关闭 | 关闭 |
| G2 章节标题揭幕 | 每个 `.sec-head` | 罗马数字（Bodoni，`--gold`）、中文标题（serif，`clamp(28px,4vw,44px)`）、英文副标题（mono 10px，字距 .34em）逐行从遮罩中升起（`overflow:hidden` + `translateY(110%)`→0，行间隔 120ms）；下方金线 `scaleX` 0→1，0.9s。进入视口 20% 时触发，只触发一次 | 保留 | 直接显示 |
| G3 磁吸 | `[data-magnetic]`：hero 按钮、地球返回按钮、文章列表箭头、☀/☾ | 光标距元素中心 80px 以内时，元素向光标偏移（最大为自身尺寸的 30%），并放大到 1.04；离开后用弹簧曲线回位 | 关闭 | 关闭 |
| reveal | `[data-reveal]` | 进入视口时上移 16px 并淡入；同一 `[data-reveal-group]` 内的元素依次间隔 60ms（JS 写入 `--i`） | 保留 | 直接显示 |
| A 关于 | `#about .tags span` | 标签逐个点亮：边框由 `--hairline` 变为 `--gold`，间隔 80ms | 保留 | 直接显示 |
| E1 金色时间线 | `#experience .timeline` | 左侧竖线 `::before` 的 `scaleY` 绑定该 section 的滚动进度，从上往下描金；竖线到达节点时节点点亮（`.is-lit`），内容随 reveal 出现 | 保留 | 竖线全亮 |
| N1 悬停封面 | `#notes .post-row` | 悬停时出现 240×150 浮动卡片，lerp .18 跟随光标，倾斜 ±6°。卡片内容：`firstImage` 有值时用图片；否则用 `titleHue` 色相的双色渐变，配标题首字 120px serif | 有图时在行右侧显示 64px 缩略图，无图时不显示 | 卡片固定在行右侧，不跟随 |
| P1 项目卡 | `#projects .project-card` | 按光标位置做 ±8° 3D 倾斜，内部光斑跟随光标；悬停时边框为旋转的金色 conic 渐变；Stars 数进入视口时从 0 滚动计数 | 按下缩小到 .98，并点亮边框 | 无倾斜，数字直接显示 |
| T1 墨迹显影 | `#thoughts .thought-body` | 进入视口后逐字显影，每字 60ms（opacity 0→1，blur 4px→0）；超过 120 字的部分在第 120 字之后整体淡入。逐字拆分由 JS 完成，并且必须在 `thoughts.js` 测量高度之前恢复原始文本节点，或只对可见的前 120 字拆分 | 保留 | 直接显示 |
| M1 暗房显影 | `#moments img.moment-item`；文章正文 `img` | 图片加载完成并进入视口后，1.2s 内从「过曝 + 低饱和 + 颗粒」显影到正常（`filter: brightness(1.8) saturate(.2) contrast(.8)` → 无；颗粒为伪元素 SVG 噪点，透明度 .25→0）。首页点击时，从原图位置 FLIP 放大衔接现有灯箱 | 保留 | 直接显示；不做 FLIP |
| G4 列表→文章 | 首页文章标题 → 文章页 h1 | 两页 CSS 均声明 `@view-transition { navigation: auto; }`；两端共享 `view-transition-name: post-{slug}`（值来自 `vtName`，见 7.4）。不支持的浏览器正常跳转 | 保留 | 浏览器自动跳过 |

### 5.4 足迹地球（§4）

**定位**：第三章「III · 足迹 · FOOTPRINTS」，用来展示去过或住过的国家和地区。

**布局**

- ≥960px：两栏 `.footprint-grid`（`grid-template-columns: 1.2fr 1fr`）。
  - 左栏 `.globe-stage`：画布 `min(左栏宽, 600)`，正方形，透明背景，外围一圈极淡的金色大气光晕（CSS radial-gradient）。
  - 右栏 `.globe-panel`，自上而下：`#globe-breadcrumb` → `#globe-stats`（F3）→ `.globe-controls`（返回按钮 + 下钻提示）→ `#globe-notes` → `#globe-moment-links`。
- <960px：单栏，画布在上，面板在下。
- <600px：画布宽 `innerWidth - 40`。

**`globe.js` 改动范围（只换皮，不改交互逻辑）**

1. **`resize()`**
   - 改为 `min(stage.clientWidth, 600, innerWidth - 40)`。
   - 用 `ResizeObserver` 监听 `.globe-stage`，尺寸变化超过 8px 才重算。
   - 不存在 `.globe-stage` 时回退到原来的公式。
2. **`readTheme()`**
   - 继续读取 4.1 中的 `--accent*`、`--globe-*`、`--text`、`--muted`、`--overlay-rgb`。
   - 新增读取：
     - `--globe-arc`：航线，默认 `rgba(232,197,138,.55)`
     - `--globe-night-rgb`：夜面，默认 `4,8,22`，冷蓝；替换写死的 `1,7,6`
     - `--globe-sun-rgb`：日照光晕，默认 `243,220,174`；整体强度降为原来的 0.6 倍，替换写死的 amber
     - `--font-num`、`--font-sans`
   - `--globe-arc`、`--globe-night-rgb`、`--globe-sun-rgb` 由 WP4 补进 `site.css` 的 footprint 段。
3. **画布字体**：4 处写死的 `'IBM Plex Mono'`（约 292、379、438、865 行）中，数字和国家代码改为 `--font-num`，中文标签改为 `--font-sans`。
4. `updateChrome()` 文案：
   - 面包屑：`<a data-nav="globe">地球</a>` / `<a data-nav="country">{国家中文名或 code}</a>` / `<span>{省名，去掉「省」「市」「自治区」等后缀，仅用于显示}</span>`，分隔符 `<span class="sep">/</span>` 保留。
   - 返回按钮：`← 返回 {国家中文名}` / `← 返回地球`。
   - `#globe-stats`：交给 F3（下文），不再由 `textContent` 直接写入。
5. 新增 F1 航线和 F3 计数（下文），代码都放在 `globe.js` 内部的独立函数里，纯计算部分放进 `globe-core.js`。

**F1 出发地航线（只在地球层）**

- 出发地 `origin = Core.resolveOrigin(location, footprints, world)`，其中 `location` 读自 `#footprint[data-home]`（见 7.3）。
- 从出发地到**其他每个**去过的国家中心（`world.countries[code].c`）画一条大圆弧。
  - 弧线向球外抬升，高度 `= 0.12·R·sin(π·t)`。
  - 背面部分按 `z` 渐隐。
- 进入视口后按顺序描出，每条间隔 0.15s，单条耗时 0.9s。
- 描完后，每条弧线上有一颗彗星（亮头 + 6 段拖尾）循环运动，周期约 3s，各条相位错开。
- 出发地标记：光晕是普通标记的 1.6 倍，旁边标注「出发地」（`--font-sans`，11px，`--gold-hi`）。
- 国家标记：呼吸光晕（复用现有 pulse），颜色为 `--accent-2`。
- 国家层、城市层不画航线；已到访的区域质心画 3px 金点。
- 弧线和彗星都在地球现有的 rAF 循环里绘制，不新开循环；地球层以外不绘制。
- `Motion.reduced`：不自转，弧线直接全部显示，没有彗星，光晕静止。

**出发地解析 `resolveOrigin`（纯函数，放在 `globe-core.js`）**

```js
// location: Profile.Location 原文；footprints: 分组后的足迹；world: world.json
// 返回 {lon, lat, code, label, matched}
resolveOrigin(location, footprints, world)
```

1. 归一化：去掉空白；去掉后缀 `省|市|自治区|特别行政区|壮族|回族|维吾尔|Province|City|State`；统一小写。
2. 按顺序遍历 `footprints` 中每个国家的 `provinces[].name` 和 `cities[].name`，归一化后做双向包含匹配：`a.includes(b) || b.includes(a)`，且较短一方至少 2 个字符。命中第一个即停止。
   - 示例：`广东` 命中 `广东省`；`Guangdong Province China` 归一化后为 `guangdongchina`，不会命中中文的 `广东省`，走第 4 步。
3. 命中后：
   - 如果国家是 `CN`，并且省名在内置的省级中心表 `CN_PROVINCE_CENTERS`（34 项，键为完整省名，值为 `[lon, lat]`）里，就用表中坐标。
   - 否则使用 `world.countries[code].c`。
   - 返回 `matched: true`。
4. 没有命中：返回北京 `{lon: 116.40, lat: 39.90, code: "CN", label: "北京", matched: false}`。
   - 即使足迹里没有中国，也照常从北京画航线。
   - 足迹为空时不渲染整个 section，所以不会走到这里。
- **owner 决定：** 不能从 `regions/CN.json` 推导省中心。原因是 region 的 polys 是投影后的 viewBox 坐标，不是经纬度，`gen_geo.mjs` 也没有保存投影边界。所以改用内置经纬度表。
  - 表的数据来源：各省会或行政中心的经纬度，保留两位小数，与 `regions/CN.json` 的 35 个 `name` 字段逐字对齐，并去掉 `100000_JD`。
  - WP4 写测试校验这个对齐关系。

**F3 数字滚动**

| 层 | 文案（数字用 Bodoni，单位用 sans） |
|---|---|
| globe | `X 国 · Y 省/州 · Z 处` |
| country | `{国家中文名} · Y 省 · Z 处`（非中国用「州/府」，统一显示为「区域」也可，由 WP4 定，但必须写进测试） |
| province | `Z 处` |
| city | 不显示 |

- 统计口径（Go 端 `footprintStats` 与 JS 端 `Core.footprintStats` 必须一致）：
  - `X` = 去重国家数。
  - `Y` = 去重 (国家, 省) 数，空省名不计。
  - `Z` = Σ每个省的 `max(去重城市数, 1)`，即省级记录本身也算 1 处。
  - s_blog 实测：X=5、Y=27、Z=49。
  - 与原型的差异：原型里的 51 是足迹行数。广东等 2 个省同时有「仅省」行和城市行，`GroupFootprints` 会丢弃这类「仅省」行，因此前端从分组数据只能算出 49。
  - 为了让地球层的总数等于各国数字之和，统一使用 49 这个口径（owner 决定，见 11 节 O3）。
- DOM：`#globe-stats` 内部渲染为 `<span class="num" data-to="5">0</span><span class="unit">国</span><span class="sep">·</span>…`，在 0.9s 内用 `--ease` 从 0 滚动到目标值。
  - 首次进入视口时滚动一次；切换图层时从 0 重新滚动。
  - `Motion.reduced` 时直接写入最终值。

**必须保持不变**

- ID：
  - `#footprint`
  - `#globe-canvas`
  - `#globe-breadcrumb`
  - `#globe-cd-up`
  - `#globe-drill-hint`（文案「双击进入下一级」）
  - `#globe-load-status`
  - `#globe-stats`
  - `#globe-notes`
  - `#globe-moment-links`
- JS 生成的类：`.gml-*`、`.gn-*`、`.sep`、`.is-error`、`.moment-flash`。
- `window.__BASE__`、`window.__GEO_VERSION__`、`window.__GLOBE_TEST__` → `__globeDebug`（所有已有方法保持不变）。
- 单击选中、双击下钻、触摸手势、`touch-action` 切换、懒加载、返回快照、后台预热顺序、geo 缓存版本化。

### 5.5 文章页（§5）

**结构**

```
html[data-reading]
  #read-progress                 顶部 2px 金色进度条（scaleX 绑定正文阅读进度）
  .site-nav.is-post              玻璃导航：品牌 · 「← 返回首页」 · 搜索 · ☀/☾ 切换 #reading-toggle
    .nav-post-title              滚过 h1 后淡入的文章标题
  #starfield                     paper 模式下隐藏
  main.post-shell
    header.post-head             标签 pills、h1.post-title（逐字升起 + view-transition-name）、Bodoni 日期
    article.reading-panel        不透明面板，max-width var(--read-w)
      .article                   {{markdown}} 输出
    nav.post-foot                「← 返回文章列表」（/#notes）
  aside.reading-toc#reading-toc  ≥1200px 才显示
  footer（来自 partial）
```

- 返回链接：`{{.Base}}/` 和 `{{.Base}}/#notes`。
- 文章页不加载 `globe-core.js`、`globe.js`、`moments.js`、`thoughts.js`；`heartbeat.js` 只在 `.Live` 时加载。
- 不显示星座，也不显示星点栏。

**正文排版（`.reading-panel .article`）**

- 正文：`--font-sans`，18px，行高 2，字距 .02em，颜色 `--read-text`；移动端 17px。两端对齐，配 `text-wrap: pretty`。
- 标题：
  - h2：serif 600，28px，下方 1px 金线随 reveal 划出（G2 简化版：无罗马数字）。
  - h3：serif 600，22px。
  - h4–h6：sans 600。
- 首段首字下沉：取 `.article > p:first-of-type::first-letter`，serif 600，下沉 3 行，`--read-accent-2`。首段以非 CJK 字符或标点开头时也照常应用。
- 链接：颜色继承，底部 1px `--read-accent` 细线，悬停时细线加粗到 2px 并变亮。
- 引用：左侧 2px 金线，serif 斜体回退，`--read-accent-2`。
- 代码：
  - `pre`：背景 `--read-code-bg`，圆角 12px，`--font-mono` 14px，行高 1.8，横向滚动。
  - 行内 `code`：背景同色，圆角 4px，左右内边距 .3em。
- 图片：最大宽度 100%，圆角 10px，带 M1 显影；点击不打开灯箱（文章页不加载 `moments.js`）。
- 表格：细线边框，表头 sans 600。`hr`：居中三颗金星 `✦ ✦ ✦`。

**阅读目录 TOC（`reading.js`）**

- 只在视口 ≥1200px 时显示，固定在阅读面板右侧。
- 目录项：
  - 有 h2 时取所有 h2；没有 h2 时取所有 h3。
  - 少于 2 项时不显示目录。
- `reading.js` 给标题依次分配 id `sec-1`、`sec-2`…（Markdown 不生成 id，所以直接覆盖，不会冲突）。
- 当前项判定：视口 30% 高度线所在的标题；当前项变金，竖线进度跟随。
- 点击目录项：平滑滚动，减去导航高度。

**夜间 / 纸页切换**

- `<head>` 内联脚本在首帧之前执行，见 7.5，由 WP0 提供：
  `data-reading = localStorage["reading-mode"] || (prefers-color-scheme: light ? "paper" : "night")`
- `#reading-toggle`（☀/☾，带磁吸）点击后：
  1. 支持 `document.startViewTransition` 并且不是 reduced 时：
     - 在 `::view-transition-new(root)` 上用 `clip-path: circle()` 从按钮中心向外扩展，0.95s，`--ease`。
     - 圆的半径取按钮中心到视口最远角的距离。
  2. 不支持时：0.3s 交叉淡入淡出。
  3. reduced 时：立即切换。
  4. 写入 `localStorage["reading-mode"]`，同时更新 `aria-pressed` 和 `aria-label`（「切换到纸页」/「切换到夜间」）。
- paper 模式下：星空和聚光隐藏，G1 星尘颜色改为 `#8a6a3a`，导航玻璃底改为 `rgba(243,238,228,.78)`。
- 首页永远是夜间模式，不读这个设置。

### 5.6 移动端（§6）

**断点**

| 视口宽度 | 布局 |
|---|---|
| ≥768 | 星座停靠为右侧星轨 |
| <768 | 底部星点栏 |
| <600 | 地球画布宽度 = `innerWidth - 40` |

动效降级只看 `Motion.touch`，不看宽度。

**Hero（<768）**

- 名字 `clamp(44px, 14vw, 64px)`。
- 星座在名字下方，占约 40vh，排成一条横向波浪弧线。
  - 相对坐标：`x = .08 + i·.14`，`y = .5 + .18·sin(i·1.1)`。
  - 计数文案显示在标签下方。

**底部星点栏 `.star-rail`（服务端渲染，复用星座数据）**

- 由 `constellation.js` 控制显隐：hero 滚出 55% 后加 `.is-on`。
- 尺寸与位置：
  - 左右各留 14px，高 62px，圆角 22px。
  - `bottom: calc(18px + env(safe-area-inset-bottom))`。
  - 玻璃底 `--glass`，1px `--hairline` 边框。
- 7 颗星缩放 0.7，标签在星下方 10.5px；当前章节的星加 `.is-current`。
- 每颗星的点击区域不小于 44×44；暗星为 `data-off`，不可点击。
- 以下情况隐藏星点栏：
  - 处在 hero 区
  - 搜索框聚焦（`#site-search:focus`，监听 focusin / focusout）
  - `body.lightbox-open`
- 星点栏显示时，`body` 加 `padding-bottom: calc(96px + env(safe-area-inset-bottom))`，保证页脚可见。
- 文章页不输出星点栏。

**触屏降级（`Motion.touch`）**

- 关闭 G1、G3、P1 倾斜、N1 悬停卡片。
  - N1 改为右侧缩略图（仅在有封面图时）。
  - P1 改为按压缩小并点亮边框。
- 星空：约 120 颗；只做滚动视差，强度减半；不使用陀螺仪。
- 聚光改为点击处的涟漪光晕，0.6s。
- 保留 G2、E1、F1 / F3、T1、M1、G4。
- 地球手势不变。

**导航（<768）**

- 只显示品牌和搜索图标 `.nav-search-btn`。
- 点击搜索图标后，导航下方展开一整行搜索框，并聚焦 `#site-search`。
- `#site-search`、`#search-results` 的 id 和 `/` 快捷键保持不变。快捷键聚焦时，搜索行要先展开。

**性能**

- iPhone 12 级设备上滚动和动画约 60fps。
- 首屏下载量 ≤ 约 700KB：HTML + CSS + JS + 首屏字体分片，不含 geo 数据和图片。
- 页面隐藏时暂停所有循环。

### 5.7 主题退役（§7）

**删除**

| 对象 | 位置 |
|---|---|
| 26 个主题文件 | `web/static/css/themes/`（整个目录） |
| 主题设置页模板 | `web/templates/admin/theme_form.html` |
| 主题预览样式 | `web/static/css/admin.css` 中 `.theme-preview*` 相关规则（约 272 行起，删除前先确认范围） |
| 主题处理函数 | `handleThemeForm`、`handleThemeSave`（`internal/server/handlers_admin.go:108-139`） |
| 主题路由 | `internal/server/routes.go:55-57`（含注释） |
| 预览参数处理 | `?preview_theme=` 代码块（`handlers_public.go:44-49`）；删除后若 `models` import 不再使用，一并移除 |
| 存储层 | `store.SaveTheme`（`profile.go:35-41`），以及第 23–24 行关于主题的注释（改写） |
| 校验函数 | `models.ValidTheme`（`models.go:26-34`），及其测试（若有） |
| 后台导航 | `_layout.html:21` 的主题链接 |

**保留**

- 后台 `<html data-theme="F">`：`crt.css` 的扫描线依赖它。
- `profile.theme` 列、`schema.sql` 定义、`addColumnIfMissing` 迁移、Scan 读取、`Profile.Theme` 字段。
  - 注释改为 `// Deprecated: 公开站单一设计后不再使用，保留列以兼容旧库`。

**文档**

- README 中文第 111 行（多主题）、第 217 行（目录说明），以及英文版对应的第 124、240 行，按新设计改写。
- README 新增「字体许可」小节：Noto Serif SC 与 Bodoni Moda 均为 SIL OFL 1.1，许可全文见 `web/static/fonts/OFL.txt`。
- `crt.css` 头注释改为「后台专用（admin-only）」，删除 token 契约中关于「主题覆盖」的说明。

**缓存**

- `routes.go` 新增 `s.mux.Handle("GET /static/fonts/", cacheImmutable(staticHandler))`。字体文件名不带哈希，但 `fonts.css` 用 `asset` 加 `?v=`。
  - 内部 `url()` 同样需要带版本号：由 `build-fonts.sh` 在生成时写入 `?v={内容哈希前 8 位}`。
- `hostingHeaders(base)` 增加 `{base}/static/fonts/*` 的一年 immutable 规则。现有的 `export_test` 只检查包含关系，仍然成立；另外新增字体规则的断言。

**`dist/`**

- 改版完成后执行 `go run . export dist`，先向用户展示结果，再单独提交 `publish: 更新博客静态站点`。
- 用哪个数据库导出见 O1。

### 5.8 合并进 s_blog（§8）

1. 前置条件：blog_self 的 WP0–WP6 全部验收通过，经用户授权合并到 `master` 并 push。
2. 在 `/Users/bytedance/PycharmProjects/s_blog/.worktrees/aesthetic-redesign` 新建分支 `merge/aesthetic-redesign`，然后执行 `git fetch upstream && git merge upstream/master`。禁止 rsync 覆盖，不动 `dist/` 和 `blog.db`。
3. 冲突处理：

| 文件 | 处理 |
|---|---|
| `web/templates/public/home.html`、`post.html` | 取 upstream |
| `web/templates/public/_partials.html` | 取 upstream，然后**单独 commit**，在 `site_footer` 中追加备案行：`<div class="beian"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer"><s_blog 当前 crt.css 页脚里的备案号></a></div>` |
| `web/static/css/crt.css` | 删除 3 条 `footer .beian` 规则，并把它们改写进 `site.css` 的 s_blog 实例段（同一个 commit） |
| `theme_form.html`、`web/static/js/admin-theme.js` | 删除 |
| `web/templates/admin/_layout.html` | 删除主题链接，保留 s_blog 的 `{{$.AdminBase}}` 等后台改动 |
| `internal/server/handlers_admin.go`、`routes.go` | 删除主题处理函数和路由（s_blog 的路由写法是 `s.adminBase()+"/theme"`） |
| `internal/server/handlers_public.go` | 保留 `writeHTML` 中注入 `adminPage.AdminBase` / `Ops` 的 5 行，删除 `preview_theme` 代码块 |

4. 验证：
   - 运行 `go build`、`go vet`、`go test` 和三个地球脚本。
   - 用只读快照预览：`VACUUM INTO`（见 9.3）。
   - 在 1440 和 390 两个宽度截图核对：
     - 实例站点名逐字升起
     - 3 亮 4 暗星座，停靠和星点栏都正常
     - 时间线 3 段
     - 从广东出发的 4 条航线
     - 统计 `5 国 · 27 省/州 · 49 处`
     - 下钻正常
     - 备案行
     - 后台外观不变
     - 后台主题页 404
     - 控制台 0 错误
   - 用 `BASE_URL=/blog` 导出到临时目录，检查所有资源路径都带 `/blog` 前缀，字体能加载。
   - 预览链接保活 ≥8h，发送前先验证能访问。
5. 发布（每一步单独授权）：
   1. 合并到 s_blog `master`
   2. push 到 origin 和 gitee
   3. `scripts/publish-all.sh` 和 `scripts/deploy.sh push`
   4. 线上验证：首页、文章页、`/static/fonts/*.woff2` 返回 200，页面有备案行
6. 回滚：`git revert -m 1 <merge>`，然后重新 publish 和 deploy。

## 6. 工作包与文件归属

### 6.1 依赖与并行

```
WP0 基座（token / 字体 / partials / motion.js / 模板函数 / 页面骨架）
 ├─▶ WP1 Hero + 星空 + 星座 + 星点栏
 ├─▶ WP2 首页各章节 + 章节动效
 ├─▶ WP3 文章页 + 阅读模式
 └─▶ WP4 地球换皮 + F1/F3 + resolveOrigin
WP5 主题退役 + 文档 + 缓存规则（不依赖 WP0，可与 WP0 同时开工）
WP1–WP5 全部合入 ─▶ WP6 集成、全量验收、dist 导出（owner 负责）
```

**并行与分支**

- WP1–WP4 之间没有共享文件，可以同时开工。
- 每个 WP 从 `feat/aesthetic-redesign` 切出 `wp/N-slug` 分支。多个 agent 同时开发时，每个 WP 用独立 worktree `.worktrees/wpN`；开工前先把 `.worktrees/` 写进 `.git/info/exclude`。
- 完成后由 owner 按编号顺序合回 `feat/aesthetic-redesign`。

**共享文件的分区所有权**

- `home.html`：WP0 先提交骨架，用注释标出三个分区 `<!-- region:hero -->…<!-- /region:hero -->`、`<!-- region:sections -->`、`<!-- region:footprint -->`。WP1、WP2、WP4 只改自己的分区；分区之间的冲突由 owner 解决。
- `site.css`：同理，WP0 预留 `/* ==== region:hero ==== */`、`sections`、`footprint` 三段，各 WP 只在自己的段内追加。

### 6.2 文件归属表

| 文件 | 动作 | 归属 |
|---|---|---|
| `web/static/css/site.css`：token、reset、排版、导航、搜索、页脚、容器、reveal、G2、星空 / 聚光基础层 | 新建 | WP0 |
| `site.css` 的 `region:hero` 段 | 追加 | WP1 |
| `site.css` 的 `region:sections` 段 | 追加 | WP2 |
| `site.css` 的 `region:footprint` 段 | 追加 | WP4 |
| `web/static/css/reading.css`（只在文章页加载） | 新建 | WP3 |
| `web/static/fonts/**`、`scripts/fonts/**` | 新建 | WP0 |
| `web/templates/public/_partials.html` | 新建 | WP0；其中 `site_constellation` 的内部结构由 WP1 定稿 |
| `web/templates/public/home.html` | 先写骨架，再按分区填充 | WP0 → WP1 / WP2 / WP4 |
| `web/templates/public/post.html` | 先写骨架，再重写 | WP0 → WP3 |
| `internal/render/render.go`（注册函数）、`internal/render/funcs.go`、`internal/render/funcs_test.go` | 修改 / 新建 | WP0 |
| `web/static/js/motion.js` | 新建 | WP0 |
| `web/static/js/starfield.js`、`web/static/js/constellation.js` | 新建 | WP1 |
| `web/static/js/sections.js`：A / E1 / N1 / P1 / T1 / M1 / G1 / G3 | 新建 | WP2 |
| `web/static/js/reading.js` | 新建 | WP3 |
| `web/static/js/globe.js`、`globe-core.js`、`scripts/globe_core_test.mjs`、`scripts/globe_test.mjs` | 修改 | WP4 |
| `web/static/js/thoughts.js`、`moments.js` | 原则上不改。只允许加最小 hook，例如 `moments.js` 暴露 `window.Moments.openFrom(img)` 给 M1 做 FLIP；需要 owner 批准 | WP2 |
| `web/static/js/search.js`、`heartbeat.js` | 不改 | — |
| 5.7 列出的全部文件；`README.md`、`README.en.md`、`internal/server/routes.go`、`internal/export/export.go`（`hostingHeaders`）、`internal/export/export_test.go`、`internal/server/static_cache_test.go` | 修改 | WP5 |
| `internal/server/public_render_test.go` | 新建夹具 | WP5；其他 WP 只往里追加断言 |
| `scripts/redesign_test.mjs`：首页 / 文章页的 puppeteer 验收 | 新建框架 | WP0；各 WP 追加用例 |
| `dist/**` | 重新导出 | WP6（owner） |

### 6.3 各工作包验收

**WP0 基座**

- 交付：
  - 4.1–4.4、7.1–7.6 的全部内容
  - `home.html` / `post.html` 骨架，改为引用 partials
  - 搜索框样式
- 验收：
  - `go test ./internal/render/...` 通过，7.4 的每个函数都有表驱动测试。
  - 首页和文章页能渲染（内容可以是未美化的占位），控制台 0 错误；搜索和 `/` 快捷键可用。
  - 渲染结果中不出现 `themes/`、`fonts.googleapis.com`、`crt-scanlines`、`/admin`。
  - `du -sh web/static/fonts` ≤ 6MB。
  - 打开只含「星野手记」的页面，DevTools Network 只加载 `fonts.css` 和少数几个分片。
  - 重新运行 `scripts/fonts/build-fonts.sh` 后 `git status` 干净（产物可复现）。

**WP1 Hero + 星座**

- 交付：`starfield.js`、`constellation.js`、hero 分区、星点栏、`site.css` 的 hero 段。
- 验收：
  - 1440×900：
    - 入场时间线符合 5.2。
    - 滚动到 0.8 视口高度时，`.constellation.is-docked` 生效。
    - puppeteer 依次滚动到每个 section 时，`.is-current` 都指向该 section。
    - 点击亮星后，section 顶部在导航栏下方 16px（±4px）。
  - 390×844（`hasTouch` + `isMobile`）：
    - 星座排成波浪弧。
    - hero 滚出 55% 后出现 `.star-rail.is-on`。
    - 搜索聚焦时和 `body.lightbox-open` 时星点栏隐藏。
    - 页脚不被遮挡。
  - `emulateMediaFeatures([{name:"prefers-reduced-motion", value:"reduce"}])` 下：`.ch` 没有动画；停靠在 40% 处直接切换。
  - 暗星没有 `href`，且 `tabindex=-1`。
  - Performance：hero 区滚动单帧 ≤ 16ms（CPU 4× 降速时 ≤ 33ms）。

**WP2 首页各章节**

- 交付：关于、经历、文章、项目、思考、瞬间六节的模板和样式；`sections.js`。
- 验收：
  - 8.3 的「满数据」和「空数据」夹具各跑一遍：空模块的 section 不存在，对应的星为 `data-off`。
  - `thoughts.js`：长文本会折叠，展开、收起和浮动收起按钮都可用；T1 不破坏折叠时的高度测量。
  - `moments.js`：灯箱的打开、左右切换、键盘操作、关闭都正常；M1 FLIP 能衔接灯箱打开。
  - 地球「关联瞬间」点击后跳到 `#moment-{id}`，并出现 `.moment-flash`。
  - N1：有图的文章显示首图；无图的显示 `titleHue` 渐变和首字。
  - 触屏下，N1 和 P1 按 5.6 降级。

**WP3 文章页**

- 交付：`post.html`、`reading.css`、`reading.js`、G4 的文章端。
- 验收：
  - 切换后刷新，模式保持；`domcontentloaded` 时 `data-reading` 已经有值（首帧不闪）。
  - 对比度测试通过：night ≥ 13:1，paper ≥ 10:1。
  - TOC：宽度 ≥1200 时显示，<1200 时隐藏，标题少于 2 个时也隐藏；点击跳转和当前项高亮正确。
  - 长文夹具：没有横向溢出；390 宽度下正文为 17px；超宽代码块只在块内横向滚动。
  - 进度条在正文末尾到达 1。
  - 导出页（`Live=false`）不含 `heartbeat.js`；用 `BASE_URL=/blog` 导出时，所有链接和资源都带前缀。

**WP4 地球**

- 交付：5.4 的全部内容，以及 `Core.resolveOrigin`、`Core.footprintStats`、`Core.CN_PROVINCE_CENTERS`、`Core.greatCircle(a, b, n)`、`Core.displayRegionName(name)`。
- 验收：
  - 三个地球脚本全部通过。
  - `globe_test.mjs` 旧断言只允许改一处：面包屑由 `~/globe` 改为 `地球`。新增断言：
    - 地球层 `#globe-stats` 的最终文本为 `1 国 · 1 省/州 · 2 处`（测试数据中深圳重复出现，去重后城市数为 2）
    - 下钻到广东后为 `2 处`
    - 国家层返回按钮为 `← 返回地球`，城市层为 `← 返回中国`
  - `globe_core_test.mjs` 新增：
    - `resolveOrigin` 的用例：
      - `广东` → 广东省坐标，`matched:true`
      - `北京市` → 北京
      - `Guangdong Province China` → 北京，`matched:false`
      - `""` → 北京
      - 足迹含 JP / `東京都` 时，`東京` → JP 国家中心
    - `footprintStats` 对同一份夹具的结果与 Go 端 `footprintStats` 一致。
    - `CN_PROVINCE_CENTERS` 的键与 `regions/CN.json` 的 34 个省名完全一致。
  - 1440 截图（s_blog 快照）：两栏；从广东出发 4 条航线；彗星和「出发地」标签可见。
  - 390 截图：单栏，画布宽 350。
  - reduced 模式：不自转，没有彗星。

**WP5 主题退役**

- 交付：5.7 的全部内容；`public_render_test.go` 夹具：`store.Open(t.TempDir()/blog.db)` + `render.New(os.DirFS("../../web"), static)` + `server.New`。
- 验收：
  - `rg -n "ValidTheme|SaveTheme|preview_theme|handleTheme|theme_form|css/themes" --glob '!docs/**'` 没有结果。
  - `GET /admin/theme` 返回 404。
  - 后台各页与改动前截图对比，只少了「主题」导航项。
  - `GET /static/fonts/…` 带一年 immutable 缓存头。
  - `hostingHeaders` 输出包含 fonts 规则。
  - `go vet ./...` 和 `go test ./...` 通过。

**WP6 集成（owner）**

- 合入 WP1–WP5，执行第 9 节的全量检查。
- 用测试夹具库和 s_blog 只读快照各起一个预览，截图交用户确认。
- 按 O1 导出 `dist/` 并单独提交，然后进入 5.8。

## 7. 模块契约

### 7.1 Partial（`web/templates/public/_partials.html`）

| define 名 | 入参 | 内容 |
|---|---|---|
| `site_head` | 页面根数据（需要 `.Base`） | `<meta charset>`、viewport、`theme-color`、7.5 的内联脚本、`fonts.css`、`site.css` |
| `site_nav` | 页面根数据 | 玻璃导航：品牌（`{{.Base}}/`）、搜索框 `#site-search` + `#search-results`、移动端 `.nav-search-btn`；文章页额外输出 `.nav-post-title` 与 `#reading-toggle`（由 post.html 自己渲染，不进 partial） |
| `site_footer` | 页面根数据（需要 `.Profile`） | 金色细线 + `© {year} {Name 或 dev@home} · built with blog_self`；`blog_self` 链接至 `https://github.com/sfqin/blog_self`，新标签页打开，悬停或键盘聚焦时显示金色 |
| `site_constellation` | `homeNav` 的返回值 | 5.2 的 `<nav class="constellation">` |
| `star_rail` | `homeNav` 的返回值 | 5.6 的 `<nav class="star-rail">`，结构同星座，类名 `rail-star` |

- define 名不得与后台的 `admin_head`、`admin_foot` 重名；以后新增公开 partial 一律加 `site_` 前缀。
- partial 内所有资源路径写成 `{{.Base}}{{asset "/static/…"}}`。

### 7.2 必须在新 CSS 中重写的类（JS 生成，原先由 `crt.css` 负责）

| 来源 | 类 | 写在 |
|---|---|---|
| `search.js` | `.search-box`、`.search-results`、`.sr-item`、`.sr-badge`、`.sr-title`、`.sr-date`、`.sr-empty`、`.sr-item.active` | `site.css` 基础段（WP0） |
| `thoughts.js` | `.thought`、`.thought-body.collapsed`（`max-height:168px` + 底部渐隐 mask）、`.thought-toggle`、`.thought-collapse-float` | `site.css` sections 段（WP2） |
| `moments.js` 灯箱 | `.lightbox`、`.lightbox-close`、`.lightbox-nav`、`.lightbox-prev`、`.lightbox-next`、`.lightbox-viewport`、`.lightbox-track`、`.lightbox-slide`、`.lightbox-img`、`.lightbox-hint`、`.lb-hint-show`、`.is-end`、`body.lightbox-open` | 同上（WP2） |
| `moments.js` 卡片 | `.moment`、`.moment-meta`、`.moment-place`、`.moment-date`、`.moment-caption`、`.moment-media[data-count]`、`.moment-item`、`.moment-embed`、`.moment-embed-frame`、`.moment-embed-open`、`.moment-flash` | 同上（WP2） |
| `globe.js` 面板 | `.gml-head`、`.gml-count`、`.gml-item`、`.gml-arrow`、`.gml-cap`；`.gn-head`、`.gn-item`、`.gn-city`、`.gn-text` | `site.css` footprint 段（WP4） |
| `globe.js` 控件 | `.globe-breadcrumb .sep`、`.globe-load-status.is-error`、`.globe-back-btn`、`.globe-drill-hint`、`.globe-controls` | 同上（WP4） |

改动前先 `grep -n "className\|classList" web/static/js/<file>.js` 核对，以代码为准；本表漏列的类同样要补样式。

### 7.3 `data-*` 与全局类

| 属性 / 类 | 用在 | 含义 |
|---|---|---|
| `html.js` | `<html>` | 7.5 内联脚本添加；CSS 的隐藏初始态只在它下面生效 |
| `data-key` | `.star`、`.rail-star` | 对应 section id |
| `data-count` | 同上 | 计数文案 |
| `data-weight` / `style="--w:…"` | 同上 | 星的权重（5.2） |
| `data-off` | 同上 | 暗星；同时带 `aria-disabled="true"`、`tabindex="-1"`，无 `href` |
| `data-reveal` | 任意块 | 进入视口时淡入上移 |
| `data-reveal-group` | 父元素 | 子元素 `[data-reveal]` 依次延迟，JS 写 `--i` |
| `data-magnetic` | 按钮 / 箭头 | G3 磁吸 |
| `data-home` | `#footprint` | `Profile.Location` 原文，供 `resolveOrigin` |
| `data-reading` | `<html>`（仅文章页） | `night` / `paper` |
| `data-to` | `#globe-stats .num` | F3 目标值 |
| `.is-solid` / `.is-docked` / `.is-current` / `.is-on` / `.is-lit` / `.is-in` | 见各节 | 状态类，只由 JS 添加 |

### 7.4 模板函数（`internal/render/funcs.go`，在 `render.go` 的 funcMap 注册）

```go
func splitChars(s string) []string                 // 按 rune 拆分；空串返回 nil
func splitPhrases(s string) []string               // 按「，。—」切分，标点留在前一段；连续标点归前一段；去掉首尾空白段
type FootprintStats struct{ Countries, Provinces, Places int }
func footprintStats(fps []models.Footprint) FootprintStats  // 口径见 5.4 F3，与 Core.footprintStats 一致
type NavItem struct {
    Key, Label, En, Numeral, Count, Href string
    Weight string   // "1.00" 格式
    Off    bool
}
func homeNav(d any) []NavItem                      // 输入首页视图模型（在线 map 或导出 struct 均可，用反射/字段名读取）
func firstImage(md string) string                  // 正文第一张图的 URL：先匹配 ![..](url)，再匹配 <img src="">；无则 ""
func titleHue(s string) int                        // FNV-1a 32 位哈希 % 360
func vtName(slug string) string                    // "post-" + slug 中 [A-Za-z0-9_-] 以外字符替换为 "-"；空 slug 返回 "post"
```

- `homeNav` 输出固定 7 项，顺序同 5.1；`Href` 为 `#{Key}`，暗星为空串；`Numeral` 只给亮星编号（I、II…），暗星为空串。
- `homeNav` 需要的字段：`Profile.AboutMD`、`Profile.StackTags`、`Profile.Location`、`Experiences`、`Footprints`、`Posts`、`Projects`、`Thoughts`、`Moments`。两边视图模型字段名一致（第 3 节），实现时用一个小的 `fieldOf(v any, name string) any` 反射辅助同时支持 map 与 struct。
- 所有函数必须是纯函数，零值输入不 panic。

### 7.5 `<head>` 内联脚本（`site_head` 输出，首页与文章页共用）

```html
<script>
(function(d){d.classList.add("js");
if(d.hasAttribute("data-reading")){var m=null;try{m=localStorage.getItem("reading-mode")}catch(e){}
if(m!=="night"&&m!=="paper")m=matchMedia("(prefers-color-scheme: light)").matches?"paper":"night";
d.setAttribute("data-reading",m)}})(document.documentElement);
</script>
```

- 文章页的 `<html>` 先写 `data-reading="night"` 作为占位，由脚本覆盖；首页不写该属性，脚本不处理。
- 必须是 `<head>` 里第一个 `<script>`，放在任何样式表之前，不加 `defer`。

### 7.6 `motion.js` API（全局 `window.Motion`）

```js
Motion.reduced                // boolean，随 media query 变化实时更新
Motion.touch                  // boolean
Motion.onChange(fn)           // reduced 变化时回调
Motion.observe(el, cb, opts)  // 共享 IntersectionObserver；opts: {threshold=0.2, once=true, rootMargin}；cb(entry)
Motion.unobserve(el)
Motion.loop.add(fn)           // fn(t, dt)，返回 remover；无回调时自动停止 rAF
Motion.loop.remove(fn)
Motion.clamp(v,a,b) / Motion.lerp(a,b,t) / Motion.easeInOutCubic(t) / Motion.easeOut(t)
Motion.countUp(el, to, ms=900)  // F3 / P1 共用；reduced 时直接写值
```

- 按 `opts` 的 `threshold|rootMargin` 组合复用 observer 实例，不为每个元素新建。
- `visibilitychange` 为 hidden 时暂停 `Motion.loop`，恢复时 `dt` 截断为 ≤ 50ms。
- **脚本加载顺序**（全部 `defer`，按此顺序书写）：
  - 首页：`motion` → `starfield` → `constellation` → `sections` → `globe-core` → `globe` → `thoughts` → `moments` → `search` → `heartbeat`（仅 `.Live`）
  - 文章页：`motion` → `starfield` → `reading` → `search` → `heartbeat`（仅 `.Live`）

## 8. 测试

### 8.1 Go

- `internal/render/funcs_test.go`（WP0）：7.4 每个函数的表驱动用例，至少覆盖：
  - `splitChars("星野君")` → 3 项；含 emoji / 拉丁混排
  - `splitPhrases("用有限的时间，写一点优雅的代码。")` → 2 段，逗号与句号各留在段尾；空串 → 空
  - `footprintStats`：本节 8.3 夹具结果固定；省级行与城市行并存时省级行不额外计数（与 `GroupFootprints` 一致）
  - `homeNav`：满数据 7 亮；空数据仅「关于」亮（有 Location 时）；罗马数字跳过暗星；`Weight` 公式和 `max_n==0`
  - `firstImage`：markdown 图、HTML 图、无图
  - `titleHue`：稳定、范围 0–359
  - `vtName`：中文 slug、空 slug
- `internal/server/public_render_test.go`（WP5 建夹具，其他 WP 追加断言）：
  - 空库首页：不含 `/admin`、`themes/`、`fonts.googleapis`、`crt-scanlines`、`// 暂无`；含 `class="constellation"`；暗星 6 颗。
  - 满数据首页：7 个 section id 都在；`#footprint` 带 `data-home`；`#globe-drill-hint` 文案存在。
  - 文章页：`<html` 带 `data-reading`；含 `view-transition-name:post-`；含 `reading.css`。
  - `GET /admin/theme` → 404；`GET /static/fonts/fonts.css` 带 `immutable`。
- `internal/export/export_test.go`：`hostingHeaders("/blog")` 含 `/blog/static/fonts/*`；导出首页的资源路径都带 `/blog`。

### 8.2 Node

- `scripts/globe_core_test.mjs`（WP4）：见 6.3 WP4 验收。
- `scripts/contrast_check.mjs`（WP3）：解析 `reading.css` 中两组 token，计算 WCAG 对比度，night ≥ 13、paper ≥ 10，不达标 `process.exit(1)`。
- `scripts/redesign_test.mjs`（WP0 建框架）：puppeteer，默认 `BASE=http://127.0.0.1:8199`，用例按 WP 分组（`--only wp1` 可单跑）。每个用例前检查控制台 0 错误、0 个失败请求。

### 8.3 夹具

- 由 `scripts/seed_fixture.sh <db>`（WP0）通过后台无关的 SQL 直接写入，内容全部虚构（不得使用 s_blog 数据）：
  - **满数据**：Profile（名「星野」、Title、Tagline 含逗号和句号、Location「广东」、StackTags 4 个）、3 段经历、足迹 CN（广东省：深圳市、广州市；北京市）+ JP（東京都）共 4 行、3 篇文章（1 篇含图）、2 个项目、2 条思考（1 条超过 300 字）、2 个瞬间（1 个多图）。
  - **空数据**：只有 Profile（Name 与 Location），其余为空。
  - **长文**：1 篇含 h2×4、h3×3、超宽代码块、表格、引用、图片、hr 的文章，slug `long-read`。
- 导出 `dist/` 时用满数据夹具（见 O1）。

## 9. 通用检查与验证命令

### 9.1 每个 WP 提交前

```bash
gofmt -l . | grep -v '^dist/' ; test -z "$(gofmt -l internal)"   # 无输出
go build -o ./blogbin . && rm -f ./blogbin
go vet ./...
go test ./...
node scripts/globe_core_test.mjs
node scripts/globe_logic_test.mjs
git diff --cached --name-only | grep -E '\.db$|\.superpowers/' && echo "禁止提交" && exit 1
# PRIVATE_PATTERNS 指向仓库外的模式文件（实例姓名、签名、邮箱、备案号等，每行一个 ERE）
git diff --cached | grep -nEf "$PRIVATE_PATTERNS" && echo "含个人数据" && exit 1
```

### 9.2 浏览器测试

```bash
tmp=$(mktemp -d)
scripts/seed_fixture.sh "$tmp/blog.db" full
ADDR=127.0.0.1:8199 DB_PATH="$tmp/blog.db" REPO_DIR="$tmp" go run . serve &
until curl -sf http://127.0.0.1:8199/internal/ready; do sleep .3; done
(cd scripts && npm ci)
node scripts/globe_test.mjs
node scripts/redesign_test.mjs
```

- 截图宽度：1440×900、390×844（`isMobile`、`hasTouch`）；reduced 模式各一张。
- 导出检查：`DB_PATH="$tmp/blog.db" BASE_URL=/blog go run . export "$tmp/out"`，然后 `grep -rn '"/static\|href="/' "$tmp/out"/*.html` 应无未加前缀的路径。

### 9.3 真实数据预览（只读快照）

```bash
sqlite3 'file:/Users/bytedance/PycharmProjects/s_blog/blog.db?mode=ro' "VACUUM INTO '/tmp/preview.db';"
```

- 绝不直接打开实例的 `blog.db` 运行服务。
- s_blog 预览用 `SERVER_MODE=1` 启动，跳过空闲退出；blog_self 预览空闲 5 分钟退出，长时间保活需要后台每 60s `curl /internal/alive`。
- 预览链接保活 ≥ 8 小时，发给用户前先 `curl -sf` 验证。

## 10. 原型参考（不提交）

位于 `/Users/bytedance/PycharmProjects/blog_self/.superpowers/brainstorm/aesthetic-redesign/content/`（已在 `.git/info/exclude`）：

| 文件 | 对应 |
|---|---|
| `01-visual-direction.html` | §1 视觉方向（选 A「星夜远行」） |
| `03-structure.html` | 首页结构、足迹章节定位 |
| `04-hero.html`、`05-hero-constellation.html` | §2 Hero 与星座（停靠方案 A） |
| `06-motion-menu.html` | §3 模块动效菜单 |
| `07-article.html`、`08-reading.html` | §5 文章页（夜间 / 纸页） |
| `09-mobile.html` | §6 移动端 |
| `s*.css`、`s*.js` | 对应页面的演示样式与脚本 |

原型的 JS 只是演示，不得直接拷贝进 `web/static/js`；数值以本文为准。

## 11. 风险与待定

| 编号 | 问题 | 处理 |
|---|---|---|
| O1 | blog_self 已跟踪的 `dist/`（`f4f245b`）是用含个人资料的库导出的，开源仓库里已经可见 | 本次改用 8.3 满数据夹具导出 `dist/`；历史提交不改写。是否要清理历史由用户决定 |
| O2 | 预览保活 | 已解决：s_blog 用 `SERVER_MODE=1`；blog_self 用后台 curl 心跳 |
| O3 | 足迹「处」数：原型 51，实现 49 | 统一用分组后口径 49（5.4），地球层总数等于各国之和 |
| O4 | 中文衬线字体体积 | 只取 600 一个字重、GB2312 6763 字分片；超过 6MB 时降到一级字库 3755 字 + 动态补字（报 owner） |
| O5 | View Transitions 兼容性 | 跨文档 `@view-transition` 目前只有 Chromium 系支持；Safari / Firefox 正常跳转，不做 polyfill |
| O6 | `backdrop-filter` 在低端安卓上掉帧 | `Motion.touch` 且 `navigator.hardwareConcurrency ≤ 4` 时，`.site-nav.is-solid` 与 `.star-rail` 改用不透明 `--bg-1` 底色 |
| O7 | 星座停靠与右侧滚动条重叠 | `dockAt` 的 `vw` 取 `document.documentElement.clientWidth`（不含滚动条） |
