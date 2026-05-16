---
description: 
---

# Build UI with SellUp Design System

## Purpose

Use this workflow whenever creating, redesigning, refining, or auditing any user interface within SellUp.

The goal is to ensure that every new screen, component, layout, modal, table, card, empty state, badge, or panel:

- follows the approved SellUp Design System,
- reuses existing components and tokens,
- preserves Light/Dark mode,
- avoids visual drift,
- and does not require repeating large design prompts in future tasks.

---

# Step 1 — Read the official visual source of truth

Before implementing any UI work, consult:

```text
docs/DESIGN_SYSTEM_FOUNDATION.md

Use it as the primary authority for:

visual principles,
tokens,
typography,
surfaces,
spacing,
radii,
shadows,
component patterns,
light/dark behavior,
rules for extending the system.

If needed, also review:

docs/UI_FOUNDATIONS.md
Step 2 — Understand the UI task

Clarify internally:

What screen, component, or visual pattern is being created or modified?
Is this:
a full page,
a section,
a reusable component,
a modal/drawer,
a table/list,
a metric card,
an empty state,
or another UI pattern?
Is it operational UI or a special editorial/brand surface?

Default assumption:

Most SellUp product UI is operational and must use the standard Design System.
Editorial exceptions are rare and must already be documented or explicitly requested.
Step 3 — Reuse before creating

Review existing components in:

src/components/shared/
src/components/ui/

Before creating anything new, determine whether the need can be solved using or extending:

PageHeader
SurfaceCard
SurfaceCardHeader
ModulePlaceholder
Navigation components
Existing shadcn/ui components
Decision rule

Choose in this order:

Reuse existing component unchanged.
Extend existing component with a small, reusable prop or variant.
Create a new shared component only if:
the pattern is not covered,
it is likely to be reused,
and it follows the current Design System.

Do not create page-specific visual components when a shared pattern should exist.

Step 4 — Map visual needs to SellUp tokens

Review the existing tokens in:

src/app/globals.css

Use semantic tokens and theme variables for:

backgrounds,
panels,
cards,
text,
borders,
brand accents,
success/warning/danger/info states,
shadows/elevation if available.
Required token behavior
Use semantic SellUp tokens and shadcn-compatible variables.
Preserve Light/Dark compatibility.
Do not use arbitrary #hex, rgb(), rgba(), or hsl() in operational UI.
Do not invent new gradients, effects, or color families unless explicitly required and justified.

If a true visual need is not covered by the current tokens:

state the gap clearly,
implement the minimum consistent solution,
recommend a formal Design System extension if the pattern should persist.
Step 5 — Implement with SellUp visual consistency

While implementing:

Composition
Use the page/container spacing conventions already present.
Preserve hierarchy between:
page title,
page description,
sections,
cards,
body text,
meta/captions.
Typography
Follow the typography hierarchy from DESIGN_SYSTEM_FOUNDATION.md.
Do not introduce new font families.
Keep operational screens sober and scannable.
Surfaces
Use approved card/panel patterns.
Keep borders subtle and consistent.
Avoid excessive glassmorphism, dramatic glows, or oversized shadows in operational UI.
Interaction states
Preserve hover, active, focus, and disabled states.
Ensure visible focus states.
Maintain accessibility and readable contrast.
Responsive behavior
Ensure layouts adapt correctly to desktop, tablet, and mobile.
Do not break current navigation or shell behavior.
Step 6 — Validate Light and Dark modes

Before closing the implementation, confirm that the new or modified UI:

looks correct in Dark mode,
looks correct in Light mode,
preserves readable text contrast,
preserves surface differentiation,
preserves visible borders,
uses coherent accent colors,
avoids theme-specific visual regressions.

If any part only works in one mode, fix it before closing.

Step 7 — Run technical validation

Execute:

npm run lint
npm run typecheck
npm run build

All three must pass before considering the UI task complete.

Step 8 — Report design system compliance

At the end of the task, report:

A. What was built or modified
B. Design System tokens used

List the relevant semantic tokens or token families applied.

C. Components reused

List which shared or shadcn/ui components were reused.

D. Components created or extended

Only if applicable.

E. Design System impact

State one of:

No Design System extension required.
A possible Design System extension is recommended.
The Design System documentation was updated.
F. Light/Dark review

Confirm both themes were considered.

G. Validation results
Command	Result
npm run lint	
npm run typecheck	
npm run build	
Final rule

Do not treat SellUp UI as a blank canvas.

Every new interface must inherit the existing product language, not invent a new one.