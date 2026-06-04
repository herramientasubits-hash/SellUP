# SellUp Design System Foundation v0.1

> Fuente visual vigente para SellUp. Este documento define los principios, tokens, tipografía, componentes base y reglas que gobiernan toda la interfaz de la plataforma.

---

## 1. Propósito

El Design System Foundation v0.1 resuelve tres problemas concretos:

1. **Desconexión visual** entre el login y la app interna — ambas experiencias deben sentirse parte del mismo producto.
2. **Improvisación por pantalla** — sin un sistema definido, cada módulo nuevo toma decisiones visuales aisladas.
3. **Escalabilidad** — a medida que se construyen Pipeline, Expediente, Costos y Configuración, el sistema debe proveer una base compartida que no requiera redecisiones de color, spacing o jerarquía.

El sistema no es un documento de aspiraciones: cada token está implementado en `globals.css` y cada componente base existe en `src/components/shared/`.

---

## 2. Principios visuales de SellUp

| Principio | Descripción |
|---|---|
| **Claridad operativa** | La interfaz existe para que un ejecutivo comercial pueda trabajar con velocidad. La información debe ser clara, legible y fácil de escanear. |
| **Inteligencia visible** | El sistema debe comunicar sin palabras que hay IA detrás. A través de la paleta, los acentos y la precisión tipográfica. |
| **Profundidad sutil** | Las superficies tienen capas. El sidebar, el header y las cards viven en planos ligeramente distintos. No hay flatness total. |
| **Consistencia antes que expresión** | En la app interna, la consistencia gana sobre la expresividad. El login puede ser editorial. La app debe ser operativa. |
| **Sobriedad premium** | El producto es interno, serio y corporativo. Evita el exceso decorativo, las gradientes visibles, las sombras fuertes y las paletas coloridas. |

---

## 3. Tokens

Todos los tokens están definidos en `src/app/globals.css` como CSS custom properties bajo `:root` (light) y `.dark` (dark).

