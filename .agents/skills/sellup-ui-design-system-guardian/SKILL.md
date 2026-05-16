# SellUp UI Design System Guardian

**Type:** Skill (Portable)  
**Scope:** All UI creation, modification, and audits  
**Authority:** Design System Foundation v0.1 + Governance  
**Multi-agent compatibility:** Antigravity, Claude Code, OpenCode, any agent reading AGENTS.md

---

## Purpose

Enforce consistent visual design, token usage, and Light/Dark compliance across all SellUp UI surfaces. This Skill works as a portable reference for any agent or developer modifying the SellUp interface.

---

## When to Use This Skill

Activate this Skill when the task involves:

- Creating new pages or modules
- Designing or implementing components
- Translating wireframes to code
- Refining layouts or visual hierarchy
- Auditing existing UI for Design System compliance
- Working with cards, tables, badges, empty states, modals, drawers, or headers

---

## Three Core Responsibilities

### 1. PRE-BUILD: Visual Audit

Before writing code, verify:

1. **What am I building?** (page, component, feature module)
2. **Which Design System Foundation section applies?** 
   - § 2: Visual principles (clarity-operativa, intelligent design, subtle depth, premium sobriety)
   - § 3: Tokens (backgrounds, text, borders, brand, semantic states)
   - § 4: Typography hierarchy (page, section, body, caption, overline)
   - § 5: Radius, borders, shadows (SurfaceCard rules)
   - § 6: Base components (PageHeader, SurfaceCard, ModulePlaceholder, NavLink)
