# Auditoría técnica — Catálogo de fuentes → Vista IA

## 1. Diagnóstico de la tabla actual

La tabla se construye 100% server-side en `getSourceCatalogViewModel()` (`queries.ts:133`). El ViewModel mapea directamente `CATALOG_SOURCES` (array estático en `source-catalog.ts`) a `SourceViewModel`. Cada fuente tiene estas columnas en la UI:

| Columna actual | Origen | Notas |
|---|---|---|
| Fuente (name, key) | CATALOG_SOURCES.name, .key | — |
| País | CATALOG_SOURCES.countryCodes | — |
| Estado | CATALOG_SOURCES.operationalStatus | → 7 valores posibles |
| Última prueba | Supabase `source_connection_tests` | JOIN en history-queries.ts |
| Prioridad | CATALOG_SOURCES.priority | P0 / P1 / P2 |
| Tipo | CATALOG_SOURCES.type | 7 valores |
| Automatización | CATALOG_SOURCES.automationLevel | high / medium / low / manual |
| Sectores | CATALOG_SOURCES.sectors | — |

No hay Tabs ni filtros predefinidos. Todo es una lista plana con filtros de columna libres.

## 2. ViewModel actual

```typescript
// queries.ts:94
type SourceViewModel = {
  key: string;
  name: string;
  countryCodes: string[];
  sectors: string[];
  type: 'official_registry' | 'public_dataset' | 'procurement' | 'industry_association' | 'commercial_provider' | 'web_search' | 'other';
  priority: 'P0' | 'P1' | 'P2';
  automationLevel: 'high' | 'medium' | 'low' | 'manual';
  operationalStatus: 'operational_verified' | 'connection_required' | 'pending_validation' | 'manual_signal_only' | 'validation_only' | 'discarded_paid_or_tos' | 'discarded_low_value';
  url: string | null;
  recommendedUse: string;
  limitations: string[];
  riskNotes: string[];
};
```

Además `SourceCatalogMetrics` y `SourceCatalogFilters` se derivan del arreglo completo.

## 3. Gap funcional

**No existe ningún campo que indique:**

- si la fuente **participa en el flujo IA** (wizard discovery / enrichment automático / source-guided query)
- si está **conectada** (a nivel de pipeline, no de health-check HTTP)
- cuál es su **uso específico en SellUp** (discovery, enrichment, validación, señal)
- si está **conectada a enrichment** (`VALIDATED_SOURCE_CONFIGS`)
- si está **conectada a discovery** (query-builder / catalog-context-retriever)
- si está **conectada como source-guided** (query-planner)
- si es **apta pero no conectada aún**
- cuál es la **siguiente acción recomendada**

**El dato existe en el código pero está distribuido en 4 sistemas de clasificación distintos que no se cruzan:**

| Sistema | Ubicación | Propósito |
|---|---|---|
| `operationalStatus` | CATALOG_SOURCES | Estado operativo formal |
| `type` | CATALOG_SOURCES | Naturaleza de la fuente |
| `validated-source-configs.ts` | Enrichment registry | Capacidades de enrichment (solo 5 fuentes CO) |
| `query-planner.ts` | Source gating | Si participa en queries source-guided (solo 4 fuentes CO tech) |

Ninguno de estos sistemas alimenta el ViewModel de la tabla.

## 4. Propuesta de nuevo modelo visual

