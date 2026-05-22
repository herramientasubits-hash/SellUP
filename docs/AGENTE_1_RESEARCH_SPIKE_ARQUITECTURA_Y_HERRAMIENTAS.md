# Agente 1 — Research Spike: Arquitectura Profesional y Herramientas

**Versión:** 1.0  
**Fecha:** 2026-05-22  
**Estado:** Research Spike — sin código, sin migraciones, sin APIs reales llamadas  
**Autor:** SellUp Principal AI Architect · Agentic Workflow Engineer · Cost Optimization Analyst · Product Architect · Technical Researcher  
**Documentos base consultados:**
- `docs/prompts/AGENTE_1_GENERACION_EMPRESAS_CANDIDATAS_PROMPT_V2.md`
- `docs/prompts/AGENTE_1_PROMPT_LAB_RESULTADOS_V2.md`
- `docs/AGENTE_1_ARQUITECTURA_PROFESIONAL_POR_HERRAMIENTAS.md`
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md`
- `docs/AGENTE_1_GENERACION_ENRIQUECIMIENTO_PROSPECTOS.md`
- `docs/USO_COSTOS_EFECTIVIDAD_AGENTES_PROVEEDORES.md`
- `docs/HUBSPOT_ACCOUNT_FIELD_MAPPING.md`

---

## Tabla de contenidos

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Hallazgos del Prompt Lab V2](#2-hallazgos-del-prompt-lab-v2)
3. [Aprendizajes del gem anterior con deep research](#3-aprendizajes-del-gem-anterior-con-deep-research)
4. [Por qué no basta un prompt largo](#4-por-qué-no-basta-un-prompt-largo)
5. [Principios de arquitectura profesional](#5-principios-de-arquitectura-profesional)
6. [Arquitectura recomendada por etapas](#6-arquitectura-recomendada-por-etapas)
7. [Tool Kit del Agente 1 — `sellup_prospecting_toolkit`](#7-tool-kit-del-agente-1--sellup_prospecting_toolkit)
8. [Memoria y RAG del Agente 1](#8-memoria-y-rag-del-agente-1)
9. [Deduplicación obligatoria SellUp + HubSpot](#9-deduplicación-obligatoria-sellup--hubspot)
10. [Comparativa de herramientas web / deep research](#10-comparativa-de-herramientas-web--deep-research)
11. [Website verification](#11-website-verification)
12. [LinkedIn company finder](#12-linkedin-company-finder)
13. [Registry / tax ID verification](#13-registry--tax-id-verification)
14. [Optimización de tokens y costos](#14-optimización-de-tokens-y-costos)
15. [Modelo de scoring recomendado](#15-modelo-de-scoring-recomendado)
16. [Output recomendado](#16-output-recomendado)
17. [MVP técnico recomendado](#17-mvp-técnico-recomendado)
18. [Riesgos y límites](#18-riesgos-y-límites)
19. [Criterios de éxito](#19-criterios-de-éxito)
20. [Recomendación final](#20-recomendación-final)

---

## 1. Resumen ejecutivo

El Agente 1 de SellUp tiene una misión específica: generar lotes de empresas candidatas B2B en LatAm que el equipo comercial de UBITS pueda revisar, aprobar y convertir en prospectos reales. El Prompt Lab V2 demostró que un prompt bien diseñado puede generar hipótesis razonables con buena estructura y ángulo comercial. Pero también reveló dos límites estructurales que un prompt solo no puede resolver:

1. **No puede verificar datos duros.** Websites inferidos, LinkedIn sin confirmar, NITs ausentes, y empresas ya existentes en HubSpot llegaron al usuario como candidatos "válidos". Eso genera trabajo manual innecesario y erosiona la confianza en el agente.
2. **No puede deduplicar automáticamente.** El Prompt V2 instruía al usuario a buscar en HubSpot. Eso es un defecto de diseño: el sistema debe detectar duplicados, no el humano.

La conclusión central de este Research Spike es:

> **SellUp no debe construir un "prompt gigante". Debe construir un agente profesional con herramientas, verificación automática, deduplicación obligatoria, control de costos, trazabilidad completa y revisión humana enfocada en calidad comercial — no en detectar duplicados.**

El agente correcto opera en un pipeline tool-first por etapas:
1. El LLM genera hipótesis compactas (bajo costo).
2. Las herramientas verifican, validan y deduplicан (determinístico).
3. El scorer consolida la evidencia (reglas + IA mínima).
4. El humano decide sobre calidad comercial — no sobre datos básicos.

---

## 2. Hallazgos del Prompt Lab V2

### 2.1 Lo que funcionó

El Prompt Lab V2 representó una mejora sustancial sobre V1:

| Dimensión | Resultado en V2 |
|-----------|----------------|
| Contexto dinámico filtrado | Solo fuentes del país/sector → input reducido ~39% vs V1 |
| Campos estructurados | `manual_verification`, `commercial_relevance`, `verification_links` — accionables |
| Balance de tamaños | Evitó lotes con solo empresas famosas |
| Honestidad del agente | Dominios inferidos declarados, duplicados intra-lote detectados (Claro/Telmex) |
| Costo por candidato | ~$0.0044–$0.0050 — viable para MVP |
| Scoring híbrido | `confidence_score` + `fit_score` + `data_completeness_score` — útil como hipótesis |

El Prompt V2 es un buen cerebro de clasificación, scoring y fit comercial. Su rol en la arquitectura productiva es **generación compacta de hipótesis** — no verificación de datos duros.

### 2.2 Los límites que reveló

| Límite detectado | Evidencia | Impacto |
|-----------------|-----------|---------|
| LLM no verifica websites | 5/15 candidatos con dominio inferido | Usuario debía verificar manualmente |
| LLM no encuentra LinkedIn | 0/15 candidatos con LinkedIn confirmado | Búsqueda manual obligatoria para todos |
| LLM no verifica NITs | 0/15 candidatos con NIT confirmado | Validación fiscal completamente manual |
| LLM no deduplica HubSpot | Varias empresas ya existían en HubSpot | Usuario debía buscar en CRM manualmente |
| `manual_verification.hubspot_match` | La verificación HubSpot estaba en manos del humano | Defecto de diseño crítico |
| Output largo en informe completo | ~300 tokens/candidato con todos los campos | Ineficiente si se necesita solo generación inicial |

### 2.3 Rol correcto del Prompt V2 en producción

El Prompt V2 **no debe eliminarse** — debe dividirse y especializarse:

| Sub-rol | Descripción | Tokens objetivo |
|---------|-------------|-----------------|
| **Generación de hipótesis compactas** | Proponer candidatos con nombre, país, industria, subsector, por qué candidato, fuente sugerida | 40–60 tokens/candidato |
| **Scoring asistido** | Clasificar candidatos post-verificación con fit comercial + `why_relevant_for_ubits` + `likely_buyer_area` | 60–80 tokens/candidato |
| **Resumen comercial bajo demanda** | `sales_angle` profundo, contexto de compra, perfil del decisor — solo para aprobados | 120–200 tokens/candidato |

Lo que **nunca debe hacer el LLM** en producción:
- Ser fuente de verdad de websites o dominios
- Inventar o confirmar URLs de LinkedIn
- Confirmar NITs, RFCs, RUTs sin fuente verificada
- Determinar si una empresa ya existe en HubSpot o SellUp
- Generar análisis macroeconómico extenso por cada lote

---

## 3. Aprendizajes del gem anterior con deep research

### 3.1 Qué logró el gem con deep research

Un ejercicio previo de generación de empresas para Honduras (y otros países) usando un modelo con capacidad de deep research / web search obtuvo resultados notablemente mejores en:

- **Websites verificados:** el modelo buscó activamente y encontró URLs reales, no inferidas.
- **LinkedIn company pages:** encontró páginas reales con mayor precisión que un LLM sin búsqueda.
- **Validez de empresas:** al poder buscar señales públicas recientes, redujo la probabilidad de incluir empresas inactivas.

### 3.2 Por qué ese enfoque no escala directamente

| Problema | Detalle |
|----------|---------|
| Output demasiado largo | El gem generó informes extensos con análisis macroeconómico, contexto por país, señales macro — inapropiados para el MVP operativo de SellUp |
| Costo alto por candidato | Un modelo con capacidad de búsqueda activa por cada candidato tiene costo significativamente mayor que un LLM de generación |
| Latencia | Los workflows con deep research tienen mayor latencia que llamadas directas a APIs estructuradas |
| No es un pipeline controlado | El gem no tiene trazabilidad de herramientas, no registra costos por paso, no deduplica contra HubSpot |

### 3.3 Qué debe copiar SellUp del gem

**La capacidad de búsqueda y verificación — no el formato de informe.**

SellUp debe replicar la capacidad de búsqueda del gem mediante herramientas estructuradas (`web_search_tool`, `website_verifier`, `linkedin_company_finder`) que producen datos verificados sin generar texto largo. El análisis profundo del contexto de mercado por país/sector puede pertenecer a un futuro **Agente de Inteligencia de Cuenta** — no al Agente 1 de generación inicial.

> **Regla derivada:** El Agente 1 de generación inicial NO debe generar análisis macroeconómico por lote. Ese análisis, si se necesita, se genera bajo demanda o es responsabilidad de otro agente.

---

## 4. Por qué no basta un prompt largo

### 4.1 Comparación de enfoques

| Enfoque | Calidad de datos | Verificabilidad | Costo/candidato | Trazabilidad | Deduplicación |
|---------|:---------------:|:---------------:|:---------------:|:------------:|:-------------:|
| Prompt gigante único | Baja | Muy baja | ~$0.06–0.12 | Nula | Manual |
| Prompt V2 con contexto filtrado | Media | Media (inferida) | ~$0.005 | Baja | Manual |
| Pipeline tool-first | Alta | Alta (verificada) | ~$0.008–0.015 | Total | Automática |
| Pipeline tool-first + caching/RAG | Alta | Alta (verificada) | ~$0.004–0.010 | Total | Automática |

### 4.2 Por qué el LLM no puede ser la única fuente de verdad

1. **El LLM alucina dominios.** Sin acceso a web real, el LLM infiere dominios basándose en patrones. `heinsohn.com.co` puede ser correcto o puede ser el dominio de otra empresa completamente diferente.
2. **El LLM no tiene acceso a HubSpot.** No puede saber si una empresa ya existe en el CRM del cliente. Delegar esa verificación al humano es un defecto de diseño, no una característica.
3. **El LLM no tiene acceso a registros públicos en tiempo real.** No puede confirmar un NIT en RUES ni verificar si una empresa está activa en SUNAT.
4. **Los outputs del LLM no tienen trazabilidad de fuente determinística.** "Supersociedades SIIS" como fuente puede significar que el LLM lo conoce de entrenamiento, no que lo consultó ahora.
5. **El LLM escala el costo linealmente con el output.** Un prompt que incluye análisis comercial profundo para 25 candidatos cuesta mucho más que un pipeline donde el análisis se genera bajo demanda solo para los candidatos aprobados.

---

## 5. Principios de arquitectura profesional

Estos principios gobiernan el diseño del Agente 1 en producción:

### 5.1 Tool-first architecture

> El LLM propone. Las herramientas verifican. El scorer consolida. El humano decide.

Las herramientas son la fuente de verdad para datos verificables. El LLM aporta razonamiento sobre ambigüedad y contexto comercial — no sobre hechos verificables.

### 5.2 Pipeline por etapas con estado

El agente opera en etapas secuenciales con estado persistente. Cada etapa produce un output que alimenta la siguiente. Si una etapa falla, el pipeline puede reiniciarse desde el punto de falla sin re-ejecutar todo.

```
Etapa 1: Generación de hipótesis (LLM compacto)
Etapa 2: Verificación web / website (web_search_tool + website_verifier)
Etapa 3: Búsqueda LinkedIn (linkedin_company_finder)
Etapa 4: Verificación fiscal / registry (registry_lookup_tool)
Etapa 5: Deduplicación SellUp + HubSpot (sellup_duplicate_checker + hubspot_duplicate_checker)
Etapa 6: Scoring consolidado (candidate_scorer)
Etapa 7: Escritura del lote (candidate_writer)
Etapa 8: Revisión humana (UI del lote)
```

### 5.3 Plan-then-execute

Antes de ejecutar herramientas costosas (web search, API HubSpot), el agente planifica qué herramientas usar basándose en el contexto dinámico del catálogo. No ejecuta todas las herramientas para todos los candidatos — prioriza según disponibilidad de datos y costo.

### 5.4 Human-in-the-loop obligatorio

- No se crean cuentas sin aprobación explícita.
- El humano evalúa calidad comercial — no busca duplicados.
- Los `possible_duplicate` requieren decisión humana.
- El humano aprueba o descarta; el sistema nunca convierte automáticamente.

### 5.5 Observabilidad y tracing

Cada herramienta ejecutada genera un registro en:
- `agent_run_steps` — paso ejecutado, proveedor, costo, resultado
- `provider_usage_logs` — llamada granular con tokens/créditos/costo
- `result_quality_events` — ciclo de vida de cada candidato

### 5.6 Control de costos por cascada

- Fuentes gratuitas / públicas → primero siempre.
- Web search → solo cuando no hay datos suficientes de fuentes estáticas.
- APIs de pago (Apollo) → solo si las herramientas anteriores no alcanzan el target.
- Lusha → nunca en discovery; solo para enriquecimiento de contactos post-aprobación.

### 5.7 Recuperación selectiva de contexto (RAG)

El catálogo LatAm no se envía completo al LLM. Se recupera únicamente el contexto relevante para el par `(country_code, industry)` solicitado — máximo 6 fuentes, 5 riesgos, 3 reglas sectoriales, 1 identificador fiscal.

### 5.8 Validación automática antes de mostrar resultados

Ningún candidato llega a la UI del usuario sin haber pasado por:
1. Normalización de nombre y dominio.
2. Deduplicación contra SellUp.
3. Deduplicación contra HubSpot.
4. Clasificación con `post_check_status`.
5. Score de calidad mínimo validado.

---

## 6. Arquitectura recomendada por etapas

### Diagrama de flujo

```
┌──────────────────────────────────────────────────────────────────┐
│  INPUT: country, country_code, industry, target_count,           │
│         search_depth, use_apollo_fallback                        │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  ETAPA 0            │
                    │  catalog_context_   │
                    │  retriever          │
                    │  (RAG estático)     │
                    └──────────┬──────────┘
                               │ Contexto: fuentes P0/P1,
                               │ fiscal ID, riesgos, reglas
                    ┌──────────▼──────────┐
                    │  ETAPA 1            │
                    │  LLM — Hipótesis    │
                    │  compactas          │
                    │  (Haiku / Sonnet)   │
                    └──────────┬──────────┘
                               │ Lista de candidatos sin verificar
                    ┌──────────▼──────────┐
                    │  ETAPA 2            │
                    │  web_search_tool    │
                    │  + website_verifier │
                    └──────────┬──────────┘
                               │ Websites verificados / inferidos / not_found
                    ┌──────────▼──────────┐
                    │  ETAPA 3            │
                    │  linkedin_company_  │
                    │  finder             │
                    │  (Fase 2)           │
                    └──────────┬──────────┘
                               │ LinkedIn: verified / candidate / not_found
                    ┌──────────▼──────────┐
                    │  ETAPA 4            │
                    │  registry_lookup_   │
                    │  tool               │
                    │  (Fase 2 avanzada)  │
                    └──────────┬──────────┘
                               │ Tax ID, estado activo, fuente oficial
                    ┌──────────▼──────────┐
                    │  ETAPA 5A           │
                    │  sellup_duplicate_  │
                    │  checker            │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  ETAPA 5B           │
                    │  hubspot_duplicate_ │
                    │  checker            │
                    └──────────┬──────────┘
                               │ post_check_status por candidato
                    ┌──────────▼──────────┐
                    │  ETAPA 6            │
                    │  candidate_scorer   │
                    │  + cost_logger      │
                    └──────────┬──────────┘
                               │ Scores consolidados + log de costos
                    ┌──────────▼──────────┐
                    │  ¿Suficientes        │
                    │  new_candidates?     │
                    │  ≥ target_count      │
                    └──┬───────────────┬──┘
                       │ SÍ            │ NO
                       │         ┌─────▼──────────┐
                       │         │ Apollo fallback │ (si habilitado)
                       │         │ o declarar     │
                       │         │ déficit        │
                       │         └─────┬──────────┘
                    ┌──▼───────────────▼──┐
                    │  ETAPA 7            │
                    │  candidate_writer   │
                    │  → prospect_batch   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  REVISIÓN HUMANA    │
                    │  UI del lote con    │
                    │  filtros y contadores│
                    └─────────────────────┘
