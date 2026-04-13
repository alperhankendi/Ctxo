// ctxo-go-analyzer is the full-tier Go analysis binary bundled inside the
// @ctxo/lang-go npm package. It loads a module via golang.org/x/tools/go/packages,
// walks ASTs with full type info, and emits JSONL describing symbols, edges,
// and reachability on stdout.
//
// The TypeScript composite adapter in packages/lang-go/src/analyzer/ spawns
// this binary in batch mode per index run.
package main

import (
	"flag"
	"fmt"
	"go/ast"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"golang.org/x/tools/go/packages"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/edges"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/implements"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/load"
	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/symbols"
)

const version = "0.8.0-alpha.0"

func main() {
	root := flag.String("root", "", "module root to analyze (required)")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	if *root == "" {
		fmt.Fprintln(os.Stderr, "ctxo-go-analyzer: --root is required")
		os.Exit(2)
	}

	if err := run(*root, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "ctxo-go-analyzer:", err)
		os.Exit(1)
	}
}

type fileAggregate struct {
	symbols []emit.Symbol
	edges   []emit.Edge
}

func run(root string, stdout *os.File) error {
	w := emit.NewWriter(stdout)
	start := time.Now()

	if err := w.Progress(fmt.Sprintf("analyzer v%s loading %s", version, root)); err != nil {
		return err
	}

	res, err := load.Packages(root)
	if err != nil {
		return fmt.Errorf("load packages: %w", err)
	}
	if len(res.Errors) > 0 {
		_ = w.Progress(fmt.Sprintf("load reported %d package-level errors (continuing)", len(res.Errors)))
	}

	byFile := make(map[string]*fileAggregate)
	get := func(rel string) *fileAggregate {
		if agg, ok := byFile[rel]; ok {
			return agg
		}
		agg := &fileAggregate{}
		byFile[rel] = agg
		return agg
	}

	for _, pkg := range res.Packages {
		for _, fs := range symbols.Extract(pkg, root) {
			get(fs.RelPath).symbols = append(get(fs.RelPath).symbols, fs.Symbols...)
		}
	}

	ext := edges.NewExtractor(root, res.Packages)
	for _, pkg := range res.Packages {
		for _, file := range pkg.Syntax {
			rel := relativeFile(pkg, file, root)
			if rel == "" {
				continue
			}
			get(rel).edges = append(get(rel).edges, ext.Extract(pkg, file)...)
		}
	}

	for rel, implEdges := range implements.Extract(root, res.Packages) {
		get(rel).edges = append(get(rel).edges, implEdges...)
	}

	paths := make([]string, 0, len(byFile))
	for p := range byFile {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		agg := byFile[p]
		if err := w.File(emit.FileRecord{
			File:    p,
			Symbols: agg.symbols,
			Edges:   agg.edges,
		}); err != nil {
			return err
		}
	}

	return w.Summary(emit.Summary{
		TotalFiles: len(paths),
		Elapsed:    time.Since(start).String(),
	})
}

func relativeFile(pkg *packages.Package, file *ast.File, root string) string {
	if pkg.Fset == nil {
		return ""
	}
	tf := pkg.Fset.File(file.Pos())
	if tf == nil {
		return ""
	}
	rel, err := filepath.Rel(root, tf.Name())
	if err != nil || strings.HasPrefix(rel, "..") {
		return ""
	}
	return filepath.ToSlash(rel)
}
