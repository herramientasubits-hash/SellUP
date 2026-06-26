# Perú.4A — Diseño técnico de activación segura de Perú MVP con sector inferido

**Hito:** Perú.4A
**Fecha:** 2026-06-25
**HEAD inicial:** `dd2aa69` — docs(source-catalog): define Peru MVP strategy without CIIU
**Tipo:** Diseño técnico — solo documentación. Sin modificaciones a registry/preflight/wizard.

> ⚠ **SUPERSEDED by Perú.4D** — La implementación de Perú.4B (`pe_web_inferred`) ha
> sido revertida. Perú usa Agente 1 / Tavily / web IA directamente, sin adapter
> discovery intermedio. Ver `AUDITORIA-FUENTES-IA.md` §Perú.4D.

---

## 1. Decisión técnica propuesta

```
Discovery Perú:
  ┌─────────────────────────────────────────────────────────────────────┐
  │ Discovery source (generación de candidatos):            web/IA      │
  │   - Web search (Tavily o similar) sobre razón social + RUC        │
  │   - Inferencia sectorial con IA sobre resultados web              │
  │   - NO usar SUNAT ZIP como discovery directo                     │
  │                                                                   │
  │ Legal validation (post-discovery):                     SUNAT bulk  │
  │   - Snapshot pre-cargado en Supabase (offline/server-side)        │
  │   - Validación de RUC, razón social, estado, condición, ubigeo    │
  │   - NO descargar/descomprimir ZIP en Vercel                       │
  │                                                                   │
  │ Sector source:                              inferred_web_ai        │
  │ Confidence label:                           sector_inferred        │
  │ CIIU status:                                unavailable_for_mvp    │
  │ Human review required:                      true                   │
  └─────────────────────────────────────────────────────────────────────┘
```

### Fuentes y responsabilidades

| Fuente | Rol | Responsabilidad | Ejecuta en |
|--------|-----|-----------------|------------|
| **Web/IA (Tavily)** | Discovery + inferencia sectorial | Generar candidatos + sector_inferred | Vercel (runtime) |
| **SUNAT Padrón Reducido** | Validación legal | Confirmar RUC, estado, condición, ubigeo | Supabase (snapshot pre-cargado) |
| **pe_sunat_bulk connector** | Ingesta del ZIP | Descargar ZIP → parsear → cargar en Supabase | Worker local/offline |
| **pe_migo_api** (opcional) | Validación RUC puntual | Estado en tiempo real (no CIIU) | Bajo demanda, no masivo |
| **Human reviewer** | Revisión final | Validar sector inferido antes de conversión | UI |

---

## 2. Respuestas técnicas

### 2.1 ¿Qué debe ir en `SOURCE_DISCOVERY_REGISTRY` para Perú?

Ningún adapter que descargue/descomprima SUNAT. El registry debe obtener un nuevo adapter **`pe_web_inferred`** que:

1. No toca SUNAT ZIP.
2. No requiere descargas masivas.
3. Opera con web search (Tavily) + inferencia IA.
4. Acepta criterios de búsqueda (país, industria, keywords).
5. Retorna `SourceDiscoveryCandidate[]` con `sectorSource='inferred_web_ai'` y `confidenceLabel='sector_inferred'`.

El adapter `pe_web_inferred` no es un conector tradicional (no consume un API externa de registro). Es un adaptador que orquesta:
- Web search (multi-query para Perú)
- Normalización de resultados
- Inferencia sectorial (basada en razón social, dominio, snippet)
- Marcado del sector como inferido

```typescript
// Propuesta de entrada en SOURCE_DISCOVERY_REGISTRY
pe_web_inferred: peWebInferredDiscoveryAdapter,
```

### 2.2 ¿Debe entrar `pe_sunat_bulk` al registry?

**No directamente.** `pe_sunat_bulk` NO debe entrar como adapter de discovery en `SOURCE_DISCOVERY_REGISTRY` porque su operación requeriría descargar, descomprimir y parsear el ZIP de SUNAT en runtime Vercel, lo cual está prohibido.

En su lugar:

- `pe_sunat_bulk` se usa **offline** para cargar un snapshot de empresas peruanas en Supabase.
- El discovery primario lo hace **web/IA**.
- La validación legal (match contra SUNAT) se hace **post-discovery** consultando el snapshot en Supabase.

### 2.3 ¿Qué debe entrar en `source-discovery-preflight` para PE?

Agregar `PE` al `COUNTRY_SOURCE_MAP`:

```typescript
const COUNTRY_SOURCE_MAP: Record<string, string> = {
  CO: 'co_rues',
  MX: 'mx_denue',
  CL: 'cl_res',
  PE: 'pe_web_inferred',  // NUEVO
};
```

### 2.4 ¿Cómo se evita que SUNAT intente procesar el ZIP grande en Vercel?

Arquitectura Vercel-safe ya documentada:

```
┌────────────────────────────────────────────────────────────────────┐
│ VERCEL (Serverless / Runtime wizard)                               │
│ ✅ Mostrar resultados ya procesados desde Supabase                 │
│ ✅ Consultar snapshot de empresas PE normalizadas                 │
│ ✅ Web search + inferencia IA (Tavily, sin ZIP)                   │
│ ❌ NO descargar padron_reducido_ruc.zip                            │
│ ❌ NO descomprimir 1.55 GB                                         │
│ ❌ NO parsear millones de filas                                    │
│                                                                    │
│ WORKER / LOCAL                                                     │
│ ✅ Descargar ZIP completo (cuando se autorice)                     │
│ ✅ Descomprimir localmente                                         │
│ ✅ Filtrar RUC 20 (empresas)                                       │
│ ✅ Normalizar y cargar snapshot en Supabase                        │
└────────────────────────────────────────────────────────────────────┘
```

El adapter `pe_web_inferred` **no debe importar ni llamar** ningún módulo de `sunat-peru/` connector. Debe ser independiente.

### 2.5 ¿Cómo se etiqueta sector como inferido?

Mediante metadata del candidato:

```typescript
type SectorInferenceMetadata = {
  sector_inferred: string;               // "Tecnología", "Salud", etc.
  sector_confidence_score: number;       // 0.0 - 1.0
  sector_source: 'inferred_web_ai';      // Siempre este valor para Perú MVP
  confidence_label: 'sector_inferred';   // Label canónico
  ciiu_status: 'unavailable_for_mvp';    // Siempre este valor
  inference_method:                      // Cómo se infirió
    | 'keyword_razon_social'
    | 'web_search'
    | 'domain_analysis'
    | 'combined';
  inference_evidence: string[];          // Evidencia textual usada
};
```

