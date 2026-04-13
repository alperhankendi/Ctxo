package emit

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestWriterEmitsJSONLWithTypeTag(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)

	if err := w.Progress("hello"); err != nil {
		t.Fatalf("Progress: %v", err)
	}
	if err := w.File(FileRecord{File: "pkg/foo.go"}); err != nil {
		t.Fatalf("File: %v", err)
	}
	if err := w.Project(ProjectRecord{}); err != nil {
		t.Fatalf("Project: %v", err)
	}
	if err := w.Summary(Summary{TotalFiles: 1, Elapsed: "1ms"}); err != nil {
		t.Fatalf("Summary: %v", err)
	}

	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("got %d lines, want 4: %q", len(lines), buf.String())
	}

	wantTypes := []string{"progress", "file", "projectGraph", "summary"}
	for i, line := range lines {
		var parsed map[string]any
		if err := json.Unmarshal([]byte(line), &parsed); err != nil {
			t.Fatalf("line %d not JSON: %v (%q)", i, err, line)
		}
		if parsed["type"] != wantTypes[i] {
			t.Errorf("line %d type=%v want %s", i, parsed["type"], wantTypes[i])
		}
	}
}

func TestFileRecordDefaultsEmptySlices(t *testing.T) {
	var buf bytes.Buffer
	w := NewWriter(&buf)
	if err := w.File(FileRecord{File: "x.go"}); err != nil {
		t.Fatal(err)
	}
	_ = w.Flush()

	var parsed map[string]any
	if err := json.Unmarshal([]byte(strings.TrimRight(buf.String(), "\n")), &parsed); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"symbols", "edges", "complexity"} {
		arr, ok := parsed[key].([]any)
		if !ok {
			t.Errorf("%s not a JSON array: %T", key, parsed[key])
			continue
		}
		if len(arr) != 0 {
			t.Errorf("%s got %d items, want 0", key, len(arr))
		}
	}
}

func TestEdgeTypeArgsOmitEmpty(t *testing.T) {
	b, err := json.Marshal(Edge{From: "a", To: "b", Kind: "calls"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "typeArgs") {
		t.Errorf("expected typeArgs omitted, got %s", b)
	}

	b2, err := json.Marshal(Edge{From: "a", To: "b", Kind: "uses", TypeArgs: []string{"int"}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b2), `"typeArgs":["int"]`) {
		t.Errorf("expected typeArgs present, got %s", b2)
	}
}
