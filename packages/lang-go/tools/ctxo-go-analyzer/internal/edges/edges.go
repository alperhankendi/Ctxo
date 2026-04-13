// Package edges extracts type-resolved dependency edges from loaded Go
// packages. This pass covers `calls` and `uses` — the edges whose targets
// can be resolved straight from go/types without SSA or reachability info.
// `implements` (Step 4), `extends` (Step 5), and refinements driven by RTA
// live in sibling packages.
package edges

import (
	"go/ast"
	"go/token"
	"go/types"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/packages"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/symbols"
)

// Extractor turns AST identifiers into Ctxo symbol-id edges by looking up the
// resolved *types.Object and mapping it back to the loaded package set. It is
// safe to reuse across files within a single analyzer invocation.
type Extractor struct {
	rootDir   string
	pkgByPath map[string]*packages.Package
}

// NewExtractor builds a package-path index across the loaded dependency
// closure so edge targets in imported internal packages can be resolved.
func NewExtractor(rootDir string, roots []*packages.Package) *Extractor {
	idx := make(map[string]*packages.Package)
	packages.Visit(roots, nil, func(p *packages.Package) {
		if p.PkgPath != "" {
			idx[p.PkgPath] = p
		}
	})
	return &Extractor{rootDir: rootDir, pkgByPath: idx}
}

// Extract walks one parsed file and returns the edges whose source is a
// declaration in that file. Duplicate edges (same from/to/kind/typeArgs) are
// deduplicated so repeated call sites count once.
func (e *Extractor) Extract(pkg *packages.Package, file *ast.File) []emit.Edge {
	if pkg == nil || pkg.Fset == nil || pkg.TypesInfo == nil {
		return nil
	}
	relFile := relativeFile(pkg.Fset, file, e.rootDir)
	if relFile == "" {
		return nil
	}

	seen := make(map[edgeKey]struct{})
	var out []emit.Edge
	addEdge := func(from, to, kind string, typeArgs []string) {
		if from == "" || to == "" || from == to {
			return
		}
		key := edgeKey{from: from, to: to, kind: kind, typeArgs: strings.Join(typeArgs, ",")}
		if _, dup := seen[key]; dup {
			return
		}
		seen[key] = struct{}{}
		out = append(out, emit.Edge{From: from, To: to, Kind: kind, TypeArgs: typeArgs})
	}

	for _, decl := range file.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok || fd.Name == nil || fd.Name.Name == "_" {
			continue
		}
		fromID := funcDeclSymbolID(relFile, fd)
		if fromID == "" {
			continue
		}

		inspect := func(node ast.Node) {
			if node == nil {
				return
			}
			ast.Inspect(node, func(n ast.Node) bool {
				switch x := n.(type) {
				case *ast.CallExpr:
					e.emitCallEdge(pkg, x, fromID, addEdge)
				case *ast.Ident:
					e.emitUsesFromIdent(pkg, x, fromID, addEdge)
				}
				return true
			})
		}

		if fd.Recv != nil {
			for _, f := range fd.Recv.List {
				inspect(f.Type)
			}
		}
		if fd.Type != nil {
			if fd.Type.Params != nil {
				for _, f := range fd.Type.Params.List {
					inspect(f.Type)
				}
			}
			if fd.Type.Results != nil {
				for _, f := range fd.Type.Results.List {
					inspect(f.Type)
				}
			}
		}
		inspect(fd.Body)
	}

	return out
}

type edgeKey struct {
	from, to, kind, typeArgs string
}

func (e *Extractor) emitCallEdge(pkg *packages.Package, call *ast.CallExpr, fromID string, add func(string, string, string, []string)) {
	ident := calleeIdent(call.Fun)
	if ident == nil {
		return
	}
	obj := pkg.TypesInfo.Uses[ident]
	if obj == nil {
		obj = pkg.TypesInfo.Defs[ident]
	}
	if _, ok := obj.(*types.Func); !ok {
		return
	}
	toID, ok := e.symbolIDForObject(obj)
	if !ok {
		return
	}
	add(fromID, toID, "calls", typeArgsFor(pkg, ident))
}

