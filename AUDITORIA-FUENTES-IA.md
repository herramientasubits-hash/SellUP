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

## Decisión Chile — SII descartado del MVP activo

**Fecha:** 2026-06-23
**HEAD:** `afb7370` → `8371998`

### Veredicto

`cl_sii` — SII Chile (Servicio de Impuestos Internos) → **REMOVE_FROM_MVP_CATALOG**

### Evidencia técnica

1. **No tiene connector** registrado en `connector-registry.ts`.
2. **No tiene enrichment adapter** en `enrichment-adapter-registry.ts`.
3. **No tiene validated-source-config** en `validated-source-configs.ts`.
4. **No tiene tax identifier resolver** para Chile — solo CO y MX tienen resolvedores.
5. **No participa en source-discovery-preflight** — CL apunta a `cl_res`.
6. **No aparece en recommendedSources** — `connectionMode='not_connected'`, `aiFlowStatus='manual_only'`.
7. **Connection test strategy:** `validation_input_required` (no automatable).

### Evidencia documental

- **SII no tiene API oficial pública** para consulta masiva o validación programática de RUT.
- **SII tiene captcha agresivo** en consulta individual — documentado en `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md`.
- **SII prohíbe scraping automatizado** — documentado en misma fuente.
- **Alternativa:** API de terceros (BaseAPI.cl) es de pago y no está en scope MVP.
- **`cl_res`** (RES / datos.gob.cl) ya es la fuente activa para Chile con RUT estructurado.

### Cambios realizados

| Archivo | Cambio |
|---------|--------|
| `source-catalog.ts` | Eliminada entrada `cl_sii` de CATALOG_SOURCES |
| `AGENTE_1_CATALOG_CONTEXT_RETRIEVER.md` | Eliminada fila SII Chile de tabla Chile |
| `AUDITORIA-FUENTES-IA.md` | Este documento (decisión) |

### No modificado

- `cl_res` intacto
- COUNTRY_RISKS para CL intacto (mención de SII es nota contextual general)
- Labels (son genéricos, no fuente-específicos)
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `tax-identifier-resolution/` intacto
- `strategy-resolver.ts` intacto (regla `validation_only` es genérica)

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

---

## Cierre Colombia — Agente 1 MVP operativo

**Fecha:** 2026-06-22
**Commits:**
- `2689f67` — fix(agent1): align Colombia source gating and enrichment
- `80ff264` — feat(agent1): resolve Colombia tax identifiers before enrichment
- `33b6b7f` — fix(agent1): allow Colombia brand names in tax resolution

### 1. Estado final

- Colombia operativo para MVP del Agente 1.
- Enrichment conectado y persistente.
- Resolución inicial de NIT conectada.
- Validación sin Tavily completada (smoke test).
- Source gating respeta clasificación operativa.
- Enrichment incremental post-discovery funcional.

### 2. Fuentes automáticas activas

| Fuente | Rol |
|--------|-----|
| `co_rues` | Discovery estructurado inicial |
| `co_siis` | Enrichment financiero post-discovery |
| `co_personas_juridicas_cc` | Validación legal / NIT |
| `co_secop2_proveedores` | Señal B2G / proveedor SECOP II |
| `co_minsalud_reps` | Enrichment sector salud |
| `co_superfinanciera` | Enrichment sector financiero regulado |

### 3. Fuentes excluidas del flujo automático

| Fuente | Estado | Motivo |
|--------|--------|--------|
| `co_fedesoft` | paused / manual_signal_only / not_connected | Bloqueo upstream por captcha/protección SiteGround. No debe correr automáticamente. |
| `co_secop2` | manual_only / not_for_ai_flow / not_connected | Fuente contextual genérica. Para enrichment automático usar `co_secop2_proveedores`. |

### 4. Resultado técnico

- `catalog_sources` ya respeta clasificación operativa en flujo IA.
- Source-guided queries ya no usan Fedesoft ni SECOP2 genérico.
- Enrichment post-discovery corre en pipeline incremental con RUES.
- `tax_identifier_resolution` corre antes del enrichment.
- `source_enrichment_status` se persiste en metadata.
- `source_enrichment` se persiste en metadata.

### 5. Resultado funcional

