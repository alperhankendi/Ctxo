// Package facts collects syntactic evidence for code facts (PR 4, issue
// #156): comparisons with a literal in conditions and case labels, calls that
// match a normalization pattern, retry and timeout bindings, time.Duration
// values, and net/http, gin, echo and chi routes (with group and mount
// prefixes). It only reports evidence; the
// TypeScript side's shared finisher applies the fact rules (trivial literals,
// canonical numbers, text normalization) and decides what becomes a fact, so
// nothing here formats numbers. Calls and routes are type-resolved.
package facts

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/constant"
	"go/printer"
	"go/token"
	"go/types"
	"os"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/tools/go/packages"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/symbols"
)

// MaxEvidencePerFile is the most evidence records collected for one file, so
// a generated file cannot flood the stream; the finisher keeps at most 500
// facts per file in any case.
const MaxEvidencePerFile = 2000

// Options are the fact detector options the analyzer needs, decoded from
// --facts=<base64>.
type Options struct {
	NormalizationMethods []string
}

// Decode reads the --facts value: standard base64 of the UTF-8 JSON
// {"normalizationMethods":[...]} (other keys are ignored). Any other input
// is an error.
func Decode(base64Value string) (*Options, error) {
	if base64Value == "" {
		return nil, errors.New("facts: empty value")
	}
	raw, err := base64.StdEncoding.DecodeString(base64Value)
	if err != nil {
		return nil, fmt.Errorf("facts: not base64: %w", err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("facts: not a JSON object: %w", err)
	}
	list, ok := doc["normalizationMethods"]
	if !ok || bytes.Equal(bytes.TrimSpace(list), []byte("null")) {
		return nil, errors.New("facts: normalizationMethods missing")
	}
	var methods []string
	if err := json.Unmarshal(list, &methods); err != nil {
		return nil, fmt.Errorf("facts: normalizationMethods is not a list of strings: %w", err)
	}
	if methods == nil {
		methods = []string{}
	}
	return &Options{NormalizationMethods: methods}, nil
}

// retryTimeoutFragments are the FC-5 name fragments.
var retryTimeoutFragments = []string{"retry", "retries", "attempt", "timeout", "delay", "backoff", "ttl", "expir"}

func isUpper(c byte) bool { return c >= 'A' && c <= 'Z' }
func isLower(c byte) bool { return c >= 'a' && c <= 'z' }
func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// nameTokens splits a name into lower-cased ASCII tokens like the shared
// rule's /[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|\d+/g: only A-Z, a-z and 0-9
// form tokens, every other byte (including every byte of a non-ASCII rune)
// separates them.
func nameTokens(name string) []string {
	var tokens []string
	for i := 0; i < len(name); {
		c := name[i]
		j := i + 1
		switch {
		case isUpper(c):
			for j < len(name) && isUpper(name[j]) {
				j++
			}
			if j < len(name) && isLower(name[j]) {
				if j-i > 1 {
					j-- // the last capital starts the next word
				} else {
					for j < len(name) && isLower(name[j]) {
						j++
					}
				}
			}
		case isLower(c):
			for j < len(name) && isLower(name[j]) {
				j++
			}
		case isDigit(c):
			for j < len(name) && isDigit(name[j]) {
				j++
			}
		default:
			i++
			continue
		}
		tokens = append(tokens, asciiLower(name[i:j]))
		i = j
	}
	return tokens
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if isUpper(c) {
			b[i] = c + ('a' - 'A')
		}
	}
	return string(b)
}

// HasRetryTimeoutFragment is FC-5: a fragment matches when the name's tokens,
// joined from the start of some token, begin with it.
func HasRetryTimeoutFragment(name string) bool {
	tokens := nameTokens(name)
	for i := range tokens {
		rest := strings.Join(tokens[i:], "")
		for _, f := range retryTimeoutFragments {
			if strings.HasPrefix(rest, f) {
				return true
			}
		}
	}
	return false
}

