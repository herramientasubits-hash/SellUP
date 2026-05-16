---
trigger: always_on
---

# SellUp Design System Governance

## Purpose

This workspace rule governs all UI creation, UI modification, visual refactoring, and frontend implementation inside SellUp.

SellUp already has an approved visual foundation. The agent must preserve it and must not invent new visual systems, palettes, component styles, or page-specific aesthetics outside the documented Design System.

The official source of truth is:

- `docs/DESIGN_SYSTEM_FOUNDATION.md`

Supporting references:

- `docs/UI_FOUNDATIONS.md`
- `src/app/globals.css`
- `src/components/shared/`
- `src/components/ui/`

---

## Mandatory behavior before creating or modifying UI

Before implementing any screen, component, layout, card, table, empty state, alert, badge, panel, drawer, modal, or visual refactor, the agent must:

1. Read or consult `docs/DESIGN_SYSTEM_FOUNDATION.md`.
2. Review the existing shared components in:
   - `src/components/shared/`
   - `src/components/ui/`
3. Review the semantic visual tokens available in:
   - `src/app/globals.css`
4. Determine whether the task can reuse or extend an existing SellUp pattern before creating anything new.
5. Preserve compatibility with both Light Mode and Dark Mode.

---

## Design System compliance rules

### 1. Use semantic tokens, not arbitrary colors

The agent must use the existing SellUp semantic tokens and theme variables.

Use the visual system already defined in `globals.css`, including the SellUp `--su-*` token families and the compatible shadcn/ui semantic tokens.

Do not create colors ad hoc per screen.

---

### 2. Reuse shared SellUp components

Whenever applicable, reuse existing components instead of rebuilding their visual logic:

- `PageHeader`
- `SurfaceCard`
- `SurfaceCardHeader`
- `ModulePlaceholder`
- Existing navigation components
- Existing shadcn/ui components

A new visual component may be created only when:

- the existing components do not cover the need,
- the new pattern is likely reusable,
- and the implementation remains aligned with the Design System.

---

### 3. Do not invent new palettes or styles

The agent must not:

- introduce a new color palette,
- introduce a new design language per module,
- invent unrelated gradients,
- invent custom shadows, borders, radii, or spacing rules,
- create cards, buttons, badges, or panels that visually diverge from the existing system.

The product must feel visually coherent across:

- login,
- app shell,
- Pipeline,
- Accounts,
- AI Usage,
- Settings,
- future modules.

---

### 4. No hardcoded colors in operative UI

Do not use arbitrary:

- `#hex`
- `rgb(...)`
- `rgba(...)`
- `hsl(...)`

inside normal operational UI components or pages.

Use semantic tokens instead.

#### Allowed exception
Hardcoded editorial brand treatments may remain only in already documented brand-specific contexts, such as the special login editorial panel, or if the user explicitly requests a new brand treatment.

Any new exception must be clearly justified and should trigger a recommendation to update the Design System documentation if it becomes reusable.

---

### 5. Preserve Light / Dark integrity

Every UI change must work in both themes.

The agent must verify that:

- text remains readable,
- surfaces keep enough contrast,
- borders remain visible but subtle,
- accents do not become oversaturated,
- hover and active states remain clear,
- no component only looks correct in dark mode.

---

### 6. Respect typography hierarchy

Use the typographic hierarchy documented in `docs/DESIGN_SYSTEM_FOUNDATION.md`.

In the operative app:

- page titles should remain restrained and functional,
- visual hierarchy should support scanning and productivity,
- editorial boldness should not leak unnecessarily from the login into operational screens.

Do not introduce new font families unless the user explicitly requests a Design System extension.

---

### 7. Respect spacing, radii, borders, and elevation

The agent must preserve the established system for:

- page paddings,
- section gaps,
- card paddings,
- border radii,
- border contrast,
- elevation levels,
- shadow intensity.

Avoid excessive glow, glassmorphism, strong shadows, and decorative effects in the operative product surface unless they already exist as an approved pattern.

---

### 8. Validate whether the Design System must be extended

If a task reveals a true missing pattern, the agent should:

1. implement the minimum consistent solution,
2. explicitly state that a Design System extension may be needed,
3. recommend updating `docs/DESIGN_SYSTEM_FOUNDATION.md` if the new pattern becomes part of the product language.

Do not silently introduce a new visual convention.

---

## Required reporting when UI work is performed

Whenever the agent completes a UI task, it should report:

1. Which Design System tokens were used.
2. Which shared components were reused.
3. Whether any new visual pattern was created.
4. Whether Light and Dark modes were considered.
5. Whether the Design System documentation needs updating.

---

## Quality gate for UI work

Before closing any UI implementation task, the agent must validate:

```bash
npm run lint
npm run typecheck
npm run build