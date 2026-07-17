# 上线实操手册（本地后台 + 免费 Pages 多平台部署）

这套方案的核心：**后台只在你自己电脑上跑**，写完文章一键"发布"，静态站被推到
Git，多个免费 Pages 平台自动部署。全程免费，国内外都能访问。

本项目同时支持三个平台镜像：
- **Cloudflare Pages** —— 海外/全球，连 GitHub，push 自动部署。
- **腾讯云 EdgeOne Pages** —— 国内加速（最快），连 GitHub，push 自动部署。
- **Gitee Pages** —— 国内备选，连 Gitee，子路径托管，免费版需手动点“更新”。

```
你的电脑                                 云端（全免费）
┌─────────────────────────┐   push      ┌──────────────┐   自动   Cloudflare Pages（海外）
│ ./blogbin serve → /admin │  ─────────► │ GitHub 仓库   │ ──────► EdgeOne Pages（国内加速）
│   写文章 / 改数据         │  publish.sh └──────────────┘
│   存进本地 blog.db        │
│                          │   push      ┌──────────────┐   手动点更新
│ publish-gitee.sh ────────┼───────────► │ Gitee 仓库    │ ──────► Gitee Pages（国内备选）
└─────────────────────────┘             └──────────────┘
                                                 ▼
                                     访客访问 https://你的域名
```

> 关键点：`blog.db`（你的全部内容）**永远只在本地**，不会上传。云端只有渲染好的
> 静态文件。所以后台绝对安全，也不需要一台一直开机的服务器。
>
> 三平台的选型对比、运营方、免费额度、备案要求见
> [`docs/hosting-research-2026-07-13.md`](docs/hosting-research-2026-07-13.md)。

---

## 一次性准备

| 项目 | 说明 | 花费 |
|------|------|------|
| GitHub 账号 | 你已有。存代码，Cloudflare + EdgeOne 都从这里触发部署 | 免费 |
| Cloudflare 账号 | 免费版即可，海外/全球 CDN | 免费 |
| 腾讯云账号 | 免费版即可，开通 EdgeOne Pages，国内加速 | 免费 |
| Gitee 账号 | 免费。需实名认证才能开 Pages（国内备选） | 免费 |
| 域名 | **可选**。不填就各用平台送的默认域名 | 0 或约 1–10 美元/年 |
| 本机 Go | 已装（用于渲染静态站） | 免费 |

> 各平台送的默认域名（`*.pages.dev` / EdgeOne 默认域名 / `*.gitee.io`）国内都能访问、
> 且**免备案**；想绑自己的域名做国内加速通常需要 ICP 备案（见调研文档）。
> 三个平台不必都开，按需选：只要国内快 → EdgeOne；要海外稳 → Cloudflare；两者可同时。

---

## 第 1 步：把代码推到 GitHub（一次性）

在 GitHub 上新建一个仓库（可以是 private，Cloudflare 也能连），然后在本地：

```bash
$ cd /Users/bytedance/PycharmProjects/s_blog
$ git remote add origin git@github.com:<你的用户名>/<仓库名>.git
$ git push -u origin master
```

---

## 第 2 步：本地写第一篇文章

启动本地后台：

```bash
$ go build -o blogbin .
$ ./blogbin serve
# 打开 http://localhost:8080/admin （无需登录、没有密码，直接打开）
```

在后台把个人资料、经历、项目、足迹、文章都填好。这些都存进本地 `blog.db`。

---

## 第 3 步：一键发布（Cloudflare + EdgeOne）

改完内容后，跑发布脚本 —— 它会渲染静态站并推送到 GitHub：

```bash
$ ./scripts/publish.sh
# 或带条说明： ./scripts/publish.sh "post: 我的第一篇文章"
```

它做了三件事：把当前数据渲染成 `dist/`（根路径）→ `git commit` → `git push`。
推送后 **Cloudflare 和 EdgeOne 会各自自动部署**（它们都连着这个 GitHub 仓库，
连接是一次性的，见第 4、5 步）。

> Gitee 是子路径托管，走单独的 `publish-gitee.sh`，见第 7 步。

---

## 第 4 步：在 Cloudflare Pages 连接仓库（一次性，海外/全球）

