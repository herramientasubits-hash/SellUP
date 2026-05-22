# Agente 1 — Tavily Query Builder & Filtro Anti-Ruido

**Hito:** 7C  
**Fecha:** 2026-05-22  
**Autor:** Principal Product Engineer / Search Relevance Engineer  
**Estado:** ✅ MEJORA CONFIRMADA

---

## 1. Problema detectado en Hito 7B

La query original era:

```
empresas {industry} {country} B2B software
```

Esta query genérica atraía un alto volumen de ruido:

| Tipo de ruido | Ejemplos detectados en 7B |
|---|---|
| Job boards | co.computrabajo.com, indeed.com |
| Blog articles | blog.castelec.mx, posts con fecha en URL |
| Social posts | linkedin.com/posts/*, twitter.com/status/* |
| Software directories | comparasoftware.com, ensun.io |
| Startup databases | f6s.com, crunchbase.com |
| Directorios genéricos | guiatic.com/co/directorio |

**Causa raíz:** El término `"B2B software"` activa resultados de directorios de software, comparadores y artículos sobre herramientas para industrias — no sobre empresas de esas industrias.

---

## 2. Cambios implementados

### Nuevos archivos

| Archivo | Propósito |
|---|---|
| `src/server/agents/prospecting-toolkit/query-builder.ts` | Query builder con lógica de sector + exclusiones |
| `src/server/agents/prospecting-toolkit/noise-filter.ts` | Clasificador y filtro anti-ruido determinístico |

### Archivos actualizados

| Archivo | Cambio |
|---|---|
| `web-search-tool.ts` | Integra `filterNoiseResults` en el post-processing; re-exporta desde `query-builder.ts` |
| `index.ts` | Exporta `classifySearchResult`, `filterNoiseResults`, y los tipos del noise filter |

---

## 3. Query builder mejorado

### Lógica de construcción

1. **Detectar si el sector es tech/TIC:** Si la industria contiene keywords como `tecnología`, `software`, `tic`, `digital`, `saas`, se permite usar términos de tech. Si no, se evita.

2. **Seleccionar término primario de sector:** Mapeado por industria:
   - Textil → `industria textil` / `empresas textiles`
   - Salud → `sector salud` / `empresas sector salud`
   - Financiero → `sector financiero` / `empresas financieras`
   - Automotriz → `industria automotriz`
   - etc.

3. **Agregar señales de empresa:** `empresa corporativo` (o `sector TIC corporativo` para tech).

4. **Incluir exclusiones `-site:`:** Subset compacto de los dominios más ruidosos.

### Queries generadas (vs. antes)

| Caso | Query anterior | Query nueva |
|---|---|---|
| Colombia / Tecnología | `empresas Tecnología Colombia B2B software` | `empresas Tecnología Colombia sector TIC corporativo -site:computrabajo.com -site:indeed.com -site:glassdoor.com -site:comparasoftware.com` |
| México / Textil | `empresas Textil México B2B software` | `industria textil México empresa corporativo -site:computrabajo.com -site:indeed.com -site:glassdoor.com -site:comparasoftware.com` |
| Chile / Salud | `empresas Salud Chile B2B software` | `sector salud Chile empresa corporativo -site:computrabajo.com -site:indeed.com -site:glassdoor.com -site:comparasoftware.com` |

### API pública

```typescript
// Query única
buildCompanyDiscoveryQuery({ industry, country, intent?, catalogSourceUrls? }): string

// Múltiples queries candidatas para búsquedas paralelas
buildSectorSpecificSearchTerms({ industry, country, catalogSourceUrls? }): string[]

// Lista de exclusiones -site:
buildNoiseExclusionTerms(): string[]
```

---

## 4. Filtro anti-ruido

### Clasificador determinístico

`classifySearchResult(result)` → `{ resultType, shouldKeep, reason }`

**Orden de evaluación:**

1. Posts sociales (`/posts/`, `/pulse/`, `/status/`) → `social_post`, skip
2. LinkedIn company pages (`/company/`) → `company_profile`, keep
3. Job boards (incluyendo subdominios como `co.computrabajo.com`) → `job_board`, skip
4. Directorios de software → `software_directory`, skip
5. Bases de datos de startups → `startup_database`, skip
6. Directorios genéricos → `directory`, skip
7. Subdominio blog (`blog.*`, `blogs.*`) → `blog_article`, skip
8. Patrón blog en URL (`/blog/`, `/noticias/`, etc.) → `blog_article`, skip
9. Año en URL (`/2024/`, `/2025/`) → `blog_article`, skip
10. Default → `official_company_site`, keep

**Detección de subdominios:** `domainMatchesSet()` verifica tanto el dominio exacto como variantes con subdominio (ej: `co.computrabajo.com` → detecta `computrabajo.com`).

### Tabla de clasificación (fixtures validados)

| URL / dominio | Tipo detectado | Acción |
|---|---|---|
| co.computrabajo.com | job_board | skip |
| glassdoor.com | job_board | skip |
| blog.castelec.mx | blog_article | skip |
| alguna-empresa.com/2025/nota | blog_article | skip |
| linkedin.com/posts/xyz | social_post | skip |
| comparasoftware.com | software_directory | skip |
| ensun.io | startup_database | skip |
| f6s.com | startup_database | skip |
| crunchbase.com | startup_database | skip |
| guiatic.com | directory | skip |
| linkedin.com/company/empresa | company_profile | keep |
| kcpdynamics.com | official_company_site | keep |
| grupoexito.com.co | official_company_site | keep |
| cemex.com.mx | official_company_site | keep |

**Resultado fixtures:** 14/14 ✅

### Metadata en resultados

Cada `WebSearchResult` sale del pipeline con metadata de clasificación:

```json
{
  "result_type": "official_company_site",
  "noise_filtered": false,
  "filter_reason": "Dominio sin patrones de ruido"
}
```

El `WebSearchOutput` incluye:

```json
{
  "metadata": {
    "noise_filter": {
      "raw_results_count": 8,
      "kept_count": 7,
      "filtered_out_count": 1,
      "filtered_domains": ["sciencedirect.com"]
    }
  }
}
```

---

## 5. Validación local (Parte F)

Script: `scripts/tmp-test-query-builder.mjs` (eliminado tras validación)

| Validación | Resultado |
|---|---|
| Query Colombia/Tecnología sin "B2B software" | ✅ |
| Query México/Textil con término sectorial | ✅ |
| Query Chile/Salud con término sectorial | ✅ |
| Todas las queries incluyen país | ✅ |
| Todas las queries incluyen exclusiones `-site:` | ✅ |
| 14/14 fixtures de noise filter | ✅ |

---

## 6. Validación Tavily real (Parte G)

Script: `scripts/tmp-test-tavily-query-builder.mjs` (eliminado tras validación)

| Caso | Crudos | Útiles | Ruido | % Útil | Tipos de ruido |
|---|---|---|---|---|---|
| Colombia / Tecnología | 8 | 7 | 1 | 88% ✅ | blog_article |
| México / Textil | 8 | 8 | 0 | 100% ✅ | ninguno |
| Chile / Salud | 8 | 6 | 2 | 75% ✅ | blog_article |
| **Promedio** | **8** | **7** | **1** | **88% ✅** | |

**Objetivo mínimo:** 60%. **Resultado:** 88%. ✅

### Comparativa Hito 7B vs 7C

| Caso | Útiles 7B (estimado) | Útiles 7C | Mejora |
|---|---|---|---|
| Colombia / Tecnología | ~40-50% | 88% | +38-48pp |
| México / Textil | ~50-60% | 100% | +40-50pp |
| Chile / Salud | ~50-60% | 75% | +15-25pp |

### Falsos positivos remanentes (edge cases)

Algunos resultados pasan el filtro pero no son sitios de empresa directamente:
- Instagram/YouTube/Facebook (falta lista de redes sociales para URLs no-post)
- PDFs académicos o de gobierno (contenido útil pero no empresas directas)
- `glassdoor.com.mx` (variante de TLD no cubierta por el set actual)

Estos edge cases se pueden abordar en una iteración futura sin bloquear el avance actual.

---

## 7. Seguridad

| Verificación | Estado |
|---|---|
| No DB writes | ✅ |
| No prospect_batches | ✅ |
| No accounts | ✅ |
| No HubSpot write | ✅ |
| No Apollo | ✅ |
| No Lusha | ✅ |
| No IA | ✅ |
| API key no impresa | ✅ |
| Provider default sigue siendo `mock` | ✅ |
| Tavily no expuesta en UI | ✅ |

---

## 8. Validaciones técnicas

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ Sin errores |
| `npm run build` | ✅ Build exitoso |

---

## 9. Estado Git

| Verificación | Estado |
|---|---|
| Scripts temporales eliminados | ✅ `tmp-test-query-builder.mjs`, `tmp-test-tavily-query-builder.mjs` |
| Sin secrets en código | ✅ |

**Nota:** No se hizo commit según las reglas del Hito 7C.

---

## 10. Recomendación final

**Veredicto:** ✅ Query builder mejoró calidad y Tavily puede pasar a fase controlada.

**Próximos pasos sugeridos:**

1. **Commit del query builder** — Los cambios en `query-builder.ts`, `noise-filter.ts`, `web-search-tool.ts` e `index.ts` están listos para commit.

2. **Iteración de cobertura del noise filter** — Agregar redes sociales (Instagram, YouTube, Facebook) y variantes de TLD (`.com.mx`, `.com.ar`) a las listas del filtro.

3. **Backend controlado** — Tavily puede usarse en producción con:
   - Provider `tavily` explícito (no cambia el default `mock`)
   - `maxResults` limitado (≤10 por búsqueda)
   - Filtro anti-ruido activo (ya integrado en `runWebSearch`)
   - Sin persistencia automática (requiere aprobación manual)
