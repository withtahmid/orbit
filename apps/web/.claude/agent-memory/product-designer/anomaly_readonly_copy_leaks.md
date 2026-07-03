---
name: anomaly-readonly-copy-leaks
description: On redesigned pages, isOwner gating covers buttons/drag but descriptive copy strings that name edit verbs are the commonly-missed leak
metadata:
  type: feedback
---

Recurring anomaly on redesigned space pages: `isOwner` gating reliably covers interactive affordances (buttons, drag handles, save bars, tips), but a **descriptive paragraph** that enumerates edit verbs is the spot that leaks capability to viewers/editors.

**Concrete instance:** `pages/space/categories/CategoriesPage.tsx` inspector empty-state sub (line ~780): "Pick one to rename it, restyle it, change its priority, envelope, or parent — or create a new one." Not wrapped in `isOwner` while everything around it is. Non-owner sees it first thing in the right pane on desktop (`.ct-inspector-empty` is hidden on mobile but shown desktop).

**Why:** Read-only parity for editors/viewers is a stated review axis; copy that promises edit powers they lack is a small but real trust/clarity break.
**How to apply:** When auditing any redesigned page for non-owner gating, don't stop at buttons — read every empty-state / helper / placeholder string and ask "does this name an action a viewer can't take?" Gate the string too, or write a read-only variant. Verify against a concrete non-owner walk of the page's zero-selection state.
