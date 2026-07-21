// Package models defines the content types rendered on the site and edited via /admin.
package models

import (
	"regexp"
	"strings"
)

// Profile is the single-row whoami / hero content.
type Profile struct {
	Name      string
	Title     string
	Tagline   string
	AboutMD   string
	Stack     string // comma-separated tech tags
	GitHubURL string
	Email     string
	Location  string
	Theme     string // site-wide visual theme code (A–Z; F = Retro Terminal)
	UpdatedAt string
}

// StackTags splits the comma-separated stack into trimmed tags.
func (p Profile) StackTags() []string { return splitTags(p.Stack) }

// ValidTheme reports whether code is a single uppercase theme letter (A–Z).
// Used to sanitize the admin theme picker's live-preview query param so it can
// only ever select a real /static/css/themes/<code>.css file.
func ValidTheme(code string) bool {
	return len(code) == 1 && code[0] >= 'A' && code[0] <= 'Z'
}

// Experience is one entry in the career timeline.
type Experience struct {
	ID          int64
	Period      string
	Company     string
	Role        string
	Description string
	SortOrder   int
}

// Thought is a short opinion / note card.
type Thought struct {
	ID    int64
	Body  string
	Topic string
	Date  string
}

// Project is a card in the projects grid.
type Project struct {
	ID          int64
	Name        string
	Description string
	Language    string
	Stars       int
	License     string
	URL         string
	SortOrder   int
}

// Post is a blog post / note.
type Post struct {
	ID        int64
	Slug      string
	Title     string
	Date      string
	Tags      string // comma-separated
	BodyMD    string
	Published bool
	CreatedAt string
	UpdatedAt string
}

// TagList splits the comma-separated tags into trimmed values.
func (p Post) TagList() []string { return splitTags(p.Tags) }

// Footprint is one visited city (country -> province -> city).
type Footprint struct {
	ID          int64
	CountryCode string
	CountryName string
	Province    string
	City        string
	Note        string
	MomentIDs   string // comma-separated linked moment IDs ("" = none)
	SortOrder   int
}

// MomentIDList parses the comma-separated MomentIDs into ints, dropping blanks
// and non-numeric junk. Order is preserved.
func (f Footprint) MomentIDList() []int64 {
	return splitIDs(f.MomentIDs)
}

// LinksMoment reports whether this footprint links the given moment id.
func (f Footprint) LinksMoment(id int64) bool {
	for _, m := range f.MomentIDList() {
		if m == id {
			return true
		}
	}
	return false
}

// Media is one image, direct video, or embedded player referenced by a Moment.
type Media struct {
	URL      string // <img>/<video> src, or the iframe src for an embed
	IsVideo  bool   // direct video file (.mp4 etc.) played via <video>
	IsEmbed  bool   // third-party player page (Bilibili / YouTube) shown via <iframe>
	Provider string // "bilibili" | "youtube" (embeds only)
	WatchURL string // original watch page, used for the "open on site" fallback link
}

// Moment is one entry in the photo / short-video feed. Media holds one URL per
// line (external, e.g. Cloudflare R2); an empty Media makes it a text-only diary
// entry.
type Moment struct {
	ID      int64
	Caption string
	Media   string // one URL per line
	Place   string
	Date    string
}

// MediaList splits the newline-separated media into classified items, deciding
// image vs direct video vs embedded player. Bilibili / YouTube page links are
// rewritten to their embeddable player URL so they play inline.
func (m Moment) MediaList() []Media {
	lines := strings.Split(m.Media, "\n")
	out := make([]Media, 0, len(lines))
	for _, ln := range lines {
		u := strings.TrimSpace(ln)
		if u == "" {
			continue
		}
		if em, ok := embedMedia(u); ok {
			out = append(out, em)
			continue
		}
		out = append(out, Media{URL: u, IsVideo: isVideoURL(u)})
	}
	return out
}

// isVideoURL reports whether a media URL points at a video, by extension.
func isVideoURL(u string) bool {
	q := u
	if i := strings.IndexAny(q, "?#"); i >= 0 {
		q = q[:i]
	}
	q = strings.ToLower(q)
	for _, ext := range []string{".mp4", ".webm", ".mov", ".m4v", ".ogv"} {
		if strings.HasSuffix(q, ext) {
			return true
		}
	}
	return false
}

var (
	reBilibili = regexp.MustCompile(`(?i)bilibili\.com/video/(BV[0-9A-Za-z]+)`)
	reYouTube  = regexp.MustCompile(`(?i)(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/|youtube\.com/embed/)([0-9A-Za-z_-]{11})`)
)

// embedMedia detects a third-party video page (Bilibili / YouTube) and returns
// a fully-classified Media with the embeddable player URL plus the original
// watch page (for an "open on site" fallback link). The Bilibili player uses
// the H5 mobile endpoint, which — unlike player.html — plays inline in mobile
// browsers instead of bouncing to the app. The second result is false otherwise.
func embedMedia(u string) (Media, bool) {
	if m := reBilibili.FindStringSubmatch(u); m != nil {
		bvid := m[1]
		return Media{
			IsEmbed:  true,
			Provider: "bilibili",
			URL:      "https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=" + bvid + "&page=1&high_quality=1&danmaku=0&as_wide=1",
			WatchURL: "https://www.bilibili.com/video/" + bvid,
		}, true
	}
	if m := reYouTube.FindStringSubmatch(u); m != nil {
		id := m[1]
		return Media{
			IsEmbed:  true,
			Provider: "youtube",
			URL:      "https://www.youtube.com/embed/" + id,
			WatchURL: "https://www.youtube.com/watch?v=" + id,
		}, true
	}
	return Media{}, false
}
