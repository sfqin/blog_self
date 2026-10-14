package render

import (
	"fmt"
	"hash/fnv"
	"math"
	"reflect"
	"regexp"
	"strings"
	"unicode/utf8"

	"dev-home-blog/internal/models"
)

// splitChars splits s into one string per rune, so templates can wrap each
// character of the hero name in its own animated <span>.
func splitChars(s string) []string {
	if s == "" {
		return nil
	}
	out := make([]string, 0, utf8.RuneCountInString(s))
	for _, r := range s {
		out = append(out, string(r))
	}
	return out
}

// splitPhrases cuts a tagline into short phrases after each ，。— so they can
// fade in one by one. Punctuation stays at the end of the phrase before it, and
// whitespace-only pieces are dropped.
func splitPhrases(s string) []string {
	var out []string
	var b strings.Builder
	flush := func() {
		if p := b.String(); strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
		b.Reset()
	}
	rs := []rune(s)
	for i, r := range rs {
		b.WriteRune(r)
		if isPhraseBreak(r) && (i+1 == len(rs) || !isPhraseBreak(rs[i+1])) {
			flush()
		}
	}
	flush()
	return out
}

func isPhraseBreak(r rune) bool { return r == '，' || r == '。' || r == '—' }

// FootprintStats is the X 国 · Y 省/州 · Z 处 summary shown in the footprint
// section and its constellation star. It must match GlobeCore.footprintStats.
type FootprintStats struct{ Countries, Provinces, Places int }

// footprintStats counts distinct countries, distinct (country, province) pairs,
// and places = Σ per province max(distinct cities, 1). It works on the grouped
// view so province-only rows next to city rows are not double counted, exactly
// like the globe (which only sees GroupFootprints output).
func footprintStats(fps []models.Footprint) FootprintStats {
	var st FootprintStats
	for _, c := range models.GroupFootprints(fps) {
		st.Countries++
		for _, p := range c.Provinces {
			if p.Name == "" {
				continue
			}
			st.Provinces++
			seen := map[string]bool{}
			for _, city := range p.Cities {
				if city.Name != "" {
					seen[city.Name] = true
				}
			}
			st.Places += max(len(seen), 1)
		}
	}
	return st
}

// NavItem is one star of the home constellation / mobile star rail.
type NavItem struct {
	Key, Label, En, Numeral, Count, Href string
	Weight                               string // "1.00" format, also used as --w
	Off                                  bool   // empty module: dim star, no link
}

var romanNumerals = []string{"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"}

// homeNav builds the 7 constellation items from the home view model (the live
// server's map-free homeData struct or the export's homeVM — both share field
// names). Numerals count only rendered (lit) sections.
func homeNav(d any) []NavItem {
	type spec struct {
		key, label, en string
		n              int
		count          string
		off            bool
	}
	profile, _ := fieldOf(d, "Profile").(models.Profile)
	stack := profile.StackTags()
	aboutOff := strings.TrimSpace(profile.AboutMD) == "" && len(stack) == 0 && strings.TrimSpace(profile.Location) == ""
	exps := sliceLen(fieldOf(d, "Experiences"))
	fps, _ := fieldOf(d, "Footprints").([]models.Footprint)
	fs := footprintStats(fps)
	posts := sliceLen(fieldOf(d, "Posts"))
	projects := sliceLen(fieldOf(d, "Projects"))
	thoughts := sliceLen(fieldOf(d, "Thoughts"))
	moments := sliceLen(fieldOf(d, "Moments"))

	specs := []spec{
		{"about", "关于", "ABOUT", 0, "whoami", aboutOff},
		{"experience", "经历", "JOURNEY", exps, fmt.Sprintf("%d 段", exps), exps == 0},
		{"footprint", "足迹", "FOOTPRINTS", fs.Places, fmt.Sprintf("%d 国 · %d 处", fs.Countries, fs.Places), len(fps) == 0},
		{"notes", "文章", "WRITING", posts, fmt.Sprintf("%d 篇", posts), posts == 0},
		{"projects", "项目", "WORKS", projects, fmt.Sprintf("%d 个", projects), projects == 0},
		{"thoughts", "思考", "THOUGHTS", thoughts, fmt.Sprintf("%d 条", thoughts), thoughts == 0},
		{"moments", "瞬间", "MOMENTS", moments, fmt.Sprintf("%d 刻", moments), moments == 0},
	}
	maxN := 0
	for _, s := range specs {
		if !s.off && s.key != "about" && s.n > maxN {
			maxN = s.n
		}
	}
	out := make([]NavItem, 0, len(specs))
	lit := 0
	for _, s := range specs {
		it := NavItem{Key: s.key, Label: s.label, En: s.en, Count: s.count, Off: s.off, Weight: "1.00"}
		if s.off {
			it.Count = "即将点亮"
		} else {
			it.Href = "#" + s.key
			if lit < len(romanNumerals) {
				it.Numeral = romanNumerals[lit]
			}
			lit++
			if s.key != "about" && maxN > 0 {
				w := 1 + 0.45*math.Log(1+float64(s.n))/math.Log(1+float64(maxN))
				it.Weight = fmt.Sprintf("%.2f", w)
			}
		}
		out = append(out, it)
	}
	return out
}

// navItem looks up one constellation item by key so section headers can read
// their Roman numeral from the same source as the stars.
func navItem(items []NavItem, key string) NavItem {
	for _, it := range items {
		if it.Key == key {
			return it
		}
	}
	return NavItem{}
}

// fieldOf reads a named field from a struct (or pointer to one) or a
// map[string]any. Missing fields yield nil.
func fieldOf(v any, name string) any {
	if m, ok := v.(map[string]any); ok {
		return m[name]
	}
	rv := reflect.ValueOf(v)
	for rv.Kind() == reflect.Pointer || rv.Kind() == reflect.Interface {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		return nil
	}
	f := rv.FieldByName(name)
	if !f.IsValid() || !f.CanInterface() {
		return nil
	}
	return f.Interface()
}

func sliceLen(v any) int {
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		return rv.Len()
	}
	return 0
}

var (
	reMDImage   = regexp.MustCompile(`!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)`)
	reHTMLImage = regexp.MustCompile(`(?i)<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']`)
)

// firstImage returns the URL of the first image in a Markdown body (Markdown
// syntax first, then raw <img>), used as the hover cover in the post list.
func firstImage(md string) string {
	mi := reMDImage.FindStringSubmatchIndex(md)
	hi := reHTMLImage.FindStringSubmatchIndex(md)
	switch {
	case mi == nil && hi == nil:
		return ""
	case hi == nil || (mi != nil && mi[0] < hi[0]):
		return md[mi[2]:mi[3]]
	default:
		return md[hi[2]:hi[3]]
	}
}

// titleHue hashes a title to a stable hue (0–359) for generated post covers.
func titleHue(s string) int {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return int(h.Sum32() % 360)
}

// vtName turns a post slug into a CSS view-transition-name shared by the home
// list title and the post page heading.
func vtName(slug string) string {
	if slug == "" {
		return "post"
	}
	var b strings.Builder
	b.WriteString("post-")
	for _, r := range slug {
		if r == '-' || r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return b.String()
}

// firstRune returns the first character of s (for generated cover glyphs).
func firstRune(s string) string {
	for _, r := range strings.TrimSpace(s) {
		return string(r)
	}
	return ""
}
