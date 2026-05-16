# Workflow: Build UI with SellUp Design System

**Name:** Build UI with SellUp Design System  
**Applies to:** Any new page, component, or styling modification in `src/app/(sellup)/` or `src/components/`  
**Purpose:** Ensure visual consistency, token usage, and Light/Dark compliance  
**Duration:** Integrate as standard step before implementation

---

## Step 1: Read Design System Documentation

**Goal:** Understand visual principles, token semantics, and constraints before designing.

**Actions:**
1. Open `docs/DESIGN_SYSTEM_FOUNDATION.md`
2. Read § 1 (Visual principles): Understand intention behind "clarity-operativa", "sobriedad premium", "profundidad sutil"
3. Read § 2 (Tokens): Identify which semantic tokens apply to your context (brand, surface, border, state colors)
4. Read § 3 (Typography): Find the scale level matching your use case (page title, section, body, caption)
5. Read § 4 (Light/Dark): Understand mode-specific rendering and token swaps for your component context
6. Read § 5 (Shadows/Radius): Verify shadow and radius choices match allowed set

**Success Criteria:** You can articulate: "This is a [page title / section heading / card], it uses token [--su-*], and in dark mode it looks like [specific appearance]."

---

## Step 2: Identify Component Objective

**Goal:** Clarify the visual and functional role of your component.

**Ask yourself:**
- Is this a page-level heading, section heading, label, or metadata?
- Is this a container (card), data display (table/list), or form input?
- Is this navigation, action button, or feedback message?
- Does it need to communicate state (active, disabled, loading, error)?
- Does it need elevation (surface, elevated, floating)?

**Outcome:** 1-sentence description, e.g., "Elevated card showing account metrics with icon and hover state increase shadow from sm to md."

---

## Step 3: Review Existing Shared Components

**Goal:** Identify reusable patterns before building new code.

**Components to check:**

| Component | Location | Use Case | Do Not Replace |
|-----------|----------|----------|-----------------|
| PageHeader | `src/components/shared/page-header.tsx` | Page titles with optional description + actions | Never create custom header variant |
| SurfaceCard | `src/components/shared/surface-card.tsx` | Contained content blocks with elevation control | Never roll custom "card" |
| ModulePlaceholder | `src/components/shared/module-placeholder.tsx` | "En construcción" feature placeholders | Use for all unbuilt sections |
| NavLink | `src/components/navigation/nav-link.tsx` | Sidebar nav items (responsive collapse/expand) | Never custom nav styles |
| DropdownMenu | `src/components/ui/dropdown-menu.tsx` | User menus, action dropdowns (shadcn) | Extend, don't replace |

**Decision:** Can your design extend an existing component (props, children slots) or must you create new?

**Success Criteria:** Identified which shared component(s) apply, or explicitly documented why custom component is necessary.

---

## Step 4: Identify Required Tokens

**Goal:** Map color, typography, and shadow needs to available CSS custom properties.

**Token audit:**

| Need | Category | Available Tokens | Example Use |
|------|----------|------------------|-------------|
| Primary brand | Color | `--su-brand`, `--su-brand-soft` | Active nav, CTA indicators, brand accents |
| Backgrounds | Surface | `--background`, `--card`, `--sidebar`, `--muted` | Page, card, sidebar, input backgrounds |
| Text | Foreground | `--foreground`, `--muted-foreground` | Primary text, secondary text, labels |
| Borders | Divider | `--border`, `--su-border-subtle`, `--su-border-strong` | Card borders, dividers, input borders |
| Shadows | Elevation | shadow-sm, shadow-md, shadow-lg | Card hover, dropdown, modal |
| Typography | Scale | text-xs through text-2xl | Page (text-2xl), section (text-base), body (text-sm) |

**Mapping exercise:**
1. List every color decision your component needs
2. Map each to a semantic token
3. If no token exists, document the gap (may require governance approval)
4. If tempted to hardcode `rgba()` or `#hex`: STOP, re-read DESIGN_SYSTEM_FOUNDATION.md § 3

**Success Criteria:** Component uses ONLY CSS custom properties; zero hardcoded colors.

---

## Step 5: Decide: Reuse vs. Create

**Goal:** Minimize component fragmentation.

**Decision tree:**

