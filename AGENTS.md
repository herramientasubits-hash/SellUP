<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

---

# SellUp Design System Governance

**Authority:** Design System Foundation v0.1  
**Scope:** All agents, developers, and tools modifying SellUp UI  
**Multi-agent support:** Antigravity, Claude Code, OpenCode, and any agent reading AGENTS.md

---

## Visual Sources of Truth

All UI work must consult and respect these authoritative sources:

| Artifact | Location | Purpose |
|----------|----------|---------|
| **Design System Foundation v0.1** | `docs/DESIGN_SYSTEM_FOUNDATION.md` | Official specification (14 sections: principles, tokens, typography, radius/shadows, components, Light/Dark, rules, DataTable, Drawer con Tabs, Floating Bar, Lazy Load, Page Recipe) |
| **CSS Tokens** | `src/app/globals.css` | Implemented custom properties and animations |
| **Base Components** | `src/components/shared/` | PageHeader, SurfaceCard, ModulePlaceholder, NavLink, DrawerShell |
| **UI Library** | `src/components/ui/` | shadcn/ui extensions and custom widgets |
| **Layout System** | `src/components/layout/` | AppShell, AppHeader, AppSidebar, theme-toggle |
| **DataTable System** | `src/components/data-table/` | DataTable, DataTableSettingsDrawer, DataTableLoadMore, DataTableBulkActionBar — Foundation § 10 |
| **Governance Skill** | `.agents/skills/sellup-ui-design-system-guardian/SKILL.md` | Portable reference for any agent |

---

## Required Behavior for UI Work

**Every agent modifying UI must:**

1. **Consult the Design System** before writing code
   - Read relevant sections of `DESIGN_SYSTEM_FOUNDATION.md`
   - For CRUD pages with list + detail, read **§ 14 Page Recipe** first
   - For detail views with multiple areas, read **§ 11 Drawer con Tabs**
   - For floating bars/toasts/portals, read **§ 12 Floating Action Bar**
   - For infinite scroll lists, read **§ 13 Lazy Load con IntersectionObserver**
   - For data tables, read **§ 10 DataTable**
   - Check token definitions in `src/app/globals.css`
   - Verify component exists in shared/ before building custom

2. **Reutilize tokens and components**
   - No hardcoded colors in operativa code (`#5b7eff`, `rgba(...)` prohibited)
   - Reuse PageHeader, SurfaceCard, ModulePlaceholder, NavLink, DrawerShell
   - For tables: use `DataTable` (nunca `<Table>` shadcn directo)
   - For detail views: use `DrawerShell` + `Tabs` (§ 11)
   - Extend existing components before creating new ones

3. **Preserve Light/Dark mode**
   - Test both light and dark themes
   - Use `dark:` prefixes for mode-specific overrides
   - Validate token swaps maintain contrast

4. **Avoid arbitrary styling**
   - No custom font families (Inter only)
   - No `shadow-xl`, `shadow-2xl`
   - Radius: `rounded-md` (inputs), `rounded-xl` (cards), `rounded-full` (badges)
   - Animations: only `su-*` utilities from globals.css

5. **Validate before commit**
   ```bash
   npm run lint       # 0 errors
   npm run typecheck  # TypeScript passes
   npm run build      # Production build succeeds
   ```

---

## Skill Usage

### For UI Tasks, Activate:

**`.agents/skills/sellup-ui-design-system-guardian/SKILL.md`**

This portable Skill provides:
- Pre-build visual audit checklist
- During-build constraint enforcement
- Post-build validation procedure
- Token reference quick lookup
- Component reuse checklist
- Activation examples

### Invoke the Skill When:

- Creating new pages or modules
- Designing or implementing components
- Translating wireframes to code
- Refining layouts or visual hierarchy
- Auditing existing UI for compliance
- Working with cards, tables, badges, modals, drawers, headers

---

## Multi-Agent Compatibility

### Antigravity