func (e *Extractor) emitUsesFromIdent(pkg *packages.Package, ident *ast.Ident, fromID string, add func(string, string, string, []string)) {
	obj := pkg.TypesInfo.Uses[ident]
	if obj == nil {
		return
	}
	switch obj.(type) {
	case *types.TypeName:
		// type reference — always package-level, always a uses edge candidate
	case *types.Var, *types.Const:
		if obj.Pkg() == nil || obj.Pkg().Scope().Lookup(obj.Name()) != obj {
			// field access, local var, or unexported import alias
			return
		}
	default:
		return
	}
	toID, ok := e.symbolIDForObject(obj)
	if !ok {
		return
	}
	add(fromID, toID, "uses", typeArgsFor(pkg, ident))
}

// symbolIDForObject maps a resolved types.Object to a Ctxo symbol id, scoped
// to the module root. Returns (id, true) only when the declaration lives
// inside the analyzed module; stdlib and external deps are intentionally
// skipped to keep the graph focused on intra-module coupling.
func (e *Extractor) symbolIDForObject(obj types.Object) (string, bool) {
	if obj == nil || obj.Pkg() == nil {
		return "", false
	}
	target := e.pkgByPath[obj.Pkg().Path()]
	if target == nil || target.Fset == nil {
		return "", false
	}
	pos := target.Fset.Position(obj.Pos())
	if !pos.IsValid() {
		return "", false
	}
	rel, err := filepath.Rel(e.rootDir, pos.Filename)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	name := objectName(obj)
	kind := objectKind(obj)
	if name == "" || kind == "" {
		return "", false
	}
	return symbols.SymbolID(filepath.ToSlash(rel), name, kind), true
}

func objectName(obj types.Object) string {
	if fn, ok := obj.(*types.Func); ok {
		if sig, ok := fn.Type().(*types.Signature); ok && sig.Recv() != nil {
			if recv := receiverTypeName(sig.Recv().Type()); recv != "" {
				return recv + "." + fn.Name()
			}
		}
	}
	return obj.Name()
}

func objectKind(obj types.Object) string {
	switch o := obj.(type) {
	case *types.Func:
		if sig, ok := o.Type().(*types.Signature); ok && sig.Recv() != nil {
			return "method"
		}
		return "function"
	case *types.TypeName:
		switch o.Type().Underlying().(type) {
		case *types.Struct:
			return "class"
		case *types.Interface:
			return "interface"
		default:
			return "type"
		}
	case *types.Var, *types.Const:
		return "variable"
	}
	return ""
}

func receiverTypeName(t types.Type) string {
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	if n, ok := t.(*types.Named); ok {
		return n.Obj().Name()
	}
	return ""
}

func calleeIdent(expr ast.Expr) *ast.Ident {
	switch x := expr.(type) {
	case *ast.Ident:
		return x
	case *ast.SelectorExpr:
		return x.Sel
	case *ast.IndexExpr:
		return calleeIdent(x.X)
	case *ast.IndexListExpr:
		return calleeIdent(x.X)
	case *ast.ParenExpr:
		return calleeIdent(x.X)
	}
	return nil
}

func typeArgsFor(pkg *packages.Package, ident *ast.Ident) []string {
	if pkg.TypesInfo == nil || pkg.TypesInfo.Instances == nil {
		return nil
	}
	inst, ok := pkg.TypesInfo.Instances[ident]
	if !ok || inst.TypeArgs == nil {
		return nil
	}
	n := inst.TypeArgs.Len()
	if n == 0 {
		return nil
	}
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = inst.TypeArgs.At(i).String()
	}
	return out
}

func funcDeclSymbolID(relFile string, fd *ast.FuncDecl) string {
	if fd.Recv != nil && len(fd.Recv.List) > 0 {
		if recv := receiverASTName(fd.Recv.List[0].Type); recv != "" {
			return symbols.SymbolID(relFile, recv+"."+fd.Name.Name, "method")
		}
	}
	return symbols.SymbolID(relFile, fd.Name.Name, "function")
}

func receiverASTName(expr ast.Expr) string {
	for {
		switch x := expr.(type) {
		case *ast.StarExpr:
			expr = x.X
		case *ast.IndexExpr:
			expr = x.X
		case *ast.IndexListExpr:
			expr = x.X
		case *ast.Ident:
			return x.Name
		default:
			return ""
		}
	}
}

func relativeFile(fset *token.FileSet, file *ast.File, rootDir string) string {
	tf := fset.File(file.Pos())
	if tf == nil {
		return ""
	}
	rel, err := filepath.Rel(rootDir, tf.Name())
	if err != nil || strings.HasPrefix(rel, "..") {
		return ""
	}
	return filepath.ToSlash(rel)
}
