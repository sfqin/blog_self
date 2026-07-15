# dev@home —— 复古 CRT 终端风个人博客（含本地后台）

**中文** · [English](README.en.md)

一个复古终端 / CRT 风格的个人主页博客，带一个可交互的 3D「足迹」地球。

它是一个 **Go 服务 + SQLite 单文件数据库**：所有内容都在本地后台 `/admin` 里
增删改，前台首页即时可见，**无需重新构建、无需重新部署**。整个前端（HTML 模板、
CSS、JS、地理数据）通过 `//go:embed` 编译进**一个可执行文件**，部署就是拷一个二
进制。

## 两种使用方式（同一套代码都支持）

- **静态发布（免费、推荐）**：后台只在你自己电脑上跑，写完一键导出静态站并推送到
  Git，由免费 Pages 平台（Cloudflare 等）托管，国内外均可访问。详见
  [`DEPLOY.md`](DEPLOY.md)。
- **动态部署（付费 VPS）**：把 Go 服务跑在服务器上，线上 `/admin` 随处可访问、改
  完即时生效。详见下文「动态部署」。

> **数据安全**：`blog.db`（含你的后台密码哈希）**永远只在本地**。静态发布只推送
> 渲染好的 HTML/JSON/静态资源，密码绝不上传。

---

## 功能一览

**前台（`/`）**
- 个人资料、职业经历、随想、项目、最新文章
- 可交互 3D 地球「足迹」：拖拽旋转、缩放、下钻到 国家 → 省/州 → 城市；随真实
  时间显示昼夜光照；移动端支持双指缩放
- 「瞬间」信息流：图片 / 短视频 / 纯文字日记
- 全站模糊搜索（`/api/search`，前端 JS 消费）

**文章页（`/posts/{slug}`）**：Markdown 渲染为 HTML。

**后台（`/admin`，密码保护）**：对每一块页面数据做增删改——资料、经历、随想、
项目、文章、足迹、瞬间。保存即写入 SQLite，前台下次加载即生效。

**安全**
- 会话 Cookie（`dh_session`，7 天有效）+ bcrypt 密码哈希
- CSRF 防护：双提交 Cookie（`dh_csrf` + 表单 `csrf_token`）
- 生产环境设 `SECURE_COOKIES=1`，Cookie 标记为 `Secure`（仅 HTTPS）

---

## 快速开始

需要 **Go 1.23+**。

```bash
# 首次运行：用 ADMIN_PASSWORD 设定后台密码（自己挑一个）。
ADMIN_PASSWORD='choose-a-strong-password' go run .
# → 监听 :8080
```

打开：
- 前台：http://localhost:8080/
- 后台：http://localhost:8080/admin/login （用户名 `admin`，密码为上面所设）

密码写进数据库后，之后再启动就**不必**再带 `ADMIN_PASSWORD`。想改密码时，再带一次
新值启动即可。

也可以先编译再运行（部署时用同一个二进制）：

```bash
go build -o ./blogbin .
ADMIN_PASSWORD='...' ./blogbin serve
```

### 环境变量

| 变量             | 默认值     | 含义                                                     |
|------------------|-----------|----------------------------------------------------------|
| `ADDR`           | `:8080`   | 监听地址。生产建议 `127.0.0.1:8080`（回环，前置反代）      |
| `DB_PATH`        | `blog.db` | SQLite 文件路径                                          |
| `ADMIN_USERNAME` | `admin`   | 后台登录名                                              |
| `ADMIN_PASSWORD` | *(空)*    | 非空时设置/更新后台密码；首次运行必须带，之后可去掉        |
| `SECURE_COOKIES` | *(关)*    | 设为 `1` 时 Cookie 仅走 HTTPS；生产环境开启               |

### 子命令

```bash
./blogbin serve          # （默认）启动后台 + 前台服务
./blogbin export [dir]   # 把当前数据库渲染成静态站（默认输出 ./dist）
```

---

## 后台使用说明

