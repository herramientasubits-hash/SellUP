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

## Hito cerrado — Perú.1B: Investigación formal de conectabilidad de fuentes y APIs Perú

**Fecha:** 2026-06-23
**HEAD inicial:** `03d1a27` feat(source-catalog): add SUNAT Peru bulk availability connector
**HEAD actual:** commit de cierre

### Veredicto

Investigación completada. Se evaluaron 20+ fuentes y proveedores para Perú. La base del MVP sigue siendo `pe_sunat_bulk` (SUNAT Padrón RUC Bulk). Se identificaron 3 fuentes post-MVP prioritarias: OpenRUC (fallback gratuito), Latinfo (enriquecimiento multi-fuente con score KYB) y Migo API (representantes legales). Se rechazaron 7 fuentes por riesgo legal, falta de documentación o falta de encaje con Agente 1.

### Fuentes confirmadas para MVP

| Fuente | Rol | Recomendación |
|--------|-----|---------------|
| `pe_sunat_bulk` | Discovery + validación RUC masiva | ✅ Conectar ahora (Perú.2) |
| `pe_sunat` | Validación individual complementaria | ✅ Mantener en catálogo |
| `pe_seace` | Señal B2G | ✅ Mantener en catálogo |
| `pe_produce` | Señal manufactura | ✅ Mantener en catálogo |

### Fuentes post-MVP (priorizadas)

| Prioridad | Fuente | Valor |
|-----------|--------|-------|
| P1 | Latinfo | Enriquecimiento multi-fuente (SUNAT+OSCE+OEFA+SEACE+RNP) + score KYB. 1,000 créditos/mes gratis. Cubre 6 países LatAm. |
| P1 | OpenRUC | Fallback validación RUC. Gratis, sin auth, open source. |
| P2 | Migo API | Representantes legales + locales anexos. S/15–25/mes. Trial 7 días. |
| P2 | OSCE/SEACE adapter | Señal B2G automática |
| P3 | RNP | Proveedores habilitados Estado |

### Fuentes rechazadas para MVP

| Fuente | Motivo |
|--------|--------|
| APIS.net.pe/Decolecta | Proveedor individual, datos parciales, sin garantías empresariales |
| Excel Negocios | Scraping SUNAT, datos de contacto sin verificación legal |
| PhantomBuster | Riesgo legal alto (LinkedIn ToS) |
| Sales Navigator (automático) | ToS prohíbe automatización |
| Verifica.id | Fuera de alcance (KYC/AML, no prospección B2B) |
| Kaspr | Sin evidencia de cobertura Perú |
| Apify/Octoparse/Thunderbit | Sin caso de uso que justifique scraping |

### Cambios realizados

| Archivo | Cambio |
|---------|--------|
| `docs/PERU_SOURCE_CONNECTABILITY_RESEARCH.md` | Creado — investigación formal (20+ fuentes, tabla comparativa, recomendación arquitectura) |
| `AUDITORIA-FUENTES-IA.md` | Este documento (decisión) |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | Actualizada sección Perú con nuevas fuentes |

### No modificado

- `source-catalog.ts` intacto — CATALOG_SOURCES no tocado
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `source-discovery-preflight.ts` intacto
- `SOURCE_DISCOVERY_REGISTRY` intacto
- `package.json` / `package-lock.json` intactos
- Supabase no tocado
- Colombia, México, Chile, INAPI intactos

### Validaciones

*(Resultados se completarán después de ejecución)*

### Siguiente hito recomendado

**Perú.2** — Construir pipeline de disponibilidad masiva con `pe_sunat_bulk`:
1. Completar normalización de datos SUNAT.
2. Conectar wizard discovery para Perú.
3. Configurar source-discovery-preflight.
4. Registrar en SOURCE_DISCOVERY_REGISTRY.
5. Probar corrida de discovery controlada.

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

## Decisión Chile — INAPI Datos Abiertos (post-MVP signal)

**Fecha:** 2026-06-23
**HEAD inicial:** `af0c079` (v1.15.4) → `48902753b1acf1aed394a46434fc84013f770d2e`
**HEAD actual:** `48902753b1acf1aed394a46434fc84013f770d2e` (v1.15.8)

### Veredicto

`cl_inapi` — INAPI Datos Abiertos → **CONNECTABLE_WITH_LIMITATIONS**

INAPI no está en `CATALOG_SOURCES`, no se agrega al catálogo activo, no entra al MVP. Pero tras spike técnico aislado se confirma que **sí tiene recursos consumibles vía CKAN/datos.gob.cl** sin auth. Queda como señal post-MVP de innovación/propiedad industrial.

### Estado

- `post-MVP signal`
- No fuente MVP activa
- No fuente principal de discovery
- No construir connector todavía

### Evidencia técnica del spike

**Plataforma:** CKAN API pública (`datos.gob.cl`)

**Datasets identificados:**

1. `solicitudes-de-marcas` — solicitudes de marcas (2009-presente)
2. `registros-de-marcas` — marcas registradas (2009-presente)
3. `solicitudes-de-patentes` — solicitudes de patentes, modelos de utilidad y diseños industriales
4. `registros-de-patentes` — patentes registradas

**Acceso:**

- `package_show?id={dataset-name}` — metadata del dataset
- `datastore_search?resource_id={id}&limit=N&offset=N` — datos en JSON paginado
- Sin login, sin token, sin captcha, sin sesión, sin scraping
- XLSX descargables por año como alternativa offline

**Campos útiles por dataset:**

- `ApplicationNumber`
- `RegistrationNumber`
- `BrandName` / `Title`
- `Applicants`
- `NizaClasses` / `IPC`
- `FilingDate`
- `RegistrationDate`
- `Status`
- `Country` / `LocationApplicants` / `StateApplicants`

