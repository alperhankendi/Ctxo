package facts

import (
	"go/ast"
	"go/types"
	"regexp"
	"strings"
)

// Route prefixes (roadmap "Route prefixes from Express mounts, gin groups and
// MapGroup"): the path a router group is created or mounted at, joined to the
// routes registered on it. Groups are gin and echo Group(prefix) calls and the
// chi Route(pattern, func(r chi.Router)) closure, chi Group(func) and With;
// mounts are chi Mount(pattern, router). Only the file being collected is
// read, so a router created or mounted in another file has no prefix. A
// dynamic, conflicting or cyclic prefix gives none either: the route keeps the
// path written at the call, never a guessed one.

var (
	echoPkg = regexp.MustCompile(`^github\.com/labstack/echo(/v[0-9]+)?$`)
	chiPkg  = regexp.MustCompile(`^github\.com/go-chi/chi(/v[0-9]+)?$`)
)

// echoReceivers are the echo types whose route methods count.
var echoReceivers = map[string]bool{"Echo": true, "Group": true}

// chiReceivers are the chi types whose route methods count: the Mux struct and
// the Router interface.
var chiReceivers = map[string]bool{"Mux": true, "Router": true}

// echoVerbs maps echo route methods with a path first argument to verbs.
var echoVerbs = map[string]string{
	"GET": "GET", "POST": "POST", "PUT": "PUT", "DELETE": "DELETE", "PATCH": "PATCH",
	"HEAD": "HEAD", "OPTIONS": "OPTIONS", "CONNECT": "CONNECT", "TRACE": "TRACE", "Any": "ANY",
}

// chiVerbs maps chi route methods with a pattern first argument to verbs.
var chiVerbs = map[string]string{
	"Get": "GET", "Post": "POST", "Put": "PUT", "Delete": "DELETE", "Patch": "PATCH",
	"Head": "HEAD", "Options": "OPTIONS", "Connect": "CONNECT", "Trace": "TRACE",
}

// maxPrefixDepth is the most group and mount hops followed from one route.
const maxPrefixDepth = 8

// framework names the router package of a resolved method: "gin", "echo",
// "chi", or "" for any other.
func framework(fn *types.Func, recv string) string {
	path := fn.Pkg().Path()
	switch {
	case path == ginPath && ginReceivers[recv]:
		return "gin"
	case echoPkg.MatchString(path) && echoReceivers[recv]:
		return "echo"
	case chiPkg.MatchString(path) && chiReceivers[recv]:
		return "chi"
	}
	return ""
}

// method resolves a call's selector to its function and receiver type name
// ("" for a package function); ok is false when it is not a method or
// function of a named type in the function's own package.
func (c *collector) method(sel *ast.SelectorExpr) (fn *types.Func, recv string, ok bool) {
	fn, isFunc := c.info.Uses[sel.Sel].(*types.Func)
	if !isFunc || fn.Pkg() == nil {
		return nil, "", false
	}
	sig, isSig := fn.Type().(*types.Signature)
	if !isSig {
		return nil, "", false
	}
	if sig.Recv() != nil {
		named := namedType(sig.Recv().Type())
		if named == nil || named.Obj().Pkg() == nil || named.Obj().Pkg().Path() != fn.Pkg().Path() {
			return nil, "", false
		}
		recv = named.Obj().Name()
	}
	return fn, recv, true
}

// mount is one place a router object gets its prefix from: the receiver it is
// mounted on and the path (dynamic when it is not a constant).
type mount struct {
	recv    ast.Expr
	path    string
	dynamic bool
}

// prefixes holds the definitions and mounts of the file's router objects.
type prefixes struct {
	defs   map[types.Object][]ast.Expr
	mounts map[types.Object][]mount
	cache  map[types.Object]*prefixResult
}

type prefixResult struct {
	prefix string
	ok     bool
	done   bool
}

func (c *collector) objectOf(id *ast.Ident) types.Object {
	if obj := c.info.Defs[id]; obj != nil {
		return obj
	}
	return c.info.Uses[id]
}

// collectPrefixes reads the file's assignments and chi Mount, Route and Group
// calls once, before the walk that reports routes.
func (c *collector) collectPrefixes(file *ast.File) {
	p := &prefixes{defs: map[types.Object][]ast.Expr{}, mounts: map[types.Object][]mount{}, cache: map[types.Object]*prefixResult{}}
	c.prefixes = p
	define := func(lhs ast.Expr, rhs ast.Expr) {
		if id, ok := lhs.(*ast.Ident); ok && id.Name != "_" {
			if obj := c.objectOf(id); obj != nil {
				p.defs[obj] = append(p.defs[obj], rhs)
			}
		}
	}
	ast.Inspect(file, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.AssignStmt:
			if len(x.Lhs) == len(x.Rhs) {
				for i := range x.Lhs {
					define(x.Lhs[i], x.Rhs[i])
				}
			}
		case *ast.ValueSpec:
			if len(x.Names) == len(x.Values) {
				for i := range x.Names {
					define(x.Names[i], x.Values[i])
				}
			}
		case *ast.CallExpr:
			c.chiMount(x)
		}
		return true
	})
}

