// Package symbols walks a loaded *packages.Package and produces emit.Symbol
// records grouped by source file. Maps Go declarations onto the kinds defined
// by @ctxo/plugin-api: function | class | interface | method | variable | type.
package symbols

import (
	"go/ast"
	"go/token"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"

	"github.com/alperhankendi/ctxo/tools/ctxo-go-analyzer/internal/emit"
)

// FileSymbols groups extracted symbols by the source file that declared them.
// RelPath is project-root-relative with forward-slash separators so it composes
// cleanly with the Ctxo symbol-id format on every platform.
type FileSymbols struct {
	RelPath string
	Symbols []emit.Symbol
}

// Extract walks every parsed file in the package and emits one Symbol per
// top-level declaration. Unexported names flow through; only the blank
// identifier "_" is skipped.
func Extract(pkg *packages.Package, rootDir string) []FileSymbols {
	if pkg == nil || pkg.Fset == nil {
		return nil
	}

	byFile := make(map[string]*FileSymbols)
	getOrCreate := func(rel string) *FileSymbols {
		if fs, ok := byFile[rel]; ok {
			return fs
		}
		fs := &FileSymbols{RelPath: rel}
		byFile[rel] = fs
		return fs
	}

	for _, file := range pkg.Syntax {
		rel := relativeFile(pkg.Fset, file, rootDir)
		if rel == "" {
			continue
		}
		fs := getOrCreate(rel)

		for _, decl := range file.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				if d.Name == nil || d.Name.Name == "_" {
					continue
				}
				kind := "function"
				name := d.Name.Name
				if d.Recv != nil && len(d.Recv.List) > 0 {
					recv := receiverTypeName(d.Recv.List[0].Type)
					if recv != "" {
						name = recv + "." + d.Name.Name
					}
					kind = "method"
				}
				fs.Symbols = append(fs.Symbols, makeSymbol(pkg.Fset, rel, name, kind, d.Pos(), d.End()))

			case *ast.GenDecl:
				switch d.Tok {
				case token.TYPE:
					for _, spec := range d.Specs {
						ts, ok := spec.(*ast.TypeSpec)
						if !ok || ts.Name == nil || ts.Name.Name == "_" {
							continue
						}
						kind := typeSpecKind(ts.Type)
						fs.Symbols = append(fs.Symbols, makeSymbol(pkg.Fset, rel, ts.Name.Name, kind, ts.Pos(), ts.End()))
					}
				case token.VAR, token.CONST:
					for _, spec := range d.Specs {
						vs, ok := spec.(*ast.ValueSpec)
						if !ok {
							continue
						}
						for _, n := range vs.Names {
							if n.Name == "_" {
								continue
							}
							fs.Symbols = append(fs.Symbols, makeSymbol(pkg.Fset, rel, n.Name, "variable", n.Pos(), n.End()))
						}
					}
				}
			}
		}
	}

	out := make([]FileSymbols, 0, len(byFile))
	for _, v := range byFile {
		sort.SliceStable(v.Symbols, func(i, j int) bool {
			return v.Symbols[i].StartLine < v.Symbols[j].StartLine
		})
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RelPath < out[j].RelPath })
	return out
}

// SymbolID composes the deterministic Ctxo symbol-id format.
func SymbolID(relFile, name, kind string) string {
	return relFile + "::" + name + "::" + kind
}

// receiverTypeName strips pointer indirection and generic instantiation from
// a method receiver, returning the bare type name. Returns empty when the
// expression cannot be reduced to a single identifier.
func receiverTypeName(expr ast.Expr) string {
	for {
		switch x := expr.(type) {
		case *ast.StarExpr:
			expr = x.X
		case *ast.IndexExpr: // generic with one type param: List[T]
			expr = x.X
		case *ast.IndexListExpr: // generic with multiple type params: Map[K, V]
			expr = x.X
		case *ast.Ident:
			return x.Name
		default:
			return ""
		}
	}
}

func typeSpecKind(expr ast.Expr) string {
	switch expr.(type) {
	case *ast.StructType:
		return "class"
	case *ast.InterfaceType:
		return "interface"
	default:
		return "type"
	}
}

func makeSymbol(fset *token.FileSet, rel, name, kind string, pos, end token.Pos) emit.Symbol {
	startPos := fset.Position(pos)
	endPos := fset.Position(end)
	startOffset := startPos.Offset
	endOffset := endPos.Offset
	return emit.Symbol{
		SymbolID:    SymbolID(rel, name, kind),
		Name:        name,
		Kind:        kind,
		StartLine:   startPos.Line,
		EndLine:     endPos.Line,
		StartOffset: &startOffset,
		EndOffset:   &endOffset,
	}
}

func relativeFile(fset *token.FileSet, file *ast.File, rootDir string) string {
	tf := fset.File(file.Pos())
	if tf == nil {
		return ""
	}
	abs := tf.Name()
	rel, err := filepath.Rel(rootDir, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		// Outside the module root (likely a stdlib or external dep) — skip.
		return ""
	}
	return filepath.ToSlash(rel)
}