1. 登录 Cloudflare → 左侧 **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**，授权并选中你刚推送的仓库。
2. 构建设置这样填（关键）：
   - **Framework preset（框架预设）**：`None`
   - **Build command（构建命令）**：**留空**
   - **Build output directory（输出目录）**：`dist`
   > 因为静态站是本地渲染好并提交进 `dist/` 的，Cloudflare 不需要自己构建。
3. 点 **Save and Deploy**。首次部署完成后，你会得到一个
   `https://<项目名>.pages.dev` 的网址，打开就能看到网站。

以后每次 `./scripts/publish.sh` 推送，Cloudflare 都会自动重新部署，约 1 分钟上线。

---

## 第 5 步：在腾讯云 EdgeOne Pages 连接仓库（一次性，国内加速）

1. 登录腾讯云 → 搜索并进入 **EdgeOne Pages** → 控制台一键开通免费版。
2. **创建项目** → **导入 Git 仓库** → 授权 GitHub 并选中同一个仓库。
3. 构建设置（与 Cloudflare 同理）：
   - **框架预设**：`None` / 静态
   - **构建命令**：**留空**
   - **输出目录**：`dist`
4. 部署完成后会给一个 EdgeOne 默认域名，打开即可访问（国内加速）。

以后同一条 `./scripts/publish.sh` 推送，EdgeOne 与 Cloudflare 一起自动更新。

> ⚠️ 据调研当日信息：EdgeOne 预览域名可能有时效、国内加速区绑自定义域名需备案，
> 具体以控制台为准（见 `docs/hosting-research-2026-07-13.md`）。

---

## 第 6 步（可选）：绑定自己的域名

- **Cloudflare**：把域名 DNS 托管给 Cloudflare → Pages 项目 → **Custom domains** →
  **Set up a custom domain** → 按提示添加记录，证书自动签发。
- **EdgeOne**：控制台添加自定义域名 → 按提示加 CNAME；**国内加速区需 ICP 备案**。

---

## 第 7 步（可选）：Gitee Pages 镜像（国内备选）

Gitee 免费版有两个特殊点：**子路径托管** + **不自动部署**。本项目已适配。

1. 在 Gitee 新建一个**公开**仓库，例如 `myblog`；完成 Gitee **实名认证**。
2. 本地加一个 Gitee 远端（一次性）：
   ```bash
   $ git remote add gitee git@gitee.com:<你的用户名>/myblog.git
   ```
3. 发布（`myblog` 就是仓库名，会成为 URL 子路径）：
   ```bash
   $ ./scripts/publish-gitee.sh myblog
   ```
   脚本会用 `BASE_URL=/myblog` 构建带前缀的静态站并强推到 Gitee。
4. **手动部署**：打开 Gitee 仓库 → **服务 → Gitee Pages → 点“更新/部署”**。
   （免费版不自动部署；自动部署需付费 Gitee Pages Pro。）
5. 访问地址：`https://<你的用户名>.gitee.io/myblog/`。

---

## 日常使用（记住这个就够）

```
本地 ./blogbin serve  →  在 /admin 写文章/改数据  →  ./scripts/publish-all.sh
```

一条 `publish-all.sh` 会把内容渲染成两份、推到四个免费平台（见下节）。
发布后等约 1 分钟，Cloudflare/EdgeOne/GitHub Pages 线上就自动更新了；Gitee
免费版需再手动点一次“更新”。**本地预览是即时的**。

> 只想推部分平台时仍可用单独脚本：`publish.sh`（GitHub 根路径 → Cloudflare+EdgeOne）、
> `publish-gitee.sh <repo>`（Gitee 子路径）。

---

## 一键发布到全部四个平台（`publish-all.sh`）

这套脚本把「本地一次操作 → 四个免费平台同时上线」自动化。核心是**两份构建、四处分发**：

```
                       ┌─ 根路径构建 dist/ ──→ GitHub master ─┬─→ Cloudflare Pages（海外，自动）
本地 blog.db           │                                      └─→ EdgeOne Pages（国内加速，自动）
  │  publish-all.sh    │
  └────────────────────┤
                       └─ /blog 子路径构建 ─┬─→ GitHub gh-pages 分支 ─→ GitHub Pages（自动）
                                            └─→ Gitee master ────────→ Gitee Pages（手动点“更新”）
```