- Si hay NIT resuelto con confianza alta → se guarda `tax_identifier`.
- Si hay match parcial → queda `ambiguous` para revisión.
- Si no hay match → queda `not_found` sin romper enrichment.
- Si el nombre es genérico real (ej: "Software") → queda `skipped`.
- Marcas de una palabra ya no quedan skipped automáticamente.
- No se escribe `tax_identifier` con confianza baja.
- `source_enrichment` sigue corriendo incluso sin NIT.

### 6. Limitaciones actuales

- Resolver inicial usa principalmente `source_company_snapshots` / `co_siis`.
- No se auto-asigna NIT con confianza baja.
- Para mejorar resolución legal completa, falta agregar búsqueda por razón social en `co_personas_juridicas_cc` y posiblemente SECOP proveedores.

### 7. Pendientes recomendados

| Prioridad | Pendiente | Descripción |
|-----------|-----------|-------------|
| P1.3 | Ampliar resolver Colombia | Agregar `co_personas_juridicas_cc` por razón social |
| P1.4 | Evaluar `co_secop2_proveedores` | Revisar si puede apoyar resolución por nombre |
| P2 | UI para ambiguous candidates | Exponer candidates en UI para revisión humana |

### 8. Decisión

- No hacer más corridas Colombia por ahora.
- Colombia queda lista para servir como patrón técnico para Brasil / México / Chile / Perú.
- Siguiente país recomendado: Brasil o México según prioridad del proyecto.

---

## Cierre México — Agente 1 MVP operativo

**Fecha:** 2026-06-22
**HEAD actual:** `main` (commit `9208ba1` — último commit Colombia closure)

### 1. Veredicto general

México validado como país operativo para el MVP del Agente 1 con **una sola fuente conectada al flujo IA** (`mx_denue`). México **no tiene resolución automática de RFC** en MVP. Cualquier RFC mexicano requiere revisión humana o fuente comercial/post-MVP.

### 2. Tabla de fuentes México — Clasificación final

| Source Key | Nombre | Clasificación final | Estado en flujo IA | Uso permitido | Uso NO permitido |
|------------|--------|---------------------|-------------------|---------------|------------------|
| `mx_denue` | DENUE / INEGI API | **Operativa IA** | `CONNECTED_CONTEXTUAL_VALIDATED` | Discovery estructurado, enrichment contextual, validación existencia establecimientos, actividad/giro/ubicación/tamaño aproximado | Resolución RFC, escritura tax_identifier, identidad fiscal, reemplazo revisión humana |
| `mx_datos_gob` | datos.gob.mx | **Contenedor técnico** | `TECHNICAL_CONTAINER_VALIDATED` | Contenedor de datasets, referencia estructural | Fuente directa, discovery, enrichment, validación |
| `mx_siem` | SIEM | **Señal manual** | `MANUAL_SIGNAL_ONLY_VALIDATED` | Señal contextual de registro empresarial | Flujo automático, API, bulk data |
| `mx_canaive` | CANAIVE | **Señal manual** | `MANUAL_SIGNAL_ONLY_VALIDATED` | Señal sectorial cuero/calzado | Flujo automático, API, bulk data |
| `mx_amia` | AMIA | **Señal manual** | `MANUAL_SIGNAL_ONLY_VALIDATED` | Señal sectorial automotriz | Flujo automático, API, bulk data |
| `mx_amiti` | AMITI | **Señal manual** | `MANUAL_SIGNAL_ONLY_VALIDATED` | Señal sectorial tecnología | Flujo automático, API, bulk data |
| `mx_fintech_mx` | Fintech México | **Señal manual** | `MANUAL_SIGNAL_ONLY_VALIDATED` | Señal sectorial fintech | Flujo automático, API, bulk data |
| `mx_compranet` | CompraNet / Compras MX | **Pausada / Señal B2G futura** | `PAUSED_B2G_SIGNAL_VALIDATED` | Posible señal B2G post-MVP | Flujo automático actual, discovery, enrichment |

### 3. Decisiones clave