// chiMount records chi Mount(pattern, router), Route(pattern, func(r)) and
// Group(func(r)): the mounted router or the closure's parameter gets the
// receiver's prefix plus the pattern.
func (c *collector) chiMount(call *ast.CallExpr) {
	sel, ok := unparen(call.Fun).(*ast.SelectorExpr)
	if !ok {
		return
	}
	fn, recv, ok := c.method(sel)
	if !ok || framework(fn, recv) != "chi" {
		return
	}
	add := func(id *ast.Ident, path string, dynamic bool) {
		if obj := c.objectOf(id); obj != nil {
			c.prefixes.mounts[obj] = append(c.prefixes.mounts[obj], mount{recv: sel.X, path: path, dynamic: dynamic})
		}
	}
	switch fn.Name() {
	case "Mount":
		if len(call.Args) != 2 {
			return
		}
		if id, isID := unparen(call.Args[1]).(*ast.Ident); isID {
			path, isStr := c.constString(call, 0)
			add(id, path, !isStr)
		}
	case "Route":
		if len(call.Args) != 2 {
			return
		}
		if param := firstParam(call.Args[1]); param != nil {
			path, isStr := c.constString(call, 0)
			add(param, path, !isStr)
		}
	case "Group":
		if len(call.Args) == 1 {
			if param := firstParam(call.Args[0]); param != nil {
				add(param, "", false)
			}
		}
	}
}

// firstParam is the name of a function literal's first parameter, or nil.
func firstParam(e ast.Expr) *ast.Ident {
	lit, ok := unparen(e).(*ast.FuncLit)
	if !ok || lit.Type.Params == nil || len(lit.Type.Params.List) == 0 || len(lit.Type.Params.List[0].Names) == 0 {
		return nil
	}
	return lit.Type.Params.List[0].Names[0]
}

// prefixOf is the prefix of a route call's receiver; ok is false when any
// part of it is unknown.
func (c *collector) prefixOf(e ast.Expr, depth int) (string, bool) {
	if depth > maxPrefixDepth || c.prefixes == nil {
		return "", false
	}
	switch x := unparen(e).(type) {
	case *ast.Ident:
		obj := c.objectOf(x)
		if obj == nil {
			return "", true
		}
		return c.objectPrefix(obj, depth)
	case *ast.CallExpr:
		sel, isSel := unparen(x.Fun).(*ast.SelectorExpr)
		if !isSel {
			return "", true
		}
		fn, recv, isMethod := c.method(sel)
		if !isMethod {
			return "", true
		}
		fw := framework(fn, recv)
		switch {
		case (fw == "gin" || fw == "echo") && fn.Name() == "Group", fw == "chi" && fn.Name() == "Route":
			path, isStr := c.constString(x, 0)
			if !isStr {
				return "", false
			}
			outer, known := c.prefixOf(sel.X, depth+1)
			return joinPrefix(outer, path), known
		case fw == "chi" && (fn.Name() == "With" || fn.Name() == "Group"):
			return c.prefixOf(sel.X, depth+1)
		}
	}
	return "", true
}

// objectPrefix is a router object's prefix: from its mounts when it has any,
// else from its definitions; all of them must agree.
func (c *collector) objectPrefix(obj types.Object, depth int) (string, bool) {
	p := c.prefixes
	if r := p.cache[obj]; r != nil {
		if !r.done {
			return "", false // a cycle
		}
		return r.prefix, r.ok
	}
	r := &prefixResult{}
	p.cache[obj] = r
	var values []string
	known := true
	if mounts := p.mounts[obj]; len(mounts) > 0 {
		for _, m := range mounts {
			if m.dynamic {
				known = false
				break
			}
			outer, ok := c.prefixOf(m.recv, depth+1)
			if !ok {
				known = false
				break
			}
			values = append(values, joinPrefix(outer, m.path))
		}
	} else {
		for _, def := range p.defs[obj] {
			v, ok := c.prefixOf(def, depth+1)
			if !ok {
				known = false
				break
			}
			values = append(values, v)
		}
	}
	prefix := ""
	if known && len(values) > 0 {
		prefix = values[0]
		for _, v := range values[1:] {
			if v != prefix {
				known = false
				break
			}
		}
	}
	if !known {
		prefix = ""
	}
	r.prefix, r.ok, r.done = prefix, known, true
	return prefix, known
}

// joinPrefix joins two route parts with one "/" between them and a leading
// "/"; "" when both are empty.
func joinPrefix(a, b string) string {
	var parts []string
	for _, part := range []string{a, b} {
		if trimmed := strings.Trim(part, "/"); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	joined := "/" + strings.Join(parts, "/")
	for strings.Contains(joined, "//") {
		joined = strings.ReplaceAll(joined, "//", "/")
	}
	return joined
}

// prefixed is path joined to the receiver's prefix; the path as written when
// the prefix is empty or unknown.
func (c *collector) prefixed(recv ast.Expr, path string) string {
	prefix, ok := c.prefixOf(recv, 0)
	if !ok || prefix == "" {
		return path
	}
	return joinPrefix(prefix, path)
}