### Valor para SellUp

| Señal | Dataset fuente | Uso potencial |
|-------|---------------|---------------|
| Marca registrada | registros-de-marcas | Formalidad comercial — empresa con marca registrada es formal, opera con nombre protegido |
| Múltiples marcas | registros-de-marcas | Expansión de portafolio — diversificación de líneas de negocio |
| Solicitud de patente | solicitudes-de-patentes | Innovación / I+D — empresas tecnológicas o con actividad inventiva |
| Clase Niza | registros-de-marcas | Categoría de producto/servicio — señal de sector/industria |
| Clase IPC | registros-de-patentes | Categoría tecnológica — señal de dominio técnico |

**Uso recomendado:** `enrichment_signal` — señal secundaria post-discovery para empresas ya identificadas por `cl_res`.

### Limitaciones

- **Sin RUT/RUN/tax_identifier estructurado** — el campo no existe como columna normalizada.
- **`Applicants` es texto libre** con formato tipo `(CL) NOMBRE`. Puede contener RUT incidental en el nombre, pero no es parseable de forma determinista.
- **Matching no determinista con `cl_res`** — cualquier cruce requeriría fuzzy matching por nombre, con riesgo de falsos positivos/negativos.
- **No usar como discovery principal** — sin RUT no se puede crear un candidate viable directamente.
- **Alto riesgo si se usa para crear empresas** — el matching por nombre no es confiable para determinación de identidad legal.

### Decisión

- **No se agrega a `CATALOG_SOURCES`** — no crear `cl_inapi` en el repositorio.
- **No construir connector, adapter, resolver ni validated-source-config.**
- **No es fuente activa del MVP.**
- **Chile permanece cerrado** para el MVP con `cl_res` como única fuente activa.
- **Queda documentada como señal post-MVP** de innovación / propiedad industrial.
- **Cruce con `cl_res`** requeriría fuzzy matching y no debe implementarse sin caso de uso explícito post-MVP.

### Arquitectura futura sugerida (post-MVP)

| Atributo | Valor |
|----------|-------|
| `source key` | `cl_inapi` |
| `sellupUse` | `enrichment_signal` |
| `aiFlowStatus` | `post_mvp` |
| `connectionMode` | `not_connected` |
| `operationalStatus` | `post_mvp_candidate` |
| `type` | `intellectual_property_registry` |
| Uso | enrichment / señal secundaria, nunca P0 discovery |

### No modificado

- `CATALOG_SOURCES` intacto — INAPI no se agregó
- `cl_res` intacto
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

---

## Hito cerrado — Perú.3H: Vercel-safe SUNAT snapshot strategy + raw sample boundary

**Fecha:** 2026-06-23
**HEAD inicial:** `0c2a86d` — feat(source-catalog): add SUNAT Peru sample parse dry run
**HEAD actual:** commit de cierre

### Decisión

Se cierra la barrera de arquitectura y seguridad para SUNAT Perú. La arquitectura Vercel-safe queda documentada con fronteras claras entre Vercel (solo consulta de resultados pre-procesados), Worker/Local (procesamiento pesado) y Supabase (fuente consultable). `fullSampleLines` queda marcado como internal-only development artifact.

### Reglas operativas

1. **Vercel NO descarga ZIP, NO descomprime, NO parsea millones de filas.**
2. **Worker/local descarga, descomprime, filtra RUC 20, normaliza y genera snapshot.**
3. **Supabase almacena snapshot normalizado para consulta por Vercel.**
4. **fullSampleLines es solo artefacto interno de dry-run — no persiste, no se expone.**
5. **PE sigue en SAFE_CONNECTOR_ONLY — no activar registry/preflight/wizard.**

### Confirmaciones

| Confirmación | Estado |
|-------------|--------|
| PE sigue SAFE_CONNECTOR_ONLY | ✅ |
| No se activó preflight/registry/wizard | ✅ |
| No se descargó ZIP completo | ✅ |
| No se escribió Supabase | ✅ |
| fullSampleLines es solo dry-run interno | ✅ |
| No existen rawRows/allRows/fullRows en output | ✅ |
| Siguiente hito será local/offline/development-only | ✅ |

### No modificado

- `source-catalog.ts` intacto — CATALOG_SOURCES no tocado
- `connector-registry.ts` intacto
- `enrichment-adapter-registry.ts` intacto
- `validated-source-configs.ts` intacto
- `source-discovery-preflight.ts` intacto
- `SOURCE_DISCOVERY_REGISTRY` intacto
- `package.json` / `package-lock.json` intactos
- Supabase no tocado
- Colombia, México, Chile, INAPI intactos

---

## Hito cerrado — Perú.3K: Investigación técnica fuentes CIIU / actividad económica para RUC 20

**Fecha:** 2026-06-24
**HEAD inicial:** `31c1829` — chore(agent1): align rich profile dry run and write smoke diagnostics
**Tipo:** Research-only — sin código productivo, sin Supabase, sin candidatos

### Hallazgo principal

El **Padrón Reducido RUC** de SUNAT (ya descargado en Perú.3J) tiene exactamente **15 columnas y NO incluye CIIU ni actividad económica**. SUNAT tiene CIIU internamente y lo expone en la consulta web individual (con captcha), pero no lo exporta en el archivo de descarga masiva pública. No existe un "Padrón Completo" diferenciado públicamente descargable con CIIU.

Esta investigación corrige documentación previa incorrecta que afirmaba que el Padrón RUC incluía CIIU.

### Fuentes evaluadas

