# dev@home — retro CRT terminal personal blog

[中文](README.md) · **English**

A retro terminal / CRT-styled personal blog with an interactive 3D "footprint"
globe. You write posts, add photos, and mark places you've visited in a **local
admin**, then **publish with one click** — and end up with a **free website the
whole world can visit**.

> 🔰 **No coding required.** Get the release package, double-click one file, and
> follow the buttons in your browser. Full walkthrough:
> [`docs/新手指南.md`](docs/新手指南.md) (Chinese).

> 📦 **Download the client** (pick the one for your OS — double-click to run, no
> toolchain needed):
> - macOS → [**Blog-macOS.zip**](https://github.com/sfqin/blog_self/releases/download/v1.0.0/Blog-macOS.zip) (unzip, double-click `Start-Blog.app`)
> - Windows → [**Blog-Windows.zip**](https://github.com/sfqin/blog_self/releases/download/v1.0.0/Blog-Windows.zip) (unzip, double-click `Start-Blog.vbs`)
>
> Or browse the [**latest release**](https://github.com/sfqin/blog_self/releases/latest).

---

## 1. What it does / what you end up with

- ✅ Write your blog in a **local admin on your own computer**: profile,
  experiences, thoughts, projects, posts, footprints, moments — **saves take
  effect instantly**, no rebuild.
- ✅ **Publish with one click**: renders your content into static pages, pushes
  to GitHub, and turns on GitHub Pages automatically.
- ✅ Get a **free public URL** like `https://<your-username>.github.io/blog/`,
  openable on phone, laptop, or shared with friends — **no server, no cost**.
- ✅ An interactive **3D globe** showing the cities you've visited (drill down
  through country → province/state → city).
- ✅ Your **data never leaves your machine**; publishing uploads only the
  rendered static pages.

**End result**: your own retro-terminal personal website with a 3D footprint
globe, online for free, long term.

---

## 2. What you need to prepare

Just two things:

1. **A computer** (Windows or macOS). No dev environment to install — the
   program is bundled in the release package.
2. **A GitHub account** (free). Don't have one? Sign up at
   <https://github.com> with an email; it hosts your website for free.

> You'll receive an OS-specific release package (the maintainer generates it
> with `scripts/package-release.sh`): **`Blog-macOS.zip`** on a Mac,
> **`Blog-Windows.zip`** on Windows. Unzip it to get a `Blog-macOS` /
> `Blog-Windows` folder and put the **whole folder** on your Desktop or in Documents.

---

## 3. How to do it (full-flow demo)

The whole thing is **done in the browser by clicking buttons — no terminal**.

### Step 0: Launch (per OS)

| OS | Double-click this file | Notes |
|----|-----------------------|-------|
| **macOS** | `Start-Blog.app` | First time may say "unidentified developer": **right-click → Open → Open** again. No console window. |
| **Windows** | `Start-Blog.vbs` | If "Windows protected your PC" appears: click **More info → Run anyway**. No console window. |

> Fallback launchers: `Start-Blog.command` (macOS) / `Start-Blog.bat` (Windows) —
> these show a text window.

The browser then **opens automatically** to a wizard called "Get your blog
online, step by step" (URL like `http://localhost:8080/setup`; if 8080 is busy
it auto-picks 8081, 8082…, so trust whatever the browser opened).

### Steps 1–6: follow the browser wizard

Each step has a status light: **✓ green** = fine, **✗ red** = click the button
next to it.

| Step | What to do |
|------|-----------|
| **① Environment check** | Checks two small tools: Git and GitHub CLI. If ✗, click the button — the program **downloads and installs them automatically** (macOS shows the system dialog, click Install; GitHub CLI is fetched straight from the official site), **no Homebrew or any other software needed**. Then click **↻ Re-check**. |
| **② Connect GitHub** | Click "Log in to GitHub in the browser". The page shows a one-time code (like `ABCD-1234`); paste it into the authorization page that opens. No password needed afterward. |
| **③ Create repository** | Name your blog (default `blog`; it becomes part of the URL). The repo is always created **Public** — GitHub Pages' free tier only serves public repos. |
| **④ Write posts / local preview** | Enter the admin at `/admin` (**no login, no password — just open it**), fill in profile, experiences, projects, posts, footprints, moments; click "Preview homepage locally" anytime — **saves take effect instantly**. |
| **⑤ Publish with one click** | Back on the wizard, click **🚀 Publish online**. Wait 1–2 minutes and the page shows your **site URL** (`https://<your-username>.github.io/blog/`) — open it and there's your blog! |

