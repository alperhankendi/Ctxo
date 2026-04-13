// Package reach builds an SSA program, computes a Class Hierarchy Analysis
// (CHA) callgraph, and returns the set of function/method symbols reachable
// from a set of roots (main.main + init if binary; all exported API if
// library).
//
// A reflect-safe post-pass grafts back methods on types that appear as
// arguments to reflect.TypeOf / reflect.ValueOf / reflect.New or
// json.Marshal/Unmarshal — the most common source of false-positive dead
// code in Go codebases.
//
// Design note: ADR-013 originally specified RTA, but RTA panics on generic
// code (golang/go issue). CHA is conservative (over-approximates reachability
// through interface dispatch) which is preferable for dead-code detection —
// it reduces false positives at the cost of slightly less precise liveness.
// Analysis runs with a deadline per ADR-013 §4 Q3.
package reach

import (
	"go/ast"
	"go/token"
	"go/types"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/tools/go/callgraph"
	"golang.org/x/tools/go/callgraph/cha"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/symbols"
)

// Result is the reachability snapshot. Reachable holds symbol IDs that are
// transitively callable from the chosen roots. HasMain distinguishes binary
// mode (precise) from library mode (approximated via exported API).
type Result struct {
	Reachable map[string]bool
	HasMain   bool
	Timeout   bool
	Elapsed   time.Duration
}

// Analyze runs SSA + RTA against the loaded package set. deadline bounds the
// RTA phase specifically (SSA build is always completed — it is cheap).
func Analyze(rootDir string, pkgs []*packages.Package, deadline time.Duration) *Result {
	start := time.Now()

	prog, _ := ssautil.AllPackages(pkgs, ssa.BuilderMode(0))
	prog.Build()

	pkgByTypes := make(map[*types.Package]*packages.Package)
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		if p.Types != nil {
			pkgByTypes[p.Types] = p
		}
	})

	roots, hasMain := collectRoots(prog, pkgs, rootDir)

	result := &Result{Reachable: map[string]bool{}, HasMain: hasMain}

	if len(roots) > 0 {
		done := make(chan *callgraph.Graph, 1)
		go func() {
			// cha.CallGraph is synchronous and not cancellable — on timeout the
			// goroutine leaks but the process exits shortly after.
			done <- cha.CallGraph(prog)
		}()

		select {
		case cg := <-done:
			for fn := range reachableFromGraph(cg, roots) {
				if id, ok := ssaFuncSymbolID(fn, rootDir); ok {
					result.Reachable[id] = true
				}
			}
		case <-time.After(deadline):
			result.Timeout = true
		}
	}

	applyReflectSafe(pkgs, pkgByTypes, rootDir, result.Reachable)

	result.Elapsed = time.Since(start)
	return result
}

// reachableFromGraph performs a BFS over the callgraph starting from the
// provided root functions and returns the set of reachable *ssa.Function.
func reachableFromGraph(cg *callgraph.Graph, roots []*ssa.Function) map[*ssa.Function]struct{} {
	seen := make(map[*ssa.Function]struct{})
	queue := make([]*ssa.Function, 0, len(roots))
	for _, r := range roots {
		if r != nil {
			queue = append(queue, r)
		}
	}
	for len(queue) > 0 {
		fn := queue[0]
		queue = queue[1:]
		if _, ok := seen[fn]; ok {
			continue
		}
		seen[fn] = struct{}{}
		node := cg.Nodes[fn]
		if node == nil {
			continue
		}
		for _, edge := range node.Out {
			if edge.Callee != nil && edge.Callee.Func != nil {
				queue = append(queue, edge.Callee.Func)
			}
		}
	}
	return seen
}

// collectRoots returns the CHA entry set. Binary packages contribute their
// main + init; when no main exists anywhere, every exported function/method
// in the module becomes a root (library approximation).
func collectRoots(prog *ssa.Program, pkgs []*packages.Package, rootDir string) ([]*ssa.Function, bool) {
	var mains []*ssa.Function
	var inits []*ssa.Function
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		sp := prog.Package(p.Types)
		if sp == nil {
			return
		}
		if p.Name == "main" {
			if main := sp.Func("main"); main != nil {
				mains = append(mains, main)
			}
		}
		if init := sp.Func("init"); init != nil {
			inits = append(inits, init)
		}
	})

	if len(mains) > 0 {
		return append(mains, inits...), true
	}

	// Library mode — treat every module-local exported function/method as a root.
	var roots []*ssa.Function
	roots = append(roots, inits...)
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		if !inModule(p, rootDir) {
			return
		}
		sp := prog.Package(p.Types)
		if sp == nil {
			return
		}
		for _, member := range sp.Members {
			switch m := member.(type) {
			case *ssa.Function:
				if isExported(m.Name()) {
					roots = append(roots, m)
				}
			case *ssa.Type:
				// Methods on a named type live on the method set, not the member map.
				mset := prog.MethodSets.MethodSet(m.Type())
				for i := 0; i < mset.Len(); i++ {
					fn := prog.MethodValue(mset.At(i))
					if fn != nil && isExported(fn.Name()) {
						roots = append(roots, fn)
					}
				}
				// Also pointer receiver methods.
				ptrSet := prog.MethodSets.MethodSet(types.NewPointer(m.Type()))
				for i := 0; i < ptrSet.Len(); i++ {
					fn := prog.MethodValue(ptrSet.At(i))
					if fn != nil && isExported(fn.Name()) {
						roots = append(roots, fn)
					}
				}
			}
		}
	})
	return roots, false
}

