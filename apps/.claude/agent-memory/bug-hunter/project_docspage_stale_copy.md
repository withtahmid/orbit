---
name: docspage-stale-copy
description: DocsPage.tsx duplicates product-behavior prose in many places; behavior changes leave stale copy behind
metadata:
  type: project
---

`apps/web/src/pages/DocsPage.tsx` describes the same product concept (e.g. "category
pre-fills the envelope") in multiple, separately-worded spots (card bodies, prose
paragraphs, FAQ answers). When a behavior change edits some of them, others get
missed and silently ship contradicting the new behavior.

**Why:** The category↔envelope decoupling (migration 050, branch
feat/category-enhanchment) removed category→envelope auto-fill everywhere in code
but left two DocsPage lines still claiming the category "pre-fills"/"suggests" the
envelope (lines ~311 and ~630 at the time).

**How to apply:** When reviewing any behavior change, don't trust the DocsPage diff.
`grep -n` DocsPage.tsx for the OLD concept/keywords across the whole file to catch
untouched stale copies, not just the lines that appear in `git diff`.
