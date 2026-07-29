package render

import (
	"testing"
	"testing/fstest"
)

func TestBuildAssetVersionsIncludesGeoAggregate(t *testing.T) {
	staticFS := fstest.MapFS{
		"geo/world.json":      {Data: []byte(`{"world":1}`)},
		"geo/regions/CN.json": {Data: []byte(`{"cn":1}`)},
		"js/globe.js":         {Data: []byte("console.log(1)")},
	}
	first := buildAssetVersions(staticFS)
	if first["/static/geo"] == "" {
		t.Fatal("missing aggregate geo version")
	}

	staticFS["geo/regions/CN.json"] = &fstest.MapFile{Data: []byte(`{"cn":2}`)}
	second := buildAssetVersions(staticFS)
	if first["/static/geo"] == second["/static/geo"] {
		t.Fatal("geo aggregate version did not change")
	}
	if first["/static/js/globe.js"] != second["/static/js/globe.js"] {
		t.Fatal("unrelated asset version changed")
	}
}

func TestAssetVersionHelperReturnsRawVersion(t *testing.T) {
	r := &Renderer{assetVer: map[string]string{"/static/geo": "abc123"}}
	if got := r.assetVersion("/static/geo"); got != "abc123" {
		t.Fatalf("assetVersion = %q, want abc123", got)
	}
}