### 2.6 ¿Qué campos nuevos o metadata se necesitan?

Campos propuestos para `prospect_candidates` o su metadata:

| Campo | Tipo | Origen | Requerido |
|-------|------|--------|-----------|
| `sector_inferred` | `text` | Inferencia web/IA | Sí |
| `sector_confidence_score` | `float8` | Score 0.0-1.0 | Sí |
| `sector_source` | `text` | Siempre `'inferred_web_ai'` | Sí |
| `confidence_label` | `text` | Siempre `'sector_inferred'` | Sí |
| `legal_validation_source` | `text` | `'pe_sunat_bulk'` | Sí |
| `legal_validation_status` | `text` | `'verified'|'not_found'|'pending'` | Sí |

### 2.7 ¿Dónde se debe guardar cada campo?

```typescript
// Opción A — Metadata del candidato (recomendada para MVP)
prospect_candidates.metadata = {
  sector_inferred: "Tecnología",
  sector_confidence_score: 0.85,
  sector_source: "inferred_web_ai",
  confidence_label: "sector_inferred",
  ciiu_status: "unavailable_for_mvp",
  legal_validation: {
    source: "pe_sunat_bulk",
    status: "verified",
    ruc: "20512345678",
    legal_name: "SISTEMAS Y TECNOLOGÍA S.A.C.",
    taxpayer_status: "ACTIVO",
    domicile_condition: "HABIDO",
    ubigeo: { departamento: "LIMA", provincia: "LIMA", distrito: "MIRAFLORES" },
  },
};

// Opción B — Columnas propias en prospect_candidates (post-MVP)
// sector_inferred, sector_confidence_score, sector_source, confidence_label,
// legal_validation_source, legal_validation_status
```

**Recomendación:** Usar metadata para MVP (Opción A). Si la inferencia sectorial se consolida, migrar a columnas propias.

### 2.8 ¿Qué debe ver el usuario en revisión humana?

```
┌──────────────────────────────────────────────────────────────────┐
│ CANDIDATO: SISTEMAS Y TECNOLOGÍA S.A.C.                         │
│ ─────────────────────────────────────                            │
│ RUC: 20512345678       [Verificado contra SUNAT ✓]              │
│ Estado: ACTIVO · HABIDO                                         │
│ Ubigeo: Lima, Lima, Miraflores                                  │
│                                                                  │
│ ┌─ Sector ─────────────────────────────────────────────────────┐ │
│ │ Tecnología  ⚠  inferido (confianza: 85%)                    │ │
│ │ Fuente: inferencia web/IA sobre razón social + búsqueda web │ │
│ │ [i] No existe CIIU oficial para Perú en esta versión.       │ │
│ │     Verificar antes de usar como criterio de ICP.           │ │
│ │ Evidencia: "SISTEMAS" en razón social + sitio web            │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ [Aprobar] [Rechazar] [Solicitar más info]                       │
│                                                                  │
│ ⚠ Este candidato NO puede convertirse automáticamente          │
│   porque el sector es inferido. Requiere revisión humana.       │
└──────────────────────────────────────────────────────────────────┘
```

### 2.9 ¿Qué debe impedir la conversión si la evidencia es débil?

Guardrails que deben implementarse en el candidate-writer o en el approval flow:

| Condición | Acción |
|-----------|--------|
| `sector_confidence_score < 0.3` | Bloquear conversión. Marcar `review_flags: ['sector_confidence_too_low']` |
| `sector_inferred` es null | Bloquear conversión. Marcar `review_flags: ['sector_unknown']` |
| `legal_validation_status != 'verified'` | Bloquear conversión. No aprobar sin match SUNAT |
| `confidence_label != 'sector_inferred'` (cuando debería serlo) | Bloquear conversión. Error de pipeline |
| `human_review_required === true` | Requiere aprobación manual explícita |

En el `candidate-writer.ts` o `structured-source-candidate-writer.ts`:
```typescript
if (metadata.confidence_label === 'sector_inferred' && metadata.sector_confidence_score < 0.3) {
  // No permitir auto-approval, forzar revisión humana
  reviewFlags.push('sector_confidence_too_low');
  commercialFitStatus = 'needs_manual_review';
}
```

### 2.10 ¿Qué pruebas mínimas deben existir antes de activar Perú?

| # | Prueba | Archivo sugerido |
|---|--------|-----------------|
| 1 | Web search para Perú devuelve resultados parseables | `__tests__/pe-web-inferred-adapter.test.ts` |
| 2 | Inferencia sectorial desde razón social funciona | `__tests__/pe-sector-inference.test.ts` |
| 3 | Etiquetado `sector_inferred` es correcto | `__tests__/pe-sector-labeling.test.ts` |
| 4 | SUNAT snapshot validation (RUC match) funciona | `__tests__/pe-sunat-validation.test.ts` |
| 5 | Guardrails bloquean candidatos con confianza baja | `__tests__/pe-guardrails.test.ts` |
| 6 | Preflight para PE devuelve sourceKey correcto | `__tests__/pe-preflight.test.ts` |
| 7 | Registry rechaza sourceKey inválido para PE | `__tests__/pe-registry.test.ts` |
| 8 | No hay llamadas a SUNAT ZIP durante discovery | `__tests__/pe-no-sunat-zip.test.ts` |

---

## 3. Flujo propuesto