### 4a. Tres Tabs en la tabla

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [Fuentes operativas IA]  [Señales manuales / contexto]  [Todas las fuentes]│
│ ───────────────────────                                                    │
│ Tabla filtrada                    |  Tabla filtrada        |  Tabla completa│
│ - discovery                       |  - manual_signal_only  |  sin filtros   │
│ - enrichment automático           |  - type=other         |                │
│ - validación NIT                  |  - sin API/NIT        |                │
│ - aptas no conectadas             |  - solo señal manual  |                │
│ - conectadas                      |                       |                │
└────────────────────────────────────────────────────────────────────────────┘
```

**Tab 1 — Fuentes operativas para IA** (por defecto)
Muestra fuentes cuyo `aiFlowStatus` sea uno de: `'conectada' | 'apta_no_conectada' | 'parcial_pendiente_datos'` o cuyo `sellupUse` sea `'discovery' | 'enrichment' | 'validacion_legal'`.

**Tab 2 — Señales manuales / contexto**
Muestra fuentes con `aiFlowStatus === 'solo_manual'` o `sellupUse === 'senal_manual' | 'contenedor_tecnico' | 'referencia_manual'`.

**Tab 3 — Todas las fuentes**
Muestra el catálogo completo (vista admin actual).

### 4b. Nuevas columnas

| Columna nueva | Propuesta de valores | Cómo se infiere |
|---|---|---|
| **Uso en SellUp** | Discovery prospectos / Enrichment post-discovery / Validación legal/NIT / Señal comercial / Señal contextual / Contenedor técnico / Referencia manual / No usar en flujo IA | Nuevo campo `sellupUse` |
| **Estado flujo IA** | Conectada / Apta no conectada / Parcial / pendiente datos / Solo manual / Pausada / No aplica | Nuevo campo `aiFlowStatus` |
| **Conexión** | Wizard discovery / Enrichment automático / Source-guided query / Snapshot pendiente / No conectada / No aplica | Derivado de registries + nuevo campo |
| **Prioridad operativa** | P0 / P1 / P2 (ya existe) | Ya existe |
| **Automatización real** | Alta / Media / Baja / Manual (ya existe) | Ya existe |
| **Última prueba** | Fecha + estado | Ya existe (history-queries) |
| **Siguiente acción** | Texto libre | Nuevo campo `nextAction` |

## 5. Propuesta de columnas con ordenamiento y visibilidad por defecto

Para Tab 1 (por defecto):

| Columna | Visible por defecto | Ancho |
|---|---|---|
| Fuente | Sí | 200px |
| Uso en SellUp | Sí | 140px |
| Estado flujo IA | Sí | 130px |
| Conexión | Sí | 140px |
| Prioridad | Sí | 80px |
| Automatización | Sí | 120px |
| Última prueba | Sí | 120px |
| País | No (pero filtrable) | 100px |
| Siguiente acción | No | 200px |

## 6. Propuesta de tabs/filtros

### Client-side approach (mínimo cambio)

Usar el sistema de filtros existente de `DataTable` pero con tabs predefinidos que aplican filtros combinados:

- **Tab 1**: `aiFlowStatus IN (conectada, apta_no_conectada, parcial_pendiente_datos)` OR `sellupUse IN (discovery, enrichment, validacion_legal)`
- **Tab 2**: `aiFlowStatus = solo_manual` OR `sellupUse IN (senal_manual, contenedor_tecnico, referencia_manual)`
- **Tab 3**: Sin filtro (todas)

### Server-side approach

Usar `getSourceCatalogViewModel` con un parámetro `filter?: 'operational' | 'manual' | 'all'` (más cambios, más limpio).

**Recomendación**: Client-side con los nuevos campos en el ViewModel existente. No requiere Server Actions adicionales.

## 7. Clasificación Colombia sugerida fuente por fuente

### Vista 1 — Fuentes operativas para IA

| Fuente | Uso en SellUp | Estado flujo IA | Conexión | Prioridad |
|---|---|---|---|---|
| co_siis | Enrichment post-discovery | Parcial / pendiente datos | Snapshot pendiente | P0 |
| co_rues | Discovery prospectos | Conectada | Wizard discovery | P0 |
| co_personas_juridicas_cc | Enrichment post-discovery | Conectada | Enrichment automático | P1 |
| co_secop2_proveedores | Señal comercial | Conectada | Enrichment automático | P1 |
| co_secop2 | Señal comercial | Conectada | Source-guided query | P1 |
| co_minsalud_reps | Enrichment post-discovery | Conectada | Enrichment automático | P0 |
| co_superfinanciera | Enrichment post-discovery | Conectada | Enrichment automático | P0 |
| co_fedesoft | Discovery prospectos | Apta no conectada | No conectada | P1 |

### Vista 2 — Señales manuales / contexto

| Fuente | Uso en SellUp | Estado flujo IA | Conexión | Prioridad |
|---|---|---|---|---|
| co_datos_gov | Contenedor técnico | No aplica | No aplica | P2 |
| co_innpulsa | Señal contextual | Solo manual | No aplica | P2 |
| co_colombia_fintech | Señal contextual | Solo manual | No aplica | P2 |
| co_colombia_digital | Referencia manual | Solo manual | No aplica | P2 |
| co_andicom | Señal contextual | Solo manual | No aplica | P2 |
| co_ruta_n | Señal contextual | Solo manual | No aplica | P2 |
| co_microsoft_partners | Señal contextual | Solo manual | No aplica | P2 |
| co_aws_partners | Señal contextual | Solo manual | No aplica | P2 |
| co_getonboard | Señal contextual | Solo manual | No aplica | P2 |

## 8. Archivos que habría que tocar en una implementación posterior

### Capa de datos (estática) — Orden sugerido

| Archivo | Cambio |
|---|---|
| `src/server/agents/prospecting-toolkit/types.ts` | Agregar tipos `SellupUse`, `AiFlowStatus`, `ConnectionMode` |
| `src/server/agents/prospecting-toolkit/source-catalog.ts` | Agregar campos `sellupUse`, `aiFlowStatus`, `connectionMode`, `nextAction` a cada `CatalogSource` |
| `src/modules/source-catalog/queries.ts` | Mapear nuevos campos en `SourceViewModel`; agregar `aiFlowStatuses`, `sellupUses`, `connectionModes` a filtros y métricas |
| `src/modules/source-catalog/labels.ts` | Agregar labels para los nuevos enums |
| `src/app/(sellup)/settings/source-catalog/source-catalog-client.tsx` | Agregar tabs + nuevas columnas + lógica de filtro por tab |
| `src/app/(sellup)/settings/source-catalog/source-detail-drawer.tsx` | Mostrar nuevos campos en el detalle |

### Capa de datos (derivada) — Alternativa más mantenible

| Archivo | Cambio |
|---|---|
| Crear `src/modules/source-catalog/enrichment-status.ts` | Función que cruza `CATALOG_SOURCES` + `VALIDATED_SOURCE_CONFIGS` + `ENRICHMENT_ADAPTER_REGISTRY` + `QUERY_PLANNER_SOURCE_GATING` para inferir `aiFlowStatus`, `connectionMode`, `sellupUse` programáticamente |

### Total de archivos a modificar: 6 | Total a crear: 1

## 9. Riesgos técnicos

### Riesgo 1 — Romper filtros existentes (ALTO)
Los filtros de columna actuales (`arrIncludesSome`) se alimentan de `filters.operationalStatuses`, `filters.types`, etc. Si se agregan `aiFlowStatuses`, `sellupUses` como nuevos filtros, el sistema de filtros de `DataTable` debe soportarlos. Verificar que `DataTableColumnHeader` + `filterFn` manejen arrays de strings correctamente.

### Riesgo 2 — Cardinalidad de nuevos enums (MEDIO)
`aiFlowStatus` tiene 6 valores. Cada fuente debe tener exactamente uno. En la clasificación manual inicial, es fácil errar. Sugerencia: arrancar con valores explícitos en `source-catalog.ts` y luego migrar a inferencia programática.

### Riesgo 3 — Desincronización con registries dinámicos (MEDIO)
Si se hardcodean los campos en `CATALOG_SOURCES`, quedan desacoplados de `VALIDATED_SOURCE_CONFIGS` y del `query-planner`. Cuando se agregue una nueva fuente al enrichment registry, habrá que recordar actualizar `source-catalog.ts`. Solución: agregar validación cross-file en tests.

### Riesgo 4 — Las tabs cambian el estado esperado de la tabla (BAJO)
Actualmente `data` es un `useState` con reordenamiento manual. Si se implementan tabs con `serverData` filtrado localmente, hay que decidir si el reordenamiento manual se resetea al cambiar de tab o se preserva. Recomendación: resetear al cambiar de tab.

### Riesgo 5 — `co_secop2` vs `co_secop2_proveedores` (BAJO)
Son dos fuentes distintas. `co_secop2_proveedores` está en el enrichment registry; `co_secop2` (compras públicas) no. No confundirlas. Ambas deben estar en Vista 1 pero con connectionMode diferente.

## 10. Recomendación final de implementación mínima

### Fase 1 (auditoría — ESTA)
✅ Completa. Este documento.

### Fase 2 — Agregar campos al tipo y al catálogo (estimado: 1-2h)

**Entregable**: Nueva versión de `CatalogSource` en `types.ts` con:

```typescript
type SellupUse =
  | 'discovery_prospecting'
  | 'enrichment_post_discovery'
  | 'legal_tax_validation'
  | 'commercial_signal'
  | 'contextual_signal'
  | 'technical_container'
  | 'manual_reference'
  | 'not_for_ai_flow';