| Fuente | RUC | CIIU | Tipo acceso | Verdict |
|--------|-----|------|------------|---------|
| SUNAT Padrón Reducido | ✅ | ❌ conf. | Descarga pública | USE_AS_REFERENCE_ONLY (para CIIU) |
| SUNAT e-consultaruc web | ✅ | ✅ | Web + captcha | REJECT masivo |
| PRODUCE **MiPyme por Sector** ⭐ | ✅ | ✅ | Descarga pública | **SPIKE_LOCAL_FIRST** |
| PRODUCE Grandes Empresas Manufactura | ✅ | ✅ | Descarga pública | USE_AS_REFERENCE_ONLY |
| INEI Catálogo CIIU Rev4 | ❌ | ✅ | Descarga pública | USE_AS_REFERENCE_ONLY |
| **Migo API** | ✅ | ❌ real | API privada (pago) | **MIGO_NOT_USEFUL_FOR_CIIU** (spike real Perú.3N-R) |
| ApiDni.com | ✅ | ✅ conf. | API privada | PRIVATE_PROVIDER_ONLY |
| ApiPeru.dev | ✅ | ❌ conf. | API privada | REJECT |
| PeruAPI.com | ✅ | ❌ conf. | API privada | REJECT |
| JSON.pe | ✅ | ❌ conf. | API privada | REJECT |
| Latinfo | ✅ | ❓ | API privada (free tier) | UNKNOWN |

### Decisión de arquitectura

**Estrategia híbrida (actualizada post Perú.3N-R):**
1. **SPIKE** PRODUCE MiPyme por Sector (hito Perú.3L) — descarga gratuita, oficial, tiene RUC + CIIU — bloqueada por WAF (Perú.3L-2A)
2. ~~Si cobertura ≥ 60%: PRODUCE MiPyme como fuente CIIU principal + Migo API como fallback~~ — Migo NO sirve para CIIU (spike real Perú.3N-R: `MIGO_NOT_USEFUL_FOR_CIIU`)
3. ~~Si cobertura < 60%: Migo API como fuente principal~~ — descartado por resultado real
4. **Estado actual:** No existe fuente privada confirmada para CIIU masivo Perú. Evaluar ApiDni.com como siguiente candidato.

### Mapa CIIU → Sector SellUp (referencia)

| CIIU Sección | Sector SellUp |
|---|---|
| J (6100-6399) | Tecnología / TIC |
| G (4511-4799) | Retail / Comercio |
| Q (8600-8899) | Salud |
| P (8500-8599) | Educación |
| K (6400-6630) | Financiero |
| C (1000-3399) | Manufactura |

### Confirmaciones Perú.3K

| Confirmación | Estado |
|---|---|
| PE sigue SAFE_CONNECTOR_ONLY | ✅ |
| pe_sunat_bulk sigue not_connected | ✅ |
| PE fuera de source-discovery-preflight | ✅ |
| pe_sunat_bulk fuera de SOURCE_DISCOVERY_REGISTRY | ✅ |
| No se descargó archivo grande nuevo | ✅ |
| No se creó snapshot CIIU | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos ni batches | ✅ |
| No se tocó INAPI, Chile, México, Colombia | ✅ |
| No se creó código productivo | ✅ |

### Archivos modificados en Perú.3K

- `docs/PERU_SUNAT_CIIU_SOURCE_RESEARCH.md` — Creado (investigación completa Perú.3K)
- `AUDITORIA-FUENTES-IA.md` — Agregada esta sección
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` — Corregido error de CIIU en Padrón RUC; agregado PRODUCE MiPyme

### Próximo hito recomendado (desde Perú.3K)

**Perú.3L — Spike local: PRODUCE MiPyme por Sector Productivo**
Descargar, verificar columnas, cruzar con snapshot Perú.3J por RUC, calcular % de match y distribución CIIU.
*Resultado: BLOQUEADO — `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL` (ver Perú.3L-2A). PRODUCE MiPyme y Grandes Empresas son WAF-bloqueados para acceso programático.*

---

## Hito cerrado — Perú.3M: Evaluación controlada Migo API como fallback CIIU Perú

**Fecha:** 2026-06-24
**HEAD inicial:** `70260c1` — docs(source-catalog): classify PRODUCE Peru CIIU source as WAF-blocked
**Tipo:** Research + evaluación de arquitectura — sin código productivo, sin Supabase, sin candidatos, sin llamadas reales
**MIGO_API_KEY_PRESENT:** false
**Depende de:** Perú.3L-2A (PRODUCE WAF-bloqueado)

### Contexto

Perú.3L-2A cerró PRODUCE MiPyme como `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL`. No existe fuente oficial gratuita operable para CIIU masivo en Perú. Migo API es el candidato privado identificado en Perú.1B y Perú.3K como mejor proveedor confirmado con CIIU.

### Hallazgos principales

| Pregunta | Respuesta |
|----------|-----------|
| ¿Endpoint por RUC? | ✅ `GET /api/v1/ruc/{ruc}` — Bearer token |
| ¿Devuelve CIIU? | ✅ CIIU Rev 3 + Rev 4 (principal + secundarias) |
| ¿Devuelve actividad económica? | ✅ Descripción textual incluida |
| ¿Devuelve estado/condición? | ✅ Estado tributario + condición domicilio |
| ¿Consulta individual? | ✅ Sí |
| ¿Consulta batch? | ✅ Sí (confirmado en docs; tamaño exacto pendiente de spike) |
| ¿Modelo auth? | ✅ Bearer token (API key) |
| ¿Costo? | Demo: 700q/7d gratis → Básico: S/15/mes (40K) → Empresa: S/25/mes (80K) → Premium: S/25/mes (150K) |
| ¿Rate limit? | ⚠️ No documentado explícitamente — confirmar con trial |
| ¿ToS compatible? | ⚠️ No revisados formalmente para IA/agentes — revisión pendiente |
| ¿Discovery o enrichment? | Enrichment únicamente — NO genera empresas nuevas |

### Verdict

```
SPIKE_WITH_TEST_KEY

