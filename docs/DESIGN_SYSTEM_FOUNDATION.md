# SellUp Design System Foundation v0.2 — tema Azul de Thema

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

> **Tema vigente: «Azul» de Thema** (v0.2, 2026-09-30). Los valores salen del preset `thema` del sistema de
> diseño Thema (`~/Documents/Thema Shadcn`), generados con `themeToCss(findPreset("thema"), "md")`: azul clásico
> `#0C5BEF` sobre neutros fríos teñidos con el matiz 222. La guía de traducción pantalla por pantalla está en
> [`THEMA_AZUL_MIGRATION.md`](./THEMA_AZUL_MIGRATION.md) y las reglas se verifican con
> `node scripts/check-design-system.mjs` (debe dar 0 hallazgos).

### 3.1 Backgrounds y superficies

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--background` | `bg-background` | Fondo base de la app: blanco con un punto de azul (`#f7faff`) |
| `--card` | `bg-card`, `bg-surface` | Superficie de cards y paneles de contenido |
| `--surface-muted` | `bg-surface-muted` | Sección apagada / hover de fila (`#f0f4ff`) |
| `--surface-subtle` | `bg-surface-subtle` | Superficie hundida bajo una card: cabecera de tabla, pie de métrica |
| `--tab-track` | `bg-tab-track` | Pista de pestañas |
| `--popover` | `bg-popover` | Menús, popovers, drawers y diálogos |
| `--sidebar` | `bg-sidebar` | Riel lateral: superficie **clara** con borde (no un bloque navy) |
| `--nav` | `bg-nav`, `text-nav-foreground` | Navy de navegación; hoy lo usa la barra de acciones flotante |
| `--muted` | `bg-muted` | Compatibilidad shadcn; preferir `surface-muted` / `surface-subtle` |
| `--su-surface` / `--su-surface-elevated` | `bg-su-surface…` | Alias heredados |

El contenedor de página lleva además `page-atmosphere`: un halo radial del primario detrás del contenido.

**Regla de capas (dark, de más oscuro a más claro):**
```
background (#0d1321) → surface-subtle → card (#171f31) → popover → surface-muted (#212a3f)
```

### 3.2 Texto

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--foreground` | `text-foreground`, `text-text-primary` | Títulos y texto principal |
| `--muted-foreground` | `text-muted-foreground`, `text-text-secondary` | Cuerpo, subtítulos, labels |
| `--text-muted` | `text-text-muted` | Hints, placeholders, iconos inactivos |
| `--primary-foreground` | `text-primary-foreground` | Texto sobre primario. **Nunca `text-white`.** |

No se atenúa el texto con opacidad (`text-muted-foreground/60`): se elige el nivel.

### 3.3 Borders

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--border` | `border-border/60` | Borde de card y de panel (siempre al 60 %) |
| `--border` | `border-border/50` | Divisoria interna |
| `--su-border-strong` | `border-border-strong` | Borde con mayor contraste |
| `--input` | `border-input` | Borde de campos de formulario |

### 3.4 Brand / Primary

| Token CSS | Tailwind | Uso |
|---|---|---|
| `--primary` (= `--su-brand`) | `bg-primary`, `text-primary` | Azul del tema: `#0C5BEF` en claro, `#3865F5` en oscuro |
| `--brand-hover` / `--brand-pressed` | `bg-brand-hover`, `bg-brand-pressed` | Estados del botón primario |
| `--su-brand-soft` | `bg-primary/10` | Tinte del primario (chips de icono, ítem activo) |
| `--brand-gradient` | `bg-brand-gradient` | Solo la marca del producto |

**Paleta del tema Azul:**

| Rol | Light | Dark |
|---|---|---|
| Brand | `#0C5BEF` | `#3865F5` |
| Brand hover / pressed | `#0a4cc8` / `#083da1` | `#5f83f7` / `#86a1f9` |
| Background | `#f7faff` | `#0d1321` |
| Surface (card) | `#ffffff` | `#171f31` |
| Surface muted | `#f0f4ff` | `#212a3f` |
| Surface subtle | `#fafbff` | `#0f1729` |
| Tab track | `#ebeffa` | `#10141e` |
| Nav | `#0f1729` | `#0f1729` |
| Text primary | `#303646` | `#ecedee` |
| Text secondary | `#5c6270` | `#9ea1a9` |
| Text muted | `#989ca4` | `#6e727c` |
| Border | `#cfd0d3` | `#3e4556` |
| Positive | `#059669` | más luminoso |
| Negative | `#E9343C` | más luminoso |
| Warning | `#FF7B0D` | más luminoso |
| Info | `#4A74EE` | más luminoso |
| AI gradient | `#2d5cf7` → `#9b14f5` → `#f2024e` → `#ff600a` | versión luminosa |

### 3.5 Estados semánticos

Positivo, negativo, warning e info **no cambian con el tema**: son significado, no decoración.

| Propósito | Texto | Tinte | Borde | `Badge` |
|---|---|---|---|---|
| Éxito | `text-success` | `bg-success/10` | `border-success/20` | `variant="positive"` |
| Advertencia | `text-warning` | `bg-warning/15` | `border-warning/25` | `variant="warning"` |
| Error / destructivo | `text-destructive` | `bg-destructive/10` | `border-destructive/20` | `variant="negative"` |
| Info | `text-info` | `bg-info/10` | `border-info/20` | `variant="info"` |
| Neutro | `text-muted-foreground` | `bg-muted/60` | `border-border/50` | `variant="neutral"` |
| Marca | `text-primary` | `bg-primary/10` | `border-primary/20` | `variant="brand"` |

**Prohibida la paleta cruda de Tailwind** (`text-emerald-500`, `bg-amber-500/10`, `text-red-600`…) y cualquier color literal.

---

## 4. Tipografía

### Estrategia

SellUp usa **Inter** como única familia tipográfica (`--font-sans`), tanto para body como para headings, con
`letter-spacing: -0.011em` y los rasgos `cv05 cv08 cv11 ss01` (igual que Thema).

### Escala de headings (h1–h6)

Definida en `globals.css` (`@layer base`):

| Elemento | Clases | Uso típico |
|---|---|---|
| `h1` | `text-2xl font-bold tracking-tight` | Título de página (vía `PageHeader`) |
| `h2` | `text-xl font-bold tracking-tight` | Título de sección principal |
| `h3` | `text-lg font-semibold tracking-tight` | Subtítulo de bloque |
| `h4` | `text-base font-semibold tracking-tight` | Título de card (vía `SurfaceCardHeader`) |
| `h5` | `text-sm font-semibold tracking-tight` | Sub-encabezado |
| `h6` | `text-xs font-semibold text-muted-foreground` | Rótulo de grupo |

### Jerarquía de uso

| Nivel | Clase | Uso |
|---|---|---|
| Page title | `text-2xl font-bold tracking-tight` | Uno por vista, vía `PageHeader` |
| Section / card title | `text-base font-semibold tracking-tight` | Títulos dentro de cards |
| Sub-sección | `text-sm font-semibold` | Encabezados dentro de un drawer |
| Body | `text-sm` | Contenido general |
| Caption / metadata | `text-xs text-muted-foreground` | Fechas, IDs, labels secundarios |
| Rótulo de grupo | `text-xs font-semibold text-muted-foreground` | En caja normal |

Reglas:
- **Sin tamaños fijados** (`text-[11px]`, `text-[13px]`): solo la escala. El mínimo es `text-xs`.
- **Sin overlines en MAYÚSCULAS con tracking**: Thema rotula en caja normal.
- Peso máximo `font-bold`; nada de `font-black` / `font-extrabold`.
- Números en `tabular-nums`.

### Iconos

`stroke-width: 1.75` en los iconos `lucide-react` (más fino que el `2` por defecto). El spinner conserva su grosor.

### Regla login vs. app interna

El panel de marca del login es la única excepción editorial (escalas grandes, glows). La app interna sigue la escala.

---

## 5. Radios, bordes y sombras

### Radios

Escala **Thema**, monótona y anclada en el shell: `xs 6 · sm 8 · md 10 (base) · lg 12 · xl 14 · 2xl 16 · 3xl 24`.
Una card anidada siempre redondea un poco menos que el panel que la contiene.