```
USUARIO: Inicia discovery para Perú (país=PE, industria=Tecnología)
  │
  ▼
[1] source-discovery-preflight
  │   → COUNTRY_SOURCE_MAP['PE'] = 'pe_web_inferred'
  │   → Verifica que el adapter existe en SOURCE_DISCOVERY_REGISTRY
  │   → Ejecuta dry-run (5 candidatos de muestra)
  │   → Retorna resumen: calidad, cobertura, warnings
  │
  ▼
[2] Web search + inferencia (offline/batch)
  │   → Tavily busca: "empresas de tecnología Perú", "software companies Peru"
  │   → Por cada resultado:
  │       a. Extraer nombre, dominio, snippet
  │       b. Inferir sector desde razón social + snippet
  │       c. Calcular sector_confidence_score
  │       d. Etiquetar: sector_source='inferred_web_ai', confidence_label='sector_inferred'
  │   → Retorna SourceDiscoveryCandidate[]
  │
  ▼
[3] Normalización y deduplicación
  │   → Normalizar nombre, extraer dominio
  │   → Detectar duplicados intra-batch y contra SellUp
  │
  ▼
[4] Validación legal SUNAT (post-discovery)
  │   → Consultar snapshot SUNAT en Supabase por RUC (si se encontró)
  │   → Si hay RUC: verificar ACTIVO + HABIDO
  │   → Si no hay RUC: marcar legal_validation_status='not_found', human_review_required=true
  │   → Si hay match: legal_validation_status='verified'
  │
  ▼
[5] Candidate Writer
  │   → Escribir candidato con metadata completa
  │   → review_flags: ['sector_inferred', 'human_review_required']
  │   → review_status: 'needs_manual_review'
  │   → commercial_fit_status: 'needs_manual_review'
  │
  ▼
[6] Revisión humana
  │   → UI muestra badge "inferido" + confianza + fuente
  │   → Humano verifica sector
  │   → Humano aprueba o rechaza
  │
  ▼
[7] Conversión (solo si humano aprobó)
      → HubSpot sync
```

---

## 4. Metadata requerida en candidatos

```typescript
type PeruCandidateMetadata = {
  // Identidad legal
  tax_id: string | null;                    // RUC 11 dígitos
  legal_name: string | null;                // Razón social exacta SUNAT
  taxpayer_status: string | null;           // ACTIVO, BAJA PROVISIONAL, etc.
  domicile_condition: string | null;        // HABIDO, NO HABIDO, etc.
  ubigeo_departamento: string | null;
  ubigeo_provincia: string | null;
  ubigeo_distrito: string | null;

  // Sector (inferido)
  sector_inferred: string | null;
  sector_confidence_score: number | null;   // 0.0 - 1.0
  sector_source: 'inferred_web_ai';
  confidence_label: 'sector_inferred';
  ciiu_status: 'unavailable_for_mvp';
  inference_method: 'keyword_razon_social' | 'web_search' | 'domain_analysis' | 'combined';
  inference_evidence: string[];

  // Legal validation
  legal_validation: {
    source: 'pe_sunat_bulk';
    status: 'verified' | 'not_found' | 'pending' | 'error';
    validated_at: string;                   // ISO timestamp
    ruc_match: boolean;
    name_match: boolean;
  };

  // Flags
  human_review_required: boolean;
  review_flags: string[];
};
```

---

## 5. Estados/reasons esperados

### Estados de discovery

| Estado | Descripción |
|--------|-------------|
| `discovery_completed` | Web search ejecutado, candidatos generados |
| `legal_validation_passed` | RUC match contra SUNAT snapshot, ACTIVO + HABIDO |
| `legal_validation_failed` | RUC no encontrado o empresa no activa/no habida |
| `sector_inferred` | Sector inferido con confidence ≥ threshold |
| `sector_low_confidence` | Sector inferido con confidence < threshold |
| `human_review_required` | Requiere revisión humana antes de conversión |

### Reasons de bloqueo

| Reason | Significado |
|--------|-------------|
| `pe_ruc_not_found` | RUC no existe en SUNAT snapshot |
| `pe_not_active` | RUC existe pero estado ≠ ACTIVO |
| `pe_not_habido` | RUC existe pero condición ≠ HABIDO |
| `pe_sector_confidence_too_low` | Sector inferido con confianza insuficiente |
| `pe_sector_not_inferred` | No se pudo inferir sector alguno |

---

## 6. UI labels recomendados

| Contexto | Label |
|----------|-------|
| Sector badge | `Tecnología · inferido` (con ícono ⚠) |
| Sector tooltip | `Sector estimado mediante inferencia web/IA. No existe CIIU oficial para Perú en esta versión.` |
| Confianza | `Confianza: 85%` (barra de progreso o badge) |
| Legal validation | `RUC verificado contra SUNAT ✓` o `RUC no encontrado en SUNAT ⚠` |
| Status banner | `Este candidato requiere revisión humana porque el sector es inferido.` |
| Filtro sector Perú | `⚠ El sector de empresas peruanas es inferido, no oficial. Los resultados son orientativos.` |
| Preflight warning | `Perú: el sector se infiere de búsqueda web/IA. No hay CIIU oficial disponible.` |

---

## 7. Guardrails

| # | Guardrail | Implementación |
|---|-----------|----------------|
| 1 | No ejecutar SUNAT ZIP en Vercel | `pe_web_inferred` adapter no importa `sunat-peru/` connector |
| 2 | No auto-aprobar sector inferido | `human_review_required = true` en todo candidato Perú |
| 3 | No convertir con confianza baja | Bloquear si `sector_confidence_score < 0.3` |
| 4 | No crear candidato sin web search | Validar que `sourcePrimary` no sea sunat |
| 5 | No inferir sector sin evidencia | `sector_inferred` debe tener `inference_evidence` no vacío |
| 6 | No llamar Tavily sin control de costos | Limitar queries/día para Perú; usar `tavily-usage-logging` |
| 7 | No escribir tax_identifier sin validación | Solo escribir RUC si `legal_validation_status === 'verified'` |

---

## 8. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Inferencia sectorial incorrecta (falso positivo) | Alta (20-30%) | Medio | Human review + confidence threshold |
| Web search (Tavily) no encuentra empresas peruanas | Media | Alto | Multi-query + query planner para Perú |
| SUNAT snapshot desactualizado | Baja | Medio | Fecha de corte visible en UI; refresh periódico |
| Costos Tavily para Perú no presupuestados | Media | Medio | Rate limiting + logging por query |
| RUC no resuelto por falta de match (empresa sin presencia web) | Alta | Bajo | Empresa igual se crea sin RUC, requiere revisión humana |

---

## 9. Plan de implementación exacto — Perú.4B

### Bloque A — Adapter `pe_web_inferred` (nuevo)

