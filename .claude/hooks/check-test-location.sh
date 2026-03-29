#!/bin/bash
# PreToolUse hook: Ensure test files are co-located in __tests__/ directories
# Tests must be in __tests__/ adjacent to source, not in a top-level test/ directory

data=$(cat)
file_path=$(echo "$data" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$file_path" ]]; then
  exit 0
fi

# Check if it's a test file
if [[ "$file_path" == *.test.ts ]] || [[ "$file_path" == *.spec.ts ]]; then
  # Must be inside a __tests__/ directory under src/
  if [[ "$file_path" != *"__tests__"* ]]; then
    echo "TEST LOCATION VIOLATION: Test files must be in __tests__/ directories"
    echo "Got: $file_path"
    echo "Expected: src/<module>/__tests__/<name>.test.ts"
    exit 2
  fi
fi

exit 0