```

### Descripción de etapas

| Etapa | Herramienta | Modelo sugerido | Costo estimado | Cuándo se ejecuta |
|-------|-------------|-----------------|----------------|-------------------|
| 0 | `catalog_context_retriever` | Lookup estático / RAG | ~$0 | Siempre |
| 1 | LLM hipótesis compactas | Claude Haiku 4.5 | ~$0.001–0.003/lote | Siempre |
| 2 | `web_search_tool` + `website_verifier` | API web + HTTP | ~$0.002–0.010/candidato | Candidatos sin website confirmado |
| 3 | `linkedin_company_finder` | Búsqueda web estructurada | ~$0.001–0.005/candidato | Fase 2 — candidatos aprobados |
| 4 | `registry_lookup_tool` | API pública / scraping controlado | ~$0–0.005/candidato | Fase 2 — países con API disponible |
| 5A | `sellup_duplicate_checker` | DB query | ~$0 | Siempre |
| 5B | `hubspot_duplicate_checker` | HubSpot API | ~$0 (incluido) | Siempre |
| 6 | `candidate_scorer` + `cost_logger` | Reglas determinísticas | ~$0 | Siempre |
| 7 | `candidate_writer` | DB write | ~$0 | Siempre |

---

## 7. Tool Kit del Agente 1 — `sellup_prospecting_toolkit`

### A. `catalog_context_retriever`

**Propósito:** Recuperar únicamente las fuentes y reglas relevantes para el par `(country, industry)` solicitado. Nunca enviar el catálogo LatAm completo al LLM.

**Input:**
```json
{
  "country": "string",
  "country_code": "string (ISO 3166-1 alpha-2)",
  "industry": "string",
  "search_depth": "basic | standard | deep"
}
```

**Output:**
```json
{
  "country_coverage": "Alta | Media | Baja",
  "fiscal_identifier": {
    "type": "NIT | RUC | RFC | CNPJ | CUIT | RUT | RTN | RNC",
    "format": "string — descripción del formato",
    "validation_source": "string — URL o nombre de fuente"
  },
  "sources_p0": [
    {
      "name": "string",
      "url": "string",
      "type": "Discovery | Validación | Señales comerciales | Sectorial",
      "automation_level": "Alta | Media | Baja | Manual",
      "use_case": "string"
    }
  ],
  "sources_p1": [...],
  "sector_sources": [...],
  "legal_risks": ["máximo 5 riesgos clave"],
  "sector_rules": ["máximo 3 reglas sectoriales"],
  "b2g_signals_available": "boolean",
  "coverage_notes": "string"
}
```

**Regla crítica:** Para cada ejecución recuperar máximo: 6 fuentes relevantes, 5 riesgos clave, 3 reglas sectoriales, identificador fiscal del país.

**Implementación MVP:** Lookup estático desde el catálogo estructurado en JSON/DB. No requiere LLM — es recuperación determinística.

---

### B. `sellup_duplicate_checker`

**Propósito:** Verificar si la empresa ya existe en la base interna de SellUp (tablas `accounts` y `prospect_candidates`).

**Input:**
```json
{
  "name": "string",
  "normalized_name": "string — sin sufijos, sin tildes, minúsculas",
  "domain": "string | null",
  "country_code": "string",
  "tax_identifier": "string | null"
}
```

**Output:**
```json
{
  "duplicate_status": "none | possible | existing_in_sellup",
  "matched_account_id": "uuid | null",
  "matched_candidate_id": "uuid | null",
  "matched_reason": "domain_exact | tax_id_exact | name_fuzzy | none",
  "confidence": "high | medium | low",
  "fuzzy_score": "float 0-1 | null",
  "matched_record": {
    "name": "string | null",
    "domain": "string | null",
    "sellup_url": "string | null"
  }
}
```

**Lógica de matching (orden de prioridad):**
1. `domain` exacto → `existing_in_sellup` (alta confianza)
2. `tax_identifier` exacto → `existing_in_sellup` (alta confianza)
3. `normalized_name` + `country_code` fuzzy ≥ 85% → `possible` (media confianza)
4. Sin coincidencia → `none`

---

### C. `hubspot_duplicate_checker`

**Propósito:** Verificar si la empresa ya existe en HubSpot. Esta verificación es **obligatoria** y es responsabilidad del sistema — no del usuario.

**Input:**
```json
{
  "name": "string",
  "legal_name": "string | null",
  "domain": "string | null",
  "website": "string | null",
  "tax_identifier": "string | null",
  "country": "string",
  "country_code": "string"
}
```

**Output:**
```json
{
  "duplicate_status": "none | possible | existing_in_hubspot | api_error",
  "matched_hubspot_company_id": "string | null",
  "matched_company_name": "string | null",
  "matched_domain": "string | null",
  "matched_reason": "domain_exact | tax_id_exact | name_fuzzy | none",
  "confidence": "high | medium | low",
  "hubspot_company_url": "string | null",
  "error_message": "string | null"
}
```

**Secuencia de búsqueda HubSpot:**
```
1. Buscar por domain (normalizado: sin www, sin protocolo, lowercase)
   → HubSpot /crm/v3/objects/companies/search con filter: domain = {domain}

