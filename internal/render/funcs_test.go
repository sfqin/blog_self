package render

import (
	"reflect"
	"strings"
	"testing"

	"dev-home-blog/internal/models"
)

func TestSplitChars(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"星野君", []string{"星", "野", "君"}},
		{"Go语言✨", []string{"G", "o", "语", "言", "✨"}},
	}
	for _, c := range cases {
		if got := splitChars(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("splitChars(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSplitPhrases(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"   ", nil},
		{"无标点的一句话", []string{"无标点的一句话"}},
		{"用有限的时间，写一点优雅的代码。", []string{"用有限的时间，", "写一点优雅的代码。"}},
		{"慢一点——再慢一点。好", []string{"慢一点——", "再慢一点。", "好"}},
		{"结尾，。", []string{"结尾，。"}},
	}
	for _, c := range cases {
		if got := splitPhrases(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("splitPhrases(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func fixtureFootprints() []models.Footprint {
	return []models.Footprint{
		{CountryCode: "CN", CountryName: "中国", Province: "广东省"},
		{CountryCode: "CN", CountryName: "中国", Province: "广东省", City: "深圳市"},
		{CountryCode: "CN", CountryName: "中国", Province: "广东省", City: "深圳市"},
		{CountryCode: "CN", CountryName: "中国", Province: "广东省", City: "广州市"},
		{CountryCode: "CN", CountryName: "中国", Province: "北京市"},
		{CountryCode: "JP", CountryName: "日本", Province: "東京都", City: "新宿区"},
		{CountryCode: "SG", CountryName: "新加坡"},
	}
}

func TestFootprintStats(t *testing.T) {
	if got := footprintStats(nil); got != (FootprintStats{}) {
		t.Fatalf("empty = %+v", got)
	}
	got := footprintStats(fixtureFootprints())
	// 广东省: 深圳+广州 = 2 (the province-only row is not counted again);
	// 北京市: province-only = 1; 東京都: 1; SG has no province.
	want := FootprintStats{Countries: 3, Provinces: 3, Places: 4}
	if got != want {
		t.Fatalf("footprintStats = %+v, want %+v", got, want)
	}
}

func fullHome() map[string]any {
	return map[string]any{
		"Profile":     models.Profile{Name: "星野", Location: "广东"},
		"Experiences": []models.Experience{{}, {}, {}},
		"Footprints":  fixtureFootprints(),
		"Posts":       []models.Post{{}, {}},
		"Projects":    []models.Project{{}},
		"Thoughts":    []models.Thought{},
		"Moments":     []models.Moment{{}},
	}
}

type homeStruct struct {
	Base        string
	Profile     models.Profile
	Experiences []models.Experience
	Thoughts    []models.Thought
	Projects    []models.Project
	Posts       []models.Post
	Footprints  []models.Footprint
	Moments     []models.Moment
}

func TestHomeNavFull(t *testing.T) {
	items := homeNav(fullHome())
	if len(items) != 7 {
		t.Fatalf("len = %d", len(items))
	}
	keys := []string{"about", "experience", "footprint", "notes", "projects", "thoughts", "moments"}
	for i, k := range keys {
		if items[i].Key != k {
			t.Fatalf("item %d key = %q, want %q", i, items[i].Key, k)
		}
	}
	type row struct{ numeral, count, weight, href string }
	want := []row{
		{"I", "whoami", "1.00", "#about"},
		{"II", "3 段", "1.39", "#experience"},
		{"III", "3 国 · 4 处", "1.45", "#footprint"},
		{"IV", "2 篇", "1.31", "#notes"},
		{"V", "1 个", "1.19", "#projects"},
		{"", "即将点亮", "1.00", ""},
		{"VI", "1 刻", "1.19", "#moments"},
	}
	for i, w := range want {
		it := items[i]
		got := row{it.Numeral, it.Count, it.Weight, it.Href}
		if got != w {
			t.Errorf("item %s = %+v, want %+v", it.Key, got, w)
		}
	}
	if !items[5].Off {
		t.Error("thoughts should be off")
	}
}

func TestHomeNavStructAndEmpty(t *testing.T) {
	full := fullHome()
	st := homeStruct{
		Profile:     full["Profile"].(models.Profile),
		Experiences: full["Experiences"].([]models.Experience),
		Footprints:  full["Footprints"].([]models.Footprint),
		Posts:       full["Posts"].([]models.Post),
		Projects:    full["Projects"].([]models.Project),
		Moments:     full["Moments"].([]models.Moment),
	}
	if a, b := homeNav(st), homeNav(full); !reflect.DeepEqual(a, b) {
		t.Fatalf("struct and map view models differ:\n%+v\n%+v", a, b)
	}
	if a, b := homeNav(&st), homeNav(full); !reflect.DeepEqual(a, b) {
		t.Fatal("pointer view model differs")
	}

	empty := homeNav(homeStruct{Profile: models.Profile{Name: "星野", Location: "广东"}})
	for i, it := range empty {
		if i == 0 {
			if it.Off || it.Numeral != "I" {
				t.Fatalf("about should be lit with numeral I: %+v", it)
			}
			continue
		}
		if !it.Off || it.Href != "" || it.Numeral != "" || it.Weight != "1.00" || it.Count != "即将点亮" {
			t.Fatalf("%s should be dim: %+v", it.Key, it)
		}
	}
	none := homeNav(nil)
	if len(none) != 7 || !none[0].Off {
		t.Fatalf("nil view model: %+v", none)
	}
}

func TestNavItem(t *testing.T) {
	items := homeNav(fullHome())
	if got := navItem(items, "projects").Numeral; got != "V" {
		t.Fatalf("navItem projects numeral = %q", got)
	}
	if got := navItem(items, "nope"); got.Key != "" {
		t.Fatalf("unknown key = %+v", got)
	}
}

func TestFirstImage(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"没有图", ""},
		{"前言\n![封面](https://img.example.com/a.jpg \"标题\")\n![二](b.png)", "https://img.example.com/a.jpg"},
		{"<p><img alt=x src='/static/x.webp'></p> ![md](later.png)", "/static/x.webp"},
		{"![md](first.png) <img src=\"second.png\">", "first.png"},
	}
	for _, c := range cases {
		if got := firstImage(c.in); got != c.want {
			t.Errorf("firstImage(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestTitleHue(t *testing.T) {
	a := titleHue("星野手记")
	if a != titleHue("星野手记") {
		t.Fatal("unstable hue")
	}
	for _, s := range []string{"", "a", "长标题", strings.Repeat("x", 100)} {
		if h := titleHue(s); h < 0 || h > 359 {
			t.Fatalf("hue %d out of range", h)
		}
	}
}

func TestVTName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "post"},
		{"hello-world_2", "post-hello-world_2"},
		{"中文 slug", "post----slug"},
	}
	for _, c := range cases {
		if got := vtName(c.in); got != c.want {
			t.Errorf("vtName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFirstRune(t *testing.T) {
	if got := firstRune("  旅行"); got != "旅" {
		t.Fatalf("firstRune = %q", got)
	}
	if got := firstRune(""); got != "" {
		t.Fatalf("firstRune empty = %q", got)
	}
}
