---
paths:
  - "src/components/**/*.tsx"
  - "src/app/**/*.tsx"
  - "src/app/**/*.css"
name: SellUp Design System Governance
type: workspace-rule
---
# SellUp Design System Governance

> **Source of Truth:** `docs/DESIGN_SYSTEM_FOUNDATION.md`  
> **Scope:** All UI components, pages, and styling within (sellup) operativa area  
> **Enforcement:** Mandatory for all feature work, component additions, style modifications  

## Mandatory Rules

### 1. Consult Design System Documentation First
Before writing any component, read `docs/DESIGN_SYSTEM_FOUNDATION.md`:
- § 1: Visual principles (clarity-operativa, inteligencia visible, profundidad sutil, sobriedad premium)
- § 2: Token definitions and semantic meanings
- § 3: Typography scale and weight rules (PageHeader uses `text-2xl font-semibold`)
- § 4: Light/Dark mode specifications
- § 5: Shadow, radius, border constraints

**Requirement:** Document understanding in comments if visual decision deviates from standard pattern.

### 2. Use Semantic Token System Only
**Rule:** ALL colors in operativa components must use CSS custom properties from `src/app/globals.css`.

**Allowed tokens:**
- `--su-brand` (primary accent)
- `--su-brand-soft` (tinted background)
- `--background`, `--card`, `--sidebar`, `--muted`
- `--foreground`, `--muted-foreground`
- `--border`, `--su-border-subtle`, `--su-border-strong`

**Forbidden in operativa:**
- Hardcoded hex colors (`#5b7eff`, `#ffffff`)
- Hardcoded rgba/rgb values
- Tailwind arbitrary colors (`bg-[#...]`)
- Custom color palettes

**Exception:** Editorial/brand contexts only (e.g., login visual panel). Requires explicit comment: `// Editorial context: hardcoded for brand expression.`

### 3. Reuse Shared Components
**Reuse before building new:**
- **PageHeader** → page titles (`text-2xl font-semibold`)
- **SurfaceCard** → contained content blocks (handles elevation, padding, borders)
- **ModulePlaceholder** → "En construcción" states
- **NavLink** → sidebar items (handles responsive collapse/expand)
- **shadcn/ui components** → buttons, dropdowns, sheets, dialogs

**Prohibition:** Do not create custom Button, Card, Badge, or Header variants if shared component exists.

### 4. Typography Compliance
**Rules:**
- Page titles: `text-2xl font-semibold tracking-tight` (immutable via PageHeader)
- Section titles: `text-base font-semibold`
- Body text: `text-sm`
- Captions/metadata: `text-xs text-muted-foreground`
- Overline labels: `text-[10px] font-semibold uppercase tracking-widest`

**Prohibition:** Font-bold only in login context (editorial). App internal titles use `font-semibold` maximum.

### 5. Light/Dark Mode Compliance
**Testing requirement:** All components must be tested in both light and dark modes.

**Rules:**
- Use `dark:` Tailwind prefix for dark-specific overrides
- Validate token swaps maintain contrast and readability
- Dark mode is NOT automatic inverse; consult DESIGN_SYSTEM_FOUNDATION.md § 7
- Never assume `dark:invert` or `dark:opacity-*` fixes solve dark mode

### 6. Shadow and Radius Constraints
**Allowed shadows only:**
- No shadow (borders define depth)
- `shadow-sm` (card hover, slight elevation)
- `shadow-md` (dropdowns, popovers)
- `shadow-lg` (modals)

**Forbidden:** `shadow-xl`, `shadow-2xl`, custom `box-shadow` values.

**Radius:** Use Tailwind defaults (`rounded-md`, `rounded-xl`). Do not invent custom radius values.

### 7. Animation Usage
**Rule:** Use only predefined `su-*` animations from `globals.css`:
- `animate-su-fade-in`
- `animate-su-slide-in`
- `animate-su-scale-in`
- `animate-su-pulse`
- `animate-su-glow`
- `animate-su-shimmer`

**Prohibition:** No arbitrary animation keyframes, no hardcoded CSS animations in components.

## Prohibitions (CRITICAL)

- ❌ Hardcoded colors in operativa components (login editorial is exception only)
- ❌ Creating new color tokens without governance approval
- ❌ Modifying shadcn/ui components without compatibility verification
- ❌ Introducing new font families (Inter + Plus Jakarta Sans only)
- ❌ Using shadow-xl, shadow-2xl, or custom box-shadows
- ❌ Visual regressions between light/dark modes without documentation

## Permitted Exceptions

**Editorial/Brand contexts ONLY:**
- Login visual panel (`src/modules/auth/components/login-brand-panel.tsx`)
- Justification required in component comments
- No data-display or operativa component may use exceptions

## Validation Checklist

Before committing changes:
- [ ] Read DESIGN_SYSTEM_FOUNDATION.md for context
- [ ] All colors use CSS custom properties (or documented editorial exception)
- [ ] Component reuses PageHeader, SurfaceCard, or documents why custom build needed
- [ ] Light/Dark modes tested (toggle in browser, verify readability)
- [ ] Typography uses semantic scale (no arbitrary text-* sizes)
- [ ] Animations use `su-*` utilities only
- [ ] Shadows limited to {none, sm, md, lg}
- [ ] No new tokens added without approval
- [ ] npm run lint, typecheck, build all pass

## Reference

See `.agentconfig/workflows/build-ui-with-sellup-design-system.md` for procedural guidance on implementing new components.