**为什么要两份构建**：
- Cloudflare / EdgeOne 在**域名根路径**托管，资源用 `/static`、`/posts`（根路径版）。
- GitHub Pages（`sfqin.github.io/blog`）和 Gitee Pages（`qzcsu.gitee.io/blog`）都在
  **同一个 `/blog` 子路径**下（正好是仓库名），所以**一份 `BASE_URL=/blog` 构建喂两家**。

**一次性准备**（两个远程都已配好，换机时才需重配）：
```bash
git remote add origin git@github.com:sfqin/blog.git   # GitHub
git remote add gitee  git@gitee.com:qzcsu/blog.git     # Gitee
```

**用法**：
```bash
DB_PATH=./blog.db ./scripts/publish-all.sh                 # 推全部四个平台
DB_PATH=./blog.db ./scripts/publish-all.sh "post: 新文章"   # 自定义提交说明
SKIP_GITEE=1     ./scripts/publish-all.sh                   # 跳过 Gitee
SKIP_GH_PAGES=1  ./scripts/publish-all.sh                   # 跳过 GitHub Pages
SUBPATH=/blog    ./scripts/publish-all.sh                   # 覆盖子路径（默认 /blog）
```

**各平台一次性开启方式**：
| 平台 | 数据源 | 控制台一次性设置 | 访问地址 |
|------|--------|------------------|----------|
| Cloudflare Pages | GitHub `master` 的 `dist/` | Connect to Git → 选 `sfqin/blog`；构建命令留空、输出目录 `dist` | `https://<项目名>.pages.dev` |
| EdgeOne Pages | 同一个 GitHub `master` | 导入同一个 `sfqin/blog`；同上设置 | EdgeOne 默认域名 |
| GitHub Pages | GitHub `gh-pages` 分支 | Settings → Pages → Deploy from a branch → 分支 `gh-pages`、目录 `/(root)` | `https://sfqin.github.io/blog/` |
| Gitee Pages | Gitee `master` | 实名认证 → 服务 → Gitee Pages → 分支 `master` → 启动；**之后每次推送后点“更新”** | `https://qzcsu.gitee.io/blog/` |

> `gh-pages` 分支和 Gitee `master` 由脚本用临时仓库单独强推，是**纯静态站**（根目录就是
> `index.html`），不含源码历史，也不会污染 master。因此 GitHub Pages 直接选 `gh-pages`
> 就能出站，无需把静态文件塞进 master 根目录或 `docs/`。

---

## 关于"国内也要能访问"（如实说明）

- Cloudflare Pages 免费版在中国大陆**没有节点**，走的是海外（多为日本/新加坡/香港）
  节点，所以国内能访问、但**速度和稳定性不如**国内 CDN 或香港 VPS，偶有波动属正常。
- 这已经是**免费方案里国内表现最好**的之一，明显好于 GitHub Pages 直连。
- 若将来要国内极致稳定：可换成香港 VPS（本仓库仍保留了 `Caddyfile` /
  `s_blog.service` / `deploy.sh` 动态部署方案），或域名做 ICP 备案 + 国内 CDN。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| Cloudflare/EdgeOne 构建失败，日志出现 `npm install` / `Exit handler never called` | 平台误把项目当 Node 项目去装依赖。本项目是**纯静态站**：确认**构建命令留空、输出目录填 `dist`**；`package.json` 已移到 `scripts/` 下，仓库根不应再有它（若手动加回会重现此错）。
