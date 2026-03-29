#!/bin/bash
# PreToolUse hook: Enforce kebab-case file naming in src/
# All .ts/.tsx files under src/ must be kebab-case (lowercase + hyphens only)

data=$(cat)
file_path=$(echo "$data" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$file_path" ]]; then
  exit 0
fi

# Only check src/ TypeScript files
if [[ "$file_path" == */src/*.ts ]] || [[ "$file_path" == */src/*.tsx ]]; then
  filename=$(basename "$file_path" | sed 's/\.\(ts\|tsx\)$//' | sed 's/\.test$//' | sed 's/\.spec$//')

  # Allow __tests__ directory
  if [[ "$file_path" == *"__tests__"* ]]; then
    # Strip .test/.spec suffix already done above
    true
  fi

  # Check kebab-case: only lowercase letters, digits, hyphens
  if [[ ! "$filename" =~ ^[a-z][a-z0-9-]*$ ]]; then
    echo "NAMING VIOLATION: File names in src/ must be kebab-case"
    echo "Got: $(basename "$file_path")"
    echo "Expected pattern: lowercase-with-hyphens.ts"
    exit 2
  fi
fi

exit 0
