# Migración al tema Azul de Thema — guía de pantalla

**Referencia visual:** `~/Documents/Thema Shadcn` (sistema de diseño Thema, preset `thema` = «Azul»).
**Tokens:** `src/app/globals.css` (generados con `themeToCss(findPreset("thema"), "md")`).
**Alcance:** toda la UI operativa de SellUp. El panel de marca del login sigue siendo la única excepción editorial.

La base ya está migrada: tokens, primitivos (`src/components/ui`), marcos compartidos
(`src/components/shared`), shell (`src/components/layout`) y DataTable. Esta guía es lo que se
aplica **pantalla por pantalla** para que el resto del producto se lea como el mismo sistema.

---

## 1. Qué cambió en la base (no lo repitas a mano)

| Pieza | Ahora |
|---|---|
| Fondo de app | blanco azulado `#f7faff` + halo radial (`page-atmosphere`) |
| Card / `SurfaceCard` / `MetricCard` / DataTable | `rounded-2xl border-border/60 bg-card shadow-card` |
| Botón | `rounded-md` (10px), alto 40 (`sm` 32, `xs` 28; iconos `icon` / `icon-sm` / `icon-xs`). `destructive` es un tinte; el rojo sólido es `destructive-solid` (solo confirmación final). Sólidos de estado: `success`, `warning` |
| Input / Select / Textarea | alto 40, `rounded-md`, `bg-card` (oscuro: `bg-muted`). Compactos: `<Input inputSize="sm">`, `<SelectTrigger size="sm">` (32px, para barras de filtros) |
| EmptyState | tarjeta punteada; `variant="plain"` sin marco para usarlo dentro de una card o tabla |
| Drawer (`Sheet`, `DrawerShell`) | flota a 12px de los bordes, `rounded-2xl`, `shadow-drawer`, entra deslizando su ancho completo |
| Diálogo | `rounded-2xl`, `shadow-drawer`, velo tenue con desenfoque de 2px, pie `bg-muted/40` |
| Pestañas | pista `bg-tab-track`; activa = superficie elevada + texto primario. `segmented` = activa rellena de primario |
| Riel lateral | claro (superficie + borde), ítem activo `bg-sidebar-accent text-primary` |
| Badge | variantes semánticas: `neutral` `positive`/`success` `warning` `negative` `info` `brand` |
| Barra de acciones masivas | `bg-nav text-nav-foreground rounded-3xl shadow-rail` |

Componentes nuevos: `@/components/shared/drawer-section` (`DrawerSection`).

## 1 bis. Componentes de Thema disponibles en SellUp

Thema no se instala como paquete (usa Tailwind 3 + Radix + framer-motion; SellUp, Tailwind 4 + Base UI).
Sus componentes están **portados**: mismo nombre, mismas props y misma anatomía. Antes de escribir marcado a
mano, busca aquí.

