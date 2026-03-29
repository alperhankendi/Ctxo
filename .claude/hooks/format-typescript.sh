#!/bin/bash
# PostToolUse hook: Auto-format TypeScript files after edit
# Runs prettier + eslint if available (non-blocking if not installed yet)

data=$(cat)
file_path=$(echo "$data" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$file_path" ]] || [[ ! -f "$file_path" ]]; then
  exit 0
fi

# Only format .ts/.tsx files in src/
if [[ "$file_path" == *.ts ]] || [[ "$file_path" == *.tsx ]]; then
  # Try prettier first (skip silently if not installed)
  if command -v npx &> /dev/null && [[ -f "$CLAUDE_PROJECT_DIR/node_modules/.bin/prettier" ]]; then
    npx prettier --write "$file_path" 2>/dev/null || true
  fi

  # Then eslint fix (skip silently if not installed)
  if command -v npx &> /dev/null && [[ -f "$CLAUDE_PROJECT_DIR/node_modules/.bin/eslint" ]]; then
    npx eslint --fix "$file_path" 2>/dev/null || true
  fi
fi

exit 0