// MatchesPattern is FC-4: Name matches exactly, Name* by prefix
// (case-sensitive), and q.Name[*] only when the call is written q.Name(...).
// qualifier is the receiver's source, "" for a call without one.
func MatchesPattern(method, qualifier string, patterns []string) bool {
	for _, p := range patterns {
		name := p
		if dot := strings.IndexByte(p, '.'); dot >= 0 {
			if p[:dot] != qualifier || qualifier == "" {
				continue
			}
			name = p[dot+1:]
		}
		if strings.HasSuffix(name, "*") {
			if strings.HasPrefix(method, name[:len(name)-1]) {
				return true
			}
		} else if method == name {
			return true
		}
	}
	return false
}

// durationUnits maps the time package's unit constants to fact units.
var durationUnits = map[string]string{
	"Nanosecond": "ns", "Microsecond": "us", "Millisecond": "ms",
	"Second": "s", "Minute": "min", "Hour": "h",
}

// ginVerbs maps gin RouterGroup methods with a path first argument to verbs.
var ginVerbs = map[string]string{
	"GET": "GET", "POST": "POST", "PUT": "PUT", "DELETE": "DELETE",
	"PATCH": "PATCH", "HEAD": "HEAD", "OPTIONS": "OPTIONS", "Any": "ANY",
}

const ginPath = "github.com/gin-gonic/gin"

// ginReceivers are the gin types whose route methods count: the RouterGroup
// struct (and Engine through embedding) and the IRoutes and IRouter
// interfaces (an interface method's receiver is the interface declaring it).
var ginReceivers = map[string]bool{"RouterGroup": true, "IRoutes": true, "IRouter": true}

// readSource returns the bytes of the file the AST was parsed from, or nil
// when they cannot be read or do not match the parsed file's size.
func readSource(fset *token.FileSet, file *ast.File) []byte {
	tf := fset.File(file.Pos())
	if tf == nil {
		return nil
	}
	src, err := os.ReadFile(tf.Name())
	if err != nil || len(src) != tf.Size() {
		return nil
	}
	return src
}

// CollectFile is Collect plus the hex SHA-256 of the exact bytes the
// collector read, so a reader can tell whether the evidence belongs to a
// given source. The hash is "" when the bytes could not be read or their size
// differs from the parsed file's (the file changed after parsing).
func CollectFile(pkg *packages.Package, file *ast.File, relFile string, opts Options) ([]emit.FactEvidence, string) {
	if pkg == nil || pkg.TypesInfo == nil || pkg.Fset == nil || file == nil {
		return nil, ""
	}
	src := readSource(pkg.Fset, file)
	out := collect(pkg, file, relFile, opts, src)
	if src == nil {
		return out, ""
	}
	sum := sha256.Sum256(src)
	return out, hex.EncodeToString(sum[:])
}

type collector struct {
	info     *types.Info
	fset     *token.FileSet
	tf       *token.File
	src      []byte
	opts     Options
	out      []emit.FactEvidence
	consumed map[ast.Node]bool // duration expressions already reported as bound values
	steps    int               // duration products evaluated (the B-M2 test counts them)

	durations map[*ast.BinaryExpr]*durationMatch // durationMatch results, nil for no match
	prefixes  *prefixes                          // router groups and mounts of the file (prefixes.go)
	path      []ast.Node                         // the nodes from the inspect root to the current node (FC-4b)
}

// Collect walks every function declaration body of file (closures belong to
// the declaration) and every package-level const and var value (attributed to
// that variable), and returns the file's evidence sorted by line, then kind,
// then text, at most MaxEvidencePerFile records.
func Collect(pkg *packages.Package, file *ast.File, relFile string, opts Options) []emit.FactEvidence {
	out, _ := CollectFile(pkg, file, relFile, opts)
	return out
}

func collect(pkg *packages.Package, file *ast.File, relFile string, opts Options, src []byte) []emit.FactEvidence {
	return newCollector(pkg, file, opts, src).run(file, relFile)
}

func newCollector(pkg *packages.Package, file *ast.File, opts Options, src []byte) *collector {
	return &collector{
		info:      pkg.TypesInfo,
		fset:      pkg.Fset,
		tf:        pkg.Fset.File(file.Pos()),
		src:       src,
		opts:      opts,
		consumed:  map[ast.Node]bool{},
		durations: map[*ast.BinaryExpr]*durationMatch{},
	}
}