Razón: CIIU confirmado, batch confirmado, precio confirmado.
Bloqueador: ToS no revisados + payload exacto no testeado (MIGO_API_KEY_PRESENT=false).
Siguiente: Obtener trial key → spike técnico → revisar ToS → confirmar integración.
```

### Arquitectura propuesta

```
SUNAT Padrón RUC → RUC 20 snapshot (851,883 empresas)
  ↓
Migo API Batch Enricher (worker/job, NO Vercel)
  ↓
Field Extractor (solo CIIU + estado + ubigeo — sin representantes personales)
  ↓
Supabase upsert ciiu_principal + sector_sellup
```

Migo = `enrichment_provider`, no `discovery_provider`.

### Estrategia recomendada para MVP — Opción A

```
Capa 1: SUNAT Padrón Reducido RUC → base legal (RUC, estado, condición, ubigeo)
Capa 2: Migo API → CIIU principal + secundarias (enriquecimiento bajo demanda)
Capa 3: Tabla CIIU → sector_sellup (derivada internamente)
```

### Datos a guardar vs no guardar

**Guardar:** `ciiu_codigo`, `ciiu_descripcion`, `estado_contribuyente`, `condicion_domicilio`, `ubigeo`, `sector_sellup`, `migo_enriched_at`
**NO guardar:** Representantes legales (personas naturales), DNI, datos personales. Ley N° 29733 Perú.

### Confirmaciones Perú.3M

| Confirmación | Estado |
|---|---|
| PE sigue SAFE_CONNECTOR_ONLY | ✅ |
| Migo NO registrado en source-catalog ni enrichment registry | ✅ |
| No se realizaron llamadas reales a Migo API | ✅ |
| MIGO_API_KEY_PRESENT=false | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos ni batches | ✅ |
| No se activó preflight/registry/wizard | ✅ |
| No se tocó INAPI, Chile, México, Colombia | ✅ |
| No se creó código productivo | ✅ |
| API key no aparece en ningún archivo/log/commit | ✅ |

### Archivos modificados en Perú.3M

- `docs/PERU_MIGO_API_CIIU_EVALUATION.md` — Creado (evaluación completa Perú.3M)
- `AUDITORIA-FUENTES-IA.md` — Agregada esta sección
- `docs/PERU_SUNAT_CIIU_SOURCE_RESEARCH.md` — §3.7 Migo API expandido con verdict y arquitectura
- `docs/PERU_SOURCE_CONNECTABILITY_RESEARCH.md` — §2.2 Migo API actualizado con conclusiones Perú.3M
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` — Migo actualizado con verdict y estrategia

### Próximo hito recomendado

**Perú.3N — Spike real con trial key Migo API**

Prerrequisitos: registrar en `app.migo.pe`, obtener plan Demo (700 consultas / 7 días), configurar `MIGO_API_KEY` en `.env.local`, revisar ToS.
Alcance: script temporal `.tmp/migo-spike/`, 50-100 RUCs de muestra, verificar payload CIIU, confirmar batch endpoint, documentar rate limits.
NO: Supabase, candidatos, código productivo, API key en commits.
No autorizar hasta instrucción explícita.

---

## Hito Integraciones.1 — Auditoría del manejo actual de credenciales/API keys en SellUp

**Hito:** Integraciones.1
**Fecha:** 2026-06-24
**HEAD inicial:** `305ad48` — feat(agent1): show ICP size gate in candidate review UI
**Tipo:** Auditoría de solo lectura — sin código, sin Supabase, sin credenciales reales
**Objetivo:** Confirmar cómo está implementado el manejo de credenciales en SellUp antes de conectar Migo API

---

### Diagnóstico ejecutivo

SellUp implementa una **arquitectura de credenciales madura y production-ready** basada en Supabase Vault como almacén cifrado central. Todos los secretos están cifrados server-side, nunca expuestos al frontend, y el acceso está controlado por políticas RLS admin-only.

**Veredicto:** El patrón de integración por API key ya existe y es seguro. Migo debe reutilizarlo íntegramente.

---

### 1. Tablas Supabase encontradas

| Tabla | Migración | Propósito |
|-------|-----------|-----------|
| `external_integrations` | `015_create_external_integrations.sql` | Catálogo de integraciones disponibles (HubSpot, Slack, Google Drive, Samu, Tavily, Google CSE) |
| `external_integration_connections` | `015_create_external_integrations.sql` | Estado de conexión y referencia a Vault por integración. Incluye `auth_type`, `credentials_status`, `connection_status`, `vault_secret_id` |
| `integration_audit` | `016_create_integration_audit.sql` | Trazabilidad de todos los eventos de credenciales (sin guardar secretos) |
| `prospecting_providers` | `018_create_prospecting_providers.sql` | Catálogo para proveedores de prospección/enriquecimiento (Apollo, Lusha, futuros) |
| `source_catalog_connections` | `047_create_source_catalog_connections.sql` | Estado de conexión para fuentes de datos (DENUE México, Socrata, ChileCompra, etc.) con `vault_secret_id` |
| `ai_providers` | `011_create_ai_provider_connections.sql` | Catálogo de proveedores IA (Gemini, OpenAI, Claude) con referencia a Vault |
| `user_drive_connections` | `024_google_drive_integration.sql` | Conexiones Google Drive por usuario (granularidad por usuario, no global) |
| `user_drive_audit` | `024_google_drive_integration.sql` | Auditoría Google Drive por usuario |