| Clase | Valor | Uso |
|---|---|---|
| `rounded-xs` | 6px | Checkboxes, marcas de 20px |
| `rounded-sm` | 8px | Chips, avatares cuadrados, botones `xs` |
| `rounded-md` | 10px | **Todo lo que se pulsa**: botones, inputs, filas de menú, badges |
| `rounded-lg` | 12px | Tiles, filas de lista, celdas |
| `rounded-xl` | 14px | Cards dentro de un panel, chips de icono |
| `rounded-2xl` | 16px | Cards de página, paneles, drawers, diálogos |
| `rounded-3xl` | 24px | Barra de acciones flotante |
| `rounded-full` | — | Avatares, puntos de estado, contadores |

Prohibidos los radios arbitrarios (`rounded-[…px]`).

### Sombras

Tres sombras, teñidas en navy (nunca negro neutro):

| Clase | Uso |
|---|---|
| `shadow-card` | Reposo de cualquier superficie: card, métrica, tabla, pestaña activa |
| `shadow-drawer` | Lo que flota sobre la página: drawers, diálogos, popovers, menús |
| `shadow-rail` | La barra de acciones flotante (lo único que flota sobre contenido vivo) |

Una card estática no reacciona al puntero: solo se eleva (`hover:shadow-drawer`) si es pulsable.

**Prohibido:** `shadow-sm/md/lg/xl/2xl` sueltas y `shadow-[…]` arbitrarias.

### Glows y halos

Solo en el panel de marca del login y en la identidad de IA (`su-ai-glow`). No usar en la app interna.

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

Props: `title` (requerido), `description`, `breadcrumbs`, `actions`, `meta`, `backHref`, `width`, `className`.

El título es un `Heading` (h1 único de la vista, `text-2xl font-bold`). Usa en todas las páginas como primer elemento del contenido. `breadcrumbs` no pinta un renglón sobre el título: se publican en la cabecera del shell (ver abajo). `width` (`narrow` 720 · `normal` 1140 · `wide` 1600 · `full`) acota la cabecera; para acotar la página entera, `PageShell width` (`@/components/layout/page-shell`).

---

### Cabecera y menú del shell

**Ubicación:** `src/components/layout/` — port de Thema `app-shell`.

- **Ruta.** La cabecera pinta «SellUp › sección». Cada pantalla publica sus migas (`PageHeader breadcrumbs`, `DataTablePage breadcrumbs`, `SettingsPage trail`) y la cabecera las añade; lo hace `ShellBreadcrumbs` (`shell-header-slot.tsx`) con un portal, sin desajuste de hidratación. `ShellHeaderSlot` sirve para pintar cualquier otra identidad de pantalla en ese hueco.
- **Notificaciones.** Popover anclado a la campana (no drawer): «N nuevas», lista, «Marcar leídas» y «Ver todas las notificaciones».
- **Cuenta** (`AccountMenu`). Identidad y cerrar sesión. El tema y la configuración NO van aquí.
- **Marca** (`WorkspaceMenu`, en el menú lateral). Tema (Claro / Oscuro / Como el sistema) y la configuración agrupada. No hay botón de tema suelto en la cabecera.
- **Menú lateral** (`AppSidebar` + `SidebarIconRail`). Secciones plegables con sus vistas (Empresas, Contactos, Configuración); contraído, cada icono despliega sus vistas al pasar el puntero. El árbol sale de `sidebar-nav.ts` y respeta `navAccess`.
- **Búsqueda** (`GlobalSearch`, ⌘K). Pestañas de alcance, recuento y grupos; los registros (empresas, contactos) se piden al escribir.

### Avisos efímeros (toasts)

Un solo `Toaster`: `ThemaToaster` (`src/components/feedback/thema-toaster.tsx`), montado en `src/app/layout.tsx`. Arriba a la derecha, 76px bajo el borde (libra la cabecera y no tapa la barra de acciones inferior), sobrio (`richColors={false}`), con botón de cerrar e iconos del sistema. Las pantallas solo llaman `toast(...)` de `sonner`; nunca montan otro `Toaster`.

### Confirmaciones y modales

- `ConfirmDialog` (`src/components/shared/confirm-dialog.tsx`) va sobre `AlertDialog`: **sin X y sin cierre por clic afuera**. Foco en Cancelar (o en el campo de `confirmationText`). Tono `destructive`: título en rojo, chip del tono y botón rojo sólido. No se cierra sola al confirmar. `description` es una frase; un error o un `Alert` van en `children`.
- `ModalShell` (`src/components/shared/modal-shell.tsx`) para formularios cortos: `title`, `description`, `children`, `actions`, `size` (`sm` 384 · `md` 448 · `lg` 512 · `xl` 576). Las pantallas no montan `<Dialog>` a mano.

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

Props de `SurfaceCard`: `elevated` (añade `shadow-drawer`), `noPadding` (para tablas o contenidos custom). Reposo: `rounded-2xl border-border/60 bg-card shadow-card`, padding 24px.

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

Card especializada para KPIs / métricas operativas. Sin borde visible — la separación contra el fondo se logra con un shadow muy sutil (`0 1px 2px 0 rgb(0 0 0 / 0.04)` en light, mismo peso invertido en dark). Esto replica el estilo "elevación sin contorno" del template UBITS para survey analytics.

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

- **Contenedor** — `rounded-2xl bg-card` + shadow sutil de 1px. Sin `border` (la sombra hace la separación).
- **Título** — `text-sm font-semibold text-foreground/80` (title-case, no uppercase)
- **Descripción** — `text-xs text-muted-foreground/70 line-clamp-1` (gris más claro que el título, indica "qué mide")
- **Value** — `text-3xl font-bold tracking-tight tabular-nums` (lo dominante visualmente)
- **Subtitle** — unidad o nota al lado del value (`text-sm font-medium text-muted-foreground/70`)
- **DeltaPill** opcional — variación porcentual con icono TrendingUp/Down/Minus
- **Icon** — chip de icono configurable (8×8 en variantes estándar, 12×12 en `left-large`); fondo tinted viene del consumidor
- **Footer** opcional — banda inferior con `border-t border-border/40` y `bg-muted/20`

Posición del icono (`iconPosition`):

| Valor | Layout | Uso típico |
|-------|--------|------------|
| `right` (default) | Icono en la esquina superior derecha | Cards tipo resumen, KPIs estándar |
| `top` | Icono sobre el título, en su propia línea | Resúmenes operativos (`usage`, `ai-usage`, `automations`) |
| `left-large` | Icono grande a la izquierda, value+label apilados a la derecha | Resaltar proveedor/modelo activo (`settings/ai`) |

```tsx
// iconPosition="right" (default)
<MetricCard
  title="Verificadas"
  description="Con conexión operativa confirmada"
  value={12}
  icon={
    <div className="rounded-lg p-1.5 bg-success/10">
      <CheckCircle2 className="h-4 w-4 text-success" />
    </div>
  }
/>

// iconPosition="top"
<MetricCard
  title="Ejecuciones"
  description="de agentes"
  value={420}
  iconPosition="top"
  icon={
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
      <Bot className="h-4 w-4" />
    </div>
  }
/>

// iconPosition="left-large"
<MetricCard
  title="Proveedor activo"
  description="Proveedor configurado"
  value="Anthropic"
  iconPosition="left-large"
  icon={
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-su-brand-soft">
      <BrainCircuit className="h-6 w-6 text-su-brand" />
    </div>
  }
/>
```

Variantes soportadas: `loading` (skeleton interno), `error` (mensaje + título).

Reglas:
- Usar `MetricCard` en lugar de `<SurfaceCard>` con markup manual para KPIs. Toda card de métricas de la plataforma debe pasar por este componente.
- En grillas grandes (`grid-cols-6`, `grid-cols-5`) el gap debe ser `gap-3` o `gap-4`.
- `valueClassName` permite tintar el value (ej. `text-success` para métricas positivas) y agregar `font-mono` cuando aplique.
- El título debe llegar en title-case desde la página (no transformarlo dentro del componente).
- El estilo del `icon` (tamaño, color, fondo) viene desde el consumidor — el componente solo define el slot.

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

El motor es TanStack Table v8; la **experiencia** es la de la tabla de Thema. Las piezas visuales que no dependen del motor viven en `data-display/` (portadas de Thema) y `data-table/` las conecta con TanStack.