| # | Tarea | Archivo | Depende de |
|---|-------|---------|------------|
| A1 | Crear tipos `SectorInferenceMetadata`, `PeWebInferredCandidate` en tipos | `src/server/agents/prospecting-toolkit/types.ts` | — |
| A2 | Crear adapter `pe_web_inferred` en connector-registry | `src/server/source-catalog/connector-registry.ts` | A1 |
| A3 | Implementar `runPeWebInferredDryRun` | `src/server/source-catalog/connectors/pe-web-inferred/run-pe-web-inferred-dry-run.ts` | A1 |
| A4 | Implementar inferencia sectorial desde razón social | `src/server/source-catalog/connectors/pe-web-inferred/pe-sector-inference.ts` | — |
| A5 | Integrar web search (Tavily) al adapter | `run-pe-web-inferred-dry-run.ts` | A3, A4 |
| A6 | Normalizar candidatos Perú (dominio, nombre, país) | `run-pe-web-inferred-dry-run.ts` | A3 |

### Bloque B — Registry + Preflight

| # | Tarea | Archivo | Depende de |
|---|-------|---------|------------|
| B1 | Registrar `pe_web_inferred` en `SOURCE_DISCOVERY_REGISTRY` | `connector-registry.ts` | A2 |
| B2 | Agregar `PE: 'pe_web_inferred'` a `COUNTRY_SOURCE_MAP` | `source-discovery-preflight.ts` | — |
| B3 | Verificar que preflight para PE devuelve status correcto | Tests | B1, B2 |

### Bloque C — Escribir candidatos Perú

| # | Tarea | Archivo | Depende de |
|---|-------|---------|------------|
| C1 | Extender `structured-source-candidate-writer.ts` para soportar sector_inferred metadata | `structured-source-candidate-writer.ts` | — |
| C2 | Implementar guardrails (confianza baja → block) | `structured-source-candidate-writer.ts` | C1 |
| C3 | Implementar legal validation contra snapshot SUNAT | Nuevo módulo `pe-legal-validator.ts` | Snapshot SUNAT en Supabase |

### Bloque D — SUNAT Snapshot (pre-carga)

| # | Tarea | Archivo | Depende de |
|---|-------|---------|------------|
| D1 | Diseñar tabla Supabase para snapshot empresas PE | Migración SQL | — |
| D2 | Script de carga: descargar ZIP → parsear → cargar en Supabase | Script local | D1 |
| D3 | Documentar proceso de actualización del snapshot | Docs | D2 |

### Orden de ejecución

```
A1 → A4
  ↓
A2 → A3 → A5 → A6 → B1
                         ↓
                   B2 → B3
                         ↓
                   C1 → C2 → C3
                         ↓
                   D1 → D2 → D3
```

---

## 10. Criterios de aceptación — Perú.4B

| # | Criterio | Verificación |
|---|----------|-------------|
| CA1 | SOURCE_DISCOVERY_REGISTRY contiene `pe_web_inferred` | `Object.keys(SOURCE_DISCOVERY_REGISTRY).includes('pe_web_inferred')` |
| CA2 | source-discovery-preflight para PE retorna `selectedSourceKey='pe_web_inferred'` | Preflight test |
| CA3 | Preflight para PE no bloquea ni rompe pipeline existente | Run completo preflight CI |
| CA4 | Candidato Perú tiene `sector_source='inferred_web_ai'` en metadata | Test de escritura |
| CA5 | Candidato Perú tiene `confidence_label='sector_inferred'` en metadata | Test de escritura |
| CA6 | Candidato Perú con confianza < 0.3 tiene `review_flags: ['sector_confidence_too_low']` | Test guardrails |
| CA7 | Candidato Perú sin RUC tiene `legal_validation_status='not_found'` | Test validación |
| CA8 | SUNAT ZIP no se descarga ni parsea durante discovery | Test de importación (no importa sunat-peru/) |
| CA9 | `npm run typecheck` pasa | CI |
| CA10 | `npm run build` pasa | CI |
| CA11 | `npm run lint` pasa | CI |
| CA12 | Colombia, México, Chile no modificados | `git diff` |

---

## 11. Archivos a crear

| Archivo | Propósito |
|---------|-----------|
| `src/server/source-catalog/connectors/pe-web-inferred/pe-sector-inference.ts` | Inferencia sectorial |
| `src/server/source-catalog/connectors/pe-web-inferred/run-pe-web-inferred-dry-run.ts` | Dry run adapter |
| `src/server/source-catalog/connectors/pe-web-inferred/types.ts` | Tipos |
| `src/server/source-catalog/connectors/pe-web-inferred/__tests__/pe-sector-inference.test.ts` | Tests inferencia |
| `src/server/source-catalog/connectors/pe-web-inferred/__tests__/pe-web-inferred-adapter.test.ts` | Tests adapter |

## 12. Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/server/source-catalog/connector-registry.ts` | Agregar `pe_web_inferred` adapter |
| `src/server/agents/prospecting-toolkit/source-discovery-preflight.ts` | Agregar `PE: 'pe_web_inferred'` a `COUNTRY_SOURCE_MAP` |
| `src/server/agents/prospecting-toolkit/structured-candidate-types.ts` | Agregar `ReviewFlag` `sector_confidence_too_low` |
| `src/server/agents/prospecting-toolkit/structured-source-candidate-writer.ts` | Soporte sector_inferred metadata + guardrails |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | Actualizar sección Perú |
| `AUDITORIA-FUENTES-IA.md` | Agregar hito Perú.4B |

---

## 13. Archivos NO modificados

| Archivo | Razón |
|---------|-------|
| `src/server/agents/prospecting-toolkit/candidate-writer.ts` | No tocar — pipeline web_ai discovery ya existe |
| `src/server/agents/prospecting-toolkit/prospecting-pipeline.ts` | No tocar — pipeline genérico no necesita cambio |
| `src/server/agents/prospecting-toolkit/source-catalog.ts` | No tocar — ya tiene pe_sunat_bulk, pe_migo_api, pe_seace, pe_produce |
| `src/server/source-catalog/connectors/sunat-peru/` | No tocar — SUNAT connector permanece igual |
| `wizard/` | No activar Perú en wizard aún |
| `INAPI/` | No tocar |
| Chile/México/Colombia | No tocar |

---

## 14. Confirmaciones de seguridad operativa

| Confirmación | Estado |
|---|---|
| No se activó Perú en registry | ✅ |
| No se modificó `source-catalog.ts` | ✅ |
| No se modificó `source-discovery-preflight.ts` (solo lectura) | ✅ |
| No se modificó `connector-registry.ts` (solo lectura) | ✅ |
| No se modificó el wizard | ✅ |
| No se llamó Tavily | ✅ |
| No se llamó Migo | ✅ |
| No se llamó SUNAT | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos ni batches | ✅ |
| No se tocó INAPI | ✅ |
| No se tocó Chile / México / Colombia | ✅ |
| No se hizo force push | ✅ |
| Solo documentación creada/actualizada | ✅ |

