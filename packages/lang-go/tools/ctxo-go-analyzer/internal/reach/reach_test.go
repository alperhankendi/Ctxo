package reach

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/load"
)

func TestBinaryReachability(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"main.go": `package main

func used() string { return "alive" }
func dead() string { return "never called" }

func main() { _ = used() }
`,
	})

	r := analyze(t, dir)
	if !r.HasMain {
		t.Fatal("expected HasMain=true for binary fixture")
	}
	if !r.Reachable["main.go::main::function"] {
		t.Error("main should be reachable")
	}
	if !r.Reachable["main.go::used::function"] {
		t.Error("used() should be reachable")
	}
	if r.Reachable["main.go::dead::function"] {
		t.Error("dead() must not be reachable")
	}
}

func TestLibraryMode(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"lib.go": `package fixture

func Public() int { return internal() }
func internal() int { return 1 }
func Orphan() int { return 2 }  // exported but with no internal callers — still reachable as library root
func _unused() int { return 3 } // not exported, no callers

type Box struct{}
func (Box) Shake() {}     // exported method — reachable
func (Box) hide()   {}    // unexported — not reachable unless called
`,
	})

	r := analyze(t, dir)
	if r.HasMain {
		t.Fatal("expected library mode")
	}
	if !r.Reachable["lib.go::Public::function"] {
		t.Error("Public must be reachable (library root)")
	}
	if !r.Reachable["lib.go::internal::function"] {
		t.Error("internal must be reachable (called by Public)")
	}
	if !r.Reachable["lib.go::Orphan::function"] {
		t.Error("Orphan must be reachable (library root)")
	}
	if !r.Reachable["lib.go::Box.Shake::method"] {
		t.Error("Box.Shake must be reachable (exported method root)")
	}
}

func TestReflectSafe(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"main.go": `package main

import "reflect"

type Target struct{}
func (Target) UsedViaReflect() {}  // never called, but accessed via reflect
func (Target) AlsoReflective()  {}

func main() { _ = reflect.TypeOf(Target{}) }
`,
	})
	r := analyze(t, dir)
	if !r.Reachable["main.go::Target.UsedViaReflect::method"] {
		t.Error("reflect.TypeOf(Target{}) should mark Target methods reachable")
	}
	if !r.Reachable["main.go::Target.AlsoReflective::method"] {
		t.Error("reflect-accessed types promote all methods")
	}
}

func TestJSONUnmarshalSafe(t *testing.T) {
	dir := writeFixture(t, map[string]string{
		"go.mod": "module fixture\n\ngo 1.22\n",
		"main.go": `package main

import "encoding/json"

type Payload struct{ Name string }
func (Payload) String() string { return "p" }

func main() {
	var p Payload
	_ = json.Unmarshal([]byte("{}"), &p)
}
`,
	})
	r := analyze(t, dir)
	if !r.Reachable["main.go::Payload.String::method"] {
		t.Error("json.Unmarshal argument type methods must be reachable")
	}
}

// ── helpers ──

func analyze(t *testing.T, dir string) *Result {
	t.Helper()
	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatal(res.FatalError)
	}
	return Analyze(dir, res.Packages, 30*time.Second)
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