```
src/components/data-display/           # Piezas de Thema, sin motor
├── table-header-controls.tsx         # FilterSortHeader, SortOnlyHeader, HeaderSortButton, HeaderFilterButton,
│                                     #   SelectionHeaderMenu, HeaderSelectAllCheckbox, HeaderSelectionMark
├── table-config-button.tsx           # TableConfigButton — panel «Configurar tabla» (Popover)
├── use-table-config.ts               # useTableConfig — preferencias por tabla en localStorage
├── use-column-drag.ts                # Arrastre nativo de la lista de columnas del panel
└── row-actions-menu.tsx              # RowActionsMenu — «⋯» de una fila

src/components/data-table/             # La tabla operable (TanStack)
├── data-table.tsx                    # Core: estado, columnas de servicio, render
├── data-table-types.ts               # DataTableProps, DataTableBulkAction, DataTableListRowState…
├── data-table-utils.ts               # multiValueFilter, ids/labels de columna, aria-sort
├── data-table-column-meta.ts         # DataTableColumnMeta (+ augmentación de ColumnMeta)
├── data-table-toolbar.tsx            # Título + total · acciones · buscador que se abre · Configurar; modo «selección»
├── data-table-active-filters.tsx     # Chips «Columna: valor ×» + «Limpiar todo»
├── data-table-column-header.tsx      # Cabecera: orden con un clic + embudo aparte
├── data-table-selection-header.tsx   # Menú de selección (paginado) / casilla (scroll infinito)
├── data-table-row.tsx                # Fila: clic, selección, celdas fijadas, menú contextual
├── data-table-pagination.tsx         # Pie paginado: «Página x de y · N <sustantivo>»
├── data-table-load-more.tsx          # Pie de scroll infinito + centinela (IntersectionObserver)
├── data-table-column-reorder.tsx     # Arrastre de cabeceras (dnd-kit)
├── data-table-row-reorder.tsx        # Arrastre de filas (dnd-kit)
├── data-table-row-actions.tsx        # Acciones por fila → RowActionsMenu
├── data-table-context-menu.tsx       # Menú de clic derecho
├── data-table-bulk-actions.tsx       # `bulkActions` → acciones de la barra flotante (§ 12) + acciones en la cabecera de la lista («En la pantalla»)
├── use-column-auto-fit.ts            # Reparto del ancho y posición de columnas fijadas
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
| `enableRowSelection` | `boolean` | `false` | Checkbox column; la selección va a la barra flotante de la pantalla (§ 12) |
| `bulkActions` | `DataTableBulkAction<T>[]` | `[]` | Acciones masivas |
| `contextMenu` | `DataTableContextMenuConfig<T>` | — | Right-click menu items |
| `stickyHeader` | `boolean` | `false` | `thead` sticky en scroll vertical |
| `initialPageSize` | `number` | `20` | Filas por página / lote de lazy load |
| `pageSizeOptions` | `number[]` | `[10, 20, 50, 100]` | Opciones de page-size (modo paginación) |
| `enableColumnReorder` | `boolean` | `true` | Drag-and-drop en headers |
| `pinnedColumnIds` | `string[]` | `["select", "reorder", "actions"]` | Columnas de servicio: no se mueven, ni se ocultan, ni se fijan |
| `manualSorting` / `manualFiltering` | `boolean` | `false` | Si `true`, el padre controla sort/filter via estado externo |
| `onRowClick` | `(row: T) => void` | — | Click handler (no confundir con selección) |
| `rowClickable` | `boolean` | `false` | Cursor + hover; necesario junto a `onRowClick` |
| `emptyState` | `ReactNode` | — | Contenido cuando `data.length === 0` |
| `loading` | `boolean` | `false` | Skeleton overlay |
| `hideToolbar` | `boolean` | `false` | Oculta toolbar completamente |
| `className` | `string` | — | Wrapper extra classes |
| `tableId` | `string` | — | Identidad estable de la tabla. Con ella se recuerda la configuración en `localStorage` (`sellup:table:<tableId>`). Sin ella funciona igual pero no recuerda |
| `noun` | `string` | `"resultados"` | Sustantivo en plural de lo que se lista («empresas», «contactos»): pie, buscador y panel |
| `nounGender` | `"f" \| "m"` | `"m"` | «3 seleccionadas» frente a «3 seleccionados» |
| `defaultRowsMode` | `"lazy" \| "paged"` | `"lazy"` | Cómo llegan las filas de fábrica |
| `getRowLabel` | `(row: T) => string` | — | Nombre de la fila en su casilla y en su menú («Acciones de Acme») |
| `renderListItem` | `(row, state) => ReactNode` | — | Dibujo de una fila en la vista «Lista». Sin ella el panel no ofrece la vista |
| `settingsExtraSections` | `ReactNode` | — | Secciones propias de la pantalla dentro de «Configurar tabla» (p. ej. filtros de alcance) |
| `fillHeight` | `boolean` | `false` | Llena el alto del padre con scroll interno (§ 15) |

### 10.4 Cómo llegan las filas

Lo elige quien mira en «Configurar tabla» y se recuerda por `tableId`:

| Modo | Comportamiento | Pie |
|------|----------------|-----|
| `'lazy'` — **Scroll infinito** (de fábrica) | Se cargan `initialPageSize` filas y un centinela al final del `<tbody>` trae el siguiente tramo al asomar (§ 13) | `Mostrando n de N <sustantivo>` |
| `'paged'` — **Paginación** | Página por página | `Página x de y · N <sustantivo>` + tamaño de página + Anterior / Siguiente |

En los dos modos el corte se hace **después** de filtrar y ordenar (el scroll infinito es una sola página que crece), así que ordenar o filtrar siempre actúa sobre toda la lista y no solo sobre lo cargado. Cambiar filtros, orden o búsqueda vuelve al primer tramo.

Una tabla corta dentro de un panel puede arrancar paginada con `defaultRowsMode="paged"`.

**Límite práctico:** los datos están en memoria. Para >1000 filas, paginación en servidor.

### 10.5 «Configurar tabla» — `TableConfigButton` + `useTableConfig`

El botón del engranaje (junto al buscador) abre un **panel anclado** (Popover), no un drawer. Contiene, de arriba abajo:

- **Secciones de la pantalla** (`settingsExtraSections`), si las hay.
- **Columnas** — lista con asa para reordenar (mueve el mismo estado que arrastrar la cabecera), chincheta para **fijar** a la izquierda, ojo para **mostrar/ocultar**; las de servicio (selección, acciones) salen con candado como «Fija»; «Mostrar todas» si hay ocultas. Una columna con `enableHiding: false` se puede mover y fijar pero no ocultar.
- **Cómo se ven** — Rejilla / Lista (solo si la pantalla pasa `renderListItem`).
- **Cómo llegan las filas** — Scroll infinito / Paginación.
- **Cómo se actúa sobre una fila** — Marcando filas / Menú en cada fila (solo con selección y `contextMenu`). Con «menú» desaparecen las casillas y cada fila lleva su «⋯» con las acciones del menú contextual.
- **Restablecer** y un punto en el botón cuando la configuración no es la de fábrica.

**«Dónde van las acciones» ya NO está en este panel.** Es una preferencia global de la persona (`useActionsPlacement`, § 12.6): se elige una vez en «Personalización» (menú de la marca) o en los ajustes de la barra, y vale para todas las tablas. La tabla la lee sola: con «En la pantalla», la cabecera de la lista se transforma mientras hay selección («× 3 seleccionadas» + acciones, con los mismos bloqueos y confirmaciones) y no se monta la barra flotante. Un valor `actions` guardado por tabla en versiones anteriores se ignora sin romper.

Todo lo demás se guarda por tabla en `localStorage` (`sellup:table:<tableId>`) y se lee con `useSyncExternalStore`: el servidor y la hidratación pintan lo de fábrica y lo guardado se aplica después, sin desajuste de hidratación. Lo guardado ilegible se ignora.

El buscador general ya no se activa desde ajustes: la lupa siempre está en la barra y abre el campo.

### 10.6 Columnas — meta fields

`DataTableColumnMeta` (`data-table-column-meta.ts`) extiende `ColumnDef['meta']`:

```ts
{
  label?: string;                 // Nombre en «Configurar tabla» y en los chips de filtro
  popoverTitle?: string;          // «Filtrar por <popoverTitle>» si difiere del título
  filterOptions?: { label, value, icon? }[]; // Opciones del embudo (preferible para enums)
  disableFilter?: boolean;        // Sin embudo: números, fechas, texto libre
  disableSort?: boolean;          // Sin orden: la etiqueta es texto
  filterChipLabel?: (value) => string; // Texto del chip para filtros que no son listas (rangos)
}
```

Qué cabecera sale de `<DataTableColumnHeader column title />`:

| Columna | Declara | Cabecera |
|---|---|---|
| Enumerable (estado, país, fuente, responsable…) | `meta.filterOptions` (o pocos valores únicos, ≤ 50) | Orden + embudo |
| Numérica o de fecha | `meta.disableFilter: true` | Solo orden |
| Texto libre (nombre, dominio, email) | `meta.disableFilter: true` | Solo orden |
| Sin valor por el que ordenar | `enableSorting: false` / `meta.disableSort` | Etiqueta |

El filtro se guarda como `string[]`. Las columnas sin `filterFn` propio usan el de la tabla («el valor está entre los elegidos»); las que declaran el suyo (`'arrIncludesSome'`, un rango de fechas) lo conservan.

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
    // Texto libre: se ordena y se busca; sin embudo.
    meta: { label: 'Nombre', disableFilter: true },
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
    // Enumerable: orden + embudo con estas opciones y su recuento.
    meta: {
      label: 'Estado',
      filterOptions: [
        { label: 'Activo', value: 'active' },
        { label: 'Inactivo', value: 'inactive' },
      ],
    },
  },
];

export function MyList({ rows }: { rows: Row[] }) {
  return (
    <DataTable
      tableId="elements"
      noun="elementos"
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
│ Título [total]                     [acciones] [🔍] [⚙ Configurar] │  ← Barra
│ Descripción                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Filtros: [País: Colombia ×] [Estado: Nuevo ×]  Limpiar todo      │  ← Solo con filtros
├─────────────────────────────────────────────────────────────────┤
│ ☐▾│ Empresa ⇅ │ País ⇅ [▽] │ Estado ⇅ [▽ 2] │ Creación ⇅ │ │  ← Cabecera pegada
├───┼───────────┼────────────┼────────────────┼────────────┤
│ ☐ │ ...       │ ...        │ ...            │ ...        │      ← Filas
├───┴───────────┴────────────┴────────────────┴────────────┤
│ Mostrando 20 de 134 empresas   |   Página 1 de 7 · 134 empresas  │  ← Pie
└─────────────────────────────────────────────────────────────────┘
                              ┌─────────────────────────────────────┐
                              │ N seleccionados  [acción1] [acción2] │  ← Barra flotante
                              └─────────────────────────────────────┘     (portal) o cabecera
```

