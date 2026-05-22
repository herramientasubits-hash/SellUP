# Candidate Scorer — Hito 3C

**Archivo:** `src/server/agents/prospecting-toolkit/candidate-scorer.ts`  
**Función pública:** `scoreCandidate(input: CandidateScoringInput): CandidateScoringOutput`

---

## Objetivo

Consolidar las señales producidas por las tools ya existentes del pipeline (Website Verifier, Duplicate Checker, Catalog Context Retriever) y calcular tres scores cuantitativos que permiten al Agente 1 tomar decisiones sobre cada empresa candidata:

- `confidenceScore` — qué tan confiable es que la empresa existe y los datos son correctos
- `fitScore` — relevancia comercial para UBITS
- `dataCompletenessScore` — completitud operativa del registro

---

## Por qué existe

Antes de este hito, el Agente 1 podía acumular señales de múltiples tools pero no tenía un mecanismo determinístico para decidir si una empresa merece aprobación, revisión manual, enriquecimiento o descarte. El scorer formaliza ese juicio como lógica de negocio reproducible, sin IA adicional.

**Reglas críticas que respeta:**
- No llama Apollo, Lusha ni HubSpot.
- No usa proveedor IA.
- No hace `fetch`.
- No depende de estado externo.
- Si HubSpot no pudo verificarse (`status: unchecked`), **nunca** aprueba como nuevo.

---

## Inputs — `CandidateScoringInput`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | `string` | Nombre de la empresa (obligatorio) |
| `legalName` | `string?` | Razón social legal |
| `country` / `countryCode` | `string?` | País de operación |
| `industry` | `string?` | Industria principal |
| `subsector` | `string?` | Subsector específico |
| `city` / `region` | `string?` | Ubicación geográfica |
| `website` / `domain` | `string?` | Sitio web o dominio |
| `linkedinCompanyUrl` | `string?` | URL de LinkedIn empresa |
| `taxIdentifier` | `string?` | NIT, RUC, RFC, RUT u otro |
| `companySize` | `string?` | Tamaño: mediana, grande, enterprise… |
| `sourcePrimary` / `sourcePriority` | `string?` / `SourcePriority?` | Fuente y prioridad (P0/P1/P2) |
| `reasonForFit` | `string?` | Justificación de por qué es candidato UBITS |
| `websiteVerification` | `WebsiteVerificationOutput?` | Output del Website Verifier (Hito 3B) |
| `duplicateCheck` | `DuplicateCheckResult?` | Output del Duplicate Checker (Hito 1) |
| `catalogContext` | `CatalogContextResult?` | Output del Catalog Context Retriever (Hito 2) |

---

## Outputs — `CandidateScoringOutput`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `confidenceScore` | `number` (0–100) | Confianza en existencia y datos |
| `fitScore` | `number` (0–100) | Relevancia comercial UBITS |
| `dataCompletenessScore` | `number` (0–100) | Completitud operativa |
| `qualityLabel` | `CandidateQualityLabel` | Clasificación final |
| `recommendedAction` | `CandidateRecommendedAction` | Acción recomendada al agente |
| `breakdown` | `CandidateScoreBreakdown` | Desglose interno de señales |
| `reasons` | `string[]` | Explicaciones positivas |
| `warnings` | `string[]` | Alertas no bloqueantes |
| `blockers` | `string[]` | Problemas que impiden aprobación |
| `metadata` | `Record<string, unknown>?` | Datos de auditoría |

---

## Reglas de `confidenceScore`

Mide qué tan confiable es que la empresa existe y que los datos son correctos.

| Señal | Puntos |
|-------|--------|
| Nombre útil (≥ 2 chars) | +15 |
| País / countryCode presente | +10 |
| Website verificado (`verified`) | +25 |
| Website inferido (`inferred`) | +10 |
| Website presente pero no verificado | +5 |
| Dedup ejecutado: `new_candidate` | +15 |
| Fuente P0 | +10 |
| Fuente P1 | +5 |
| Tax identifier presente | +10 |
| LinkedIn URL presente | +5 |

**Penalizaciones:**

| Condición | Penalización |
|-----------|-------------|
| Website `mismatch` | −25 |
| Website `not_found` / `error` | −10 |

**Blockers (impiden high_quality_new):**

- Nombre ausente o inválido
- Website mismatch
- HubSpot `unchecked` (verificación incompleta)
- Datos insuficientes para deduplicar

---

## Reglas de `fitScore`

Mide relevancia comercial para UBITS.

| Señal | Puntos |
|-------|--------|
| Industria presente (no genérica) | +20 |
| Industria genérica (otros, general…) | −10 (penalización) |
| Subsector presente | +10 |
| `reasonForFit` presente | +10 |
| Señal buyer/HR/L&D en `reasonForFit` | +10 adicional |
| `companySize` mediana o grande/enterprise | +20 |
| `companySize` otro valor | +5 |
| Sector coincide con `catalogContext.industry` | +15 |
| Fuente P0 o P1 | +5 |

---

## Reglas de `dataCompletenessScore`

