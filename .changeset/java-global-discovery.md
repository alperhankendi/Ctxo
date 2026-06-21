---
"@ctxo/cli": patch
---

Discover the Java plugin in global installs. `@ctxo/lang-java` was missing from the CLI's plugin manifest (its `devDependencies`), which is the registry that global-mode plugin discovery walks when a project has no `@ctxo/lang-*` of its own. As a result `ctxo install java --global` installed the plugin but `ctxo index` never loaded it, silently skipping every Java file (only other detected languages were indexed). Adding `@ctxo/lang-java` to that list puts it on par with the Go, C#, and TypeScript plugins, so a globally installed Java plugin is found and the full tier engages.