#### 10.9.1 Cabecera de columna (orden + embudo)

`<DataTableColumnHeader>` pinta dos controles **a la vista** (Thema · `FilterSortHeader` / `SortOnlyHeader`):

1. **Etiqueta + flecha** — un clic alterna sin orden → ascendente → descendente → sin orden. La flecha se enciende en `text-primary` y la celda lleva `aria-sort`.
2. **Embudo** (solo columnas enumerables) — abre un menú con casillas, el recuento de cada opción, un buscador cuando hay más de 8 y «Limpiar filtros (n)» arriba cuando hay alguno. Con filtro puesto el embudo va en `bg-primary/10 text-primary` y muestra cuántos valores hay elegidos. Etiqueta accesible: «Filtrar por <columna>». Las opciones con filas van primero.

Fijar y ocultar una columna **no** viven en la cabecera: están en «Configurar tabla» (§ 10.5). Texto de cabecera: `text-xs font-semibold`, sin mayúsculas forzadas.

Para un filtro que no es una lista (rango de fechas), compón `HeaderSortButton` + `HeaderFilterButton` de `@/components/data-display` con tu propio Popover (ver `prospect-date-range-column-header.tsx`).

**Celdas** — el mismo dato se lee igual en todas las tablas; las piezas viven en `@/components/shared/table-cells`: el dato que falta es `EmptyCell` («—» apagado, con su nombre para el lector de pantalla), nunca un texto distinto por tabla («Sin dato», «Sin verificar»…); el país es `CountryCell` (bandera + nombre completo); un enlace que sale de SellUp es `ExternalLinkCell` o `ExternalIconLink` (icono, foco visible, no dispara el clic de la fila); el nombre que abre el detalle es `RowTitleButton`.

**Filtros activos** — `<DataTableActiveFilters>` pinta bajo la barra un chip `Columna: valor ×` por cada valor elegido y por la búsqueda, con «Limpiar todo». Sin filtros la fila no existe. Con filtros, el total junto al título es el de lo filtrado.

**Coexistencia row reorder + sort:** cuando `enableRowReorder` está activo y el usuario aún no ha ordenado, el orden de filas es el que provee el padre (drag-and-drop). Al ordenar por una cabecera, TanStack toma el control; al volver a «sin orden» (tercer clic), el control vuelve al padre.

#### 10.9.2 Row right-click context menu

`<DataTableContextMenu>` engancha el menú a la **propia fila** (`ContextMenuTrigger asChild` sobre el `<tr>`) cuando el `DataTable` recibe `contextMenu`: nada de `<div>` entre `<tbody>` y `<tr>`, que es HTML inválido y rompía la hidratación. Vale también con filas arrastrables (`enableRowReorder`): `DataTableRowReorder` no pinta el `<tr>`, le entrega a `DataTableRow` la ref y el desplazamiento de dnd-kit (`sortableRowProps`), así que la fila sigue siendo un único elemento y tampoco queda un `<div>` entre `<tr>` y `<td>`. Las mismas acciones alimentan el «Menú en cada fila» (§ 10.5). Anatomía:

- `min-w-[220px]`, container `p-1.5`, `rounded-xl border border-border/30`.
- Items con `px-2.5 py-2`, `gap-2.5` y icono `h-4 w-4` — el icono agrandado y el padding mayor dan aire al texto (evita que se vea "circular" / pegado al borde).
- `<ContextMenuSeparator>` con `-mx-1 my-1` para mantener el padding del container.

#### 10.9.3 Column reordering (drag-and-drop)

`<DataTableColumnReorder>` envuelve el header row con `@dnd-kit/core` + `@dnd-kit/sortable`. Columnas en `pinnedColumnIds` (default `["select", "reorder", "actions"]`) no se arrastran, ni se ocultan, ni se fijan. Activado por defecto (`enableColumnReorder: true`). Arrastrar una cabecera y arrastrar en el panel «Configurar tabla» mueven el mismo estado (`useTableConfig`).

El `DndContext` lleva `id={useId()}` y `accessibility={{ container: document.body }}`: sin eso, las regiones de anuncio de dnd-kit rompen la hidratación dentro de una tabla. La celda sigue siendo una cabecera de columna (no `role="button"`), para que `aria-sort` sea válido.

**Ancho de columnas** — si sobra ancho, se reparte en proporción al `size` de cada columna; si faltan unos píxeles, las columnas anchas (`size ≥ 160`) ceden hasta un 15 % (nunca por debajo de su `minSize`) antes de obligar a desplazar de lado.

**Columnas fijadas** — las fijadas desde el panel pasan al principio y se quedan quietas a la izquierda (`position: sticky`) al desplazar la tabla de lado; las de servicio (selección) se quedan quietas con ellas.

#### 10.9.4 La selección en la barra flotante (portal pattern)

Con filas marcadas, las `bulkActions` van a LA barra flotante de la pantalla (`DataListActionRail`, § 12), que se monta via `createPortal` a `document.body` (NO dentro de la tabla). Razón técnica: el `transform` del `animate-su-fade-in` del AppShell crea un containing block que rompe `position: fixed` para descendientes. Ver § 12 para la anatomía y la regla «una sola barra por pantalla».

#### 10.9.5 Configurar tabla (panel, no drawer)

`<TableConfigButton>` (§ 10.5). Sustituye al antiguo `DataTableSettingsDrawer`, que ya no existe.

#### 10.9.6 Buscador

La lupa de la barra abre el campo («Buscar en <sustantivo>»), controlado por `state.globalFilter`. La «×» lo limpia y lo cierra. La búsqueda activa aparece como chip en los filtros activos.

#### 10.9.7 Selección

- **Paginado** — la casilla de cabecera es un menú (`SelectionHeaderMenu`): «Seleccionar esta página (n) / Seleccionar todos (n) / Deseleccionar esta página / Deseleccionar todos».
- **Scroll infinito** — es una casilla simple que marca todo lo cargado y, pulsada otra vez, lo suelta.
- **Clic en la fila** — si la tabla **no** tiene `onRowClick`, picar en la fila la marca (salvo que el clic nazca en un botón, enlace, casilla o menú). Con `onRowClick`, abre el detalle como siempre.

