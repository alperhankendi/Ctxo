---
"@ctxo/lang-csharp": minor
---

C# route prefixes and test attributes by base type (Roslyn tier).

- Minimal API endpoint facts join their `MapGroup` prefixes: `var g = app.MapGroup("/api"); g.MapGet("/x", ...)` gives `GET /api/x`, nested and inline groups compose, and a group passed to a method or an extension method's `this` parameter (`app.MapGroup("/users").MapUsers()`) takes the prefix its call sites in the project agree on. Anything that does not resolve (a reassigned local, a group returned by a method, a non-constant prefix, call sites that disagree or none) keeps the call's own route.
- A controller without its own `[Route]` inherits the class route of its nearest base class with one, one or more levels up and in any file, with `[controller]` and `[action]` from the derived class and method. The helper reports it as a facts-only `inheritedRoute` on the class symbol, never as an annotation; the output without facts is unchanged.
- A project's own test attribute derived from one of the 11 known xUnit, NUnit and MSTest attributes (`[RetryFact]` from `Xunit.FactAttribute`, at any depth) is followed by an annotation of the nearest known base, for example `{ name: "Fact", named: { type: "Xunit.FactAttribute", via: "MyTests.RetryFactAttribute" } }`, so the host's name-based test detection recognises it without knowing the derived name. Look-alike names that derive from no test attribute get nothing.

The tree-sitter tier is unchanged (name-based, no prefixes). Run a full `ctxo index` after upgrading so every C# file picks up the new annotations.