**Vault RPCs** (migración `017_vault_credentials.sql`):
- `upsert_vault_secret(p_name, p_secret, p_description)` — Crea o actualiza un secreto, retorna UUID
- `get_vault_secret_decrypted(p_name)` — Obtiene secreto descifrado (solo server-side)
- `has_vault_secret(p_name)` — Verifica existencia sin retornar valor
- `delete_vault_secret(p_name)` — Elimina secreto

---

### 2. Rutas UI para integraciones

| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/settings/integrations` | `src/app/(sellup)/settings/integrations/page.tsx` | Hub principal con tarjetas de estado por integración |
| `/settings/integrations/hubspot` | `.../hubspot/page.tsx` | Token de Private App: ingresar, actualizar, testear, desconectar |
| `/settings/integrations/slack` | `.../slack/page.tsx` | OAuth2: configurar app, iniciar flujo, crear canal, mensaje de prueba |
| `/settings/integrations/samu` | `.../samu/page.tsx` | API key: ingresar, testear |
| `/settings/integrations/tavily` | `.../tavily/page.tsx` | API key: ingresar, testear |
| `/settings/integrations/google-cse` | `.../google-cse/page.tsx` | API key + Search Engine ID: ingresar, testear |
| `/settings/source-catalog/[sourceKey]` | `.../[sourceKey]/page.tsx` | Panel de credencial + test de conexión por fuente |
| `/settings/prospecting` | Configuración de Apollo y Lusha |

---

### 3. Server actions y APIs para guardar credenciales

**Módulo principal:** `src/modules/integrations/actions.ts` (1662 líneas)

Patrón uniforme para cada integración:
- `connect{Provider}(apiKey)` — Valida admin, guarda en Vault, actualiza `external_integration_connections`, registra audit
- `update{Provider}Credential(newKey)` — Idem con reemplazo
- `test{Provider}ConnectionAction()` — Llama al endpoint del proveedor, persiste metadata no sensible
- `disconnect{Provider}()` — Elimina de Vault, actualiza estado
- `get{Provider}Integration()` — Retorna estado + metadata enmascarada (nunca el secreto)

**Módulo fuentes:** `src/modules/source-catalog/source-credential-actions.ts`
- `configureSourceCredential(sourceKey, credentialValue)` — Guarda en Vault por fuente
- `testSourceCredentialConnection(sourceKey)` — Testea conexión
- `resolveSourceCredential(sourceKey)` — Recupera de Vault (server-side)

**API routes OAuth:**
- `/api/integrations/slack/oauth/start` y `/callback` — Flujo OAuth2 completo con CSRF cookie
- `/api/integrations/google-drive/oauth/start` y `/callback` — Idem para Google Drive

---

### 4. Cómo se protege el secreto

| Aspecto | Estado | Detalle |
|---------|--------|---------|
| Almacenamiento | ✅ Vault AES-256 | Nunca en tablas planas ni en código |
| Acceso server-side | ✅ Solo con `SUPABASE_SERVICE_ROLE_KEY` | Via RPC `SECURITY DEFINER` |
| RLS | ✅ Admin-only | Todas las tablas de integración tienen políticas solo-admin |
| Variables de entorno `NEXT_PUBLIC_` | ✅ Ningún secreto expuesto | Solo `SUPABASE_URL` y `PUBLISHABLE_KEY` (seguros) |
| Respuestas al frontend | ✅ Solo `{ success, message, error }` | Nunca incluyen el valor del secreto |
| Fallback a `.env` | ✅ Solo en no-producción | En producción, Vault es obligatorio |
| Audit trail | ✅ Completo | Cada operación de credencial queda en `integration_audit` |
| Datos en localStorage/sessionStorage | ✅ No hay | El token se limpia del estado React después del submit |

---

### 5. Patrón actual para proveedores de API key (Tavily, Samu, Google CSE)

```
1. Admin ingresa API key en formulario (componente cliente)
2. Cliente llama server action: connectProvider(apiKey)
3. Server action:
   a. Valida admin via getAdminInternalUserId()
   b. Guarda en Vault: upsert_vault_secret('sellup_integration_{provider}_api_key', apiKey)
   c. Actualiza external_integration_connections:
      credentials_status = 'stored', vault_secret_id = uuid
   d. Registra evento en integration_audit
   e. Retorna { success: true, message: '...' }
4. Cliente muestra feedback y refresca la página
5. Para uso en agentes/servidor:
   a. get_vault_secret_decrypted('sellup_integration_{provider}_api_key')
   b. Pasa valor solo dentro de contexto server
   c. Nunca se expone al frontend
