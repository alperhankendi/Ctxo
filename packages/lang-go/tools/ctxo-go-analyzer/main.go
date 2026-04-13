// ctxo-go-analyzer is the full-tier Go analysis binary bundled inside the
// @ctxo/lang-go npm package. It accepts a module root on stdin/argv, uses
// go/packages + go/types + x/tools/go/ssa + callgraph/rta to produce
// semantic symbols and edges, and emits JSONL on stdout.
//
// This file currently implements the skeleton and argv plumbing. Successive
// commits fill in loader, symbols, edges, and reachability phases.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
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

func run(root string, stdout *os.File) error {
	w := emit.NewWriter(stdout)
	start := time.Now()

	if err := w.Progress(fmt.Sprintf("analyzer v%s starting on %s", version, root)); err != nil {
		return err
	}

	// Loader, symbol extraction, edge extraction, and reachability phases
	// land in subsequent commits. Skeleton emits a summary only so the
	// TypeScript spawn path can be exercised end-to-end today.
	totalFiles := 0

	return w.Summary(emit.Summary{
		TotalFiles: totalFiles,
		Elapsed:    time.Since(start).String(),
	})
}