1. **Solo `mx_denue` queda conectada** al flujo IA del Agente 1.
2. **México no tiene resolución automática de RFC en MVP.** El resolver debe retornar:
   - `tax_identifier = null`
   - `tax_identifier_resolution.status = not_resolvable_automatically`
   - `human_review_required = true`
   - `contextual_sources_available = ['mx_denue']`
3. **Cualquier RFC mexicano requiere revisión humana** o fuente comercial/post-MVP.
4. **`mx_compranet` queda pausada** como posible señal B2G futura, no como fuente conectada actual.
5. **Cámaras/asociaciones** (`mx_siem`, `mx_canaive`, `mx_amia`, `mx_amiti`, `mx_fintech_mx`) quedan como **señales manuales**, no fuentes automáticas.
6. **`mx_datos_gob` queda como contenedor técnico**, no fuente directa.
7. **No se corrió Tavily, LLM, HubSpot ni wizard** para esta validación.
8. **No se modificó Colombia** en este proceso.

### 4. Flujo México MVP

```
candidato (nombre, dominio, linkedin)
  ↓
mx_denue (DENUE/INEGI API) → identity resolver (nombre→establecimiento)
  ↓
¿Match en DENUE?
  ├── Sí → enrichment con datos DENUE (ubicación, giro, empleados)
  │         → flag human_review_required para RFC
  │         → humano provee RFC → validación contra SAT (post-MVP)
  │         → enrichment fiscal completo → HubSpot
  └── No → señal débil
            → flag human_review_required
            → revisión manual profunda
```

### 5. Próximos pasos recomendados (post-MVP)

| Prioridad | Acción | Descripción |
|-----------|--------|-------------|
| P1 | Evaluar Infodata Mexico | Proveedor comercial doméstico con 2M+ registros RFC-based |
| P2 | Evaluar D&B Mexico | Opción global con cobertura MX |
| P3 | Implementar validación SAT | Cuando humano provee RFC, validar contra SAT |

### 6. Referencia cruzada

Ver `docs/RESEARCH_MEXICO_RFC_RESOLVER.md` para investigación técnica completa, restricciones legales (secreto fiscal Art. 69 CFF, LFPDPPP 2025), y análisis detallado por fuente.

---

## Decisión Chile — SENCE OTEC descartado del MVP activo

**Fecha:** 2026-06-23
**HEAD:** `250610e` → commit actual (después de eliminación)

### Veredicto

`cl_sence_otec` — SENCE OTEC Chile → **REMOVE_FROM_MVP_CATALOG**

### Evidencia técnica

1. **No tiene connector** registrado en `connector-registry.ts`.
2. **No tiene enrichment adapter** en `enrichment-adapter-registry.ts`.
3. **No tiene validated-source-config** en `validated-source-configs.ts`.
4. **No tiene tax identifier resolver** para Chile — solo CO y MX.
5. **No participa en source-discovery-preflight** — CL apunta a `cl_res`.
6. **`connectionMode: 'not_connected'`**, **`aiFlowStatus: 'manual_only'`**, **`sellupUse: 'manual_reference'`** — no es una fuente conectada ni automatizable.
7. **`operationalStatus: 'pending_validation'`** — estado que debe resolverse; no tiene conector que permita validación.
8. **`limitations: ['Sin API pública']`** — no existe API oficial. La descarga XLSX desde `sence.gob.cl/organismos/otec` es manual.

### Evidencia documental

- **SENCE OTEC** ofrece un archivo XLSX descargable (`otec_vigentes_al_19_05_2026.xlsx`) con OTEC activos (RUT, nombre, región). El sitio SENCE carga sin captcha ni login.
- **No tiene API** pública ni mecanismo de consulta programática.
- **Valor comercial limitado:** OTEC son organismos de capacitación (oferta de formación), no empresas ICP típicas de SellUp (demanda de servicios digitales). Universo reducido a un solo sector.
- **`cl_res`** ya es la fuente P0 para Chile con RUT estructurado, cobertura multisectorial y descarga CSV directa.

### Cambios realizados

| Archivo | Cambio |
|---------|--------|
| `source-catalog.ts` | Eliminada entrada `cl_sence_otec` de CATALOG_SOURCES |
| `catalog-context-retriever.ts` | Eliminada regla CL específica para SENCE OTEC |
| `AGENTE_1_CATALOG_CONTEXT_RETRIEVER.md` | Eliminada fila SENCE OTEC de tabla Chile |
| `AUDITORIA-FUENTES-IA.md` | Este documento (decisión) |

