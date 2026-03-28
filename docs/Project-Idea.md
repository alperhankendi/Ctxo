# 🚀 Ctxo (Context-Optimized MCP)

**Ctxo** is a **Logic-Slice** based Model Context Protocol (MCP) server designed to help AI agents understand complex codebases with the precision of a senior developer. 

Instead of just feeding raw lines of code, **Ctxo** delivers the code's **nervous system** (dependencies) and its **memory** (history) to the AI—slashing token costs and boosting success rates.

---

## 🎯 Purpose & Vision
Existing tools force AI to "brute-force" its way through massive files. **Ctxo** works like a surgical scalpel. Our mission is to clean the AI’s context window of unnecessary noise and eliminate hallucinations caused by missing types or disconnected functions.

---

## 🛠 Core Features

### 1. 🧩 Logic-Slice (The Engine)
When an AI requests a function or class, Ctxo doesn't just grab the lines. It automatically traces and packages all **type definitions (Interfaces/Types)** and **helper functions (Utils)** required for that code to run, even if they live in different files.

### 2. 🗺 Architectural Overlay (Project Map)
Instead of a flat file list, Ctxo provides the AI with a high-level architectural map. 
- *Example:* "This is the Domain layer; this is Infrastructure." This context helps the AI understand the project's philosophy before it even opens a file.

### 3. 📜 Why-Driven Context (Git History)
Ctxo attaches Git commit messages and PR summaries to specific code blocks. The AI learns not just **what** the code does, but **why** it was written that way (e.g., "This was changed last week to fix a security vulnerability").

### 4. 🔒 Privacy-First Masking
Automatic detection and masking of sensitive data like API keys, private IPs, and credentials before they ever reach the AI model.

---

## 📊 Competitor Analysis: Why Ctxo Wins

| Feature | Standard Tools (jCodeMunch, etc.) | **Ctxo (The Edge)** |
| :--- | :--- | :--- |
| **Context Style** | File or Symbol based (Flat) | **Logic-Based Slicing (Deep)** |
| **Dependency Tracking** | None (AI has to guess) | **Automatic (Via AST Analysis)** |
| **Token Efficiency** | Low (Sends redundant code) | **Maximum (Targeted context only)** |
| **Historical Data** | None | **Git Integration (Contextual History)** |
| **Architectural Awareness** | None | **Bird’s Eye View Mapping** |

---

## 💎 Killer Features

> **"One-Shot Context":** > No more "I don't see the definition for Type X" errors from the AI. Ctxo has already included it. This reduces back-and-forth "turns," saving time and money.

> **"Blind Spot Analysis":** > By generating a dependency graph, Ctxo warns the AI which files are "high-risk" (most dependencies), helping it predict side effects before making a change.

---

## 🏗 Tech Stack (Proposed)
* **Engine:** Node.js / TypeScript
* **Parser:** `Tree-sitter` (For multi-language AST support)
* **Protocol:** Model Context Protocol (MCP) SDK
* **VCS:** `Simple-git` (For commit mapping)

---

## 🚀 Success Metric
A senior developer takes ~10 minutes to gather context across multiple files. **Ctxo** aims to deliver that same context to an AI in under **500ms** with **minimal token usage**.