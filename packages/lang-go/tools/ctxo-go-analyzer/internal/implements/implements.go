// Package implements derives interface-satisfaction edges by pairing every
// concrete named type in the module against every module-local interface and
// consulting go/types. Go's structural typing means this is the only way to
// recover `implements` relations — there is no `implements` keyword to walk.
package implements

import (
	"go/token"
	"go/types"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/packages"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/symbols"
)

// Extract returns `implements` edges grouped by the source file of the
// concrete type. Both sides of each edge are guaranteed to live inside the
// module root — external interfaces and stdlib types are skipped.
func Extract(rootDir string, pkgs []*packages.Package) map[string][]emit.Edge {
	type typed struct {
		named *types.Named
		file  string
	}

	var concretes []typed
	var ifaces []typed

	packages.Visit(pkgs, nil, func(p *packages.Package) {
		if p.Types == nil || p.Fset == nil {
			return
		}
		scope := p.Types.Scope()
		for _, name := range scope.Names() {
			if name == "_" {
				continue
			}
			obj := scope.Lookup(name)
			tn, ok := obj.(*types.TypeName)
			if !ok {
				continue
			}
			named, ok := tn.Type().(*types.Named)
			if !ok {
				continue
			}
			// Generic types are bucketed once, without instantiation — consistent
			// with the ADR-013 §4 generics decision.
			if named.TypeParams() != nil && named.TypeParams().Len() > 0 {
				continue
			}
			rel := relFile(p.Fset, obj.Pos(), rootDir)
			if rel == "" {
				continue
			}
			entry := typed{named: named, file: rel}
			if _, isIface := named.Underlying().(*types.Interface); isIface {
				ifaces = append(ifaces, entry)
			} else {
				concretes = append(concretes, entry)
			}
		}
	})

	out := map[string][]emit.Edge{}
	for _, iface := range ifaces {
		iUnder := iface.named.Underlying().(*types.Interface)
		if iUnder.NumMethods() == 0 {
			// Empty interfaces (any, comparable-without-methods) are satisfied by
			// every type — skipping keeps the graph useful.
			continue
		}
		ifaceID := symbols.SymbolID(iface.file, iface.named.Obj().Name(), "interface")

		for _, c := range concretes {
			concreteID := symbols.SymbolID(c.file, c.named.Obj().Name(), kindOf(c.named))
			if concreteID == ifaceID {
				continue
			}
			if types.Implements(c.named, iUnder) || types.Implements(types.NewPointer(c.named), iUnder) {
				out[c.file] = append(out[c.file], emit.Edge{
					From: concreteID,
					To:   ifaceID,
					Kind: "implements",
				})
			}
		}
	}
	return out
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
