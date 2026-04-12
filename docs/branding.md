# Ctxo Branding Guide

## Color Palette - Ocean Teal

### Primary Colors

| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Accent** | `#0d9488` | 13, 148, 136 | Primary buttons, links, badges, active states |
| **Accent Light** | `#14b8a6` | 20, 184, 166 | Gradients (start), hover states |
| **Accent Gradient End** | `#0284c7` | 2, 132, 199 | Gradients (end), secondary emphasis |
| **Accent Background** | `#f0fdfa` | 240, 253, 250 | Badge backgrounds, light fills |
| **Accent Border** | `#99f6e4` | 153, 246, 228 | Subtle borders on accent elements |

### Neutral Colors

| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Page Background** | `#f8fafc` | 248, 250, 252 | Body background |
| **Surface** | `#ffffff` | 255, 255, 255 | Cards, panels, tables |
| **Surface Alt** | `#f8fafc` | 248, 250, 252 | Table headers, card internals |
| **Border** | `#e2e8f0` | 226, 232, 240 | Card borders, dividers |
| **Border Light** | `#f1f5f9` | 241, 245, 249 | Table row separators |

### Text Colors

| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Text Primary** | `#0f172a` | 15, 23, 42 | Headings, primary content |
| **Text Secondary** | `#64748b` | 100, 116, 139 | Body text, descriptions |
| **Text Light** | `#94a3b8` | 148, 163, 184 | Labels, meta text, placeholders |

### Semantic Colors

| Role | Hex | Background | Usage |
|------|-----|------------|-------|
| **Success / ctxo** | `#0d9488` | `#f0fdfa` | Positive deltas, ctxo results, improvements |
| **Warning / Manual** | `#ea580c` | `#fff7ed` | Manual approach, caution indicators |
| **Error / Missed** | `#dc2626` | `#fef2f2` | Missed items, compile errors, critical issues |
| **Info** | `#0284c7` | `#f0f9ff` | Informational callouts |

### Gradient

```css
/* Primary brand gradient - use for hero text, accent elements */
background: linear-gradient(135deg, #14b8a6, #0284c7);

/* Subtle gradient - use for page hero background fade */
background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
```

### Shadows

```css
/* Card shadow - default elevation */
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);

/* Subtle shadow - table, small elements */
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);

/* Large shadow - modals, overlays */
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
```

---

## Typography

| Element | Font | Weight | Size |
|---------|------|--------|------|
| H1 (hero) | Inter | 700 | 48px, letter-spacing: -0.03em |
| H2 (section) | Inter | 700 | 32px, letter-spacing: -0.02em |
| H3 (card) | Inter | 600 | 16px |
| Body | Inter | 400 | 14-16px, line-height: 1.6-1.7 |
| Eyebrow | Inter | 600 | 12px, uppercase, letter-spacing: 0.12em |
| Badge | Inter | 600 | 11-13px |
| Code | JetBrains Mono | 400-600 | 11-13px |
| Table header | Inter | 600 | 10-11px, uppercase, letter-spacing: 0.08em |

---

## Component Styles

### Cards

```css
background: #ffffff;
border-radius: 16px;
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
padding: 32-48px;
```

### Badges

```css
background: #f0fdfa;
color: #0d9488;
padding: 4px 12px;
border-radius: 100px;
font-size: 13px;
font-weight: 600;
```

### Tables

```css
/* Wrapper */
background: #ffffff;
border-radius: 16px;
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
overflow: hidden;

/* Header row */
background: #f8fafc;
border-bottom: 1px solid #e2e8f0;

/* Body rows */
border-bottom: 1px solid #f1f5f9;
```

### Verdict / Callout Card

```css
background: #ffffff;
border-radius: 16px;
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
padding: 36px;
border-left: 4px solid #0d9488;
```

### Tool Call Block (conversation mock)

```css
/* Tool call */
background: #f5f3ff;
border-left: 3px solid #a78bfa;
border-radius: 0 10px 10px 0;

/* Tool result */
background: #f0fdfa;
border-left: 3px solid #0d9488;
```

---

## Comparison Colors

When showing ctxo vs manual side-by-side:

| Element | ctxo | Manual |
|---------|------|--------|
| Dot / Indicator | `#0d9488` (teal) | `#ea580c` (orange) |
| Column header | `#0d9488` | `#ea580c` |
| Positive delta | `#0d9488` | - |
| Negative delta | - | `#dc2626` |
| Panel indicator | `#0d9488` (green dot) | `#ea580c` (orange dot) |

---

## Hero Message

> AI agents don't fail because they can't code. They fail because they code blind. Ctxo gives them the full picture before they write a single line.

---

## CSS Variables (copy-paste ready)

```css
:root {
  /* Backgrounds */
  --bg: #f8fafc;
  --white: #ffffff;

  /* Text */
  --text: #0f172a;
  --text-secondary: #64748b;
  --text-light: #94a3b8;

  /* Accent - Ocean Teal */
  --accent: #0d9488;
  --accent-light: #14b8a6;
  --accent-bg: #f0fdfa;
  --accent-border: #99f6e4;
  --accent-gradient: linear-gradient(135deg, #14b8a6, #0284c7);

  /* Semantic */
  --green: #0d9488;
  --green-bg: #f0fdfa;
  --orange: #ea580c;
  --orange-bg: #fff7ed;
  --red: #dc2626;
  --red-bg: #fef2f2;
  --info: #0284c7;
  --info-bg: #f0f9ff;

  /* Surfaces */
  --border: #e2e8f0;
  --border-light: #f1f5f9;
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04);
  --shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.08);
  --radius: 16px;
}
```