### No modificado

- `cl_res` intacto
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `tax-identifier-resolution/` intacto (solo CO y MX)
- `source-discovery-preflight.ts` intacto (nunca incluyó SENCE)
- `labels.ts` intacto
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` intacto (documento general)
- Prompts de agente intactos
- Colombia y México intactos

---

## Decisión Chile — CMF descartado del MVP activo

**Fecha:** 2026-06-23
**HEAD:** commit actual (después de eliminación)

### Veredicto

`cl_cmf` — CMF Chile (Comisión para el Mercado Financiero) → **REMOVE_FROM_MVP_CATALOG**

### Evidencia técnica

1. **No tiene connector** registrado en `connector-registry.ts`.
2. **No tiene enrichment adapter** en `enrichment-adapter-registry.ts`.
3. **No tiene validated-source-config** en `validated-source-configs.ts`.
4. **No tiene tax identifier resolver** para Chile — solo CO y MX tienen resolvedores.
5. **No participa en source-discovery-preflight** — CL apunta a `cl_res`.
6. **`connectionMode: 'not_connected'`**, **`aiFlowStatus: 'manual_only'`**, **`sellupUse: 'manual_reference'`** — no es una fuente conectada ni automatizable.
7. **`operationalStatus: 'pending_validation'`** — estado que debe resolverse; no tiene conector que permita validación.
8. **`limitations: ['Consultas manuales o mediante solicitud']`** — no existe API oficial pública. No hay evidencia de dataset descargable estructurado con RUT.

### Evidencia documental

- **CMF Chile** no tiene API oficial pública documentada en el código ni referenciada en docs. El sitio cmfchile.cl tiene información institucional, pero el acceso a datos estructurados de entidades reguladas requiere consulta web individual o solicitud manual.
- **No hay dataset público descargable** identificado (CSV, JSON, XLSX con RUT y razón social de entidades reguladas).
- **Su universo es regulatorio/acotado:** solo entidades financieras vigiladas (bancos, aseguradoras, fondos, corredoras). No representa discovery multisectorial.
- **`cl_res`** ya es la fuente P0 para Chile con RUT estructurado, cobertura multisectorial y descarga CSV directa desde datos.gob.cl.
- CMF mencionado como referencia en `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` en el contexto del sector financiero (a través de AACH), no como fuente propia conectable.

### Cambios realizados

| Archivo | Cambio |
|---------|--------|
| `source-catalog.ts` | Eliminada entrada `cl_cmf` de CATALOG_SOURCES |
| `AUDITORIA-FUENTES-IA.md` | Este documento (decisión) |

### No modificado

- `cl_res` intacto
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `tax-identifier-resolution/` intacto (solo CO y MX)
- `source-discovery-preflight.ts` intacto (nunca incluyó CMF)
- `labels.ts` intacto
- `source-catalog.ts` — solo eliminada entrada cl_cmf; cl_res, cl_corfo, cl_sofofa, cl_startup_chile intactos
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` intacto (documento general; CMF mencionado como regulador contextual, no como fuente)
- Prompts de agente intactos
- Colombia, México y demás países intactos

---

## Decisión: cl_corfo — CORFO Chile

**Veredicto: REMOVE_FROM_MVP_CATALOG**

### Por qué se elimina

1. **No tiene connector** registrado en `connector-registry.ts`.
2. **No tiene enrichment adapter** en `enrichment-adapter-registry.ts`.
3. **No tiene validated-source-config** en `validated-source-configs.ts`.
4. **No participa en source-discovery-preflight** — CL apunta a `cl_res`.
5. **`connectionMode: 'not_connected'`**, **`aiFlowStatus: 'manual_only'`**, **`sellupUse: 'manual_reference'`** — no es una fuente conectada ni automatizable.
6. **`operationalStatus: 'pending_validation'`** — estado pendiente desde creación del catálogo, sin conector que permita validación.

### Evidencia documental