func (c *collector) run(file *ast.File, relFile string) []emit.FactEvidence {
	c.collectPrefixes(file)
	for _, decl := range file.Decls {
		switch d := decl.(type) {
		case *ast.FuncDecl:
			if d.Body == nil || d.Name == nil {
				continue
			}
			c.inspect(d.Body, symbols.FuncDeclSymbolID(relFile, d))
		case *ast.GenDecl:
			if d.Tok != token.CONST && d.Tok != token.VAR {
				continue
			}
			for _, spec := range d.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				owner := func(i int) string {
					if i < len(vs.Names) && vs.Names[i].Name != "_" {
						return symbols.SymbolID(relFile, vs.Names[i].Name, "variable")
					}
					return ""
				}
				for i, value := range vs.Values {
					sid := owner(i)
					if len(vs.Values) != len(vs.Names) {
						sid = owner(0)
					} else {
						c.binding(vs.Names[i], vs.Names[i].Name, value, sid)
					}
					c.inspect(value, sid)
				}
			}
		}
	}
	sort.SliceStable(c.out, func(i, j int) bool {
		a, b := c.out[i], c.out[j]
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return a.Text < b.Text
	})
	return c.out
}

func (c *collector) add(sid string, pos token.Pos, e emit.FactEvidence) {
	if len(c.out) >= MaxEvidencePerFile {
		return
	}
	e.SymbolID = sid
	e.Line = c.fset.Position(pos).Line - 1
	c.out = append(c.out, e)
}

// text is the node's source, or its printed form when the source is not
// available.
func (c *collector) text(n ast.Node) string {
	if c.src != nil && c.tf != nil {
		start, end := c.tf.Offset(n.Pos()), c.tf.Offset(n.End())
		if start >= 0 && end <= len(c.src) && start <= end {
			return string(c.src[start:end])
		}
	}
	var buf bytes.Buffer
	_ = printer.Fprint(&buf, c.fset, n)
	return buf.String()
}

func (c *collector) inspect(root ast.Node, sid string) {
	c.path = c.path[:0]
	ast.Inspect(root, func(n ast.Node) bool {
		if n == nil {
			c.path = c.path[:len(c.path)-1]
			return true
		}
		c.path = append(c.path, n)
		switch x := n.(type) {
		case *ast.IfStmt:
			c.condition(x.Cond, sid)
		case *ast.ForStmt:
			if x.Cond != nil {
				c.condition(x.Cond, sid)
			}
		case *ast.SwitchStmt:
			c.switchCases(x, sid)
		case *ast.CallExpr:
			c.call(x, sid)
		case *ast.ValueSpec:
			if len(x.Values) == len(x.Names) {
				for i, v := range x.Values {
					c.binding(x.Names[i], x.Names[i].Name, v, sid)
				}
			}
		case *ast.AssignStmt:
			if (x.Tok == token.ASSIGN || x.Tok == token.DEFINE) && len(x.Lhs) == len(x.Rhs) {
				for i, lhs := range x.Lhs {
					if name := assignedName(lhs); name != "" {
						c.binding(lhs, name, x.Rhs[i], sid)
					}
				}
			}
		case *ast.KeyValueExpr:
			if key, ok := x.Key.(*ast.Ident); ok {
				if field, ok := c.info.Uses[key].(*types.Var); ok && field.IsField() {
					c.binding(key, key.Name, x.Value, sid)
				}
			}
		case *ast.BinaryExpr:
			if !c.consumed[x] {
				if d, nested, ok := c.duration(x); ok {
					c.consume(nested)
					c.add(sid, x.Pos(), d)
				}
			}
		}
		return true
	})
}

func assignedName(lhs ast.Expr) string {
	switch x := lhs.(type) {
	case *ast.Ident:
		if x.Name != "_" {
			return x.Name
		}
	case *ast.SelectorExpr:
		return x.Sel.Name
	}
	return ""
}

func unparen(e ast.Expr) ast.Expr {
	for {
		p, ok := e.(*ast.ParenExpr)
		if !ok {
			return e
		}
		e = p.X
	}
}