### From then on

Just three steps: **double-click the launcher → write/edit in the admin and
preview locally → open `/setup` and click Publish**. Without publishing, changes
stay local; after publishing, the whole world can see them.

> No "Stop" button needed: after you close all blog pages, the program stops
> itself in about a minute. To use the latest version immediately, double-click
> the launcher again (it offers "open page / restart").

---

## 4. Features & modules

**Public site (`/`, what visitors see)**
- **Profile**, **experiences**, **thoughts**, **projects**, **latest posts**
- **3D footprint globe**: drag to rotate, zoom, drill down country →
  province/state → city; day/night lighting following real time; pinch-zoom and
  drag on mobile. Ships with drill-down data for **5 countries**, with foreign
  place names **bilingual (Chinese + English)**: China (all provinces + HK/Macau/
  Taiwan, 34 drillable), Japan, Malaysia, Singapore, Thailand.
- **Moments feed**: images / short videos / plain-text diary entries
- **Site-wide fuzzy search**

**Post pages (`/posts/{slug}`)**: Markdown rendered to HTML.

**Admin (`/admin`, no login)**: CRUD for every piece of content; saving
writes to the local database and the public site reflects it on the next load.
The admin runs only on your own computer, so there's no password — just open it.

| Section | Description |
|---------|-------------|
| **Profile** | Name, title, tagline, about (Markdown), tech-stack tags, GitHub, email, location |
| **Experiences** | Career timeline, sortable |
| **Thoughts** | Short opinion cards with topic and date |
| **Projects** | Name, description, language, stars, license, URL, sortable |
| **Posts** | Markdown posts; only `published` ones go live, drafts never leak |
| **Footprints** | One entry = one visited city (cascading country → province/state → city selects), with a note and linked moments |
| **Moments** | Image / short-video / plain-text updates |

**About media**: the site **does not host images/videos**; it references external
URLs (put images on object storage like Cloudflare R2), so there's no size limit
and loading stays fast. Bilibili / YouTube watch-page links are auto-embedded.

**Security**: the admin has no login and no password (single user, on your own
machine); forms still carry CSRF double-submit cookie protection. If you deploy
it as a **public dynamic site** (see below), `/admin` is publicly writable — add
access control at the reverse-proxy layer (e.g. Caddy `basicauth`), or stick to
static publishing only.

---

## 5. Roadmap & contact

- 🎨 **Multiple themes**: it's retro CRT terminal today; switchable themes
  (light / minimal / magazine, etc.) are planned so every blog feels personal.
- More countries' footprint data and more content modules are on the way.

Questions, suggestions, or want to help improve it? Reach out: **sfqincsu@163.com**

---

## Advanced: developer / technical reference

The above is the "double-click, zero-code" path. If you're comfortable with a
command line, you can run from source or deploy a dynamic site.

### Quick start (from source, needs Go 1.23+)

```bash
go build -o ./blogbin .
./blogbin serve
# → listening on :8080; admin at http://localhost:8080/admin (no login, just open it)
```

The entire frontend (HTML templates, CSS, JS, geo data)
is compiled into **one executable** via `//go:embed`, so deploying is just copying
a single binary.

### Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `ADDR` | `:8080` | Listen address. In production use `127.0.0.1:8080` (loopback, behind a reverse proxy) |
| `DB_PATH` | `blog.db` | SQLite file path |
| `SECURE_COOKIES` | *(off)* | `1` makes the CSRF cookie HTTPS-only; enable in production |

### Subcommands

```bash
./blogbin serve          # (default) run the admin + public site
./blogbin export [dir]   # render the current DB into a static site (default ./dist)
BASE_URL=/blog ./blogbin export dist   # sub-path build (for user.github.io/blog style paths)
```

"Publish with one click" is essentially `export` + push to GitHub Pages (see
`internal/setup/publish.go`). `export` renders the homepage and every published
post to HTML, writes the footprints JSON to `dist/api/footprints` (exactly the
path the globe fetches) and the search index to `dist/api/search`, then copies all
static assets. The admin runs only locally; the database never leaves your machine.