```

**Servicios de referencia:**
- `src/server/services/tavily-connection.ts` (245 líneas) — patrón más limpio
- `src/server/services/samu-connection.ts` (182 líneas)
- `src/server/services/google-cse-connection.ts` (297 líneas)

---

### 6. Patrón recomendado para Migo API

Migo es un `enrichment_provider` con autenticación Bearer token (equivalente a API key).
**Debe usar exactamente el mismo patrón que Tavily/Samu:**

| Elemento | Valor para Migo |
|----------|----------------|
| Vault secret name | `sellup_integration_migo_api_key` |
| Tabla catálogo | `external_integrations` — agregar entrada `integration_key = 'migo'` |
| Tabla conexión | `external_integration_connections` — auth_type = `'api_key'` |
| Audit event type | `migo_api_key_stored` (requiere extender CHECK constraint) |
| Servicio server | `src/server/services/migo-connection.ts` (nuevo, siguiendo patrón tavily) |
| Server action | Agregar a `src/modules/integrations/actions.ts` |
| UI page | `/settings/integrations/migo` (nueva, siguiendo patrón tavily) |
| Uso en enrichment | `get_vault_secret_decrypted('sellup_integration_migo_api_key')` server-side |

**Naming convention Vault:** `sellup_integration_{integration_key}_{credential_type}`
Ejemplo: `sellup_integration_migo_api_key`

---

### 7. ¿Puede Perú.3N usar `.env.local` temporalmente?

**Sí, para el spike local solamente.**

El patrón del sistema tiene fallback a variables de entorno en no-producción:
```typescript
// Patrón existente (ai-credentials.ts, source-connection-resolver.ts)
// 1. Intenta Vault
// 2. Si no existe y NODE_ENV !== 'production', cae a process.env.MIGO_API_KEY
```

Para el spike técnico de Perú.3N:
- Configurar `MIGO_API_KEY` solo en `.env.local` (nunca commitear)
- El spike corre en entorno local, no en producción
- Resultado esperado: validar payload y batch endpoint
- Después del spike → integrar via UI de Configuración e Integraciones como integración configurable

**Condición:** El `.env.local` es solo para el spike. La integración productiva debe usar Vault + UI.

---

### 8. Riesgos detectados

| Riesgo | Severidad | Detalle |
|--------|-----------|---------|
| Deuda técnica en audit events de fuentes | Baja | `source_catalog_connections` tiene eventos de auditoría que aún no están en el CHECK constraint de `integration_audit`. Ya documentado como DEBT en el código. |
| Rotación automática de credenciales | Media | No hay rotación automatizada para tokens de larga vida (Slack bot token, HubSpot Private App token). La renovación es manual. |
| Expiración de credenciales | Baja | No hay campo `expires_at` en las tablas de conexión. |
| `SLACK_CLIENT_SECRET` en env + Vault | Baja | El client secret de Slack puede venir tanto de env como de Vault. Duplicación potencial. |
| Debug routes en producción | Baja-Media | Existen `/api/debug/ai-provider-health` y `/api/debug/ai-fallback-diagnosis`. Verificar que estén protegidas o desactivadas en producción. |

---

### 9. Recomendación final

**Migo debe integrarse como integración configurable via UI de Configuración e Integraciones, reutilizando el patrón Tavily/Samu.**

No requiere construir infraestructura nueva. Requiere:

1. **Migración DB** (nueva): agregar fila `migo` en `external_integrations`, agregar evento en `integration_audit` CHECK constraint.
2. **Servicio** (nuevo): `src/server/services/migo-connection.ts` siguiendo patrón de `tavily-connection.ts`.
3. **Server actions** (nuevo): sección Migo en `src/modules/integrations/actions.ts`.
4. **UI page** (nueva): `/settings/integrations/migo` siguiendo patrón de Tavily.
5. **Uso en enrichment**: resolver credencial via `get_vault_secret_decrypted()` en el worker de Perú.3N.

**Orden correcto:**
```
Perú.3N (spike local con .env.local)
  → confirmar payload y batch endpoint
  → revisar ToS Migo
  → si spike pasa:
      Integraciones.2 — Agregar Migo como integración configurable
        (migración + servicio + UI)
      Perú.3O — Enrichment CIIU usando Migo via Vault
