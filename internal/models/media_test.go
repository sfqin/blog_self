package models

import "testing"

func TestMediaList(t *testing.T) {
	m := Moment{Media: "" +
		"https://cdn.example.com/a.jpg\n" +
		"  https://cdn.example.com/clip.mp4?token=x  \n" +
		"https://www.bilibili.com/video/BV1A5TK6CECk/?spm_id_from=333.1007\n" +
		"https://youtu.be/dQw4w9WgXcQ\n" +
		"\n"} // blank line dropped

	got := m.MediaList()
	if len(got) != 4 {
		t.Fatalf("want 4 media items, got %d: %+v", len(got), got)
	}

	if got[0].IsVideo || got[0].IsEmbed || got[0].URL != "https://cdn.example.com/a.jpg" {
		t.Errorf("item0 should be a plain image, got %+v", got[0])
	}
	if !got[1].IsVideo || got[1].IsEmbed {
		t.Errorf("item1 should be a direct video, got %+v", got[1])
	}
	if !got[2].IsEmbed || got[2].Provider != "bilibili" ||
		got[2].URL != "https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=BV1A5TK6CECk&page=1&high_quality=1&danmaku=0&as_wide=1" ||
		got[2].WatchURL != "https://www.bilibili.com/video/BV1A5TK6CECk" {
		t.Errorf("item2 should be a bilibili H5 embed, got %+v", got[2])
	}
	if !got[3].IsEmbed || got[3].Provider != "youtube" ||
		got[3].URL != "https://www.youtube.com/embed/dQw4w9WgXcQ" ||
		got[3].WatchURL != "https://www.youtube.com/watch?v=dQw4w9WgXcQ" {
		t.Errorf("item3 should be a youtube embed, got %+v", got[3])
	}
}