// condition reports the comparisons of a condition, through &&, ||, ! and
// parentheses.
func (c *collector) condition(e ast.Expr, sid string) {
	switch x := e.(type) {
	case *ast.ParenExpr:
		c.condition(x.X, sid)
	case *ast.UnaryExpr:
		if x.Op == token.NOT {
			c.condition(x.X, sid)
		}
	case *ast.BinaryExpr:
		switch x.Op {
		case token.LAND, token.LOR:
			c.condition(x.X, sid)
			c.condition(x.Y, sid)
		case token.EQL, token.NEQ, token.LSS, token.LEQ, token.GTR, token.GEQ:
			left, right := c.literalKind(x.X), c.literalKind(x.Y)
			if (left == "") == (right == "") {
				return
			}
			literal, kind := x.X, left
			if left == "" {
				literal, kind = x.Y, right
			}
			c.add(sid, x.Pos(), emit.FactEvidence{
				Kind: "comparison", Text: c.text(x), Operator: x.Op.String(),
				Literal: c.text(literal), LiteralKind: kind,
			})
		}
	}
}

// switchCases reports a tagless switch's case expressions as conditions and
// a tagged switch's literal case values as "<tag> case <value>".
func (c *collector) switchCases(s *ast.SwitchStmt, sid string) {
	if s.Body == nil {
		return
	}
	subject := ""
	if s.Tag != nil {
		subject = c.text(s.Tag)
	}
	for _, stmt := range s.Body.List {
		clause, ok := stmt.(*ast.CaseClause)
		if !ok {
			continue
		}
		for _, value := range clause.List {
			if s.Tag == nil {
				c.condition(value, sid)
				continue
			}
			kind := c.literalKind(value)
			if kind == "" {
				continue
			}
			c.add(sid, value.Pos(), emit.FactEvidence{
				Kind: "comparison", Text: subject + " case " + c.text(value), Operator: "case",
				Literal: c.text(value), LiteralKind: kind,
			})
		}
	}
}

// literalKind is the literal kind of an operand: number (optionally signed),
// string, char, and nil, true and false when they resolve to the universe.
func (c *collector) literalKind(e ast.Expr) string {
	switch x := e.(type) {
	case *ast.BasicLit:
		switch x.Kind {
		case token.INT, token.FLOAT:
			return "number"
		case token.CHAR:
			return "char"
		case token.STRING:
			return "string"
		}
	case *ast.UnaryExpr:
		if lit, ok := x.X.(*ast.BasicLit); ok && (x.Op == token.SUB || x.Op == token.ADD) &&
			(lit.Kind == token.INT || lit.Kind == token.FLOAT) {
			return "number"
		}
	case *ast.Ident:
		obj := c.info.Uses[x]
		if obj == nil || obj.Parent() != types.Universe {
			return ""
		}
		switch obj.(type) {
		case *types.Nil:
			return "null"
		case *types.Const:
			if x.Name == "true" || x.Name == "false" {
				return "boolean"
			}
		}
	}
	return ""
}

// binding reports a bound value: a time.Duration value as a named duration,
// any other value only when the name has a retry or timeout fragment.
// consume marks duration products that an enclosing report already covers.
func (c *collector) consume(nodes []ast.Node) {
	for _, n := range nodes {
		c.consumed[n] = true
	}
}

func (c *collector) binding(at ast.Node, name string, value ast.Expr, sid string) {
	inner := unparen(value)
	if d, nested, ok := c.duration(inner); ok {
		c.consume(append(nested, inner))
		d.Name = name
		c.add(sid, inner.Pos(), d)
		return
	}
	if unit, constName, ok := c.timeConst(inner); ok {
		c.add(sid, inner.Pos(), emit.FactEvidence{
			Kind: "duration", Text: c.text(inner), Name: name,
			Constructor: "time." + constName, Unit: unit, Amount: "1",
		})
		return
	}
	if !HasRetryTimeoutFragment(name) {
		return
	}
	v := c.text(value)
	c.add(sid, at.Pos(), emit.FactEvidence{Kind: "binding", Text: name + " = " + v, Name: name, Value: v})
}

// timeConst resolves a time.<Unit> constant (through any import name).
func (c *collector) timeConst(e ast.Expr) (unit, name string, ok bool) {
	sel, isSel := unparen(e).(*ast.SelectorExpr)
	if !isSel {
		return "", "", false
	}
	k, isConst := c.info.Uses[sel.Sel].(*types.Const)
	if !isConst || k.Pkg() == nil || k.Pkg().Path() != "time" {
		return "", "", false
	}
	unit, ok = durationUnits[k.Name()]
	return unit, k.Name(), ok
}

