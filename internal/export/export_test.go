package export

import (
	"strings"
	"testing"
)

func TestHostingHeadersUsesBasePath(t *testing.T) {
	tests := []struct {
		name string
		base string
		want string
	}{
		{name: "root", base: "", want: "/static/geo/*"},
		{name: "subpath", base: "/personal-blog", want: "/personal-blog/static/geo/*"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := hostingHeaders(test.base)
			if !strings.Contains(got, test.want) {
				t.Fatalf("hostingHeaders(%q) = %q, want path %q", test.base, got, test.want)
			}
			if !strings.Contains(got, "max-age=31536000") {
				t.Fatalf("hostingHeaders(%q) = %q, missing one-year cache", test.base, got)
			}
		})
	}
}

// Self-hosted fonts are content-versioned too, so the static host must cache
// them for a year as immutable — under the same base prefix as the site.
func TestHostingHeadersIncludesFonts(t *testing.T) {
	const rule = "/static/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n"
	tests := []struct {
		name string
		base string
		want string
	}{
		{name: "root", base: "", want: rule},
		{name: "subpath", base: "/blog", want: "/blog" + rule},
		{name: "trailing slash", base: "/blog/", want: "/blog" + rule},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := hostingHeaders(test.base)
			if !strings.Contains(got, test.want) {
				t.Fatalf("hostingHeaders(%q) = %q, want fonts rule %q", test.base, got, test.want)
			}
			if test.base != "" && (strings.HasPrefix(got, "/static/") || strings.Contains(got, "\n/static/")) {
				t.Fatalf("hostingHeaders(%q) = %q, has a rule without the base prefix", test.base, got)
			}
		})
	}
}
