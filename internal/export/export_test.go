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