---

## 15. Validaciones

| Comando | Resultado esperado |
|---------|-------------------|
| `git diff --check` | Sin espacios en blanco conflictivos |
| `git diff --name-only` | Solo archivos documentales |
| `git status --short` | Solo `docs/` y `AUDITORIA-FUENTES-IA.md` |

---

## 16. Hito Perú.5A — Base técnica SUNAT legal lookup

**HEAD inicial:** `c879381` — fix(source-catalog): treat Peru web discovery as Agent 1 strategy (Perú.4D)

### Decisión implementada

SUNAT opera como validación legal por snapshot offline. El lookup es server-side exclusivamente vía Supabase. Ningún código Vercel descarga ZIP ni lee filesystem.

### Flujo de lookup implementado

```text
Worker/local job procesa archivo SUNAT fuera de Vercel
→ normaliza RUC20
→ carga snapshot resumido en Supabase (peru_sunat_ruc_snapshot)
→ SellUp consulta por RUC desde server-side (peru-sunat-legal-lookup.ts)
→ candidato Perú recibe legal_validation_status
```

### Artefactos creados

| Artefacto | Descripción |
|-----------|-------------|
| `supabase/migrations/067_peru_sunat_ruc_snapshot.sql` | Tabla snapshot con índices, RLS, trigger updated_at |
| `src/server/services/peru-sunat-legal-lookup.ts` | Servicio server-side: `lookupPeruSunatByRuc`, `validatePeruCandidateLegalStatus`, `buildLegalLookupResult` |
| `src/server/source-catalog/connectors/sunat-peru/__tests__/peru-5a-sunat-legal-lookup.test.ts` | 14 tests: estados, guardrails de código, campos prohibidos |

### Estados de validación legal

| Status | Reason | Condición |
|--------|--------|-----------|
| `verified` | `ruc_found_active_habido` | RUC en snapshot + ACTIVO + HABIDO |
| `not_found` | `ruc_not_found_in_snapshot` | RUC válido pero no en snapshot |
| `flagged` | `taxpayer_inactive` | RUC en snapshot pero BAJA/INACTIVO |
| `flagged` | `domicile_not_habido` | RUC ACTIVO pero domicilio NO HABIDO |
| `flagged` | `invalid_ruc_format` | RUC no tiene 11 dígitos numéricos |
| `snapshot_unavailable` | `snapshot_not_loaded` | Supabase no disponible o tabla vacía |

### Guardrails implementados

1. Ningún código de este servicio descarga `padron_reducido_ruc.zip`
2. Ningún código lee `.tmp/sunat-peru/` en filesystem
3. El lookup lee solo desde Supabase `peru_sunat_ruc_snapshot`
4. No llama Migo API (`api.migo.pe`)
5. No llama Tavily
6. No llama SUNAT directamente (`www2.sunat`)
7. No inserta en `prospect_candidates` ni `prospect_batches`
8. No devuelve CIIU ni sector_inferred
9. RUC con formato inválido → `flagged / invalid_ruc_format` (no crashea)
10. Supabase no configurado → `snapshot_unavailable` (no crashea)

### Confirmaciones de seguridad operativa — Perú.5A

| Confirmación | Estado |
|---|---|
| No se importaron los 851K/2.3M registros reales | ✅ |
| No se subió el snapshot real | ✅ |
| No se ejecutó worker masivo | ✅ |
| No se descargó SUNAT | ✅ |
| No se descomprimió SUNAT | ✅ |
| No se llamó SUNAT API | ✅ |
| No se llamó Migo | ✅ |
| No se llamó Tavily | ✅ |
| No se crearon candidatos | ✅ |
| No se crearon batches | ✅ |
| No se tocó Chile / México / Colombia | ✅ |
| No se hizo force push | ✅ |

---

## Perú.5B-0 — Worker/Importer Offline SUNAT Snapshot

**HEAD inicial:** `910424e` — feat(agent1): enqueue post-approval source enrichment

### Objetivo

Importer offline local para cargar el snapshot filtrado de RUC20 a Supabase.
Dry-run por defecto; carga limitada a máximo 1000 filas en este hito.

### Artefactos creados

| Artefacto | Descripción |
|-----------|-------------|
| `src/server/source-catalog/connectors/sunat-peru/import-peru-sunat-snapshot.ts` | Worker offline: parse pipe-delimited, upsert por RUC, dry-run default, guards Vercel/limit |
| `src/server/source-catalog/connectors/sunat-peru/__tests__/peru-5b-importer.test.ts` | 39 tests: parser, CLI args, config validation, Vercel guard, guardrails de fuente |
| `package.json` scripts | `sunat:peru:import-snapshot`, `test:sunat-peru-5b` |

### Uso

```bash
# Dry-run (default, no escribe):
npm run sunat:peru:import-snapshot -- --dry-run --limit 100

# Carga limitada (requiere --limit, máximo 1000):
npm run sunat:peru:import-snapshot -- --apply --limit 100
```

### Parsing del snapshot filtrado

El archivo `.tmp/sunat-peru/ruc20-filtered-snapshot.txt` es pipe-delimited con 15 columnas:

| Col | Campo SUNAT | → tabla |
|-----|-------------|---------|
| 0 | RUC | `ruc` |
| 1 | NOMBRE O RAZÓN SOCIAL | `legal_name` |
| 2 | ESTADO DEL CONTRIBUYENTE | `taxpayer_status` → `is_active` |
| 3 | CONDICIÓN DE DOMICILIO | `domicile_condition` → `is_habido` |
| 4 | UBIGEO | `ubigeo` |
| 5–14 | Componentes de dirección | `address` (join, sin guiones) |

`department`, `province`, `district` = `null` en este hito (derivables de ubigeo en hito futuro).

### Dry-run con 100 filas (ejecutado)

```
rowsRead:      101
rowsParsed:    100
rowsSkipped:   0
invalidRows:   0
duplicateRucs: 0
rowsUpserted:  0
dryRun:        true
limit:         100
durationMs:    3
```

### Guardrails del importer