3. **Which shared component exists?** (PageHeader, SurfaceCard, ModulePlaceholder, NavLink, AppShell, AppHeader, AppSidebar)
4. **Which tokens are required?** (brand, surface, border, foreground)
5. **Can this be reused or extended?** (Don't invent new patterns if one exists)

**Deliverable:** 1-sentence specification.  
Example: *"Create an elevated card showing account status with --su-brand border-top, text-base font-semibold section title, and shadow-sm hover state."*

---

### 2. DURING-BUILD: Constraint Enforcement

**Mandatory constraints:**

| Constraint | Rule |
|-----------|------|
| **Colors** | Use ONLY CSS custom properties (`--su-brand`, `--background`, `--card`, `--muted-foreground`, `--border`, `--su-border-subtle`, `--su-border-strong`). Zero hardcoded hex/rgba in operativa. |
| **Typography** | Follow semantic scale: page `text-2xl font-semibold`, section `text-base font-semibold`, body `text-sm`, caption `text-xs`. No arbitrary text-* sizes. |
| **Components** | Reuse PageHeader, SurfaceCard, ModulePlaceholder, NavLink before building custom. |
| **Shadows** | Limit to `{none, shadow-sm, shadow-md, shadow-lg}`. No shadow-xl, shadow-2xl, or custom box-shadows. |
| **Radius** | Use `rounded-md` (inputs/buttons), `rounded-xl` (cards/panels), `rounded-full` (badges/avatars). No arbitrary values. |
| **Light/Dark** | Test both modes. Use `dark:` prefix for overrides. Validate token swaps maintain contrast. |
| **Animations** | Use only `su-*` utilities from globals.css (su-fade-in, su-slide-in, su-scale-in, su-pulse). No custom keyframes. |

**Violations trigger refactor before commit.**

---

### 3. POST-BUILD: Validation & Escalation

After implementation:

```bash
npm run lint       # 0 errors
npm run typecheck  # TypeScript passes
npm run build      # Production build succeeds
```

Then verify:

- [ ] All colors use CSS custom properties (or documented editorial exception)
- [ ] Light/Dark modes tested; both readable
- [ ] Typography matches semantic scale
- [ ] Shadows within bounds
- [ ] Animations use su-* utilities
- [ ] Shared components reused (or custom build justified)
- [ ] No visual regressions vs. existing design

**Escalate to governance if:**
- New token needed (doesn't exist in globals.css)
- Shared component doesn't support use case
- Light/Dark conflict with design intent
- Editorial exception needed

---

## Mandatory Sources of Truth

When in doubt, consult these files in order:

1. **`docs/DESIGN_SYSTEM_FOUNDATION.md`**  
   Official Design System specification (8 sections: purpose, principles, tokens, typography, radius/shadows, base components, Light/Dark, rules for future pages).

2. **`src/app/globals.css`**  
   Implemented tokens (CSS custom properties), animations, Light/Dark swaps.

3. **`src/components/shared/`**  
   PageHeader, SurfaceCard, SurfaceCardHeader, ModulePlaceholder, NavLink.

4. **`src/components/ui/`**  
   shadcn/ui components and extensions.

5. **`src/components/layout/`**  
   AppShell, AppHeader, AppSidebar, theme-toggle.

---

## Explicit Prohibitions

❌ **NEVER:**
- Hardcode colors in operativa components (`#5b7eff`, `rgba(...)`)
- Introduce new font families (Inter only)
- Use `shadow-xl`, `shadow-2xl`, or custom box-shadows
- Create Button, Card, Badge, or Header without checking shared components first
- Add arbitrary animation keyframes
- Ignore Light/Dark mode requirements
- Modify shadcn/ui without compatibility check
- Create "one-off" visual styles per module (consistency wins)
- Skip compliance checks before commit

---

## Exemptions (Editorial Contexts Only)

✅ **Allowed exceptions:**
- **Login visual panel** (brand expression is permitted here)

**Requirement:** Explicit code comment: `// Editorial context: hardcoded for brand expression.`

No other operativa component may bypass token usage.

---

## Token Reference Quick Lookup

### Surfaces & Backgrounds

| Purpose | Token | Tailwind |
|---------|-------|----------|
| Base background | `--background` | `bg-background` |
| Card/content surface | `--card` | `bg-card` |
| Sidebar/header surface | `--sidebar` | `bg-sidebar` |
| Muted zone | `--muted` | `bg-muted` |
| Semantic surface | `--su-surface` | `bg-su-surface` |
| Elevated surface | `--su-surface-elevated` | `bg-su-surface-elevated` |

### Text

| Priority | Token | Tailwind |
|----------|-------|----------|
| Primary | `--foreground` | `text-foreground` |
| Secondary | `--muted-foreground` | `text-muted-foreground` |
| Card text | `--card-foreground` | `text-card-foreground` |

### Brand & Accent

| Use | Token | Tailwind | Value |
|-----|-------|----------|-------|
| Primary accent | `--su-brand` | `text-su-brand` / `bg-su-brand` | `oklch(0.60 0.20 265)` ≈ #5b7eff |
| Brand tinted bg | `--su-brand-soft` | `bg-su-brand-soft` | 10-12% opacity variant |

### Borders

| Type | Token | Tailwind |
|------|-------|----------|
| Standard | `--border` | `border-border` |
| Subtle | `--su-border-subtle` | `border-su-border-subtle` |
| Strong | `--su-border-strong` | `border-su-border-strong` |
| Input | `--input` | `border-input` |

### Semantic States

| State | Recommended | Usage |
|-------|-------------|-------|
| Success | `text-emerald-500`, `bg-emerald-500/10` | Positive outcomes |
| Warning | `text-amber-500`, `bg-amber-500/10` | Alerts, cautions |
| Error | `text-destructive`, `bg-destructive/10` | Failures, destructive actions |
| Info | `text-su-brand`, `bg-su-brand-soft` | Information, hints |

---

## Component Reuse Checklist

Before building a custom component, verify:

1. **PageHeader** — Use for all page titles (text-2xl font-semibold tracking-tight)
2. **SurfaceCard** — Use for content panels, elevated surfaces (with optional elevation, noPadding for tables)
3. **SurfaceCardHeader** — Use for section titles within cards
4. **ModulePlaceholder** — Use for in-development module states
5. **NavLink** — Use for sidebar navigation items
6. **Button (shadcn)** — Reuse. Variants: primary, secondary, destructive, outline, ghost
7. **Input (shadcn)** — Reuse for form fields
8. **Dropdown, Popover, Modal, Sheet** — shadcn/ui defaults are approved

---

## Activation Examples

### Example 1: New Page Layout
**Task:** "Build a Pipeline dashboard page with metrics cards."

1. Read Design System Foundation § 3 (tokens), § 4 (typography), § 6 (components).
2. Use PageHeader (text-2xl font-semibold title).
3. Use SurfaceCard for metric containers (optional elevation).
4. Map colors: `--su-brand` for accent, `--card` for bg, `--foreground` for text.
5. Test light/dark. Confirm `shadow-sm` on hover.
6. Run `npm run lint && npm run typecheck && npm run build`.
7. Commit with tokens and components used.

### Example 2: New Component (Status Badge)
**Task:** "Create a status badge for account states (active, inactive, pending)."

1. Check if badge exists in src/components/ui/.
2. If not, review Design System Foundation § 3 (state colors).
3. Use semantic tokens: `text-emerald-500`, `bg-emerald-500/10` for success.
4. Ensure `rounded-full` (badges are pills).
5. Test light/dark contrast.
6. Add to src/components/ui/ if reusable.

### Example 3: Page Refactor
**Task:** "Audit Accounts page for Design System compliance."

1. Review all color usage → convert hardcoded hex to token classes.
2. Check typography → align to semantic scale.
3. Identify custom cards/headers → replace with PageHeader, SurfaceCard.
4. Test light/dark.
5. Run compliance checklist.
6. Commit.

---

## How This Skill Connects to Governance

| Layer | Location | Skill Role |
|-------|----------|-----------|
| **Foundation** | `docs/DESIGN_SYSTEM_FOUNDATION.md` | Skill consults and enforces all sections |
| **Code** | `src/app/globals.css` | Skill inspects token definitions and implementations |
| **Components** | `src/components/shared/` & `src/components/ui/` | Skill validates reuse and consistency |
| **Rules** | Via AGENTS.md multiagent governance section | Skill integrates with team rules |

---

## Token Economy

This Skill **reduces context bloat** by:
- Referencing external sources instead of duplicating them
- Consulting single-source-of-truth files (Design System Foundation, globals.css, component files)
- Reducing need for repeated "use this color / component" instructions
- Acting as orchestrator, not documentation container

**Future prompts can be shorter:**

❌ Instead of:  
*"Create a card with --su-brand border, text-base title, shadow-sm on hover, tested in dark mode, using SurfaceCard..."*

✅ Use:  
*"Create a [description] following sellup-ui-design-system-guardian."*

---

## Success Criteria

✅ Skill is effective when:

1. All future UI tasks reference it explicitly
2. "No hardcoded colors" becomes standard (zero operativa hex/rgba)
3. Shared components are reused (minimal custom builds)
4. Light/Dark modes are tested as default step
5. Compliance checks pass on first commit
6. No visual drift across modules
7. Future prompts are shorter (governance offloaded to Skill)

---

## Integration Notes

### With Antigravity

- Antigravity Rule `sellup-design-system-governance` and Workflow `build-ui-with-sellup-design-system` are already configured in that platform
- This portable Skill complements them by providing repo-level guidance for agents that cannot access Antigravity

### With Claude Code

- Claude Code Skill `/Users/ub-col-pro-lf4/.claude/skills/sellup-ui-design-system-guardian.md` provides deeper integration with Claude's ecosystem
- This portable Skill is a repository-level reference ensuring consistency across tools

### With OpenCode & Repository-Based Agents

- This Skill lives in `.agents/skills/` and is read by any agent that respects AGENTS.md
- It is the authoritative governance reference for code-based UI work

---

**Skill Created:** 2026-05-15  
**Applies to:** SellUp operativa UI  
**Authority:** Design System Foundation v0.1 + Multiagent Governance
