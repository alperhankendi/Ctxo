package facts

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/load"
)

// lendingFixture is the shared sample module of the lang-go TypeScript tests.
var lendingFixture = filepath.Join("..", "..", "..", "..", "test-fixtures", "lending-module")

// ginStub is the stand-in for github.com/gin-gonic/gin, wired in through a
// replace directive so the tests never download anything.
var ginStub = map[string]string{
	"stubs/gin/go.mod": "module github.com/gin-gonic/gin\n\ngo 1.22\n",
	"stubs/gin/gin.go": `package gin

type HandlerFunc func()

type IRoutes interface {
	GET(string, ...HandlerFunc) IRoutes
	POST(string, ...HandlerFunc) IRoutes
	Any(string, ...HandlerFunc) IRoutes
	Handle(string, string, ...HandlerFunc) IRoutes
}

type IRouter interface {
	IRoutes
	Group(string) *RouterGroup
}

type RouterGroup struct{}

type Engine struct{ RouterGroup }

func (g *RouterGroup) GET(path string, handlers ...HandlerFunc) IRoutes    { return nil }
func (g *RouterGroup) POST(path string, handlers ...HandlerFunc) IRoutes   { return nil }
func (g *RouterGroup) PUT(path string, handlers ...HandlerFunc) IRoutes    { return nil }
func (g *RouterGroup) DELETE(path string, handlers ...HandlerFunc) IRoutes { return nil }
func (g *RouterGroup) Any(path string, handlers ...HandlerFunc) IRoutes    { return nil }
func (g *RouterGroup) Group(path string) *RouterGroup                      { return g }
func (g *RouterGroup) Handle(method, path string, handlers ...HandlerFunc) IRoutes {
	return nil
}
`,
}

const appGoMod = `module app

go 1.22

require github.com/gin-gonic/gin v1.0.0

replace github.com/gin-gonic/gin => ./stubs/gin
`

// defaultMethods is the spec 12.1 normalization list (the vectors' defaults).
var defaultMethods = []string{
	"ToLower*", "ToUpper*", "Trim*", "Normalize", "toLowerCase", "toUpperCase", "trim",
	"strings.ToLower", "strings.TrimSpace", "equalsIgnoreCase",
}

var defaultOptions = Options{NormalizationMethods: defaultMethods}

