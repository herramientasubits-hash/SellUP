# Plan de migración: plantilla-proyectos-shadcn → SellUp

**Origen:** `/tmp/plantilla-proyectos-shadcn`  
**Comparativa completa:** `/tmp/comparison-report.md`

**Estrategia:** Port por prioridad, uno a uno. Cada item es un commit atómico. Verificación obligatoria: `npm run lint` + `npm run typecheck` + `npm run build`. Light/Dark en ambos. Sin hardcoded colors.

---

## Phase 0 — Foundations (1 commit, prerequisito de todo lo demás)

### ☐ 0.1 AI tokens en `globals.css`
- **Source:** `tailwind.config.js` del template (líneas con `ai-gradient`, `ai-soft`)
- **Target:** `src/app/globals.css` — agregar variables y utilidades
- **Cambios:**
  - CSS vars: `--ai-gradient`, `--ai-gradient-soft`, `--ai-gradient-ring` (light + dark)
  - Utilidades: `bg-ai-gradient`, `bg-ai-soft`, `text-ai-gradient`, `border-ai-gradient`, `shadow-ai-premium`
  - Keyframe `su-gradient-shift` + utility `animate-gradient`
- **Acepta:** `bg-ai-gradient text-white rounded-full` se ve con gradient animado en light y dark
- **Tiempo:** 30 min
- **Bloquea:** todo AIButton / AILoader / Chip / SaveIndicator

### ☐ 0.2 Status semantic colors
- **Source:** template `tailwind.config.js` → sección `colors.status`
- **Target:** `globals.css` + tokens correspondientes
- **Cambios:** asegurar que `text-emerald-500`, `text-amber-500`, `text-sky-500`, `text-destructive` cubren positive/warning/info/negative en light y dark
- **Acepta:** los 4 tonos semánticos son legibles en ambos modos
- **Tiempo:** 15 min
- **Bloquea:** Badge con variantes semánticas, SurveyMetricCard, etc.

---

## Phase 1 — Base UI primitives (alta demanda, bajo riesgo)

### ☐ 1.1 `Alert`
- **Source → Target:** `template/ui/alert.tsx` → `src/components/ui/alert.tsx`
- **Variantes:** `default | destructive | info | warning | success`
- **Slots:** `Alert`, `AlertTitle`, `AlertDescription`
- **Sin headless lib** — div-only
- **Acepta:** `<Alert variant="warning">…</Alert>` se renderiza con icono + título + descripción
- **Tiempo:** 30 min

### ☐ 1.2 `Progress`
- **Source → Target:** `template/ui/progress.tsx` → `src/components/ui/progress.tsx`
- **Props:** `value`, `color: "primary" | "success" | "warning" | "destructive"`
- **Sin headless lib** — div-only
- **Acepta:** `<Progress value={60} color="success" />` muestra barra verde al 60%
- **Tiempo:** 20 min

### ☐ 1.3 `AlertDialog`
- **Source → Target:** `template/ui/alert-dialog.tsx` → `src/components/ui/alert-dialog.tsx`
- **Headless lib:** `@base-ui/react/alert-dialog` (verificar disponibilidad; si no, envolver `<Dialog role="alertdialog">`)
- **Slots:** 11 slots (root, trigger, portal, overlay, content, header, footer, title, description, action, cancel)
- **Acepta:** click en trigger abre modal con foco trapped, Esc cierra, primary action es destructive-styled
- **Tiempo:** 1.5 h

### ☐ 1.4 `RadioGroup`
- **Source → Target:** `template/ui/radio-group.tsx` → `src/components/ui/radio-group.tsx`
- **Headless lib:** `@base-ui/react/radio-group`
- **Acepta:** navegación con flechas, valor único, foco visible
- **Tiempo:** 45 min

### ☐ 1.5 `InputGroup` (compound)
- **Source → Target:** `template/ui/input-group.tsx` → `src/components/ui/input-group.tsx`
- **Slots:** `InputGroup`, `InputGroupAddon`, `InputGroupText`, `InputGroupButton`, `InputGroupInput`, `InputGroupTextarea`, `InputGroupSeparator`
- **Acepta:** `<InputGroup><InputGroupAddon position="left">$</InputGroupAddon><InputGroupInput /></InputGroup>` funciona
- **Tiempo:** 1.5 h

### ☐ 1.6 `Sonner` (toaster global)
- **Source → Target:** `template/ui/sonner.tsx` → `src/components/ui/sonner.tsx`
- **Dep:** librería `sonner` (instalar si no está)
- **Acepta:** `<Toaster />` montado en `app/layout.tsx`; `toast.success("Guardado")` muestra toast con icono y colores de marca
- **Tiempo:** 45 min

### ☐ 1.7 `Accordion`
- **Source → Target:** `template/ui/accordion.tsx` → `src/components/ui/accordion.tsx`
- **Headless lib:** `@base-ui/react/accordion` (verificar; si no, custom con Collapsible)
- **Acepta:** expand/collapse con animación, modo single/multiple
- **Tiempo:** 1 h

