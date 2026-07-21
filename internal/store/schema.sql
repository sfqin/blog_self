-- dev@home blog schema (SQLite)
-- All content editable via the admin backend; homepage renders live from these tables.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Single-row site profile (whoami / hero).
CREATE TABLE IF NOT EXISTS profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    name       TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL DEFAULT '',
    tagline    TEXT NOT NULL DEFAULT '',
    about_md   TEXT NOT NULL DEFAULT '',
    stack      TEXT NOT NULL DEFAULT '',   -- comma-separated tech tags
    github_url TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    location   TEXT NOT NULL DEFAULT '',
    theme      TEXT NOT NULL DEFAULT 'F',   -- site-wide visual theme (A–Z; F = Retro Terminal)
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Career timeline: $ tail -f experience.log
CREATE TABLE IF NOT EXISTS experiences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    period      TEXT NOT NULL DEFAULT '',
    company     TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Thoughts: $ less thoughts/
CREATE TABLE IF NOT EXISTS thoughts (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    body  TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    date  TEXT NOT NULL DEFAULT (date('now'))
);

-- Projects: $ ls projects/
CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT '',
    stars       INTEGER NOT NULL DEFAULT 0,
    license     TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Blog posts / notes: $ ls -lt notes/
CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL DEFAULT '',
    date       TEXT NOT NULL DEFAULT (date('now')),
    tags       TEXT NOT NULL DEFAULT '',   -- comma-separated
    body_md    TEXT NOT NULL DEFAULT '',
    published  INTEGER NOT NULL DEFAULT 0, -- 0 draft, 1 published
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_published_date ON posts (published, date DESC);

-- Footprints: one row per visited city (country -> province -> city).
CREATE TABLE IF NOT EXISTS footprints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    country_code TEXT NOT NULL DEFAULT '',   -- e.g. CN, JP, MY, SG
    country_name TEXT NOT NULL DEFAULT '',
    province     TEXT NOT NULL DEFAULT '',   -- province / state / prefecture
    city         TEXT NOT NULL DEFAULT '',   -- city / district
    note         TEXT NOT NULL DEFAULT '',
    moment_ids   TEXT NOT NULL DEFAULT '', -- comma-separated linked moment IDs ('' = none)
    sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_footprints_country ON footprints (country_code);

-- Moments: $ feh moments/*  — photo / short-video feed with captions.
-- Media is hosted externally (Cloudflare R2) and referenced by URL; one URL per
-- line in `media`. Empty media = a plain text diary entry.
CREATE TABLE IF NOT EXISTS moments (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    caption TEXT NOT NULL DEFAULT '',
    media   TEXT NOT NULL DEFAULT '',   -- one media URL per line (R2)
    place   TEXT NOT NULL DEFAULT '',   -- optional location
    date    TEXT NOT NULL DEFAULT (date('now'))
);
CREATE INDEX IF NOT EXISTS idx_moments_date ON moments (date DESC);