#### 10.9.8 Pie

- **Scroll infinito:** `<DataTableLoadMore>` — `Mostrando n de N <sustantivo>`. El centinela (`<DataTableLazySentinel>`) va dentro del `<tbody>`. Ver § 13.
- **Paginación:** `<DataTablePagination>` — `Página x de y · N <sustantivo>`, selector «Filas por página» y Anterior / Siguiente. El tamaño elegido se recuerda por `tableId`.

### 10.10 Checklist de migración

- [ ] Reemplazar `useState`+`useMemo`+`Table` por `<DataTable>` con `columns` + `data` + `getRowId`.
- [ ] Definir `meta.label` en toda columna visible.
- [ ] Pasar `tableId` (estable) y `noun` (plural) a la tabla.
- [ ] Mover filtros `useState` (país, estado, etc.) al embudo de su columna via `meta.filterOptions`; marcar `meta.disableFilter` en números, fechas y texto libre.
- [ ] Acciones por fila: declararlas en `contextMenu.items` (sirven al clic derecho y al «Menú en cada fila»).
- [ ] Right-click: declarar `contextMenu.items` con `DataTableContextMenuItem[]`.
- [ ] Bulk actions: declarar `bulkActions` con `confirm` para acciones destructivas.
- [ ] Eliminar imports de `Table*`, `Input` (search), `useState`/`useMemo` para filtros.
- [ ] Verificar: `npm run lint`, `npm run typecheck`, `npm run build` pasan.
- [ ] Commit con prefijo `refactor:` y mensaje claro.

### 10.11 Reglas de densidad y color (Design Refresh v1)

- **Máximo un badge de color por fila.** El badge de color se reserva para la señal más importante de la fila (típicamente el estado/salud). Las demás categorías van como **texto plano** (`text-muted-foreground`) o, si necesitan señal ligera, un **punto de color + texto** (`h-1.5 w-1.5 rounded-full` + label). Varias columnas de badges de colores distintos en la misma fila convierten el color en ruido y le quitan semántica.
- **Un valor por defecto no es un badge.** Un estado que es idéntico en todas las filas de la vista (p. ej. "Por revisar" en el tab de candidatos) va como texto plano, no como badge repetido.
- **Celdas de máximo 2 líneas.** Evitar apilar 3+ microlíneas de `text-xs` (nombre + email + LinkedIn + teléfono). Mover lo secundario a iconos o al detalle en el drawer/side panel.
- **Microtexto mínimo `text-xs`** en celdas de datos y en badges de conteo. No hay tamaños por debajo de 12px.

### 10.11.1 Prohibiciones

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
`src/app/(sellup)/source-catalog/source-detail-drawer.tsx`:

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
          <span className="ml-1.5 inline-flex items-center justify-center rounded-full border border-border/60 bg-surface-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
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

- **Variante de tabs:** siempre `variant="segmented"` dentro de un drawer (estándar de facto: los 4 drawers de detalle —fuente, cuenta, contacto, candidato— lo usan). `default` (con fondo `bg-muted`) se reserva para settings y formularios.
- **Tab por defecto:** el que tenga el contenido más crítico / informativo. Para una entidad con info + relación, `Información` va primero.
- **Badge de conteo:** incluir en el trigger cuando aplique (`Lotes 5`, `Actividad 12`). Estilo: `rounded-full border border-border/60 bg-surface-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground`.
- **Tabs opcionales:** si la entidad solo tiene `Información` (sin datos relacionados), omitir el wrapper `Tabs` y renderizar el contenido directo. No forzar un único tab "decorativo".
- **Ancho del drawer:** para detail views con tablas usar un ancho acotado con tope — p. ej. `sm:w-[58vw] sm:min-w-[660px] sm:!max-w-[900px]` — para evitar un lienzo vacío en pantallas anchas; `sm:w-[480px]` o `sm:w-[560px]` para detail views simples. Evitar `!w-[90vw]` salvo que el contenido lo justifique.
- **Footer del drawer:** acciones de copia (Copiar key/ID) y enlaces externos (Abrir URL). **Nunca** un "Abrir página completa".
- **Datos del tab:** pre-cargar server-side y pasar como prop. No `useEffect` ni flash de loading al cambiar de tab.

### 11.4 bis Secciones plegables y resumen

- **Un título por sección.** Una sección que se pliega es `CollapsibleDrawerSection` (`@/components/shared/collapsible-drawer-section`): la misma tarjeta que `DrawerSection`, con la cabecera como botón. Nunca un rótulo plegable con una tarjeta dentro que repite el nombre.
- **Plegada, dice qué contiene.** Pasa `summary` (una línea: «acme.co · con LinkedIn · 250 empleados») o `badge` (un contador). Arranca abierta (`defaultOpen`) la que trae algo que decidir.
- **Resumen arriba.** Antes de las pestañas o de la primera sección, tres o cuatro datos clave en un `DetailList` (`columns={4}`). Lo que está en el resumen no se repite en las secciones.
- **Sin tarjetas con rayas.** Si no hay datos que resumir (p. ej. un prospecto sin evaluar), el resumen dice por qué y qué falta, en vez de pintar «— / 100».
- **Pie.** La acción principal, a la derecha; lo secundario y lo destructivo, a la izquierda.
- **Títulos en frase.** «Datos oficiales y legales», no «Datos Oficiales y Legales».

### 11.5 Prohibiciones

- ❌ Botón "Abrir página completa" o equivalente — el drawer contiene todo.
- ❌ `Tabs` con `variant="default"` o `variant="line"` dentro de un drawer (usar `segmented`).
- ❌ Drawer con un solo tab — renderizar el contenido directo sin Tabs.
- ❌ Fetch de datos al cambiar de tab — pre-cargar todo y pasar como prop.
- ❌ Links a rutas externas para ver "más detalle" de un item del tab — abrir un sub-drawer o un popover.

---

## 12. Floating Action Bar — una sola barra por pantalla

La barra de acciones flotante es el `action-rail` de Thema (`@/components/action-rail`), no un contenedor con botones dentro. **Regla: una sola barra por pantalla.** Concentra todo lo que se puede hacer y cambia de contenido según lo que haya marcado; nunca conviven una «barra de acciones de pantalla» y una «barra masiva».

### 12.1 Anatomía

```
┌──────────────────────────────────────────────────────────────┐
│ ⠿  ⚙ │ ✕ 3 seleccionadas │ ◻ ◻ ◻ ⋯ │        (con selección)  │
│ ⠿  ⚙ │ ⋯ ◻ ◻ [ + Crear empresa ]            (sin selección)  │
└──────────────────────────────────────────────────────────────┘
  asa  ajustes  divisoria   grupo contextual / grupo persistente
```

- **Marco** (`ActionRailShell`): `h-14 rounded-3xl border bg-nav shadow-rail`. Al principio lleva sus propios controles —el **asa de arrastre** (`RailDragHandle`) y el **menú de ajustes** (`RailSettingsMenu`)—, una divisoria y luego los dos grupos.
- **Ajustes de la barra**: orientación (horizontal / vertical), visibilidad (mantener abierta / ocultar sola), **dónde van las acciones** (En esta barra / En la pantalla — § 12.6) y «Volver a su sitio». Se recuerdan en `localStorage` (`sellup:action-rail:*`) y valen para todas las pantallas, porque para quien la usa es una sola barra. Se leen con `useSyncExternalStore` (sin desajuste de hidratación).
- **Recogida** es una pastilla de 64×6 que se abre al pasar el cursor, al enfocarla o al tocarla. Se mantiene abierta (`keepOpen`) mientras hay selección o un menú abierto, y se recoge inerte (`isBlocked`) mientras un panel abierto desde ella tiene la pantalla.
- **Arrastrable**: se suelta en cualquier punto y se recuerda; doble clic en el asa la devuelve a su atraque (abajo al centro, o borde derecho si va de pie).
- **Botones**: `RailButton` (icono 40×40 `rounded-xl`, etiqueta en tooltip, `tone="danger"`, `blockedReason` que la apaga y lo explica), `RailPrimaryAction` (la ÚNICA acción rellena: icono + etiqueta en `bg-primary`; `variant="ai"` conserva el degradado de IA; de pie queda cuadrada con tooltip), `RailOverflowMenu` («⋯»), `RailSelectionChip` («✕ 3 seleccionadas»), `RailCreateOption` (fila del popover de creación), `ConfirmActionPopover`.
- **Movimiento**: sin framer-motion. Abrir/recoger y el escalonado de las acciones al cambiar de contexto son utilidades `su-rail-*` / `su-dock-item` de `globals.css` (`transform` + `opacity`), apagadas con `prefers-reduced-motion`.
- **Agente de IA** (`RailAgentProvider` / `rail-agent.ts`): la barra cierra por la derecha, después de la primaria, con el agente de IA de la pantalla — un botón 40×40 con el degradado de IA (`bg-ai-gradient`) y la chispa; su nombre va en el tooltip. Es una segunda principal, a un clic; solo sin selección. De pie es el mismo botón cuadrado.
- **Móvil** (`useCompactViewport`, < `lg`): la misma pieza en su otra forma, `ActionFab` — un botón flotante que despliega las mismas acciones; el agente de IA es una fila más, con su pastilla en el degradado de IA.