| 打开 pages.dev 样式/JS 丢失 | 确认 Cloudflare/EdgeOne 输出目录填的是 `dist`、构建命令留空 |
| 文章点进去 404 | 确认是用发布脚本发布的（会生成 `posts/<slug>.html`） |
| 改了内容线上没变 | 确认 `publish-all.sh` 推送成功；到平台控制台看部署日志 |
| GitHub Pages / Gitee 样式全乱、资源 404 | 子路径版没构建对：确认脚本按 `BASE_URL=/blog` 出的站，且仓库名与子路径一致（都为 `blog`） |
| GitHub Pages 打不开/404 | Settings → Pages 里 Source 要选 **`gh-pages` 分支 + `/(root)`**，不是 master |
| Gitee push 了但没更新 | Gitee 免费版不自动部署，需到 服务 → Gitee Pages 手动点“更新” |
| EdgeOne/Gitee 绑域名报要备案 | 国内加速区自定义域名需 ICP 备案；先用平台默认域名（免备案） |
| 后台打不开 | 后台无需登录、没有密码，直接访问 `http://localhost:8080/admin` |
| 只想推某几个平台 | 用 `SKIP_GITEE=1` / `SKIP_GH_PAGES=1` 环境变量跳过对应目标 |

---

## 附：另一条路（动态后台，付费香港 VPS）

如果你以后更看重"网页后台随处可访问 + 国内最稳"，本仓库也保留了把整套 Go 服务
部署到服务器的方案，见 `README.md` 的 "Deploying" 一节与 `Caddyfile` /
`s_blog.service` / `scripts/deploy.sh`。两条路的代码是同一套，可随时切换。

---

## 瞬间（moments）图片 / 视频托管：Cloudflare R2

> 记录于 2026-07-14。「瞬间」板块用于发照片 / 短视频 + 文字（也可纯文字当日记）。

**为什么不直接把图片放进仓库？** 免费 Pages 平台单文件多有 25MB 限制，图片/视频
也会把 git 仓库越撑越大、发布越来越慢。所以站点**只在数据库里存外链 URL**，媒体本身
放对象存储。这里选 **Cloudflare R2**：免费额度 10GB 存储、**出站流量全免费**（无
「流量费」这项，看图的人再多也不额外收费），且和已有的 Cloudflare 账号打通。

### 一次性设置（你在 Cloudflare 控制台操作）

1. 登录 Cloudflare → 左侧 **R2** → **Create bucket**，名字如 `blog-media`，位置选
   Automatic 即可。
2. 进入该 bucket → **Settings** → **Public access** → 开启 **R2.dev subdomain**
   （会给一个形如 `https://pub-xxxx.r2.dev` 的公开域名）。
   - 想更快/更稳可选：**Custom Domain** 绑定自己在 Cloudflare 托管的域名（如
     `img.你的域名`），走 Cloudflare CDN，国内外都比 `r2.dev` 直连稳。
3. 上传照片/视频：bucket 页面直接拖拽上传，或用 `rclone` / `aws s3` 客户端批量传。
4. 点开某个文件 → 复制它的公开 URL（`https://pub-xxxx.r2.dev/2026/kl-night.jpg`
   这种）。

### 在后台发一条「瞬间」

1. `http://localhost:8088/admin/moments` → **+ new**。
2. **place 地点**、**date 日期**、**caption 文字说明** 按需填。
3. **media** 文本框：把上一步复制的公开链接**每行粘一个**，可混放图片和视频。
   - 图片：`.jpg/.png/.webp/.gif` 等 → 渲染成缩略图，点开是灯箱大图，可左右翻。
   - 视频：`.mp4/.webm/.mov/.m4v/.ogv` → 自动识别，页面内直接播放（带原生控件）。
   - media 全部留空 = 纯文字瞬间（当日记用）。
4. save 后主页 `#moments` 立即出现；发布时随静态站一起导出，链接指向 R2，看图的人
   直接从 Cloudflare 拿图，不占 Pages 流量。

### 让图片加载更快的几个点

- 上传前把照片压到「长边 ~2000px、JPEG/WebP」再传，手机看足够清晰、加载还快。
- 优先用 **Custom Domain**（走 Cloudflare CDN）而不是裸 `r2.dev`。
- 视频尽量短、优先 `.mp4`（H.264）兼容性最好；长视频建议传到 B 站/YouTube 再贴
  链接（本板块目前是直链内嵌播放，不做第三方播放器解析）。

> 备选图床：七牛云 / 又拍云（国内更快，但有免费额度门槛与实名要求）、GitHub 仓库
> 直链（小图可用、大文件不合适）。换任何图床都一样——只要能拿到公开直链，粘进 media
> 即可，站点侧无需改动。