2. Si no hay match: buscar por tax_identifier
   → filter: nit = {tax_identifier} o sellup_tax_identifier = {tax_identifier}

3. Si no hay match: buscar por name + country (fuzzy threshold 85%)
   → filter: name contains {normalized_name} AND country = {country}
```

**Regla crítica:** Si la API de HubSpot falla → `duplicate_status: "api_error"` con advertencia visible en el lote. Nunca presentar candidatos como "nuevos confirmados" si HubSpot check no pudo ejecutarse.

**Importancia del campo `hubspot_company_url`:** Cuando se detecta una empresa existente, se debe incluir el link directo al portal de HubSpot para que el usuario pueda acceder con un clic si lo necesita.

---

### D. `web_search_tool`

**Propósito:** Buscar empresas reales y señales públicas en la web. Proporciona evidencia de existencia, website, actividad y contexto de una empresa.

**Input:**
```json
{
  "country": "string",
  "country_code": "string",
  "industry": "string",
  "query": "string — query de búsqueda construida por el agente",
  "max_results": "integer (3-10)",
  "search_type": "company_discovery | website_verification | linkedin_search | registry_search"
}
```

**Output:**
```json
{
  "results": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string",
      "source": "string — dominio de la fuente",
      "rank": "integer",
      "relevance_signal": "official_site | news | directory | social | registry | unknown"
    }
  ],
  "query_used": "string",
  "provider_used": "string — herramienta que ejecutó la búsqueda",
  "cost_usd": "float"
}
```

**Opciones de proveedor evaluadas:** Ver sección 10 (Comparativa).  
**Recomendación preliminar:** Tavily o Exa como primera opción para MVP (ver §10).

---

### E. `website_verifier`

**Propósito:** Validar si un website existe, responde correctamente y corresponde a la empresa candidata. El LLM no debe inventar websites — esta herramienta es la fuente de verdad.

**Input:**
```json
{
  "candidate_name": "string",
  "website_or_domain": "string | null",
  "search_results": [...],
  "country": "string"
}
```

**Output:**
```json
{
  "website": "string | null",
  "domain": "string | null",
  "status": "verified | inferred | mismatch | not_found",
  "http_status": "integer | null",
  "redirect_chain": ["array de URLs si hay redirects"],
  "page_title": "string | null",
  "name_match_signal": "exact | partial | mismatch | unknown",
  "evidence": "string — cómo se verificó",
  "confidence": "high | medium | low",
  "is_domain_matrix": "boolean — ¿es dominio de casa matriz y no subsidiaria local?"
}
```

**Algoritmo de verificación:**

```
1. Normalizar dominio (sin www, sin protocolo, lowercase)
2. HTTP HEAD request → verificar que responde (status 200/301/302)
3. Si redirige: seguir cadena de redirects, detectar dominio final
4. HTTP GET del dominio final → extraer <title> y <meta name="description">
5. Comparar title/description contra candidate_name (fuzzy matching ≥ 70%)
6. Detectar si es dominio de casa matriz (ej: globant.com para Globant Colombia)
7. Asignar status:
   - verified: responde + title match ≥ 70%
   - inferred: responde pero title match < 70% o no extraído
   - mismatch: responde pero title claramente de otra empresa
   - not_found: no responde o error de red