- CORFO publica datos en **datainnovacion.cl** (API REST pública con RUT de beneficiarios) y **dataemprendimiento.corfo.gob.cl** (visualizaciones), pero ambos cubren exclusivamente programas de innovación/emprendimiento (~5.760 empresas, ~10.340 proyectos desde 2010).
- En **datos.gob.cl** existen 6 datasets de CORFO, pero el más reciente es de 2015 (datos de 2012-2013).
- El portal **sgp.corfo.cl** requiere búsqueda web manual con formulario; no hay API pública masiva.
- **No existe un dataset público descargable** que cubra el universo completo de empresas relacionadas con CORFO con RUT, razón social y estado actualizado.
- **Su universo es acotado:** solo beneficiarios de programas públicos (innovación, emprendimiento, créditos con garantía). No representa discovery empresarial multisectorial.
- **`cl_res`** ya es la fuente P0 para Chile con RUT estructurado, cobertura multisectorial (millones de empresas), descarga CSV directa desde datos.gob.cl y actualización periódica.

### Cambios realizados

| Archivo | Cambio |
|---------|--------|
| `source-catalog.ts` | Eliminada entrada `cl_corfo` de CATALOG_SOURCES |
| `AUDITORIA-FUENTES-IA.md` | Este documento (decisión) |

### No modificado

- `cl_res` intacto
- `cl_sofofa`, `cl_startup_chile` intactos
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `tax-identifier-resolution/` intacto (solo CO y MX)
- `source-discovery-preflight.ts` intacto
- `labels.ts` intacto
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` intacto
- Prompts de agente intactos
- Colombia, México y demás países intactos

---

## Decisión: cl_sofofa — SOFOFA Chile

**Veredicto: REMOVE_FROM_MVP_CATALOG**

### Por qué se elimina

1. **No tiene connector** registrado en `connector-registry.ts`.
2. **No tiene enrichment adapter** en `enrichment-adapter-registry.ts`.
3. **No tiene validated-source-config** en `validated-source-configs.ts`.
4. **No participa en source-discovery-preflight** — CL apunta a `cl_res`.
5. **`connectionMode: 'not_connected'`**, **`aiFlowStatus: 'manual_only'`**, **`sellupUse: 'manual_reference'`** — no es una fuente conectada ni automatizable.
6. **`operationalStatus: 'manual_signal_only'`** — solo señal manual desde creación del catálogo.

### Evidencia documental

- SOFOFA es una federación gremial que agrupa ~7.000 empresas afiliadas, 42 gremios sectoriales y 21 gremios regionales. Su membresía se limita a socios del sector industrial chileno.
- El directorio de empresas socias (`/empresas-socias/`) es una lista plana por categoría (Energía, Manufactura, Alimentos, Retail, etc.) sin RUT, sin razón social estructurada, sin sector codificado y sin descarga masiva.
- **No existe API pública** ni dataset descargable. La consulta es manual, página por página, y solo muestra nombre comercial + enlace web.
- **La cobertura es acotada a afiliados**, no al universo empresarial chileno. No representa discovery multisectorial útil para Agente 1.
- **`cl_res` ya es la fuente P0 para Chile**: RUT estructurado, cobertura de millones de empresas, descarga CSV directa desde datos.gob.cl y actualización periódica.

### Cambios realizados

| Archivo | Cambio |
|---------|--------|
| `source-catalog.ts` | Eliminada entrada `cl_sofofa` de CATALOG_SOURCES |
| `AUDITORIA-FUENTES-IA.md` | Este documento (decisión) |

### No modificado

- `cl_res` intacto
- `cl_startup_chile` intactos
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `tax-identifier-resolution/` intacto (solo CO y MX)
- `source-discovery-preflight.ts` intacto
- `labels.ts` intacto
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` intacto
- Prompts de agente intactos
- Colombia, México y demás países intactos

---

## Decisión: cl_ccs — CCS Chile (Cámara de Comercio de Santiago)

**Veredicto: REMOVE_FROM_MVP_CATALOG**

### Por qué se elimina

