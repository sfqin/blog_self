# blog_self ·「星夜远行」个人博客

**中文** · [English](README.en.md)

用 Markdown 写文章，用星座导航串起经历、项目、思考和瞬间，再用 3D 足迹地球记录走过的地方。支持在自己的电脑上写作，发布到 GitHub Pages、静态托管平台或自己的服务器。

[查看个人实例](https://sfqin.github.io/blog/) · [下载客户端](https://github.com/sfqin/blog_self/releases) · [反馈问题](https://github.com/sfqin/blog_self/issues)

## 先选一种使用方式

**写作入口和网站部署位置是两件事。** 客户端、本地网页后台都把内容保存到 SQLite；访客可以访问导出的静态网站，也可以访问服务器上运行的动态网站。

| 你的需求 | 写作方式 | 网站部署方式 |
| --- | --- | --- |
| 不想配置开发环境 | 下载客户端，双击后在浏览器后台写作 | 后台一键发布到 GitHub Pages |
| 想使用最新源码或修改界面 | 本地编译运行，在网页后台写作 | GitHub Pages / 导出到其他静态主机 |
| 平时使用 VS Code、Typora、Obsidian | 在外部编辑器写 `.md`，再把正文粘贴到后台 | 保存后按所选部署方式发布 |
| 已有服务器，想低成本维护 | 本地写作，导出静态文件 | Nginx 等静态文件服务 |
| 想在服务器后台直接写，保存后立即上线 | 使用支持常驻运行与管理网关的个人实例 | Go 服务 + Nginx + systemd；见[动态部署说明](#动态部署个人实例) |

> **当前没有 Markdown 目录扫描或批量导入功能。** 把 `.md` 放进仓库，不会自动变成文章。下面会说明实际支持的写法、内容保存位置和发布步骤。

## 写作方式一：直接使用客户端

适合不想安装 Go 或操作终端的用户。客户端会在电脑上启动博客程序，并打开浏览器中的后台；它与源码运行使用的是同一套编辑界面。

### 下载与启动

到 [GitHub Releases](https://github.com/sfqin/blog_self/releases) 下载并解压完整安装包：

| 系统 | 下载文件 | 启动入口 |
| --- | --- | --- |
| macOS（Apple Silicon / Intel） | `Blog-macOS.zip` | `Start-Blog.app`；备用入口为 `Start-Blog.command` |
| Windows x64 | `Blog-Windows.zip` | `Start-Blog.exe`；排错入口为 `Start-Blog-console.bat` |

**版本说明：本 README 描述 master 的能力。当前已发布的 v1.2.0 安装包早于「星夜远行」重构；要立即使用新版界面，请使用下方源码启动方式，或[自行打包客户端](#开发与打包)。更新 master 不会自动更新 Releases 安装包。**

双击启动后，按以下顺序操作：

1. 打开向导 `/setup`。如果准备发布到 GitHub，按提示安装 Git / GitHub CLI，并完成 GitHub 浏览器授权。
2. 创建自己的博客仓库，或关联自己有发布权限的仓库。向导默认创建公开仓库，用于 GitHub Pages。
3. 进入 `/admin`，填写个人资料、经历、足迹等内容，在「文章」中新建文章。
4. 填写标题、slug、日期、标签及 Markdown 正文。先不勾选 `published` 可以保存草稿；准备公开时勾选并保存。
5. 打开本地首页预览，再到后台「发布上线」（`/admin/publish`）或向导 `/setup` 点击发布。等待 GitHub Pages 构建完成后访问公网地址。

只在本地写作、预览时，不需要 GitHub 账号。GitHub 授权用于建仓和发布，不是本地后台的登录账号。

<details>
<summary>首次启动被系统拦截怎么办？</summary>

macOS：确认下载来源后，在 **系统设置 → 隐私与安全性 → 仍要打开** 中授权，再次启动应用。

<img src="fengxian.png" alt="macOS 首次打开提示" width="360">
<img src="yinsi.png" alt="在隐私与安全性中授权打开" width="560">

Windows：确认来源后，在 SmartScreen 中选择「更多信息 → 仍要运行」。

</details>

客户端默认把数据放在用户主目录的 `dev-home-blog/blog.db`，不在安装包里。升级安装包后，重新启动程序即可继续使用原来的数据。当前源码的本地模式会在所有博客页面停止发送心跳约 5 分钟后退出；之后重新启动即可。

## 写作方式二：本地部署网页后台

适合需要最新 master、使用 Linux，或准备修改代码的用户。需要 **Go 1.23+**；克隆源码需要 Git，发布到 GitHub Pages 还需要 GitHub CLI（`gh`）。普通运行不需要 Node.js、MySQL 或独立的前端构建服务。

### macOS / Linux

```bash
git clone https://github.com/sfqin/blog_self.git
cd blog_self
go build -o ./blogbin .

DATA_DIR="$HOME/dev-home-blog"
mkdir -p "$DATA_DIR"
ADDR=127.0.0.1:8080 \
  DB_PATH="$DATA_DIR/blog.db" \
  REPO_DIR="$DATA_DIR" \
  ./blogbin serve
```

保持终端运行，打开：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:8080/` | 本地预览首页 |
| `http://localhost:8080/admin` | 编辑所有内容 |
| `http://localhost:8080/setup` | 首次配置 GitHub / 发布 |
| `http://localhost:8080/admin/publish` | 后续发布到 GitHub Pages |

如果 8080 被占用，程序会尝试后续端口，以启动日志中的实际地址为准。

这里显式指定 `DB_PATH`，因此可以继续使用客户端的数据；`REPO_DIR` 指向自己的发布工作目录，避免把下载源码时的上游仓库误当成发布目标。两个入口不要同时编辑同一份数据库。

<details>
<summary>Windows PowerShell 启动命令</summary>

```powershell
git clone https://github.com/sfqin/blog_self.git
cd blog_self
go build -o blogbin.exe .

$dataDir = Join-Path $env:USERPROFILE "dev-home-blog"
New-Item -ItemType Directory -Force $dataDir | Out-Null
$env:ADDR = "127.0.0.1:8080"
$env:DB_PATH = Join-Path $dataDir "blog.db"
$env:REPO_DIR = $dataDir
.\blogbin.exe serve
```

</details>

本地后台没有独立账号密码，上面的命令将服务绑定到本机回环地址。公网编辑应使用已配置鉴权的管理入口，不能直接把本地 `/admin`、`/setup` 暴露到公网。

## 写作方式三：用自己的 Markdown 编辑器

可以先在 VS Code、Typora、Obsidian 等工具中写好文章。例如，你可以自己创建：

```text
~/my-writing/
└── my-first-post.md
```

这个目录由你管理，**不是程序约定的导入目录**。当前的录入步骤是：

1. 在编辑器中完成 Markdown 正文。
2. 打开博客后台的「文章 → 新建」，把正文粘贴到 `body 正文（Markdown）`。
3. 在表单中单独填写标题、slug、日期和标签。文件名与 YAML front matter 不会被自动解析为这些字段。
4. 预览正文，勾选 `published` 并保存；如果使用静态托管，再执行一次发布。

例如，表单标题填「我的第一篇博客」，slug 填 `my-first-post`，正文可以是：

```markdown
## 今天开始记录

这里是正文，可以写 **重点**、列表、引用和代码块。

![旅途照片](https://example.com/photo.jpg)
```

动态站文章地址为 `/posts/my-first-post`；静态导出文件为 `posts/my-first-post.html`，模板会生成对应的静态链接。

项目支持 Markdown 标题、列表、代码块、引用和表格。图片、视频使用外部 URL；需要先放到自己管理的图床或对象存储中，项目没有内置图片/视频上传存储服务。

### 为什么不直接放到 `posts/` 或 `web/`？

| 位置 | 实际作用 |
| --- | --- |
| `blog.db` 中的 `posts` 表 | 文章数据来源，Markdown 正文保存在 `body_md` 字段 |
| `web/templates/public/post.html` | 所有文章共用的页面模板，不是某一篇文章 |
| `web/static/` | CSS、JavaScript、字体和地图等程序资源 |
| 导出目录中的 `posts/*.html` | 自动生成的公开页面，下次导出会重建 |
| 任意自建的 `.md` 目录 | 个人写作素材；当前不会被程序自动读取 |

因此，不要通过修改生成的 HTML 来维护文章，也不需要直接修改 SQLite 表。日常内容编辑使用后台即可。

## 部署方式一：GitHub Pages

**推荐用于“本地写作，免费公开访问”。** GitHub Pages 只托管导出的 HTML、CSS、JavaScript、地图与公开内容，不运行 Go 服务，也不提供写作后台。

1. 用客户端或本地源码方式启动后台。
2. 在 `/setup` 完成 GitHub 授权，并确认发布目标是自己的仓库。
3. 编辑内容后点击「发布上线」。程序会导出当前数据库中的公开内容，并推送到目标仓库的 `gh-pages` 分支。
4. 若没有自动启用 Pages，到仓库 **Settings → Pages**，选择 **Deploy from a branch → gh-pages → /(root)**。
5. 等待 GitHub 的 Pages 构建完成，访问 `https://你的用户名.github.io/仓库名/`。

**日常流程：修改内容 → 保存 → 本地预览 → 再次发布。** 只勾选 `published` 是把文章设为可公开状态，不等于已经更新 GitHub Pages。未发布的草稿不进入导出结果。

`master` 保存源码，`gh-pages` 保存生成的网站；更新其中一个分支不会自动更新另一个。数据库也不会上传到 Pages。通过向导发布时，仓库名决定 URL 子路径，推荐使用普通项目仓库，例如 `blog`。

### 命令行导出与发布脚本

只生成静态文件、不推送 GitHub：

```bash
# 在已编译出 blogbin 的源码目录运行；/blog 要与目标仓库名对应。
DB_PATH="$HOME/dev-home-blog/blog.db" BASE_URL=/blog \
  ./blogbin export "$HOME/blog-export"
```

`export` 会清空并重建指定输出目录。该目录只用于生成文件，不要选数据库目录或写作素材目录。

仓库还保留了进阶发布脚本，执行前先确认当前仓库与 remote：

| 脚本 | blog_self 上游中的行为 |
| --- | --- |
| `scripts/publish.sh` | 生成根路径 `dist/`，提交并推送当前源码分支 |
| `scripts/publish-all.sh` | 更新并推送 `dist/`，再发布 `gh-pages`；配置了 Gitee remote 时还可能推送 Gitee |
| 后台「发布上线」 | 只向目标仓库的 `gh-pages` 推送静态站，不提交源码修改 |

`SKIP_GITEE=1` 可让上游多平台脚本跳过 Gitee，`SUBPATH=/仓库名` 控制子路径。**只需要 GitHub Pages 时，优先使用后台发布。** 个人实例 `s_blog` 的同名脚本已经调整过，不会向 master 提交 `dist/`，具体以该仓库说明为准。

## 部署方式二：其他静态托管或自己的 Nginx

适合已有域名、Cloudflare Pages、EdgeOne Pages 或自建服务器的情况。浏览器访问生成的网站，服务器无需安装 Go 或 SQLite。

### 1. 导出根路径网站

```bash
DB_PATH="$HOME/dev-home-blog/blog.db" BASE_URL= \
  ./blogbin export "$HOME/blog-export"
```

输出结构如下：

```text
blog-export/
├── index.html
├── posts/               # 已发布文章的 HTML
├── api/footprints       # 足迹数据
├── api/search           # 公开内容搜索索引
└── static/              # 样式、脚本、字体、地图
```

域名根路径如 `https://example.com/` 使用空 `BASE_URL`；子路径如 `https://example.com/blog/` 使用 `BASE_URL=/blog`。否则样式、脚本和文章链接可能指向错误的位置。

### 2. 交给静态主机

- **Cloudflare Pages / EdgeOne Pages**：上传导出目录的内容，或让平台部署你自己发布仓库中的静态产物。产物已在本地生成，平台无需运行 Go 或安装 npm 依赖。
- **Nginx**：把产物同步到单独的网站目录，再配置站点根目录。例如目标服务器已准备好 `/var/www/my-blog/` 和对应写权限时：

```bash
rsync -av --delete "$HOME/blog-export/" blog@your-server:/var/www/my-blog/
```

`--delete` 用于同步删除已撤回的文章；目标目录必须专门用于该静态站，不能混放数据库或其他应用文件。

Nginx 静态路由示例（域名、TLS 证书按自己的服务器配置）：

```nginx
server {
    listen 80;
    server_name blog.example.com;
    root /var/www/my-blog;
    index index.html;

    location / {
        try_files $uri $uri.html $uri/ =404;
    }
}
```

每次修改内容后重新导出、同步即可。这里仅上传公开产物，**不把 `blog.db` 放进网站根目录**。

## 动态部署：个人实例

动态站由 Go 服务直接读取服务器上的 SQLite。通过服务器管理后台保存内容后，刷新公网页面即可看到更新，不需要静态导出；GitHub Pages 不会跟着自动更新。

需要区分两个仓库当前的能力：

| 仓库 | 定位 | 动态服务差异 |
| --- | --- | --- |
| [blog_self](https://github.com/sfqin/blog_self) | 开源上游模板 | 本地运行模式含约 5 分钟无心跳退出机制；当前不读取 `SERVER_MODE` |
| [blog](https://github.com/sfqin/blog)（本地目录名 `s_blog`） | 作者的个人实例 | 支持 `SERVER_MODE=1` 常驻运行，以及受鉴权保护的 Ops 管理网关 |

**上游模板用于自建服务器时，优先采用前面的静态部署方式。** 仓库中的 `Caddyfile`、`s_blog.service` 和 `scripts/deploy.sh` 是早期部署参考，不包含个人实例现用的常驻与管理网关配置，不能直接当作当前生产部署方案。

如果维护的是个人实例，参阅其[自建服务器部署与写作说明](https://github.com/sfqin/blog/blob/master/docs/self-hosted.md)：其中列出了编译上传、systemd 配置、后台入口、数据目录、版本更新与回滚方式。该实例包含作者自己的站点配置，复用时应替换为自己的配置。

## 内容保存在哪里，如何备份？

| 启动方式 | 内容数据库 |
| --- | --- |
| macOS 客户端 | `/Users/你的用户名/dev-home-blog/blog.db` |
| Windows 客户端 | `C:\Users\你的用户名\dev-home-blog\blog.db` |
| 按本 README 的源码命令启动 | 同客户端，显式指定的 `DB_PATH` |
| 不设置 `DB_PATH`，直接执行 `./blogbin serve` | 当前工作目录中的 `blog.db` |
| 个人实例的自建服务器 | `/opt/s_blog/data/blog.db`，以实际服务配置为准 |

客户端数据、本地仓库里的数据库、服务器数据库**不会自动同步**。如果内容突然不同，先核对正在运行的程序使用了哪个 `DB_PATH`。静态站的导出文件也不是一份完整数据库备份。

停止程序后可以备份整个数据目录。程序运行时，建议使用 SQLite 在线备份，不要只复制可能仍有 WAL 写入的 `blog.db`。安装了 `sqlite3` 命令后，例如：

```bash
BACKUP_FILE="$HOME/blog-backup-$(date +%Y%m%d-%H%M%S).db"
sqlite3 "file:$HOME/dev-home-blog/blog.db?mode=ro" ".backup '$BACKUP_FILE'"
```

换电脑时，停止目标程序，把备份数据库放到目标 `DB_PATH`，再启动。图片和视频存储在外部服务中，需要单独维护对应资源。数据库不应提交到 GitHub。

## 常用配置与开发

### 环境变量

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `ADDR` | `:8080` | 监听地址；本地使用建议显式设为 `127.0.0.1:8080` |
| `DB_PATH` | `blog.db` | 当前实例的 SQLite 路径 |
| `REPO_DIR` | `.` | GitHub 向导使用的发布工作目录 |
| `BASE_URL` | 空 | 仅静态导出时使用的 URL 子路径，如 `/blog` |
| `SECURE_COOKIES` | 关闭 | 设为 `1` 时，CSRF Cookie 仅通过 HTTPS 发送；本地 HTTP 不要开启 |

### 开发与打包

模板、CSS、JavaScript、字体和地图通过 `go:embed` 编入一个可执行文件。**改内容只需保存；改界面或代码需要重新编译、重启，静态网站还需重新导出发布。**

```bash
go build -o ./blogbin .
go test ./...
go vet ./...
npm ci --prefix scripts       # 仅运行浏览器测试/地图工具时需要 Node.js
npm test --prefix scripts

# 在 macOS/Linux 构建客户端安装包；会重建 dist-release/。
./scripts/package-release.sh
```

安装包输出为 `dist-release/Blog-macOS.zip` 与 `dist-release/Blog-Windows.zip`；它们需要维护者另行上传到 GitHub Releases。启动器源码位于 `packaging/`、`cmd/windows-launcher/` 及仓库根目录的启动脚本中。

| 路径 | 用途 |
| --- | --- |
| `main.go` | `serve` / `export` 入口 |
| `internal/store/` | SQLite 表结构与内容读写 |
| `internal/server/` | 公开页、后台和向导路由 |
| `internal/export/` | 静态网站导出 |
| `internal/setup/` | GitHub 授权、建仓与发布 |
| `web/templates/` | 前台和后台模板 |
| `web/static/` | 样式、交互、字体和地图 |
| `scripts/seed_fixture.sh` | 虚构演示数据；会替换目标库内容，只能用于测试库 |

## 页面与交互

- 七个内容入口：个人资料、经历、足迹、文章、项目、思考、瞬间。空模块不显示内容区，对应星座导航保留为暗星。
- 星座导航随滚动停靠，手机使用底部星点栏。
- 足迹地球支持拖拽、缩放、单击选择、双击下钻，以及出发地航线；内置中国、日本、马来西亚、新加坡、泰国的区域数据。
- 文章提供夜间 / 纸色阅读面板、目录与进度显示，保留阅读偏好。
- 字体本地托管，动效支持减少动态效果偏好；后台继续使用终端风格。

Noto Serif SC 与 Bodoni Moda 使用 SIL Open Font License 1.1，许可全文及版权声明见 [OFL.txt](web/static/fonts/OFL.txt)。再分发时请保留该文件。
