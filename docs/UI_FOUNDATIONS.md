# Fundaciones UI de SellUp

> **⚠️ Este documento fue supersedido por [`DESIGN_SYSTEM_FOUNDATION.md`](./DESIGN_SYSTEM_FOUNDATION.md).**
> La fuente visual vigente y autoritativa es el Design System Foundation v0.1.
> Este documento se conserva como referencia histórica de la fase inicial.

---

## Estado actual

La fundación visual de SellUp está definida en:

- **Design System Foundation v0.1:** [`docs/DESIGN_SYSTEM_FOUNDATION.md`](./DESIGN_SYSTEM_FOUNDATION.md)
- **Tokens implementados:** `src/app/globals.css`
- **Componentes base:** `src/components/shared/`
- **Shell visual:** `src/components/layout/`

---

## Referencia rápida

### Stack visual
- **CSS:** Tailwind CSS v4 con tokens CSS custom properties
- **Componentes:** shadcn/ui + componentes propios en `src/components/shared/`
- **Temas:** next-themes (`light` / `dark`) — dark es el modo principal
- **Tipografía:** Inter (única familia, via `next/font/google`)

### Componentes base disponibles

| Componente | Ubicación | Uso |
|---|---|---|
| `PageHeader` | `src/components/shared/page-header.tsx` | Encabezado estándar de página |
| `SurfaceCard` | `src/components/shared/surface-card.tsx` | Panel de contenido con superficie |
| `SurfaceCardHeader` | `src/components/shared/surface-card.tsx` | Encabezado de sección dentro de card |
| `ModulePlaceholder` | `src/components/shared/module-placeholder.tsx` | Estado visual para módulos en construcción |
| `NavLink` | `src/components/navigation/nav-link.tsx` | Link de navegación del sidebar |
| `AppShell` | `src/components/layout/app-shell.tsx` | Layout base de la app interna |
| `AppHeader` | `src/components/layout/app-header.tsx` | Header sticky con logo, toggle y usuario |
| `AppSidebar` | `src/components/layout/app-sidebar.tsx` | Sidebar de navegación principal |

### Tokens clave

```css
/* Acento de marca SellUp */
--su-brand: oklch(0.60 0.20 265)     /* ≈ #5b7eff */
--su-brand-soft: oklch(0.60 0.20 265 / 12%)

/* Usar en Tailwind como: */
text-su-brand
bg-su-brand-soft
bg-su-surface
bg-su-surface-elevated
border-su-border-subtle
border-su-border-strong
```

---

Para la especificación completa, ir a [`DESIGN_SYSTEM_FOUNDATION.md`](./DESIGN_SYSTEM_FOUNDATION.md).