// applyReflectSafe grafts method symbols of reflect-accessed types back into
// the reachable set. Scope is conservative: reflect.TypeOf, reflect.ValueOf,
// reflect.New, and json.Unmarshal / json.NewDecoder arguments.
func applyReflectSafe(pkgs []*packages.Package, pkgByTypes map[*types.Package]*packages.Package, rootDir string, reachable map[string]bool) {
	safe := make(map[*types.Named]struct{})
	for _, p := range pkgs {
		if p.TypesInfo == nil {
			continue
		}
		for _, f := range p.Syntax {
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				if !isReflectOrJSONCall(call, p.TypesInfo) {
					return true
				}
				if len(call.Args) == 0 {
					return true
				}
				t := p.TypesInfo.TypeOf(call.Args[0])
				if t == nil {
					return true
				}
				if ptr, ok := t.(*types.Pointer); ok {
					t = ptr.Elem()
				}
				if named, ok := t.(*types.Named); ok {
					safe[named] = struct{}{}
				}
				return true
			})
		}
	}

	for named := range safe {
		addMethodsToReachable(named, pkgByTypes, rootDir, reachable)
	}
}

func isReflectOrJSONCall(call *ast.CallExpr, info *types.Info) bool {
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	x, ok := sel.X.(*ast.Ident)
	if !ok {
		return false
	}
	obj := info.Uses[x]
	pn, ok := obj.(*types.PkgName)
	if !ok {
		return false
	}
	path := pn.Imported().Path()
	switch path {
	case "reflect":
		switch sel.Sel.Name {
		case "TypeOf", "ValueOf", "New":
			return true
		}
	case "encoding/json":
		switch sel.Sel.Name {
		case "Unmarshal", "NewDecoder", "Marshal", "NewEncoder":
			return true
		}
	}
	return false
}

func addMethodsToReachable(n *types.Named, pkgByTypes map[*types.Package]*packages.Package, rootDir string, reachable map[string]bool) {
	pkg := pkgByTypes[n.Obj().Pkg()]
	if pkg == nil || pkg.Fset == nil {
		return
	}
	for i := 0; i < n.NumMethods(); i++ {
		m := n.Method(i)
		rel := relFile(pkg.Fset, m.Pos(), rootDir)
		if rel == "" {
			continue
		}
		name := n.Obj().Name() + "." + m.Name()
		reachable[symbols.SymbolID(rel, name, "method")] = true
	}
}

// ssaFuncSymbolID maps an *ssa.Function back to the Ctxo symbol id format
// used by the symbols/edges passes. Anonymous closures and synthetic
// wrappers are filtered by their missing source position.
func ssaFuncSymbolID(fn *ssa.Function, rootDir string) (string, bool) {
	if fn == nil || fn.Pos() == token.NoPos || fn.Prog == nil {
		return "", false
	}
	file := fn.Prog.Fset.File(fn.Pos())
	if file == nil {
		return "", false
	}
	rel, err := filepath.Rel(rootDir, file.Name())
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	rel = filepath.ToSlash(rel)

	name := fn.Name()
	kind := "function"
	if fn.Signature != nil && fn.Signature.Recv() != nil {
		if recv := receiverName(fn.Signature.Recv().Type()); recv != "" {
			name = recv + "." + fn.Name()
			kind = "method"
		}
	}
	return symbols.SymbolID(rel, name, kind), true
}

func receiverName(t types.Type) string {
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	if n, ok := t.(*types.Named); ok {
		return n.Obj().Name()
	}
	return ""
}

func inModule(p *packages.Package, rootDir string) bool {
	if len(p.GoFiles) == 0 {
		return false
	}
	rel, err := filepath.Rel(rootDir, p.GoFiles[0])
	return err == nil && !strings.HasPrefix(rel, "..")
}

func isExported(name string) bool {
	return name != "" && name[0] >= 'A' && name[0] <= 'Z'
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