### 12.2 Cómo se monta en una pantalla de lista

```tsx
// page.tsx (servidor)
<ListActionRailProvider label="Acciones de empresas" gender="f">
  <DataTablePage title="Empresas" actions={<AccountsScreenActions users={users} />}>
    <AccountsDataTableClient accounts={accounts} />
  </DataTablePage>
</ListActionRailProvider>

// accounts-screen-actions.tsx (cliente): declara, no pinta botones
const actions = React.useMemo<RailActionSpec[]>(() => [
  { id: 'create', label: 'Crear empresa', icon: <Plus />, scope: ['screen'], primary: true, onSelect: () => setIsCreating(true) },
], []);
return (
  <>
    <RailScreenActions actions={actions} agent={agent} isBlocked={isCreating} />
    <CreateAccountDrawer users={users} open={isCreating} onOpenChange={setIsCreating} />
  </>
);
```

- **`ListActionRailProvider`** monta LA barra (`DataListActionRail`) y reserva su hueco para que no tape el pie de la tabla: `pb-20` tendida, `pr-20` de pie, nada si quien mira la arrastró.
- **La pantalla** declara `RailActionSpec[]` con `scope: ["screen"]` en `<RailScreenActions>`: `primary` (una sola, cierra la fila), `overflow` (se pliega tras «⋯»), `blockedReason`, `options` (la primaria abre un popover de creación con varias opciones) y `onSelect`. Los drawers que abre se montan **controlados** (`open` / `onOpenChange`).
- **La tabla** no necesita nada: `DataTable` traduce sus `bulkActions` a acciones de la barra y le cuenta la selección por contexto. `disabled(rows)` → `blockedReason` (con `disabledLabel(rows)` como explicación), `confirm` pregunta antes, `items` es un menú con nombre, `scope: ['single']` saca la acción de la barra cuando hay varias filas marcadas y `countInLabel` añade el recuento («Archivar (3)»).
- **Sin selección** la barra enseña las acciones de pantalla (plegadas · de a diario · primaria al final). **Con selección** las SUSTITUYE por el recuento y las acciones sobre lo marcado.
- **El agente de IA** se declara aparte, con `agent` (una `RailActionSpec` con `variant: "ai"`): «Generar con IA» en las tres vistas de Empresas (Empresas, Por revisar, Descartadas) y «Buscar contactos con IA» en Contactos. Usuarios y Configuración no tienen agente. Si la búsqueda con IA no puede ejecutarse, el agente NO se llama «Generar con IA» ni lleva el degradado: se llama «Búsqueda no disponible» (sin `variant`) y abre la explicación.
- Con **«Dónde van las acciones» = En la pantalla** (§ 12.6) la barra no se monta: `RailScreenActions` pinta las acciones en la cabecera y las de selección van en la cabecera de la lista.
- Una `DataTable` fuera de un `ListActionRailProvider` monta su propia barra solo mientras tiene filas marcadas.

### 12.3 Por qué va por portal

`position: fixed` dentro de un contenedor con `transform` **no se posiciona respecto al viewport** sino respecto a ese contenedor (containing block). El `<main>` de `AppShell` aplica `animate-su-fade-in`, que usa `transform`. `ActionRailShell` y `ActionFab` se montan con `createPortal(jsx, document.body)`, donde `fixed` vuelve a ser contra la ventana.

### 12.4 Reglas

- **Una sola barra por pantalla.** No montes botones `<Button>` dentro de un contenedor flotante ni una segunda barra para la selección: declara `RailActionSpec` y deja que la barra resuelva modos, orden, escalonado y plegado.
- **Una sola acción rellena** (la primaria). El resto son iconos con su etiqueta en tooltip.
- **z-index:** `z-40`: flota sobre la página y por debajo del velo de drawers (`z-50`) y diálogos (`z-[60]`), que la cubren al abrirse.
- **Cliente solamente:** la barra no se pinta en el servidor (`useSyncExternalStore`), así no hay desajuste de hidratación.
- **Single source of truth:** la selección vive en el `<DataTable>`; la barra solo la lee y dispara callbacks.
- **Animaciones:** solo las utilidades `su-rail-*` de `globals.css`; nada de keyframes en el componente.
- **`DrawerActionRail`** es la misma barra dentro de un drawer (franja del pie, auto-ocultar y pastilla). No lleva asa de arrastre: el panel entra con `transform` y una posición guardada en coordenadas de ventana la dejaría fuera de él.

### 12.5 Cuándo replicar este patrón

Usar portal a `document.body` para CUALQUIER elemento que necesite:
- `position: fixed` global (toolbars flotantes, toasts, command palettes).
- Escapar un `transform` ancestor (AppShell, dialogs anidados, animaciones de slide).

**Regla general:** si algo necesita ser "global al viewport" y vive dentro de un contenedor con `transform`, `filter`, `perspective` o `will-change: transform`, portalizar.

---

### 12.6 Dónde van las acciones — preferencia global de la persona

Port de Thema `actionsPlacement`. Quien prefiere la barra la quiere en todas las pantallas, así que **no es de cada tabla**: es UNA preferencia (`useActionsPlacement()` → `"rail" | "inline"`), fuera de React, guardada en `localStorage` (`sellup:actions-placement`) y leída con `useSyncExternalStore` (en el servidor y durante la hidratación manda la barra).

Se cambia en dos sitios, y solo en esos:

- **Ajustes de la barra** → grupo «Dónde van las acciones»: «En esta barra» / «En la pantalla». Pasarlas a la pantalla apaga la barra.
- **Personalización** (menú de la marca, `PersonalizationMenu`) → «Acciones de la pantalla»: `SegmentedControl` «Barra flotante» / «En la pantalla» + una línea de ayuda. Es la única puerta para volver a encender la barra.

Con **«En la pantalla»**:

- La barra flotante **no se monta**, ni con filas marcadas, ni el botón flotante de móvil. El hueco reservado (`pb-20` / `pr-20`, `ActionRailReserve`) desaparece.
- `RailScreenActions` pinta las acciones de pantalla en su sitio —el hueco `actions` de `DataTablePage` (también en la banda `compact`) y de `PageHeader`— con `ScreenHeaderActions` (port de Thema): lo plegado en «⋯», lo de a diario como botones `outline`, la principal rellena al final y el agente de IA como `AIButton` cerrando la fila. El reparto lo decide `railScreenTiers`, el mismo de la barra.
- Las acciones de la selección van en la cabecera de la tabla (§ 10.5).
- **Mismo conjunto, mismos bloqueos y confirmaciones** en las dos superficies: son las mismas `RailActionSpec` (`blockedReason` apaga y explica; `onSelect` es el mismo) y las mismas `bulkActions`.

```tsx
// No hace falta nada en la pantalla: la misma declaración vale para las dos superficies.
<RailScreenActions actions={actions} agent={agent} isBlocked={isOpen} />
```

---

## 13. Lazy Load con IntersectionObserver

### 13.1 Propósito

Reemplazar el botón "Cargar más" por scroll automático. Más natural para listas largas — el usuario no tiene que buscar el botón al final de la tabla.

### 13.2 Comportamiento

En scroll infinito (`mode === 'lazy'`, el modo de fábrica):