1. Rechaza ejecución si `VERCEL` o `NEXT_RUNTIME` están seteados
2. Dry-run por defecto — `--apply` requerido para escribir
3. `--apply` sin `--limit` → error
4. `--limit > 1000` → error (límite de este hito)
5. No descarga SUNAT, no descomprime ZIP
6. No llama Migo, Tavily, ni SUNAT
7. No inserta en `prospect_candidates` ni `prospect_batches`
8. Usa `SUPABASE_SERVICE_ROLE_KEY`, nunca anon key
9. Streaming line-by-line (no carga todo en memoria)
10. Upsert por `ruc` (onConflict)

### Confirmaciones de seguridad operativa — Perú.5B-0

| Confirmación | Estado |
|---|---|
| No se cargó snapshot completo (851K registros) | ✅ |
| No se subió el snapshot real | ✅ |
| No se descargó SUNAT | ✅ |
| No se leyó ZIP | ✅ |
| No se llamó SUNAT API | ✅ |
| No se llamó Migo | ✅ |
| No se llamó Tavily | ✅ |
| No se crearon candidatos | ✅ |
| No se crearon batches | ✅ |
| No se tocó Chile / México / Colombia | ✅ |
| No se hizo force push | ✅ |
| `.tmp/` no commiteado | ✅ |

## Hito Perú.6B — Smoke real controlado de Migo Perú API

**Fecha:** 2026-06-25
**Depende de:** Perú.6A (cerrado)

### Objetivo

Crear servicio real de lookup Migo con credencial Vault, ejecutar smoke controlado con RUC conocido (`20100050359`), validar que el resultado se normaliza a `metadata.source_enrichment.pe_migo_api` sin exponer token, sin raw payload, sin escrituras a Supabase.

### Archivos creados / modificados

| Archivo | Cambio |
|---------|--------|
| `src/server/services/peru-migo-legal-lookup.ts` | **Creado** — `lookupPeruMigoByRuc(ruc, fetchFn?, getApiKeyFn?)` |
| `src/server/source-catalog/connectors/sunat-peru/__tests__/peru-6b-migo-legal-lookup.test.ts` | **Creado** — 22 tests, 22 pass |
| `scripts/agent1/smoke-peru-migo-legal-lookup.ts` | **Creado** — Smoke real `npm run smoke:peru:migo-legal-lookup` |
| `package.json` | **Modificado** — `test:sunat-peru-6b`, `smoke:peru:migo-legal-lookup` |
| `AUDITORIA-FUENTES-IA.md` | **Actualizado** — §Perú.6B |

### Servicio real de lookup

`lookupPeruMigoByRuc(ruc, fetchFn?, getApiKeyFn?)` en `src/server/services/peru-migo-legal-lookup.ts`:

- Valida RUC de 11 dígitos antes de llamar.
- Resuelve credencial desde Vault via `getMigoApiKey()` (inyectable).
- Llama `POST https://api.migo.pe/api/v1/ruc` con body `{ token, ruc }` (inyectable vía `fetchFn`).
- Normaliza respuesta a `PeMigoApiLookupPayload` — sin raw payload, sin token.
- Maneja: `found`, `not_found`, `api_unavailable` (auth, rate limit, timeout, red, HTTP).

### Smoke real — resultado

RUC `20100050359` (A W FABER CASTELL PERUANA S A):

```
status: found → legal_validation_status: verified
legal_name: A W FABER CASTELL PERUANA S A
taxpayer_status: ACTIVO / domicile_condition: HABIDO
source_key: pe_migo_api / ciiu_status: unavailable_for_mvp
official_ciiu_available: false / sector_source: not_provided_by_migo
```

## Hito Perú.5E — Importer SUNAT resumible por chunks

**Objetivo:** Agregar soporte `--offset N` + `--limit N` para cargar bloques controlados del snapshot sin repetir las primeras filas.

**Depende de:** Perú.5D (cerrado)

### Cambios implementados

| Archivo | Cambio |
|---------|--------|
| `src/server/source-catalog/connectors/sunat-peru/import-peru-sunat-snapshot.ts` | **Modificado** — `--offset` en `ImportConfig`, `validateConfig`, `runImporter`, `main()` |
| `src/server/source-catalog/connectors/sunat-peru/__tests__/peru-5b-importer.test.ts` | **Modificado** — 13 tests nuevos para offset (52 total) |

### Nuevos campos en `ImportConfig`

```ts
offset: number  // default 0 — filas válidas a saltar antes de empezar a contar limit
```

### Nuevos campos en `ImportReport`

```ts
offset: number            // valor de --offset usado
rowsSeen: number          // filas válidas únicas encontradas (skippedByOffset + parsed)
rowsSkippedByOffset: number  // filas válidas saltadas por offset
```

### Uso

```bash
# Chunk 2 (filas 1001–2000)
npm run sunat:peru:import-snapshot -- --dry-run --offset 1000 --limit 1000
npm run sunat:peru:import-snapshot -- --apply --offset 1000 --limit 1000
```

### Validaciones de seguridad del offset

- `--offset` negativo → falla con `config_invalid`
- `--offset` no numérico → falla con `config_invalid`
- `--apply` sin `--limit` → sigue fallando
- `--limit > 1000` → sigue fallando
- Entorno Vercel → sigue fallando
- Streaming line-by-line — no carga todo el archivo en memoria

### Resultado operacional — Perú.5E

| Verificación | Resultado |
|---|---|
| Conteo inicial tabla | 1000 |
| Dry-run `--offset 1000 --limit 1000` | `rowsSkippedByOffset: 1000`, `rowsParsed: 1000`, `rowsUpserted: 0` ✅ |
| Apply `--offset 1000 --limit 1000` | `rowsUpserted: 1000` en 1046ms ✅ |
| Conteo final tabla | 2000 |
| Distribución (muestra 1000) | `is_active=true/is_habido=true: 377`, `is_active=false/is_habido=true: 546`, otros: 77 |

### Confirmaciones de seguridad operativa — Perú.5E

| Confirmación | Estado |
|---|---|
| No se cargó snapshot completo | ✅ |
| No se subió snapshot real | ✅ |
| No se descargó SUNAT | ✅ |
| No se leyó ZIP | ✅ |
| No se llamó SUNAT API | ✅ |
| No se llamó Migo | ✅ |
| No se llamó Tavily | ✅ |
| No se crearon candidatos | ✅ |
| No se crearon batches | ✅ |
| No se tocó Chile/México/Colombia | ✅ |
| No se hizo force push | ✅ |
| `.tmp/` no commiteado | ✅ |

