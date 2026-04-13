// Package extends derives `extends` edges for struct-field embedding and
// interface-embedding — Go's closest analog to inheritance. A struct with
// an anonymous field of type T promotes T's methods; an interface embedding
// another interface inherits its method set.
package extends

import (
	"go/token"
	"go/types"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/packages"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/symbols"
)

// Extract returns `extends` edges grouped by the source file of the
// embedding type (the child). External embeddings (stdlib types promoted
// into a module-local struct) are skipped — we only care about intra-module
// inheritance chains for graph traversal.
func Extract(rootDir string, pkgs []*packages.Package) map[string][]emit.Edge {
	type entry struct {
		named *types.Named
		file  string
	}

	var named []entry
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		if p.Types == nil || p.Fset == nil {
			return
		}
		scope := p.Types.Scope()
		for _, n := range scope.Names() {
			if n == "_" {
				continue
			}
			obj := scope.Lookup(n)
			tn, ok := obj.(*types.TypeName)
			if !ok {
				continue
			}
			t, ok := tn.Type().(*types.Named)
			if !ok {
				continue
			}
			if t.TypeParams() != nil && t.TypeParams().Len() > 0 {
				continue
			}
			rel := relFile(p.Fset, obj.Pos(), rootDir)
			if rel == "" {
				continue
			}
			named = append(named, entry{named: t, file: rel})
		}
	})

	// Build a lookup so we can resolve embedded-type references to a file path
	// and kind without re-traversing packages.
	typeIndex := make(map[*types.TypeName]entry)
	for _, e := range named {
		typeIndex[e.named.Obj()] = e
	}

	out := map[string][]emit.Edge{}
	add := func(from entry, target *types.Named, kind string) {
		tgt, ok := typeIndex[target.Obj()]
		if !ok {
			return
		}
		fromID := symbols.SymbolID(from.file, from.named.Obj().Name(), kind)
		toID := symbols.SymbolID(tgt.file, tgt.named.Obj().Name(), kindOf(tgt.named))
		if fromID == toID {
			return
		}
		out[from.file] = append(out[from.file], emit.Edge{
			From: fromID,
			To:   toID,
			Kind: "extends",
		})
	}

	for _, e := range named {
		switch under := e.named.Underlying().(type) {
		case *types.Struct:
			for i := 0; i < under.NumFields(); i++ {
				f := under.Field(i)
				if !f.Embedded() {
					continue
				}
				if target := asNamed(f.Type()); target != nil {
					add(e, target, "class")
				}
			}
		case *types.Interface:
			for i := 0; i < under.NumEmbeddeds(); i++ {
				if target := asNamed(under.EmbeddedType(i)); target != nil {
					add(e, target, "interface")
				}
			}
		}
	}
	return out
}

func asNamed(t types.Type) *types.Named {
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	if n, ok := t.(*types.Named); ok {
		return n
	}
	return nil
}

func kindOf(n *types.Named) string {
	switch n.Underlying().(type) {
	case *types.Struct:
		return "class"
	case *types.Interface:
		return "interface"
	default:
		return "type"
	}
}

func relFile(fset *token.FileSet, pos token.Pos, rootDir string) string {
	p := fset.Position(pos)
	if !p.IsValid() {
		return ""
	}
	rel, err := filepath.Rel(rootDir, p.Filename)
	if err != nil || strings.HasPrefix(rel, "..") {
		return ""
	}
	return filepath.ToSlash(rel)
}
