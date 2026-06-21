---
"@ctxo/cli": patch
---

Stop masking git commit hashes as AWS secrets. The AWS secret-access-key detector used a `(?=.*[/+])` lookahead to require a `/` or `+` inside the key, but `.*` reached past the 40-char token into the surrounding text, so any later `/` (for example a file path in a JSON response) satisfied it and a 40-char hex git SHA was redacted as `[REDACTED:AWS_SECRET]`. This corrupted the commit hashes returned by `get_why_context`. The lookahead is now scoped to the token itself (`[A-Za-z0-9=]*[/+]`), so hex-only SHAs are preserved while real base64 secret keys still redact.
