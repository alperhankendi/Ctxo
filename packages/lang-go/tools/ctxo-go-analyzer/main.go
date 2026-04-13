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
	"os"
	"time"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
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
		// Non-fatal — surface as progress so the TS side can log.
		_ = w.Progress(fmt.Sprintf("load reported %d package-level errors (continuing)", len(res.Errors)))
	}

	totalFiles := 0
	for _, pkg := range res.Packages {
		for _, fs := range symbols.Extract(pkg, root) {
			if err := w.File(emit.FileRecord{
				File:    fs.RelPath,
				Symbols: fs.Symbols,
			}); err != nil {
				return err
			}
			totalFiles++
		}
	}

	return w.Summary(emit.Summary{
		TotalFiles: totalFiles,
		Elapsed:    time.Since(start).String(),
	})
}
