// Package load wraps golang.org/x/tools/go/packages with the configuration
// needed by ctxo-go-analyzer: full type info, ASTs, dependency closure, and
// go.work-aware module resolution.
package load

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/packages"
)

// Mode requests every field the analyzer needs from go/packages: name, files,
// syntax trees, type-checker output, and the imported-package closure. It is
// expensive but unavoidable for type-aware edge resolution.
const Mode = packages.NeedName |
	packages.NeedFiles |
	packages.NeedCompiledGoFiles |
	packages.NeedImports |
	packages.NeedDeps |
	packages.NeedTypes |
	packages.NeedTypesInfo |
	packages.NeedSyntax |
	packages.NeedTypesSizes |
	packages.NeedModule

// skippedDirs are filesystem entries we never descend into during subdir
// fallback. vendor and node_modules avoid double-loading deps; hidden
// directories tend to be tooling state, not source.
var skippedDirs = map[string]bool{
	"vendor":       true,
	".git":         true,
	".ctxo":        true,
	"node_modules": true,
	"testdata":     true,
}

// LoadResult bundles the loaded package set with any non-fatal errors so the
// caller can decide whether to surface them as warnings.
type LoadResult struct {
	Packages []*packages.Package
	// Errors are package-level Errors collected from a Visit traversal.
	// Returned for visibility — the loader does not fail the run on these.
	Errors []packages.Error
	// FatalError is set when packages.Load returned a top-level error (e.g.,
	// module-graph conflict). The caller may still get partial Packages.
	FatalError error
	// FallbackUsed is true when the root pattern failed and per-subdir
	// recovery was used to gather whatever packages still loaded cleanly.
	FallbackUsed bool
}

// Packages loads "./..." rooted at dir. Patterns can override the default
// for tests that want to scope analysis to a single sub-package.
//
// Failure mode: returns a LoadResult (possibly with empty Packages) and
// sets FatalError. The caller should surface the error but continue —
// degraded analysis beats no analysis when consumers have a flaky module.
func Packages(dir string, patterns ...string) *LoadResult {
	if len(patterns) == 0 {
		patterns = []string{"./..."}
	}

	cfg := &packages.Config{
		Mode:  Mode,
		Dir:   dir,
		Tests: false,
		// GOFLAGS=-mod=mod lets `go list` automatically add missing module
		// entries (matches what `go build` does) instead of failing with
		// "go: updates to go.mod needed; to update it: go mod tidy".
		// Users get analysis without being forced to run `go mod tidy` first;
		// go.mod/go.sum may gain entries — same side effect as a normal build.
		// `-e` keeps loading even when individual packages have type errors.
		Env: append(os.Environ(), "GOFLAGS=-mod=mod -e"),
	}

	pkgs, err := packages.Load(cfg, patterns...)
	res := &LoadResult{Packages: pkgs}
	if err != nil {
		res.FatalError = fmt.Errorf("load: %w", err)
	}

	packages.Visit(pkgs, nil, func(p *packages.Package) {
		res.Errors = append(res.Errors, p.Errors...)
	})
	return res
}

// PackagesWithFallback tries to load the whole module first; if that yields
// zero packages (typical when the module graph has a fatal conflict), it
// walks top-level subdirectories and loads each independently. Subdirs that
// transitively avoid the conflicting imports still produce full type info.
func PackagesWithFallback(dir string) *LoadResult {
	primary := Packages(dir)
	if len(primary.Packages) > 0 {
		return primary
	}

	subdirs := topLevelGoSubdirs(dir)
	if len(subdirs) == 0 {
		return primary
	}

	merged := &LoadResult{
		FatalError:   primary.FatalError,
		FallbackUsed: true,
	}
	for _, sub := range subdirs {
		pattern := "./" + filepath.ToSlash(sub) + "/..."
		subRes := Packages(dir, pattern)
		if len(subRes.Packages) == 0 {
			continue
		}
		merged.Packages = append(merged.Packages, subRes.Packages...)
		merged.Errors = append(merged.Errors, subRes.Errors...)
	}
	return merged
}

// topLevelGoSubdirs returns immediate subdirectories of root that contain at
// least one .go file (recursively). Skips vendor, .git, hidden dirs, etc.
func topLevelGoSubdirs(root string) []string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if skippedDirs[name] || strings.HasPrefix(name, ".") {
			continue
		}
		if hasGoFile(filepath.Join(root, name)) {
			out = append(out, name)
		}
	}
	return out
}

func hasGoFile(dir string) bool {
	found := false
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && skippedDirs[d.Name()] {
			return fs.SkipDir
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), ".go") {
			found = true
			return fs.SkipAll
		}
		return nil
	})
	return found
}