1. **No tiene connector** registrado en `connector-registry.ts`.
2. **No tiene enrichment adapter** en `enrichment-adapter-registry.ts`.
3. **No tiene validated-source-config** en `validated-source-configs.ts`.
4. **No participa en source-discovery-preflight** — CL apunta a `cl_res`.
5. **`connectionMode: 'not_connected'`**, **`aiFlowStatus: 'manual_only'`**, **`sellupUse: 'manual_reference'`** — no es una fuente conectada ni automatizable.
6. **`operationalStatus: 'manual_signal_only'`** — solo señal manual desde creación del catálogo.

### Evidencia documental

- CCS es un gremio empresarial con ~2.300 socios afiliados, principalmente del sector comercio y retail de la Región Metropolitana.
- El directorio de socios está detrás del portal cerrado (`portalsociosccs.cl`) con acceso solo para miembros. **No hay API pública ni dataset descargable.**
- El sitio web público de CCS (`ccs.cl`) no expone directorio estructurado con RUT, razón social, sector codificado ni descarga masiva.
- **No existe API oficial** ni dataset en datos.gob.cl asociado a CCS.
- **Su universo es acotado a afiliados (~2.300 empresas)** del comercio/retail de Santiago. No representa discovery empresarial multisectorial para Agente 1.
- **La cobertura es regional (Región Metropolitana)**, no nacional.
- **`cl_res` ya es la fuente P0 para Chile**: RUT estructurado, cobertura de millones de empresas, descarga CSV directa desde datos.gob.cl y actualización periódica.

### Cambios realizados

| Archivo | Cambio |
|---------|--------|
| `source-catalog.ts` | Eliminada entrada `cl_ccs` de CATALOG_SOURCES |
| `AUDITORIA-FUENTES-IA.md` | Este documento (decisión) |

### No modificado