登录 `/admin` 后，左侧导航（中英对照）分为以下几块：

| 版块 | 说明 |
|------|------|
| **资料 Profile** | 单条：名字、标题、slogan、关于（Markdown）、技术栈标签、GitHub、邮箱、位置 |
| **经历 Experiences** | 职业时间线，可排序 |
| **随想 Thoughts** | 短观点卡片，带主题和日期 |
| **项目 Projects** | 项目卡片：名称、描述、语言、星标、License、链接，可排序 |
| **文章 Posts** | Markdown 文章。`published` 打勾才会出现在前台/被导出；草稿不外泄 |
| **足迹 Footprints** | 一条 = 一座去过的城市（国家 → 省/州 → 城市）。表单为**联动选择**，可填备注，并可关联多条「瞬间」 |
| **瞬间 Moments** | 图片 / 短视频 / 纯文字动态，见下 |

### 瞬间（Moments）与媒体

「瞬间」用来记录生活片段。**站点本身不托管图片/视频**，而是引用外部 URL（每行一
个），从而不受体积限制、加载也快：

- **图片**：直接填图片 URL（推荐放 Cloudflare R2 等对象存储）。
- **直链视频**（`.mp4/.webm/.mov/...`）：用 `<video>` 内联播放。
- **B 站 / YouTube 链接**：粘贴普通观看页链接即可，会自动改写成可内嵌的播放器地址
  内联播放（B 站用 H5 移动端播放器，手机上不跳 App），并附「在原站打开」兜底链接。

前台看图支持轮播灯箱（跟手滑动、到头提示、不循环）。

### 足迹 ↔ 瞬间 关联

足迹和瞬间是**多对多**：一条足迹可关联多条瞬间，一条瞬间也可被多条足迹引用。在
足迹表单里勾选要关联的瞬间即可。前台地球下钻到城市/省份时，点击会把关联的瞬间列在
下方（不直接跳转），用户可再点具体链接进入某条瞬间。

---

## 静态发布到免费 Pages（推荐）

`export` 会把首页、每篇已发布文章渲染成 HTML，并把足迹 JSON 写到
`dist/api/footprints`（正是地球 fetch 的路径，无需改前端）、搜索索引写到
`dist/api/search`，再拷贝全部静态资源。后台只在本地跑，数据库不出本机。

### 一键发布

```bash
# 从本地 blog.db 渲染两种构建，推送到各免费平台：
DB_PATH=./blog.db ./scripts/publish-all.sh "post: 你好世界"
```

`publish-all.sh` 会产出**两种构建**并推到对应位置：

| 构建 | 资源路径 | 推送目标 | 适配的托管 |
|------|----------|----------|------------|
| 根路径（`BASE_URL` 空） | `/static/...` | GitHub `master` 的 `dist/` | Cloudflare / EdgeOne（域名根，自动部署） |
| 子路径（`BASE_URL=/blog`） | `/blog/static/...` | GitHub `gh-pages` 分支、Gitee `master` | GitHub Pages、Gitee Pages（`用户名.github.io/blog` 这类子路径） |

可用开关：`SKIP_GITEE=1`、`SKIP_GH_PAGES=1`、`SUBPATH=/xxx`（改子路径）。

也可只手动导出，不推送：

```bash
./blogbin export dist                    # 根路径
BASE_URL=/blog ./blogbin export dist     # 子路径
```

### 平台现状（截至 2026-07，可能变化）

- **Cloudflare**（当前线上，已跑通）：连 GitHub `master`，`wrangler.jsonc` 让它把
  预构建的 `dist/` 当纯静态资源直接发布，无构建步骤。海外/全球访问良好。
- **EdgeOne Pages（腾讯云）**：免费版**「全球（不含中国大陆）」**区才有永久免费域
  名；「中国大陆 / 全球含大陆」区只给 3 小时临时预览链接，且需绑**已 ICP 备案**的
  自有域名才能长期访问。免费+不备案这条路拿不到大陆加速。