```

**Regla:** Si `website_or_domain` es null Y no hay resultados de búsqueda que lo provean → `status: not_found`. El agente no inventa dominios.

---

### F. `linkedin_company_finder`

**Propósito:** Buscar la página de LinkedIn de empresa sin inventar URLs. Solo incluir si hay evidencia real.

**Input:**
```json
{
  "candidate_name": "string",
  "legal_name": "string | null",
  "country": "string",
  "domain": "string | null",
  "website": "string | null"
}
```

**Output:**
```json
{
  "linkedin_company_url": "string | null",
  "status": "verified | candidate | not_found",
  "evidence": "string — cómo se encontró (búsqueda site:linkedin.com, resultado de web search, etc.)",
  "confidence": "high | medium | low",
  "search_query_used": "string"
}
```

**Algoritmo:**

```
1. Construir query: site:linkedin.com/company "{candidate_name}" "{country}"
2. Ejecutar vía web_search_tool (search_type: linkedin_search)
3. Si resultado #1 es linkedin.com/company/... y el título contiene el nombre → verified
4. Si resultado existe pero match parcial → candidate (requiere validación humana)
5. Si no hay resultados de linkedin.com/company → not_found
```

**Reglas críticas:**
- Nunca construir URLs tipo `linkedin.com/company/{nombre-normalizado}` sin evidencia de búsqueda.
- Si status es `not_found` → `linkedin_company_url: null`.
- No hacer scraping de LinkedIn — solo búsqueda pública.
- Respetar ToS de LinkedIn.

---

### G. `registry_lookup_tool`

**Propósito:** Buscar o preparar validación de identificador fiscal y estado activo por país. La implementación varía significativamente por país.

**Input:**
```json
{
  "country_code": "string",
  "legal_name": "string",
  "normalized_name": "string",
  "tax_identifier": "string | null"
}
```

**Output:**
```json
{
  "legal_name_verified": "string | null",
  "tax_identifier": "string | null",
  "tax_identifier_type": "NIT | RUC | RFC | CNPJ | CUIT | RUT | RTN | RNC | null",
  "company_status": "active | inactive | dissolved | suspended | unknown",
  "registry_source": "string — fuente consultada",
  "registry_url": "string | null",
  "status": "verified | pending_manual | not_available",
  "verification_query": "string — cómo buscar en la fuente oficial"
}
```

**Implementación por país (MVP inicial):**

| País | Fuente | Automatización | Notas |
|------|--------|----------------|-------|
| Colombia | Supersociedades SIIS (CSV descargable) | Alta | Buscar por nombre o NIT en dataset pre-cargado |
| Colombia | RUES | Media | API de tercero (Verifik/Apitude) para consulta individual |
| México | DENUE (INEGI) API | Alta | Token gratuito; 22 campos incluye RFC parcial |
| Chile | RES (datos.gob.cl) | Alta | CSV gratuito descargable |
| Perú | SUNAT Padrón RUC | Alta | ZIP diario gratuito |
| Ecuador | SCVS (datos abiertos) | Media-Alta | Dataset CSV descargable |
| Brasil | Receita Federal CNPJ / cnpj.ws | Alta | API gratuita 50 req/seg |
| Rep. Dominicana | DGII CSV | Media-Alta | Descarga TXT/CSV disponible |
| Otros | Fallback manual | Manual | `status: pending_manual` |

**Nota:** Para MVP, esta herramienta opera principalmente sobre datasets pre-cargados (Colombia/México/Chile/Perú/Ecuador/Brasil). Los países con cobertura Manual devuelven `status: pending_manual` con la `verification_query` pre-formateada para que el usuario pueda validar fácilmente.

---

### H. `candidate_scorer`

**Propósito:** Calcular scores de calidad con reglas determinísticas. El LLM solo interviene para casos ambiguos de fit comercial donde las reglas son insuficientes.

**Input:**
```json
{
  "candidate": {...},
  "website_verification": {...},
  "linkedin_verification": {...},
  "registry_status": {...},
  "sellup_duplicate_check": {...},
  "hubspot_duplicate_check": {...},
  "fit_signals": {
    "industry_match": "boolean",
    "size_in_range": "boolean | null",
    "b2g_signal": "boolean",
    "sector_relevance_keywords": ["array"]
  }
}
```

**Output:**
```json
{
  "confidence_score": "integer 0-100",
  "fit_score": "integer 0-100",
  "data_completeness_score": "integer 0-100",
  "quality_label": "high_quality_new | needs_review | duplicate | insufficient_data | discard",
  "recommended_action": "approve | needs_review | discard | enrich_first",
  "score_breakdown": {
    "website_points": "integer",
    "linkedin_points": "integer",
    "registry_points": "integer",
    "dedup_points": "integer",
    "fit_points": "integer",
    "completeness_points": "integer"
  }
}
```

**Reglas de scoring (determinísticas):**

`confidence_score` = suma de puntos basada en:
- Website verificado (`verified`): +25 pts
- Website inferido: +10 pts
- Website no encontrado: +0 pts
- Fuente oficial en catálogo: +15 pts
- Tax ID disponible (cualquier fuente): +20 pts
- Tax ID verificado en registry: +30 pts
- Estado activo confirmado: +15 pts
- HubSpot check: none → +10 pts; possible → +0; existing → score forzado a 0 (no new)

`fit_score` = reglas sobre industria, tamaño, señales B2G, keywords sectoriales. LLM solo si ambigüedad semántica alta.

`data_completeness_score` = mismo esquema de puntos que Prompt V2.

---

### I. `cost_logger`

**Propósito:** Registrar costos por herramienta/proveedor/modelo con trazabilidad completa.

**Input:**
```json
{
  "provider_key": "string — anthropic | tavily | exa | brave | hubspot | internal | etc.",
  "operation_key": "string — hypothesis_generation | web_search | website_verify | hubspot_dedup | scoring | etc.",
  "tokens_input": "integer | null",
  "tokens_output": "integer | null",
  "credits_used": "float | null",
  "estimated_cost_usd": "float",
  "real_cost_usd": "float | null",
  "agent_run_id": "uuid",
  "step_name": "string",
  "batch_id": "uuid",
  "candidate_id": "uuid | null"
}
```

**Output:**
```json
{
  "provider_usage_log_id": "uuid",
  "agent_run_step_id": "uuid",
  "status": "logged | error",
  "cumulative_cost_usd": "float — costo acumulado del agent_run"
}
```

**Integración:** Se conecta con `provider_usage_logs`, `agent_run_steps` y `agent_runs` según el esquema definido en `USO_COSTOS_EFECTIVIDAD_AGENTES_PROVEEDORES.md`.

---

### J. `candidate_writer`

**Propósito:** Guardar empresas candidatas en `prospect_candidates` con toda la metadata de verificación. Solo guarda candidatos con datos mínimos suficientes.

**Input:**
```json
{
  "batch_id": "uuid",
  "candidate": {
    "name": "string",
    "normalized_name": "string",
    "country_code": "string",
    ...
  },
  "scores": {
    "confidence_score": "integer",
    "fit_score": "integer",
    "data_completeness_score": "integer",
    "quality_label": "string"
  },
  "post_check_status": "new_candidate | possible_duplicate | existing_in_hubspot | existing_in_sellup | insufficient_data | unchecked",
  "verification_metadata": {
    "website_verification": {...},
    "linkedin_verification": {...},
    "registry_verification": {...},
    "sellup_duplicate_check": {...},
    "hubspot_duplicate_check": {...}
  }
}
```

**Output:**
```json
{
  "prospect_candidate_id": "uuid | null",
  "status": "created | skipped_insufficient_data | skipped_duplicate | error",
  "reason": "string | null"
}
```

**Reglas de escritura:**
- `confidence_score < 50` → skip con reason "insufficient_confidence"
- `post_check_status: existing_in_hubspot OR existing_in_sellup` → escribir pero marcar como existente, no como nuevo
- `name` null → skip con reason "missing_required_field"
- Solo crea candidatos en `prospect_candidates`, nunca crea cuentas definitivas en `accounts`

---

### Clasificación MVP vs Fase 2

| Herramienta | Fase | Justificación |
|-------------|------|---------------|
| `catalog_context_retriever` | **MVP obligatorio** | Fundamento de todo el pipeline; costo cero |
| `sellup_duplicate_checker` | **MVP obligatorio** | Crítico para calidad de datos internos |
| `hubspot_duplicate_checker` | **MVP obligatorio** | Regla de negocio no negociable |
| `web_search_tool` | **MVP obligatorio** | Habilita verificación de websites; reemplaza inferencia LLM |
| `website_verifier` | **MVP obligatorio** | Fuente de verdad de dominios |
| `candidate_scorer` | **MVP obligatorio** | Sin scorer no hay calidad consistente |
| `cost_logger` | **MVP obligatorio** | Foundation de observabilidad ya documentada |
| `candidate_writer` | **MVP obligatorio** | Persistencia del pipeline |
| `linkedin_company_finder` | **Fase 2** | Mejora la completitud pero no bloquea el MVP |
| `registry_lookup_tool` (avanzado) | **Fase 2** | Datasets estáticos en MVP; API en vivo en Fase 2 |
| Apollo fallback (herramienta) | **Fase 2** | Mantener apagado por defecto en MVP |
| Enriquecimiento Lusha | **Fase 2** | Solo para contactos post-aprobación, fuera del Agente 1 |
| Sales angle profundo bajo demanda | **Fase 2** | LLM genera análisis profundo solo para candidatos aprobados |

---

## 8. Memoria y RAG del Agente 1

El Agente 1 opera con cuatro capas de memoria/contexto diferenciadas:

### Capa A — Memoria global del agente (reglas permanentes)

Reglas que aplican a todas las ejecuciones, cacheables en el LLM:

```
REGLAS GLOBALES PERMANENTES (Capa 1 — cacheable):
- Máximo 25 empresas candidatas por lote
- Apollo fallback deshabilitado por defecto (use_apollo_fallback: false)
- Lusha NUNCA para discovery inicial — solo enriquecimiento post-aprobación
- HubSpot duplicate check es obligatorio — ejecutado por el sistema, no por el usuario
- SellUp duplicate check es obligatorio — ejecutado antes de HubSpot check
- No crear cuentas (accounts) sin revisión humana explícita
- No inventar websites — si no se verifica, status: not_found o inferred
- No inventar LinkedIn URLs — si no hay evidencia, linkedin_company_url: null
- No enviar el catálogo LatAm completo al LLM — solo contexto filtrado por país/sector
- Solo personas jurídicas — no personas naturales
- Si confidence_score < 50 después de verificación → no incluir en lote
```

**Tamaño estimado:** ~150 tokens. Cacheables con prompt caching de Anthropic.

### Capa B — Memoria RAG del catálogo

Recuperada dinámicamente para cada ejecución basándose en `(country_code, industry)`:

**Contenido del índice RAG:**
- Fuentes P0 y P1 por país (con URL, tipo, nivel de automatización)
- Fuentes sectoriales por industria
- Identificador fiscal por país (tipo, formato, fuente de validación)
- Cobertura del país (Alta / Media / Baja)
- Riesgos legales/técnicos por país
- Notas de cobertura sectorial
- Señales B2G disponibles

**Recuperación:** Máximo 6 fuentes relevantes + 5 riesgos + 3 reglas sectoriales + 1 identificador fiscal.

**Implementación MVP:** Lookup estático desde JSON/DB indexado por `(country_code, industry)`. No requiere vector DB para MVP — la recuperación determinística es suficiente y más confiable.

**Implementación Fase 2:** RAG vectorial con embeddings si el catálogo crece significativamente y las búsquedas por keywords no son suficientes.

**Tamaño estimado por ejecución:** ~180–220 tokens (contexto filtrado).

### Capa C — Memoria operativa por ejecución

Vive en las tablas de observabilidad ya definidas:

| Tabla | Qué registra |
|-------|-------------|
| `agent_runs` | Input, status, resultados totales, costo total |
| `agent_run_steps` | Herramienta ejecutada, proveedor, costo por paso, resultado |
| `provider_usage_logs` | Llamada granular: tokens, créditos, costo, error |
| `prospect_batches` | Resumen del lote generado |
| `prospect_candidates` | Candidatos con toda la metadata de verificación |
| `result_quality_events` | Ciclo de vida: generado → verificado → deduplicado → aprobado → convertido |

Esta capa es la **fuente de verdad para aprendizaje y optimización**. Permite responder: ¿qué herramienta aportó más valor?, ¿cuánto cuesta un candidato nuevo real?, ¿cuál es la tasa de duplicados por país?.

### Capa D — Memoria contextual por empresa/prospecto

Vive en el expediente vivo de cada empresa:

| Tabla | Qué contiene |
|-------|-------------|
| `accounts` | Cuenta activa con historial de interacciones |
| `contacts` | Contactos asociados a la cuenta |
| Futura: inteligencia de cuenta | Actividad, reuniones, propuestas, señales |
| Futura: agentes ejecutados | Qué agentes corrieron sobre esta cuenta |

Esta capa permite que otros agentes (Agente 2 de enriquecimiento, Agente 3 de inteligencia de cuenta) continúen el trabajo donde el Agente 1 lo dejó, sin re-ejecutar discovery desde cero.

---

## 9. Deduplicación obligatoria SellUp + HubSpot

### 9.1 Principio rector

> **El Agente 1 no se mide por empresas encontradas. Se mide por empresas nuevas útiles.**

Una empresa que ya existe en HubSpot no es un éxito del agente — es un crédito de web search gastado innecesariamente. Una empresa ya existente presentada como "nueva" al usuario es un defecto de diseño, no una característica.

### 9.2 Regla de negocio

```
Deduplicación es responsabilidad del SISTEMA.
El usuario NO debe buscar manualmente en HubSpot.
El usuario revisa CALIDAD COMERCIAL — no detecta duplicados.
```

### 9.3 Clasificación de candidatos post-deduplicación

| `post_check_status` | Significado | ¿Se muestra como nuevo? | Acción del sistema | Acción del usuario |
|---------------------|-------------|------------------------|--------------------|--------------------|
| `new_candidate` | Sin match en SellUp ni HubSpot | ✅ Sí — sección principal | Presentar para aprobación | Aprobar / descartar / pedir más info |
| `possible_duplicate` | Match fuzzy (≥85% nombre pero sin domain confirmado) | ⚠️ No automático — badge "Revisar" | Mostrar con badge y reason | Confirmar si es el mismo o candidato nuevo |
| `existing_in_hubspot` | Match exacto en HubSpot (domain o tax_id) | ❌ No | Sección colapsada "Ya en HubSpot" con link | Ver en HubSpot / ignorar / actualizar datos |
| `existing_in_sellup` | Match exacto en SellUp (domain o ID) | ❌ No | Sección colapsada "Ya en SellUp" con link | Ver cuenta / ignorar |
| `insufficient_data` | Sin domain ni tax_id verificado para comparar | ❌ No | Sección "Incompletos" | Enriquecer / descartar |
| `unchecked` | Verificación no ejecutada (fallo de API) | ❌ No — bloqueado | Warning visible; bloquear conversión | Re-ejecutar verificación o verificar manualmente |

### 9.4 Comportamiento cuando el lote tiene pocos candidatos nuevos

```
Si new_candidate_count < target_count:
  1. Intentar generar candidatos adicionales
     → Solo si hay fuentes no exhaustas Y costo dentro del límite por lote
  2. Si se alcanza → completar hasta target_count
  3. Si no se puede completar:
     → Reportar el lote con lo disponible
     → batch_summary.limitations: "Solo X candidatos nuevos encontrados.
        Y ya existían en HubSpot. Z ya existían en SellUp."
     → apollo_needed: true (si aplica)
  4. NUNCA inflar el count moviendo existing_in_hubspot al grupo de nuevos