// duration matches n * time.<Unit> and time.Duration(n) * time.<Unit> (either
// order); the amount is the source of n.
//
// A chain such as 2 * time.Second * 3 or 4 * (time.Minute * 15) is one
// duration: its amount multiplies the parts, "(2) * (3)", and the returned
// nodes are the nested duration products, which the caller must not report
// again.
func (c *collector) duration(e ast.Expr) (emit.FactEvidence, []ast.Node, bool) {
	m := c.durationMatch(e)
	if m == nil {
		return emit.FactEvidence{}, nil, false
	}
	// Walk down the chain once for the nested products and the factors.
	var nested []ast.Node
	var rests []ast.Expr
	base := m
	for base.side != nil {
		nested = append(nested, base.side)
		rests = append(rests, base.rest)
		base = c.durationMatch(base.side)
	}
	// amount(k) = "(" + amount(k-1) + ") * (" + rest(k) + ")", unrolled:
	// k opening parentheses, the base amount, then ") * (rest)" from the
	// innermost product outwards.
	var amount strings.Builder
	amount.WriteString(strings.Repeat("(", len(rests)))
	amount.WriteString(c.text(c.amountOf(base.other)))
	for i := len(rests) - 1; i >= 0; i-- {
		amount.WriteString(") * (")
		amount.WriteString(c.text(c.amountOf(rests[i])))
		amount.WriteString(")")
	}
	for i, j := 0, len(nested)-1; i < j; i, j = i+1, j-1 {
		nested[i], nested[j] = nested[j], nested[i]
	}
	return emit.FactEvidence{
		Kind: "duration", Text: c.text(e), Constructor: "time." + base.name, Unit: base.unit, Amount: amount.String(),
	}, nested, true
}

// durationMatch is a matched duration product: a base (other * time.<Unit>)
// or a chain step (side is a matched product, rest the factor).
type durationMatch struct {
	unit, name string
	other      ast.Expr
	side, rest ast.Expr
}

// durationMatch is the match of duration for e, memoised per product, so a
// chain of n products costs O(n) over the whole file (B-M2); nil when e is not
// a duration product.
func (c *collector) durationMatch(e ast.Expr) *durationMatch {
	bin, ok := e.(*ast.BinaryExpr)
	if !ok || bin.Op != token.MUL {
		return nil
	}
	if m, seen := c.durations[bin]; seen {
		return m
	}
	c.steps++
	m := c.combineDuration(bin)
	c.durations[bin] = m
	return m
}

func (c *collector) combineDuration(bin *ast.BinaryExpr) *durationMatch {
	other := bin.Y
	unit, name, isConst := c.timeConst(bin.X)
	if !isConst {
		other = bin.X
		unit, name, isConst = c.timeConst(bin.Y)
	}
	if isConst {
		if _, _, both := c.timeConst(other); both {
			return nil
		}
		return &durationMatch{unit: unit, name: name, other: other}
	}
	for _, pair := range [][2]ast.Expr{{bin.X, bin.Y}, {bin.Y, bin.X}} {
		side, rest := unparen(pair[0]), pair[1]
		inner := c.durationMatch(side)
		if inner == nil {
			continue
		}
		if _, _, isUnit := c.timeConst(rest); isUnit {
			return nil
		}
		if c.durationMatch(unparen(rest)) != nil {
			return nil
		}
		return &durationMatch{unit: inner.unit, name: inner.name, side: side, rest: rest}
	}
	return nil
}

// amountOf unwraps time.Duration(n) to n.
func (c *collector) amountOf(e ast.Expr) ast.Expr {
	amount := unparen(e)
	if call, ok := amount.(*ast.CallExpr); ok && len(call.Args) == 1 && c.isDurationType(call.Fun) {
		return call.Args[0]
	}
	return amount
}