- **Gitee Pages**：个人版 Pages **已下线**，不再可用（脚本仍保留相关分支推送，仅
  作历史备份）。

各平台完整开通/连库/自定义域名/备案说明见 [`DEPLOY.md`](DEPLOY.md)；带日期的选型
对比见 [`docs/hosting-research-2026-07-13.md`](docs/hosting-research-2026-07-13.md)。

> **结论**：免费 + 不备案，天然有大陆访问速度上限。想要真正的大陆加速，需要「买域
> 名（约 ¥30–70/年）+ ICP 备案」后再上 EdgeOne 中国区。当前个人博客用 Cloudflare
> 已够用。

---

## 动态部署（可选，付费 VPS，线上后台随处可访问）

若你想让线上 `/admin` 随时可编辑、改完即时生效，可把 Go 服务跑在服务器上。推荐
**香港（或就近海外）VPS + Cloudflare + 自有域名**：海外机对大陆延迟低、无需备案，
再叠加 Cloudflare CDN。

```bash
# 在本机（仓库内）一步完成：编译 → 上传 → 重启：
./scripts/deploy.sh push blog@your-server-ip

# 首次还需在服务器上安装服务文件：
sudo cp /opt/s_blog/s_blog.service /etc/systemd/system/
sudo cp /opt/s_blog/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload && sudo systemctl enable --now s_blog
sudo systemctl reload caddy
```

`Caddyfile`（反代 + 自动 HTTPS）和 `s_blog.service`（systemd 单元）已在仓库内，改
好域名和 `ADMIN_PASSWORD` 即可。只想编译 Linux 二进制不部署：`./scripts/deploy.sh
build`（输出 `dist/s_blog`）。

---

## 重新生成地球地理数据

`web/static/geo/` 下的地理 JSON 已预生成，通常不用动。要重建（需联网 + Node）：

```bash
node scripts/gen_geo.mjs
```

下钻范围：CN 省份 北京/湖南/广东/浙江/四川/江苏；JP 东京/大阪；MY 雪兰莪/沙巴；
SG 整国。初始只加载 `world.json`（约 64KB），区域文件在下钻时按需懒加载。

---

## 项目结构

```
main.go                     入口；embed ./web；serve / export 两个子命令
internal/
  models/                   内容类型 + 搜索索引、标签、足迹分组、瞬间媒体解析
  store/                    SQLite 访问（schema.sql + 每类内容一个文件）
  auth/                     bcrypt + token 助手
  render/                   html/template + goldmark（Markdown）
  server/                   路由、中间件（会话 / CSRF）、handlers、gzip
  export/                   把数据库渲染成静态站
web/
  templates/public/         home.html, post.html
  templates/admin/          登录、仪表盘、各版块 list/form
  static/css|js/            CRT 主题、后台、globe.js、moments.js、search.js
  static/geo/               地球用的 world + 区域 JSON（预生成）
scripts/
  publish-all.sh            一键发布到多个免费 Pages（含两种构建）
  deploy.sh                 编译 / 推送到 VPS
  gen_geo.mjs               （重）生成地理数据（需联网）
  globe_logic_test.mjs      地球纯逻辑测试
Caddyfile                   反向代理 + TLS（VPS 用）
s_blog.service              systemd 单元（VPS 用）
wrangler.jsonc              Cloudflare Workers 静态资源发布配置
```

---

## 开发与验证

改完 JS/CSS/Go 后的校验顺序：

```bash
node --check web/static/js/xxx.js   # 改了 JS 时
go build -o ./blogbin .             # 编译（静态资源已 embed，改前端也要重新编译）
go vet ./...
go test ./...                       # 全部测试（store 层、搜索、足迹分组、瞬间媒体等）
node scripts/globe_logic_test.mjs   # 地球纯逻辑测试
```

> 前端资源编译进二进制，改完模板/CSS/JS 需**重新 `go build` 并重启服务**才生效。
