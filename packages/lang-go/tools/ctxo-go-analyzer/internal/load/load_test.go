package load

import (
	"os"
	"path/filepath"
	"sort"
	"testing"

	"golang.org/x/tools/go/packages"
)

func TestPackagesOnHealthyModule(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"a.go":   "package fixture\n\nfunc Hello() string { return \"hi\" }\n",
	})
	res := Packages(dir)
	if res.FatalError != nil {
		t.Fatalf("FatalError: %v", res.FatalError)
	}
	if len(res.Packages) == 0 {
		t.Fatal("expected at least one package")
	}
}

func TestPackagesWithFallbackRecoversPartial(t *testing.T) {
	// "broken/" imports a non-existent path so the module-wide load fails;
	// "healthy/" is self-contained, so per-subdir loading recovers it.
	dir := writeFixture(t, map[string]string{
		"go.mod":             "module fixture\n\ngo 1.22\n",
		"broken/broken.go":   "package broken\n\nimport _ \"definitely.nowhere/missing\"\n",
		"healthy/healthy.go": "package healthy\n\nfunc Y() int { return 1 }\n",
	})

	res := PackagesWithFallback(dir)
	if len(res.Packages) == 0 {
		t.Fatalf("expected fallback to recover at least one package; got 0 (FatalError=%v)", res.FatalError)
	}
	if !pkgListContainsName(res.Packages, "healthy") {
		t.Errorf("expected 'healthy' package recovered via fallback; got %v", pkgNames(res.Packages))
	}
}

func TestTopLevelGoSubdirsSkipsHidden(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"a/file.go":     "package a",
		".hidden/x.go":  "package x",
		"vendor/foo.go": "package foo",
		"b/file.go":     "package b",
	})
	got := topLevelGoSubdirs(dir)
	sort.Strings(got)
	want := []string{"a", "b"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("index %d: got %q want %q", i, got[i], want[i])
		}
	}
}

// ── helpers ──

func writeFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func pkgNames(pkgs []*packages.Package) []string {
	out := make([]string, 0, len(pkgs))
	for _, p := range pkgs {
		out = append(out, p.Name)
	}
	return out
}

func pkgListContainsName(pkgs []*packages.Package, name string) bool {
	for _, p := range pkgs {
		if p.Name == name {
			return true
		}
	}
	return false
}