type AiFlowStatus =
  | 'connected'
  | 'apt_not_connected'
  | 'partial_pending_data'
  | 'manual_only'
  | 'paused'
  | 'not_applicable';

type ConnectionMode =
  | 'wizard_discovery'
  | 'automatic_enrichment'
  | 'source_guided_query'
  | 'snapshot_pending'
  | 'not_connected'
  | 'not_applicable';
```

Agregar a `CatalogSource`: `sellupUse: SellupUse`, `aiFlowStatus: AiFlowStatus`, `connectionMode: ConnectionMode`, `nextAction: string`.

### Fase 3 — Poblar 51 fuentes (estimado: 2-3h)

Recorrer las 51 fuentes del catálogo y asignar los nuevos campos siguiendo la clasificación de la sección 7 de este documento. Las fuentes no-CO siguen el mismo patrón (derivar `sellupUse` de `operationalStatus` + `type` + `recommendedUse`).

### Fase 4 — UI: tabs + columnas (estimado: 3-4h)

- Agregar `TabsList` encima de `DataTable` en `source-catalog-client.tsx`
- Mapear `filterOptions` combinados por tab
- Agregar 4 nuevas columnas (Uso en SellUp, Estado flujo IA, Conexión, Siguiente acción)
- Dejar las columnas viejas como ocultas por defecto en Tab 1 y Tab 2

### Fase 5 — Inferencia programática (estimado: 2-3h, opcional)

Crear `src/modules/source-catalog/enrichment-status.ts` que derive `aiFlowStatus` y `connectionMode` cruzando:
- `VALIDATED_SOURCE_CONFIGS` (enrichment registry) → si la fuente está en este array y `wizardUsage === 'post_discovery_enrichment'` → `connectionMode='automatic_enrichment'`
- `ENRICHMENT_ADAPTER_REGISTRY` → mismo subset
- `SOURCE_GUIDED_KEYS_CO_TECH_R1 / R2` en `query-builder.ts` → `connectionMode='source_guided_query'`
- `getCatalogContext()` → si la fuente aparece en `recommendedSources` para `searchDepth='standard'` en su país → apta para discovery

Esto permite que cuando se agregue una fuente a `VALIDATED_SOURCE_CONFIGS`, el ViewMode se actualice automáticamente sin editar `source-catalog.ts`.

### Orden recomendado: Fase 2 → Fase 3 → Fase 4 (Fase 5 como mejora futura)

**Costo total estimado**: 6-9h distribuidas en 3 PRs.

**No requiere**: migraciones de base de datos, cambios en Supabase, nuevos conectores, ni refactors de pipeline existente.

---

*Auditoría completada: 2026-06-19*
*Clasificación Colombia alineada con la decisión funcional aprobada.*

---

## Hito cerrado — Colombia MVP: fuentes clasificadas y conectadas

**Fecha:** 2026-06-22
**Commit de cierre:** `9208ba1`

### Decisión

Se cierra oficialmente el bloque Colombia del catálogo de fuentes IA. Las 6 fuentes automáticas están clasificadas, conectadas y validadas dentro del flujo del Agente 1. No se seguirán probando fuentes una por una a menos que una prueba cambie una decisión importante o valide un flujo completo del Agente 1.

### Fuentes automáticas (flujo Agente 1)

| Fuente | Rol | Modo | Estado |
|--------|-----|------|--------|
| `co_rues` | Discovery estructurado inicial | Entrada de empresas desde fuente estructurada | ✅ Operativa |
| `co_personas_juridicas_cc` | Validación legal / NIT / matrícula / CIIU | Live enrichment vía datos.gov.co / Socrata | ✅ Connected |
| `co_siis` | Enrichment financiero post-discovery | Snapshot 2024 cargado en Supabase (10.000 registros) | ✅ Connected |
| `co_secop2_proveedores` | Señal B2G / proveedor SECOP II | Live enrichment vía datos.gov.co / Socrata | ✅ Connected |
| `co_minsalud_reps` | Enrichment sector salud | — | ✅ Connected |
| `co_superfinanciera` | Enrichment sector financiero regulado | — | ✅ Connected |

### Fuentes pausadas / manuales / fuera de IA

| Fuente | Estado | Motivo |
|--------|--------|--------|
| `co_fedesoft` | Pausada | Bloqueo upstream por captcha/protección SiteGround. No debe correr automáticamente hasta tener snapshot cargado o ruta estable. |
| `co_secop2` | Manual / no IA | Fuente contextual genérica. Para enrichment automático usar `co_secop2_proveedores`. |

**Fuentes manuales/contextuales (fuera del flujo automático):** `co_innpulsa`, `co_andicom`, `co_colombia_fintech`, `co_ruta_n`, `co_microsoft_partners`, `co_aws_partners`, `co_getonboard`, `co_colombia_digital`, `co_datos_gov`.

### Validaciones completadas

- [x] Adapters principales validados: `co_siis`, `co_personas_juridicas_cc`, `co_secop2_proveedores`
- [x] Hook general `enrichCandidatesWithValidatedSources` validado
- [x] Persistencia `prospect_candidates.metadata.source_enrichment` validada
- [x] Datos de prueba eliminados: candidatos y batch smoke test
- [x] Catálogo visual: Operativas IA muestra las 6 fuentes automáticas
- [x] `co_fedesoft` no aparece en Operativas IA
- [x] `co_secop2` no aparece en Operativas IA
- [x] `co_secop2_proveedores` sigue connected

### Regla operativa

> Para Colombia MVP, no se seguirán probando fuentes una por una. Solo se harán pruebas cuando una prueba cambie una decisión importante o valide un flujo completo del Agente 1.

### Próximo paso recomendado

Avanzar a la clasificación y conexión de fuentes del siguiente país en el roadmap (México o Brasil), replicando el mismo patrón: auditoría → clasificación → conexión de adaptadores → validación en catálogo visual.
