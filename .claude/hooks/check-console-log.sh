#!/bin/bash
# PostToolUse hook: Block console.log in src/ files
# MCP stdio transport uses stdout for JSON-RPC — console.log corrupts the protocol.
# Only console.error is allowed.

data=$(cat)
file_path=$(echo "$data" | jq -r '.tool_input.file_path // .tool_input.content // empty' 2>/dev/null)

# Only check src/ TypeScript files
if [[ "$file_path" == */src/*.ts ]] || [[ "$file_path" == */src/*.tsx ]]; then
  if [[ -f "$file_path" ]] && grep -n 'console\.log' "$file_path" > /dev/null 2>&1; then
    echo "VIOLATION: console.log detected in $file_path"
    echo "MCP stdio uses stdout for JSON-RPC. Use console.error instead."
    grep -n 'console\.log' "$file_path" 2>/dev/null
    exit 2
  fi
fi

exit 0