| Familia | Import | Piezas |
|---|---|---|
| Shell | `@/components/layout` | `AppShell` (menú lateral desplegable + cabecera con migas, búsqueda ⌘K, avisos, tema y cuenta) |
| Iconos | `@/icons` | Los iconos por su nombre de siempre (`Building2`, `Users`…), dibujados con Hugeicons. **Nunca** `lucide-react` directo |
| Tipografía | `@/components/typography` | `Heading`, `Text` |
| Página | `@/components/shared/*` | `PageHeader` (con `breadcrumbs`), `DataTablePage`, `SurfaceCard`, `SectionHeader` |
| Navegación | `@/components/navigation/*` | `Breadcrumbs`, `Stepper`, `TabsNav` (pestañas de página con icono y contador) |
| Datos | `@/components/data-display` | `StatusBadge`, `TableShell`, `Timeline` (`density="compact"` en `TimelineItem`), `ListItem`/`ListItemGroup`, `Kanban` |
| Tablas operables | `@/components/data-table` | `DataTable` (título + total, búsqueda, ajustes, selección, barra masiva) |
| Métricas y avisos | `@/components/shared/*` | `MetricCard` (acento, chip, píldora de variación, `hint`, `chart`), `DeltaPill`, `AttentionStrip` + `AttentionAction` |
| Filtros | `@/components/filters/*` | `FilterChips` (chips con contador), `FilterBar` |
| Búsqueda | `@/components/search` | `GlobalSearch` (⌘K) |
| Acciones | `@/components/action-rail` | `DataListActionRail`, `DrawerActionRail`, `RailButton`, `ActionFab` |
| Ventanas | `@/components/shared/*` | `DrawerShell`, `DrawerSection`, `ModalShell`, `ConfirmDialog` |
| Formularios | `@/components/forms/*` | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FormSection`, `SearchableSelect`, `MultiSelect` |
| Estados | `@/components/ui/*`, `@/components/feedback/*` | `EmptyState` (`variant="plain"`, título opcional), `Skeleton`, `Spinner` (`decorative` para bloques que ya anuncian su estado), `Alert` |
| Tablas de solo lectura | `@/components/ui/table` + `TableShell` | `Table`, `TableHeader`, `TableBody`, `TableRow` (`data-state="selected"`), `TableHead`, `TableCell` — nunca `<table>` a mano |
| Pantallas de acceso | `@/components/shared/access-status-screen` | `AccessStatusScreen` (pendiente, rechazado, suspendido, archivado) |
| Fechas | `@/lib/format-date` | `formatInAppZone`, `formatAppDate`, `formatAppDateTime`, `formatAppTime`, `withAppTimeZone` — siempre con la zona fija de la aplicación; nunca `toLocaleDateString` suelto |

## 2. Escala de radios (monótona)

| Clase | px | Para |
|---|---|---|
| `rounded-xs` | 6 | checkboxes, marcas de 20px |
| `rounded-sm` | 8 | chips, avatares cuadrados, botones `xs` |
| `rounded-md` | 10 | **todo lo que se pulsa**: botones, inputs, filas de menú, badges |
| `rounded-lg` | 12 | tiles, filas de lista, celdas |
| `rounded-xl` | 14 | cards **dentro** de un panel, chips de icono |
| `rounded-2xl` | 16 | cards de página, paneles, drawers, diálogos |
| `rounded-3xl` | 24 | barra flotante |
| `rounded-full` | — | avatares, puntos de estado, contadores |

Una card anidada siempre redondea menos que la que la contiene. No hay radios arbitrarios (`rounded-[…]`).

## 3. Reglas de traducción de clases

### Superficies y bordes
- Card suelta escrita a mano (`rounded-xl border … bg-card shadow-sm`) → usa `<SurfaceCard>`; si no encaja,
  `rounded-2xl border border-border/60 bg-card shadow-card`.
- Card dentro de otra card / de un drawer → `rounded-xl border border-border/60 bg-card` (sin sombra) o `bg-surface-subtle`.
- `border-border/10 … /50`, `border-su-border-subtle` → `border-border/60`. Divisorias internas: `border-border/50`.
- Relleno de sección apagada `bg-muted/20 … /50`, `bg-accent/30` → `bg-surface-subtle` (hundida) o `bg-surface-muted` (teñida).
- Hover de fila/ítem `hover:bg-accent`, `hover:bg-muted/50` → `hover:bg-surface-muted`.
- Sombras: `shadow-sm`/`shadow-[…]` en cards → `shadow-card`; `shadow-md`/`shadow-lg` en flotantes → `shadow-drawer`.
  Prohibido `shadow-xl`, `shadow-2xl` y `shadow-[…]` arbitrarias.

### Color
- `bg-su-brand` → `bg-primary`; `text-su-brand` → `text-primary`; `bg-su-brand-soft`, `bg-su-brand/10` → `bg-primary/10`.
- `text-white` sobre primario → `text-primary-foreground`.
- Gradiente `from-su-brand to-su-accent-cool` (avatares, chips) → `bg-primary text-primary-foreground`
  (la marca del producto usa `bg-brand-gradient`). Los gradientes de **IA** (`su-ai-*`) se conservan tal cual.
- Estados — nada de paleta cruda de Tailwind:
  | Antes | Ahora |
  |---|---|
  | `text-emerald-*` / `text-green-*` (+ su `dark:`) | `text-success` |
  | `bg-emerald-500/10`, `bg-emerald-50`, `dark:bg-emerald-950/…` | `bg-success/10` |
  | `border-emerald-*` | `border-success/20` |
  | `bg-emerald-500` / `-600` sólido | `bg-success` |
  | `text-amber-*` / `yellow` / `orange` | `text-warning` |
  | `bg-amber-500/10`, `bg-amber-50` … | `bg-warning/15` |
  | `border-amber-*` | `border-warning/25` |
  | `text-red-*` / `rose` | `text-destructive` |
  | `bg-red-500/10`, `bg-red-50` … | `bg-destructive/10` |
  | `border-red-*` | `border-destructive/20` |
  | `text-blue-*` / `sky` / `indigo` | `text-info` (o `text-primary` si es marca) |
  | `bg-blue-500/10` … | `bg-info/10` |
  | `slate` / `zinc` / `gray` | `text-muted-foreground`, `bg-muted`, `border-border` |
  Elimina el par `dark:` cuando el token ya resuelve los dos modos.
- Un chip de estado hecho a mano (`inline-flex … rounded-full bg-emerald-500/10 text-emerald-600 …`) →
  `<Badge variant="positive|warning|negative|info|neutral|brand">`.
- Cero hex, `rgb()` o `bg-[#…]` en UI operativa.

### Tipografía
- Título de página: lo pone `PageHeader`. Título de card/sección: `text-base font-semibold tracking-tight`.
- Cuerpo `text-sm`; apoyo `text-xs text-muted-foreground`.
- Tamaños fijados: `text-[10px]`, `text-[11px]` → `text-xs`; `text-[13px]`, `text-[0.8125rem]`, `text-[14px]` → `text-sm`.
- **Sin overlines en mayúsculas**: `uppercase tracking-wider|widest|[0.1em…]` → `text-xs font-semibold text-muted-foreground` en caja normal.
- Texto secundario con opacidad (`text-muted-foreground/60`, `/70`) → `text-muted-foreground`; para hints `text-text-muted`.
- `font-extrabold`/`font-black` → `font-bold`; títulos internos `font-semibold`.
- Números: `tabular-nums`.

### Controles
- No sobrescribas radio, alto ni color de `Button`/`Input`/`Select` con `className` (fuera `rounded-full`, `rounded-xl`, `h-9`, `h-11` puestos a mano). `className` es para layout: márgenes, ancho, orden.
- Botón solo icono: `size="icon-sm"` + `aria-label`. Jerarquía por pantalla: una acción primaria, el resto `outline`/`ghost`.
- Campo de formulario: `<div className="space-y-1.5">` con `<Label>` + control + ayuda `text-xs text-muted-foreground` + error `text-xs font-medium text-destructive`. Asterisco de requerido `text-destructive`.
- Foco visible siempre: `focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40` en cualquier elemento pulsable hecho a mano.

## 4. Patrones por tipo de superficie

**Página** — `PageHeader` (título + una línea de descripción + acción primaria y como mucho dos de apoyo; si son más, menú). Secciones separadas con `space-y-6`/`gap-6`. Nada de `max-w-` de página propio: el ancho lo pone `AppShell`.

**Lista / tabla** — `DataTablePage` + `DataTable` (nunca `<Table>` directo). Estados: cargando (skeleton de la tabla), vacío (`EmptyState` con acción), error (`Alert variant="destructive"`).

**Tabla de solo lectura** (historiales, desgloses, comparaciones dentro de un drawer) — `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` de `@/components/ui/table`, nunca `<table>`/`<tr>`/`<td>` a mano: la pieza ya pone el fondo de cabecera, los bordes, la altura, el hover y la tipografía, así que en `className` solo queda lo propio (ancho, `text-right tabular-nums` en números y montos, `whitespace-normal` en texto largo, `colSpan`, `sticky`). Fila seleccionada: `data-state="selected"`. Con título propio va dentro de `TableShell` (`@/components/data-display`), que trae título, descripción, acciones, vacío y pie; si vive dentro de una card o un drawer que ya tiene título, basta un contenedor `overflow-x-auto rounded-xl border border-border/60`. Fila vacía: `empty` de `TableShell` o `EmptyState variant="plain"` en una celda con `colSpan`.

**Drawer** — `DrawerShell` con `title`, `description`, `icon`. El cuerpo se arma con `DrawerSection` (icono + título + hint + contenido) en `space-y-4`; nunca cajas con borde dentro de cajas con borde. Pie: secundaria (`outline`) a la izquierda, primaria a la derecha. Con varias áreas: `Tabs` (§ 11 Foundation).

**Modal** — `ModalShell` para formularios cortos, `ConfirmDialog` para confirmar. Un modal no hace scroll largo: si el contenido crece, es un drawer.

**Estados** — vacío: `EmptyState`. Cargando: `Skeleton` con la forma del contenido final (sin saltos de layout). Error: `Alert`. Éxito efímero: toast (`sonner`), no banners persistentes.

**Métricas** — `MetricCard`; filas de KPIs en `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`.

## 5. Experiencia — qué mejorar al revisar una pantalla

1. Jerarquía: un solo elemento dominante por vista; contraste de escala entre título, valor y apoyo.
2. Ritmo: espaciado intencional (`gap-6` entre secciones, `gap-4` entre cards, `gap-2` en filas), no padding uniforme.
3. Estados completos: hover, foco, activo, deshabilitado, cargando, vacío y error.
4. Texto largo: `truncate` + `title`, o `line-clamp-2`; nunca desbordes.
5. Responsive: sin scroll horizontal a 375px; grids que colapsan; acciones que envuelven (`flex-wrap`).
6. Accesibilidad: HTML semántico (`section`, `header`, `nav`, `ul`), `aria-label` en botones de icono, contraste AA en claro y oscuro.
7. Movimiento: solo `transform`/`opacity`, utilidades `su-*` y transiciones de 150–300ms.

## 6. Lo que NO se toca

- Comportamiento: handlers, server actions, consultas, validaciones, estado, rutas, flags.
- Texto visible, `aria-*`, `role`, `data-testid`, `id`, `name`: hay pruebas que dependen de ellos.
- Nombres de exports y props de componentes.
- Archivos de prueba (`__tests__`, `*.test.*`), salvo que un test fije una clase que cambiaste: ahí se reporta, no se edita.
- Gradientes y utilidades de IA (`su-ai-*`) y el panel de marca del login.

## 7. Cierre

```bash
node scripts/check-design-system.mjs   # 0 hallazgos
npm run lint
npm run typecheck
npm run build
```

Revisar en claro y oscuro, y a 375px.

### Qué comprueba el verificador

`scripts/check-design-system.mjs` (portado de Thema) falla si encuentra: otra librería de interfaz o un
primitivo headless fuera de `src/components/ui`; un icono importado de la librería en vez de `@/icons`; un color literal; paleta cruda de Tailwind; un tamaño de
letra, un z-index, una sombra o un radio arbitrarios; un rótulo en MAYÚSCULAS con tracking; `font-black` /
`font-extrabold`; clases `*-su-brand`; texto atenuado con opacidad; `text-white` a mano; o un
`Button` / `Input` / `SelectTrigger` / `Badge` con radio, alto o tipografía sobrescritos por `className`;
o una tabla HTML escrita a mano en un `.tsx` (regla `tabla-a-mano`: `<table>`, `<thead>`, `<tbody>`,
`<tfoot>`, `<tr>`, `<th>`, `<td>`; se usan las piezas de `@/components/ui/table`).

También falla con la regla `fecha-sin-zona`: un `toLocaleDateString(` o `toLocaleTimeString(` en un
`.tsx` / `.ts` de UI. Sin `timeZone`, la fecha se escribe en la zona de quien la pinta: el servidor (UTC)
y el navegador (Bogotá) dan días distintos para el mismo instante cerca de la medianoche y React rechaza
la hidratación (error #418). Toda fecha u hora que se pinta sale de `@/lib/format-date`
(`formatInAppZone`, `formatAppDate`, `formatAppDateTime`, `formatAppTime`), que fija `America/Bogota`;
donde se conserva un `toLocaleString` o un `Intl.DateTimeFormat`, las opciones pasan por `withAppTimeZone`.

Las excepciones se declaran en el propio script (`ALLOW`), cada una con su motivo: el panel de marca del
login, la identidad de IA (orbes y velos de carga), el logotipo de Google, los gráficos y dos archivos cuya
cadena de clases está fijada por una prueba. Para `tabla-a-mano` se admiten solo `ui/table.tsx` (es la
pieza), `ui/calendar.tsx` (rejilla de react-day-picker) y `src/components/data-table/` (la tabla operable de
TanStack, cuya cabecera reordenable necesita su propio `<th>`).
Para `fecha-sin-zona` se admiten `src/lib/format-date.ts` (es la pieza), `ui/calendar.tsx` y
`src/components/date/` (el selector de fechas trabaja a propósito con el día local de quien elige),
`src/app/api/` y los `actions.ts` de `src/modules/` (solo servidor: nombres de lote que se guardan, no
texto que se hidrata), y `prospect-date-utils.ts` y `provider-contract-plan-card.tsx`, que ya pasan un
`timeZone` explícito.
