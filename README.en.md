# dev@home — retro CRT terminal blog (with a local admin backend)

[中文](README.md) · **English**

A retro terminal / CRT-styled personal blog with an interactive 3D "footprint"
globe.

It's a **Go service + a single-file SQLite database**: you add/edit/delete every
piece of content in the local admin at `/admin`, and it shows up on the homepage
**instantly — no rebuild, no redeploy**. The entire frontend (HTML templates,
CSS, JS, geo data) is compiled into **one executable** via `//go:embed`, so
deploying is just copying a single binary.

## Two ways to use it (both supported by the same codebase)

- **Static publish (free, recommended):** run the admin only on your own machine,
  export a static site with one command and push it to Git, hosted by a free
  Pages platform (Cloudflare, etc.), reachable from inside and outside China.
  See [`DEPLOY.md`](DEPLOY.md).
- **Dynamic deploy (paid VPS):** run the Go service on a server so the live
  `/admin` is reachable anywhere and edits take effect instantly. See
  "Dynamic deploy" below.

> **Data safety:** `blog.db` (which holds your admin password hash) **never
> leaves your machine**. Static publishing pushes only the rendered
> HTML/JSON/static assets — your password is never uploaded.

---

## Features

**Public site (`/`)**
- Profile, career experiences, thoughts, projects, latest posts
- Interactive 3D "footprint" globe: drag to rotate, zoom, drill down through
  country → province/state → city; day/night lighting following real time;
  pinch-to-zoom on mobile
- "Moments" feed: images / short videos / plain-text diary entries
- Site-wide fuzzy search (`/api/search`, consumed by frontend JS)

**Post pages (`/posts/{slug}`):** Markdown rendered to HTML.

**Admin (`/admin`, password-protected):** CRUD for every piece of page data —
profile, experiences, thoughts, projects, posts, footprints, moments. Saving
writes to SQLite and the public site reflects it on the next load.

**Security**
- Session cookie (`dh_session`, 7-day TTL) + bcrypt password hashing
- CSRF protection: double-submit cookie (`dh_csrf` + form `csrf_token`)
- In production set `SECURE_COOKIES=1` to mark cookies `Secure` (HTTPS only)

---

## Quick start

Requires **Go 1.23+**.

```bash
# First run: set the admin password with ADMIN_PASSWORD (pick your own).
ADMIN_PASSWORD='choose-a-strong-password' go run .
# → listening on :8080
```

Open:
- Public site: http://localhost:8080/
- Admin: http://localhost:8080/admin/login (username `admin`, the password above)

Once the password is written to the database, you **don't** need to pass
`ADMIN_PASSWORD` on subsequent starts. To change it, start once more with a new
value.

You can also build first and then run (use the same binary for deployment):

```bash
go build -o ./blogbin .
ADMIN_PASSWORD='...' ./blogbin serve
```

### Environment variables

| Var              | Default   | Meaning                                                       |
|------------------|-----------|---------------------------------------------------------------|
| `ADDR`           | `:8080`   | Listen address. In production use `127.0.0.1:8080` (loopback, behind a reverse proxy) |
| `DB_PATH`        | `blog.db` | SQLite file path                                              |
| `ADMIN_USERNAME` | `admin`   | Admin login name                                              |
| `ADMIN_PASSWORD` | *(empty)* | Sets/updates the admin password when non-empty; required on first run, removable afterward |
| `SECURE_COOKIES` | *(off)*   | `1` makes cookies HTTPS-only; enable in production            |

### Subcommands

```bash
./blogbin serve          # (default) run the admin + public site
./blogbin export [dir]   # render the current DB into a static site (default: ./dist)
```

---

## Using the admin

After logging in at `/admin`, the left nav (bilingual) is split into these
sections:

| Section | Description |
|---------|-------------|
| **Profile** | Single row: name, title, tagline, about (Markdown), tech-stack tags, GitHub, email, location |
| **Experiences** | Career timeline, sortable |
| **Thoughts** | Short opinion cards with topic and date |
| **Projects** | Project cards: name, description, language, stars, license, URL, sortable |
| **Posts** | Markdown posts. Only `published` ones appear on the site / get exported; drafts never leak |
| **Footprints** | One entry = one visited city (country → province/state → city). The form uses **cascading selects**, allows a note, and can link multiple "moments" |
| **Moments** | Image / short-video / plain-text updates, see below |

### Moments and media

"Moments" record slices of life. **The site itself does not host images/videos**;
instead it references external URLs (one per line), so there's no size limit and
loading stays fast:

- **Images:** paste the image URL directly (Cloudflare R2 or similar object
  storage recommended).