### 3.1 Backgrounds y superficies

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--background` | `bg-background` | Fondo base de toda la app |
| `--card` | `bg-card` | Superficie de cards y paneles de contenido |
| `--sidebar` | `bg-sidebar` | Superficie del sidebar y header |
| `--muted` | `bg-muted` | Zonas atenuadas, fondos de inputs |
| `--su-surface` | `bg-su-surface` | Alias semántico para `--card` |
| `--su-surface-elevated` | `bg-su-surface-elevated` | Superficie elevada sobre card |

**Regla de capas (dark mode, de más oscuro a más claro):**
```
background (#070d1a) → sidebar/header → card → su-surface-elevated → popover
```

### 3.2 Texto

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--foreground` | `text-foreground` | Texto principal — alta prioridad |
| `--muted-foreground` | `text-muted-foreground` | Texto secundario, labels, descripciones |
| `--card-foreground` | `text-card-foreground` | Texto dentro de cards |

**Jerarquía de opacidad recomendada para texto:**
- Primario: `text-foreground` (100%)
- Secundario: `text-muted-foreground` (~55%)
- Terciario/metadata: `text-muted-foreground/60` (~35%)

### 3.3 Borders

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--border` | `border-border` | Borde estándar entre superficies |
| `--su-border-subtle` | `border-su-border-subtle` | Borde muy suave, separadores internos |
| `--su-border-strong` | `border-su-border-strong` | Borde con mayor contraste |
| `--input` | `border-input` | Borde de campos de formulario |

### 3.4 Brand / Primary

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--primary` | `bg-primary`, `text-primary` | Color primario (azul vibrante en light, azul brillante en dark) |
| `--primary-foreground` | `text-primary-foreground` | Texto sobre primary |
| `--su-brand` | `text-su-brand`, `bg-su-brand` | Acento azul UBITS light `oklch(0.530 0.233 262)` ≈ `#0c5bef` |
| `--su-brand` (dark) | `text-su-brand`, `bg-su-brand` | Acento azul UBITS dark `oklch(0.564 0.221 266)` ≈ `#3865f5` |
| `--su-brand-soft` | `bg-su-brand-soft` | Fondo tintado del acento (8–12% opacidad) |
| `--su-brand-foreground` | `text-su-brand-foreground` | Texto sobre brand sólido |

**Paleta de referencia (alineada con `plantilla-proyectos-shadcn` / UBITS):**

| Rol | Light (HEX) | Dark (HEX) |
|---|---|---|
| Brand | `#0c5bef` | `#3865f5` |
| Brand hover | `#1e4abf` | — |
| Brand pressed | `#223a91` | — |
| Background | `#f8faff` | `#020617` |
| Surface (card) | `#ffffff` | `#0f172a` |
| Surface muted | `#ebf1ff` | `#1e293b` |
| Surface subtle | `#f5f8ff` | — |
| Surface nav (sidebar) | `#111827` | `#0f172a` |
| Text primary | `#303a47` | `#edeeef` |
| Text secondary | `#5c646f` | `#8d9299` |
| Text muted | `#979ba3` | — |
| Border | `#d0d2d5` | `#3d4555` |
| Border strong | `#979ba3` | `#4f5561` |
| Positive | `#328e2c` | — |
| Negative | `#e9343c` | — |
| Warning | `#EC9907` | `#f59e0b` |
| Info | `#4a74ee` | — |
| AI gradient | `#2d5cf7` → `#e11d48` | `#2d5cf7` → `#e11d48` |

El token `--su-brand` es el acento visual central de SellUp. Se usa en:
- Logo "Up"
- Indicadores de nav activo
- Iconos de módulo en placeholders
- Bordes superiores de feature cards

### 3.5 Estados semánticos

| Propósito | Token / clase recomendada |
|---|---|
| Éxito | `text-emerald-500`, `bg-emerald-500/10` |
| Advertencia | `text-amber-500`, `bg-amber-500/10` |
| Error / Destructivo | `text-destructive`, `bg-destructive/10` |
| Info | `text-su-brand`, `bg-su-brand-soft` |

Los estados de éxito, advertencia e info no tienen token CSS propio en v0.1. Se definen aquí como convención de clase para mantener coherencia antes de formalizar tokens adicionales.

---

## 4. Tipografía

### Estrategia

SellUp usa **Inter** como única familia tipográfica (`--font-sans`), tanto para body como para headings. Esta decisión está alineada con la plantilla de referencia UBITS / shadcn:

- Inter es altamente legible en interfaces de datos.
- Una sola familia evita la mezcla de fuentes que añade complejidad sin beneficio real.
- El carácter expresivo en login se logra mediante **escala, peso y opacidad**, no cambiando de fuente.

**Anteriormente:** se usaba `Plus Jakarta Sans` para headings e `Inter` para body. Esta mezcla se eliminó en favor de Inter como fuente única (alineado con `plantilla-proyectos-shadcn`).

### Escala de headings (h1–h6)

Definida en `globals.css` (`@layer base`) y aplicada automáticamente a los elementos HTML:

| Elemento | Token | Uso típico |
|---|---|---|
| `h1` | `text-2xl font-extrabold tracking-tight` | Título principal de página (vía `PageHeader`) |
| `h2` | `text-xl font-bold tracking-tight` | Título de sección principal |
| `h3` | `text-lg font-bold` | Subtítulo de bloque |
| `h4` | `text-base font-semibold` | Títulos dentro de cards (vía `SurfaceCardHeader`) |
| `h5` | `text-sm font-semibold` | Sub-encabezados |
| `h6` | `text-xs font-semibold uppercase tracking-wide text-muted-foreground` | Eyebrow / overline |

### Jerarquía de uso

| Nivel | Clase recomendada | Uso |
|---|---|---|
| Page title | `text-2xl font-extrabold tracking-tight` | Título principal de cada página (vía `PageHeader`) |
| Section title | `text-base font-semibold` | Títulos dentro de cards (vía `SurfaceCardHeader`) |
| Card title | `text-sm font-semibold leading-none` | Encabezados de sub-secciones |
| Body | `text-sm` | Texto de contenido general |
| Caption / metadata | `text-xs text-muted-foreground` | Fechas, IDs, labels secundarios |
| Overline | `text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60` | Labels de sección en sidebar, categorías |

### Iconos

SellUp aplica `stroke-width: 1.75` a los íconos `lucide-react` y SVGs dentro de botones / links. Esto alinea el grosor visual con la identidad UBITS (más fino que el default `2` de lucide) sin necesidad de setearlo manualmente en cada componente.

### Regla login vs. app interna

- **Login:** usa la misma fuente Inter. El brand panel del login puede usar `font-extrabold` con escalas grandes (`text-[2.4rem]` a `text-[1.85rem]`) y `tracking-tight` agresivo para crear impacto editorial.
- **App interna:** mantiene la escala de headings más funcional. h1 = `font-extrabold` (peso fuerte, alineado con referencia), h2/h3 = `font-bold`, h4 en adelante = `font-semibold`. El foco está en la legibilidad operativa.

---

## 5. Radios, bordes y sombras

### Radios

Escala alineada con `plantilla-proyectos-shadcn` (UBITS): `sm 10 · md 14 · lg 20 · xl 28 · 2xl 32 · 3xl 42 · 4xl 56`.

| Uso | Token / clase | Valor |
|---|---|---|
| Base (`--radius`) | `0.875rem` | 14px |
| Componentes pequeños (badges, pills) | `rounded-full` | 9999px |
| Inputs, botones | `rounded-md` | 14px |
| Botones pill, chips, toggles | `rounded-lg` | 20px |
| Cards, paneles | `rounded-xl` | 28px |
| Modal, sheet | `rounded-2xl` | 32px |

### Sombras

SellUp usa sombras mínimas. El sistema de profundidad se comunica principalmente a través de **diferencias de color de superficie**, no de sombras.

| Uso | Clase |
|---|---|
| Card estándar | Sin sombra (borde define el límite) |
| Card elevada / hover | `shadow-sm` |
| Dropdown, popover | `shadow-md` (shadcn/ui por defecto) |
| Modal | `shadow-lg` |

**Prohibido:** `shadow-xl`, `shadow-2xl`, box-shadows custom hardcodeados.

### Glows y halos

Solo permitidos en:
- Panel de marca del login (contexto editorial).
- Indicadores de estado activo muy puntuales.

No usar en la app interna.

---

## 6. Componentes base

### PageHeader

**Ubicación:** `src/components/shared/page-header.tsx`

```tsx
<PageHeader
  title="Pipeline SellUp"
  description="Vista operativa del avance de cuentas."
  actions={<Button size="sm">Nueva cuenta</Button>}
/>
```

Props: `title` (requerido), `description`, `actions`, `className`.

Aplica: `text-2xl font-semibold tracking-tight` para el título. Usa en todas las páginas como primer elemento del contenido.

---

### SurfaceCard + SurfaceCardHeader

**Ubicación:** `src/components/shared/surface-card.tsx`

```tsx
<SurfaceCard>
  <SurfaceCardHeader title="Sección" description="Descripción breve" />
  {/* contenido */}
</SurfaceCard>

<SurfaceCard elevated noPadding>
  {/* tabla o contenido sin padding */}
</SurfaceCard>
```

Props de `SurfaceCard`: `elevated` (añade `shadow-sm`), `noPadding` (para tablas o contenidos custom).

---

### ModulePlaceholder

**Ubicación:** `src/components/shared/module-placeholder.tsx`

```tsx
<ModulePlaceholder
  icon={LayoutDashboard}
  module="Pipeline SellUp — Módulo en construcción"
  description="Descripción del módulo."
  features={[
    { label: "Capacidad 1" },
    { label: "Capacidad 2" },
  ]}
/>
```

Usado temporalmente en todas las páginas placeholder. Debe reemplazarse por el contenido real cuando se desarrolle cada módulo.

---

## 7. Light / Dark

### Cómo funciona

Next-themes aplica la clase `.dark` al `<html>` cuando el usuario selecciona dark mode o cuando el sistema lo prefiere. Todos los tokens CSS están definidos en `:root` (light) y `.dark` (dark) en `globals.css`.

### Diferencias visuales relevantes

| Aspecto | Light | Dark |
|---|---|---|
| Background | Blanco frío con matiz navy sutil `oklch(0.974 0.006 265)` | Navy profundo `oklch(0.12 0.025 265)` ≈ #070d1a |
| Sidebar | Gris frío `oklch(0.952 0.008 265)` | Navy ligeramente más claro que el fondo |
| Card | Blanco puro | `oklch(0.165 0.022 265)` — navy medio |
| Primary | Navy profundo (botones CTA) | Azul acento SellUp (mismo que `--su-brand`) |
| Borders | `oklch(0.872 0.008 265)` — gris azulado | `rgba(white, 9%)` — sutiles sobre oscuro |
| `--su-brand` | `oklch(0.60 0.20 265)` | Idéntico — el acento no cambia entre modos |

### Intencionalidad de ambos modos

- **Dark:** es el modo visual más fuerte de SellUp. El producto se siente más premium, tecnológico y de inteligencia comercial.
- **Light:** no es una inversión automática. Tiene backgrounds con matiz frío (no blanco neutro), sidebar diferenciado y tipografía con el mismo contraste controlado.

---

## 8. Reglas para futuras pantallas

### Obligatorio

1. **Usar `PageHeader`** como primer elemento de toda página de la app interna.
2. **Usar `SurfaceCard`** para paneles de contenido en lugar de `<div>` con clases ad-hoc.
3. **Usar tokens semánticos** (`bg-card`, `text-muted-foreground`, `border-border`, `text-su-brand`) en lugar de valores hardcodeados.
4. **No hardcodear colores** salvo en componentes de marca con justificación explícita (ej: panel izquierdo del login).
5. **No introducir nuevas familias tipográficas** sin decisión de sistema.
6. **No agregar sombras fuertes** (`shadow-xl` o superiores) en la app interna.
7. **Usar `rounded-xl`** para cards y paneles. `rounded-md` para inputs y botones. `rounded-full` para badges y avatares.

### Recomendado

- Para estados de éxito/warning/error usar las clases de convención definidas en §3.5.
- Para skeletons de carga usar `bg-muted animate-pulse`.
- Para separadores de sección en sidebar usar la clase `overline` definida en §4.
- Para nuevos módulos en construcción usar `ModulePlaceholder` en lugar de texto ad-hoc.

### Tokens personalizados `--su-*`

Los tokens con prefijo `--su-` son tokens semánticos propios de SellUp, adicionales al estándar shadcn/ui. Úsalos cuando el token estándar no capture la intención semántica correcta:

```css
/* Acento de marca */
text-su-brand          → color primario SellUp (#5b7eff aprox)
bg-su-brand-soft       → fondo tintado del acento (10-12%)

/* Superficies */
bg-su-surface          → alias semántico de bg-card
bg-su-surface-elevated → superficie sobre card

/* Bordes */
border-su-border-subtle → borde muy suave
border-su-border-strong → borde con más contraste
```

---

## 9. AI Gradient — Tokens y utilidades

### Propósito

El gradiente IA es la única gradación cromática permitida en la app operativa. Sirve como señal visual exclusiva de funcionalidades potenciadas por inteligencia artificial — botones de generación, badges de IA, indicadores de estado activo de agentes, superficies de resultados generados.

**Regla de exclusividad:** este gradiente no se usa en elementos que no sean IA. Su consistencia es lo que lo hace semiótico.

### Tokens

| Token CSS | Tailwind | Descripción |
|---|---|---|
| `--su-ai-from` | `text-su-ai-from`, `bg-su-ai-from` | Extremo índigo del gradiente (`oklch ~258°`) |
| `--su-ai-to` | `text-su-ai-to`, `bg-su-ai-to` | Extremo violeta del gradiente (`oklch ~300°`) |
| `--su-ai-surface` | `bg-su-ai-surface` | Fondo muy suave tintado (~7-10% opacidad) |
| `--su-ai-glow` | — | Color del halo/sombra difusa (~22-30% opacidad) |

Los tokens se definen en `:root` (light) y `.dark` (dark). En dark mode los extremos son más luminosos para brillar sobre fondos profundos.

### Utilidades

| Clase | Uso |
|---|---|
| `su-ai-gradient` | Relleno sólido — botones primarios de IA |
| `su-ai-gradient-animate` | Gradiente animado fluido — estados activos de agente |
| `su-ai-gradient-text` | Texto con gradiente — etiquetas, headings de contexto IA |
| `su-ai-surface` | Superficie suave tintada — cards de resultados IA |
| `su-ai-border` | Borde gradiente sobre fondo de card — contenedores de contexto IA |
| `su-ai-glow` | Sombra difusa — botones IA con profundidad |
| `su-ai-badge` | Pill compuesto — indicador "IA" / "Generado por IA" |

### Dirección del gradiente

`135deg` — diagonal descendente izquierda→derecha. Consistente en todos los elementos para coherencia visual sistémica.

### Light vs. Dark

| Aspecto | Light | Dark |
|---|---|---|
| `--su-ai-from` | `oklch(0.52 0.24 258)` — índigo oscuro | `oklch(0.66 0.25 258)` — índigo brillante |
| `--su-ai-to` | `oklch(0.50 0.25 300)` — violeta oscuro | `oklch(0.63 0.26 300)` — violeta brillante |
| Glow opacity | 22% | 30% |

### Ejemplos de uso

```tsx
{/* Botón de acción IA */}
<button className="su-ai-gradient su-ai-glow rounded-md px-4 py-2 text-sm font-semibold">
  Generar con IA
</button>

{/* Badge de identificación */}
<span className="su-ai-badge">IA</span>

{/* Card de resultado generado */}
<div className="su-ai-surface su-ai-border rounded-xl p-4">
  {/* contenido generado */}
</div>

{/* Label inline de contexto IA */}
<span className="su-ai-gradient-text font-semibold text-sm">Generado por Agente 1</span>
```

### Prohibiciones

- ❌ No usar en botones estándar (solo acciones de IA)
- ❌ No mezclar con `--su-brand` en el mismo elemento
- ❌ No usar `su-ai-gradient-animate` en elementos sin estado activo de agente (por distracción)
- ❌ No recrear el gradiente con valores hardcodeados — siempre usar los tokens

### Especificidad CSS

Las utilidades `su-ai-gradient`, `su-ai-gradient-animate`, `su-ai-border`, `su-ai-glow` y `su-ai-badge` usan `!important` en su declaración `background` / `box-shadow`. Esto es intencional y necesario: cuando se aplican sobre un `<Button>` shadcn (que trae `bg-primary` por la variante `default`), el gradiente IA debe ganar la batalla de especificidad. Sin `!important`, el `bg-primary` del Button sobrescribe el gradiente y el botón se ve azul sólido en lugar del gradiente IA. Esta convención está alineada con la plantilla UBITS de referencia (`.bg-ai-gradient !important`).

---

*SellUp Design System Foundation v0.1 — Mayo 2026*
*Actualización § 9 AI Gradient — Mayo 2026*
*Siguiente iteración: v0.2 tras completar Pipeline funcional.*

---

## 10. DataTable — Sistema unificado de tablas

### 10.1 Propósito

Todas las tablas de SellUp (catálogo de fuentes, batches, candidatos, cuentas, contactos, usage, ai-usage) deben construirse sobre `<DataTable<TData>>` definido en `src/components/data-table/`. Esto reemplaza la duplicación de 15+ implementaciones manuales de `Table` con filtros, sorting y acciones ad-hoc.

**No crear tablas nuevas con `useState` + `useMemo` + `<Table>`.** Usar el componente.

### 10.2 Estructura

```
src/components/data-table/
├── data-table.tsx                    # Core: TanStack Table v8 + feature flags
├── data-table-toolbar.tsx            # Search + bulk actions + density + view options
├── data-table-pagination.tsx         # Paginación + page-size
├── data-table-faceted-filter.tsx     # Multi-select dropdown con counts
├── data-table-view-options.tsx       # Visibilidad de columnas
├── data-table-column-header.tsx      # Header sortable + hideable
├── data-table-row-actions.tsx        # Slot kebab dropdown
├── data-table-bulk-actions.tsx       # Toolbar de selección
├── data-table-context-menu.tsx       # Right-click per-row
├── data-table-density-toggle.tsx     # Compact / comfortable
└── index.ts                          # Barrel exports
```

### 10.3 Props clave

| Prop | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `columns` | `ColumnDef<T, V>[]` | — | Definición de columnas (TanStack) |
| `data` | `T[]` | — | Filas a renderizar |
| `getRowId` | `(row: T) => string` | — | ID estable (clave para selección, context menu) |
| `enableRowSelection` | `boolean` | `false` | Activa checkboxes + bulk actions |
| `contextMenu` | `{ items: (row) => DataTableContextMenuItem[] }` | — | Right-click per-row |
| `density` | `'compact' \| 'comfortable'` | `'comfortable'` | Altura de filas |
| `stickyHeader` | `boolean` | `false` | Header sticky en scroll vertical |
| `initialPageSize` | `number` | `10` | Filas por página iniciales |
| `manualSorting` / `manualFiltering` | `boolean` | `false` | Si `true`, el padre controla sort/filter via `onSortingChange` / `onFilteringChange` |
| `bulkActions` | `DataTableBulkAction<T>[]` | `[]` | Acciones masivas en la selección |
| `onRowClick` | `(row: T) => void` | — | Click en fila (no en acciones) |
| `rowClickable` | `boolean` | `false` | Aplica cursor + hover; false desactiva click |
| `emptyState` | `ReactNode` | — | Contenido cuando `data.length === 0` |
| `globalFilter` | `string` | — | Controlled search |

### 10.4 Columnas — meta fields

`ColumnMeta` extiende `ColumnDef<T, V>['meta']` con campos del sistema:

```ts
{
  label: string;                          // Aparece en "View options"
  facetedFilterTitle?: string;            // Título del dropdown
  facetedFilterOptions?: { label, value }[]; // Opciones del multi-select
}
```

Los faceted filters se renderizan automáticamente en el toolbar cuando una columna tiene `facetedFilterOptions` Y `enableColumnFilter: true` (default).

### 10.5 Uso mínimo

```tsx
'use client';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';

type Row = { id: string; name: string; status: 'active' | 'inactive' };

const columns: ColumnDef<Row>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Nombre" />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    enableHiding: false,
    meta: { label: 'Nombre' },
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
    filterFn: (row, _id, value: string[]) => {
      if (!value?.length) return true;
      return value.includes(row.original.status);
    },
    meta: {
      label: 'Estado',
      facetedFilterTitle: 'Estado',
      facetedFilterOptions: [
        { label: 'Activo', value: 'active' },
        { label: 'Inactivo', value: 'inactive' },
      ],
    },
  },
];

export function MyList({ rows }: { rows: Row[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      enableRowSelection
    />
  );
}
```

### 10.6 Contexto, bulk actions y right-click

```tsx
<DataTable
  // ...props base
  enableRowSelection
  contextMenu={{
    items: (row) => [
      { id: 'view', label: 'Ver detalle', icon: ArrowRight, onClick: () => router.push(`/x/${row.id}`) },
      { id: 'copy', label: 'Copiar ID', icon: Copy, onClick: () => navigator.clipboard.writeText(row.id) },
    ],
  }}
  bulkActions={[
    {
      id: 'archive',
      label: 'Archivar',
      icon: Archive,
      onClick: (rows) => archiveBatch(rows.map((r) => r.id)),
      confirm: { title: '¿Archivar N fuentes?', description: 'Se moverán al archivo.', destructive: true },
    },
  ]}
  onRowClick={(row) => router.push(`/x/${row.id}`)}
  rowClickable
  stickyHeader
/>
```

### 10.7 CSS utilities

Unifica las 4 variaciones de estilo de tabla que existían (`border-border/20|30|40|60`, `hover:bg-muted/20|30|50|hover:bg-accent/30`):

| Clase | Uso |
|-------|-----|
| `.su-table` | Wrapper base: `w-full caption-bottom text-sm` + filas consistentes |
| `.su-table-compact` | Filas más densas (overrides row height) |
| `.su-table-sticky` | `thead` con `sticky top-0 z-10 bg-card/95 backdrop-blur` |
| `.su-table-wrapper` | `relative w-full overflow-x-auto rounded-xl border border-border/10` |

Aplicar a la tabla manualmente cuando se necesite control granular. `<DataTable>` las usa internamente.

### 10.8 Checklist de migración

- [ ] Reemplazar `useState`+`useMemo`+`Table` por `<DataTable>` con `columns` + `data` + `getRowId`.
- [ ] Definir `meta.label` en toda columna visible.
- [ ] Mover filtros `useState` (país, estado, etc.) a faceted filters via `meta.facetedFilterOptions`.
- [ ] Mover search input a `globalFilter` controlled (si se necesita external control).
- [ ] Acciones por fila: usar `DataTableRowActions` en slot `cell` con kebab `MoreHorizontal`.
- [ ] Right-click: declarar `contextMenu.items` con `DataTableContextMenuItem[]`.
- [ ] Bulk actions: declarar `bulkActions` con `confirm` para acciones destructivas.
- [ ] Eliminar imports de `Table*`, `Input` (search), `useState`/`useMemo` para filtros.
- [ ] Verificar: `npm run lint`, `npm run typecheck`, `npm run build` pasan.
- [ ] Commit con prefijo `refactor:` y mensaje claro.

### 10.9 Prohibiciones

- ❌ Crear tablas nuevas con `<Table>` shadcn directo — usar `<DataTable>`.
- ❌ Definir `useState` por filtro — usar faceted filters declarativos.
- ❌ Hardcodear `border-border/40` o `hover:bg-muted/50` ad-hoc — usar `.su-table`.
- ❌ Reimplementar sorting/paginación con `useMemo` — el core lo hace.
- ❌ Mezclar `enableRowSelection` con `onRowClick` sin `rowClickable` (la selección necesita click en la fila).
- ❌ Omitir `getRowId` cuando hay selección (causa re-mounts y bugs de selección).

### 10.10 Primitivos UI nuevos

Para soportar el sistema se agregaron (en `src/components/ui/`):

- `popover.tsx` — wrapper Radix Popover (Radix `asChild` pattern).
- `context-menu.tsx` — wrapper Radix ContextMenu.
- `command.tsx` — wrapper `cmdk` para Command palette + CommandInput/List/Item/Group/Separator/Empty.
- `checkbox.tsx` — wrapper Radix Checkbox (selección de filas).
- `switch.tsx` — wrapper Radix Switch (toggles en settings dialog).

Estos siguen el patrón shadcn estándar (forwardRef + cn + Radix Slot cuando aplica).

### 10.11 Anatomía de un DataTable (alineada con referencia)

La referencia (`plantilla-proyectos-shadcn` v2) define un sistema con 6 zonas visuales. El `<DataTable>` las implementa así:

```
┌─────────────────────────────────────────────────────────────────┐
│ Title + count   [search icon-btn] [density] [view] [⚙] [actions]│  ← Toolbar
│ Description (subtítulo)                                            │
├─────────────────────────────────────────────────────────────────┤
│ ☐ │ Col 1 ⇅▼ │ Col 2 ⇅▼ │ Col 3 ⇅▼ │ Col 4 ⇅▼ │ Acciones  │  ← Sticky header
├───┼────────────┼────────────┼────────────┼────────────┼───────────┤
│ ☐ │ ...        │ ...        │ ...        │ ...        │          │  ← Rows
│ ☐ │ ...        │ ...        │ ...        │ ...        │          │
├───┴────────────┴────────────┴────────────┴────────────┴───────────┤
│ Mostrando 1 - 4 de 7    [« Anterior] 1 2 [Siguiente »]          │  ← Pagination
└─────────────────────────────────────────────────────────────────┘
                                                (when selecting)
                              ┌─────────────────────────────────────┐
                              │ 4 Seleccionados │ ✓ ✕ 🗑 │ 📌 ×     │  ← Floating
                              └─────────────────────────────────────┘     bar
```

#### 10.11.1 Per-column popover (Sort + Search + Filter)

Cada header de columna (que sea `sortable` o `filterable`) tiene un botón
clickable que abre un popover con tres secciones:

1. **ORDENAR** — dos botones `Asc` / `Desc` que controlan `column.toggleSorting(false|true)`.
2. **BUSCAR** — input opcional (en columnas con `disablePopoverSearch: true` se omite) que filtra la lista de opciones.
3. **FILTRAR** — lista de checkboxes con conteos. Los valores vienen de `meta.filterOptions` (estático, preferible para enums conocidos) o de `column.getFacetedUniqueValues()` (derivado de los datos).

Los filtros se almacenan como `string[]` en `column.filterValue` y se aplican
con `filterFn: 'arrIncludesSome'` (built-in de TanStack v8).

#### 10.11.2 Column reordering (drag-and-drop)

`<DataTableColumnReorder>` envuelve el header row con `@dnd-kit/core` +
`@dnd-kit/sortable` (estrategia `horizontalListSortingStrategy`). Las
columnas ancladas (`pinnedColumnIds`, default `["select", "actions"]`) se
excluyen del sortable context y permanecen en sus extremos.

Para activarlo: `enableColumnReorder` (default `true`). El estado vive en
`state.columnOrder` (TanStack v8 built-in).

#### 10.11.3 Column pinning (left / right)

Wired via `state.columnPinning: { left, right }` (TanStack v8 built-in).
El método `column.pin("left" | "right" | false)` está disponible en el
context menu del column header (TODO: añadir botón Pin en el popover
cuando el consumer pase `onPin` callback).

#### 10.11.4 Floating bulk action bar

`<DataTableBulkActionBar>` se renderiza en `position: fixed; bottom-6;
left-1/2` cuando hay selección. Es dark (`bg-zinc-900`), pill-shaped
(`rounded-full`), con:

- Badge circular con el conteo (`bg-primary text-primary-foreground`).
- Acciones: iconos + label, separadas por `bg-zinc-700` dividers.
- Pin button + Close (×) button al final.
- Acciones con `confirm: { title, description }` abren un `Dialog`
  inline (no modal separado) antes de ejecutar.

Para activarlo: `enableRowSelection` + `bulkActions[]`. El bar se cierra
automáticamente al ejecutar acciones no destructivas; las destructivas
mantienen el bar abierto hasta que el consumer resuelva la promesa.

#### 10.11.5 Settings dialog ("Ajustes de Tabla Avanzados")

`<DataTableSettingsDialog>` envuelve la `<Dialog>` (Base UI) con tres
controles:

- **MODO DE EDICIÓN** (`row` / `cell`) — `SegmentedControl` con íconos.
- **CARGA DE DATOS** (`pagination` / `lazy`) — `SegmentedControl`.
- **BUSCADOR GENERAL** — `Switch` que controla `showGlobalSearch`.

El estado vive en `DataTableSettings` y se aplica al cerrar el modal con
"Aplicar Ajustes". Se accede desde el ícono `SlidersHorizontal` en el
toolbar.

El consumer puede sobrescribir el comportamiento real de `editMode` /
`loadMode` en su `<DataTable>` padre leyendo `settings.editMode` /
`settings.loadMode` y reaccionando con `useEffect`. Por defecto la
implementación no hace nada destructivo — es opt-in.

#### 10.11.6 Search button (icon-only)

En el toolbar, el search input es un **icon button** que se expande a un
input de 224px (`w-56`) cuando se le hace click. El usuario escribe y
presiona Enter (o se cierra solo al perder focus si está vacío). El
resultado se pasa a `state.globalFilter` (TanStack v8 built-in).

#### 10.11.7 Pagination format

`<DataTablePagination>` formatea: `Mostrando {first} - {last} de {total} resultados`. A la derecha:

```
[« Anterior] 1 2 3 [Siguiente »]
```

Con elipsis (`…`) entre páginas no consecutivas. La página actual se
resalta con `bg-foreground text-background`. Se omite toda la barra si
`totalRows === 0` (solo muestra "0 resultados").