1. La tabla es una sola «página» de TanStack que crece: `pagination = { pageIndex: 0, pageSize: lazyVisibleCount }`. El tramo se corta **después** de filtrar y ordenar.
2. `lazyVisibleCount` empieza en `initialPageSize` (default 20).
3. `<DataTableLazySentinel>` añade al final del `<tbody>` unas filas fantasma (esqueleto); la primera es el centinela de un `IntersectionObserver` cuya raíz es **la caja que de verdad hace scroll** (la de la tabla con `fillHeight`, o la ventana) y con `rootMargin: "240px"`.
4. Al asomar el centinela se suma `initialPageSize`; al crecer el tramo, el centinela se vuelve a montar (`key`) para volver a preguntar aunque siga a la vista.
5. Cuando ya está todo cargado, el centinela desaparece. El pie dice `Mostrando n de N <sustantivo>`.
6. Cambios en filtros, búsqueda, orden o modo vuelven al primer tramo (ajustado durante el render, no en un efecto).
7. Con teclado, el botón «Cargar más <sustantivo>» (visible al recibir foco) hace lo mismo.

> La implementación de referencia de § 13.3 es histórica; la vigente está en `data-table-load-more.tsx`.

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

- **El centinela vive dentro de la caja con scroll.** Fuera de ella siempre «se ve» y la tabla se carga entera de un tirón.
- **`rootMargin: "240px"`** — el siguiente tramo ya está puesto cuando el centinela llega al borde.
- **Vuelta al primer tramo** al cambiar filtros, búsqueda u orden.
- **Filas fantasma, no un spinner** — lo que hay bajo el pliegue son filas, y eso es lo que aparece.
- **Pie** — `Mostrando n de N <sustantivo>`.
- **Sin botón a la vista** — el botón «Cargar más» solo existe para teclado y lectores de pantalla.

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

- ❌ Filtros de columna en una barra aparte o escondidos tras el título — van en el embudo de su columna y se ven como chips (§ 10.9.1).
- ❌ Un drawer propio de «ajustes de tabla» — la configuración vive en el panel «Configurar tabla» (§ 10.5); lo propio de la pantalla entra por `settingsExtraSections`.
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

### 14.6 Receta «Recorrido por etapas» (Pipeline)

Para una pantalla que cuenta **por dónde va un registro en un proceso de varias etapas** (referencia: `/pipeline`, `src/app/(sellup)/pipeline/`). Es una lista + detalle a altura completa, no una tabla: sin `DataTable` ni drawer.

```
DataTablePage compact  ·  «Pipeline» + descripción al lado  ·  vistas a la derecha (ThemaTabs page, ?view=)
┌── panel ≈ 340 px ──────┐ ┌── detalle (fluye con la página) ───────────────────┐
│ Resumen del pipeline   │ │ SIN elegir: AttentionStrip + AttentionAction (filtran) │
│ buscador               │ │             las 8 etapas en UNA fila (con conteo o apagadas) │
│ [Filtros · 3] N de M   │ │             + DistributionBar · «Archivadas» aparte    │
│ chips activos (×)      │ │ CON elegir: cabecera (StatusBadge, señales; sin botones)│
│ ┌ lista (scroll) ────┐ │ │             Stepper sm (clickableUpcoming) → ancla     │
│ │ ListItem selected  │ │ │             una etapa = un acordeón · Timeline historial│
│ └────────────────────┘ │ └────────────────────────────────────────────────────┘
└────────────────────────┘
```

Reglas:

- **Marco**: `DataTablePage compact` con `title`, `description`, `breadcrumbs` y las vistas en `tabs` (`PipelineFrame`); el mismo marco pinta la pantalla, su esqueleto de carga y su error, para que la cabecera no salte. Nada de `PageHeader` de dos líneas.
- **Scroll**: el marco usa `DataTablePage pageScroll`: se desplaza la PÁGINA entera. El panel izquierdo va pegado (`lg:sticky lg:top-4`, con alto máximo) y solo su lista de empresas tiene scroll propio; el resumen, el buscador y los filtros quedan fijos arriba del panel. El recorrido de la derecha NO tiene scroll propio. Por debajo de `lg` todo fluye y se ve una cosa cada vez (lista → detalle con «Volver»).
- **Filtros**: UN solo botón «Filtros · n» (`PipelineFilterBar`) que abre un popover con scroll interno y alto máximo, con los grupos uno debajo de otro, cada uno con su título: Etapa (las 8, con 0 apagadas pero elegibles), País (los presentes, bandera + nombre; «Sin país»), Industria (las presentes; «Sin industria»; buscador si son más de 8), Fecha (sobre el último movimiento o la entrada al pipeline; periodos + `DateRangePicker`), Riesgo por inactividad (umbrales excluyentes de `MOVEMENT_THRESHOLDS` y «Sin riesgo»), Fallos de IA (por etapa/agente; solo los agentes que existen) y Otras señales. Casillas con recuento (`CheckboxFilterList`). Dentro de un grupo, varias opciones son una UNIÓN; entre grupos, una INTERSECCIÓN. Encima de la lista, «N de M empresas»; debajo del buscador, `ActiveFilterChips` («País: Chile ×» … «Limpiar todo»); vacío con «Limpiar filtros». Todo es puro y en cliente (`src/modules/pipeline/pipeline-filters.ts`: `applyPipelineFilters`, `countFilterOptions`, ida y vuelta por la URL) sobre lo que ya trae `getPipelineOverview()`: sin consultas nuevas. La franja de atención del resumen es ESTE mismo estado (pulsar un motivo marca su casilla). El tablero lleva la misma barra y el mismo estado. El resumen NO se filtra y lo dice en una línea cuando hay filtros. Nada de `FilterChips` en rejilla para listas con muchas opciones.
- **Volver al resumen**: entrada fija «Resumen del pipeline» arriba del panel (resaltada sin selección), clic en la empresa ya elegida y la miga del módulo (un tramo con `href` cuando hay empresa elegida; el primer tramo se llama como el módulo en el menú lateral para que la cabecera no lo repita).
- **Un solo vocabulario**: el filtro, la pista y el resumen hablan de las mismas 8 etapas. El resumen las pinta en UNA fila, en orden: con su conteo las que tienen empresas y apagadas las que no; las archivadas son un total aparte.
- **Modelo de etapas fijo** en `src/modules/pipeline/stages.ts`; la etapa actual sale de `pipeline_status` (`resolveCurrentStage`). Señales de atención = reglas puras en `signals.ts`. El recorrido se compone en `journey-read-model.ts` (puro, `now` inyectado) y se lee con `actions.ts` (solo SELECT, siempre a través de `getAccountsList` / `getAccountById` para respetar el alcance comercial).
- **Nada inventado.** Una etapa cuyo agente aún no existe se pinta apagada (`bg-surface-subtle`, `Badge` «Próximamente»), con el texto de qué hará el agente y un `DetailList` «Lo que ya tiene SellUp para esta etapa» hecho solo de datos reales. Si un dato no se puede leer, se omite.
- **Cada etapa es un acordeón, y el acordeón RESUME; el drawer DETALLA.** La cabecera (`StageCardFrame`) —nombre numerado, `Badge` del agente, `StatusBadge`, qué pasa en la etapa, fecha del hito y flecha— es un botón dentro de un `h3` (`aria-expanded`); los avisos se ven aunque esté plegada. De entrada solo está abierta la etapa actual; «Expandir todas / Contraer todas» abre y cierra el resto; la pista (`Stepper`) abre la etapa pedida y lleva hasta ella. Abierta, una etapa enseña SOLO lo esencial, en una pasada de vista (≈ 120–140 px en escritorio), sin grupos con título ni datos repetidos: una fila de 4 datos clave con la pieza del detalle de empresa (`DetailList columns={4}`, todos los pares con icono) — Prospección: Origen, Encaje ICP, Aprobado por, HubSpot (`StatusBadge`); Enriquecimiento: Contactos, Decisores, Con teléfono, En HubSpot, más UNA línea con la última búsqueda del agente — y, al pie a la derecha, «Ver más» (`Button variant="outline" size="sm"`), que abre el drawer de esa etapa; en Enriquecimiento, a su lado, `AIButton variant="secondary"` «Buscar más contactos con IA». Las etapas «Próximamente» dicen en una frase qué hará el agente y no tienen «Ver más».
- **Drawer de detalle de la etapa** (`PipelineStageDrawer`: `DrawerShell size="lg"` + una `DrawerSection` por grupo, § 11): título «{n}. {etapa} · {empresa}», `titleBadge` con el estado, y TODO el detalle — Prospección: «Origen», «Encaje y clasificación», «Aprobación», «Hoy», con pie «Ver lote» / «Ver empresa»; Enriquecimiento: el historial de búsquedas del agente (`AccountAgentsRunHistory`, el mismo de la pestaña «Agentes» de la empresa) y «Decisores» (lista completa), con pie «Ver todos los contactos» y el `AIButton` secundario. Dentro de una sección ningún `DetailItem` lleva icono (va en el encabezado de la sección): todas las etiquetas arrancan en la misma columna. Un dato que falta es la raya apagada del sistema (`EmptyCell`), los estados van en `StatusBadge`, las cifras en `tabular-nums` y los importes con dos decimales. Solo lectura salvo el buscador de contactos; un solo drawer a la vez; mientras está abierto la barra de acciones queda bloqueada (`isBlocked`) y al cerrarlo el foco vuelve a «Ver más».
- **Etapa disponible pero sin empezar = invitación a activarla, no un acordeón vacío.** Cuando el agente de la etapa YA existe y la empresa aún no tiene nada en ella (`JourneyStage.notStarted`, decidido en el read model; hoy: enriquecimiento sin contactos y sin ninguna búsqueda), la etapa es UNA fila con la misma altura, padding (`p-5`) y anatomía que un acordeón plegado: título + badges, la frase de invitación en el sitio de la descripción («Aún no se han buscado los contactos de {empresa}.») y, donde irían la fecha y la flecha, el accionador de IA SECUNDARIO (`AIButton variant="secondary" size="sm"`). Sin flecha ni `aria-expanded`; la fila no es un botón; borde punteado y superficie hundida; conserva el ancla; no cuenta para «Expandir/Contraer todas». Sin acción disponible o con la empresa archivada, se muestra sin botón. Nunca `EmptyState` alto dentro de la lista de etapas. En cuanto hay datos vuelve a ser el acordeón (y su botón de IA, dentro, también es el secundario).
- **Barra de acciones, según la preferencia global** (§ 12.6), igual que Empresas y Contactos: `ListActionRailProvider` + `RailScreenActions` (`PipelineScreenActions`). Con una empresa elegida en el recorrido: agente de IA «Buscar contactos con IA» (`variant: "ai"`; bloqueado con motivo si está archivada), primaria «Cambiar etapa» con sus estados como `options` (el actual no se ofrece; no en archivadas) y «Ver empresa». Sin empresa elegida y en el tablero no se declara nada: no hay barra ni hueco. Con «En la pantalla» salen en la cabecera compacta (`DataTablePage actions`) y la barra no se monta. La tarjeta de cabecera de la empresa NO repite esos botones. Como la página se desplaza entera, el hueco de la barra va al FINAL del contenido (`PipelineRailGap`, con `useActionRailReserveSide`) y el panel pegado acorta su alto máximo para que la barra no tape sus últimas filas.
- **El cambio de etapa lo decide la persona**: elegir un estado en «Cambiar etapa» → `ConfirmDialog` «¿Mover a …?» → `updateAccount({ pipeline_status })`, una sola vez. En el tablero (`Kanban` con `onItemMove`), mover una tarjeta abre el mismo `ConfirmDialog`; cancelar o fallar la devuelve a su columna. Ninguna otra escritura.
- **Estado en la URL**: `?view=`, `?account=` y los filtros, compactos (`?etapa=a,b&pais=CO,CL&industria=A~B&inactividad=14&fallo=1&senal=…&fecha=entrada&periodo=30d|desde=…&hasta=…`); lo que es por defecto no ensucia la URL. Filtrar es instantáneo: `usePipelineUrlFilters` reescribe los parámetros con `history.replaceState` (como `UrlTabs`), sin navegar ni volver a pedir datos, y los filtros viajan al elegir empresa y al cambiar de vista (`pipelineHref`). El buscador de texto es estado local.
- **Carga y error**: `Suspense` con `PipelineSkeleton` (misma cabecera, misma rejilla); `Alert` para fallos; las señales de control de Next (`redirect`) se relanzan.
- En pruebas, las acciones se inyectan por prop (`onChangeStage`, `onSearchContacts`, `onViewAccount`, `onMoveAccount`); la conexión con `useRouter`, `toast`, la acción de servidor y el buscador del Agente 2A vive solo en `pipeline-screen.tsx`.

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
<div className="-mx-3 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-1">
  <div className="shrink-0">
    <PageHeader title={title} description={description} actions={actions} backHref={backHref} />
  </div>
  {tabs && <div className="shrink-0">{tabs}</div>}
  {metrics && <div className="shrink-0">{metrics}</div>}
  <div className="flex min-h-[min(100%,32rem)] flex-1 flex-col">{children}</div>