func (c *collector) isDurationType(fun ast.Expr) bool {
	var id *ast.Ident
	switch f := unparen(fun).(type) {
	case *ast.SelectorExpr:
		id = f.Sel
	case *ast.Ident:
		id = f
	default:
		return false
	}
	tn, ok := c.info.Uses[id].(*types.TypeName)
	return ok && tn.Pkg() != nil && tn.Pkg().Path() == "time" && tn.Name() == "Duration"
}

// call reports x.m(...) calls matching a normalization pattern and routes.
func (c *collector) call(call *ast.CallExpr, sid string) {
	sel, ok := unparen(call.Fun).(*ast.SelectorExpr)
	if !ok {
		return
	}
	method, qualifier := sel.Sel.Name, c.text(sel.X)
	if MatchesPattern(method, qualifier, c.opts.NormalizationMethods) {
		consumer, consumerTypes, inProse := c.destination()
		c.add(sid, call.Pos(), emit.FactEvidence{
			Kind: "call", Text: c.text(call), Method: method, Qualifier: qualifier,
			Consumer: consumer, ConsumerTypes: consumerTypes, InProse: inProse,
		})
	}
	if verb, route, ok := c.route(call, sel); ok {
		c.add(sid, call.Pos(), emit.FactEvidence{Kind: "route", Text: c.text(call), Verb: verb, Route: route})
	}
}

// destination (FC-4b) reads where the current call's value goes, from the
// inspect path: up to the statement or spec and never out of a function
// literal, the nearest call that takes it as an argument (its callee, and the
// types consumerTypes names), and whether on the way the value is an operand of
// a + chain with a string literal whose value holds ASCII whitespace. The
// syntax tier reads the same places.
func (c *collector) destination() (string, []string, bool) {
	inProse := false
	for i := len(c.path) - 2; i >= 0; i-- {
		node, parent := c.path[i+1], c.path[i]
		switch p := parent.(type) {
		case ast.Stmt, ast.Spec, ast.Decl, *ast.FuncLit:
			return "", nil, inProse
		case *ast.CallExpr:
			for _, arg := range p.Args {
				if arg == node {
					return strings.Join(strings.Fields(c.text(p.Fun)), " "), c.consumerTypes(p), inProse
				}
			}
		case *ast.BinaryExpr:
			if p.Op == token.ADD {
				for _, operand := range concatOperands(p, nil) {
					if isProse(operand) {
						inProse = true
					}
				}
			}
		}
	}
	return "", nil, inProse
}

// consumerTypes names what the consumer's receiver resolves to: the package
// path of a package function ("log", "fmt", "log/slog"), else the receiver's
// named type and the type declaring the method, as "<package path>.<name>"
// (pointers dropped). Nil when nothing resolves.
func (c *collector) consumerTypes(call *ast.CallExpr) []string {
	sel, ok := unparen(call.Fun).(*ast.SelectorExpr)
	if !ok || c.info == nil {
		return nil
	}
	var out []string
	add := func(name string) {
		for _, seen := range out {
			if seen == name {
				return
			}
		}
		out = append(out, name)
	}
	if id, ok := unparen(sel.X).(*ast.Ident); ok {
		if pkg, ok := c.info.Uses[id].(*types.PkgName); ok {
			return []string{pkg.Imported().Path()}
		}
	}
	if name := namedTypeName(c.info.TypeOf(sel.X)); name != "" {
		add(name)
	}
	if fn, ok := c.info.Uses[sel.Sel].(*types.Func); ok {
		if sig, ok := fn.Type().(*types.Signature); ok && sig.Recv() != nil {
			if name := namedTypeName(sig.Recv().Type()); name != "" {
				add(name)
			}
		}
	}
	return out
}

// namedTypeName is "<package path>.<name>" of a (pointer to a) named type, or "".
func namedTypeName(t types.Type) string {
	if t == nil {
		return ""
	}
	if ptr, ok := t.(*types.Pointer); ok {
		t = ptr.Elem()
	}
	named, ok := t.(*types.Named)
	if !ok || named.Obj() == nil || named.Obj().Pkg() == nil {
		return ""
	}
	return named.Obj().Pkg().Path() + "." + named.Obj().Name()
}

// concatOperands flattens a + chain through nested + (not through parentheses).
func concatOperands(e ast.Expr, out []ast.Expr) []ast.Expr {
	if bin, ok := e.(*ast.BinaryExpr); ok && bin.Op == token.ADD {
		return concatOperands(bin.Y, concatOperands(bin.X, out))
	}
	return append(out, e)
}

