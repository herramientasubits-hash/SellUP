# AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 1

## Catalog audit + scalable precision design

**Naturaleza de esta fase:** READ-ONLY + CODE AUDIT + DESIGN.
**Ejecutado:** 2026-08-11 · rama `a1/subindustry-precision-coverage-1` · base `origin/main` = `4c9e6168` (#262).
**No ejecutado, por contrato:** Apollo · Tavily · Lusha · escrituras en Producción ·
migraciones · HubSpot · Agente 2A · cambios de presupuesto · merge.
**Escrituras de esta fase:** 3 archivos de documentación. Cero código de producción.

Datos numéricos y matriz de 73 filas:
[`diagnostics/agent1_subindustry_precision_coverage_matrix.md`](diagnostics/agent1_subindustry_precision_coverage_matrix.md)
Consultas SQL de sólo lectura reproducibles:
[`diagnostics/agent1_subindustry_precision_coverage_audit.sql`](diagnostics/agent1_subindustry_precision_coverage_audit.sql)

---

## 1 · Source of truth actual

| Qué | Dónde vive exactamente | Naturaleza |
|---|---|---|
| **A. Catálogo de industrias/subindustrias** | Tablas `industry_catalog_versions`, `industries`, `subindustries` + vista `active_industry_catalog` (`status='published'`). Migraciones 057/058/059/060. Loader: [`src/modules/industry-catalog/loader.ts`](../src/modules/industry-catalog/loader.ts) (`loadActiveCatalog`, guarda `mixed_versions`) | **DB-owned**, versionado, publicable sin despliegue |
| **B. Términos de búsqueda** | `subindustry_search_terms` + vista `active_subindustry_search_terms`. Lectura única: [`apollo-subindustry-catalog-terms-loader.server.ts`](../src/server/agents/prospecting-toolkit/apollo-subindustry-catalog-terms-loader.server.ts) (`term_type='keyword'`). Resolución/hash/coherencia: [`apollo-subindustry-catalog-terms-resolution.ts`](../src/server/agents/prospecting-toolkit/apollo-subindustry-catalog-terms-resolution.ts) | **DB-owned**, versionado, leído en vivo |
| **B′. Catálogo especializado de discovery** | [`apollo-subindustry-search-mapping.ts`](../src/server/agents/prospecting-toolkit/apollo-subindustry-search-mapping.ts) — `APOLLO_SUBINDUSTRY_CATALOG` (2 entradas, `positiveTerms` + `contradictoryTerms` + `aliases`) | **code-owned** |
| **C. Precision mappings** | [`apollo-subindustry-precision.ts`](../src/server/agents/prospecting-toolkit/apollo-subindustry-precision.ts) — `SUBINDUSTRY_ANCHOR_TERMS`, `SUBINDUSTRY_ANCHOR_FAMILIES`, `SUBINDUSTRY_EXCLUSIVE_BUSINESS_MODEL_TERMS`, `SUBINDUSTRY_CONFLICTING_BUSINESS_MODEL_TERMS`, `SUBINDUSTRY_BROAD_INDUSTRY_TERMS`, `SUBINDUSTRY_CONTRADICTORY_INDUSTRY_TERMS` | **code-owned, 2 claves** |
| **D. `requested_subindustries` del wizard** | Selección: [`wizard-catalog-resolver.ts`](../src/modules/prospect-batches/chat-wizard-execution/wizard-catalog-resolver.ts) (compara `catalogVersion` con la publicada y rehúsa si difiere) → `wizard-pipeline-adapter.ts` → `input.subindustries` del runner. Saneado canónico: `normalizeRequestedSubindustries` (exportado por el módulo de precisión, reutilizado por los gates de gasto) | code + DB |
| **E. Target eligibility** | [`candidate-completeness-contract.ts`](../src/server/agents/prospecting-toolkit/candidate-completeness-contract.ts) — `resolveCandidateSubindustryRequirement` → `evaluateCandidateSubindustryTargetEligibility` (fuente canónica única, #251) | code-owned |
| **F. Cobertura de discovery** | [`apollo-subindustry-search-coverage.ts`](../src/server/agents/prospecting-toolkit/apollo-subindustry-search-coverage.ts) — une B′ + B, y `evaluateApolloSubindustrySearchCoverageSpendGate` bloquea antes de pagar | code-owned, datos DB |
| **G. Consumidor único de precisión** | [`apollo-two-round/production-runner.server.ts`](../src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts) líneas ~1327 (pre-gasto), ~1585 (post-enrichment), ~1828 (reevaluación) + `foldSubindustryPrecisionIntoSectorState` (línea ~467) | code-owned |
| **H. UI** | [`candidate-subindustry-status-display.ts`](../src/modules/prospect-batches/candidate-subindustry-status-display.ts) | code-owned |

### Cifras leídas de nuevo (no heredadas)

```
catalog_version        1.0.0
catalog_version_id     e4675daf-65a2-5e26-8640-58f1aeaee5ed   (published 2026-06-11)
active_industries      8
active_subindustries   73
total_search_terms     228   (activos)
  keyword_terms        107   → 73/73 subindustrias con ≥1
  query_phrase_terms    76   → 71 subindustrias
  exclusion_terms       35   → 30 subindustrias
  source_hint_terms     10   →  9 subindustrias
subindustry_aliases    127   (activos)
subindustry_rules      364   (activos, 100 % execution_layer='model')
```

Sólo existe **una** versión en `industry_catalog_versions`: no hay draft ni archivada.
Toda modificación de catálogo hoy sería una mutación **in situ** de la versión publicada.

---

## 2 · Cobertura real de precision

```
TOTAL_SUBINDUSTRIES   73
SEARCH_COVERED        73   (100.00 %)
SEARCH_UNCOVERED       0   (  0.00 %)
PRECISION_MAPPED       2   (  2.74 %)
PRECISION_UNMAPPED    71   ( 97.26 %)
AUTO_CONFIRM_POSSIBLE  2   (  2.74 %)
```

Las dos con precisión: **Supermercados e Hipermercados** y
**Tiendas por Departamento, Moda y Calzado**. La matriz completa (73 filas, con
`kw/qp/ex/sh`, alias, reglas, `SC/PM/AC` y `fail_closed_reason`) está en el documento de
diagnóstico enlazado arriba.

`search_covered` y `precision_mapped` son propiedades **independientes**, y el módulo de
cobertura lo dice explícitamente: una subindustria puede ser `covered: true` y seguir con
`subindustryMapped: false`. Tener 107 términos `keyword` en 73/73 subindustrias **no
aporta un solo mapping de precisión**.

Para las 71 sin mapping, el estado es uniforme y verificado en código:
`precision_mapping_exists=false`, 0 señales positivas, 0 negativas, 0 valores de industria
de proveedor, 0 reglas de conflicto, `auto_confirm_possible=false`,
`fail_closed_reason = subindustry_not_mapped` ⇒ `SubindustryRequirementMatch = 'unmapped'`
⇒ **nunca cuenta hacia el objetivo**, aunque sí puede persistir como `needs_review`.

---

## 3 · Auditoría de los 2 mappings que ya funcionan

### Qué evidencia acepta

Sólo campos **clasificadores**, en orden de autoridad decreciente
(`CLASSIFYING_FIELDS` + `SOURCE_AUTHORITY`):

| Fuente | Campos | Autoridad |
|---|---|--:|
| `catalog_classification` | (reservado, sin productor hoy) | 95 |
| `provider_industry` | `industry`, `industries`, `apollo_profile.industry`, `apollo_profile.industries` | 90 |
| `provider_keywords` | `keywords`, `apollo_profile.keywords`, `apollo_profile.organization_keywords` | 80 |
| `provider_description` | `short_description`, `apollo_profile.short_description` | 75 |
| `website_profile` | `apollo_profile.seo_description`, `apollo_profile.description` | 70 |
| `commercial_name` | `result.title` (regla más estricta: sólo palabra/secuencia completa) | 65 |

`title` como snippet, `url`, `domain` y `snippet` **no** son clasificadores. `none` = 0 y
con él el veredicto nunca puede ser `confirmed`.

### Qué evidencia rechaza y cómo evita falsos positivos

1. **Matcher por secuencia de tokens** (`matchesCatalogTerm`, `TOKEN_PATTERN = /[\p{L}\p{N}]+/gu`),
   nunca `includes`. Cierra los cinco falsos positivos documentados (`moda` dentro de
   `cómodas`, `acomodación`, `Accommodation`…). No usa `\b` porque en Unicode `\b` trata la
   frontera ASCII→acentuada como límite de palabra.
2. **Anclas deliberadamente ausentes**: `grocery`, `retail`, `confeccion`, `calzado` sueltos
   NO son anclas; viven en las listas AMPLIAS, cuyo único efecto posible es `ambiguous`.
3. **Precedencia de decisión** (orden literal del evaluador):
   `industria declarada contradictoria` → `rejected` ·
   `modelo de negocio excluyente` → `rejected` ·
   `modelo en conflicto` → `ambiguous` con ancla / `rejected` sin ancla ·
   `ancla limpia` → `confirmed` ·
   `sólo industria amplia` o nada → `ambiguous`.
4. **La industria declarada se lee sólo en campos de industria** (`DECLARED_INDUSTRY_FIELDS`),
   nunca en descripciones: un supermercado con tarjeta propia menciona servicios
   financieros sin ser un banco.

### Cómo resuelve múltiples subindustrias pedidas

`assessApolloSubindustryPrecisionForRequest` evalúa **todas** y aplica ANY-OF con
precedencia `confirmed(3) > ambiguous(2) > rejected(1)`, desempate por `subindustryMapped`,
y **sólo un score estrictamente mayor desplaza al ganador** ⇒ estable respecto al orden de
la solicitud. Conserva `perRequestedSubindustryEvaluations` (una entrada por selección) y
`matchedRequestedSubindustry`.

### Evidencia contradictoria

Ancla + modelo en conflicto ⇒ `ambiguous` (no `confirmed`, no `rejected`): la ambigüedad es
exactamente lo que el enrichment existe para resolver. Ancla + modelo **excluyente** ⇒
`rejected` (la exclusión gana al ancla).

### Qué es reutilizable como arquitectura y qué es hardcode

| Reutilizable (arquitectura genérica, ya existe) | Hardcode específico (a convertir en datos) |
|---|---|
| `normalize` (NFD + strip marks + collapse) | las 6 tablas `Record<string, string[]>` |
| `matchesCatalogTerm` / `tokensContainSequence` / `termTokenCache` | `SUBINDUSTRY_ANCHOR_FAMILIES` con familias `department_store\|fashion_apparel\|footwear` como **unión de tipos cerrada** |
| `CLASSIFYING_FIELDS` + `SOURCE_AUTHORITY` + `strongestSource` | `resolveSubindustryKey` (inclusión bidireccional por substring, ver riesgo abajo) |
| `collectAnchorEvidence` / `collectCommercialNameEvidence` / `collectBusinessModelSignals` | — |
| la máquina de precedencia de 5 pasos y los 7 `SubindustryVerdictReason` | — |
| el ANY-OF, `normalizeRequestedSubindustries`, la proyección a metadata | — |

**Conclusión: el evaluador ya es genérico; lo único no escalable son los datos.**
Escalar no requiere escribir 71 bloques de lógica: requiere 71 juegos de datos y **un**
cambio de `Record` hardcodeado a rule-set inyectable.

> ⚠️ **Riesgo encontrado en el código actual, no en el diseño nuevo:**
> `resolveSubindustryKey` empareja con `normalized.includes(key) || key.includes(normalized)`.
> Es la misma contención ancha que `matchesApolloSubindustryAlias` ya corrigió en el catálogo
> de discovery (QUERY-QUALITY-2-FIX § 8). Con 2 claves largas es inocuo; con 12+ claves
> cortas (`banca tradicional`, `ciberseguridad`, `agritech`) se vuelve peligroso: cualquier
> etiqueta contenida en una clave la resolvería. **Debe corregirse en la misma ola que
> introduzca la tercera clave**, no después.

---

## 4 · Campos reales disponibles para precisión

Origen: `ApolloOrganizationSearchResultMetadata` / `ApolloProfileMetadata`
([`apollo-organizations-search-provider.ts`](../src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts))
y `WebSearchResult` ([`types.ts:291`](../src/server/agents/prospecting-toolkit/types.ts)).
Ningún campo de esta tabla está inventado.

| evidence_field | provider / path | search | enrichment | normalizado | persistido | usado hoy para precisión | fiabilidad |
|---|---|:--:|:--:|:--:|:--:|:--:|---|
| `industry` | `metadata.industry` | ✅ | ✅ | sí | sí | ✅ `provider_industry` (90) | alta — vocabulario cerrado de Apollo |
| `apollo_profile.industry` | idem, ruta perfil | ✅ | ✅ | sí | sí | ✅ | alta |
| `apollo_profile.industries[]` | array (max 10) | ✅ (si Apollo lo envía) | ✅ | sí | sí | ✅ | alta |
| `industries[]` **top-level** | — | ❌ **nunca poblado** | ❌ | — | — | ✅ (ruta muerta) | n/a |
| `keywords[]` | `metadata.keywords` (max 10) | ✅ | ✅ | sí | sí | ✅ `provider_keywords` (80) | media — texto libre del cliente |
| `apollo_profile.organization_keywords[]` | max 10 | ✅ | ✅ | sí | sí | ✅ | media |
| `short_description` | max 300 chars | ✅ | ✅ | sí | sí | ✅ `provider_description` (75) | media |
| `apollo_profile.seo_description` | max 300 | ✅ | ✅ | sí | sí | ✅ `website_profile` (70) | baja-media — marketing |
| `apollo_profile.description` | max 300 | ✅ | ✅ | sí | sí | ✅ `website_profile` (70) | baja-media |
| `title` (nombre comercial) | `result.title` | ✅ | ✅ | sí | sí | ✅ `commercial_name` (65), regla estricta | media |
| `linkedin_url` | `metadata.linkedin_url` | ✅ | ✅ (#234) | — | ✅ columna (mig 108) | ❌ | alta como identidad, **nula como clasificación** |
| `employee_count` | `estimated_num_employees` | ✅ | ✅ (#234) | — | ✅ columna | ❌ (sí en `size_evidence`/ICP) | alta — habilita «escala/cadena» |
| `domain` / `website` | `metadata.domain`/`website` | ✅ | ✅ | — | ✅ | ❌ **excluido a propósito** | baja |
| `city` / `country` | `metadata.city`/`country` | ✅ | ✅ | — | ✅ | ❌ | alta geo, nula sectorial |
| `snippet` | `result.snippet` | ✅ | ✅ | — | — | ❌ **excluido a propósito** | baja |
| `raw_fields_present[]` | `apollo_profile` | ✅ | ✅ | — | ✅ | ❌ (diagnóstico) | n/a |

**Enrichment no añade campos nuevos: añade valores a los mismos campos.** El runner ya
reevalúa precisión con el perfil comprado (línea ~1585) y captura `linkedin_url` /
`employee_count` recuperados (#234). No existe una tercera fuente de evidencia web para
Apollo: `source_hint` (10 filas) no tiene consumidor de código.

**Consecuencia de diseño:** el único campo aún sin usar con valor discriminante real es
**`employee_count`**, y sirve exactamente para la clase de regla que hoy no se puede
expresar («opera una **cadena** con múltiples puntos de venta», «tiene **escala**
corporativa» — 2 de las 2 `inclusion` de Supermercados). Se propone como
`minimum_evidence_strength` opcional, nunca como señal positiva por sí sola.

---

## 5 · Discovery terms ≠ precision terms (hallazgo crítico)

Los 107 términos `keyword` del catálogo **no son anclas**: son **frases de consulta**.
Muestra literal leída de Prod:

| Subindustria | `keyword` real en el catálogo |
|---|---|
| Supermercados e Hipermercados | `hipermercado hard discount retail` |
| Tiendas por Departamento, Moda y Calzado | `cadena moda retail fashion` |
| Redes Hospitalarias y Clínicas | `grupo hospitalario clínicas` |
| Formación Corporativa | `formación in-company B2B` · `proveedor training empresas` |
| Escuelas de Negocios | `MBA ejecutivo LATAM` · `formación ejecutiva liderazgo empresa` |
| Institutos Técnicos | `SENA OTEC SENATI CONALEP` |

Bajo el matcher por **secuencia contigua de tokens**, promover estos términos a positivos de
precisión produce dos desenlaces, ambos malos:

- **tal cual** ⇒ exige que la secuencia completa («hipermercado hard discount retail»)
  aparezca contigua en un campo del proveedor: **nunca ocurre** ⇒ falsos negativos masivos y
  cobertura de precisión aparente sin una sola confirmación real;
- **partidos en tokens** ⇒ `retail`, `LATAM`, `empresa`, `B2B`, `proveedor` se vuelven
  anclas ⇒ **falsos positivos masivos**, exactamente el defecto que cerró HARDENING-1 § 3.

Los 35 `exclusion_term` sufren lo mismo (`plataforma LMS e-learning tecnológica`,
`hospital público gobierno`): son descriptores para un LLM, no tokens deterministas.

### Clasificación de riesgo por tipo de término

| Tipo de término | SAFE_FOR_DISCOVERY | SAFE_FOR_PRECISION_POSITIVE | SAFE_FOR_PRECISION_NEGATIVE | TOO_GENERIC_FOR_PRECISION |
|---|:--:|:--:|:--:|:--:|
| `subindustry_search_terms.keyword` (frase de consulta) | ✅ | ❌ | ❌ | ✅ |
| `subindustry_search_terms.query_phrase` | ✅ | ❌ | ❌ | ✅ |
| `subindustry_search_terms.exclusion_term` (frase) | ✅ | ❌ | ❌ (no como token) | ✅ |
| `subindustry_search_terms.source_hint` | ✅ (sin consumidor) | ❌ | ❌ | ✅ |
| `subindustry_aliases.alias` corto y unívoco (`EPS`, `3PL`, `BPO`, `ERP`, `SENA`) | ✅ | ✅ **candidato fuerte** | — | ❌ |
| `subindustry_aliases.alias` genérico (`pharma`, `consumo masivo`) | ✅ | ⚠️ sólo con negativo hermano | — | ⚠️ |
| Nombre canónico de subindustria | ✅ | ⚠️ compuesto ⇒ requiere familias | — | ⚠️ |
| Valor de industria de Apollo (`banking`, `insurance`) | ⚠️ (no viaja como keyword) | ✅ vía `provider_industry_matches` | ✅ vía `provider_industry_exclusions` | ❌ |
| Término de industria amplia (`retail`, `food`, `comercio`) | ✅ | ❌ | ❌ | ✅ ⇒ sólo `broad` |

**Regla que el diseño debe imponer:** ningún término se promueve automáticamente de
discovery a precisión. La promoción es un acto de autoría por subindustria, con fixtures.
Los **127 alias** son la única fuente de catálogo con forma parecida a un ancla, y aun así
requieren revisión término a término: **34 de las 73 subindustrias no tienen ni un alias**, y
**42 tienen 2 o menos** (contado sobre la matriz del § 2).

---

## 6 · Diseño escalable: alternativas y recomendación

| # | Alternativa | Pros | Cons | Migración | Riesgo runtime | Versionado | Mantenibilidad | Fail-closed | Testabilidad |
|---|---|---|---|---|---|---|---|---|---|
| **A** | Hardcode por subindustria (status quo × 73) | 0 infra; determinista; revisable en PR | 71 bloques a mano; 6 tablas × 73 claves; cada cambio = despliegue; `resolveSubindustryKey` se vuelve peligroso | ninguna | bajo | por repo | **mala** | ✅ | ✅ |
| **B** | Reglas 100 % data-driven en tabla nueva | catálogo = fuente única; cambia sin despliegue | tabla + grants + workflow de publicación + 3ª superficie de coherencia de versión; hoy no hay ni un escritor de catálogo en `src/` | **sí** | medio-alto | ✅ | buena | requiere gate nuevo | media (necesita fixtures de DB) |
| **C** | **Híbrido: rule-set tipado como DATOS + evaluador genérico único** | el evaluador genérico **ya existe**; añadir subindustria = añadir datos; el mismo contrato sirve luego para DB; parity test 1:1 con los 100 casos actuales | exige un contrato tipado y validación fail-closed del payload | **no** (C1) / opcional (C2) | bajo | ✅ (C1 repo, C2 catálogo) | **buena** | ✅ | ✅ |
| **D** | Capa de normalización provider→industria | resolvería `retail banking` vs `retail` de raíz | substrato existe pero **está inerte**: 0 snapshots, 0 concepts, 0 associations; y es a nivel **industria**, no subindustria | sí (activar workflow) | alto | ✅ | buena a largo plazo | requiere gate nuevo | baja hoy |
| **E** | Scoring combinado / evidence policy | expresa «2 señales medias = 1 fuerte» | umbrales sin datos = precisión imaginaria; con 8 fixtures no se calibra un score | no | **alto** | n/a | mala | ⚠️ score puede confirmar sin ancla | difícil |

### Arquitectura seleccionada: **C — híbrido, en dos pasos**

**C1 (Fase 2, sin DB):** un contrato tipado `SubindustryPrecisionRuleSet` + un evaluador
genérico que sustituye las 6 tablas hardcodeadas por un **registro inyectable** de rule-sets.
Los 2 rule-sets actuales se portan **1:1 como datos** y se valida contra baseline: los 100
casos de `apollo-subindustry-precision.test.ts` +
`agent1-subindustry-fail-closed-target-integrity-1.test.ts` deben dar veredicto, familia,
confianza, fuente, evidencia y `verdictReason` **idénticos**. Las 8–12 subindustrias de la
Ola 1 se añaden como datos nuevos, sin lógica nueva.

**C2 (fase posterior, sólo si C1 demuestra el contrato):** el mismo rule-set pasa a vivir en
`subindustry_rules.configuration` con `execution_layer = 'code'`, leído por un loader
hermano del de términos, con la misma disciplina de coherencia de versión.

**Por qué C y no B directo:** hoy no existe **ningún** escritor de catálogo en `src/`
(`subindustry_rules` tiene 364 filas y **cero** consumidores de aplicación); mover la
precisión a la DB antes de que el contrato esté probado significaría diseñar a la vez el
contrato, el workflow de publicación, el rollback y el gate de coherencia — y la precisión
es la propiedad que decide si un candidato **cuenta y se paga**.

**Por qué C2 es viable sin DDL** — verificado en Prod, no supuesto:

```
rules_execution_layer_valid  CHECK (execution_layer IN ('model','code','combined'))
rules_type_valid             CHECK (rule_type IN ('inclusion','exclusion','fit_signal',
                                     'evidence_requirement','search_strategy','quality_gate'))
rules_priority_valid         CHECK (priority IN ('blocking','high','normal','low'))
rules_configuration_is_object CHECK (jsonb_typeof(configuration) = 'object')
rules_key_per_subindustry    UNIQUE (subindustry_id, rule_key)
active_subindustry_rules     expone catalog_version_id · GRANT SELECT a authenticated y service_role
```

`execution_layer='code'` y `configuration` jsonb **ya están admitidos**. C2 no necesita
migración de esquema: necesita datos, un loader y un gate. El precio honesto: el único CHECK
sobre `configuration` es «es un objeto», así que la validación del payload debe ser **código
fail-closed** (parseo tipado; payload inválido ⇒ `unmapped`, nunca `confirmed`).

---

## 7 · Contrato de evidencia (diseño, NO implementado)

```ts
type SubindustryPrecisionRuleSet = {
  ruleSetKey: string;                  // estable, versionable (p.ej. 'banca-tradicional/v1')
  canonicalSubindustry: string;        // nombre canónico EXACTO del catálogo publicado
  matchKeys: string[];                 // claves de emparejamiento por IGUALDAD normalizada
                                       // o secuencia de ≥2 tokens. NUNCA inclusión bidireccional.
  families?: Record<string, string>;   // término → familia, para etiquetas COMPUESTAS
  positiveSignals: string[];           // anclas: nombran la operación por sí solas
  negativeSignals: {
    exclusive: string[];               // modelo de negocio incompatible ⇒ rejected
    conflicting: string[];             // coexiste pero no demuestra ⇒ ambiguous con ancla
  };
  providerIndustryMatches: string[];   // valores de industria que CONFIRMAN
  providerIndustryExclusions: string[];// valores de industria que CONTRADICEN ⇒ rejected
  broadIndustryTerms: string[];        // contienen sin demostrar ⇒ techo `ambiguous`
  requiredAny?: string[][];            // al menos un término de cada grupo
  requiredAll?: string[];              // todos obligatorios (usar con extrema parquedad)
  conflictPolicy: 'any_of_requested' | 'best_match' | 'exclusive';
  minimumEvidenceStrength: number;     // umbral sobre SOURCE_AUTHORITY (defecto: 65)
  rejectionMode: 'enforce' | 'confirm_only'; // ver § 17
};
```

### Semántica exacta de los cuatro estados

| Estado | Condición | Cuenta hacia target | Se persiste | `verdictReason` |
|---|---|:--:|:--:|---|
| **CONFIRMED** | ≥1 ancla en campo clasificador (o nombre comercial con regla estricta), autoridad ≥ `minimumEvidenceStrength`, sin industria contradictoria, sin modelo excluyente, `requiredAny`/`requiredAll` satisfechos | ✅ | ✅ `complete_valid` si el resto del contrato pasa | `anchor_evidence_confirmed` |
| **AMBIGUOUS** | ancla + modelo en conflicto · sólo industria amplia · sin evidencia · payload de regla inválido | ❌ | ✅ `needs_review` | `conflicting_business_model_with_anchor` · `broad_industry_only` · `no_subindustry_evidence` |
| **REJECTED** | industria declarada en `providerIndustryExclusions` · modelo excluyente · modelo en conflicto **sin** ancla | ❌ | ❌ (no se persiste) | `declared_industry_contradicts` · `excluded_business_model` |
| **UNAVAILABLE / UNMAPPED** | no hay rule-set publicado · versión incoherente · precisión no calculada (otro proveedor) | ❌ | ✅ `needs_review` | `subindustry_not_mapped` → `'unmapped'` · `'evaluation_unavailable'` |

Invariantes que **no** se negocian (ya vigentes, deben sobrevivir literalmente):

```
unmapped               ≠ rejected
ambiguous              ≠ confirmed
parent sector match    ≠ child subindustry confirmed
industryMatch:'confirmed' NUNCA convierte un subindustryMatch ambiguo/unmapped en confirmado
classificationSource:'none' ⇒ confirmed imposible
```

---

## 8 · Multi-subindustry ANY-OF

El contrato vigente ya es el correcto y el diseño lo **preserva sin cambios**:

```
requested = [A, B, C]
A confirmed  ∨ B confirmed ∨ C confirmed                  ⇒ CUENTA (gana el ANY-OF)
A ambiguous + B rejected + C unmapped                     ⇒ NO cuenta (ambiguous)
A rejected  + B confirmed                                 ⇒ CUENTA por B
A confirmed(mapped) + B unmapped                          ⇒ CUENTA por A
todas rejected                                            ⇒ rejected (no se persiste)
```

Precedencia `confirmed(3) > ambiguous(2) > rejected(1)`, desempate `+1` por
`subindustryMapped`, y sustitución **sólo con score estrictamente mayor** ⇒ el orden de la
solicitud no puede cambiar el desenlace. Además `resolveCandidateSubindustryRequirement`
exige que la etiqueta que confirmó pertenezca al conjunto **pedido** (red anti-descableado).

**Tests de invariancia de orden a diseñar:** para cada rule-set nuevo, generar las
permutaciones de `[nuevo, Supermercados, Tiendas]` (6) y de un conjunto de 5 selecciones
(120, o muestra determinista sin `Math.random`) y afirmar igualdad de
`subindustryMatch`, `matchedRequestedSubindustry`, `subindustryMatchFamily`,
`subindustryConfidence`, `classificationSource` y **el conjunto** de
`perRequestedSubindustryEvaluations`.

---

## 9 · Conflictos entre subindustrias

El catálogo **no** es mutuamente excluyente, y el diseño no debe forzarlo. Casos reales del
propio catálogo: `Fabricantes de Alimentos (FMCG)` vs `Supermercados`, `Farmacias Cadena` vs
`Laboratorios Farmacéuticos`, `Formación Corporativa` vs `Edtech: Plataformas`,
`Healthtech B2B` vs `Dispositivos Médicos`, `Legaltech` vs `Servicios Legales`.

**Activo latente descubierto:** 118 reglas `exclusion` activas; **35** llevan un destino
explícito («→ fabricantes-alimentos-bebidas»), y **18** de esos destinos resuelven a un
`subindustries.slug` real. Son 18 aristas dirigidas de conflicto ya escritas por el negocio
—no hay que inventarlas—; las 17 restantes son prosa («Servicios Financieros»,
«Consultoría o Tecnología») y **no** son utilizables como arista determinista.

### Política propuesta

| Pregunta | Decisión | Por qué |
|---|---|---|
| `multi_match_allowed?` | **Sí** | una cadena de farmacias es a la vez retail de salud; negarlo inventaría exclusividad que el catálogo no declara |
| `best_match?` | **No** para decidir el conteo | elegir «la mejor» exige un score sin calibrar (alternativa E); el ANY-OF ya responde la pregunta que importa |
| `requested_any_match?` | **Sí**, es la política vigente | preserva #241/#251 |
| `conflict_ambiguous?` | **Sí, sólo entre hermanas con arista** | si el candidato confirma A y una arista `A → B` está activa **y** B confirma con autoridad estrictamente mayor, A baja a `ambiguous` (nunca a `rejected`), y se registra `conflicting_sibling` en `disqualifyingSignals` |
| ¿arista de prosa? | **Se ignora** | 17 destinos no resolubles; usarlos sería adivinar |

Una arista **nunca** convierte un `confirmed` en `rejected`: degradar a `ambiguous` conserva
la persistencia como `needs_review` y deja la decisión a una persona.

---

## 10 · Priorización de la expansión

### Método de scoring (0–12, criterios declarados)

| Criterio | Peso | Fuente del dato |
|---|--:|---|
`DEM` demanda observada | 0–3 | `provider_usage_logs` (§ 9 del SQL): menciones directas y demanda de la industria padre |
`ANC` ancla léxica disponible que sobreviva el matcher por token | 0–3 | `subindustry_aliases` + nombre canónico, revisados a mano |
`PIV` valor de industria de proveedor plausible/observado | 0–2 | 10 etiquetas observadas en Prod + valores ya nombrados en los catálogos de código |
`FPR` riesgo de falso positivo **invertido** (3 = riesgo bajo) | 0–3 | solapamiento con hermanas y con términos genéricos |
`CNF` arista de conflicto ya declarada y resoluble | 0–1 | § 7 del SQL (18 aristas) |

### WAVE 1 — 10 subindustrias

| # | Subindustria | DEM | ANC | PIV | FPR | CNF | **Σ** | Razón / anclas candidatas |
|--:|---|--:|--:|--:|--:|--:|--:|---|
| 1 | **Formación Corporativa y Corporate Training** | 3 | 2 | 2 | 2 | 1 | **10** | **13 búsquedas reales**, la más pedida sin mapping. `professional training & coaching` **observado en Prod**. 3 alias exactos (`corporate training`, `capacitación empresarial`, `formación in-company`). Arista `→ edtech-plataformas` resuelve. ⚠️ Nota comercial: el propio catálogo la marca «competencia o referente de UBITS» — decisión de la dueña, no del diseño |
| 2 | **Banca Tradicional** | 1 | 3 | 2 | 3 | 1 | **10** | `banking` **observado en Prod**; alias `banco`/`bank`/`entidad bancaria` inequívocos; el código ya trata `banking` como contradictorio para retail (vocabulario reutilizable); 2 aristas entrantes resueltas |
| 3 | **Farmacias Cadena y Retail de Salud** | 1 | 3 | 2 | 2 | 1 | **9** | anclas fuertes (`farmacia`, `droguería`, `cadena de farmacias`); arista `→ laboratorios-farmaceuticos` resuelve; industria Retail con 24 búsquedas |
| 4 | **Medicina Prepagada y EPS** | 2 | 3 | 1 | 2 | 1 | **9** | 5 alias, los más específicos del catálogo (`EPS`, `ISAPRE`, `plano de saúde`); 1 mención directa; arista `→ seguros-vida-personas` resuelve |
| 5 | **Universidades e Institutos Privados** | 2 | 3 | 2 | 2 | 0 | **9** | Educación = 34 búsquedas (la industria más pedida); `higher education` es valor estándar de Apollo; ya trae `exclusion_term` «universidad pública estatal» |
| 6 | **Ciberseguridad** | 0 | 3 | 2 | 3 | 0 | **8** | 4 alias inequívocos; vocabulario de proveedor muy distintivo; solapamiento bajo con las otras 19 de Tecnología |
| 7 | **Redes Hospitalarias y Clínicas** | 1 | 3 | 2 | 2 | 0 | **8** | anclas `hospital`/`clínica`/`red hospitalaria`; `hospital & health care` ya nombrado en el código; 2 `exclusion_term` propios |
| 8 | **Laboratorios Clínicos y Diagnóstico** | 2 | 3 | 1 | 2 | 0 | **8** | 1 mención directa; ancla `laboratorio clínico` separable de `laboratorio farmacéutico` (que ya declara la exclusión inversa) |
| 9 | **Fabricantes de Alimentos y Bebidas (FMCG)** | 1 | 2 | 2 | 2 | 1 | **8** | **cierra un par de conflicto ya activo**: es el negativo que hoy usan las dos subindustrias mapeadas; `food production` ya está en el vocabulario del código |
| 10 | **Escuelas de Negocios y Formación Ejecutiva** | 2 | 2 | 2 | 2 | 0 | **8** | industria con más demanda; anclas `escuela de negocios`/`business school`; arista `→ universidades-institutos-privados` resuelve |

Σ Ola 1 ⇒ `PRECISION_MAPPED` pasaría de **2/73 (2.74 %)** a **12/73 (16.44 %)**, cubriendo
las **3 subindustrias con demanda directa observada** que hoy están sin mapear.

### WAVE 2 — 14 subindustrias

Seguros Generales · Brokers e Intermediarios de Seguros · BPO y Contact Center ·
Staffing y Servicios Temporales · Operadores Logísticos 3PL y 4PL ·
Freight Forwarders y Agencias de Aduana · Transporte de Carga Terrestre ·
Software Empresarial (SaaS/ERP/CRM) · Edtech: Plataformas de Aprendizaje ·
Institutos Técnicos y Vocacionales · Laboratorios Farmacéuticos ·
Distribuidores Farmacéuticos · Construcción e Infraestructura ·
Energía, Minería y Servicios Industriales.

Perfil: ancla clara (Σ 6–8) pero sin demanda observada, o con una hermana de la Ola 1 cuya
arista conviene fijar en la misma pasada (Edtech ↔ Formación Corporativa;
Laboratorios/Distribuidores Farmacéuticos ↔ Farmacias).
⇒ acumulado **26/73 (35.62 %)**.

### LONG TAIL — 47 subindustrias

Las difíciles, y el motivo por el que son difíciles:

- **Etiquetas compuestas o genéricas por diseño**: Retailers Especializados, Operadores
  Omnicanal y Ecommerce Retail, Cuidado Personal Higiene y Hogar, Manufactura Exportadora y
  Zona Franca, Bienes de Capital y Maquinaria, Grupos Educativos Multi-sede — no hay ancla
  léxica que las nombre sin nombrar también a sus hermanas.
- **Definidas por atributo, no por operación**: Universidades Públicas con Capacidad de
  Compra, Manufactura Exportadora, Logística para Minería y Energía — la evidencia que las
  distingue (capacidad de compra, zona franca, cliente final) **no existe** en ningún campo
  de Apollo.
- **14 subindustrias de Tecnología con solapamiento mutuo alto** (Martech, IoT, QA/RPA,
  Govtech, Proptech, Insurtech, Legaltech, Healthtech, Data/BI, IA/ML, Cloud/DevOps,
  Fintech Infraestructura, Software Factory, Ecommerce Enablement): Apollo declara a casi
  todas como `information technology & services` o `computer software`, así que la
  separación exigiría descripciones, que es la fuente de menor autoridad.

Recomendación para la cola larga: **no forzar mapping**. `unmapped` es un estado correcto y
fail-closed; convertirlas en «cubiertas» con reglas débiles es el único camino garantizado
hacia falsos positivos que cuentan hacia el objetivo.

---

## 11 · Auditoría de vocabulario de proveedor

Sin llamadas nuevas. Fuentes usadas: `provider_industry_raw_label_observations` (Prod),
metadata persistida, catálogos declarados en código, migración 084.

**Observado realmente en Prod** — 10 etiquetas, 13 observaciones, **todas** de
`organization_enrichment`, ninguna de `organizations_search`:

| raw_provider_value | normalized_value | candidate_subindustries_possible |
|---|---|---|
| `banking` | `banking` | Banca Tradicional · (contradictorio para todo retail) |
| `financial services` | `financial services` | Banca · Fintech B2B · Factoring · Fondos (**demasiado amplio para confirmar**) |
| `retail` | `retail` | las 7 de Retail y Consumo (**broad, nunca confirma** — ya codificado) |
| `capital markets` | `capital markets` | Fondos de Inversión y Gestión de Activos |
| `investment banking` | `investment banking` | Banca · Fondos |
| `investment management` | `investment management` | Fondos de Inversión |
| `accounting` | `accounting` | Auditoría, Contabilidad y Advisory |
| `management consulting` | `management consulting` | Consultoría de Estrategia y Gestión |
| `professional training & coaching` | `professional training coaching` | **Formación Corporativa** · Escuelas de Negocios · Certificación B2B |
| `oil & energy` | `oil energy` | Energía, Minería y Servicios Industriales |

**Declarado en código** (repo, no observado en vivo) y por tanto ya disponible como
vocabulario de partida: `food production`, `food manufacturing`, `food and beverages`,
`beverage manufacturing`, `insurance`, `software`, `saas`, `information technology`,
`consulting`, `mining & metals`, `construction`, `real estate`,
`hospital & health care`, `pharmaceuticals`, `agriculture`, `farming`, `wholesale`,
`consumer goods`, `consumer services`, `marketplace`, `supermarket`, `hypermarket`,
`grocery store`, `retail banking`, `commercial banking`, `credit institution`.

**Estado del substrato de normalización:** `provider_industry_mapping_snapshots` = 0,
`_concept_entries` = 0, `_mapping_associations` = 0. Sólo existe la identidad de vocabulario
(`apollo_organization_industry`, 1 fila, migración 084); el DRAFT fue borrado por 085.
⇒ **No hay normalización provider→industria publicada, y la que se diseñó es a nivel
industria, no subindustria.** La alternativa D no está disponible hoy sin activar un
workflow completo.

**Conclusión honesta:** el inventario de vocabulario observado es **insuficiente** para
declarar «provider vocabulary covered» por subindustria. Por eso la Definition of Done del
§ 13 exige fixtures de vocabulario **declarado y revisado**, no «observado en Prod», y
registra la deuda como riesgo explícito de deriva.

---

## 12 · Precision vs recall

**Se optimiza precisión, no cobertura.** Un falso positivo que cuenta hacia el objetivo
gasta crédito, contamina el objetivo y engaña a la dueña; un `needs_review` sólo cuesta una
revisión. Esa asimetría es la que ya está codificada y no se cambia.

Métricas propuestas (todas derivables de la metadata ya persistida — `subindustry_precision`
lleva `subindustry_match`, `verdict_reason`, `classification_source`, `subindustry_evidence`,
`per_requested_subindustry_evaluations`):

| Métrica | Definición | Objetivo |
|---|---|---|
`precision_confirmed` | confirmados / evaluados con rule-set | observar, no fijar |
`false_confirm_rate` | confirmados que la revisión humana marca como no pertenecientes / confirmados | **0 %** en Ola 1; >0 bloquea la ola siguiente |
`ambiguous_rate` | ambiguos / evaluados | aceptable alto |
`unmapped_rate` | unmapped / pedidos | debe bajar exactamente con las olas |
`review_rate` | `review_only_candidates / persisted_candidates` | observar |
`complete_valid_rate` | `complete_valid_candidates / persisted_candidates` | observar |
`rejection_rate` | rechazados / evaluados | **vigilar**: subida brusca ⇒ negativo demasiado ancho |
`evidence_source_mix` | distribución de `classification_source` en confirmados | alerta si `commercial_name` domina |

**Una subindustria NO se declara cubierta porque exista una regla.** `precision_mapped` es
una propiedad de esquema; `PRECISION_READY` (§ 13) es la única que autoriza contar.

---

## 13 · Definition of Done por subindustria

`PRECISION_READY(subindustry)` es **verdadero sólo si las 12 condiciones se cumplen**:

1. **Rule-set publicado** con `matchKeys` que emparejan por igualdad normalizada o secuencia
   de ≥2 tokens (nunca inclusión bidireccional), y que **no** empareja ninguna de las otras
   72 etiquetas del catálogo (test contra `SELLUP_ACTIVE_SUBINDUSTRY_NAMES`, 73 nombres).
2. **≥3 fixtures positivos**, cada uno con la ancla en un campo clasificador **distinto**
   (industria de proveedor, keywords, descripción) y ≥1 por nombre comercial.
3. **≥3 fixtures negativos hermanos**: una empresa de la subindustria hermana más cercana no
   confirma. Si existe arista de conflicto resoluble, la hermana de la arista es obligatoria.
4. **≥1 fixture «sólo padre»**: industria amplia del sector padre ⇒ `ambiguous`, jamás
   `confirmed` (`broad_industry_only`).
5. **≥1 fixture de conflicto** con evidencia mixta ⇒ `ambiguous` con
   `conflicting_business_model_with_anchor`.
6. **≥1 fixture de industria contradictoria** ⇒ `rejected` con
   `declared_industry_contradicts`.
7. **Vocabulario de proveedor declarado y revisado**: `providerIndustryMatches` y
   `providerIndustryExclusions` explícitos, con los valores observados en Prod que apliquen,
   y **ningún** valor amplio (`retail`, `financial services`, `information technology`) en
   `Matches`.
8. **Invariancia de orden** demostrada (§ 8) sobre las permutaciones con las subindustrias ya
   mapeadas.
9. **`ambiguous` no cuenta · `unmapped` no cuenta · padre no confirma hija**: aserciones
   explícitas por subindustria sobre `evaluateCandidateSubindustryTargetEligibility`, no sólo
   sobre el evaluador.
10. **Adversarial substring**: para cada ancla, ≥1 cadena donde aparezca como substring
    dentro de otra palabra (con y sin tildes) y **no** confirme.
11. **Suite CI obligatoria** verde, incluidas las 8 suites hermanas con guardas RATCHET y los
    fixtures de catálogo congelados; `npm run lint`, `npm run typecheck`, `npm run build`.
12. **Cero regresión de esquema/CHECK**: 0 migraciones nuevas, `record_origin` y
    `prospect_candidates_classification_source_check` (mig 093) intactos, vocabulario de
    `SubindustryClassificationSource` sin valores nuevos sin CHECK que los admita.

Una subindustria que cumple 1 pero no 2–12 se declara **`MAPPED_NOT_READY`** y su rule-set se
publica con `rejectionMode: 'confirm_only'` (§ 17) o no se publica. Nunca cuenta hacia el
objetivo por el hecho de existir.

---

## 14 · Data model propuesto (NO aplicado)

**C1 — repo (Fase 2, 0 migraciones):** módulo nuevo
`apollo-subindustry-precision-rule-sets.ts` que exporta un `readonly` array de
`SubindustryPrecisionRuleSet` (§ 7) y un `resolvePrecisionRuleSet(label)`.
`apollo-subindustry-precision.ts` conserva su API pública exacta
(`assessApolloSubindustryPrecisionForRequest`, `assessApolloSubindustryPrecision`,
`normalizeRequestedSubindustries`, `matchesCatalogTerm`,
`toApolloSubindustryPrecisionMetadata`, `APOLLO_SUBINDUSTRY_PRECISION_METADATA_KEY`) y pasa a
leer el registro en lugar de las 6 tablas. **Ningún consumidor cambia.**

**C2 — catálogo (fase posterior, 0 DDL):** una fila por rule-set en `subindustry_rules`:

| Columna | Valor |
|---|---|
`subindustry_id` | FK a la subindustria **de la versión publicada** (aporta el `catalog_version_id`) |
`rule_key` | `PRECISION_RULE_SET_V1` (único por subindustria, ya garantizado por `rules_key_per_subindustry`) |
`rule_type` | `evidence_requirement` (ya admitido por `rules_type_valid`) |
`execution_layer` | `code` (ya admitido por `rules_execution_layer_valid`) |
`priority` | `blocking` (ya admitido) |
`rule_text` | descripción legible de la política (obligatorio, `<> ''`) |
`configuration` | **el rule-set completo del § 7 como jsonb** (`rules_configuration_is_object` ya lo exige objeto) |
`source_document` / `source_section` | trazabilidad al documento que lo autorizó |
`active` / `sort_order` | control de activación |

Lectura: `active_subindustry_rules` (ya expone `catalog_version_id`, ya tiene
`GRANT SELECT` a `authenticated` y `service_role`), filtrando
`execution_layer='code' AND rule_type='evidence_requirement' AND active`.

| Aspecto | Resolución |
|---|---|
`migration required` | **Ninguna para el esquema.** Los datos entran por seed/publicación, no por DDL |
`RLS / service_role` | RLS ENABLED con **sólo** policy de SELECT ⇒ `anon`/`authenticated` no pueden escribir. Pero la tabla base arrastra los *default privileges* de Supabase (ALL para `anon` y `authenticated`) y `service_role` tiene DML + bypass RLS. **Misma clase que 4H/4I.** Antes de C2: revocar los grants heredados y encauzar la escritura por una RPC estrecha, como hicieron 082/083/085 con los snapshots de provider-industry |
`publication workflow` | **Decisión abierta y material.** Insertar filas en la versión `1.0.0` publicada cambia el comportamiento **sin** cambiar la versión, y el gate del § 15 no lo detectaría. La opción correcta es publicar `1.1.0`; su coste (clonar 73 + 228 + 364 + 127 filas y mover la versión que el wizard resuelve) hay que medirlo en Fase 2 antes de comprometerse. **C1 evita esta decisión por completo** |
`rollback` | C1: revert del PR. C2: republicar la versión anterior + `active=false` en las filas nuevas |
`version mismatch guard` | § 15 |

---

## 15 · Coherencia de versión en runtime

Principio de #246 que se preserva: **selección del wizard, términos de búsqueda y reglas de
precisión deben pertenecer a la MISMA versión publicada.**

El gate ya existe y es extensible, no hay que inventarlo:
`evaluateApolloCatalogVersionCoherence` compara `selectionCatalogVersion` con
`resolution.catalogVersion` y bloquea con
`APOLLO_CATALOG_VERSION_COHERENCE_BLOCK_REASON` antes de gastar
(`terms_resolution_missing`, `selection_version_missing`, `version_mismatch`).

Extensión propuesta:

```
input.precisionRuleSetCatalogVersion?: string | null
input.precisionRuleSetCatalogVersionId?: string | null

nuevas razones:
  'precision_rules_missing'          reglas no resueltas y sí se pidió subindustria
  'precision_version_mismatch'       la versión de las reglas ≠ la de la selección
```

Reglas de comportamiento:

- **C1 (reglas code-owned):** el rule-set no tiene versión de catálogo. La invariante se
  cumple por construcción y el gate no cambia; el `ruleSetKey` viaja a la metadata para que
  una corrida sea reproducible. Se documenta como decisión, no se finge una versión.
- **C2 (reglas en catálogo):** igualdad de **`catalog_version_id`** (no sólo del string de
  versión) entre las tres lecturas. Desigualdad ⇒ bloqueo pre-gasto, cero llamadas al
  proveedor, cero filas económicas.
- **Sin fallback silencioso:** si la resolución de reglas falla, el resultado es
  `unmapped`/bloqueo — **nunca** caer a un snapshot viejo ni a la industria padre.
- Ausencia = incoherencia, no permiso (misma disciplina que el gate actual). Única excepción:
  solicitud sin subindustrias.

---

## 16 · Estrategia de test

Suite nueva `agent1-subindustry-precision-coverage-1.test.ts` (+ extensión de las 2 suites
existentes), con estos grupos obligatorios:

| Grupo | Qué afirma |
|---|---|
`parity` | los 2 rule-sets portados producen resultados **idénticos** a los 100 casos actuales (baseline byte a byte del assessment) |
`positive exact` | ancla literal en industria de proveedor ⇒ `confirmed`, `classificationSource='provider_industry'` |
`positive alias` | alias del rule-set en keywords ⇒ `confirmed` con autoridad 80 |
`positive provider-industry` | valor de `providerIndustryMatches` ⇒ `confirmed` |
`negative sibling` | hermana más cercana ⇒ nunca `confirmed` |
`negative parent-only` | sólo industria del sector padre ⇒ `ambiguous`, `broad_industry_only` |
`ambiguous mixed` | ancla + modelo en conflicto ⇒ `ambiguous` |
`rejected` | industria contradictoria y modelo excluyente ⇒ `rejected` |
`unmapped` | etiqueta sin rule-set ⇒ `unmapped`, `countsTowardTarget=false` |
`missing evidence` | metadata vacía ⇒ `no_subindustry_evidence`, nunca `confirmed` |
`multi-request ANY-OF` | los 5 casos del § 8 |
`order invariance` | permutaciones ⇒ mismo veredicto, familia, confianza y fuente |
`version mismatch` | versión incoherente ⇒ bloqueo pre-gasto y `unmapped` |
`catalog missing` | catálogo vacío / `no_connected_terms` ⇒ bloqueo, 0 créditos |
`provider vocabulary unknown` | etiqueta de industria desconocida ⇒ no confirma ni rechaza |
`unicode / accent` | `Ciberseguridad`≡`ciberseguridad`, `formación`≡`formacion` |
`generic substring` | para cada ancla, ≥1 cadena adversarial que **no** confirma |
`rule payload inválido` | payload que no parsea ⇒ `unmapped` (fail-closed), nunca excepción |
`matchKey collision` | ningún `matchKey` empareja otra de las 73 etiquetas |
`target integrity` | `evaluateCandidateSubindustryTargetEligibility`: sólo `confirmed` cuenta |

Las suites que dependen de la forma del assessment y que hay que ejecutar sin regresión:
`apollo-subindustry-precision`, `agent1-subindustry-fail-closed-target-integrity-1`,
`agent1-multi-subindustry-query-drafting-anyof-1`,
`agent1-multi-subindustry-catalog-coverage-addendum-1`,
`agent1-catalog-source-of-truth-addendum-1`, `precision-gate`,
`apollo-two-round-finalization-hardening-1`, `apollo-writer-only-admission-pending`,
`apollo-stable-target-writer-parity`, `candidate-subindustry-status-display`.

No se implementa la suite completa en esta fase: depende del contrato del § 7, que aún no
está aprobado.

---

## 17 · Impacto en Apollo

**No cambia** (verificado como invariantes a preservar): search caps 2 · results per round 10 ·
raw max 20 · enrichments max 5 · créditos max 25 · semántica de target estable ·
writer-only admission · cupo COMPLETE-FIRST · `record_origin` · review queue ·
`linkedin_url` · `employee_count` · reconciliación final.
La precisión es una **capa separada**: entra por `assessApolloSubindustryPrecisionForRequest`
y sale por `subindustryMatch`.

**Sí cambia, y hay que decirlo con claridad:** para una subindustria **recién mapeada**, el
comportamiento no puede ser neutro — es justamente el objetivo. El mecanismo es
`foldSubindustryPrecisionIntoSectorState`, que hoy devuelve `base` sin tocar cuando
`!subindustryMapped`:

| Situación nueva | Efecto |
|---|---|
`rejected` | `sector_evidence_contradictory` ⇒ el candidato **deja de persistirse** (hoy persistía como `needs_review`) |
`ambiguous` sobre base `sector_evidence_confirmed` | `sector_evidence_missing_needs_enrichment` ⇒ el candidato **entra a competir por uno de los 5 enrichments** que antes no pedía |
`confirmed` | puede pasar a `complete_valid` ⇒ mueve `target_count` y el cupo COMPLETE-FIRST |

Es decir: **los topes de gasto no se mueven, pero la asignación de los 5 enrichments y el
conjunto de filas persistidas sí.** Es un cambio de comportamiento legítimo y esperado, no un
efecto colateral oculto.

**Mitigación propuesta para la primera corrida de cada subindustria nueva:**
`rejectionMode: 'confirm_only'` — los negativos degradan a `ambiguous` en lugar de
`rejected`, así la primera ventana de observación **nunca suprime persistencia** y toda la
evidencia queda en `needs_review` para calibrar. Se promueve a `'enforce'` cuando
`false_confirm_rate = 0` y hay fixtures suficientes.

Neutralidad garantizada donde importa: búsquedas **sin** subindustria y las **71**
subindustrias que sigan sin rule-set no cambian en absoluto.

---

## 18 · Impacto en Tavily / Lusha

| Proveedor | Evidencia clasificadora disponible | ¿Puede usar el evaluador genérico? |
|---|---|---|
**Apollo** | `industry`, `industries[]`, `keywords[]`, `organization_keywords[]`, 3 descripciones, nombre | ✅ es su caso de uso actual |
**Tavily** | ninguna: sólo `title`, `url`, `snippet`. El contexto que se le pasa lleva los nombres de subindustria, pero la respuesta es texto web. `snippet` y `url` están **excluidos** de `CLASSIFYING_FIELDS` a propósito | ⚠️ técnicamente sí, pero sólo por `commercial_name` (autoridad 65). **Hoy no se invoca**: el único consumidor de precisión es el runner de Apollo, y `resolveCandidateSubindustryRequirement` clasifica los candidatos de Tavily como `evaluation_unavailable` ⇒ no cuentan |
**Lusha** | `lusha-sector-mapping.ts` sólo traduce **sector→`mainIndustriesIds`**; `subIndustriesIds` **no está soportado**; los labels informativos «NUNCA se envían al POST». Company discovery de Lusha está fuera de la ruta viva | ❌ no hay campo de subindustria que evaluar |

**Diseño provider-agnostic recomendado, con límite declarado:** el evaluador debe recibir
`NormalizedCandidateEvidence` (`declaredIndustries[]`, `keywords[]`, `descriptions[]`,
`commercialName`, `employeeCount`) en lugar de un `WebSearchResult`, y un adaptador por
proveedor rellena lo que ese proveedor de verdad tiene. **No** se fuerza la abstracción más
allá: con Tavily, confirmar por nombre comercial suelto sería una regresión frente al gate
de industria que hoy existe, así que un adaptador Tavily debe declarar
`allowCommercialNameOnlyConfirmation: false` y quedarse en `ambiguous`.
Un evaluador compartido, tres adaptadores, un solo contrato — nunca tres evaluadores.

---

## 19 · Plan de implementación (propuesto, no ejecutado)

| Fase | Alcance | Migraciones | Gasto | Sale a Producción |
|---|---|:--:|:--:|---|
**1** (esta) | auditoría + diseño + matriz + priorización | 0 | 0 | no |
**2** | contrato § 7 + evaluador genérico + port 1:1 de los 2 rule-sets + parity test. **Cero subindustrias nuevas** | 0 | 0 | sí, comportamiento idéntico demostrado |
**3** | corregir `resolveSubindustryKey` (igualdad / secuencia ≥2 tokens) + test de colisión contra las 73 etiquetas | 0 | 0 | sí |
**4** | Ola 1, subindustrias 1–3 (Formación Corporativa, Banca, Farmacias) con `confirm_only` + DoD completa | 0 | 0 | sí |
**5** | extender el gate de coherencia de versión (§ 15) + `ruleSetKey` en metadata | 0 | 0 | sí |
**6** | Ola 1, subindustrias 4–10 con `confirm_only` + DoD | 0 | 0 | sí |
**7** | promoción a `enforce` por subindustria, sujeta a `false_confirm_rate = 0` en la ventana de observación | 0 | 0 | sí |
**8** | política de conflicto entre hermanas (18 aristas resolubles) | 0 | 0 | sí |
**9** | Ola 2 (14) | 0 | 0 | sí |
**10** (opcional) | C2: rule-sets a `subindustry_rules` + endurecer grants + workflow de publicación/rollback | 0 DDL, sí datos | 0 | decisión aparte |

Cada fase = un PR, un contrato, su propia auditoría adversarial. Ninguna fase ejecuta
proveedores ni toca presupuesto; la validación de gasto real sigue siendo QA en vivo con
autorización explícita de la dueña.

---

## Risk register

| Riesgo | Severidad | Evidencia | Mitigación diseñada |
|---|---|---|---|
**Falso positivo que cuenta hacia el objetivo** | CRÍTICO | es el defecto histórico de HARDENING-1 § 3 y de la corrida `8c86eb06` | anclas revisadas a mano; matcher por token; DoD § 13 con fixtures negativos obligatorios; `confirm_only` en la primera ventana; `false_confirm_rate = 0` como puerta de la ola siguiente |
**Falso negativo (recall)** | MEDIO | promover frases de catálogo daría ~0 confirmaciones | `ambiguous` persiste como `needs_review`; se mide `unmapped_rate` y `ambiguous_rate` por ola |
**Promoción automática de discovery a precisión** | ALTO | § 5: los 107 `keyword` son frases; partirlos en tokens genera `retail`/`LATAM`/`empresa` como anclas | prohibición explícita en el contrato: la promoción es autoría con fixtures, jamás automática |
**Colisión de `matchKeys`** | ALTO | `resolveSubindustryKey` usa inclusión bidireccional; inocuo con 2 claves, peligroso con 12 | Fase 3 antes de la Ola 1; test de colisión contra las 73 etiquetas |
**Catalog drift** (catálogo cambia sin despliegue) | ALTO | `active_industry_catalog` se lee en vivo; sólo existe la versión `1.0.0` y toda edición sería in situ | gate de coherencia extendido (§ 15); C2 exige nueva versión publicada; fixtures del repo describen `1.0.0` y nada más |
**Deriva de vocabulario de proveedor** | MEDIO-ALTO | sólo **10** etiquetas observadas, y **ninguna** de `organizations_search` | `providerIndustryMatches` declarado y revisado, nunca inferido; valor desconocido ⇒ no confirma ni rechaza; observaciones siguen capturándose |
**Multi-match entre hermanas** | MEDIO | catálogo no excluyente; 18 aristas declaradas, 17 en prosa | degradar a `ambiguous`, nunca a `rejected`; aristas de prosa se ignoran |
**Keywords genéricos** | ALTO | `retail`/`grocery`/`moda` ya causaron falsos positivos | listas `broadIndustryTerms` con techo `ambiguous`; ancla de una sola palabra sólo si es unívoca (`EPS`, `3PL`) |
**Cambio de asignación de enrichments** | MEDIO | `foldSubindustryPrecisionIntoSectorState` § 17 | `confirm_only` en la primera corrida; métricas antes/después por subindustria; caps intactos |
**Grants heredados en `subindustry_rules`** | MEDIO (hoy 0 explotable) | ALL para `anon`/`authenticated` por default privileges; RLS sólo con policy de SELECT; `service_role` con DML + bypass | pre-requisito de C2: revocar y encauzar por RPC estrecha (patrón 082/083/085) |
**Guardas RATCHET y fixtures congelados** | BAJO-MEDIO | `060` asertó 364 filas en `active_subindustry_rules`; fixtures del repo congelan 73/107 | Fase 2 actualiza fixtures en el mismo PR; la aserción de 060 ya se ejecutó y no se re-dispara |

---

## Contratos que esta fase NO toca

| PR | Contrato | Estado |
|---|---|---|
**#262** | precedencia de `record_origin`, no-ejecutado ⇒ `unknown` | intacto |
**#256** | `record_origin` declarado por el clasificador canónico | intacto |
**#251** | `evaluateCandidateTargetEligibility` tri-estado, `pending` nunca cuenta, cupo COMPLETE-FIRST | intacto |
**#246** | round-robin multi-subindustria, fail-closed pre-gasto, coherencia de versión | intacto y **extendido** en § 15 |
**#245** | multiselección del wizard | intacto |
**#241** | ANY-OF en los 5 consumidores de admisión/gasto, cap 5/25 | intacto |
**#238** | `prospect_candidates_classification_source_check` (mig 093) | intacto, 0 valores nuevos |
**#234** | `linkedin_url` / `employee_count` capturados (mig 108) | intacto; `employee_count` sólo se propone como refuerzo opcional, nunca como señal positiva |
