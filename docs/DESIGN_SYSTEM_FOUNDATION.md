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

### MetricCard

**Ubicación:** `src/components/shared/metric-card.tsx`

Card especializada para KPIs / métricas operativas. Replica visual del `SurveyMetricCard` de la plantilla UBITS, alineada a tokens SellUp.

```tsx
<MetricCard
  title="NPS"
  description="Indicador clave de desempeño"
  value={81}
  subtitle="%"
  delta={37.3}
  deltaTone="positive"
  trendDirection="up"
  icon={<BrandIconChip />}
/>
```

Anatomía:

- **Título** — `text-xs font-bold uppercase tracking-widest text-muted-foreground/80` (igual que en la plantilla)
- **Value** — `text-3xl font-bold tracking-tight tabular-nums`
- **Subtitle** — unidad o nota corta al lado del value (`text-xs text-muted-foreground`)
- **DeltaPill** opcional — variación porcentual con icono TrendingUp/Down/Minus
- **Icon** — chip de icono a la derecha (8×8, `rounded-lg`, fondo tinted)
- **Footer** opcional — banda inferior con borde superior `border-border/40` y `bg-muted/20`

Variantes soportadas: `loading` (skeleton interno), `error` (mensaje + título).

Reglas:
- Usar `MetricCard` en lugar de `<SurfaceCard>` con markup manual para KPIs.
- En grillas grandes (`grid-cols-6`, `grid-cols-5`) el gap debe ser `gap-3` o `gap-4`.
- `valueClassName` permite tintar el value (ej. `text-emerald-600` para métricas positivas).

---

### DeltaPill

**Ubicación:** `src/components/shared/delta-pill.tsx`

Pill de variación con icono. Tonos: `positive` (verde) / `negative` (rojo) / `neutral` (gris). Direcciones: `up` / `down` / `flat`. Resuelve tono y dirección automáticamente a partir del `value` si no se pasan.

```tsx
<DeltaPill value={37.3} tone="positive" direction="up" />
<DeltaPill label="—" direction="flat" />
```

No usar DeltaPill fuera de `MetricCard` (es su slot nativo).

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
*Actualización § 10–14 DataTable, Drawer con Tabs, Floating Bar, Lazy Load, Page Recipe — Junio 2026*
*Actualización § 15 Scroll interno de tabla + DataTablePage — Junio 2026*
*Siguiente iteración: v0.2 tras completar Pipeline funcional.*

---

## 10. DataTable — Sistema unificado de tablas

### 10.1 Propósito

Todas las tablas de SellUp (catálogo de fuentes, batches, candidatos, cuentas, contactos, usage, ai-usage) deben construirse sobre `<DataTable<TData>>` definido en `src/components/data-table/`. Esto reemplaza la duplicación de 15+ implementaciones manuales de `Table` con filtros, sorting y acciones ad-hoc.

**No crear tablas nuevas con `useState` + `useMemo` + `<Table>`.** Usar el componente.

### 10.2 Estructura actual

```
src/components/data-table/
├── data-table.tsx                    # Core: TanStack Table v8 + load mode + settings
├── data-table-toolbar.tsx            # Title + description + search + settings + actions
├── data-table-pagination.tsx         # Paginación clásica (page-size + páginas)
├── data-table-load-more.tsx          # Lazy load: sentinel + IntersectionObserver
├── data-table-settings-drawer.tsx    # Drawer: visibilidad columnas + modo de carga
├── data-table-column-header.tsx      # Header clickable (sortable)
├── data-table-column-popover.tsx     # Per-column popover (sort + filter)
├── data-table-column-reorder.tsx     # Drag-and-drop column reordering
├── data-table-row-actions.tsx        # Kebab dropdown por fila
├── data-table-context-menu.tsx       # Right-click menu
├── data-table-bulk-action-bar.tsx    # Portal de selección masiva (ver § 12)
└── index.ts                          # Barrel exports
```

### 10.3 Props clave

| Prop | Tipo | Default | Descripción |
|------|------|---------|-------------|
| `columns` | `ColumnDef<T, V>[]` | — | Definición de columnas (TanStack) |
| `data` | `T[]` | — | Filas a renderizar |
| `getRowId` | `(row: T) => string` | — | ID estable (clave para selección, context menu) |
| `title` | `ReactNode` | — | Título en el toolbar (p. ej. `"Listado de fuentes"`) |
| `description` | `ReactNode` | — | Subtítulo debajo del título |
| `count` | `number` | — | Badge numérico junto al título |
| `actions` | `ReactNode` | — | Botones alineados a la derecha del toolbar |
| `enableRowSelection` | `boolean` | `false` | Checkbox column + bulk action bar |
| `bulkActions` | `DataTableBulkAction<T>[]` | `[]` | Acciones masivas |
| `contextMenu` | `DataTableContextMenuConfig<T>` | — | Right-click menu items |
| `stickyHeader` | `boolean` | `false` | `thead` sticky en scroll vertical |
| `initialPageSize` | `number` | `20` | Filas por página / lote de lazy load |
| `pageSizeOptions` | `number[]` | `[10, 20, 50, 100]` | Opciones de page-size (modo paginación) |
| `enableColumnReorder` | `boolean` | `true` | Drag-and-drop en headers |
| `pinnedColumnIds` | `string[]` | `["select", "actions"]` | Columnas excluidas del reorder |
| `manualSorting` / `manualFiltering` | `boolean` | `false` | Si `true`, el padre controla sort/filter via estado externo |
| `onRowClick` | `(row: T) => void` | — | Click handler (no confundir con selección) |
| `rowClickable` | `boolean` | `false` | Cursor + hover; necesario junto a `onRowClick` |
| `emptyState` | `ReactNode` | — | Contenido cuando `data.length === 0` |
| `loading` | `boolean` | `false` | Skeleton overlay |
| `hideToolbar` | `boolean` | `false` | Oculta toolbar completamente |
| `className` | `string` | — | Wrapper extra classes |

