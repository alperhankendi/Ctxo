#!/bin/bash
# PostToolUse hook: Enforce hexagonal architecture boundaries
# - core/ NEVER imports from adapters/
# - core/ NEVER imports from ports/
# - ports/ NEVER imports from adapters/

data=$(cat)
file_path=$(echo "$data" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$file_path" ]] || [[ ! -f "$file_path" ]]; then
  exit 0
fi

# Check core/ files — must not import from adapters/ or ports/
if [[ "$file_path" == */src/core/* ]]; then
  if grep -nE "from ['\"].*adapters/" "$file_path" > /dev/null 2>&1; then
    echo "ARCHITECTURE VIOLATION: core/ must NEVER import from adapters/"
    echo "File: $file_path"
    grep -nE "from ['\"].*adapters/" "$file_path" 2>/dev/null
    exit 2
  fi
fi

# Check ports/ files — must not import from adapters/
if [[ "$file_path" == */src/ports/* ]]; then
  if grep -nE "from ['\"].*adapters/" "$file_path" > /dev/null 2>&1; then
    echo "ARCHITECTURE VIOLATION: ports/ must NEVER import from adapters/"
    echo "File: $file_path"
    grep -nE "from ['\"].*adapters/" "$file_path" 2>/dev/null
    exit 2
  fi
fi

exit 0
