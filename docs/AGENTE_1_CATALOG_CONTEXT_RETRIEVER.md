# Agente 1 — Catalog Context Retriever

**Versión:** 1.0  
**Hito:** 2 — Catalog Context Retriever  
**Fecha:** 2026-05-22  
**Estado:** Implementado y validado  
**Complementa:** [AGENTE_1_DEDUPLICACION_SELLUP_HUBSPOT.md](./AGENTE_1_DEDUPLICACION_SELLUP_HUBSPOT.md)

---

## Objetivo

La `tool catalog_context_retriever` del `sellup_prospecting_toolkit` resuelve un problema concreto de eficiencia: el catálogo completo de fuentes LatAm tiene 17 países y decenas de fuentes. Si se enviara completo al LLM en cada ejecución, se desperdiciarían miles de tokens y se introduciría ruido irrelevante (fuentes de otros países, sectores no aplicables, fuentes prohibidas como Lusha en discovery).

Esta herramienta retorna **solo el contexto necesario** para una ejecución específica: las fuentes correctas para el país e industria dados, los riesgos conocidos, las reglas operativas y un `promptContext` listo para inyectar.

---

## Por qué reduce tokens

| Enfoque anterior | Con catalog_context_retriever |
|---|---|
| Se enviaba todo el catálogo Markdown al LLM | Solo se envía el `promptContext` compacto |
| ~4.000–8.000 tokens por ejecución solo en catálogo | ~200–400 tokens por ejecución |
| Incluye fuentes de los 17 países aunque no apliquen | Solo fuentes del país + sector solicitado |
| El LLM debe filtrar mentalmente qué aplica | Llega pre-filtrado, ordenado por prioridad |
| Riesgo de que el LLM use Lusha para discovery | Lusha excluida explícitamente del contexto |
| Apollo puede colarse como fuente principal | Apollo solo aparece como `[fallback pagado]` en modo deep |

---

## Inputs

```typescript
type CatalogContextInput = {
  country: string;       // "Colombia"
  countryCode: string;   // "CO" (normalizado a uppercase internamente)
  industry: string;      // "Tecnología", "Textil / manufactura", "Salud"
  searchDepth?: SearchDepth; // "basic" | "standard" | "deep" — default: "standard"
};
```

### searchDepth

| Valor | Fuentes incluidas | Cuándo usar |
|---|---|---|
| `basic` | Solo P0 (fuentes primarias oficiales) | Presupuesto de tokens muy ajustado o exploración rápida |
| `standard` | P0 + P1 (oficiales + complementarias) | Uso habitual — balance entre cobertura y costo |
| `deep` | P0 + P1 + P2 (incluye fallback global) | Cuando fuentes de país no alcanzan el objetivo; habilita OpenCorporates y Apollo como último recurso |

---

## Outputs

```typescript
type CatalogContextResult = {
  country: string;
  countryCode: string;
  industry: string;
  searchDepth: SearchDepth;
  fiscalIdentifierLabel: string | null;   // "NIT", "RFC", "RUT", etc.
  recommendedSources: CatalogSource[];    // máx. 6 — Lusha excluida
  sectorSources: CatalogSource[];         // fuentes sectoriales específicas del país
  risks: string[];                        // máx. 5 riesgos conocidos del país
  operatingRules: string[];               // reglas globales + sectoriales (máx. ~8)
  coverageNotes: string[];                // notas de cobertura y limitaciones del modo
  promptContext: string;                  // texto compacto para inyectar al LLM
};
```

---

## Fuentes MVP incluidas

### Colombia (CO)

| Fuente | Clave | Prioridad | Tipo | Sectores |
|---|---|---|---|---|
| Supersociedades SIIS | `co_siis` | P0 | official_registry | Todos |
| datos.gov.co | `co_datos_gov` | P0 | public_dataset | Todos |
| RUES | `co_rues` | P0 | official_registry | Todos |
| SECOP II | `co_secop2` | P1 | procurement | Todos |
| MinSalud REPS | `co_minsalud_reps` | P0 | official_registry | Salud |
| Superfinanciera | `co_superfinanciera` | P0 | official_registry | Financiero |

### México (MX)

| Fuente | Clave | Prioridad | Tipo | Sectores |
|---|---|---|---|---|
| DENUE / INEGI API | `mx_denue` | P0 | official_registry | Todos |
| SIEM | `mx_siem` | P1 | official_registry | Todos |
| CANAIVE | `mx_canaive` | P1 | industry_association | Textil |
| AMIA | `mx_amia` | P1 | industry_association | Automotriz |

### Chile (CL)

| Fuente | Clave | Prioridad | Tipo | Sectores |
|---|---|---|---|---|
| RES / datos.gob.cl | `cl_res` | P0 | official_registry | Todos |

### Perú (PE)

| Fuente | Clave | Prioridad | Tipo | Sectores |
|---|---|---|---|---|
| SUNAT Padrón RUC | `pe_sunat` | P0 | official_registry | Todos |
| OSCE / SEACE | `pe_seace` | P1 | procurement | Todos |
| PRODUCE Manufactura | `pe_produce` | P1 | public_dataset | Manufactura |

### Ecuador (EC)

| Fuente | Clave | Prioridad | Tipo | Sectores |
|---|---|---|---|---|
| SCVS / Supercias | `ec_scvs` | P0 | official_registry | Todos |
| SERCOP | `ec_sercop` | P1 | procurement | Todos |

### Brasil (BR)

| Fuente | Clave | Prioridad | Tipo | Sectores |
|---|---|---|---|---|
| Receita Federal CNPJ | `br_receita_cnpj` | P0 | official_registry | Todos |
| cnpj.ws | `br_cnpj_ws` | P1 | commercial_provider | Todos |

