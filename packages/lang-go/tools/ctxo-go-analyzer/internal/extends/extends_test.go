package extends

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/load"
)

func TestStructEmbedding(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"a.go": `package fixture

type Base struct {
	ID string
}

// Child embeds Base (value embedding).
type Child struct {
	Base
	Extra int
}

// Pointer embedding.
type PointerChild struct {
	*Base
}

// Named field — NOT embedded.
type NotChild struct {
	B Base
}
`,
	})

	edges := extractAll(t, dir)

	want := []string{
		"a.go::Child::class -> a.go::Base::class (extends)",
		"a.go::PointerChild::class -> a.go::Base::class (extends)",
	}
	for _, w := range want {
		if !edges[w] {
			t.Errorf("missing: %s\n  got: %v", w, edges)
		}
	}
	if edges["a.go::NotChild::class -> a.go::Base::class (extends)"] {
		t.Error("named field must not be treated as embedding")
	}
}

func TestInterfaceEmbedding(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"a.go": `package fixture

type Reader interface { Read() }
type Writer interface { Write() }

type ReadWriter interface {
	Reader
	Writer
}
`,
	})

	edges := extractAll(t, dir)

	want := []string{
		"a.go::ReadWriter::interface -> a.go::Reader::interface (extends)",
		"a.go::ReadWriter::interface -> a.go::Writer::interface (extends)",
	}
	for _, w := range want {
		if !edges[w] {
			t.Errorf("missing: %s\n  got: %v", w, edges)
		}
	}
}

func TestSkipStdlibEmbedding(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"a.go": `package fixture

import "sync"

type Guarded struct {
	sync.Mutex
}
`,
	})
	edges := extractAll(t, dir)
	for key := range edges {
		if contains(key, "sync.") || contains(key, "Mutex") {
			t.Errorf("stdlib embedding leaked: %s", key)
		}
	}
}

// ── helpers ──

func extractAll(t *testing.T, dir string) map[string]bool {
	t.Helper()
	res, err := load.Packages(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, list := range Extract(dir, res.Packages) {
		for _, e := range list {
			out[e.From+" -> "+e.To+" ("+e.Kind+")"] = true
		}
	}
	return out
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

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
