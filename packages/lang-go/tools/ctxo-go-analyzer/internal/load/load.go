// Package load wraps golang.org/x/tools/go/packages with the configuration
// needed by ctxo-go-analyzer: full type info, ASTs, dependency closure, and
// go.work-aware module resolution.
package load

import (
	"fmt"

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

// LoadResult bundles the loaded package set with any non-fatal errors so the
// caller can decide whether to surface them as warnings.
type LoadResult struct {
	Packages []*packages.Package
	// Errors are package-level Errors collected from packages.PrintErrors-style
	// traversal. Returned for visibility — the loader does not fail the run.
	Errors []packages.Error
}

// Packages loads "./..." rooted at dir. Patterns can override the default
// for tests that want to scope analysis to a single sub-package.
func Packages(dir string, patterns ...string) (*LoadResult, error) {
	if len(patterns) == 0 {
		patterns = []string{"./..."}
	}

	cfg := &packages.Config{
		Mode:  Mode,
		Dir:   dir,
		Tests: false,
	}

	pkgs, err := packages.Load(cfg, patterns...)
	if err != nil {
		return nil, fmt.Errorf("load: %w", err)
	}

	var errs []packages.Error
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		errs = append(errs, p.Errors...)
	})

	return &LoadResult{Packages: pkgs, Errors: errs}, nil
}