</div>
```

`shrink-0` en header, pestañas y métricas para que no se colapsen; `flex-1` en el área de contenido para que ocupe todo el alto que queda.

**Cabecera compacta (`compact`).** Las pantallas de lista con pestañas de módulo (Empresas, Contactos) gastaban el alto en título + descripción + pestañas + cuatro tarjetas de métricas y a la tabla le quedaban tres o cuatro filas. Con `compact`:

- título, descripción (letra pequeña, hasta dos renglones) y pestañas van en **una sola banda** de la altura de las pestañas; en pantalla estrecha las pestañas bajan a su renglón;
- los huecos entre bloques pasan de `gap-5` a `gap-3`;
- las métricas dejan de ser tarjetas: son **indicadores que filtran** (`useQuickFilter` + `QuickFilterChips` en `@/components/filters/quick-filter-strip`). En pantalla ancha (≥ 1280px) van dentro de la barra de la tabla (`<DataTable actions={…} />`) y no gastan renglón; en estrecha, en su franja (`QuickFilterStrip`) sobre la tabla. Pulsar uno deja en la tabla solo sus filas (`aria-pressed`) y volver a pulsarlo lo quita; el número de cada uno se calcula sobre las mismas filas que pinta la tabla.

Resultado a 1440×900: de 3–4 filas a 8–9 sin desplazar la página. El estado de carga de estas pantallas es `ListPageSkeleton`, que conserva la banda (título y migas de la vista) y pinta una tabla fantasma.

Empresas y Contactos **no llevan pestañas de página**: la navegación entre sus vistas vive en el menú lateral (Empresas → Empresas / Por revisar / Descartadas; Contactos → Contactos / Por revisar; en móvil, en el cajón). El título dice la vista (`EMPRESAS_VIEW_TITLES`, `CONTACTOS_VIEW_TITLES`), las migas el módulo («Empresas › Por revisar») y el total vive en el título de la tabla. Las URL no cambiaron.

```tsx
<DataTablePage
  compact
  title="Por revisar"
  description="…"
  breadcrumbs={<Breadcrumbs items={[{ label: "Empresas", href: "/accounts" }, "Por revisar"]} />}
  actions={<ProspectsScreenActions … />}
>
  <AccountsDataTableClient … />
</DataTablePage>
```

**Alto mínimo de la tabla.** En una pantalla alta la cabecera y las métricas quedan fijas y la tabla llena el resto. En una baja (p. ej. 1440×900 con pestañas y métricas) el alto que quedaba dejaba ver solo unas cuatro filas: ahora la tabla no baja de `min(100%, 32rem)` y lo que se desplaza es la página (`overflow-y-auto` en la propia caja de `DataTablePage`), con la tabla conservando su scroll interno y su cabecera pegada. La caja con scroll es la de `DataTablePage` y no la del shell para que el hueco que reserva `ListActionRailProvider` (`pb-20` con la barra tendida, `pr-20` de pie) quede siempre fuera: la barra flotante nunca tapa el pie de la tabla. El `-mx-3 px-3` deja sitio a sombras y anillos de foco, que una caja con scroll recortaría.

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

- **El `transform` del `animate-su-fade-in` no rompe el layout.** Solo afecta a `position: fixed` descendientes. Como los sheets y la barra de acciones ya están portaled a `document.body`, no hay conflicto.
- **`min-h-0` es obligatorio** en todos los niveles de la cadena flex (main → inner div → DataTablePage → área de contenido). Sin él, los hijos no pueden reducir su altura para scrollear.
- **Padding va en el inner div del AppShell**, no en el `DataTablePage`. El `DataTablePage` no añade padding propio.
- **La barra de acciones sigue funcionando** porque está portaled a `document.body` (§ 12). Flota sobre la ventana independientemente del scroll de la tabla.
- **Métricas opcionales.** Si la página no tiene métricas, omitir el prop `metrics`. La tabla se queda con todo el alto disponible.
- **Drawer de detalle abre encima** sin verse afectado por el scroll interno. El sheet está en `z-50` y la barra de acciones en `z-40`: el drawer la cubre.

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