// writeFiles writes files under a new temp directory, LF line endings kept.
func writeFiles(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// copyFixture copies the lending module with CRLF turned into LF, so lines
// and texts do not depend on the checkout's line endings.
func copyFixture(t *testing.T) string {
	t.Helper()
	files := map[string]string{}
	err := filepath.WalkDir(lendingFixture, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(lendingFixture, path)
		if err != nil {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files[filepath.ToSlash(rel)] = strings.ReplaceAll(string(body), "\r\n", "\n")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return writeFiles(t, files)
}

// collectFile loads the module at dir (tests included) and runs Collect over
// the file rel of the first package that holds it.
func collectFile(t *testing.T, dir, rel string, opts Options) []emit.FactEvidence {
	t.Helper()
	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatalf("load: %v", res.FatalError)
	}
	for _, pkg := range res.Packages {
		for _, file := range pkg.Syntax {
			got, err := filepath.Rel(dir, pkg.Fset.File(file.Pos()).Name())
			if err != nil || filepath.ToSlash(got) != rel {
				continue
			}
			for _, e := range pkg.Errors {
				t.Fatalf("package error: %v", e)
			}
			return Collect(pkg, file, rel, opts)
		}
	}
	t.Fatalf("%s not loaded", rel)
	return nil
}

// collectApp writes app.go (with the gin stub next to it) and collects it.
func collectApp(t *testing.T, body string) []emit.FactEvidence {
	t.Helper()
	files := map[string]string{"go.mod": appGoMod, "app.go": body}
	for k, v := range ginStub {
		files[k] = v
	}
	return collectFile(t, writeFiles(t, files), "app.go", defaultOptions)
}

const factsFile = "loans/facts.go"

func id(name, kind string) string { return factsFile + "::" + name + "::" + kind }

func TestCollectReportsTheFixtureEvidence(t *testing.T) {
	got := collectFile(t, copyFixture(t), factsFile, defaultOptions)
	want := []emit.FactEvidence{
		{Kind: "binding", SymbolID: id("maxRetries", "variable"), Line: 10, Text: "maxRetries = 3", Name: "maxRetries", Value: "3"},
		{Kind: "duration", SymbolID: id("holdTimeout", "variable"), Line: 14, Text: "90 * time.Minute", Name: "holdTimeout", Constructor: "time.Minute", Unit: "min", Amount: "90"},
		{Kind: "comparison", SymbolID: id("MayBorrow", "function"), Line: 19, Text: "member == nil", Operator: "==", Literal: "nil", LiteralKind: "null"},
		{Kind: "comparison", SymbolID: id("MayBorrow", "function"), Line: 22, Text: `*member != ""`, Operator: "!=", Literal: `""`, LiteralKind: "string"},
		{Kind: "comparison", SymbolID: id("MayBorrow", "function"), Line: 22, Text: "openLoans >= 5", Operator: ">=", Literal: "5", LiteralKind: "number"},
		{Kind: "comparison", SymbolID: id("Fee", "function"), Line: 31, Text: `tier case "gold"`, Operator: "case", Literal: `"gold"`, LiteralKind: "string"},
		{Kind: "comparison", SymbolID: id("Fee", "function"), Line: 33, Text: `tier case ""`, Operator: "case", Literal: `""`, LiteralKind: "string"},
		{Kind: "call", SymbolID: id("Key", "function"), Line: 41, Text: "strings.ToLower(strings.TrimSpace(email))", Method: "ToLower", Qualifier: "strings"},
		{Kind: "call", SymbolID: id("Key", "function"), Line: 41, Text: "strings.TrimSpace(email)", Method: "TrimSpace", Qualifier: "strings", Consumer: "strings.ToLower", ConsumerTypes: []string{"strings"}},
		{Kind: "route", SymbolID: id("Routes", "function"), Line: 46, Text: `mux.HandleFunc("GET /holds/{id}", nil)`, Verb: "GET", Route: "/holds/{id}"},
		{Kind: "route", SymbolID: id("Routes", "function"), Line: 47, Text: `http.HandleFunc("/health", nil)`, Verb: "ANY", Route: "/health"},
		{Kind: "route", SymbolID: id("Routes", "function"), Line: 48, Text: `r.GET("/loans/:id", nil)`, Verb: "GET", Route: "/loans/:id"},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		t.Errorf("evidence of %s:\n%s", factsFile, gotJSON)
	}
}

func TestCollectIsEmptyForAFileWithoutEvidence(t *testing.T) {
	if got := collectFile(t, copyFixture(t), "loans/loan.go", defaultOptions); len(got) != 0 {
		t.Errorf("loan.go evidence: %+v", got)
	}
}

func TestNilIsANullLiteralAndStringsGiveNothing(t *testing.T) {
	got := collectApp(t, `package app

func Check(member *string, ok bool) bool {
	if member != nil && ok == true {
		return false
	}
	if nil == member {
		return false
	}
	return false
}

func Note() string {
	return "if x > 5 { timeout = 30 }"
}

func Raw() string {
	return `+"`strings.ToLower(x) == 5`"+`
}
`)
	want := []emit.FactEvidence{
		{Kind: "comparison", SymbolID: "app.go::Check::function", Line: 3, Text: "member != nil", Operator: "!=", Literal: "nil", LiteralKind: "null"},
		{Kind: "comparison", SymbolID: "app.go::Check::function", Line: 3, Text: "ok == true", Operator: "==", Literal: "true", LiteralKind: "boolean"},
		{Kind: "comparison", SymbolID: "app.go::Check::function", Line: 6, Text: "nil == member", Operator: "==", Literal: "nil", LiteralKind: "null"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
}

func TestShadowedNilAndTrueAreNotLiterals(t *testing.T) {
	got := collectApp(t, `package app

func Shadow(x int) bool {
	nil := 3
	true := 4
	if x == nil || x == true {
		return false
	}
	return true == 4
}
`)
	if len(got) != 0 {
		t.Errorf("shadowed identifiers gave evidence: %+v", got)
	}
}

func TestClosuresBelongToTheEnclosingFunction(t *testing.T) {
	got := collectApp(t, `package app

type Desk struct{}

var handler = func(n int) bool { return n > 7 && n != 9 }

func (d *Desk) Renew(days int) {
	check := func() bool {
		if days > 14 {
			return false
		}
		return true
	}
	_ = check
}
`)
	want := []emit.FactEvidence{
		{Kind: "comparison", SymbolID: "app.go::Desk.Renew::method", Line: 8, Text: "days > 14", Operator: ">", Literal: "14", LiteralKind: "number"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
}

func TestPackageLevelValuesUseVariableIDs(t *testing.T) {
	got := collectApp(t, `package app

import "time"

const (
	retryLimit, lateFee = 4, 2
	_                   = 1
)

var renewalBackoff = time.Second

var checker = func(n int) bool {
	if n >= 10 {
		return true
	}
	return false
}
`)
	want := []emit.FactEvidence{
		{Kind: "binding", SymbolID: "app.go::retryLimit::variable", Line: 5, Text: "retryLimit = 4", Name: "retryLimit", Value: "4"},
		{Kind: "duration", SymbolID: "app.go::renewalBackoff::variable", Line: 9, Text: "time.Second", Name: "renewalBackoff", Constructor: "time.Second", Unit: "s", Amount: "1"},
		{Kind: "comparison", SymbolID: "app.go::checker::variable", Line: 12, Text: "n >= 10", Operator: ">=", Literal: "10", LiteralKind: "number"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v", got)
	}
}

func TestConditionsCasesBindingsAndDurations(t *testing.T) {
	got := collectApp(t, `package app

import (
	"strings"
	t "time"
)

type Policy struct {
	RetryCount int
	Window     t.Duration
}

func Rules(n int, code rune, tier string) Policy {
	for i := 0; i < 3; i++ {
	}
	if !(n == -1) {
	}
	switch {
	case n > 100, tier == "x":
	}
	switch code {
	case 'a', 'b':
	case rune(n):
	}
	maxAttempts := 5
	var renewTimeout = t.Duration(30) * t.Second
	t.Sleep(2 * t.Millisecond)
	p := Policy{RetryCount: 2, Window: 48 * t.Hour}
	p.RetryCount = 7
	_ = strings.ToUpper(tier)
	_ = strings.Repeat(tier, 2)
	_ = maxAttempts
	_ = renewTimeout
	return p
}
`)
	r := "app.go::Rules::function"
	want := []emit.FactEvidence{
		{Kind: "comparison", SymbolID: r, Line: 13, Text: "i < 3", Operator: "<", Literal: "3", LiteralKind: "number"},
		{Kind: "comparison", SymbolID: r, Line: 15, Text: "n == -1", Operator: "==", Literal: "-1", LiteralKind: "number"},
		{Kind: "comparison", SymbolID: r, Line: 18, Text: "n > 100", Operator: ">", Literal: "100", LiteralKind: "number"},
		{Kind: "comparison", SymbolID: r, Line: 18, Text: `tier == "x"`, Operator: "==", Literal: `"x"`, LiteralKind: "string"},
		{Kind: "comparison", SymbolID: r, Line: 21, Text: "code case 'a'", Operator: "case", Literal: "'a'", LiteralKind: "char"},
		{Kind: "comparison", SymbolID: r, Line: 21, Text: "code case 'b'", Operator: "case", Literal: "'b'", LiteralKind: "char"},
		{Kind: "binding", SymbolID: r, Line: 24, Text: "maxAttempts = 5", Name: "maxAttempts", Value: "5"},
		{Kind: "duration", SymbolID: r, Line: 25, Text: "t.Duration(30) * t.Second", Name: "renewTimeout", Constructor: "time.Second", Unit: "s", Amount: "30"},
		{Kind: "duration", SymbolID: r, Line: 26, Text: "2 * t.Millisecond", Constructor: "time.Millisecond", Unit: "ms", Amount: "2"},
		{Kind: "binding", SymbolID: r, Line: 27, Text: "RetryCount = 2", Name: "RetryCount", Value: "2"},
		{Kind: "duration", SymbolID: r, Line: 27, Text: "48 * t.Hour", Name: "Window", Constructor: "time.Hour", Unit: "h", Amount: "48"},
		{Kind: "binding", SymbolID: r, Line: 28, Text: "RetryCount = 7", Name: "RetryCount", Value: "7"},
		{Kind: "call", SymbolID: r, Line: 29, Text: "strings.ToUpper(tier)", Method: "ToUpper", Qualifier: "strings"},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		t.Errorf("got:\n%s", gotJSON)
	}
}

func TestRoutesResolveThroughTypes(t *testing.T) {
	got := collectApp(t, `package app

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

const holdsPath = "/holds"

type fakeMux struct{}

func (fakeMux) HandleFunc(p string, h func(http.ResponseWriter, *http.Request)) {}

func Register(mux *http.ServeMux, r *gin.Engine, g *gin.RouterGroup, f fakeMux, dynamic string) {
	mux.Handle("POST lending.example/renew/{id}", nil)
	http.Handle(holdsPath, nil)
	g.POST("/loans", nil)
	r.Any("/ping")
	r.Handle("delete", "/loans/:id", nil)
	r.Group("/v2").PUT("/members/:id", nil)
	f.HandleFunc("/fake", nil)
	r.GET(dynamic, nil)
	mux.HandleFunc("lending.example", nil)
}
`)
	reg := "app.go::Register::function"
	want := []emit.FactEvidence{
		{Kind: "route", SymbolID: reg, Line: 15, Text: `mux.Handle("POST lending.example/renew/{id}", nil)`, Verb: "POST", Route: "/renew/{id}"},
		{Kind: "route", SymbolID: reg, Line: 16, Text: "http.Handle(holdsPath, nil)", Verb: "ANY", Route: "/holds"},
		{Kind: "route", SymbolID: reg, Line: 17, Text: `g.POST("/loans", nil)`, Verb: "POST", Route: "/loans"},
		{Kind: "route", SymbolID: reg, Line: 18, Text: `r.Any("/ping")`, Verb: "ANY", Route: "/ping"},
		{Kind: "route", SymbolID: reg, Line: 19, Text: `r.Handle("delete", "/loans/:id", nil)`, Verb: "delete", Route: "/loans/:id"},
		{Kind: "route", SymbolID: reg, Line: 20, Text: `r.Group("/v2").PUT("/members/:id", nil)`, Verb: "PUT", Route: "/v2/members/:id"},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		t.Errorf("got:\n%s", gotJSON)
	}
}

func TestNormalizationCallsFollowTheOptions(t *testing.T) {
	body := `package app

import "strings"

type Email string

func (e Email) Normalize() string { return string(e) }

func Clean(e Email, s string) string {
	_ = e.Normalize()
	_ = strings.TrimLeft(s, " ")
	return strings.Title(s)
}
`
	files := map[string]string{"go.mod": appGoMod, "app.go": body}
	for k, v := range ginStub {
		files[k] = v
	}
	dir := writeFiles(t, files)
	methods := func(opts Options) []string {
		var out []string
		for _, e := range collectFile(t, dir, "app.go", opts) {
			out = append(out, e.Method)
		}
		return out
	}
	if got := methods(defaultOptions); !reflect.DeepEqual(got, []string{"Normalize", "TrimLeft"}) {
		t.Errorf("default patterns: %v", got)
	}
	if got := methods(Options{NormalizationMethods: []string{"strings.Title"}}); !reflect.DeepEqual(got, []string{"Title"}) {
		t.Errorf("custom patterns: %v", got)
	}
	if got := methods(Options{}); got != nil {
		t.Errorf("no patterns: %v", got)
	}
}

func TestNormalizationCallsReportWhereTheirValueGoes(t *testing.T) {
	body := `package app

import (
	"errors"
	"fmt"
	"log"
	"strings"
)

type Repo struct{}

func (r *Repo) Upsert(s string) string { return s }

type Auth struct{}

func (a *Auth) LogIn(s string) {}

func Save(email, name string, store map[string]string, repo *Repo, auth *Auth, sb *strings.Builder) error {
	store[strings.ToLower(email)] = strings.TrimSpace(name)
	log.Printf("unknown %s", strings.ToLower(email))
	log.Println("saved", repo.Upsert(strings.ToUpper(name)))
	auth.LogIn(strings.ToLower(email))
	sb.WriteString("Dear " + strings.TrimSpace(name))
	key := strings.TrimSpace(name) + " " + email
	if strings.TrimSpace(email) == "" {
		return errors.New(strings.ToUpper(email))
	}
	_ = key
	return fmt.Errorf("bad %s", strings.ToLower(strings.TrimSpace(name)))
}
`
	dir := writeFiles(t, map[string]string{"go.mod": appGoMod, "app.go": body})
	var got []string
	for _, e := range collectFile(t, dir, "app.go", defaultOptions) {
		if e.Kind != "call" {
			continue
		}
		got = append(got, fmt.Sprintf("%d %s | %s %v %v", e.Line, e.Text, e.Consumer, e.ConsumerTypes, e.InProse))
	}
	want := []string{
		"18 strings.ToLower(email) |  [] false",
		"18 strings.TrimSpace(name) |  [] false",
		"19 strings.ToLower(email) | log.Printf [log] false",
		"20 strings.ToUpper(name) | repo.Upsert [app.Repo] false",
		"21 strings.ToLower(email) | auth.LogIn [app.Auth] false",
		"22 strings.TrimSpace(name) | sb.WriteString [strings.Builder] true",
		"23 strings.TrimSpace(name) |  [] true",
		"24 strings.TrimSpace(email) |  [] false",
		"25 strings.ToUpper(email) | errors.New [errors] false",
		"28 strings.ToLower(strings.TrimSpace(name)) | fmt.Errorf [fmt] false",
		"28 strings.TrimSpace(name) | strings.ToLower [strings] false",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("evidence:\n got %q\nwant %q", got, want)
	}
}

func TestRoutesThroughGinInterfaces(t *testing.T) {
	got := collectApp(t, `package app

import "github.com/gin-gonic/gin"

func Register(r gin.IRouter, routes gin.IRoutes) {
	r.GET("/loans/:id", nil)
	r.Group("/v2").POST("/holds", nil)
	routes.Any("/ping")
	routes.Handle("PATCH", "/members/:id", nil)
}
`)
	reg := "app.go::Register::function"
	want := []emit.FactEvidence{
		{Kind: "route", SymbolID: reg, Line: 5, Text: `r.GET("/loans/:id", nil)`, Verb: "GET", Route: "/loans/:id"},
		{Kind: "route", SymbolID: reg, Line: 6, Text: `r.Group("/v2").POST("/holds", nil)`, Verb: "POST", Route: "/v2/holds"},
		{Kind: "route", SymbolID: reg, Line: 7, Text: `routes.Any("/ping")`, Verb: "ANY", Route: "/ping"},
		{Kind: "route", SymbolID: reg, Line: 8, Text: `routes.Handle("PATCH", "/members/:id", nil)`, Verb: "PATCH", Route: "/members/:id"},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		t.Errorf("got:\n%s", gotJSON)
	}
}

func TestChainedDurationsAreReportedOnce(t *testing.T) {
	got := collectApp(t, `package app

import "time"

func Wait() {
	time.Sleep(2 * time.Second * 3)
	var graceTimeout = 4 * (time.Minute * 15)
	_ = graceTimeout
}
`)
	w := "app.go::Wait::function"
	want := []emit.FactEvidence{
		{Kind: "duration", SymbolID: w, Line: 5, Text: "2 * time.Second * 3", Constructor: "time.Second", Unit: "s", Amount: "(2) * (3)"},
		{Kind: "duration", SymbolID: w, Line: 6, Text: "4 * (time.Minute * 15)", Name: "graceTimeout", Constructor: "time.Minute", Unit: "min", Amount: "(15) * (4)"},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		t.Errorf("got:\n%s", gotJSON)
	}
}

// collectorRun loads app.go with body and runs a collector over it, returning
// the collector (for its step count) and the evidence.
func collectorRun(t *testing.T, body string) (*collector, []emit.FactEvidence) {
	t.Helper()
	dir := writeFiles(t, map[string]string{"go.mod": "module app\n\ngo 1.22\n", "app.go": body})
	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatalf("load: %v", res.FatalError)
	}
	for _, pkg := range res.Packages {
		for _, e := range pkg.Errors {
			t.Fatalf("package error: %v", e)
		}
		for _, file := range pkg.Syntax {
			c := newCollector(pkg, file, defaultOptions, readSource(pkg.Fset, file))
			return c, c.run(file, "app.go")
		}
	}
	t.Fatal("app.go not loaded")
	return nil, nil
}

// B-M2: every product in a chain used to re-walk the whole chain below it
// (quadratic); each product is now evaluated once.
func TestProductChainsAreEvaluatedOncePerProduct(t *testing.T) {
	const n = 10000
	terms := make([]string, n)
	for i := range terms {
		terms[i] = "x"
	}
	c, got := collectorRun(t, "package app\n\nimport \"time\"\n\nfunc F(x int) {\n\ty := "+strings.Join(terms, " * ")+
		"\n\t_ = y\n\tif x == 5 {\n\t}\n\tw := 2 * time.Second"+strings.Repeat(" * 1", 50)+" * 3\n\t_ = w\n}\n")
	if limit := 2 * n; c.steps > limit {
		t.Errorf("duration steps: %d, want at most %d", c.steps, limit)
	}
	f := "app.go::F::function"
	want := []emit.FactEvidence{
		{Kind: "comparison", SymbolID: f, Line: 7, Text: "x == 5", Operator: "==", Literal: "5", LiteralKind: "number"},
		{Kind: "duration", SymbolID: f, Line: 9, Text: "2 * time.Second" + strings.Repeat(" * 1", 50) + " * 3", Name: "w",
			Constructor: "time.Second", Unit: "s", Amount: strings.Repeat("(", 51) + "2" + strings.Repeat(") * (1)", 50) + ") * (3)"},
	}
	if !reflect.DeepEqual(got, want) {
		gotJSON, _ := json.MarshalIndent(got, "", "  ")
		t.Errorf("got:\n%s", gotJSON)
	}
}

func TestSourceHashIsOfTheBytesTheCollectorRead(t *testing.T) {
	files := map[string]string{"go.mod": appGoMod, "app.go": "package app\n\nfunc F(n int) {\n\tif n > 7 {\n\t}\n}\n"}
	for k, v := range ginStub {
		files[k] = v
	}
	dir := writeFiles(t, files)
	res := load.Packages(dir)
	if res.FatalError != nil {
		t.Fatal(res.FatalError)
	}
	for _, pkg := range res.Packages {
		if pkg.PkgPath != "app" {
			continue
		}
		file := pkg.Syntax[0]
		evidence, hash := CollectFile(pkg, file, "app.go", defaultOptions)
		sum := sha256.Sum256([]byte(files["app.go"]))
		if hash != hex.EncodeToString(sum[:]) || len(evidence) != 1 {
			t.Errorf("hash %q, evidence %+v", hash, evidence)
		}
		// The file changed size after parsing: its bytes are not the parsed ones, so there is no hash.
		if err := os.WriteFile(filepath.Join(dir, "app.go"), []byte(files["app.go"]+"// later\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		evidence, hash = CollectFile(pkg, file, "app.go", defaultOptions)
		if hash != "" {
			t.Errorf("a changed file must have no hash, got %q", hash)
		}
		if len(evidence) != 1 || evidence[0].Text != "n > 7" {
			t.Errorf("evidence falls back to printed text: %+v", evidence)
		}
		return
	}
	t.Fatal("package app not loaded")
}

func TestEvidenceIsCappedPerFile(t *testing.T) {
	var b strings.Builder
	b.WriteString("package app\n\nfunc Many(n int) {\n")
	for i := 0; i < MaxEvidencePerFile+50; i++ {
		b.WriteString("\tif n == 42 {\n\t}\n")
	}
	b.WriteString("}\n")
	if got := collectApp(t, b.String()); len(got) != MaxEvidencePerFile {
		t.Errorf("got %d records, want %d", len(got), MaxEvidencePerFile)
	}
}

// vectors is the part of packages/plugin-api/conformance/fact-vectors.json the
// analyzer prefilters use.
type vectors struct {
	Defaults struct {
		NormalizationMethods []string `json:"normalizationMethods"`
	} `json:"defaults"`
	HasRetryTimeoutFragment []struct {
		Input    string `json:"input"`
		Expected bool   `json:"expected"`
	} `json:"hasRetryTimeoutFragment"`
	MatchesNormalizationPattern []struct {
		Input struct {
			Method    string  `json:"method"`
			Qualifier *string `json:"qualifier"`
		} `json:"input"`
		Expected bool `json:"expected"`
	} `json:"matchesNormalizationPattern"`
	MatchesNormalizationPatternCustom []struct {
		Input struct {
			Method    string   `json:"method"`
			Qualifier *string  `json:"qualifier"`
			Patterns  []string `json:"patterns"`
		} `json:"input"`
		Expected bool `json:"expected"`
	} `json:"matchesNormalizationPatternCustom"`
}

// readVectors walks up from the working directory to the vectors file.
func readVectors(t *testing.T) vectors {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		path := filepath.Join(dir, "packages", "plugin-api", "conformance", "fact-vectors.json")
		if body, err := os.ReadFile(path); err == nil {
			var v vectors
			if err := json.Unmarshal(body, &v); err != nil {
				t.Fatal(err)
			}
			return v
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("fact-vectors.json not found above the working directory")
		}
		dir = parent
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func TestFragmentsAndPatternsFollowTheVectors(t *testing.T) {
	v := readVectors(t)
	if len(v.HasRetryTimeoutFragment) == 0 || len(v.MatchesNormalizationPattern) == 0 || len(v.MatchesNormalizationPatternCustom) == 0 {
		t.Fatal("vector categories are empty")
	}
	if !reflect.DeepEqual(v.Defaults.NormalizationMethods, defaultMethods) {
		t.Errorf("defaults differ from the test's list: %v", v.Defaults.NormalizationMethods)
	}
	for _, c := range v.HasRetryTimeoutFragment {
		if got := HasRetryTimeoutFragment(c.Input); got != c.Expected {
			t.Errorf("HasRetryTimeoutFragment(%q) = %v, want %v", c.Input, got, c.Expected)
		}
	}
	for _, c := range v.MatchesNormalizationPattern {
		if got := MatchesPattern(c.Input.Method, deref(c.Input.Qualifier), v.Defaults.NormalizationMethods); got != c.Expected {
			t.Errorf("MatchesPattern(%q, %q) with defaults = %v, want %v", c.Input.Method, deref(c.Input.Qualifier), got, c.Expected)
		}
	}
	for _, c := range v.MatchesNormalizationPatternCustom {
		if got := MatchesPattern(c.Input.Method, deref(c.Input.Qualifier), c.Input.Patterns); got != c.Expected {
			t.Errorf("MatchesPattern(%q, %q, %v) = %v, want %v", c.Input.Method, deref(c.Input.Qualifier), c.Input.Patterns, got, c.Expected)
		}
	}
}

func TestDecodeReadsTheNormalizationMethods(t *testing.T) {
	value := base64.StdEncoding.EncodeToString([]byte(`{"normalizationMethods":["strings.ToLower","Trim*"],"extra":1}`))
	opts, err := Decode(value)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(opts.NormalizationMethods, []string{"strings.ToLower", "Trim*"}) {
		t.Errorf("got %+v", opts)
	}
	empty, err := Decode(base64.StdEncoding.EncodeToString([]byte(`{"normalizationMethods":[]}`)))
	if err != nil || empty == nil || len(empty.NormalizationMethods) != 0 {
		t.Errorf("empty list: %+v, %v", empty, err)
	}
}

func TestDecodeRejectsBadInput(t *testing.T) {
	enc := func(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }
	for name, value := range map[string]string{
		"empty":           "",
		"not base64":      "%%%",
		"not JSON":        enc("nope"),
		"not an object":   enc(`["ToLower"]`),
		"missing methods": enc(`{}`),
		"null methods":    enc(`{"normalizationMethods":null}`),
		"not a list":      enc(`{"normalizationMethods":"ToLower"}`),
		"not strings":     enc(`{"normalizationMethods":["ToLower",3]}`),
	} {
		if opts, err := Decode(value); err == nil || opts != nil {
			t.Errorf("%s: Decode(%q) = %+v, %v; want an error", name, value, opts, err)
		}
	}
}