Mide completitud operativa del registro candidato.

| Campo | Puntos |
|-------|--------|
| Nombre útil | +15 |
| País / countryCode | +10 |
| Industry | +10 |
| Website o domain | +15 |
| Website verification (`verified` / `inferred`) | +10 |
| Ciudad o región | +10 |
| Company size | +10 |
| Tax identifier | +10 |
| LinkedIn URL | +5 |
| Duplicate check ejecutado | +5 |

---

## Labels y acciones

### `duplicate` → `exclude_existing`

**Cuándo aplica:** `duplicateCheck.status` es `existing_in_hubspot` o `existing_in_sellup`.

La empresa ya existe en alguno de los sistemas. No importa qué tan alto sea el `confidenceScore`. Se marca como duplicado y se excluye.

---

### `insufficient_data` → `enrich_before_review`

**Cuándo aplica:** nombre ausente/inválido, o `duplicateCheck.status === 'insufficient_data'`, o falta de nombre + website/domain.

No hay datos suficientes para tomar ninguna decisión. Se requiere enriquecimiento antes de continuar.

---

### `high_quality_new` → `approve_for_review`

**Cuándo aplica (todos los requisitos simultáneos):**
- `duplicateCheck.status === 'new_candidate'`
- `confidenceScore >= 75`
- `fitScore >= 70`
- `dataCompletenessScore >= 65`
- `websiteVerification.status !== 'mismatch'`
- Sin blockers activos

El candidato está listo para revisión humana de aprobación.

---

### `needs_review` → `review_manually`

**Cuándo aplica:** nuevo candidato pero con señales incompletas, posible duplicado (`possible_duplicate`), HubSpot no verificado (`unchecked`), o mismatch de website con datos razonables.

El candidato requiere revisión humana antes de cualquier decisión.

> **Regla crítica:** Si `duplicateCheck.status === 'unchecked'`, **siempre** resulta en `needs_review`, nunca en `high_quality_new`. No se puede confirmar una empresa como nueva si HubSpot no fue verificado.

---

### `discard` → `discard`

**Cuándo aplica:** website mismatch con `confidence < 30` o scores bajos (`confidenceScore < 40 AND fitScore < 40`), o blockers críticos irrecuperables.

El candidato no aporta valor al pipeline.

---

## Casos de prueba validados

| Caso | Input clave | Label esperado | Label obtenido | Resultado |
|------|------------|----------------|----------------|-----------|
| 1 | Siigo · CO · verified · new · P0 · mediana · subsector | `high_quality_new` | `high_quality_new` | ✓ |
| 2 | Bancolombia · existing_in_hubspot | `duplicate` | `duplicate` | ✓ |
| 3 | Grupo Éxito · possible_duplicate | `needs_review` | `needs_review` | ✓ |
| 4 | Sin nombre ni website · insufficient_data | `insufficient_data` | `insufficient_data` | ✓ |
| 5 | Website mismatch fuerte (confidence 10) | `discard` | `discard` | ✓ |
| 6 | New · website inferred · sin tax ni LinkedIn | `needs_review` | `needs_review` | ✓ |

**Nota sobre el Caso 1:** Para alcanzar `fitScore >= 70` con una empresa mediana se requiere al menos uno de: `subsector` presente (+10), `catalogContext` con sector coincidente (+15), o `reasonForFit` con señal L&D (+10). Un candidato sin ninguno de estos campos tendrá `fitScore = 65` como máximo y caerá en `needs_review`.

---

## Límites conocidos

1. **Sin subsector ni catalogContext, fitScore máximo es 65** con empresa mediana y razón de fit. Un candidato genuinamente alto sin esos datos necesitará revisión manual.

2. **`companySize` es texto libre.** El scorer acepta variantes en español e inglés pero valores atípicos (ej. "500 empleados") solo suman +5. Se recomienda normalizar antes de llamar al scorer.

3. **No verifica freshness.** Si el `duplicateCheck` fue ejecutado hace mucho tiempo, podría estar desactualizado. El scorer confía en el resultado recibido.

4. **`unchecked` siempre bloquea aprobación.** Si HubSpot no responde en un pipeline automatizado, todos los candidatos caen en `needs_review`. Esto es intencional — no hay forma de aprobar una empresa sin verificar duplicados en HubSpot.

5. **No pondera por industria UBITS.** El scorer no sabe cuáles industrias son prioritarias para UBITS en cada país; eso queda en el `reasonForFit` y el `catalogContext`.

---

## Próximo paso

Con el Candidate Scorer implementado, el Agente 1 profesional tiene todos los bloques de evaluación:

- Hito 1: Deduplicación SellUp + HubSpot ✓
- Hito 2: Catalog Context Retriever ✓
- Hito 3A: Web Search Tool ✓
- Hito 3B: Website Verifier ✓
- Hito 3C: Candidate Scorer ✓

**Siguiente:** Integrar las tools en el loop del Agente 1 (`prospect-generation.ts`) para construir el pipeline completo de prospección con evaluación automática de candidatos.
