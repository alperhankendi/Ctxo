package facts

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
)

// echoStub and chiStub are stand-ins for github.com/labstack/echo/v4 and
// github.com/go-chi/chi/v5 with only the routing shapes the collector resolves.
var routerStubs = map[string]string{
	"stubs/echo/go.mod": "module github.com/labstack/echo/v4\n\ngo 1.22\n",
	"stubs/echo/echo.go": `package echo

type HandlerFunc func()

type Route struct{}

type Echo struct{}

type Group struct{}

func New() *Echo { return &Echo{} }

func (e *Echo) GET(path string, h HandlerFunc) *Route              { return nil }
func (e *Echo) POST(path string, h HandlerFunc) *Route             { return nil }
func (e *Echo) Any(path string, h HandlerFunc) []*Route            { return nil }
func (e *Echo) Add(method, path string, h HandlerFunc) *Route      { return nil }
func (e *Echo) Group(prefix string) *Group                         { return &Group{} }
func (g *Group) GET(path string, h HandlerFunc) *Route             { return nil }
func (g *Group) DELETE(path string, h HandlerFunc) *Route          { return nil }
func (g *Group) Group(prefix string) *Group                        { return g }
`,
	"stubs/chi/go.mod": "module github.com/go-chi/chi/v5\n\ngo 1.22\n",
	"stubs/chi/chi.go": `package chi

type HandlerFunc func()

type Router interface {
	Get(pattern string, h HandlerFunc)
	Post(pattern string, h HandlerFunc)
	Route(pattern string, fn func(r Router)) Router
	Group(fn func(r Router)) Router
	Mount(pattern string, h interface{})
	With(m ...func()) Router
	Method(method, pattern string, h HandlerFunc)
	HandleFunc(pattern string, h HandlerFunc)
}

type Mux struct{}

func NewRouter() *Mux { return &Mux{} }

func (m *Mux) Get(pattern string, h HandlerFunc)              {}
func (m *Mux) Post(pattern string, h HandlerFunc)             {}
func (m *Mux) Delete(pattern string, h HandlerFunc)           {}
func (m *Mux) Route(pattern string, fn func(r Router)) Router { return nil }
func (m *Mux) Group(fn func(r Router)) Router                 { return nil }
func (m *Mux) Mount(pattern string, h interface{})            {}
func (m *Mux) With(mw ...func()) Router                       { return nil }
func (m *Mux) Method(method, pattern string, h HandlerFunc)   {}
func (m *Mux) HandleFunc(pattern string, h HandlerFunc)       {}
`,
}

const routersGoMod = `module app

go 1.22

require (
	github.com/gin-gonic/gin v1.0.0
	github.com/labstack/echo/v4 v4.0.0
	github.com/go-chi/chi/v5 v5.0.0
)

replace (
	github.com/gin-gonic/gin => ./stubs/gin
	github.com/labstack/echo/v4 => ./stubs/echo
	github.com/go-chi/chi/v5 => ./stubs/chi
)
`

func collectRouters(t *testing.T, body string) []emit.FactEvidence {
	t.Helper()
	files := map[string]string{"go.mod": routersGoMod, "app.go": body}
	for k, v := range ginStub {
		files[k] = v
	}
	for k, v := range routerStubs {
		files[k] = v
	}
	return collectFile(t, writeFiles(t, files), "app.go", defaultOptions)
}

// routeTexts is "<line> <verb> <route>" per route record.
func routeTexts(got []emit.FactEvidence) []string {
	var out []string
	for _, e := range got {
		if e.Kind == "route" {
			out = append(out, fmt.Sprintf("%02d %s %s", e.Line, e.Verb, e.Route))
		}
	}
	return out
}

func expectRoutes(t *testing.T, got []emit.FactEvidence, want []string) {
	t.Helper()
	if texts := routeTexts(got); !reflect.DeepEqual(texts, want) {
		gotJSON, _ := json.MarshalIndent(texts, "", "  ")
		t.Errorf("routes:\n%s", gotJSON)
	}
}

func TestGinGroupsJoinTheirPrefix(t *testing.T) {
	got := collectRouters(t, `package app

import "github.com/gin-gonic/gin"

func Register(r *gin.Engine, param *gin.RouterGroup, dynamic string) {
	api := r.Group("/api")
	v1 := api.Group("v1/")
	v1.GET("/loans/:id", nil)
	api.POST("/holds", nil)
	param.GET("/param", nil)
	d := r.Group(dynamic)
	d.GET("/dyn", nil)
	nested := d.Group("/inner")
	nested.GET("/deep", nil)
	twice := r.Group("/a")
	twice = r.Group("/b")
	twice.GET("/t", nil)
	r.Group("/x").Group("/y").Handle("PATCH", "/z", nil)
}
`)
	expectRoutes(t, got, []string{
		"07 GET /api/v1/loans/:id",
		"08 POST /api/holds",
		"09 GET /param",
		"11 GET /dyn",
		"13 GET /deep",
		"16 GET /t",
		"17 PATCH /x/y/z",
	})
}

func TestEchoRoutesAndGroups(t *testing.T) {
	got := collectRouters(t, `package app

import "github.com/labstack/echo/v4"

func Register() {
	e := echo.New()
	e.GET("/health", nil)
	e.Any("/ping", nil)
	e.Add("PUT", "/members/:id", nil)
	g := e.Group("/api")
	g.GET("/loans/:id", nil)
	g.Group("/admin").DELETE("/users/:id", nil)
}
`)
	expectRoutes(t, got, []string{
		"06 GET /health",
		"07 ANY /ping",
		"08 PUT /members/:id",
		"10 GET /api/loans/:id",
		"11 DELETE /api/admin/users/:id",
	})
}

func TestChiRoutesRouteGroupAndMount(t *testing.T) {
	got := collectRouters(t, `package app

import "github.com/go-chi/chi/v5"

var admin = chi.NewRouter()

func Register(dynamic string) {
	r := chi.NewRouter()
	r.Get("/health", nil)
	r.Route("/api", func(r chi.Router) {
		r.Get("/loans/{id}", nil)
		r.Route("/v1", func(sub chi.Router) {
			sub.Post("/holds", nil)
		})
		r.Group(func(g chi.Router) {
			g.Method("PATCH", "/members/{id}", nil)
		})
		r.With().HandleFunc("/any", nil)
	})
	admin.Delete("/users/{id}", nil)
	r.Mount("/admin", admin)
	other := chi.NewRouter()
	other.Get("/x", nil)
	r.Mount(dynamic, other)
}
`)
	expectRoutes(t, got, []string{
		"08 GET /health",
		"10 GET /api/loans/{id}",
		"12 POST /api/v1/holds",
		"15 PATCH /api/members/{id}",
		"17 ANY /api/any",
		"19 DELETE /admin/users/{id}",
		"22 GET /x",
	})
}

func TestRouterMethodsOfOtherTypesGiveNothing(t *testing.T) {
	got := collectRouters(t, `package app

type cache struct{}

func (cache) Get(k string, v func()) {}
func (cache) GET(k string, v func()) {}
func (cache) Group(p string) cache { return cache{} }

func Register(c cache) {
	c.Get("/x", nil)
	c.Group("/api").GET("/y", nil)
}
`)
	expectRoutes(t, got, nil)
}