```

---

### Confirmaciones de seguridad operativa (Integraciones.1)

| Confirmación | Estado |
|---|---|
| Solo lectura del repo — sin modificar código | ✅ |
| No se solicitó ni imprimió ninguna API key real | ✅ |
| No se guardó ninguna key durante el hito | ✅ |
| No se usó `.env.local` | ✅ |
| No se escribieron secretos en logs | ✅ |
| No se escribieron secretos en commits | ✅ |
| No se expusieron secretos al frontend | ✅ |
| No se realizaron llamadas reales a Migo | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos ni batches | ✅ |
| No se tocó source-discovery-preflight | ✅ |
| No se tocó SOURCE_DISCOVERY_REGISTRY | ✅ |
| No se tocó wizard | ✅ |
| No se hizo force push | ✅ |

### Archivos revisados (solo lectura)

- `supabase/migrations/011` a `047` — tablas y Vault RPCs
- `src/modules/integrations/actions.ts`
- `src/modules/source-catalog/source-credential-actions.ts`
- `src/server/services/tavily-connection.ts`, `samu-connection.ts`, `hubspot-connection.ts`, `slack-connection.ts`, `google-cse-connection.ts`, `apollo-connection.ts`, `lusha-connection.ts`, `google-drive-connection.ts`, `ai-credentials.ts`, `ai-connection.ts`
- `src/server/source-catalog/source-connection-resolver.ts`
- `src/app/(sellup)/settings/integrations/**`
- `src/app/api/integrations/**`
- `docs/PERU_MIGO_API_CIIU_EVALUATION.md`

### Archivos modificados en Integraciones.1

| Archivo | Cambio |
|---|---|
| `AUDITORIA-FUENTES-IA.md` | Agregada esta sección de auditoría |
| `docs/PERU_MIGO_API_CIIU_EVALUATION.md` | Agregada §12: Nota de integración de credenciales |

### Próximo hito recomendado

**Perú.3N — Spike real con trial key Migo API** (`.env.local` temporal permitido para spike local)
Luego: **Integraciones.2** — Agregar Migo como integración configurable en Configuración e Integraciones (migración + servicio + UI, reutilizando patrón Tavily).

---

## Hito cerrado — Perú.3N-R: Spike real Migo API — validación CIIU

**Fecha:** 2026-06-25
**Tipo:** Spike real con credencial Vault
**Resultado:** `MIGO_NOT_USEFUL_FOR_CIIU`

### Hallazgos del spike real

| Campo | Resultado |
|-------|-----------|
| attemptedRequests | 10 |
| successfulResponses | 10 |
| failedResponses | 0 |
| containsRuc | true |
| containsLegalName | true |
| containsCiiu | **false** |
| containsCiiuRev3 | **false** |
| containsCiiuRev4 | **false** |
| containsActivityDescription | **false** |
| containsSecondaryActivities | **false** |
| containsLegalRepresentatives | **false** |
| containsTaxpayerStatus | true |
| containsDomicileCondition | true |
| containsAddress | true |

### Payload real confirmado

`ruc`, `nombre_o_razon_social`, `estado_del_contribuyente`, `condicion_de_domicilio`, `ubigeo`, `direccion`, `actualizado_en`

### Verdict

```
MIGO_NOT_USEFUL_FOR_CIIU
```

Migo NO devuelve CIIU, actividad económica, actividades secundarias ni representantes legales en el endpoint validado. No sirve como fuente de enriquecimiento sectorial.

---

## Hito cerrado — Perú.3N-S: Reclasificar Migo API después de validación real negativa de CIIU

**Fecha:** 2026-06-25
**HEAD inicial:** `c500b08`
**Tipo:** Corrección de catálogo y documentación — sin código productivo nuevo, sin Supabase runtime, sin candidatos

### Cambios realizados

| Archivo | Cambio |
|---|---|
| `src/server/agents/prospecting-toolkit/source-catalog.ts` | `name` → `'Migo API Perú RUC Lookup'`; `sellupUse` → `'validation_only'`; `priority` → `'P2'`; `recommendedUse` y `limitations` actualizados con resultado real spike |
| `src/server/services/migo-connection.ts` | `p_description` de Vault: removido "CIIU" — ahora refleja que es validación RUC |
| `docs/PERU_MIGO_API_CIIU_EVALUATION.md` | §13 agregado — resultado spike real + reclasificación |
| `docs/PERU_SOURCE_CONNECTABILITY_RESEARCH.md` | §2.2 actualizado — verdict real `MIGO_NOT_USEFUL_FOR_CIIU` |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | Lectura general y fila Migo actualizadas — sin CIIU, P2 |
| `AUDITORIA-FUENTES-IA.md` | Tabla Perú.3K corregida; estrategia híbrida actualizada; secciones Perú.3N-R y Perú.3N-S agregadas |

### Estado final de Migo

| Atributo | Antes | Después |
|----------|-------|---------|
| Nombre catálogo | Migo API Perú | Migo API Perú RUC Lookup |
| sellupUse | enrichment | validation_only |
| priority | P1 | P2 |
| CIIU claim | Sí — única fuente CIIU operable | No — no devuelve CIIU |
| Uso | Enriquecimiento CIIU por RUC | Validación RUC puntual bajo demanda |

### Confirmaciones de seguridad operativa (Perú.3N-S)

| Confirmación | Estado |
|---|---|
| Migo no queda presentado como fuente CIIU | ✅ |
| Migo clasificado como validation_only / P2 | ✅ |
| No se activó Perú discovery | ✅ |
| No se tocó registry/preflight/wizard | ✅ |
| No se llamó Migo | ✅ |
| No se escribió Supabase en runtime | ✅ |
| No se crearon candidatos ni batches | ✅ |
| No se expuso API key | ✅ |
| No se hizo force push | ✅ |

---

## Hito cerrado — Perú.3O: Gate de decisión — Estrategia MVP Perú sin fuente CIIU confiable

**Fecha:** 2026-06-25
**HEAD inicial:** `bb7fc02` — fix(source-catalog): reclassify Migo Peru as RUC lookup source
**Tipo:** Gate de decisión — solo documentación. Sin código productivo, sin Supabase, sin candidatos, sin llamadas de API.
**Depende de:** Perú.3N-S (Migo reclasificado como `validation_only / P2`)

### Contexto

Después de los hitos Perú.3K → Perú.3L-2A → Perú.3M → Perú.3N-R → Perú.3N-S, el estado de fuentes CIIU para Perú quedó como:

| Fuente | CIIU | Estado | Verdict |
|--------|------|--------|---------|
| SUNAT Padrón Reducido RUC | ❌ | ✅ Operable | BASE_LEGAL_NO_CIIU |
| PRODUCE MiPyme por Sector | ✅ | ❌ WAF 403 | `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL` |
| Migo API | ❌ (spike real) | ✅ Operable | `MIGO_NOT_USEFUL_FOR_CIIU` |
| ApiDni.com | ✅ (docs, no spike) | ⚠️ Pendiente | `PRIVATE_PROVIDER_PENDING_SPIKE` |

**Conclusión:** No existe fuente oficial ni privada confirmada para CIIU masivo en Perú.

### Decisión formal

```
Perú MVP Source Strategy
─────────────────────────────────────────────────────────────────
Official legal validation:  SUNAT Padrón Reducido RUC
Official sector / CIIU:     unavailable for MVP
Private CIIU provider:      not confirmed — Migo rejected for CIIU
Sector source:              inferred from web / AI / semantic search
Confidence label:           sector_inferred  (NOT official_ciiu)
Human review required:      before candidate conversion
─────────────────────────────────────────────────────────────────
```

### Respuestas a las 10 preguntas del gate

| # | Pregunta | Respuesta |
|---|---------|-----------|
| 1 | ¿Podemos avanzar sin CIIU? | **Sí** — SUNAT da identidad + estado. Sector se infiere. |
| 2 | ¿Qué pierde SellUp? | Filtro sectorial preciso; segmentación auditable con fuente citable |
| 3 | ¿Qué cubre inferencia web/IA? | Sector orientativo (~70–80% correcto por razón social + web) |
| 4 | ¿Qué va con label "inferido"? | Todo sector derivado de razón social / web / IA → `sector_inferred` |
| 5 | ¿SUNAT es suficiente como validador? | Sí — RUC, razón social, estado, condición, ubigeo parcial |
| 6 | ¿Migo aporta sobre SUNAT? | Marginal (tiempo real). Queda `validation_only / P2`. No activar masivo. |
| 7 | ¿Qué campos son confiables? | ruc, nombre_o_razon_social, estado, condición, ubigeo (parcial) |
| 8 | ¿Qué campos no disponibles? | ciiu_codigo, ciiu_descripcion, sector_oficial, representantes_legales |
| 9 | ¿Qué ve el usuario cuando no hay CIIU? | Badge "Sector: Tecnología · inferido" + advertencia de verificación |
| 10 | ¿Siguiente paso técnico? | Activar discovery Perú con sector inferido (Perú.4) + evaluar ApiDni.com |

### Archivos modificados en Perú.3O

| Archivo | Cambio |
|---------|--------|
| `docs/PERU_MVP_SOURCE_STRATEGY.md` | **Creado** — gate de decisión completo (10 preguntas + campos + UI + próximos pasos) |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | **Actualizado** — nota Perú.3O en lectura general sección Perú §10 |
| `AUDITORIA-FUENTES-IA.md` | **Actualizado** — esta sección |

### Confirmaciones de seguridad operativa (Perú.3O)

| Confirmación | Estado |
|---|---|
| No se activó Perú discovery | ✅ |
| No se tocó `SOURCE_DISCOVERY_REGISTRY` | ✅ |
| No se tocó `source-discovery-preflight` | ✅ |
| No se tocó el wizard | ✅ |
| No se llamó Migo | ✅ |
| No se llamó SUNAT | ✅ |
| No se llamó Tavily | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos | ✅ |
| No se tocó INAPI | ✅ |
| No se tocó Chile / México / Colombia | ✅ |
| No se hizo force push | ✅ |
| No se creó código productivo | ✅ |
| Solo documentación creada/actualizada | ✅ |

### Próximo hito recomendado

**Perú.4 — Activar discovery Perú con sector inferido**
Conectar `pe_sunat_bulk` en registry + preflight. Implementar inferencia sectorial con `confidence_label: sector_inferred`. Agregar badge "inferido" en UI. No usar sector como criterio duro de filtro en Perú.

---

## Hito cerrado — Perú.4A: Diseño técnico de activación segura de Perú MVP con sector inferido

**Fecha:** 2026-06-25
**HEAD inicial:** `dd2aa69` — docs(source-catalog): define Peru MVP strategy without CIIU
**Tipo:** Diseño técnico — solo documentación. Sin modificaciones a registry/preflight/wizard.

### Decisión técnica

```
Discovery Perú:
  Discovery source (generación de candidatos):    web/IA (Tavily)
  Legal validation (post-discovery):              SUNAT snapshot en Supabase
  Sector source:                                  inferred_web_ai
  Confidence label:                               sector_inferred
  CIIU status:                                    unavailable_for_mvp
  Human review required:                          true
```

### Respuestas clave

| # | Pregunta | Respuesta |
|---|---------|-----------|
| 1 | ¿Qué va en SOURCE_DISCOVERY_REGISTRY? | Nuevo adapter `pe_web_inferred` (web search + inferencia). NO `pe_sunat_bulk`. |
| 2 | ¿pe_sunat_bulk al registry? | No. Solo como snapshot offline en Supabase. |
| 3 | ¿Qué entra en preflight? | `PE: 'pe_web_inferred'` en COUNTRY_SOURCE_MAP |
| 4 | ¿Cómo evitar SUNAT ZIP en Vercel? | pe_web_inferred no importa sunat-peru connector |
| 5 | ¿Cómo etiquetar sector inferido? | Metadata: sector_source='inferred_web_ai', confidence_label='sector_inferred' |
| 6 | ¿Campos nuevos? | sector_inferred, sector_confidence_score, sector_source, confidence_label, legal_validation.* |
| 7 | ¿Dónde guardarlos? | En `prospect_candidates.metadata` (Opción A — recomendada MVP) |
| 8 | ¿Qué ve el usuario? | Badge "Tecnología · inferido" con tooltip y confianza |
| 9 | ¿Qué impide conversión débil? | Guardrails: confianza < 0.3 → block; sin sector → block; sin validación legal → block |
| 10 | ¿Pruebas mínimas? | 8 tests: adapter, inferencia, etiquetado, validación SUNAT, guardrails, preflight, registry, no-SUNAT-ZIP |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `docs/PERU_MVP_ACTIVATION_PLAN.md` | **Creado** — plan técnico completo (11 secciones) |
| `AUDITORIA-FUENTES-IA.md` | **Actualizado** — esta sección Perú.4A |

### Archivos NO modificados

- `source-catalog.ts` — intacto
- `connector-registry.ts` — intacto
- `source-discovery-preflight.ts` — intacto
- `structured-candidate-types.ts` — intacto
- `structured-source-candidate-writer.ts` — intacto
- `candidate-writer.ts` — intacto
- `wizard` — intacto
- Colombia, México, Chile, INAPI — intactos

### Confirmaciones de seguridad operativa

| Confirmación | Estado |
|---|---|
| No se activó Perú en registry | ✅ |
| No se modificó código productivo | ✅ |
| No se llamó Tavily | ✅ |
| No se llamó Migo | ✅ |
| No se llamó SUNAT | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos | ✅ |
| Solo documentación creada/actualizada | ✅ |

### Próximo hito

**Perú.4B** — Implementar adapter `pe_web_inferred`, registry, preflight, guardrails y tests. Ver plan detallado en `docs/PERU_MVP_ACTIVATION_PLAN.md` §9.