```

### 9.5 UI del lote — contadores y filtros

**Cabecera del lote:**

```
┌──────────────────────────────────────────────────────────────────┐
│  Lote: Colombia / Tecnología · 15 candidatos solicitados         │
│  Ejecutado: 2026-05-22 14:32 · Costo: $0.08 USD                 │
│                                                                  │
│  ✅ Nuevas             9   (aprobables)                          │
│  ⚠️  Posibles dup.     2   (requieren revisión)                  │
│  🏢 Ya en HubSpot      3   (empresas existentes en CRM)          │
│  📋 Ya en SellUp       1   (cuentas ya registradas)              │
│  ❓ Datos insuficientes 0   (sin domain ni tax_id verificado)    │
│                                                                  │
│  [Ver nuevas] [Ver a revisar] [Ver en HubSpot] [Ver en SellUp]  │
└──────────────────────────────────────────────────────────────────┘
```

**Filtros disponibles:** Nuevas · Posibles duplicados · Existentes en HubSpot · Existentes en SellUp · Incompletas

**Secciones colapsadas por defecto:** "Ya en HubSpot" y "Ya en SellUp" — el usuario ve primero los candidatos nuevos.

---

## 10. Comparativa de herramientas web / deep research

Esta sección evalúa las principales herramientas de búsqueda web para el Agente 1. Los precios son aproximados al momento de la investigación — **pendiente de validación antes de integrar.**

| Herramienta | Uso principal | Pros para SellUp | Contras | Costo aprox. | Calidad LatAm | LinkedIn finder | Recomendación |
|-------------|--------------|-----------------|---------|:------------:|:------------:|:---------------:|:-------------:|
| **Tavily** | API de búsqueda diseñada para agentes IA | Resultados estructurados JSON, incluye snippet y URL; diseñada para LLMs; buena cobertura web | Relativamente nuevo; SLA y cobertura LatAm profunda aún en maduración | ~$0.001/búsqueda básica; planes desde ~$20/mes | Media-Alta | Sí (búsqueda general) | ✅ **Primera opción MVP** |
| **Exa** (Metaphor) | Búsqueda semántica para IA/LLM | Búsqueda por significado, no solo keywords; buena para "empresas similares a X"; output estructurado; soporte para `find_similar` | Costo más alto por query; cobertura LatAm a confirmar | ~$0.005–0.01/query; planes desde $20/mes | Media | Sí (búsqueda web) | ✅ Segunda opción MVP |
| **Brave Search API** | Búsqueda web general, índice propio | Privacidad por diseño; índice independiente (no Google); API REST documentada; respuesta rápida | Índice propio puede tener gaps en LatAm; snippets menos ricos que Tavily | ~$3/1000 queries plan básico | Media | Sí (búsqueda general) | ⚠️ Opción alternativa |
| **SerpAPI** | Scraping de Google/Bing/Baidu | Resultados de Google reales; alta fidelidad; soporte multi-buscador | Costo mayor; clasificado como scraping (revisar ToS); latencia variable | ~$50/mes para 5,000 búsquedas | Alta (Google indexed) | Sí (Google site:) | ⚠️ Revisar ToS primero |
| **Google PSE** (Custom Search) | Búsqueda programática en Google | Resultados de Google; gratuito hasta 100/día | Límite muy bajo; costo elevado al escalar ($5/1000 queries adicionales); requiere configurar corpus de búsqueda | Gratuito tier / $5/1000 sobre cuota | Alta (Google indexed) | Sí (site:linkedin.com) | ❌ No para volumen |
| **Firecrawl** | Extracción de contenido web (scraping API) | Convierte páginas a Markdown limpio para LLMs; ideal para extraer info de una URL conocida | No es un motor de búsqueda — requiere URL previa; costo por página | ~$15/mes plan básico; ~$0.0015/página | Alta (cualquier URL) | Solo si tienes la URL | ✅ Complemento para website_verifier |
| **Perplexity / Sonar API** | Búsqueda con respuesta generada por LLM | Respuesta sintetizada con citaciones; útil para preguntas directas | Costo por token de output; respuesta menos estructurada que JSON puro; no ideal para pipelines automatizados | ~$5/1000 queries (Sonar) pendiente validación | Media-Alta | Sí (con citaciones) | ⚠️ Para research profundo, no para pipeline |
| **HTTP directo + BeautifulSoup** | Extracción básica de websites propios | Costo cero; control total | Solo para URLs conocidas; no es un buscador; requiere manejo de robots.txt y rate limits | $0 | Alta (cualquier URL) | N/A | ✅ Para website_verifier complementario |

### Criterios de evaluación detallados

| Criterio | Tavily | Exa | Brave | SerpAPI | Google PSE | Firecrawl |
|---------|:------:|:---:|:-----:|:-------:|:----------:|:---------:|
| Respuesta estructurada JSON | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Integración fácil | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| Calidad en LatAm | Media-Alta | Media | Media | Alta | Alta | Alta |
| LinkedIn company pages | ✅ | ✅ | ✅ | ✅ | ✅ | N/A |
| Velocidad de respuesta | Alta | Media | Alta | Media | Media | Media |
| Riesgo ToS | Bajo | Bajo | Bajo | **Revisar** | Bajo | Bajo |
| Costo para 25 candidatos/lote | ~$0.025–0.10 | ~$0.10–0.25 | ~$0.08 | ~$0.25 | ~$0.25 | ~$0.04 |
| SDK / cliente Python/JS | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |

> **Nota:** Todos los costos son estimados preliminares basados en información pública disponible. **Pendiente de validación contra pricing actual** antes de integrar cualquier herramienta.

### Recomendación para MVP

**Primera opción:** **Tavily** como `web_search_tool` principal. Diseñado específicamente para agentes IA, output estructurado, costo bajo, buena cobertura web general, SDK disponible para JavaScript/TypeScript.

**Complemento:** **Firecrawl** para `website_verifier` cuando se necesita extraer contenido de una URL específica (title, meta, body) con mayor fidelidad que un HTTP HEAD simple.

**Segunda opción / fallback:** **Exa** para búsquedas semánticas avanzadas o cuando Tavily no entrega resultados suficientes para un país/sector específico.

**No recomendado para MVP:** SerpAPI (revisar ToS), Google PSE (límite bajo), Perplexity/Sonar (respuesta LLM, no pipeline-friendly).

---

## 11. Website verification

### 11.1 Enfoque recomendado

El `website_verifier` opera en tres sub-etapas:

**Sub-etapa 1 — Normalización del dominio:**
```
Entrada: "https://www.globant.com/colombia"
→ Normalizar: strip protocolo + www → "globant.com"
→ Detectar si es subpath de dominio matriz (globant.com vs globant.co)
```

**Sub-etapa 2 — Verificación HTTP:**
```
1. HTTP HEAD request al dominio normalizado
2. Si 200 OK → dominio existe
3. Si 301/302 → seguir hasta dominio final (max 5 redirects)
4. Si 404/500/timeout → not_found
5. Capturar dominio final post-redirect
```

**Sub-etapa 3 — Extracción y match:**
```
1. HTTP GET al dominio final → extraer <title> y <meta name="description">
2. Normalizar title: minúsculas, sin tildes, sin artículos
3. Fuzzy match entre title normalizado y candidate_name normalizado
4. Si match ≥ 70% → verified
5. Si match < 70% o no extraído → inferred (si HTTP 200) o not_found
```

**Sub-etapa 4 — Detección de dominio matriz:**
```
Si domain_final ≠ domain_input:
  → Detectar si es casa matriz vs subsidiaria local
  → globant.com para Globant Colombia → is_domain_matrix: true
  → Registrar en evidence para que el usuario sepa