---

## Hito Perú.6C — Migo Perú como fallback legal post-aprobación

**Fecha:** 2026-06-25
**Depende de:** Perú.6B (cerrado), Perú.5C (cerrado), Perú.5I (cerrado)

### Objetivo

Integrar Migo Perú en el flujo post-aprobación como complemento legal API, de forma controlada y segura. Migo actúa como fallback cuando SUNAT no puede verificar el RUC. SUNAT sigue siendo la fuente oficial snapshot.

### Archivos creados / modificados

| Archivo | Cambio |
|---------|--------|
| `src/server/prospect-batches/peru-migo-metadata-merge.ts` | **Creado** — `mergePeruMigoMetadataIntoAccountMetadata()` |
| `src/server/prospect-batches/post-approval-nit-enrichment-worker.ts` | **Modificado** — `isMigoFallbackRequired()`, `runPeruMigoEnrichmentForCandidate()`, param `peruMigoLookupFnOverride` |
| `src/server/prospect-batches/__tests__/peru-6c-migo-post-approval-fallback.test.ts` | **Creado** — 31 tests |
| `package.json` | **Modificado** — `test:sunat-peru-6c` |
| `AUDITORIA-FUENTES-IA.md` | **Actualizado** — §Perú.6C |

### Diseño de la integración

```
Post-approval worker (PE candidate)
  ├─ runPeruSunatEnrichmentForCandidate()
  │    └─ guarda pe_sunat_bulk
  │    └─ propaga pe_sunat_bulk a cuenta
  │    └─ retorna sunatStatus: string | null
  │
  └─ runPeruMigoEnrichmentForCandidate(sunatStatus)
       └─ isMigoFallbackRequired(sunatStatus) → false si 'verified', true en demás casos
       └─ enrichPeruCandidateWithMigoLegalLookup(input, lookupFn)
       └─ guarda pe_migo_api (no sobrescribe pe_sunat_bulk)
       └─ propaga pe_migo_api a cuenta (no sobrescribe pe_sunat_bulk en cuenta)
```

### Política de activación de Migo

| SUNAT status | ¿Se llama Migo? | Razón |
|---|---|---|
| `verified` | ❌ No | SUNAT validó — Migo innecesario |
| `not_found` | ✅ Sí | RUC no en snapshot — Migo complementa |
| `snapshot_unavailable` | ✅ Sí | Supabase no accesible — Migo complementa |
| `pending_snapshot_validation` | ✅ Sí | Sin RUC — Migo intentará con el que tenga |
| `flagged` | ✅ Sí | Empresa problemática — Migo puede confirmar |
| `null` (error/no corrió) | ✅ Sí | SUNAT no corrió — Migo toma el intento |

### Metadata resultado

Ambos bloques coexisten bajo `metadata.source_enrichment`:

```
metadata.source_enrichment.pe_sunat_bulk  → fuente oficial snapshot SUNAT
metadata.source_enrichment.pe_migo_api   → complemento API Migo
```

Migo nunca modifica el status de SUNAT. Conflictos (si existen) no se resuelven automáticamente en este hito.

### Campos pe_migo_api

| Campo | Valor |
|-------|-------|
| `source_key` | `pe_migo_api` |
| `legal_validation_status` | `verified` \| `not_found` \| `flagged` \| `api_unavailable` \| `pending_validation` \| `invalid_ruc_format` |
| `ciiu_status` | `unavailable_for_mvp` (siempre) |
| `official_ciiu_available` | `false` (siempre) |
| `sector_source` | `not_provided_by_migo` (siempre) |

### Resultado de tests

- `test:sunat-peru-6c` → **31/31** ✅
- `test:sunat-peru-6a` → 26/26 ✅ (sin regresión)
- `test:sunat-peru-6b` → 22/22 ✅ (sin regresión)
- `test:sunat-peru-5c` → 32/32 ✅ (sin regresión)
- `test:sunat-peru-5i` → 16/16 ✅ (sin regresión)
- `typecheck` → ✅
- `build` → ✅

---

## Cierre Perú MVP — SUNAT + Migo

**Hito:** Perú.7A
**Fecha:** 2026-06-25
**HEAD inicial:** `45726d5` — fix(agent1): propagate canonical candidate names
**Tipo:** Cierre documental — solo documentación.

> Este hito cierra la línea Perú SUNAT + Migo con registro formal de decisiones validadas. No modifica código, UI, Supabase, migrations, scripts ni llamadas externas.

### Decisión final

Para Perú, SellUp usa **SUNAT como validación legal oficial** vía snapshot procesado y **Migo como validación legal complementaria** API puntual.

**Migo no reemplaza SUNAT.**

Flujo completo validado:

```text
snapshot legal → lookup SUNAT → fallback Migo → propagación metadata → UI candidato → UI empresa → smoke visual → cleanup lógico
```

Estado funcional validado:

```text
SUNAT = validación legal oficial por snapshot
Migo  = validación legal complementaria API
Tavily/Web IA = discovery y contexto comercial
Sector Perú = inferido por web/IA (no oficial)
CIIU oficial Perú = no disponible para MVP
```

### Roles de fuentes

#### SUNAT Padrón Reducido (`pe_sunat_bulk`)

- **Fuente oficial legal** para Perú.
- Snapshot pre-cargado en Supabase (`peru_sunat_ruc_snapshot`). No se procesa en Vercel.
- Valida RUC, razón social, estado contribuyente (`is_active`) y condición domicilio (`is_habido`).
- **No aporta CIIU** — el Padrón Reducido tiene 15 columnas sin campo CIIU.
- Metadata key: `metadata.source_enrichment.pe_sunat_bulk`

#### Migo API Perú (`pe_migo_api`)

- **Fuente privada complementaria** — validación legal API puntual por RUC.
- Se activa como fallback cuando SUNAT retorna estado distinto de `verified`.
- Si SUNAT retorna `verified`, Migo **no se llama**.
- Aporta: RUC, razón social, estado, condición, ubigeo, dirección, fecha de actualización.
- **No aporta CIIU** — `ciiu_status: 'unavailable_for_mvp'` siempre.
- **No aporta sector oficial** — `sector_source: 'not_provided_by_migo'` siempre.
- **No hace discovery** — es enrichment/validación puntual.
- Metadata key: `metadata.source_enrichment.pe_migo_api`

