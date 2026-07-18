# dev@home —— 复古 CRT 终端风个人博客

**中文** · [English](README.en.md)

一个复古终端 / CRT 风格的个人主页博客，带一个可交互的 3D「足迹」地球。
你在**本地后台**里写文章、传照片、标足迹，然后**一键发布**到网上——最终得到一个
**免费、全世界都能访问**的个人网站。

> 🔰 **完全不用会编程。** 拿到发布包后双击一个文件，跟着网页里的按钮走即可。
> 详细图文见 [`docs/新手指南.md`](docs/新手指南.md)。

> 📦 **下载客户端**（按你的系统二选一，双击即用、无需装任何环境）：
> - 苹果电脑 macOS → [**Blog-macOS.zip**](https://github.com/sfqin/blog_self/releases/download/v1.0.0/Blog-macOS.zip)（解压后双击 `Start-Blog.app`）
> - Windows → [**Blog-Windows.zip**](https://github.com/sfqin/blog_self/releases/download/v1.0.0/Blog-Windows.zip)（解压后双击 `Start-Blog.vbs`）
>
> 也可到 [**最新版发布页**](https://github.com/sfqin/blog_self/releases/latest) 挑选。

---

## 一、它能做什么 / 最终能得到什么

- ✅ 在**自己电脑的后台**里写博客：个人资料、经历、随想、项目、文章、足迹、瞬间，
  **保存即时生效**，不用重新构建。
- ✅ **一键发布上线**：把内容渲染成静态网页并推送到 GitHub，自动开启 GitHub Pages。
- ✅ 得到一个**免费的公网地址**，形如 `https://你的用户名.github.io/blog/`，用手机、
  电脑、发给朋友都能直接打开，**无需服务器、无需付费**。
- ✅ 一个可交互的 **3D 地球**，展示你去过的城市（可下钻到 国家 → 省/州 → 城市）。

**最终效果**：一个属于你自己的、复古终端风、带 3D 足迹地球的个人网站，长期免费在线。

---

## 二、需要准备什么

只要两样东西：

1. **一台电脑**（Windows 或苹果 macOS 都行）。不用安装开发环境——发布包里已自带程序。
2. **一个 GitHub 账号**（免费）。没有就去 <https://github.com> 用邮箱注册一个；
   它用来免费托管你的网站。

> 你会拿到一个对应系统的发布包（由维护者用 `scripts/package-release.sh` 生成）：
> 苹果电脑下 **`Blog-macOS.zip`**、Windows 下 **`Blog-Windows.zip`**。
> 双击解压得到 `Blog-macOS` / `Blog-Windows` 文件夹，把**整个文件夹**放到桌面或「文稿」里。

---

## 三、怎么做（demo 全流程）

全程**不用打开终端敲命令**，都在网页里点按钮。

### 第 0 步：启动（分系统）

| 系统 | 双击这个文件 | 说明 |
|------|-------------|------|
| **苹果 macOS** | `Start-Blog.app` | 首次可能提示「身份不明的开发者」：**右键 → 打开 → 再点打开**即可。没有黑窗口。 |
| **Windows** | `Start-Blog.vbs` | 若弹「Windows 已保护你的电脑」：点**更多信息 → 仍要运行**。没有黑窗口。 |

> 备用启动方式：macOS 用 `Start-Blog.command`、Windows 用 `Start-Blog.bat`（会显示一个文字窗口）。

启动后浏览器会**自动打开**一个叫「一步步上线你的博客」的向导页
（地址类似 `http://localhost:8080/setup`；若 8080 被占用会自动换 8081、8082……，
以浏览器实际打开的地址为准）。

### 第 1～5 步：跟着网页向导走

每一步都有状态灯：**✓ 绿色**=没问题，**✗ 红色**=点旁边的按钮处理。

| 步骤 | 做什么 |
|------|--------|
| **① 环境检测** | 检查 Git 和 GitHub CLI 两个小工具。显示 ✗ 就点按钮，程序会**自动下载安装**（macOS 弹系统对话框点「安装」；GitHub CLI 直接从官网下载），**不需要 Homebrew 等任何别的软件**。装完点 **↻ 重新检测**。 |
| **② 连接 GitHub** | 点「用浏览器登录 GitHub」，网页显示一个一次性代码（像 `ABCD-1234`），粘到自动打开的授权页里确认。之后再也不用输密码。 |
| **③ 创建仓库** | 给博客起个名字（默认 `blog`，会成为网址的一部分）。仓库固定创建为**公开（Public）**——GitHub Pages 免费版只能发布公开仓库。 |
| **④ 写文章 / 本地预览** | 进入后台 `/admin`（**无需登录、没有密码，直接打开**），填资料、经历、项目、文章、足迹、瞬间；随时点「本地预览首页」看效果，**保存即生效**。 |
| **⑤ 一键发布上线** | 回到向导页点 **🚀 一键发布上线**。等 1～2 分钟，页面显示你的**网站地址**（`https://你的用户名.github.io/blog/`），点开就是你的博客！ |

### 以后怎么用

就三步：**双击启动器 → 后台写/改内容并本地预览 → 打开 `/setup` 点一键发布**。
不发布，改动只在本地；发布后，全世界都能看到。

> 不用找「停止」按钮：关掉所有博客网页后，程序约 1 分钟自动停止。想立刻用最新版本，
> 再次双击启动器（会问你「打开网页 / 重启」）。

---

## 四、博客的特色与模块

**前台（`/`，访客看到的页面）**
- **个人资料**、**职业经历**、**随想**、**项目**、**最新文章**
- **3D 足迹地球**：拖拽旋转、缩放、下钻到 国家 → 省/州 → 城市；随真实时间显示昼夜
  光照；手机支持双指缩放与拖动。已内置 **5 个国家**的可下钻数据，且外国地名**中英双语**：
  中国（全省 + 港澳台，34 个省级可下钻）、日本、马来西亚、新加坡、泰国。
- **瞬间信息流**：图片 / 短视频 / 纯文字日记
- **全站模糊搜索**

**文章页（`/posts/{slug}`）**：Markdown 自动渲染为网页。

**后台（`/admin`，无需登录）**：对每一块内容增删改，保存即写入本地数据库，前台下次
加载即生效。后台只在你自己电脑上运行，所以不设密码、打开即用。

| 版块 | 说明 |
|------|------|
| **资料 Profile** | 名字、标题、slogan、关于（Markdown）、技术栈标签、GitHub、邮箱、位置 |
| **经历 Experiences** | 职业时间线，可排序 |
| **随想 Thoughts** | 短观点卡片，带主题和日期 |
| **项目 Projects** | 名称、描述、语言、星标、License、链接，可排序 |
| **文章 Posts** | Markdown 文章；勾选 `published` 才会上线，草稿不外泄 |
| **足迹 Footprints** | 一条 = 一座去过的城市（国家 → 省/州 → 城市联动选择），可写备注、关联多条瞬间 |
| **瞬间 Moments** | 图片 / 短视频 / 纯文字动态 |

**关于媒体**：站点本身**不托管图片/视频**，而是引用外部 URL（推荐图片放 Cloudflare R2
等对象存储），因此无体积限制、加载快。B 站 / YouTube 链接粘普通观看页即可自动内嵌播放。

**安全**：后台无登录、无密码（本机单人使用）；表单仍有 CSRF 双提交 Cookie 防护。
如果你选择把它部署成**公网动态站**（见下文），`/admin` 是公开可写的——请在反向代理
层自行加访问控制（如 Caddy `basicauth`），或仅用静态发布模式。

---

## 五、未来展望 & 联系方式

- 🎨 **多主题**：当前是复古 CRT 终端风，后续计划支持更多可切换主题（明亮 / 极简 /
  杂志风等），让每个人的博客更有个性。
- 更多国家的足迹数据、更多内容模块，也在路上。

有问题、建议或想一起完善，欢迎联系： **sfqincsu@163.com**

---

## 进阶：开发者 / 技术参考

上面是「小白双击即用」的路线。如果你会命令行，也可以直接用源码运行、或部署成动态站点。

### 快速开始（源码运行，需 Go 1.23+）

```bash
go build -o ./blogbin .
./blogbin serve
# → 监听 :8080；后台 http://localhost:8080/admin （无需登录，直接打开）
```

整个前端（HTML 模板、CSS、JS、地理数据）通过 `//go:embed` 编译进**一个可执行文件**，
部署就是拷一个二进制。

### 环境变量

| 变量 | 默认值 | 含义 |
|------|--------|------|
| `ADDR` | `:8080` | 监听地址。生产建议 `127.0.0.1:8080`（回环，前置反代） |
| `DB_PATH` | `blog.db` | SQLite 文件路径 |
| `SECURE_COOKIES` | *(关)* | 设为 `1` 时 CSRF Cookie 仅走 HTTPS；生产环境开启 |

### 子命令

```bash
./blogbin serve          # （默认）启动后台 + 前台服务
./blogbin export [dir]   # 把当前数据库渲染成静态站（默认输出 ./dist）
BASE_URL=/blog ./blogbin export dist   # 子路径构建（用于 user.github.io/blog 这类子路径）
```

「一键发布」本质就是 `export` + 推送到 GitHub Pages（见 `internal/setup/publish.go`）。
`export` 会把首页、每篇已发布文章渲染成 HTML，把足迹 JSON 写到 `dist/api/footprints`
（正是地球 fetch 的路径）、搜索索引写到 `dist/api/search`，再拷贝全部静态资源。后台只在
本地跑，数据库不出本机。

### 数据与备份

你的**全部内容**都在一个文件里：`~/dev-home-blog/blog.db`
（macOS `/Users/你/dev-home-blog/blog.db`，Windows `C:\Users\你\dev-home-blog\blog.db`）。
备份就复制它；换电脑就拷到新电脑同样位置。

### 动态部署（可选，付费 VPS，线上后台随处可编辑）

若想让线上 `/admin` 随时可编辑、改完即时生效，可把 Go 服务跑在服务器上。推荐
**香港（或就近海外）VPS + Cloudflare + 自有域名**。仓库内已含 `Caddyfile`（反代 + 自动
HTTPS）与 systemd 单元；详见 [`DEPLOY.md`](DEPLOY.md)。

```bash
./scripts/deploy.sh push blog@your-server-ip   # 编译 → 上传 → 重启
./scripts/deploy.sh build                       # 只编译 Linux 二进制（输出 dist/s_blog）
```

### 重新生成地球地理数据

`web/static/geo/` 下的地理 JSON 已预生成，通常不用动。要重建（需联网 + Node）：

```bash
node scripts/gen_geo.mjs            # 重建全部国家
node scripts/gen_geo.mjs SG TH      # 只重建指定国家
```

已内置国家：CN（34 省级可下钻）、JP（25）、MY（13）、SG（5）、TH（15），外国地名均为中英双语。
初始只加载 `world.json`，区域文件在下钻时按需懒加载。

### 打包发布包（维护者）

```bash
./scripts/package-release.sh   # 生成 dist-release/ 下的两个分平台压缩包
```

产物是**按系统拆分的两个压缩包**：`Blog-macOS.zip`（含 `Start-Blog.app` / `.command`
+ macOS 二进制）与 `Blog-Windows.zip`（含 `Start-Blog.vbs` / `.bat` + Windows `.exe`），
各自都带启动加载页 `loading.html` 与 `docs/新手指南.md`。用户只需下载对应自己系统的那个。

> **客户端目录**：给最终用户的「客户端」就是打包生成的 **`dist-release/Blog-macOS/`** 与
> **`dist-release/Blog-Windows/`** 文件夹（压缩后即两个 zip）——里面是双击即用的启动器和
> 自包含程序，用户无需装任何环境。它由脚本自动生成、**不纳入版本库**（见 `.gitignore`）。
> 客户端启动器的**源文件**放在仓库的 **`packaging/`** 目录（`mac/` 的 `.app` 外壳与 `launch`、
> `windows/` 的 `.vbs`、以及共用的 `loading.html`），配合仓库根目录的 `Start-Blog.command` /
> `Start-Blog.bat`。

### 项目结构

```
main.go                     入口；embed ./web；serve / export 两个子命令
internal/
  models/                   内容类型 + 搜索索引、标签、足迹分组、瞬间媒体解析
  store/                    SQLite 访问（schema.sql + 每类内容一个文件）
  auth/                     token 助手（CSRF）
  render/                   html/template + goldmark（Markdown）
  server/                   路由、中间件（CSRF）、handlers、gzip
  setup/                    新手向导：环境检测 / GitHub 登录 / 建仓 / 一键发布
  export/                   把数据库渲染成静态站
web/
  templates/public/         home.html, post.html
  templates/admin/          仪表盘、各版块 list/form、setup 向导页
  static/css|js/            CRT 主题、后台、globe.js、moments.js、search.js、setup.js
  static/geo/               地球用的 world + 区域 JSON（预生成）
scripts/
  package-release.sh        打包小白双击发布包（含跨平台二进制 + 启动器）
  deploy.sh                 编译 / 推送到 VPS
  gen_geo.mjs               （重）生成地理数据（需联网）
  globe_logic_test.mjs      地球纯逻辑测试
packaging/                  客户端启动器源文件（打包进 dist-release/ 的分平台客户端）
  mac/                      Start-Blog.app 的 Info.plist 与 launch 控制脚本
  windows/                  Start-Blog.vbs（无窗口启动器）
  loading.html              双击后立即显示的启动加载页（探测服务就绪后自动进向导）
Start-Blog.command          macOS 备用启动器（可见终端窗口）
Start-Blog.bat              Windows 引擎 / 可见备用启动器
```

### 开发与验证

```bash
node --check web/static/js/xxx.js   # 改了 JS 时
go build -o ./blogbin .             # 编译（静态资源已 embed，改前端也要重新编译）
go vet ./...
go test ./...                       # 全部测试
node scripts/globe_logic_test.mjs   # 地球纯逻辑测试
```

> 前端资源编译进二进制，改完模板/CSS/JS 需**重新 `go build` 并重启服务**才生效。