```
Does your component fit into an existing shared component pattern?
├─ YES → Extend it (props, className slots, children composition)
│        Example: Button variant → extend shadcn Button
│        Example: Card layout → extend SurfaceCard with className
│
├─ NO → Is it a fundamental UI building block?
│       ├─ YES (button, input, badge, card) → Create in src/components/shared/
│       │        Justify: "Why not extend [SharedComponent]?"
│       │
│       └─ NO → Create specific to feature
│               Example: PipelineKanban → src/components/pipeline/
│               Build from shared components + tokens, not from scratch
```

**Anti-Pattern:** Rolling custom "Card", "Header", "Badge", "Button" variants when SurfaceCard, PageHeader, shadcn/ui equivalents exist.

**Success Criteria:** Component composition is minimal; reuses existing patterns wherever possible.

---

## Step 6: Implement → Validate Light/Dark → Run Checks

**Goal:** Write code, test both themes, verify compliance before merge.

### Implementation

1. Write component using identified tokens and shared building blocks
2. Apply semantic classes from DESIGN_SYSTEM_FOUNDATION.md (e.g., border-border/50, elevated cards use shadow-md)
3. Add `dark:` variant classes for theme-specific overrides
4. Test in browser: toggle light/dark mode, verify readability and hierarchy

### Validation Checklist

- [ ] **Colors:** All use CSS custom properties (`--su-*`, `--border`, `--foreground`), no hardcoded hex/rgba
- [ ] **Light mode:** Readable, clear hierarchy, token colors render as intended
- [ ] **Dark mode:** Readable, token swaps make visual sense (review DESIGN_SYSTEM_FOUNDATION.md § 7)
- [ ] **Typography:** Semantic scale only (text-xs through text-2xl), PageHeader uses text-2xl font-semibold if applicable
- [ ] **Animations:** Use su-* utilities from globals.css (su-fade-in, su-slide-in, su-scale-in, su-pulse, su-glow, su-shimmer)
- [ ] **Shadows:** Limited to {none, sm, md, lg} — no xl/2xl
- [ ] **Component composition:** Reuses PageHeader, SurfaceCard, or documents custom rationale
- [ ] **Accessibility:** Keyboard navigation works, focus visible, reduced-motion respected
- [ ] **Responsive:** p-5 base, md:p-8+ larger screens, no text overflow on mobile

### Commands to Run

```bash
npm run lint       # Must pass (0 errors)
npm run typecheck  # Must pass (TypeScript)
npm run build      # Must pass (Next.js production build)
```

### Expected Results

```
✓ lint: 0 errors, 0 warnings
✓ typecheck: no TypeScript errors
✓ build: successful (2-3s Turbopack)
```

---

## Iteration Loop: If Validation Fails

1. **Reread** the relevant section of DESIGN_SYSTEM_FOUNDATION.md
2. **Identify** the constraint violation:
   - Hardcoded color detected?
   - Token mismatch?
   - Shadow exceeds bounds?
   - Dark mode unreadable?
   - Typography incorrect?
3. **Refactor** to comply with constraint
4. **Re-validate** (light/dark, lint, typecheck, build)
5. **Repeat** until all checks pass

---

## When to Escalate

**Escalate to governance if:**
- You need a new token that doesn't exist
- A shared component doesn't support your use case
- Light/Dark mode specs conflict with your design need
- An editorial exception is required (justify in code comment)

**Escalate to code-reviewer if:**
- Unsure about token semantics
- Feedback needed on component composition
- Need verification of Light/Dark compliance before merge

---

## Before Committing

1. ✓ All steps 1–6 completed
2. ✓ npm run lint, typecheck, build pass
3. ✓ Light/Dark modes tested and approved
4. ✓ Component reuses shared patterns (or justified custom build)
5. ✓ No hardcoded colors in operativa code
6. ✓ Typography matches semantic scale

Commit message format:
```
feat: [module] [description]

- Tokens used: --su-brand, --su-surface-elevated
- Components reused: PageHeader, SurfaceCard
- New components: [if any, justify]
- Light/Dark: tested and verified
```

---

**Reference Governance Rule:** See `.agentconfig/rules/sellup-design-system-governance.md` for mandatory constraints and prohibitions.