- `cl_res` intacto
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `tax-identifier-resolution/` intacto (solo CO y MX)
- `source-discovery-preflight.ts` intacto
- `labels.ts` intacto
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` intacto
- Prompts de agente intactos
- Colombia, México y demás países intactos

---

## Cierre Chile — Agente 1 MVP operativo

**Fecha:** 2026-06-23
**HEAD:** `18ea5ac` (v1.15.3.1)
**Último commit Chile:** `4df9ce7` — chore(source-catalog): remove Startup Chile from MVP catalog

### 1. Estado final

Chile queda cerrado para el MVP activo del Agente 1 con **`cl_res` como única fuente conectada**.

| Aspecto | Detalle |
|---------|---------|
| Fuente activa | `cl_res` — RES / datos.gob.cl |
| Tipo | Discovery estructurado oficial |
| Modo | `wizard_discovery` |
| Estado | `operational_verified` |
| Uso | `enrichment` |
| Datos que entrega | RUT, razón social, región, ciudad, fecha constitución, tipo societario, capital |
| Origen | datos.gob.cl / Registro de Empresas y Sociedades (RES) |

### 2. Limitaciones aceptadas de `cl_res`

- **No entrega sector, giro, CIIU ni actividad económica** — requiere validación posterior de industria/fit.
- **No entrega contactos** — no incluye correos, teléfonos ni decisores.
- **Incluye microempresas y sociedades de bajo capital** — puede requerir filtros posteriores.
- **Incluye EIRL** donde el RUT puede ser de persona natural — requiere revisión.
- **No debe usarse como fuente única** para priorización comercial sin señales adicionales.
- **No existe aún enrichment adapter Chile ni resolvedor automático de RUT** en SellUp.

### 3. Fuentes descartadas del MVP activo

| Fuente | Razón de exclusión |
|--------|-------------------|
| `cl_chilecompra` | Requiere ticket/API key, cobertura B2G limitada, no representa universo empresarial general |
| `cl_sii` | Sin API oficial pública, captcha en consulta individual, scraping prohibido por ToS |
| `cl_sence_otec` | Universo acotado a OTEC (formación/capacitación), sin API pública, descarga manual |
| `cl_cmf` | Universo financiero regulado acotado, sin dataset público descargable con RUT |
| `cl_corfo` | Universo acotado a beneficiarios de programas públicos de innovación/emprendimiento |
| `cl_sofofa` | Directorio gremial manual, sin API ni RUT estructurado, cobertura acotada a afiliados |
| `cl_ccs` | Directorio cerrado/manual, portal de socios sin API pública, cobertura regional RM |
| `cl_startup_chile` | Startups/programa público, sin RUT ni API general, universo acotado ~2.500 startups |

### 4. Decisión

- **No quedan fuentes Chile manuales o pendientes** en catálogo activo.
- **Cualquier fuente Chile secundaria** podrá reconsiderarse post-MVP solo con necesidad explícita, API/dataset oficial y valor comercial claro.
- **`cl_res` queda como única fuente Chile activa** para el flujo del Agente 1.
- **Colombia y México no fueron modificados** en este proceso de cierre.

### 5. Validaciones realizadas

- [x] `CATALOG_SOURCES` solo contiene `cl_res` para `countryCodes: ['CL']`
- [x] Ninguna de las 8 fuentes removidas permanece en `CATALOG_SOURCES`
- [x] `source-discovery-preflight.ts` usa CL → `cl_res` exclusivamente
- [x] `SOURCE_DISCOVERY_REGISTRY` tiene solo `cl_res` para Chile (sin `cl_chilecompra`)
- [x] `ALLOWED_SOURCE_KEYS` tiene solo `['cl_res', 'mx_denue', 'co_rues']`
- [x] No hay referencias UI activas a fuentes Chile removidas
- [x] `cl_res` mantiene `sellupUse: 'enrichment'`, `aiFlowStatus: 'connected'`, `connectionMode: 'wizard_discovery'`, `operationalStatus: 'operational_verified'`
- [x] Colombia no fue tocado (fuentes CO intactas en CATALOG_SOURCES)
- [x] México no fue tocado (fuentes MX intactas en CATALOG_SOURCES)
- [x] `npm run typecheck` — sin errores
- [x] `npm run build` — build exitoso
- [x] `git diff --check` — sin espacios en blanco conflictivos

---

## Decisión Chile — INAPI datos abiertos (post-MVP)

**Fecha:** 2026-06-23
**HEAD:** `af0c079` (v1.15.4)

### Veredicto

`cl_inapi` — INAPI datos abiertos → **NOT_PRESENT_NO_ACTION_REQUIRED**

INAPI no existe en el repositorio (no hay entrada en `CATALOG_SOURCES`, no hay connector, adapter, config, resolver ni referencia documental). No requiere cambios en código ni catálogo.

### Evidencia técnica

1. **No aparece en `CATALOG_SOURCES`** (`source-catalog.ts`) — búsqueda `inapi|INAPI|cl_inapi` sin resultados.
2. **No aparece en `connector-registry.ts`**, `enrichment-adapter-registry.ts`, `validated-source-configs.ts`, `tax-identifier-resolution/` ni `source-discovery-preflight.ts`.
3. **No aparece en documentación** (`docs/AGENTE_1_CATALOG_CONTEXT_RETRIEVER.md`, `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md`, `AUDITORIA-FUENTES-IA.md`).
4. **No aparece en worktrees ni commits anteriores** — búsqueda global en repo sin resultados.

### Evidencia documental ligera

- **INAPI datos abiertos** (`inapi.cl/datos-abiertos`) publica 4 datasets en `datos.gob.cl`:
  1. `solicitudes-de-marcas` — solicitudes de marcas (2009-presente), archivos XLSX por año.
  2. `registros-de-marcas` — marcas registradas (2009-presente).
  3. `solicitudes-de-patentes` — solicitudes de patentes, modelos de utilidad y diseños industriales.
  4. `registros-de-patentes` — patentes registradas.
- **Datos que entrega:** número de solicitud/registro, nombre de marca, nombre del solicitante (persona natural o jurídica, con prefijo de país), clases Niza, fechas, estado. **No entrega RUT como campo estructurado** — el campo `Applicants` puede incluir RUT en el texto libre del nombre (ej: `(CL) MARTIN LARRAIN CARLOS...`), pero no es un campo normalizado ni obligatorio.
- **Cobertura temática:** exclusivamente propiedad industrial (marcas y patentes). No cubre el universo general de empresas chilenas.
- **Valor para Agente 1:** no sirve como discovery primario de empresas (no tiene RUT estructurado, razón social, sector ni datos de contacto). Podría servir post-MVP como señal secundaria de innovación/propiedad intelectual para empresas ya identificadas por `cl_res`.

### Decisión

- **No se agrega al catálogo MVP activo.**
- **No requiere cambios en código ni catálogo** — INAPI no existe en el repositorio.
- **Queda documentada como señal post-MVP** por si en el futuro se requiere evaluar propiedad industrial como señal de innovación.
- **Chile permanece cerrado** para el MVP con `cl_res` como única fuente activa. No se reabre Chile.
- **Colombia, México, Perú y `cl_res` no fueron tocados.**

### No modificado

- `cl_res` intacto
- `CATALOG_SOURCES` intacto (INAPI nunca estuvo)
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `tax-identifier-resolution/` intacto
- `source-discovery-preflight.ts` intacto
- `docs/AGENTE_1_CATALOG_CONTEXT_RETRIEVER.md` intacto
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` intacto
- Colombia, México, Perú intactos

