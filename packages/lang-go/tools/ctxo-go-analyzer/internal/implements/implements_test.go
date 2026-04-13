package implements

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/load"
)

func TestExtractSatisfiesInterface(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"types.go": `package fixture

type Greeter interface {
	Greet() string
}

// Value-receiver implementation.
type Hello struct{}
func (h Hello) Greet() string { return "hello" }

// Pointer-receiver implementation.
type Ciao struct{}
func (c *Ciao) Greet() string { return "ciao" }

// Non-implementer — missing Greet.
type Silent struct{}

// Empty interface — edges to it must NOT be emitted.
type Any interface{}

// Interface-to-interface — should not produce implements edge.
type LoudGreeter interface {
	Greeter
	Shout()
}
`,
	})

	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatal(res.FatalError)
	}

	out := Extract(dir, res.Packages)

	edges := map[string]bool{}
	for _, list := range out {
		for _, e := range list {
			edges[e.From+" -> "+e.To+" ("+e.Kind+")"] = true
		}
	}

	mustHave := []string{
		"types.go::Hello::class -> types.go::Greeter::interface (implements)",
		"types.go::Ciao::class -> types.go::Greeter::interface (implements)",
	}
	for _, want := range mustHave {
		if !edges[want] {
			t.Errorf("missing edge: %s\n  got: %v", want, edges)
		}
	}

	mustNotHave := []string{
		"types.go::Silent::class -> types.go::Greeter::interface (implements)",
	}
	for _, bad := range mustNotHave {
		if edges[bad] {
			t.Errorf("unexpected edge: %s", bad)
		}
	}

	for key := range edges {
		if containsSubstring(key, "Any::interface") {
			t.Errorf("empty-interface edge leaked: %s", key)
		}
	}
}

func TestNonStructNamedType(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"a.go": `package fixture

type Stringer interface { String() string }

// Non-struct named type — underlying is string, but it has methods.
type ID string

func (i ID) String() string { return string(i) }
`,
	})

	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatal(res.FatalError)
	}
	out := Extract(dir, res.Packages)

	got := false
	for _, list := range out {
		for _, e := range list {
			if e.From == "a.go::ID::type" && e.To == "a.go::Stringer::interface" && e.Kind == "implements" {
				got = true
			}
		}
	}
	if !got {
		t.Errorf("expected non-struct type ID to implement Stringer; got %v", out)
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

func containsSubstring(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