- **Direct videos** (`.mp4/.webm/.mov/...`): played inline via `<video>`.
- **Bilibili / YouTube links:** paste the normal watch-page link; it's
  automatically rewritten to an embeddable player URL and played inline
  (Bilibili uses the H5 mobile player, so phones don't bounce to the app), with
  an "open on the original site" fallback link.

The public gallery has a carousel lightbox (finger-following swipe, end-of-list
hint, no looping).

### Footprint ↔ Moment links

Footprints and moments are **many-to-many**: one footprint can link many
moments, and one moment can be referenced by many footprints. Select the moments
to link in the footprint form. When the globe drills down to a city/province on
the public site, clicking lists the linked moments below (it doesn't jump
directly); the user can then click a specific link to open a moment.

---

## Static publish to free Pages (recommended)

`export` renders the homepage and every published post to HTML, writes the
footprints JSON to `dist/api/footprints` (exactly the path the globe fetches — no
frontend change needed) and the search index to `dist/api/search`, then copies
all static assets. The admin runs only locally; the database never leaves your
machine.

### One-command publish

```bash
# Render two builds from the local blog.db and push them to the free platforms:
DB_PATH=./blog.db ./scripts/publish-all.sh "post: hello world"
```

`publish-all.sh` produces **two builds** and pushes them to the right places:

| Build | Asset paths | Push target | Suited host |
|-------|-------------|-------------|-------------|
| Root path (`BASE_URL` empty) | `/static/...` | `dist/` on GitHub `master` | Cloudflare / EdgeOne (domain root, auto deploy) |
| Sub-path (`BASE_URL=/blog`) | `/blog/static/...` | GitHub `gh-pages` branch, Gitee `master` | GitHub Pages, Gitee Pages (sub-paths like `user.github.io/blog`) |

Available switches: `SKIP_GITEE=1`, `SKIP_GH_PAGES=1`, `SUBPATH=/xxx` (change the
sub-path).

You can also just export manually without pushing:

```bash
./blogbin export dist                    # root paths
BASE_URL=/blog ./blogbin export dist     # sub-path
```

### Platform status (as of 2026-07, may change)

- **Cloudflare** (currently live, working): connected to GitHub `master`;
  `wrangler.jsonc` tells it to serve the pre-built `dist/` as pure static assets
  with no build step. Good overseas/global access.
- **EdgeOne Pages (Tencent Cloud):** the free tier only gets a permanent free
  domain in the **"Global (excluding mainland China)"** region; the "China
  mainland / Global incl. mainland" region gives only a 3-hour temporary preview
  link and requires binding an **ICP-filed** custom domain for permanent access.
  The free + no-filing path cannot get mainland acceleration.
- **Gitee Pages:** the personal-tier Pages service is **shut down** and no longer
  usable (the script still keeps the branch push, only as a historical backup).

Full platform setup (sign-up / connect-repo / custom domain / ICP filing) is in
[`DEPLOY.md`](DEPLOY.md); a dated comparison is in
[`docs/hosting-research-2026-07-13.md`](docs/hosting-research-2026-07-13.md).

> **Conclusion:** free + no filing has an inherent ceiling on mainland-China
> access speed. For true mainland acceleration you need "buy a domain (~¥30–70/yr)
> + ICP filing", then use EdgeOne's China region. For a personal blog, Cloudflare
> is good enough today.

---

## Dynamic deploy (optional, paid VPS, live admin reachable anywhere)

If you want the live `/admin` to be editable anytime with instant effect, run the
Go service on a server. Recommended: **a Hong Kong (or nearby overseas) VPS +
Cloudflare + your own domain** — an overseas box has low latency to mainland
China and needs no ICP filing, plus Cloudflare CDN on top.

```bash
# From your laptop (in the repo), one step: build → upload → restart:
./scripts/deploy.sh push blog@your-server-ip

# The first time, also install the service files on the server:
sudo cp /opt/s_blog/s_blog.service /etc/systemd/system/
sudo cp /opt/s_blog/Caddyfile /etc/caddy/Caddyfile
sudo systemctl daemon-reload && sudo systemctl enable --now s_blog
sudo systemctl reload caddy
```

`Caddyfile` (reverse proxy + automatic HTTPS) and `s_blog.service` (systemd unit)
are in the repo; just set your domain and `ADMIN_PASSWORD`. To only build the
Linux binary without deploying: `./scripts/deploy.sh build` (output:
`dist/s_blog`).

---

## Regenerating the globe's geo data

The geo JSON under `web/static/geo/` is pre-built, so you normally don't touch
it. To rebuild it (needs network + Node):

```bash
node scripts/gen_geo.mjs
```

Drill scope: CN provinces Beijing/Hunan/Guangdong/Zhejiang/Sichuan/Jiangsu;
JP Tokyo/Osaka; MY Selangor/Sabah; SG whole country. Only `world.json` (~64KB)
loads initially; region files are lazy-loaded on drill.

---

## Project layout

```
main.go                     entry point; embeds ./web; serve / export subcommands
internal/
  models/                   content types + search index, tags, footprint grouping, moment media parsing
  store/                    SQLite access (schema.sql + one file per collection)
  auth/                     bcrypt + token helpers
  render/                   html/template + goldmark (Markdown)
  server/                   routes, middleware (session / CSRF), handlers, gzip
  export/                   render the database into a static site
web/
  templates/public/         home.html, post.html
  templates/admin/          login, dashboard, per-section list/form
  static/css|js/            CRT theme, admin, globe.js, moments.js, search.js
  static/geo/               world + region JSON for the globe (pre-built)
scripts/
  publish-all.sh            one-command publish to multiple free Pages (two builds)
  deploy.sh                 build / push to a VPS
  gen_geo.mjs               (re)generate geo data (needs network)
  globe_logic_test.mjs      globe pure-logic tests
Caddyfile                   reverse proxy + TLS (for VPS)
s_blog.service              systemd unit (for VPS)
wrangler.jsonc              Cloudflare Workers static-assets deploy config
```

---

## Development & verification

Verification order after editing JS/CSS/Go:

```bash
node --check web/static/js/xxx.js   # when you changed JS
go build -o ./blogbin .             # build (assets are embedded, so frontend edits also need a rebuild)
go vet ./...
go test ./...                       # all tests (store layer, search, footprint grouping, moment media, ...)
node scripts/globe_logic_test.mjs   # globe pure-logic tests
```

> Frontend assets are compiled into the binary, so after editing
> templates/CSS/JS you must **rebuild with `go build` and restart** the service
> for changes to take effect.