### Data & backup

All your **content** lives in one file:
`~/dev-home-blog/blog.db` (macOS `/Users/you/dev-home-blog/blog.db`, Windows
`C:\Users\you\dev-home-blog\blog.db`). Back it up by copying it; to switch
computers, copy it to the same location.

### Dynamic deploy (optional, paid VPS, live admin editable anywhere)

To make the live `/admin` editable anytime with instant effect, run the Go service
on a server. Recommended: **a Hong Kong (or nearby overseas) VPS + Cloudflare +
your own domain**. The repo ships a `Caddyfile` (reverse proxy + automatic HTTPS)
and a systemd unit; see [`DEPLOY.md`](DEPLOY.md).

```bash
./scripts/deploy.sh push blog@your-server-ip   # build → upload → restart
./scripts/deploy.sh build                       # build the Linux binary only (dist/s_blog)
```

### Regenerating the globe's geo data

The geo JSON under `web/static/geo/` is pre-built, so you normally don't touch it.
To rebuild it (needs network + Node):

```bash
node scripts/gen_geo.mjs            # rebuild all countries
node scripts/gen_geo.mjs SG TH      # rebuild only the given countries
```

Built-in countries: CN (34 drillable provinces), JP (25), MY (13), SG (5), TH
(15); foreign place names are bilingual. Only `world.json` loads initially; region
files are lazy-loaded on drill.

### Packaging the release (maintainer)

```bash
./scripts/package-release.sh   # produces two per-OS zips under dist-release/
```

The output is **split into two per-OS packages**: `Blog-macOS.zip` (`Start-Blog.app`
/ `.command` + macOS binaries) and `Blog-Windows.zip` (`Start-Blog.vbs` / `.bat` +
the Windows `.exe`), each with the startup `loading.html` and `docs/新手指南.md`.
Users download only the one for their system.

> **Client directory**: the "client" you hand to end users is the packaged
> **`dist-release/Blog-macOS/`** and **`dist-release/Blog-Windows/`** folders
> (zipped as the two files above) — double-click launchers plus a self-contained
> binary, no toolchain required. They are generated by the script and **not
> tracked in git** (see `.gitignore`). The launcher **sources** live in the repo's
> **`packaging/`** directory (`mac/` `.app` shell + `launch`, `windows/` `.vbs`,
> and the shared `loading.html`), together with the root-level
> `Start-Blog.command` / `Start-Blog.bat`.

### Project layout

```
main.go                     entry point; embeds ./web; serve / export subcommands
internal/
  models/                   content types + search index, tags, footprint grouping, moment media parsing
  store/                    SQLite access (schema.sql + one file per collection)
  auth/                     CSRF token helpers
  render/                   html/template + goldmark (Markdown)
  setup/                    beginner wizard: env check / GitHub login / repo / one-click publish
  export/                   render the database into a static site
web/
  templates/public/         home.html, post.html
  templates/admin/          dashboard, per-section list/form, setup wizard
  static/css|js/            CRT theme, admin, globe.js, moments.js, search.js, setup.js
  static/geo/               world + region JSON for the globe (pre-built)
scripts/
  package-release.sh        build the double-click release (cross-platform binaries + launchers)
  deploy.sh                 build / push to a VPS
  gen_geo.mjs               (re)generate geo data (needs network)
  globe_logic_test.mjs      globe pure-logic tests
packaging/                  client launcher sources (bundled into the dist-release/ per-OS clients)
  mac/                      Start-Blog.app Info.plist + launch controller script
  windows/                  Start-Blog.vbs (windowless launcher)
  loading.html              startup splash opened on double-click (polls the server, then enters the wizard)
Start-Blog.command          macOS fallback launcher (visible terminal)
Start-Blog.bat              Windows engine / visible fallback launcher
```

### Development & verification

```bash
node --check web/static/js/xxx.js   # when you changed JS
go build -o ./blogbin .             # build (assets are embedded, so frontend edits need a rebuild)
go vet ./...
go test ./...                       # all tests
node scripts/globe_logic_test.mjs   # globe pure-logic tests
```

> Frontend assets are compiled into the binary, so after editing templates/CSS/JS
> you must **rebuild with `go build` and restart** the service for changes to take
> effect.
