package symbols

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/load"
)

func TestExtract(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"a.go": `package fixture

// Top-level function (exported)
func Hello() string { return "hi" }

// Unexported function — should still surface (no exported-only filter)
func helper() {}

// Variables and constants
var Counter = 0
const Tag = "release"

// Blank identifier — must be skipped
var _ = "ignore"
`,
		"types.go": `package fixture

type User struct {
	Name string
}

type Greeter interface {
	Greet() string
}

type ID = string

// Method with pointer receiver
func (u *User) Greet() string { return "hi " + u.Name }

// Method with value receiver
func (u User) ID() string { return u.Name }
`,
	})

	res, err := load.Packages(dir)
	if err != nil {
		t.Fatalf("Packages: %v", err)
	}
	if len(res.Packages) == 0 {
		t.Fatal("no packages loaded")
	}

	all := map[string]string{} // name -> kind
	files := map[string]bool{}
	for _, pkg := range res.Packages {
		for _, fs := range Extract(pkg, dir) {
			files[fs.RelPath] = true
			for _, s := range fs.Symbols {
				all[s.Name] = s.Kind
				if s.StartLine == 0 {
					t.Errorf("symbol %s missing StartLine", s.Name)
				}
				if s.StartOffset == nil || s.EndOffset == nil {
					t.Errorf("symbol %s missing offsets", s.Name)
				}
				wantID := SymbolID(fs.RelPath, s.Name, s.Kind)
				if s.SymbolID != wantID {
					t.Errorf("symbol %s id=%q want %q", s.Name, s.SymbolID, wantID)
				}
			}
		}
	}

	expected := map[string]string{
		"Hello":   "function",
		"helper":  "function",
		"Counter": "variable",
		"Tag":     "variable",
		"User":    "class",
		"Greeter": "interface",
		"ID":      "type",
		// Methods qualified with receiver
		"User.Greet": "method",
		"User.ID":    "method",
	}
	for name, kind := range expected {
		got, ok := all[name]
		if !ok {
			t.Errorf("missing symbol %s", name)
			continue
		}
		if got != kind {
			t.Errorf("symbol %s kind=%s want %s", name, got, kind)
		}
	}

	if _, ok := all["_"]; ok {
		t.Error("blank identifier should be skipped")
	}

	for f := range files {
		if !strings.HasSuffix(f, ".go") {
			t.Errorf("relative path not normalized: %s", f)
		}
		if strings.Contains(f, "\\") {
			t.Errorf("relative path uses backslash: %s", f)
		}
	}
}

func TestReceiverTypeName(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"a.go": `package fixture

type Box[T any] struct{ v T }

func (b *Box[T]) Get() T { return b.v }
`,
	})
	res, err := load.Packages(dir)
	if err != nil {
		t.Fatal(err)
	}

	found := false
	for _, pkg := range res.Packages {
		for _, fs := range Extract(pkg, dir) {
			for _, s := range fs.Symbols {
				if s.Name == "Box.Get" && s.Kind == "method" {
					found = true
				}
			}
		}
	}
	if !found {
		t.Error("expected method Box.Get with generic receiver")
	}
}

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