// isProse reports a string literal whose value holds ASCII whitespace (space,
// tab, LF, CR, FF, VT), the one definition every tier uses.
func isProse(e ast.Expr) bool {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return false
	}
	value, err := strconv.Unquote(lit.Value)
	if err != nil {
		return false
	}
	return strings.ContainsAny(value, " \t\n\r\f\v")
}

// route resolves net/http.HandleFunc and Handle, (*net/http.ServeMux).HandleFunc
// and Handle, the gin RouterGroup verb methods, Any and Handle, the echo Echo
// and Group verb methods, Any and Add, and the chi Mux and Router verb
// methods, Handle, HandleFunc, Method and MethodFunc, with a constant string
// path. A gin, echo or chi route is joined to its receiver's group or mount
// prefix (prefixes.go).
func (c *collector) route(call *ast.CallExpr, sel *ast.SelectorExpr) (verb, route string, ok bool) {
	fn, recv, ok := c.method(sel)
	if !ok {
		return "", "", false
	}
	name := fn.Name()
	if fn.Pkg().Path() == "net/http" && (recv == "" || recv == "ServeMux") && (name == "HandleFunc" || name == "Handle") {
		pattern, isStr := c.constString(call, 0)
		if !isStr {
			return "", "", false
		}
		return httpPattern(pattern)
	}
	verbPath := func(v string, pathArg int) (string, string, bool) {
		path, isStr := c.constString(call, pathArg)
		if !isStr {
			return "", "", false
		}
		return v, c.prefixed(sel.X, path), true
	}
	methodPath := func() (string, string, bool) {
		method, isMethod := c.constString(call, 0)
		if !isMethod || method == "" {
			return "", "", false
		}
		return verbPath(method, 1)
	}
	switch framework(fn, recv) {
	case "gin":
		if v, known := ginVerbs[name]; known {
			return verbPath(v, 0)
		}
		if name == "Handle" {
			return methodPath()
		}
	case "echo":
		if v, known := echoVerbs[name]; known {
			return verbPath(v, 0)
		}
		if name == "Add" {
			return methodPath()
		}
	case "chi":
		// chi panics on a pattern without a leading "/", so requiring one loses no route.
		if v, known := chiVerbs[name]; known {
			if path, isStr := c.constString(call, 0); !isStr || !strings.HasPrefix(path, "/") {
				return "", "", false
			}
			return verbPath(v, 0)
		}
		switch name {
		case "Handle", "HandleFunc":
			pattern, isStr := c.constString(call, 0)
			if !isStr {
				return "", "", false
			}
			v, path, isPattern := httpPattern(pattern)
			if !isPattern {
				return "", "", false
			}
			return v, c.prefixed(sel.X, path), true
		case "Method", "MethodFunc":
			if path, isStr := c.constString(call, 1); !isStr || !strings.HasPrefix(path, "/") {
				return "", "", false
			}
			return methodPath()
		}
	}
	return "", "", false
}

// httpPattern splits a net/http pattern "[METHOD ][HOST]/[PATH]" into a verb
// (ANY without a method) and its path.
func httpPattern(pattern string) (verb, route string, ok bool) {
	verb, rest := "ANY", strings.TrimSpace(pattern)
	if i := strings.IndexAny(rest, " \t"); i >= 0 {
		verb, rest = rest[:i], strings.TrimLeft(rest[i:], " \t")
	}
	slash := strings.IndexByte(rest, '/')
	if slash < 0 {
		return "", "", false
	}
	return verb, rest[slash:], true
}

func (c *collector) constString(call *ast.CallExpr, i int) (string, bool) {
	if i >= len(call.Args) {
		return "", false
	}
	tv, ok := c.info.Types[call.Args[i]]
	if !ok || tv.Value == nil || tv.Value.Kind() != constant.String {
		return "", false
	}
	return constant.StringVal(tv.Value), true
}

func namedType(t types.Type) *types.Named {
	if p, ok := types.Unalias(t).(*types.Pointer); ok {
		t = p.Elem()
	}
	named, _ := types.Unalias(t).(*types.Named)
	return named
}