### Globales / Fallback

| Fuente | Clave | Prioridad | Disponible en |
|---|---|---|---|
| OpenCorporates | `global_opencorporates` | P2 | deep mode o sin fuente de país |
| Apollo.io | `global_apollo` | P2 | deep mode únicamente — labeled `[fallback pagado]` |
| Lusha | `global_lusha` | P2 | **Nunca en recommendedSources** — solo enriquecimiento |

---

## Reglas de recuperación

### Priorización de fuentes

1. Las fuentes **sector-matched** del país aparecen primero (más relevantes).
2. Luego las fuentes **genéricas** del país, ordenadas por P0 → P1 → P2.
3. En modo `deep` o cuando no hay fuentes del país, se añade fallback global.
4. **Lusha**: siempre excluida de `recommendedSources`.
5. **Apollo**: solo en modo `deep`, marcado como `[fallback pagado]`.
6. **Máximo 6 fuentes** en `recommendedSources`.

### Reglas globales (siempre presentes)

- No usar Lusha para discovery.
- Apollo solo como fallback explícito.
- HubSpot duplicate check obligatorio antes de presentar empresa como nueva.
- No inventar website, LinkedIn, ni datos de contacto.
- Máximo 25 empresas candidatas por ejecución.
- Usar identificador fiscal como ancla de deduplicación.

### Reglas sectoriales (se añaden si aplican)

| Sector detectado | Regla añadida |
|---|---|
| Salud | Verificar habilitación en REPS (CO) o equivalente sectorial |
| Financiero/Fintech | Usar registro de entidades supervisadas del regulador |
| Textil/Moda | Incluir cámaras sectoriales (CANAIVE, INEXMODA) |
| Automotriz | Priorizar directorio AMIA o equivalente OEM/Tier |
| Tech/Software | Validar que la empresa realmente presta servicios tech |
| Capacitación/HR (CL) | Usar SENCE OTEC como fuente primaria |

---

## Ejemplos de promptContext

### Colombia / Tecnología / standard

```
País: Colombia (CO)
Industria: Tecnología
Identificador fiscal: NIT

Fuentes recomendadas:
1. Supersociedades SIIS — Discovery de empresas medianas/grandes supervisadas.
2. datos.gov.co — Datasets públicos con señales empresariales.
3. RUES — Discovery amplio por NIT. Cubre micro hasta grandes.
4. SECOP II — Identificar proveedores del Estado colombiano.

Riesgos:
- SIIS/Supersociedades cubre principalmente empresas medianas/grandes.
- RUES puede tener datos desactualizados en sectores informales.
- SECOP II solo cubre proveedores del Estado.

Reglas:
- No usar Lusha para discovery; solo enriquecimiento de contactos bajo demanda.
- Apollo solo como fallback explícito cuando fuentes públicas no alcanzan el objetivo.
- HubSpot duplicate check obligatorio antes de presentar empresa como nueva.
- No inventar website, LinkedIn, ni datos de contacto.
- Máximo 25 empresas candidatas por ejecución.
```

### México / Textil / standard

```
País: México (MX)
Industria: Textil / manufactura
Identificador fiscal: RFC

Fuentes recomendadas:
1. CANAIVE — Discovery en industria textil mexicana.
2. DENUE / INEGI API — Discovery principal en México. API con 5M+ establecimientos.
3. SIEM — Complemento a DENUE para PYMES con datos de contacto.

Riesgos:
- DENUE API tiene límite de registros por consulta; paginar correctamente.
- SIEM puede tener datos con 1-2 años de antigüedad.
- No todas las empresas tienen RFC público en DENUE.

Reglas:
- No usar Lusha para discovery; solo enriquecimiento de contactos bajo demanda.
- Apollo solo como fallback explícito cuando fuentes públicas no alcanzan el objetivo.
- HubSpot duplicate check obligatorio antes de presentar empresa como nueva.
- No inventar website, LinkedIn, ni datos de contacto.
- Máximo 25 empresas candidatas por ejecución.
- Incluir cámaras sectoriales (CANAIVE en MX, INEXMODA en CO) como fuente gremial.
```

---

## Límites conocidos

1. **Cobertura MVP**: solo 6 países (CO, MX, CL, PE, EC, BR). Los 11 países restantes del catálogo completo retornan fallback global.
2. **Industria por keywords**: la detección de sector es por coincidencia de texto normalizado. Si el usuario escribe una industria muy atípica, puede no matchear fuentes sectoriales.
3. **Sin validación de disponibilidad de fuentes**: la tool no verifica si las URLs están activas ni si las APIs tienen límites actuales.
4. **Salud en Chile**: no existe equivalente al REPS colombiano. La cobertura sectorial de salud en CL es genérica (RES). `cl_chilecompra` fue descartada del MVP activo por requerir ticket/API key, tener cobertura limitada a proveedores B2G y no representar el universo empresarial chileno. Puede reconsiderarse post-MVP si existe una necesidad explícita de discovery B2G.
5. **Datos estáticos**: el catálogo no se actualiza dinámicamente. Los cambios en fuentes externas requieren actualizar `source-catalog.ts`.

---

## Próximo paso

**Hito 3**: Integrar `catalog_context_retriever` + `checkCompanyDuplicate` en el flujo del Agente 1 como tools del SDK de Claude, de modo que el agente pueda:

1. Llamar a `getCatalogContext` para obtener el `promptContext` relevante.
2. Usar ese contexto para guiar la búsqueda de empresas candidatas.
3. Llamar a `checkCompanyDuplicate` por cada candidata antes de presentarla.
