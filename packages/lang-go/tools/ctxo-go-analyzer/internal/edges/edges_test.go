package edges

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/load"
)

func TestExtractCallsAndUses(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"main.go": `package main

type User struct{ Name string }

func (u *User) Greet() string { return "hi " + u.Name }

func greet(u *User) string { return u.Greet() }

func main() {
	u := &User{Name: "x"}
	_ = greet(u)
}
`,
	})

	edges := extractAllEdges(t, dir)

	want := map[string]bool{
		// greet uses *User in its parameter list
		"main.go::greet::function -> main.go::User::class (uses)": true,
		// greet calls User.Greet via u.Greet()
		"main.go::greet::function -> main.go::User.Greet::method (calls)": true,
		// main calls greet
		"main.go::main::function -> main.go::greet::function (calls)": true,
		// main uses User via composite literal &User{}
		"main.go::main::function -> main.go::User::class (uses)": true,
	}
	for key := range want {
		if !edges[key] {
			t.Errorf("missing edge: %s\n  got: %v", key, sortedKeys(edges))
			return
		}
	}
}

func TestCrossPackageCalls(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"pkg/helper/helper.go": `package helper

func Do() int { return 42 }
`,
		"main.go": `package main

import "fixture/pkg/helper"

func main() { _ = helper.Do() }
`,
	})

	edges := extractAllEdges(t, dir)

	key := "main.go::main::function -> pkg/helper/helper.go::Do::function (calls)"
	if !edges[key] {
		t.Errorf("missing cross-package call edge\n  got: %v", sortedKeys(edges))
	}
}

func TestGenericCallCarriesTypeArgs(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"main.go": `package main

func ID[T any](v T) T { return v }

func main() { _ = ID[int](1) }
`,
	})

	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatal(res.FatalError)
	}
	ext := NewExtractor(dir, res.Packages)

	var found bool
	for _, pkg := range res.Packages {
		for _, file := range pkg.Syntax {
			for _, edge := range ext.Extract(pkg, file) {
				if edge.Kind == "calls" && edge.To == "main.go::ID::function" {
					if len(edge.TypeArgs) != 1 || edge.TypeArgs[0] != "int" {
						t.Errorf("typeArgs = %v, want [int]", edge.TypeArgs)
					}
					found = true
				}
			}
		}
	}
	if !found {
		t.Error("no calls edge to ID function found")
	}
}

func TestNoEdgesToStdlib(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"main.go": `package main

import "strings"

func main() { _ = strings.ToUpper("hi") }
`,
	})
	edges := extractAllEdges(t, dir)
	for key := range edges {
		if containsStdlib(key) {
			t.Errorf("edge leaks stdlib target: %s", key)
		}
	}
}

// ── helpers ──

func extractAllEdges(t *testing.T, dir string) map[string]bool {
	t.Helper()
	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatal(res.FatalError)
	}
	ext := NewExtractor(dir, res.Packages)
	out := map[string]bool{}
	for _, pkg := range res.Packages {
		for _, file := range pkg.Syntax {
			for _, edge := range ext.Extract(pkg, file) {
				out[formatEdge(edge)] = true
			}
		}
	}
	return out
}

func formatEdge(e emit.Edge) string {
	return e.From + " -> " + e.To + " (" + e.Kind + ")"
}

func sortedKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func containsStdlib(key string) bool {
	for _, prefix := range []string{"strings.", "fmt.", "errors.", "runtime."} {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			return true
		}
	}
	return false
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