- **Workspace Rule:** `sellup-design-system-governance` (already configured)
- **Workspace Workflow:** `build-ui-with-sellup-design-system` (already configured)
- **Integration:** Antigravity rules and workflows take precedence over this AGENTS.md guidance
- **Reference:** Use this section to understand SellUp's design system governance when Antigravity context is unavailable

### Claude Code

- **Global Skill:** `/Users/ub-col-pro-lf4/.claude/skills/sellup-ui-design-system-guardian.md` (available)
- **Integration:** Claude Code Skill provides deeper IDE integration and extended guidance
- **Reference:** This AGENTS.md section ensures consistency when Claude Code Skill is not available

### OpenCode & Repository-Based Agents

- **Authority:** This AGENTS.md file + `.agents/skills/sellup-ui-design-system-guardian/SKILL.md`
- **Entry point:** Read AGENTS.md first, then consult the portable Skill
- **Governance:** No external rules or workflows apply; repo-level guidance is authoritative

### Future Agents & Developers

- Read this section to understand SellUp's visual governance
- Consult `.agents/skills/sellup-ui-design-system-guardian/SKILL.md` for operational guidance
- Follow the mandatory behavior checklist above

---

## Governance Stack Overview

```
┌─ Design System Foundation v0.1 (docs/DESIGN_SYSTEM_FOUNDATION.md)
├─ CSS Tokens & Animations (src/app/globals.css)
├─ Base Components (src/components/shared/)
│
├─ Antigravity Rule + Workflow (configured in Antigravity UI)
├─ Claude Code Skill (global, in ~/.claude/skills/)
└─ OpenCode Skill + AGENTS.md (repo-level, portable)
```

**Relationship:**
- Foundation & Code = "source of truth"
- Antigravity Rule/Workflow = "team governance layer"
- Skills & AGENTS.md = "operational guidance for agents"

All three layers must be consistent. If divergence occurs, Design System Foundation v0.1 is authoritative.

---

## Prohibited Patterns

❌ **NEVER do these in operativa UI:**

- Hardcode colors (`#5b7eff`, `rgb(91, 126, 255)`)
- Introduce new font families
- Use `shadow-xl`, `shadow-2xl`
- Create Button, Card, Badge without checking existing components
- Add custom keyframes (use globals.css utilities)
- Ignore Light/Dark testing
- Create "one-off" visual styles per module
- Skip compliance checks before commit

✅ **Allowed exception:** Login visual panel (editorial context only)  
**Requirement:** Code comment: `// Editorial context: hardcoded for brand expression.`

---

## Token Quick Reference

| Purpose | Token CSS | Tailwind | Use Case |
|---------|-----------|----------|----------|
| Accent | `--su-brand` | `text-su-brand`, `bg-su-brand` | Logo, nav highlight, feature accent |
| Brand soft | `--su-brand-soft` | `bg-su-brand-soft` | Tinted backgrounds (info context) |
| Primary text | `--foreground` | `text-foreground` | Main content |
| Secondary text | `--muted-foreground` | `text-muted-foreground` | Labels, secondary info |
| Card surface | `--card` | `bg-card` | Content panels |
| Success | — | `text-emerald-500`, `bg-emerald-500/10` | Positive outcomes |
| Warning | — | `text-amber-500`, `bg-amber-500/10` | Alerts |
| Error | `--destructive` | `text-destructive`, `bg-destructive/10` | Failures |

**Full token reference:** See `src/app/globals.css` and Design System Foundation § 3.

---

## Validation Checklist

Before commit, verify:

- [ ] All colors use CSS custom properties
- [ ] Light/Dark modes both readable
- [ ] Typography matches semantic scale
- [ ] Shadows within bounds
- [ ] Shared components reused
- [ ] No visual regressions
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds

---

## Reporting & Escalation

### When UI Complies

- Commit with message indicating tokens and components used
- No further action required

### When Governance Needs Extension

**Escalate to governance if:**
- New token needed (not in globals.css)
- Shared component doesn't support use case
- Light/Dark creates design conflict
- Editorial exception required (justify in code)

---

**Design System Governance established:** 2026-05-15  
**Last updated:** 2026-05-15  
**Applies to:** SellUp operativa and editorial UI
