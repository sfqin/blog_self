package setup

import "testing"

func TestParseDeviceCode(t *testing.T) {
	cases := []struct{ in, want string }{
		{"! First copy your one-time code: 045A-EDC0", "045A-EDC0"},
		{"code: 107E-98FF", "107E-98FF"},
		{"lowercase like ab12-cd34 gets upcased", "AB12-CD34"},
		{"Open this URL to continue: https://github.com/login/device", ""},
		{"no code here", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := parseDeviceCode(c.in); got != c.want {
			t.Errorf("parseDeviceCode(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBrowserOpenCmd(t *testing.T) {
	url := "https://github.com/login/device"
	cases := []struct {
		goos     string
		wantName string
		wantArg0 string
	}{
		{"darwin", "open", url},
		{"windows", "rundll32", "url.dll,FileProtocolHandler"},
		{"linux", "xdg-open", url},
	}
	for _, c := range cases {
		name, args := browserOpenCmd(c.goos, url)
		if name != c.wantName {
			t.Errorf("browserOpenCmd(%s) name = %q, want %q", c.goos, name, c.wantName)
		}
		if len(args) == 0 || args[0] != c.wantArg0 {
			t.Errorf("browserOpenCmd(%s) args = %v, want first %q", c.goos, args, c.wantArg0)
		}
		// The URL must always be present in the args.
		found := false
		for _, a := range args {
			if a == url {
				found = true
			}
		}
		if !found {
			t.Errorf("browserOpenCmd(%s) args %v missing url", c.goos, args)
		}
	}
}