---

## Decisión Perú — Cámara de Comercio de Lima (pe_camara_lima)

**Fecha:** 2026-06-23
**HEAD:** `a3e926a` (docs(agent1): classify INAPI as post-MVP Chile signal)

### Veredicto

`pe_camara_lima` — Cámara de Comercio de Lima → **REMOVED_FROM_MVP_CATALOG**

Fuente gremial/manual sin API ni dataset público estructurado. Requiere membresía y navegación manual. Sin conector implementado. Redundante frente a `pe_sunat_bulk` (P0, oficial) y `pe_seace` (P1, oficial). Removida del catálogo MVP activo.

### Evidencia técnica

1. **En `CATALOG_SOURCES`** (`source-catalog.ts:968`):
   - `priority: 'P2'` — prioridad mínima
   - `operationalStatus: 'pending_validation'` — no validada
   - `automationLevel: 'manual'` — sin automatización
   - `type: 'industry_association'` — gremial
   - Limitaciones: "Solo empresas afiliadas a la CCL", "sin API — consulta manual", "pendiente validación"
   - riskNotes: "Verificar disponibilidad y estructura del directorio"

2. **No aparece en `connector-registry.ts`** — sin conector implementado. Registry solo tiene: `cl_res`, `mx_denue`, `co_rues`.

3. **No aparece en `enrichment-adapter-registry.ts`** — sin adapter de enriquecimiento.

4. **No aparece en `validated-source-configs.ts`** — no está validada.

5. **No aparece en `source-discovery-preflight.ts`** — no recomendada automáticamente. COUNTRY_SOURCE_MAP solo tiene: CO, MX, CL.

6. **Solo referencia:** búsqueda global `grep -rn "pe_camara_lima"` devuelve solo la definición en `source-catalog.ts:968`. Sin referencias operacionales.

### Evidencia documental ligera

- **URL:** `https://www.camaralima.org.pe/` — directorio web sin API pública.
- **Tipo:** Directorio de empresas afiliadas a la Cámara de Comercio de Lima (gremial).
- **Cobertura:** Solo empresas afiliadas a la CCL — no representa el universo empresarial peruano.
- **Acceso:** Requiere afiliación/membresía. Sin datos abiertos/bulk export documentado.
- **RUC:** No estructurado. Afiliados solo.

### Decisión

- **Removida de `CATALOG_SOURCES`** (`source-catalog.ts`) — entrada completa eliminada.
- **Razón:** Fuente manual/gremial/sin API/sin dataset público validado. Baja prioridad (P2). No validada. Sin conector. Redundante frente a fuentes oficiales Perú (P0 y P1).
- **Perú permanece activo** con fuentes verificadas: `pe_sunat_bulk` (P0, oficial), `pe_sunat` (P0, validation_only), `pe_seace` (P1, oficial), `pe_produce` (P1, manufactura).
- **Colombia, México, Chile, INAPI no fueron tocados.**

### Archivos modificados

- `src/server/agents/prospecting-toolkit/source-catalog.ts` — Removida entrada `pe_camara_lima` (líneas 966-986).

### No modificado

- `connector-registry.ts` intacto (nunca tuvo adapter para pe_camara_lima)
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `source-discovery-preflight.ts` intacto
- `pe_sunat_bulk`, `pe_sunat`, `pe_seace`, `pe_produce` intactos
- Colombia, México, Chile intactos