```

### 11.2 Estados de output

| Estado | Condición | Acción recomendada |
|--------|-----------|-------------------|
| `verified` | HTTP 200 + title match ≥ 70% | Usar como website confiable |
| `inferred` | HTTP 200 pero title no confirmado | Incluir pero marcar para revisión humana |
| `mismatch` | HTTP 200 pero title claramente de otra empresa | No usar; buscar dominio alternativo |
| `not_found` | No responde, error, o no hay dominio de partida | `website: null`; usuario busca manualmente |

### 11.3 Consideraciones especiales

- **Subsidiarias locales:** Muchas empresas LatAm usan el dominio de la casa matriz (globant.com) para sus operaciones en Colombia, México, etc. El agente debe registrar esto en `evidence` sin penalizar el score.
- **Parked domains:** Algunos dominios responden 200 pero son páginas parqueadas. Detección via keyword "This domain is for sale" o similares → `mismatch`.
- **LLM solo en casos ambiguos:** Si title match está entre 50–70% y el nombre es muy similar semánticamente, el LLM puede hacer un juicio de ambigüedad. No para el caso común.

---

## 12. LinkedIn company finder

### 12.1 Enfoque recomendado

**Regla fundamental: No construir URLs `linkedin.com/company/{slug}` sin evidencia.**

El slug de una página de empresa en LinkedIn no es predecible. `siigo` puede ser `linkedin.com/company/siigo` o `linkedin.com/company/siigo-sas` o estar bajo una URL completamente diferente. Inventar el slug sin verificar produce links inválidos que erosionan la confianza del usuario.

**Algoritmo de búsqueda:**

```
1. Construir query de búsqueda:
   site:linkedin.com/company "{candidate_name}" "{country}"
   
   Alternativa más específica si hay domain:
   site:linkedin.com/company "{candidate_name}" OR "{legal_name}"

2. Ejecutar vía web_search_tool (search_type: linkedin_search)

3. Evaluar primer resultado:
   - URL es linkedin.com/company/{algo}? → posible match
   - Title del resultado contiene candidate_name (match ≥ 70%)? → candidate
   - Title claramente es la empresa correcta (match ≥ 90%)? → verified