---

## Phase 2 — AI components (el showstopper, alto impacto visual)

### ☐ 2.1 `AIButton` ⭐ PRIORIDAD MÁXIMA
- **Source:** `template/ai-interaction/AIButton.tsx` (170 líneas)
- **Target:** `src/components/ai/ai-button.tsx`
- **Variantes:** `primary` (gradient animado), `secondary`, `subtle`, `outline`
- **Sizes:** `xs | sm | md | lg`
- **Props:** `label`, `children`, `loading`, `variant`, `size`, `leftIcon`, `rightIcon`, `helperText`, `disabled`, `onClick`, `type`, `className`
- **Dep:** Phase 0.1
- **Acepta:**
  - Click → gradient se anima
  - `loading` → icono `Loader2 animate-spin`, `aria-busy`, gradient shimmer
  - `helperText` → texto 10px debajo
  - Light/dark funcionan
- **Tiempo:** 2 h
- **Uso inmediato:** reemplazar los 5+ CTAs de IA en prospect-batches (`generate-ai-batch-drawer.tsx`, `candidate-detail-sheet.tsx`, etc.) — ver lista en grep "Generate with AI" / "Generar" del repo

### ☐ 2.2 `AILoader`
- **Source:** `template/ai-interaction/AILoader.tsx`
- **Target:** `src/components/ai/ai-loader.tsx`
- **Dep:** Phase 0.1
- **Variantes:** spinner con gradient AI, label opcional, sizes
- **Acepta:** muestra estado "Generando con IA..." con animación gradient
- **Tiempo:** 1 h

### ☐ 2.3 `Chip` (badge de IA)
- **Source:** `template/ai-interaction/Chip.tsx`
- **Target:** `src/components/ai/chip.tsx`
- **Variantes:** tonalidades AI (gradient text, soft bg)
- **Acepta:** etiqueta "IA", "Beta", "Nuevo" con estilo de marca
- **Tiempo:** 45 min

### ☐ 2.4 `SaveIndicator`
- **Source:** `template/ai-interaction/SaveIndicator.tsx`
- **Target:** `src/components/ai/save-indicator.tsx`
- **Estados:** `saving` (spinner), `saved` (check), `error` (alert)
- **Acepta:** muestra "Guardando…" → "Guardado" con auto-hide
- **Tiempo:** 45 min

### ☐ 2.5 `AIPanel` (panel contextual)
- **Source:** `template/ai/AIPanel*` (3 archivos)
- **Target:** `src/components/ai/ai-panel.tsx` + variants
- **Acepta:** panel flotante o docked con prompt de IA y respuesta
- **Tiempo:** 2 h

---

## Phase 3 — Layout & navigation

### ☐ 3.1 `PageHeader` (utility)
- **Source:** `template/utility/PageHeader.tsx`
- **Target:** `src/components/shared/page-header.tsx` (ya existe — auditar y alinear)
- **Acepta:** título + descripción + actions + breadcrumbs slot + backHref
- **Tiempo:** 30 min

### ☐ 3.2 `SectionHeader`
- **Source → Target:** `template/utility/SectionHeader.tsx` → `src/components/shared/section-header.tsx`
- **Acepta:** título de sección con divider y descripción
- **Tiempo:** 20 min

### ☐ 3.3 `Breadcrumbs`
- **Source → Target:** `template/navigation/Breadcrumbs.tsx` → `src/components/navigation/breadcrumbs.tsx`
- **Dep:** `@base-ui/react/breadcrumbs` o custom
- **Acepta:** migas de pan con separador, último item no-link
- **Tiempo:** 45 min

### ☐ 3.4 `TabsNav` (pills)
- **Source → Target:** `template/navigation/TabsNav.tsx` → `src/components/navigation/tabs-nav.tsx`
- **Acepta:** tabs en estilo pill con badge counter opcional
- **Tiempo:** 1 h

### ☐ 3.5 `UbitsSubNav` (sticky sub-nav con dropdown)
- **Source → Target:** `template/navigation/UbitsSubNav.tsx` → `src/components/navigation/ubits-sub-nav.tsx`
- **Acepta:** sub-navegación sticky con menú contextual
- **Tiempo:** 2 h

---

## Phase 4 — Forms (alto uso operativo)

### ☐ 4.1 `Field` (label + control + error + hint)
- **Source → Target:** `template/forms/Field.tsx` → `src/components/forms/field.tsx`
- **Acepta:** wrapper de form control con label, descripción, mensaje de error y estado required/disabled
- **Tiempo:** 1.5 h
- **Bloquea:** MultiSelect, SearchableSelect, DatePicker

### ☐ 4.2 `MultiSelect`
- **Source → Target:** `template/forms/MultiSelect.tsx` → `src/components/forms/multi-select.tsx`
- **Acepta:** tag input con búsqueda y crear items
- **Tiempo:** 3 h