### 10.4 Modos de carga — `loadMode`

`DataTableSettings.loadMode` controla cómo se cargan las filas. Configurable desde `<DataTableSettingsDrawer>`:

| Modo | Comportamiento | Cuándo usarlo |
|------|----------------|---------------|
| `'pagination'` | Filas paginadas con `<DataTablePagination>`. Default. | Datasets medianos (≤500 filas en memoria). |
| `'lazy'` | Filas se revelan incrementalmente con `<DataTableLoadMore>` (IntersectionObserver, automático al hacer scroll). Ver § 13. | Datasets grandes cargados en memoria o listas que se benefician de scroll continuo. |

El modo se guarda en estado interno del `<DataTable>`. La transición resetea `lazyVisibleCount` automáticamente y `pageSize` se ajusta a `Number.MAX_SAFE_INTEGER` en lazy para que TanStack no interfiera con el slice client-side.

**Límite práctico:** lazy es client-side slicing. Para >1000 filas, mover a server-side pagination (`manualPagination`).

### 10.5 Ajustes de tabla — `DataTableSettings`

Estado: `{ globalSearch: boolean; loadMode: 'pagination' | 'lazy' }`.

Configurable desde el `<DataTableSettingsDrawer>` que se abre con el ícono `SlidersHorizontal` en el toolbar. El drawer contiene:

- **BUSCADOR GENERAL** (`Switch`) — muestra/oculta el input de búsqueda global.
- **MODO DE CARGA** (`SegmentedControl`) — paginación vs carga perezosa (ver § 13).
- **COLUMNAS VISIBLES** (checkboxes) — toggle de visibilidad por columna (vía `meta.label`).

Default: `{ globalSearch: true, loadMode: 'pagination' }`. Sin "Modo de edición" — esa feature fue retirada.

### 10.6 Columnas — meta fields

`ColumnMeta` extiende `ColumnDef<T, V>['meta']` con campos del sistema:

```ts
{
  label: string;                          // Aparece en "Columnas visibles"
  facetedFilterTitle?: string;            // Título del dropdown
  facetedFilterOptions?: { label, value }[]; // Opciones del multi-select
  disablePopoverSearch?: boolean;         // Oculta el input de búsqueda en el popover
}
```

Los faceted filters se renderizan automáticamente en el toolbar cuando una columna tiene `facetedFilterOptions` Y `enableColumnFilter: true` (default).