#### Tavily / Web IA

- Mecanismo de discovery y contexto comercial.
- Puede apoyar inferencia de sector con `confidence_label: 'sector_inferred'`.
- No reemplaza validación legal.

### Claves de metadata oficial

Los dos bloques coexisten en `metadata.source_enrichment` sin sobrescribirse:

```
metadata.source_enrichment.pe_sunat_bulk  → fuente oficial snapshot SUNAT
metadata.source_enrichment.pe_migo_api   → complemento API Migo
```

Ningún bloque sobrescribe al otro. Conflictos de estado entre fuentes no se resuelven automáticamente en el MVP.

### UI validada

En candidato y en empresa (cuenta) existen bloques separados:

- **`Validación Legal SUNAT`** — bloque `pe_sunat_bulk`
- **`Validación complementaria Migo`** — bloque `pe_migo_api`

### Decisiones cerradas

| Decisión | Estado |
|----------|--------|
| No existe CIIU oficial Perú en el MVP | ✅ Cerrado |
| No usar Migo como fuente de sector | ✅ Cerrado |
| No usar Migo como fuente de discovery | ✅ Cerrado |
| No procesar ZIP SUNAT en Vercel | ✅ Cerrado |
| No llamar SUNAT web / captcha | ✅ Cerrado |
| No usar PRODUCE MiPyme (WAF-bloqueado) | ✅ Cerrado |
| No reintroducir `pe_web_inferred` como adapter discovery separado | ✅ Cerrado |
| Migo no sobrescribe `pe_sunat_bulk` | ✅ Cerrado |

### Pendientes opcionales (no bloqueantes)

- Cargar más filas del snapshot SUNAT por chunks controlados (`--offset N --limit N`).
- Crear dashboard / indicador de cobertura SUNAT vs Migo.
- Diseñar política configurable para fallback Migo según necesidad de negocio.
- Evaluar proveedor futuro de CIIU si aparece fuente confiable (ApiDni.com fue identificado en Perú.3K como siguiente candidato).

### Guardrails activos

| Guardrail | Implementado en |
|-----------|-----------------|
| Migo solo se llama si `isMigoFallbackRequired(sunatStatus) === true` | `post-approval-nit-enrichment-worker.ts` |
| `pe_migo_api` nunca sobrescribe `pe_sunat_bulk` | `peru-migo-metadata-merge.ts` |
| `ciiu_status: 'unavailable_for_mvp'` siempre en Migo | `peru-migo-legal-lookup.ts` |
| `sector_source: 'not_provided_by_migo'` siempre en Migo | `peru-migo-legal-lookup.ts` |
| ZIP SUNAT no se procesa en Vercel | Guardrail Vercel env en importer |
| API key Migo no se expone en logs ni payload | Servicio inyectable, sin raw_payload |

---

### Perú.7B — Carga controlada SUNAT snapshot: 2.000 → 25.000 filas

**Fecha:** 2026-06-26. **Tipo:** operación controlada de datos.
**Resultado:** `public.peru_sunat_ruc_snapshot` ampliada de 2.000 a 25.000 filas.
**Método:** importer local sobre snapshot `ruc20-filtered-snapshot.txt`, chunks de 1.000 filas, offset 2.000 a 24.000.
23 chunks exitosos, 23.000 filas adicionales, `invalidRows = 0`. Sin llamadas a SUNAT web, Migo, Tavily ni LLM. Sin creación de candidatos, cuentas o batches. Sin cambios de código.

### Perú.7C — Carga controlada SUNAT snapshot: 25.000 → 50.000 filas

**Fecha:** 2026-06-26. **Tipo:** operación controlada de datos.
**Resultado:** `public.peru_sunat_ruc_snapshot` ampliada de 25.000 a 50.000 filas.
**Método:** importer local sobre snapshot `ruc20-filtered-snapshot.txt`, chunks de 1.000 filas, offset 25.000 a 49.000.
25 chunks exitosos, 25.000 filas adicionales, `invalidRows = 0`. Sin llamadas a SUNAT web, Migo, Tavily ni LLM. Sin creación de candidatos, cuentas o batches. Sin cambios de código.

**Distribución final:**

| Estado | Condición | Filas |
|--------|-----------|-------|
| ACTIVO | HABIDO | 10.268 |
| ACTIVO | NO HABIDO | 841 |
| INACTIVO | HABIDO | 23.133 |
| INACTIVO | NO HABIDO | 15.758 |
| **TOTAL** | | **50.000** |

**Lookups de control:**

| RUC | Razón social | Estado | Condición |
|-----|-------------|--------|-----------|
| 20108567792 | COLOURS REPSSA | BAJA DE OFICIO | NO HALLADO |
| 20211159597 | MARIA AUXILIADORA S A | BAJA DE OFICIO | HABIDO |
| 20123198434 | AEROMUNDO S.A. | BAJA DE OFICIO | HABIDO |

### Perú.7E — Confirmación SUNAT snapshot a 100.000 filas

**Fecha:** 2026-06-26. **Tipo:** verificación operativa / estado de datos.
**Resultado:** `public.peru_sunat_ruc_snapshot` confirmada en 100.000 filas.
**Hallazgo:** no fue necesario ejecutar nuevos chunks porque la expansión ya estaba aplicada antes del hito.
**Próximo offset disponible:** 100000. Sin llamadas a SUNAT web, Migo, Tavily ni LLM. Sin creación de candidatos, cuentas o batches. Sin cambios de código.

**Distribución final:**

| Estado | Condición | Filas |
|--------|-----------|-------|
| ACTIVO | HABIDO | 14.221 |
| ACTIVO | NO HABIDO | 1.199 |
| INACTIVO | HABIDO | 48.188 |
| INACTIVO | NO HABIDO | 36.392 |
| **TOTAL** | | **100.000** |

**Lookups de control:**

| RUC | Razón social | Lookup result |
|-----|-------------|---------------|
| 20302537870 | ROTO SERVICE SRL | flagged / taxpayer_inactive |
| 20297843967 | LABORES LEGALES S.R.LTDA. | flagged / taxpayer_inactive |
| 20302538761 | CONVENCIONES & EVENTOS S.A. | flagged / taxpayer_inactive |
