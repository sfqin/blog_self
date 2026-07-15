package models

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildSearchIndex(t *testing.T) {
	in := SearchInput{
		Profile: Profile{Name: "流浪", Title: "高级工程师", Tagline: "hi", AboutMD: "about me"},
		Experiences: []Experience{
			{Period: "2023 — 至今", Company: "终端实验室", Role: "资深后端", Description: "带团队"},
		},
		Thoughts: []Thought{
			{Body: "最好的抽象是你注意不到的那个，直到你要改它为止的长句子", Topic: "工程", Date: "2026-07-01"},
		},
		Projects: []Project{
			{Name: "globe-canvas", Description: "3D 足迹地球仪", Language: "JavaScript", URL: "https://x/y"},
			{Name: "no-url-proj", Description: "无链接项目", Language: "Go"},
		},
		Posts: []Post{
			{Slug: "p99", Title: "追查 p99", Tags: "Go,性能", BodyMD: "长尾在哪里", Date: "2026-07-05"},
		},
	}

	docs := BuildSearchIndex(in, "")

	// One doc per item: 1 profile + 1 exp + 1 thought + 2 projects + 1 post = 6.
	if len(docs) != 6 {
		t.Fatalf("want 6 docs, got %d: %+v", len(docs), docs)
	}

	byType := map[string]SearchDoc{}
	for _, d := range docs {
		byType[d.Type] = d // last of a type is fine for these single-item checks
	}

	if byType["profile"].URL != "/#about" {
		t.Errorf("profile url = %q", byType["profile"].URL)
	}
	if byType["experience"].URL != "/#experience" || byType["experience"].Badge != "经历" {
		t.Errorf("experience doc wrong: %+v", byType["experience"])
	}
	// Post body must be included so full articles are searchable.
	if !strings.Contains(byType["post"].Text, "长尾在哪里") {
		t.Errorf("post text missing body: %q", byType["post"].Text)
	}
	if byType["post"].URL != "/posts/p99" {
		t.Errorf("post url = %q", byType["post"].URL)
	}
	// Thought title is truncated from the (long) body.
	if r := []rune(byType["thought"].Title); len(r) > 25 { // 24 + ellipsis
		t.Errorf("thought title not truncated: %q (%d runes)", byType["thought"].Title, len(r))
	}
}

func TestBuildSearchIndexProjectURLAndBase(t *testing.T) {
	in := SearchInput{
		Projects: []Project{
			{Name: "withurl", URL: "https://repo/x"},
			{Name: "nourl"},
		},
		Posts: []Post{{Slug: "hello", Title: "Hello"}},
	}
	docs := BuildSearchIndex(in, "/blog/")

	var withURL, noURL, post SearchDoc
	for _, d := range docs {
		switch d.Title {
		case "withurl":
			withURL = d
		case "nourl":
			noURL = d
		case "Hello":
			post = d
		}
	}
	// External URL is used as-is (base not prefixed onto absolute links).
	if withURL.URL != "https://repo/x" {
		t.Errorf("external project url mangled: %q", withURL.URL)
	}
	// Internal links get the trimmed base prefix.
	if noURL.URL != "/blog/#projects" {
		t.Errorf("internal project url = %q", noURL.URL)
	}
	if post.URL != "/blog/posts/hello" {
		t.Errorf("post url with base = %q", post.URL)
	}
}

// search.js consumes this via fetch().json(); guard the JSON field names.
func TestSearchDocJSONShape(t *testing.T) {
	b, err := json.Marshal(SearchDoc{
		Type: "post", Title: "T", Text: "body", Tags: "a,b", URL: "/posts/x", Date: "2026-01-01", Badge: "文章",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"type":"post","title":"T","text":"body","tags":"a,b","url":"/posts/x","date":"2026-01-01","badge":"文章"}`
	if string(b) != want {
		t.Fatalf("json shape drift:\n got: %s\nwant: %s", b, want)
	}
	// Optional fields omit when empty.
	b2, _ := json.Marshal(SearchDoc{Type: "profile", Title: "me", Text: "x", URL: "/#about"})
	want2 := `{"type":"profile","title":"me","text":"x","url":"/#about"}`
	if string(b2) != want2 {
		t.Fatalf("omitempty drift:\n got: %s\nwant: %s", b2, want2)
	}
}