### 10.7 Uso mínimo

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
      title="Listado de elementos"
      description="Vista operativa de todos los elementos registrados."
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      enableRowSelection
    />
  );
}
```

### 10.8 Contexto, bulk actions y right-click

```tsx
<DataTable
  // ...props base
  enableRowSelection
  contextMenu={{
    items: (row) => [
      { id: 'view', label: 'Ver detalle', icon: ArrowRight, onClick: () => openDetail(row) },
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
  onRowClick={(row) => openDetail(row)}
  rowClickable
  stickyHeader
/>
```

### 10.9 Anatomía de un DataTable

El `<DataTable>` implementa estas zonas visuales (de arriba a abajo):

```
┌─────────────────────────────────────────────────────────────────┐
│ Title + count   [search] [⚙] [actions]                          │  ← Toolbar
│ Description (subtítulo)                                            │
├─────────────────────────────────────────────────────────────────┤
│ ☐ │ Col 1 ⇅▼ │ Col 2 ⇅▼ │ Col 3 ⇅▼ │ Col 4 ⇅▼ │ Acciones  │  ← Sticky header
├───┼────────────┼────────────┼────────────┼────────────┼───────────┤
│ ☐ │ ...        │ ...        │ ...        │ ...        │          │  ← Rows
│ ☐ │ ...        │ ...        │ ...        │ ...        │          │
├───┴────────────┴────────────┴────────────┴────────────┴───────────┤
│ [Footer: pagination | load-more sentinel]                       │
└─────────────────────────────────────────────────────────────────┘
                                                (when selecting)
                              ┌─────────────────────────────────────┐
                              │ N seleccionados  [acción1] [acción2] │  ← Floating
                              └─────────────────────────────────────┘     bar (portal)
```

#### 10.9.1 Per-column popover (Sort + Filter)

`<DataTableColumnPopover>` envuelve el header clickable y abre un popover con:

1. **ORDENAR** — botones `Asc` / `Desc` que controlan `column.toggleSorting`.
2. **FILTRAR** — lista de checkboxes con conteos. Valores de `meta.facetedFilterOptions` (estático) o `column.getFacetedUniqueValues()` (derivado).

Filtros se almacenan como `string[]` en `column.filterValue` con `filterFn: 'arrIncludesSome'`.

**Indicadores en el header clickable** (en `<DataTableColumnHeader>`):

| Estado | Indicador |
|---|---|
| Sin sort ni filtro | `ChevronsUpDown` tenue (sólo en hover) |
| Sort ascendente | `ArrowUp` sólido en `text-foreground` |
| Sort descendente | `ArrowDown` sólido en `text-foreground` |
| Filtro activo (cualquier valor en `column.filterValue`) | `ListFilter` sólido en `text-primary` (reemplaza el `ChevronsUpDown` por defecto) |
| Columna pineada | `Pin` en `text-primary` |

El `ListFilter` aparece aunque la columna no esté ordenada, de modo que el operador ve de un vistazo qué columnas están filtradas sin tener que abrir el popover.

**Coexistencia row reorder + sort:** cuando `enableRowReorder` está activo y el usuario aún no ha hecho click en un sort header, el orden de filas es el que provee el padre (drag-and-drop). Al primer click en un sort header, TanStack toma el control (`manualSorting` pasa a `false`) y reordena la vista. Al limpiar el sort desde el popover (`Limpiar filtros`), el control vuelve al padre y reaparece el orden manual.

**Anatomía del popover** — `w-72` (288px), `p-0`, `rounded-xl border border-border/40`. Cada sección (Título, Ordenar, Buscar, Filtrar) lleva `px-5` en el header de sección y `px-4` en el cuerpo para que el contenido (botones, input, checkboxes) respire ~16px del borde. Los items de filtro van con `px-2 py-1.5` y `gap-2.5` entre checkbox y label. Separadores entre secciones con `<Separator className="mx-4" />`.

#### 10.9.2 Row right-click context menu

`<DataTableContextMenu>` envuelve cada fila cuando el `DataTable` recibe `contextMenu`. Anatomía:

- `min-w-[220px]`, container `p-1.5`, `rounded-xl border border-border/30`.
- Items con `px-2.5 py-2`, `gap-2.5` y icono `h-4 w-4` — el icono agrandado y el padding mayor dan aire al texto (evita que se vea "circular" / pegado al borde).
- `<ContextMenuSeparator>` con `-mx-1 my-1` para mantener el padding del container.

#### 10.9.3 Column reordering (drag-and-drop)

`<DataTableColumnReorder>` envuelve el header row con `@dnd-kit/core` + `@dnd-kit/sortable`. Columnas en `pinnedColumnIds` (default `["select", "actions"]`) no son draggeables. Activado por defecto (`enableColumnReorder: true`).

#### 10.9.4 Floating bulk action bar (portal pattern)

`<DataTableBulkActionBar>` se renderiza via `createPortal` a `document.body` (NO dentro de la tabla). Razón técnica: el `transform` del `animate-su-fade-in` del AppShell crea un containing block que rompe `position: fixed` para descendientes. Ver § 12 para el patrón completo.

#### 10.9.5 Settings drawer (no dialog)

`<DataTableSettingsDrawer>` reemplaza el antiguo settings dialog. Contiene: switch de buscador, segmented control de modo de carga, listado de columnas visibles. Accesible desde el ícono `SlidersHorizontal` en el toolbar.

#### 10.9.6 Search input

Input de búsqueda controlado por `state.globalFilter` (TanStack built-in). Aparece/oculta según `settings.globalSearch`.

#### 10.9.7 Pagination / Load-more footer

El footer cambia según `loadMode`:

- **Paginación:** `<DataTablePagination>` con formato `Mostrando {first} - {last} de {total} resultados` + `[« Anterior] 1 2 [Siguiente »]` con elipsis entre páginas no consecutivas. Página actual con `bg-foreground text-background`. Si `totalRows === 0`, solo "0 resultados".
- **Lazy:** `<DataTableLoadMore>` con sentinel de IntersectionObserver. Ver § 13.

### 10.10 Checklist de migración

- [ ] Reemplazar `useState`+`useMemo`+`Table` por `<DataTable>` con `columns` + `data` + `getRowId`.
- [ ] Definir `meta.label` en toda columna visible.
- [ ] Mover filtros `useState` (país, estado, etc.) a faceted filters via `meta.facetedFilterOptions`.
- [ ] Acciones por fila: usar `DataTableRowActions` en slot `cell` con kebab `MoreHorizontal`.
- [ ] Right-click: declarar `contextMenu.items` con `DataTableContextMenuItem[]`.
- [ ] Bulk actions: declarar `bulkActions` con `confirm` para acciones destructivas.
- [ ] Eliminar imports de `Table*`, `Input` (search), `useState`/`useMemo` para filtros.
- [ ] Verificar: `npm run lint`, `npm run typecheck`, `npm run build` pasan.
- [ ] Commit con prefijo `refactor:` y mensaje claro.

### 10.11 Prohibiciones

- ❌ Crear tablas nuevas con `<Table>` shadcn directo — usar `<DataTable>`.
- ❌ Definir `useState` por filtro — usar faceted filters declarativos.
- ❌ Reimplementar sorting/paginación con `useMemo` — el core lo hace.
- ❌ Mezclar `enableRowSelection` con `onRowClick` sin `rowClickable` (la selección necesita click en la fila).
- ❌ Omitir `getRowId` cuando hay selección (causa re-mounts y bugs de selección).
- ❌ Reintroducir density toggle, view options popover, o edit mode — features retiradas.
- ❌ Hardcodear estilos de tabla (`border-border/40`, `hover:bg-muted/50` ad-hoc) — el `<DataTable>` los aplica.

### 10.12 Primitivos UI nuevos

Para soportar el sistema se agregaron (en `src/components/ui/`):

- `popover.tsx` — wrapper Base UI Popover.
- `context-menu.tsx` — wrapper Base UI ContextMenu.
- `checkbox.tsx` — wrapper Base UI Checkbox (selección de filas).
- `switch.tsx` — wrapper Base UI Switch (toggles en settings drawer).
- `tabs.tsx` — wrapper Base UI Tabs (drawer con tabs, ver § 11).
- `segmented-control.tsx` — control segmentado (modo de carga, etc.).

Todos siguen el patrón shadcn estándar (forwardRef + cn + Slot cuando aplica).

---

## 11. Drawer con Tabs — Pattern para detail views

### 11.1 Propósito

Cuando el detalle de una entidad tiene múltiples sub-áreas (información general, actividad, logs, batches relacionados, etc.), el detalle completo debe vivir **dentro del drawer** — no en una página separada. Esto mantiene al usuario dentro del contexto de la lista sin perder el overview.

**Regla:** No incluir un botón "Abrir página completa" en el drawer. El drawer ES el detalle completo.

### 11.2 Anatomía

```
┌──────────────────────────────────────────────────────────────┐
│ [icon] Title                       Key · description · ×  │  ← Header
├──────────────────────────────────────────────────────────────┤
│ [Información]  [Actividad 12]  [Lotes 5]                    │  ← TabsList
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  (TabContent: información general, badges, cards)           │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ [Copiar key]                              [Abrir URL]       │  ← Footer
└──────────────────────────────────────────────────────────────┘
```

### 11.3 Implementación de referencia

Combinar `DrawerShell` + `Tabs` (Base UI). Ejemplo real en
`src/app/(sellup)/settings/source-catalog/source-detail-drawer.tsx`:

```tsx
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

<DrawerShell
  open={open}
  onOpenChange={onOpenChange}
  side="right"
  className="!w-[80vw] !max-w-[80vw] sm:!max-w-[80vw]"
  title={source.name}
  description={source.key}
  icon={<StatusDot status={source.status} />}
  footer={
    <div className="flex items-center justify-between gap-3 w-full">
      <CopyKeyInline value={source.key} />
      {source.url && (
        <Button variant="outline" size="sm" asChild>
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir URL
          </a>
        </Button>
      )}
    </div>
  }
>
  <Tabs defaultValue="info" className="w-full">
    <TabsList variant="line" className="mb-5">
      <TabsTrigger value="info">Información</TabsTrigger>
      <TabsTrigger value="batches">
        Lotes
        {batchesCount > 0 && (
          <span className="ml-1.5 inline-flex items-center justify-center rounded-full border border-border/40 bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {batchesCount}
          </span>
        )}
      </TabsTrigger>
    </TabsList>
    <TabsContent value="info">{/* cards: info, uso, limitaciones, riesgos */}</TabsContent>
    <TabsContent value="batches">{/* tabla o lista relacionada */}</TabsContent>
  </Tabs>
</DrawerShell>
```

### 11.4 Reglas

- **Variante de tabs:** siempre `variant="line"` (estilo subrayado) dentro de un drawer. `default` (con fondo `bg-muted`) se reserva para settings y formularios.
- **Tab por defecto:** el que tenga el contenido más crítico / informativo. Para una entidad con info + relación, `Información` va primero.
- **Badge de conteo:** incluir en el trigger cuando aplique (`Lotes 5`, `Actividad 12`). Estilo: `rounded-full border border-border/40 bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground`.
- **Tabs opcionales:** si la entidad solo tiene `Información` (sin datos relacionados), omitir el wrapper `Tabs` y renderizar el contenido directo. No forzar un único tab "decorativo".
- **Ancho del drawer:** `!w-[80vw] !max-w-[80vw] sm:!max-w-[80vw]` para detail views con tablas; `!w-[480px]` o `!w-[560px]` para detail views simples.
- **Footer del drawer:** acciones de copia (Copiar key/ID) y enlaces externos (Abrir URL). **Nunca** un "Abrir página completa".
- **Datos del tab:** pre-cargar server-side y pasar como prop. No `useEffect` ni flash de loading al cambiar de tab.

### 11.5 Prohibiciones

- ❌ Botón "Abrir página completa" o equivalente — el drawer contiene todo.
- ❌ `Tabs` con `variant="default"` dentro de un drawer (rompe la jerarquía visual).
- ❌ Drawer con un solo tab — renderizar el contenido directo sin Tabs.
- ❌ Fetch de datos al cambiar de tab — pre-cargar todo y pasar como prop.
- ❌ Links a rutas externas para ver "más detalle" de un item del tab — abrir un sub-drawer o un popover.

---

## 12. Floating Action Bar — Portal pattern

### 12.1 Problema

`position: fixed` dentro de un contenedor que tiene un `transform` aplicado **no se posiciona respecto al viewport** — se posiciona respecto al contenedor. Esto se llama **containing block**.

El `<main>` de `AppShell` aplica `animate-su-fade-in` que usa `transform: translateY(...)` durante la animación. Cualquier `position: fixed` dentro de `<main>` queda "atrapado" en ese contenedor.

**Síntoma:** la barra de acciones masivas se renderiza pero no se queda fija al fondo de la pantalla — se queda al final del contenedor scrollable.

### 12.2 Solución: portal a `document.body`

`createPortal(jsx, document.body)` saca el elemento del árbol DOM actual y lo monta en otro contenedor. Como `document.body` no tiene `transform`, `position: fixed` vuelve a funcionar contra el viewport.

### 12.3 Implementación de referencia

`src/components/data-table/data-table-bulk-action-bar.tsx`:

```tsx
'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

export function DataTableBulkActionBar({ count, onClear, children }: Props) {
  // mount guard: evita hydration mismatch con SSR
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] ...">
      {children}
    </div>,
    document.body,
  );
}
```

### 12.4 Reglas

- **z-index:** `z-[60]` (drawer es `z-50`). Modal/dialog toma precedencia.
- **Mount guard:** siempre usar `useState(false) + useEffect(setTrue)` para evitar SSR/hydration mismatch.
- **Single source of truth:** el estado de selección vive en el `<DataTable>`; el bar solo lo lee y dispara callbacks.
- **Hide cuando count === 0:** el bar no se monta si no hay selección.

### 12.5 Cuándo replicar este patrón

Usar portal a `document.body` para CUALQUIER elemento que necesite:
- `position: fixed` global (toolbars flotantes, toasts, command palettes).
- Escapar un `transform` ancestor (AppShell, dialogs anidados, animaciones de slide).

**Regla general:** si algo necesita ser "global al viewport" y vive dentro de un contenedor con `transform`, `filter`, `perspective` o `will-change: transform`, portalizar.

---

## 13. Lazy Load con IntersectionObserver

### 13.1 Propósito

Reemplazar el botón "Cargar más" por scroll automático. Más natural para listas largas — el usuario no tiene que buscar el botón al final de la tabla.

### 13.2 Comportamiento

Cuando `loadMode === 'lazy'`:

1. El padre renderiza `data.slice(0, lazyVisibleCount)`.
2. `lazyVisibleCount` empieza en `initialPageSize` (default 20).
3. Un `<div>` invisible (`h-px w-full`) al final del footer es observado por un `IntersectionObserver` con `rootMargin: "120px 0px"`.
4. Cuando el sentinel entra en el viewport (con 120px de提前), el observer dispara `onLoadMore()`.
5. El padre incrementa `lazyVisibleCount` por `initialPageSize` (u otro paso).
6. Si `lazyVisibleCount >= data.length`, se quita el sentinel.
7. Cambios en `filters`, `globalFilter`, `sort` o `loadMode` resetean `lazyVisibleCount` a `initialPageSize`.

### 13.3 Implementación de referencia

`src/components/data-table/data-table-load-more.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

interface DataTableLoadMoreProps {
  totalRows: number;
  shownRows: number;
  onLoadMore: () => void;
  loading?: boolean;
}

export function DataTableLoadMore({ totalRows, shownRows, onLoadMore, loading }: Props) {
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const remaining = Math.max(totalRows - shownRows, 0);
  const canLoadMore = remaining > 0;

  React.useEffect(() => {
    if (!canLoadMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) onLoadMore();
      },
      { rootMargin: '120px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 px-5 py-3 text-xs text-muted-foreground border-t border-border/40">
      {canLoadMore ? (
        <>
          <Loader2 className={cn('h-3 w-3', loading ? 'animate-spin' : 'opacity-0')} />
          <p className="tabular-nums">
            Mostrando {shownRows} de {totalRows} · {remaining} más disponibles
          </p>
        </>
      ) : (
        <p className="tabular-nums">Mostrando {shownRows} de {totalRows} resultados</p>
      )}
      {canLoadMore && <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />}
    </div>
  );
}
```

En el `<DataTable>`:

```tsx
const [lazyVisibleCount, setLazyVisibleCount] = React.useState(initialPageSize);
const isLazy = settings.loadMode === 'lazy';
const effectiveData = React.useMemo(
  () => (isLazy ? data.slice(0, lazyVisibleCount) : data),
  [data, isLazy, lazyVisibleCount],
);

React.useEffect(() => {
  setLazyVisibleCount(initialPageSize);
}, [isLazy, initialPageSize, globalFilter, columnFilters, sorting]);

// En initialState del useReactTable:
pagination: { pageSize: isLazy ? Number.MAX_SAFE_INTEGER : initialPageSize }

// En el footer:
{isLazy ? (
  <DataTableLoadMore
    totalRows={data.length}
    shownRows={effectiveData.length}
    onLoadMore={() => setLazyVisibleCount((prev) => Math.min(prev + initialPageSize, data.length))}
  />
) : (
  <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
)}
```

### 13.4 Reglas

- **`rootMargin: "120px 0px"`** — activa carga antes de que el sentinel llegue al borde. 120px es un buen balance entre naturalidad y trigger temprano.
- **Reset en cambios de filtro/sort** — el `useEffect` con deps `[isLazy, initialPageSize, globalFilter, columnFilters, sorting]` garantiza que el usuario no quede atrapado en un estado lazy inconsistente.
- **Spinner sutil** — `Loader2` con `opacity-0` cuando idle para reservar espacio y evitar layout shift.
- **Texto centrado** — `Mostrando X de Y · N más disponibles` o `Mostrando X de Y resultados` cuando se agota.
- **Sin botón** — el patrón es scroll-only. El botón reintroduce fricción innecesaria.

### 13.5 Trade-offs

| Pro | Con |
|----|-----|
| Sin acción manual del usuario | Carga datos en memoria por adelantado |
| Más natural para listas largas | No apto para >1000 filas (usar server-side pagination) |
| Reset automático en filtros | Selección masiva puede no persistir entre resets (el padre debe controlar) |

### 13.6 Cuándo NO usar lazy

- Datasets < 50 filas (overhead no compensa).
- Datasets > 1000 filas (usar server-side pagination con `manualPagination`).
- Cuando el usuario necesita saber el total de páginas de antemano.

---

## 14. Page Recipe — Construir una página CRUD

Receta para combinar todos los patrones. Aplica a cualquier página operativa de SellUp que liste + detalle entidades (fuentes, cuentas, contactos, prospectos, batches, etc.).

### 14.1 Anatomía objetivo

```
┌──────────────────────────────────────────────────────────────────┐
│ PageHeader                                                        │
│  Title (text-2xl font-semibold tracking-tight)                    │
│  Description (max-w-3xl, sin truncate)                            │
│  Actions: [Nuevo X] [Importar] [Exportar]                         │
├──────────────────────────────────────────────────────────────────┤
│ DataTable                                                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Title  Description     [search] [⚙ settings] [actions]    │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ ☐ │ Col1 ⇅▼ │ Col2 ⇅▼ │ Col3 ⇅▼ │ Col4 ⇅▼ │ Acciones     │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ ☐ │ ... datos ...                                          │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ Footer (pagination | load-more)                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                              (al seleccionar)     │
│                              ┌──────────────────────────────┐    │
│                              │ 4 Seleccionados  [act1] [act2]│    │
│                              └──────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                              ↓ click fila o context menu
┌──────────────────────────────────────────────────────────────────┐
│ DrawerShell (80vw, right)                                         │
│  Title (entity name) + description (key/ID)                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ [Información]  [Actividad N]  [Lotes N]                    │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ Cards: info, uso, limitaciones, riesgos, ...               │  │
│  └────────────────────────────────────────────────────────────┘  │
│  Footer: [Copiar key]                          [Abrir URL]       │
└──────────────────────────────────────────────────────────────────┘
```

### 14.2 Checklist de implementación

**Page layer (`page.tsx` — server component):**

- [ ] Pre-cargar datos del viewmodel server-side (no fetch client-side).
- [ ] Pre-cargar datos relacionados que se mostrarán en el drawer (ej. batches, actividad).
- [ ] Pasar todo al client component como props.
- [ ] Pasar `requireActiveUser()` y verificar auth en el borde.

**Client layer (`-client.tsx` — `'use client'`):**

- [ ] Definir `columns: ColumnDef<T>[]` con `meta.label` en cada columna visible.
- [ ] Definir `bulkActions[]` con `confirm: {}` para acciones destructivas.
- [ ] Definir `contextMenu.items` con "Ver detalle" que abra el drawer.
- [ ] State local: `detailOpen`, `selectedEntity`.
- [ ] Renderizar `<DataTable>` + `<Drawer>`.

**Drawer (siguiendo § 11):**

- [ ] Usar `DrawerShell` con `className="!w-[80vw] ..."`.
- [ ] Si el detalle tiene > 1 área, envolver en `<Tabs variant="line">`.
- [ ] Footer: `Copiar [key]` + `Abrir URL` (si aplica). NUNCA "Abrir página completa".

**Ajustes (auto via § 10.5):**

- [ ] El usuario controla visibilidad de columnas y modo de carga desde el `SlidersHorizontal` del toolbar.
- [ ] No exponer density toggle, edit mode, ni view options popover (retirados).

### 14.3 Componentes a importar (los reutilizables)

```tsx
import { DataTable, DataTableRowActions } from '@/components/data-table';
import { PageHeader } from '@/components/shared/page-header';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
```

### 14.4 Anti-patterns (NO hacer)

- ❌ Dos botones/popovers separados para "ajustes" y "filtros" — todo vive en un solo `DataTableSettingsDrawer`.
- ❌ CSV export como acción en toolbar sin endpoint real — quitar o implementar primero.
- ❌ Edit mode, density toggle, o view options popover — features retiradas.
- ❌ Lazy load con botón "Cargar más" — usar IntersectionObserver (§ 13).
- ❌ Drawer de detalle que enlaza a "página completa" — el drawer es el detalle completo (§ 11).
- ❌ Tabla de detalle con múltiples Drawer/Dialog anidados — usar Tabs (§ 11).
- ❌ Hardcodear colores, fuentes, sombras o radius — usar tokens (§ 3-5).

### 14.5 Validación final

```bash
npm run lint       # 0 errors
npm run typecheck  # tsc --noEmit pasa
npm run build      # Production build exitoso
```

Verificar en light + dark mode que:
- `PageHeader` no truncates la descripción.
- Tabla muestra ~20 filas en paginación, scroll infinito en lazy.
- Drawer muestra tabs y `Copiar key` funciona.
- Bulk action bar aparece fija al fondo cuando hay selección.
- Tabs y bulk bar no se solapan visualmente (z-index correcto).

---

## 15. Scroll interno de tabla — Page fijo / Tabla scrolleable

### 15.1 Propósito

El usuario espera que en una página CRUD el **título + métricas queden siempre visibles** mientras navega por la lista. Si toda la página scrollea, los KPIs de cabecera desaparecen en cuanto el usuario pasa las primeras 5-10 filas, y el contexto operativo se pierde.

**Regla:** en una página con tabla, **PageHeader + cards de métricas son fijos** (sticky en la parte superior del viewport). **Solo las filas de la tabla** generan scroll interno (con sticky thead dentro del contenedor scrollable).

### 15.2 Anatomía objetivo

```
┌──────────────────────────────────────────────────────────────────┐  ← fixed
│ PageHeader                                                        │
│  Catálogo de fuentes                                              │
│  Descripción operativa…                                           │
├──────────────────────────────────────────────────────────────────┤  ← fixed
│ [Total: 12]  [Verificadas: 8]  [Requieren: 2]  [Pendientes: 1] … │  ← metrics
├══════════════════════════════════════════════════════════════════┤
║ ☐ │ Nombre ⇅▼ │ País ⇅▼ │ Estado ⇅▼ │ Tipo ⇅▼ │ …  │ ║  ← sticky
╟───┼───────────┼─────────┼──────────┼─────────┼─────╢  ← thead
║ ☐ │ fuente-01 │ CO      │ ● ok     │ api     │     ║
║ ☐ │ fuente-02 │ MX      │ ● ok     │ api     │     ║  ← scroll
║ ☐ │ fuente-03 │ …       │ …        │ …       │     ║  ← (filas)
║ ☐ │ …         │         │          │         │     ║
║ ☐ │ fuente-12 │ AR      │ ● warn   │ manual  │     ║
╠═══╧═══════════╧═════════╧══════════╧═════════╧═════╣
║ Mostrando 20 de 12 · footer pagination / lazy      ║  ← footer
└─────────────────────────────────────────────────────┘
```

### 15.3 Componente: `<DataTablePage>`

**Ubicación:** `src/components/shared/data-table-page.tsx`

Encapsula el layout. Recibe título/descripción/acciones para `PageHeader`, métricas opcionales, y el contenido scrollable (típicamente `<DataTable fillHeight />`).

```tsx
<DataTablePage
  title="Catálogo de fuentes"
  description="Vista operativa de las fuentes de datos."
  backHref="/settings"
  actions={<Button>Nueva fuente</Button>}
  metrics={
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <MetricCard label="Total" value={12} />
      <MetricCard label="Verificadas" value={8} />
      {/* … */}
    </div>
  }
>
  <DataTable fillHeight columns={cols} data={rows} ... />
</DataTablePage>
```

Internamente:

```tsx
<div className="flex flex-1 min-h-0 flex-col gap-6">
  <div className="shrink-0">
    <PageHeader title={title} description={description} actions={actions} backHref={backHref} />
  </div>
  {metrics && <div className="shrink-0">{metrics}</div>}
  <div className="flex flex-1 min-h-0 flex-col">{children}</div>
</div>
```

`gap-6` entre secciones. `shrink-0` en header y métricas para que no se colapsen. `flex-1 min-h-0` en el área de contenido para que ocupe el resto y permita scroll interno.

### 15.4 Prop `fillHeight` en `<DataTable>`

Activa el scroll interno. Cambia tres cosas:

1. **Outer wrapper:** `h-full min-h-0 flex flex-col` (en vez de solo `flex-col`).
2. **Card:** `flex h-full min-h-0 flex-col overflow-hidden`.
3. **Table wrapper:** `su-table-scroll` = `flex-1 min-h-0 overflow-auto`. Reemplaza `max-h-[60vh]` del `stickyHeader` prop.
4. **Table:** `su-table-sticky` se aplica automáticamente → thead sticky dentro del scroll container.

```tsx
<DataTable fillHeight columns={cols} data={rows} ... />
```

### 15.5 Requisito: AppShell flex-col

El `<DataTablePage>` requiere un **flex container con altura definida** para que `flex-1 min-h-0` funcione. El `AppShell` ya provee esto: `<main>` es `flex flex-col overflow-hidden` y su inner div es `flex flex-1 min-h-0 flex-col`. Por tanto, basta con que la página retorne `<DataTablePage>` directamente.

**No hace falta** envolver con un `div` extra. La estructura es:

```
AppShell
└── main (flex flex-col overflow-hidden)
    └── div (flex flex-1 min-h-0 flex-col, padding, animate-su-fade-in)
        └── <DataTablePage>
            ├── PageHeader (shrink-0, fixed)
            ├── Metrics (shrink-0, fixed)
            └── DataTable fillHeight (flex-1, scroll interno)
```

### 15.6 Reglas

- **El `transform` del `animate-su-fade-in` no rompe el layout.** Solo afecta a `position: fixed` descendientes. Como sheets y bulk action bar ya están portaled a `document.body`, no hay conflicto.
- **`min-h-0` es obligatorio** en todos los niveles de la cadena flex (main → inner div → DataTablePage → área de contenido). Sin él, los hijos no pueden reducir su altura para scrollear.
- **Padding va en el inner div del AppShell**, no en el `DataTablePage`. El `DataTablePage` no añade padding propio.
- **El bulk action bar sigue funcionando** porque está portaled a `document.body` (§ 12). Aparece flotante al fondo del viewport independientemente del scroll de la tabla.
- **Métricas opcionales.** Si la página no tiene métricas, omitir el prop `metrics`. La tabla se queda con todo el alto disponible.
- **Drawer de detalle abre encima** sin verse afectado por el scroll interno. El sheet está en `z-50`, el bulk action bar en `z-[60]`.

### 15.7 Cuándo NO usar `<DataTablePage>`

- Páginas sin tabla (forms cortos, settings simples, dashboards) — usar el layout directo dentro del AppShell sin envoltorio extra.
- Páginas con `<ModulePlaceholder>` — placeholders son cortos, no necesitan fillHeight.
- Páginas con tablas muy pequeñas (≤5 filas) — el fillHeight no aporta valor.

### 15.8 Anti-patterns

- ❌ **Página completa scrolleable con tabla adentro** — el usuario pierde el contexto de los KPIs al hacer scroll.
- ❌ **`max-h-[60vh]` hardcodeado en la tabla** — depende del viewport, no se adapta a distintas alturas. Usar `fillHeight`.
- ❌ **Tabla con `overflow: visible` + `position: sticky` en thead** — sticky solo funciona con un ancestor scrollable. La cadena debe ser explícita: tabla → wrapper con `overflow-auto` → contenedor con altura definida.
- ❌ **PageHeader en un `<header>` sticky fuera de `<DataTablePage>`** — duplica el wiring del layout. Usar el componente.
- ❌ **Mover el padding a `<DataTablePage>`** — el padding vive en el inner div del AppShell para ser consistente en toda la app.

### 15.9 Composición: cómo se ve una página completa

```tsx
// page.tsx (server component)
import { DataTablePage } from '@/components/shared/data-table-page';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { SourceCatalogClient } from './source-catalog-client';

export default async function SourceCatalogPage() {
  const viewModel = getSourceCatalogViewModel();
  const { metrics } = viewModel;

  return (
    <DataTablePage
      title="Catálogo de fuentes"
      description="Vista operativa…"
      backHref="/settings"
      metrics={<MetricsRow cards={metricCards} />}
    >
      <SourceCatalogClient viewModel={viewModel} />
    </DataTablePage>
  );
}
```

```tsx
// source-catalog-client.tsx ('use client')
export function SourceCatalogClient({ viewModel }: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <>
      <DataTable
        fillHeight
        columns={columns}
        data={viewModel.sources}
        getRowId={(row) => row.key}
        title="Listado de fuentes"
        enableRowSelection
        contextMenu={...}
        onRowClick={(row) => setDetailSource(row)}
      />
      <SourceDetailDrawer
        source={detailSource}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  );
}
```