4. Si no hay resultados de linkedin.com/company → not_found
```

### 12.2 Estados y reglas

| Estado | Condición | `linkedin_company_url` | Qué hace el usuario |
|--------|-----------|----------------------|---------------------|
| `verified` | URL linkedin.com/company + match ≥ 90% | ✅ URL real incluida | Usar directamente |
| `candidate` | URL linkedin.com/company + match 70–89% | ⚠️ URL incluida con badge "verificar" | Confirmar que es la empresa correcta |
| `not_found` | Sin resultados de linkedin.com/company | `null` | Buscar manualmente con `google_search_query` |

### 12.3 Restricciones obligatorias

- **Sin scraping de LinkedIn:** Solo búsqueda web que retorna páginas públicas ya indexadas.
- **Sin LinkedIn API** (requiere aprobación del programa de partners de LinkedIn — pendiente).
- **No inventar slugs** bajo ninguna circunstancia.
- **`google_search_query` siempre disponible:** Incluso cuando `status: not_found`, el agente genera una búsqueda sugerida (`"Siigo Colombia LinkedIn empresa"`) para que el usuario pueda encontrar la página en 30 segundos.
- **LinkedIn no es fuente única:** Si `linkedin_company_url: null`, el candidato sigue siendo válido. LinkedIn es un campo deseable, no bloqueante.

---

## 13. Registry / tax ID verification

### 13.1 Estrategia por país para MVP

La verificación de identificadores fiscales es la clave de deduplicación más confiable en LatAm. Sin embargo, no todos los países tienen APIs automatizables. La estrategia es diferenciada:

**Tier 1 — Verificación automática viable (datasets descargables):**

| País | Fuente | Dataset | Frecuencia actualización | Campos clave |
|------|--------|---------|--------------------------|-------------|
| Colombia | Supersociedades SIIS | Excel/CSV descargable gratuito | Anual+ | NIT, razón social, CIIU, estado |
| Colombia | datos.gov.co / CCB | API Socrata | Variable | NIT, nombre, CIIU, municipio |
| México | DENUE INEGI | API REST + CSV | Censos | RFC parcial, SCIAN, nombre |
| Chile | RES (datos.gob.cl) | CSV gratuito | Frecuente | RUT, razón social, giro, estado |
| Perú | SUNAT Padrón RUC | ZIP diario gratuito | Diario | RUC, nombre, CIIU, condición |
| Ecuador | SCVS datos abiertos | CSV/ODS | Variable | RUC, nombre, estado, provincia |
| Brasil | Receita Federal CNPJ | ZIP mensual + cnpj.ws API | Mensual | CNPJ, CNAE, municipio, situación |
| Rep. Dominicana | DGII | TXT/CSV descargable | Frecuente | RNC, nombre, actividad, estado |

**Tier 2 — Verificación semi-manual (API de tercero o formulario web):**

| País | Fuente recomendada | Notas |
|------|-------------------|-------|
| Colombia | RUES (Verifik/Apitude) | API de tercero paga; útil para validación individual de NIT |
| Argentina | Registro Nacional Sociedades | ZIP mensual gratuito — no API directa |
| Uruguay | DEI-MIEM | CSV descargable — validación por RUT manual |
| Panamá | PANADATA | API paga — cubre CO, EC, PA |
| Costa Rica | Registro Nacional | Portal web — validación individual |

**Tier 3 — Validación manual con `verification_query` pre-formateada:**

Para países sin fuente automatizable (Honduras, Nicaragua, Bolivia, Guatemala, El Salvador, Paraguay):
- `status: pending_manual`
- `verification_query` pre-formateada: "Buscar en [Fuente]: [nombre normalizado]"
- No bloquea el candidato; reduce `data_completeness_score`

### 13.2 Implementación MVP recomendada

Para MVP: pre-cargar los datasets de **Colombia, México, Chile, Perú y Ecuador** en una tabla indexada de SellUp. El `registry_lookup_tool` hace lookups locales sin llamar APIs en tiempo real para estos países. Esto elimina latencia, costo y dependencias externas.

Para Brasil, República Dominicana y Argentina: usar las descargas periódicas (mensual/semanal) como datasets locales también.

Para el resto: generar `verification_query` pre-formateada y devolver `status: pending_manual`.

---

## 14. Optimización de tokens y costos

### 14.1 Comparación de enfoques

| Enfoque | Tokens input | Tokens output/cand. | Costo estimado/lote 15 cand. | Precisión datos duros | Deduplicación |
|---------|:------------:|:-------------------:|:----------------------------:|:--------------------:|:-------------:|
| Prompt gigante único | ~2,000+ | ~400–600 | ~$0.09–0.14 | Baja (inferida) | Manual |
| Prompt V2 con contexto filtrado | ~1,080 | ~300 | ~$0.075 | Media (inferida) | Manual |
| Pipeline tool-first (MVP) | ~400 (hipótesis) | ~60–80 (hipótesis) | ~$0.040–0.080 total con tools | Alta (verificada) | Automática |
| Pipeline tool-first + caching Capa 1 | ~200 (cache hit) | ~60–80 (hipótesis) | ~$0.025–0.060 total | Alta (verificada) | Automática |

> **Nota:** El costo del pipeline tool-first incluye el costo de las herramientas (web search ~$0.025–0.050 para 15 candidatos con Tavily) más el LLM para hipótesis (Haiku: ~$0.001–0.003/lote). El costo total es similar o menor que el Prompt V2, pero con calidad de datos significativamente superior.

### 14.2 Estrategia de tokens recomendada

**El LLM solo hace lo que no puede ser determinístico:**

| Tarea | ¿LLM o Tool? | Modelo | Tokens estimados |
|-------|:------------:|--------|:----------------:|
| Recuperar contexto catálogo | Tool (lookup) | — | ~0 |
| Generar hipótesis de empresas (nombre, país, industria, why) | LLM | Haiku 4.5 | ~40–60/candidato |
| Verificar website | Tool (HTTP + regex) | — | ~0 |
| Buscar LinkedIn | Tool (web search) | — | ~0 |
| Lookup registry / tax ID | Tool (dataset local) | — | ~0 |
| Deduplicar SellUp | Tool (DB query) | — | ~0 |
| Deduplicar HubSpot | Tool (API) | — | ~0 |
| Resolver ambigüedad de nombre (fuzzy borderline) | LLM | Haiku 4.5 | ~30–50 solo si necesario |
| Score determinístico | Tool (reglas) | — | ~0 |
| Generar fit comercial compacto | LLM | Haiku 4.5 | ~60–80/candidato aprobado |
| Generar sales angle profundo | LLM bajo demanda | Sonnet 4.6 | ~120–200/candidato bajo demanda |

**Objetivo de tokens IA por candidato (generación inicial):** 80–120 tokens IA/candidato — significativamente menor que el Prompt V2 (~300 tokens/candidato con todos los campos).

### 14.3 Prompt caching

La Capa 1 (reglas globales, ~150 tokens) es idéntica en cada ejecución → puede cachearse con Anthropic prompt caching.

**Ahorro estimado con cache:** Si la Capa 1 tiene cache hit → input efectivo ~50–70 tokens de contexto dinámico. Ahorro ~79% en input tokens de Capa 1 vs sin cache.

### 14.4 Modelo por tarea

| Tarea | Modelo recomendado | Justificación |
|-------|-------------------|---------------|
| Generación de hipótesis compactas | **Claude Haiku 4.5** | Alta frecuencia, contexto claro, output simple |
| Scoring de ambigüedad semántica | **Claude Haiku 4.5** | Tarea simple de clasificación |
| Resumen comercial bajo demanda | **Claude Sonnet 4.6** | Requiere razonamiento profundo de contexto |
| Análisis de cuenta (futuro Agente 3) | **Claude Sonnet 4.6 / Opus 4.7** | Mayor complejidad |

---

## 15. Modelo de scoring recomendado

### 15.1 `confidence_score` (0-100)

Mide qué tan confiable es la existencia y datos básicos del candidato. Basado en evidencia verificada — no en estimaciones del LLM.

| Señal | Puntos |
|-------|:------:|
| Website verificado (status: verified) | +25 |
| Website inferido (status: inferred) | +10 |
| LinkedIn verified | +10 |
| LinkedIn candidate | +5 |
| Tax ID disponible (de cualquier fuente) | +15 |
| Tax ID verificado en registry (status: verified) | +25 (total con el anterior: +25) |
| Estado activo confirmado en registry | +15 |
| Fuente P0 del catálogo como source_primary | +10 |
| HubSpot check = none (no duplicado) | +5 |
| HubSpot check = existing → score anulado | N/A |
| B2G signal (SECOP II, ChileCompra, etc.) | +10 |
| Más de 1 fuente corroborante | +5 |
| **Máximo** | **100** |

Umbrales:
- ≥ 80: Alta confianza — `approve` recomendado si fit_score ≥ 70
- 65–79: Confianza media — `needs_review` 
- 50–64: Confianza baja — `discard` recomendado a menos que fit sea muy alto
- < 50: No incluir en lote

### 15.2 `fit_score` (0-100)

Mide qué tan buen prospecto es esta empresa para UBITS. Combina reglas determinísticas con LLM cuando hay ambigüedad.

| Señal | Puntos |
|-------|:------:|
| Industria = target exacto | +30 |
| Industria = relacionada | +15 |
| Tamaño empresa ≥ 200 empleados | +20 |
| Tamaño empresa 50–199 empleados | +10 |
| Buyer area probable = L&D o Talento Humano | +20 |
| B2B (no consumer) | +15 |
| Señal de crecimiento o contratación activa | +10 |
| B2G signal (empresa activa vendiendo al Estado) | +5 |
| **Máximo** | **100** |

LLM interviene solo si la clasificación de `likely_buyer_area` o `industry_match` no puede determinarse por keywords — agrega ~30–50 tokens.

### 15.3 `data_completeness_score` (0-100)

| Campo | Puntos |
|-------|:------:|
| name | +20 |
| country + country_code | +15 |
| industry | +15 |
| website o domain (cualquier estado) | +15 |
| website verificado (status: verified) | +5 adicional |
| city o region | +10 |
| company_size | +10 |
| tax_identifier | +10 |
| **Máximo** | **100** |

### 15.4 `quality_label`

| Label | Condición |
|-------|-----------|
| `high_quality_new` | confidence ≥ 80 + fit ≥ 70 + post_check_status = new_candidate |
| `needs_review` | confidence 65–79 O fit 55–69 O post_check_status = possible_duplicate |
| `duplicate` | post_check_status = existing_in_hubspot O existing_in_sellup |
| `insufficient_data` | post_check_status = insufficient_data O confidence < 50 |
| `discard` | confidence < 50 Y fit < 55 |

---

## 16. Output recomendado

### Stage 1 — Candidate Hypothesis (output del LLM, compacto)

Lo que el LLM genera internamente antes de que las herramientas procesen el candidato:

```json
{
  "name": "Siigo",
  "country": "Colombia",
  "country_code": "CO",
  "industry": "Tecnología",
  "subsector": "SaaS / Software Contable",
  "city": "Bogotá",
  "why_candidate_short": "SaaS B2B colombiano en expansión LatAm con equipo comercial y técnico en crecimiento",
  "confidence_initial": 75,
  "suggested_sources": ["Supersociedades SIIS", "RUES"],
  "candidate_website_hypothesis": "siigo.com",
  "likely_buyer_area": "Talento Humano"
}
```

**Propósito:** Input para las herramientas de verificación. No se muestra al usuario — es estado interno del pipeline.

**Tokens estimados:** ~50–70 tokens/candidato.

---

### Stage 2 — Verified Prospect Candidate (guardado en `prospect_candidates.metadata`)

Lo que el pipeline produce después de correr todas las herramientas:

```json
{
  "name": "Siigo",
  "legal_name": "Siigo SAS",
  "normalized_name": "siigo",
  "country": "Colombia",
  "country_code": "CO",
  "city": "Bogotá",
  "region": "Cundinamarca",
  "industry": "Tecnología",
  "subsector": "SaaS / Software Contable",
  "company_size": "mediana",
  "tax_identifier": null,
  "tax_identifier_type": "NIT",
  "source_primary": "Supersociedades SIIS",
  "sources_checked": ["Supersociedades SIIS", "RUES"],
  "website_verification": {
    "website": "https://www.siigo.com",
    "domain": "siigo.com",
    "status": "verified",
    "http_status": 200,
    "page_title": "Siigo | Software Contable y ERP para Colombia",
    "name_match_signal": "exact",
    "confidence": "high",
    "evidence": "HTTP 200, title match ≥ 90%"
  },
  "linkedin_verification": {
    "linkedin_company_url": null,
    "status": "not_found",
    "search_query_used": "site:linkedin.com/company \"Siigo\" Colombia"
  },
  "registry_verification": {
    "tax_identifier": null,
    "tax_identifier_type": "NIT",
    "company_status": "unknown",
    "registry_source": "Supersociedades SIIS",
    "status": "pending_manual",
    "verification_query": "SIIS siis.ia.supersociedades.gov.co: buscar 'Siigo SAS'"
  },
  "sellup_duplicate_check": {
    "duplicate_status": "none",
    "matched_account_id": null,
    "matched_reason": "none",
    "confidence": "high"
  },
  "hubspot_duplicate_check": {
    "duplicate_status": "none",
    "matched_hubspot_company_id": null,
    "matched_reason": "none",
    "confidence": "high"
  },
  "post_check_status": "new_candidate",
  "scores": {
    "confidence_score": 80,
    "fit_score": 84,
    "data_completeness_score": 80,
    "quality_label": "high_quality_new",
    "recommended_action": "approve"
  },
  "commercial_relevance": {
    "why_relevant_for_ubits": "SaaS B2B colombiano con 1,000+ empleados; cultura de crecimiento rápido; equipo comercial activo.",
    "likely_buyer_area": "Talento Humano",
    "sales_angle": "Formación comercial y onboarding para equipos de ventas SaaS en expansión LatAm."
  },
  "evidence": [
    "Website verificado: HTTP 200, title match exacto",
    "Empresa listada en Supersociedades SIIS (vigilada)",
    "Adquirida por Visma 2020 — verificar autonomía local de L&D"
  ],
  "google_search_query": "Siigo Colombia sitio oficial LinkedIn empresa",
  "official_registry_search": "SIIS Supersociedades: buscar 'Siigo SAS'",
  "hubspot_search_key": "siigo.com"
}
```

---

## 17. MVP técnico recomendado

### Orden de construcción

| # | Componente | Descripción | Dependencias |
|---|-----------|-------------|-------------|
| 1 | **`catalog_context_retriever`** (estático) | JSON/DB indexado por country_code + industry desde el catálogo existente | Catálogo v0.2 ya disponible |
| 2 | **`sellup_duplicate_checker`** | Query a `accounts` y `prospect_candidates` por domain + normalized_name fuzzy | Tablas existentes en Supabase |
| 3 | **`hubspot_duplicate_checker`** | HubSpot API `/crm/v3/objects/companies/search` por domain → tax_id → name | HubSpot ya conectado y validado |
| 4 | **`web_search_tool`** | Integrar Tavily API para búsqueda de companies; configurar en `provider_pricing_config` | Requiere API key Tavily |
| 5 | **`website_verifier`** | HTTP HEAD/GET + title extraction + fuzzy match | Depende de web_search_tool para casos sin URL |
| 6 | **`candidate_scorer`** | Reglas determinísticas sobre outputs de etapas 2–5 | Todos los checkers anteriores |
| 7 | **`cost_logger`** | Integración con `provider_usage_logs` y `agent_run_steps` | Foundation de observabilidad ya documentada |
| 8 | **`candidate_writer`** | Persistir en `prospect_candidates` con metadata completa | Candidato scorer + todos los checks |
| 9 | **Orquestador del Agente 1** | Pipeline que encadena etapas 0–7 con estado | Todas las herramientas anteriores |
| 10 | **LLM hipótesis compactas** | Haiku 4.5 con Prompt V2 compacto (solo Stage 1) | `catalog_context_retriever` |
| 11 | **UI del lote** | Contadores + filtros + secciones colapsadas + actions | `candidate_writer` + design system |
| 12 | **Apollo fallback (apagado)** | Herramienta disponible pero `use_apollo_fallback: false` por defecto | Apollo ya conectado |

### Configuración inicial del pipeline

- Apollo fallback: `OFF` por defecto
- Lusha: fuera del pipeline del Agente 1
- Máximo candidatos por lote: 25
- Modelo de hipótesis: Claude Haiku 4.5
- Web search provider: Tavily (primera opción)
- Deduplicación HubSpot: obligatoria, no configurable
- Deduplicación SellUp: obligatoria, no configurable
- `linkedin_company_finder`: Fase 2 (no MVP)
- `registry_lookup_tool` avanzado: Fase 2 (MVP usa datasets estáticos de Colombia/México/Chile/Perú/Ecuador)

### Primer hito técnico recomendado

> **Construir y probar el pipeline de deduplicación antes de cualquier otra cosa.**

El pipeline de deduplicación (`sellup_duplicate_checker` + `hubspot_duplicate_checker`) resuelve el problema más urgente detectado en la validación manual (empresas existentes en HubSpot presentadas como nuevas). Este hito:

1. Puede probarse con datos reales contra HubSpot real.
2. No requiere web search ni LLM — es 100% determinístico.
3. Valida el mapping de campos de `HUBSPOT_ACCOUNT_FIELD_MAPPING.md`.
4. Establece la base para todos los demás componentes.

**Estimación de esfuerzo:** 1–2 días de implementación + pruebas.

---

## 18. Riesgos y límites

### Riesgos técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|:------------:|:-------:|------------|
| Tavily no tiene cobertura suficiente para países small LatAm | Media | Alto | Tener Exa como fallback; evaluar con queries reales antes de commit |
| HubSpot API rate limits durante deduplicación masiva | Baja | Alto | Cache de resultados de HubSpot por domain; batch queries |
| Datasets estáticos de catálogo desactualizados | Alta (se desactualización es gradual) | Medio | Proceso de actualización semestral del catálogo |
| Fuzzy matching produce falsos positivos | Media | Medio | Threshold conservador (≥85%); `possible` en lugar de `existing` |
| Website verifier marca como `mismatch` sitios legítimos con títulos atípicos | Media | Medio | Threshold ajustable; LLM como fallback en casos borderline |
| Costo de web search escala más de lo esperado | Baja-Media | Medio | Cap de costo por lote; alert en `cost_logger`; máximo 3 queries/candidato |
| LinkedIn búsqueda retorna resultados irrelevantes | Media | Bajo | Solo Fase 2; `google_search_query` cubre el caso manual en MVP |

### Límites del diseño

| Límite | Descripción |
|--------|-------------|
| **El LLM sigue siendo probabilístico** | Las hipótesis del LLM pueden incluir empresas inexistentes; la verificación web debe atrapar estos casos |
| **Web search no es omnisciente** | Empresas pequeñas o sin presencia web visible pueden no ser encontradas; se reporta honestamente |
| **LinkedIn finder solo vía búsqueda pública** | Sin API de LinkedIn; cobertura limitada a lo indexado públicamente |
| **Datasets estáticos tienen lag** | SIIS, SUNAT Padrón, etc. tienen actualización periódica, no diaria para todos los campos |
| **HubSpot fuzzy matching es heurístico** | El match por nombre ≥ 85% puede fallar con variantes de nombres; los casos ambiguos se marcan `possible` |
| **Apollo OFF por defecto** | Para países con cobertura pública débil (Honduras, Nicaragua, Bolivia) el agente puede generar menos candidatos que el target |
| **Centroamérica tiene cobertura limitada** | Honduras, Nicaragua, Guatemala, El Salvador, Bolivia — validación automática limitada; más trabajo manual |

---

## 19. Criterios de éxito

### Métricas de producción — Agente 1

| Métrica | Descripción | Meta inicial MVP |
|---------|-------------|:----------------:|
| `new_candidates_rate` | new_candidate / total_generados | ≥ 60% |
| `hubspot_dedup_precision` | Duplicados HubSpot detectados correctamente / total existentes | ≥ 95% |
| `hubspot_false_positive_rate` | Candidatos marcados "nuevos" que el usuario marcó como duplicados | < 5% |
| `website_verification_rate` | Candidatos con website verified o inferred / total candidatos | ≥ 70% |
| `human_approval_rate` | new_candidate aprobados / new_candidate presentados | ≥ 50% |
| `cost_per_new_candidate` | Costo total lote / new_candidates | < $0.015 USD |
| `cost_per_approved_candidate` | Costo total lote / aprobados | < $0.025 USD |
| `tokens_per_candidate_ia` | Tokens LLM / candidato (solo hipótesis, no scoring profundo) | ≤ 120 tokens |
| `human_review_time_per_batch` | Tiempo real del usuario revisando un lote de 15 | < 20 min |
| `execution_time_seconds` | Tiempo total del pipeline (generación + verificación + dedup + scoring) | < 120 seg |

### Métricas de calidad de datos

| Métrica | Descripción | Meta |
|---------|-------------|:----:|
| `website_verified_rate` | Candidatos con `status: verified` / total | ≥ 50% |
| `linkedin_found_rate` | Candidatos con LinkedIn verified o candidate / total | ≥ 30% (Fase 2) |
| `tax_id_available_rate` | Candidatos con tax_identifier no null / total | ≥ 40% (para países Tier 1) |
| `data_completeness_avg` | Promedio de data_completeness_score del lote | ≥ 70 |

### Criterios de éxito del MVP

El Agente 1 MVP es exitoso si cumple **todos** los siguientes criterios:

1. ✅ El sistema verifica automáticamente contra HubSpot y SellUp **antes** de presentar candidatos.
2. ✅ El usuario recibe el lote con candidatos clasificados (new/existing/duplicate/insufficient).
3. ✅ `hubspot_dedup_precision ≥ 95%` en las primeras 10 ejecuciones reales.
4. ✅ `human_approval_rate ≥ 50%` para candidatos `new_candidate`.
5. ✅ `cost_per_new_candidate < $0.015 USD`.
6. ✅ El usuario puede revisar, aprobar y pedir conversión desde una sola pantalla.
7. ✅ Ningún registro se crea en HubSpot sin aprobación explícita.
8. ✅ Costo total del lote visible antes y después de ejecutar.
9. ✅ Todo `agent_run` tiene trazabilidad completa en `agent_run_steps` y `provider_usage_logs`.

---

## 20. Recomendación final

### Cómo debe construirse el Agente 1

> **El Agente 1 de SellUp debe construirse como un pipeline tool-first por etapas, donde el LLM genera hipótesis compactas, las herramientas verifican y deduplicán con fuentes reales, el scorer consolida la evidencia de forma determinística, y el humano evalúa calidad comercial — nunca busca duplicados manualmente.**

### Resumen de decisiones arquitectónicas

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| Arquitectura | Pipeline tool-first por etapas | Separación de responsabilidades; verificación determinística |
| Modelo hipótesis | Claude Haiku 4.5 | Costo bajo, tarea clara y repetitiva |
| Modelo scoring profundo / sales angle | Claude Sonnet 4.6 bajo demanda | Solo para candidatos aprobados; mejor costo-calidad |
| Web search MVP | Tavily (primera opción) | Diseñado para agentes; JSON estructurado; costo razonable |
| Web scraping | Firecrawl (complemento) | Para website_verifier con mayor fidelidad |
| LinkedIn | Búsqueda pública (sin scraping) | Respetar ToS; Fase 2 |
| Registry verificación | Datasets estáticos pre-cargados (Tier 1) | Elimina latencia y dependencias externas |
| Deduplicación HubSpot | Obligatoria, automática, no configurable | Regla de negocio crítica |
| Deduplicación SellUp | Obligatoria, automática, antes de HubSpot | Costo cero; detecta duplicados internos primero |
| Apollo | OFF por defecto; disponible como fallback | Priorizar calidad sobre volumen |
| Lusha | Fuera del Agente 1 | Solo para enriquecimiento de contactos post-aprobación |
| Catálogo | Lookup estático para MVP; RAG vectorial en Fase 2 | Suficiente para MVP; más escalable después |
| Prompt caching | Activar en Capa 1 (reglas globales) | Ahorro ~79% en input tokens de esa capa |
| Máximo candidatos | 25 por lote | Límite MVP documentado |

### Primer hito técnico

**Construir y validar el pipeline de deduplicación (`sellup_duplicate_checker` + `hubspot_duplicate_checker`) contra datos reales de HubSpot.** Este es el componente que resuelve el problema más urgente y de mayor impacto inmediato en la experiencia del usuario. Todo lo demás puede construirse sobre esa base.

### Nota sobre herramientas de web search

Las recomendaciones de Tavily como primera opción y Exa como segunda están basadas en información pública disponible a la fecha. **Antes de integrar cualquier herramienta de web search, se debe:**

1. Verificar pricing actual en los sitios oficiales de cada proveedor.
2. Ejecutar un test de calidad con 20–30 queries de empresas reales en LatAm.
3. Revisar ToS para uso en pipelines automatizados.
4. Confirmar disponibilidad de SDK para TypeScript/Node.js.

Ninguna herramienta fue llamada durante la elaboración de este documento — todas las recomendaciones son basadas en conocimiento de arquitectura y características publicadas.

---

## Estado Git

```
On branch main

Archivos creados en esta sesión:
  docs/AGENTE_1_RESEARCH_SPIKE_ARQUITECTURA_Y_HERRAMIENTAS.md  ← NUEVO (este documento)

Sin commits realizados.
Sin código modificado (.ts / .tsx / .js).
Sin migraciones creadas.
Sin APIs reales llamadas.
Sin empresas creadas en HubSpot ni SellUp.
No se llamó a Apollo, Lusha, ni ningún proveedor de IA de SellUp.
```

---

*Documento creado: 2026-05-22*  
*Roles activos: Principal AI Architect · Agentic Workflow Engineer · Cost Optimization Analyst · Product Architect · Technical Researcher*  
*No se llamaron APIs reales. No se modificó código. No se hicieron commits. No se crearon migraciones.*  
*Datos de pricing de herramientas web marcados como estimados — pendiente de validación antes de integrar.*