### ☐ 4.3 `SearchableSelect` (combobox)
- **Source → Target:** `template/forms/SearchableSelect.tsx` → `src/components/forms/searchable-select.tsx`
- **Acepta:** input con lista filtrable de opciones
- **Tiempo:** 2.5 h

### ☐ 4.4 `FormSection`
- **Source → Target:** `template/forms/FormSection.tsx` → `src/components/forms/form-section.tsx`
- **Acepta:** sección de formulario con título, descripción y área de campos
- **Tiempo:** 30 min

### ☐ 4.5 `FilterBar`
- **Source → Target:** `template/filters/FilterBar.tsx` → `src/components/filters/filter-bar.tsx`
- **Acepta:** barra de filtros con chips removibles y botón "Limpiar"
- **Tiempo:** 1.5 h

---

## Phase 5 — Date & range

### ☐ 5.1 `DatePicker` (single)
- **Source → Target:** `template/date/DatePicker.tsx` → `src/components/date/date-picker.tsx`
- **Dep:** Phase 1.5 (Calendar)
- **Acepta:** input con popover y calendario
- **Tiempo:** 2 h

### ☐ 5.2 `DateRangePicker`
- **Source → Target:** `template/date/DateRangePicker.tsx` → `src/components/date/date-range-picker.tsx`
- **Tiempo:** 2.5 h

### ☐ 5.3 `RangeSlider` (label + error wrapper)
- **Source → Target:** `template/range/RangeSlider.tsx` → `src/components/forms/range-slider.tsx`
- **Dep:** Phase 1.4 no, solo `ui/slider.tsx` (ya existe)
- **Acepta:** slider con label, valor formateado y mensaje de error
- **Tiempo:** 1 h

---

## Phase 6 — Selection (alternativas a inputs nativos)

### ☐ 6.1 `SegmentedControl`
- **Source → Target:** `template/selection/SegmentedControl.tsx` → `src/components/selection/segmented-control.tsx`
- **Acepta:** grupo de botones pill mutuamente excluyente
- **Tiempo:** 1.5 h

### ☐ 6.2 `RadioCardGroup`
- **Source → Target:** `template/selection/RadioCardGroup.tsx` → `src/components/selection/radio-card-group.tsx`
- **Acepta:** selección de cards con check indicator
- **Tiempo:** 1.5 h

### ☐ 6.3 `CheckboxCardGroup`
- **Source → Target:** `template/selection/CheckboxCardGroup.tsx` → `src/components/selection/checkbox-card-group.tsx`
- **Tiempo:** 1.5 h

### ☐ 6.4 `OptionTile`
- **Source → Target:** `template/selection/OptionTile.tsx` → `src/components/selection/option-tile.tsx`
- **Tiempo:** 1 h

---

## Phase 7 — Charts & analytics (alto valor para dashboards)

### ☐ 7.1 `SurveyMetricCard` (refactor de nuestro `MetricCard`)
- **Source:** `template/survey-analytics/SurveyMetricCard.tsx`
- **Target:** revisar y mejorar `src/components/shared/metric-card.tsx`
- **Acepta:** añadir prop `comparison` para benchmark vs período anterior, support para sparkline embebida
- **Tiempo:** 1.5 h

### ☐ 7.2 `SparklineChart`
- **Source → Target:** `template/charts/SparklineChart.tsx` → `src/components/charts/sparkline-chart.tsx`
- **Dep:** `recharts` o `visx` (instalar)
- **Tiempo:** 1.5 h

### ☐ 7.3 `LineChart`, `BarChart`, `PieChart`
- **Source → Target:** los 3 principales del template
- **Tiempo:** 2 h c/u

---

## Phase 8 — Upload & media (solo si hay demanda)

### ☐ 8.1 `FileDropzone`
- **Source → Target:** `template/upload/FileDropzone.tsx` → `src/components/upload/file-dropzone.tsx`
- **Tiempo:** 1.5 h

### ☐ 8.2 `CsvImporter`
- **Source → Target:** `template/upload/ImportCsvPanel.tsx` → `src/components/upload/csv-importer.tsx`
- **Tiempo:** 3 h (reemplaza lógica inline en `import-candidates-drawer.tsx`)

---

## Reglas de ejecución (cada commit)

1. **Scope atómico:** un item = un commit
2. **Verificación previa al commit:**
   - `npm run lint` → 0 errores
   - `npm run typecheck` → 0 errores (los preexistentes se ignoran)
   - `npm run build` → success
3. **Light/dark probado** en browser real (o screenshot)
4. **Sin hardcoded colors** — solo tokens
5. **Mensaje de commit:** `feat(<scope>): <name> (migration N.M)`
6. **Push a `main`** después de verificar

---

## Métricas de éxito

- [ ] Phase 0-1: tokens + primitives base (2 días)
- [ ] Phase 2: AIButton desplegado en 5+ CTAs reales (1 día)
- [ ] Phase 3-6: forms + selection (1 semana)
- [ ] Phase 7: charts básicos (3 días)
- [ ] Parity ≥ 80% con template
