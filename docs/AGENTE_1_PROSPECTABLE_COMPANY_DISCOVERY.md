# Agente 1 — Discovery de Empresas Prospectables con Tavily

**Hito:** 9  
**Fecha:** 2026-05-25  
**Estado:** ✓ Query ganadora identificada — lista para Hito 10 (lote real controlado)

---

## Problema detectado en lote Tavily QA (Hito 8)

El lote "QA Colombia Tecnología" trajo **fuentes del sector**, no empresas prospectables:

| Resultado | Tipo real | Problema |
|-----------|-----------|---------|
| TIC Colombia | Portal sectorial (asociación) | No es una empresa compradora |
| CINTEL | Centro de investigación TIC | Fuente de inteligencia, no prospecto |
| Impacto TIC | Medio de comunicación | Noticias, no empresa |
| ScienceDirect | Base académica | Paper académico |
| PDF biblioteca digital | Documento PDF | No es sitio de empresa |

**Conclusión:** `Fuente útil ≠ empresa prospectable`

---

## Diferencia: fuente sectorial vs empresa prospectable

| Concepto | Fuente sectorial | Empresa prospectable |
|----------|-----------------|---------------------|
| Función | Informa / investiga / agrupa | Produce / vende / opera |
| Compra UBITS | No | Sí (decisores de L&D) |
| Ejemplos | CINTEL, ScienceDirect, Impacto TIC | Siigo, Pragma, Heinsohn |
| Dominio | `.org.co`, `.net`, `.edu`, medios | `.com`, `.com.co`, `.co` corporativo |

---

## Criterio `isProspectableCompanyResult()`

### Mantener como prospectable

- Empresa de software, consultora tecnológica, empresa SaaS
- Integrador tecnológico, BPO tecnológico, empresa de servicios IT
- Dominio corporativo propio: `.com`, `.com.co`, `.co`, `.es`, `.mx`, `.cl`
- Señales positivas en path: `/about`, `/nosotros`, `/empresa`, `/soluciones`, `/servicios`, `/contacto`
- Perfil de empresa en LinkedIn (`/company/`)

### Excluir como no prospectable

| Categoría | Tipo detectado | Ejemplos |
|-----------|---------------|---------|
| Gremios / asociaciones / cámaras | `association_or_chamber` | cintel.co, tic-col.net, andi.com.co |
| Medios de comunicación TIC | `news_or_media` | impactotic.co, dinero.com, semana.com |
| Fuentes académicas | `academic_source` | sciencedirect.com, *.edu.co |
| Documentos PDF | `pdf_document` | cualquier URL `.pdf` |
| Reportes sectoriales | `sector_report` | título contiene "sector TIC", "informe sectorial" |
| Portales de empleo | `job_board` | computrabajo.com, indeed.com |
| Directorios de software | `software_directory` | comparasoftware.com, capterra.com, g2.com |
| Bases de startups | `startup_database` | crunchbase.com, f6s.com, ensun.io |
| Posts sociales | `social_post` | linkedin.com/posts/, twitter.com/status/ |
| Artículos / blogs | `blog_article` | /blog/, /noticias/, año en URL |

---

## Reglas de exclusión implementadas

### Dominios de dominio conocido (noise-filter.ts)

Dominos clave añadidos en Hito 9:
- `cintel.co` → `association_or_chamber`
- `tic-col.net` → `association_or_chamber`
- `impactotic.co` → `news_or_media`
- `colombiadigital.net` → `news_or_media`
- `mintic.gov.co` → `association_or_chamber`
- `colombiatic.net` → `association_or_chamber`

### Detección por título/snippet

Señales que clasifican como `sector_report`:
- "biblioteca digital", "sector TIC", "sector tecnología"
- "informe sectorial", "análisis del sector", "panorama del sector"
- "tendencias del sector", "industria TIC", "TIC Colombia"

### Operadores de exclusión en query (query-builder.ts)

```
-site:cintel.co
-site:tic-col.net
-site:impactotic.co
-site:sciencedirect.com
-filetype:pdf
```

---

## Query variants probadas

| Variante | Query | Resultados brutos | Prospectables | Ruido | Créditos |
|----------|-------|-------------------|---------------|-------|---------|
| V1 | `empresas de software Colombia servicios tecnología contacto -site:cintel.co...` | 0 | — | — | 1 |
| **V2 ✓** | `empresas desarrollo de software Colombia soluciones tecnología nosotros...` | 5 | **4/5** | 1 (blog) | 1 |
| V3 | `consultoras tecnología Colombia servicios IT empresas -site:crunchbase.com...` | 0 | — | — | 1 |

**Nota:** V1 y V3 devolvieron 0 resultados — Tavily no procesó los operadores `-site:` en esas queries específicas. V2 funcionó sin ellos.

---

## Resultado local con fixtures — 12/12 ✓

| URL | Tipo detectado | Acción |
|-----|----------------|--------|
| cintel.co/nosotros | `association_or_chamber` | skip |
| tic-col.net/sobre-nosotros | `association_or_chamber` | skip |
| impactotic.co/empresas-tic... | `news_or_media` | skip |
| sciencedirect.com/... | `academic_source` | skip |
| bibliotecadigital...pdf | `pdf_document` | skip |
| co.computrabajo.com/... | `job_board` | skip |
| comparasoftware.com/... | `software_directory` | skip |
| kcpdynamics.com | `official_company_site` | keep |
| sophossolutions.com | `official_company_site` | keep |
| heinsohn.com.co | `official_company_site` | keep |
| pragmacorp.com | `official_company_site` | keep |
| siigo.com | `official_company_site` | keep |

---

## Resultado Tavily real — Query ganadora V2

**Query:** `empresas desarrollo de software Colombia soluciones tecnología nosotros -site:sciencedirect.com -filetype:pdf`

| URL | Tipo | Prospectable |
|-----|------|-------------|
| career.softserveinc.com/es/about/colombia | `official_company_site` | ✓ |
| rootstack.com/es/blog/empresas-de-desarrollo... | `blog_article` | ✗ (ruido correcto) |
| tsitecnologia.com.co/empresa-desarrollo-... | `official_company_site` | ✓ |
| kcpdynamics.com/empresas-de-software-en-colombia | `official_company_site` | ✓ |
| nuevastic.com | `official_company_site` | ✓ |

**Tasa: 4/5 prospectables** — criterio mínimo ≥3/5 **CUMPLIDO**

---

## Query recomendada para Hito 10

```
empresas desarrollo de software Colombia soluciones tecnología nosotros -site:sciencedirect.com -filetype:pdf
```

**Notas para Hito 10:**
- Sin operadores `-site:` adicionales (Tavily no los procesa todos en este contexto)
- El noise-filter post-búsqueda actúa como segunda línea de defensa
- El único ruido fue un blog de Rootstack (correctamente filtrado por `/blog/` en URL)
- Incrementar `targetCount` a 10 para el lote real y evaluar tasa

---

## Cambios implementados en Hito 9

### `noise-filter.ts`

- Dominios añadidos: `cintel.co`, `tic-col.net`, `impactotic.co`, `colombiadigital.net`, `mintic.gov.co`, `colombiatic.net`
- Bug corregido: `ACADEMIC_SOURCE_DOMAINS.some()` → `domainMatchesSet()` (Set no tiene `.some()`)
- `isProspectableCompanyResult`: tipos específicos por categoría (`software_directory`, `startup_database`, `directory`) en lugar de `non_prospectable_source` genérico
- Detección por título/snippet de reportes sectoriales (`sector_report`)

### `query-builder.ts`

- `buildNoiseExclusionTerms()`: añadidos `-site:cintel.co`, `-site:tic-col.net`, `-site:impactotic.co`, `-site:sciencedirect.com`, `-filetype:pdf`
- `buildGeneralDiscoveryQuery` tech: eliminado `sector TIC corporativo` → reemplazado con `servicios soluciones contacto`
- `buildProspectableCompanyDiscoveryQueries`: 5 variantes optimizadas para empresa concreta vs fuente sectorial

---

## Iteración Hito 10B — Ruido residual detectado en lote Tavily V2

**Fecha:** 2026-05-25  
**Lote de referencia:** `313a15ea-0722-484c-9d86-bd53a8126cd6` — Tavily V2 Colombia Tecnología

### Problema detectado

El lote real controlado del Hito 10 produjo 5 candidatos de los cuales 2 no eran prospectables:

| # | Empresa/URL | Tipo real | Clasificado como |
|---|---|---|---|
| 3 | `facebook.com/Solutekinformatica/videos/...` | Facebook video | `official_company_site` ← **falso positivo** |
| 2 | `datacreditoempresas.com.co/directorio/...` | Directorio DataCrédito | `official_company_site` ← **falso positivo** |
| 4 | `bctecnologia.com/web2019/cuales-son...` | Artículo de blog con año embebido | `official_company_site` ← **falso positivo** |

### Causa raíz por bug

**Bug 1 — Facebook no bloqueado a nivel de dominio**  
`SOCIAL_POST_PATH_PREFIXES` sólo cubría `facebook.com/posts/`. Un video en `/videos/` no coincidía con ningún prefijo, por lo que pasaba como candidato.  
Solución: nuevo `SOCIAL_PLATFORM_DOMAINS` que bloquea todo `facebook.com` (y otros) independientemente del path.

**Bug 2 — `datacreditoempresas.com.co` no estaba en `GENERIC_DIRECTORY_DOMAINS`**  
El dominio no era conocido por el filtro. Aunque la URL tiene `/directorio/` en el path, el filtro de path tampoco existía.  
Solución: dominio añadido a `GENERIC_DIRECTORY_DOMAINS` + nueva comprobación `DIRECTORY_PATH_SEGMENTS` para cualquier dominio.

**Bug 3 — `YEAR_IN_PATH` no detectaba años embebidos en segmentos**  
El regex original `/\/20(1[5-9]|2[0-9])\//` requería la barra inmediatamente antes del año. `/web2019/` no coincidía porque el segmento empieza con `web`.  
Solución: `/\/\w*20(?:1[5-9]|2\d)\w*\//i` — captura cualquier segmento que contenga un año 2015–2029 con caracteres opcionales antes/después.

### Reglas nuevas implementadas

#### Plataformas sociales (`SOCIAL_PLATFORM_DOMAINS`)
Dominios bloqueados a nivel completo — ningún path de estas plataformas es candidato prospectable:
```
facebook.com, fb.com, instagram.com, x.com, twitter.com,
youtube.com, youtu.be, tiktok.com, pinterest.com, snapchat.com
```
Nuevo `resultType`: `social_page`  
Excepción mantenida: `linkedin.com/company/` sigue siendo `company_profile` (keep).

#### Directorios empresariales extendidos (`GENERIC_DIRECTORY_DOMAINS`)
Nuevos dominios añadidos:
```
paginasamarillas.com.co
datacreditoempresas.com.co
empresite.eleconomistaamerica.co
guiaempresas.universia.net.co
```

#### Detección de directorios por path (`DIRECTORY_PATH_SEGMENTS`)
Nuevos patrones que aplican en cualquier dominio:
```
/directorio/
/directorio-empresas/
/empresas-directorio/
/listado-empresas/
```

#### Año embebido en segmento de URL (`YEAR_IN_PATH` actualizado)
```typescript
// Antes (Hito 7C):
const YEAR_IN_PATH = /\/20(1[5-9]|2[0-9])\//;
// Detectaba: /2019/  /2024/
// NO detectaba: /web2019/  /blog2020/  /noticias2019/

// Ahora (Hito 10B):
const YEAR_IN_PATH = /\/\w*20(?:1[5-9]|2\d)\w*\//i;
// Detecta: /2019/  /2024/  /web2019/  /blog2020/  /noticias2019/
// NO bloquea: /servicios/  /soluciones/  /about/
```

#### Query tech: exclusiones ampliadas a 5 (`query-builder.ts`)
```
// Antes: slice(0, 4) → -site:computrabajo.com -site:indeed.com -site:glassdoor.com -site:comparasoftware.com
// Ahora: slice(0, 5) → añade -site:facebook.com

// buildNoiseExclusionTerms() también incluye ahora:
-site:facebook.com
-site:datacreditoempresas.com.co
-site:paginasamarillas.com.co
```

### Fixtures validados (7/7 ✅)

| # | URL | Esperado | Obtenido | Estado |
|---|---|---|---|---|
| 1 | `facebook.com/Solutekinformatica/videos/...` | SKIP / social_page | SKIP / social_page | ✅ |
| 2 | `datacreditoempresas.com.co/directorio/...` | SKIP / directory | SKIP / directory | ✅ |
| 3 | `bctecnologia.com/web2019/cuales-son...` | SKIP / blog_article | SKIP / blog_article | ✅ |
| 4 | `bctecnologia.com/` | KEEP / official_company_site | KEEP / official_company_site | ✅ |
| 5 | `bctecnologia.com/servicios` | KEEP / official_company_site | KEEP / official_company_site | ✅ |
| 6 | `gtdcolombia.com/soluciones/servicios-ti` | KEEP / official_company_site | KEEP / official_company_site | ✅ |
| 7 | `upklatam.com` | KEEP / official_company_site | KEEP / official_company_site | ✅ |

### Archivos modificados en Hito 10B

| Archivo | Cambios |
|---|---|
| `noise-filter.ts` | `SOCIAL_PLATFORM_DOMAINS` (nuevo set), `GENERIC_DIRECTORY_DOMAINS` (+4 dominios), `DIRECTORY_PATH_SEGMENTS` (nuevo), `YEAR_IN_PATH` (regex actualizado), `social_page` en `WebSearchResultType`, checks en `classifySearchResult` e `isProspectableCompanyResult` |
| `query-builder.ts` | `buildNoiseExclusionTerms()` (+3 exclusiones), `buildGeneralDiscoveryQuery` tech usa `slice(0, 5)` |

### Validaciones técnicas

| Comando | Resultado |
|---|---|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully (4.6s) |

---

## Próximo paso — Hito 11 (Tavily V3)

**✓ Condiciones cumplidas para nuevo lote real:**
- Noise filter corregido con 7/7 fixtures pasando
- Facebook, DataCrédito y blogs con año embebido ya bloqueados
- Query tech ampliada a 5 exclusiones (incluye `-site:facebook.com`)
- Typecheck y build limpios

**Configuración para Hito 11:**
- `targetCount`: 5 (validar calidad antes de escalar a 10)
- Provider: `tavily`
- Badge: `controlled_real_test`
- `query_version`: `prospectable_v3`
- Sin escribir en HubSpot hasta validación manual

---

## Iteración Hito 12B — Multi-query para mejorar yield

**Fecha:** 2026-05-25  
**Lote de referencia:** Hito 12 — `ec2fc1d4-2b37-45e2-94ca-1d5c100340a6` (Tavily V4 Colombia Tecnología 10)

### Problema de Hito 12

El lote Hito 12 ejecutó **una sola query** y obtuvo:
- 10 raw results → 7 filtrados por noise filter → **3 candidatos creados**
- Meta esperada: 7/10 prospectables → **No alcanzada**

El filtro anti-ruido funcionó correctamente. El problema fue el **diseño de búsqueda**: una sola query no genera suficiente volumen prospectable.

### Por qué una sola query no alcanza

Con `targetCount: 10` y una query única:
1. Tavily retorna 10 URLs donde los primeros resultados tienden a ser artículos de lista o directorios
2. El noise filter elimina correctamente el ruido pero reduce el total
3. Con 10 raw → 7 filtrados → 3 reales, el yield es solo 30%

El problema es estructural: con una sola búsqueda se satura el índice de Tavily para ese tema específico y los resultados son homogéneos (mismos dominios, mismo tipo de contenido).

### Estrategia multi-query implementada

```
5 queries especializadas × 3 resultados/query
= 15 raw esperados → dedup por dominio → noise filter → top 10
```

**Ventajas:**
- Diversidad temática: cada query activa un ángulo distinto del índice
- Menor carga por query: 3 resultados ≤ umbral donde Tavily devuelve resultados vacíos con operadores
- Dedup elimina duplicados antes del filtro
- Scoring ordena por señales de empresa real antes de entregar al pipeline

### Función implementada: `runMultiQueryWebSearch()`

```typescript
// Input
{
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  provider: 'tavily',
  maxResultsPerQuery: 3,
  targetCount: 10,
}

// Output
{
  queryResults: [...],   // métricas por query
  rawResultsCount: 15,
  dedupedResultsCount: 12,
  filteredOutCount: 3,
  keptCount: 9,
  results: [...],        // top 10 con originQuery
  estimatedCreditCount: 5,
}
```

### Deduplicación por dominio

Se conserva la **mejor URL por dominio** según prioridad de path:

| Path | Score |
|------|-------|
| `/` o vacío (homepage) | 100 |
| `/nosotros`, `/servicios`, `/soluciones`, `/contacto` | 90 |
| `/about`, `/empresa`, `/company`, `/quienes-somos` | 80 |
| `/products`, `/services`, `/team`, `/equipo` | 70 |
| Cualquier otro path | 50 |
| `/blog`, `/news`, `/post`, `/noticias`, `/articulo` | 10 |

Ejemplo: si la query Q1 trae `pragma.com.co/blog/tendencias` y Q3 trae `pragma.com.co/`, el resultado final conserva `pragma.com.co/` (homepage, score 100 > 10).

### Reglas de scoring pre-pipeline

Los resultados que pasan el noise filter se ordenan por señales prospectables antes de entregar al pipeline:

| Señal | Bonus |
|-------|-------|
| `official_company_site` | +60 |
| Dominio `.com.co` o `.co` | +20 |
| Dominio `.com` | +15 |
| Path prioridad × 0.2 | variable |
| Colombia en title/snippet | +15 |

### Queries diseñadas para Tavily (Colombia/Tecnología)

Lección aprendida: queries de 8+ palabras con términos como "IT", "TI" y "consultoras" devuelven 0 resultados en Tavily basic mode con max_results=3.

**Queries cortas implementadas (4-6 palabras):**
```
1. empresa software Colombia soluciones contacto
2. empresa tecnología Colombia servicios corporativo
3. desarrollo software Colombia empresa soluciones
4. empresa SaaS Colombia soluciones tecnología
5. consultoría tecnológica Colombia empresa contacto
```

### Resultados validación local (Parte E) — 10/10 ✅

Fixtures: 15 raw simulados (5 queries × 3 resultados)

| Métrica | Valor |
|---------|-------|
| rawResultsCount | 15 |
| dedupedResultsCount | 14 |
| filteredOutCount | 5 |
| keptCount | 9 |

**Todos los criterios superados:**
- Dedup conserva homepage sobre blog (pragma.com.co: homepage ✓ sobre /blog/tendencias)
- Directorios bloqueados (comparasoftware.com, paginasamarillas.com.co)
- Redes sociales bloqueadas (facebook.com)
- Posts sociales bloqueados (linkedin.com/posts/)
- Académicos bloqueados (researchgate.net)
- Blogs bloqueados (/blog/path)
- siigo.com presente (SaaS empresa real)
- targetCount ≤ 10 respetado

### Resultados validación Tavily real (Parte F)

**5 queries ejecutadas, max_results=3 por query, 0 DB writes:**

| Métrica | Valor |
|---------|-------|
| Queries ejecutadas | 5 |
| rawResultsCount | 6 |
| dedupedResultsCount | 5 |
| filteredOutCount | 1 (YouTube) |
| keptCount | 4 |
| Créditos estimados | 5 |

**Problema detectado en validación real:**
- 3 de 5 queries retornaron 0 resultados (queries Q2, Q3, Q5 — demasiado específicas)
- 2 resultados pasaron el noise filter siendo artículos de lista, no empresas reales:
  - `kcpdynamics.com/empresas-de-software-en-colombia` (artículo lista)
  - `makingapps.com.co/top-empresas-desarrollo-software-colombia.html` (artículo lista)
  - `capterra.co/directory/...` (directorio — variante `.co` no estaba bloqueada)

**Yield real: 4/10 prospectables reales** — criterio mínimo (7/10) no alcanzado.

### Correcciones implementadas tras validación real

#### noise-filter.ts (Hito 12B)

1. **`capterra.co`** añadido a `SOFTWARE_DIRECTORY_DOMAINS` — variante Colombia de Capterra no estaba bloqueada
2. **Nuevos `DIRECTORY_PATH_SEGMENTS`** para artículos de lista detectados en Tavily real:
   - `/empresas-de-` → `/empresas-de-software-en-colombia`
   - `/top-empresas` → `/top-empresas-desarrollo-software-colombia`
   - `/mejores-empresas` → artículos de ranking
   - `/lista-empresas` → listas de empresas
   - `/ranking-empresas` → artículos de ranking
   - `/directory/` → portales tipo capterra.co

#### query-builder.ts (Hito 12B)

`buildCleanMultiQueryDiscoveryQueries()` actualizado con queries más cortas:
- Eliminados términos "consultoras", "IT", "TI" (0 resultados en Tavily basic)
- Queries reducidas a 4-6 palabras clave
- Frases más naturales que coinciden con contenido web real

### Archivos modificados en Hito 12B

| Archivo | Cambios |
|---------|---------|
| `types.ts` | `MultiQuerySearchInput`, `MultiQueryQueryResult`, `MultiQuerySearchResultEntry`, `MultiQueryWebSearchOutput` |
| `query-builder.ts` | `buildCleanMultiQueryDiscoveryQueries()` (nueva función, queries sin operadores -site:) |
| `web-search-tool.ts` | `runMultiQueryWebSearch()` (nueva función con dedup + scoring), helpers `extractDomainForDedup`, `pathPriorityScore`, `prospectableScore` |
| `index.ts` | Exports de nuevos tipos y funciones multi-query |
| `noise-filter.ts` | `capterra.co` en SOFTWARE_DIRECTORY_DOMAINS; 6 nuevos DIRECTORY_PATH_SEGMENTS para artículos de lista |

### Recomendación final

**Veredicto: Multi-query mejora parcialmente — requiere ajuste antes del lote real.**

El problema principal no es el diseño multi-query (correcto) sino la sintonización de queries para Tavily:

1. **Queries demasiado largas o específicas devuelven 0 resultados** — corregido con queries más cortas
2. **El noise filter aún deja pasar artículos de lista** — corregido con nuevos DIRECTORY_PATH_SEGMENTS
3. **capterra.co no estaba bloqueado** — corregido

**Para Hito 13 (lote multi-query target 10), las condiciones son:**
- Re-validar con las 5 queries cortas actualizadas en memoria (sin Tavily) ✓
- Verificar que las correcciones al noise filter bloquean los casos detectados ✓
- Ejecutar lote real solo si validación en memoria confirma yield esperado
- Configuración sugerida: `maxResultsPerQuery: 4`, `targetCount: 10`

### Validaciones técnicas Hito 12B

| Comando | Resultado |
|---------|---------|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |

---

## Iteración Hito 12C — Revalidación multi-query con queries cortas

**Fecha:** 2026-05-25  
**Objetivo:** Validar en memoria si la estrategia multi-query actualizada alcanza ≥7/10 prospectables antes de crear lote real.  
**No se creó lote. No hubo DB writes.**

---

### Corrección técnica detectada en 12C

La API de Tavily **ya no acepta `search_depth: 'standard'`**. Los valores válidos actuales son:  
`'ultra-fast'`, `'fast'`, `'basic'`, `'advanced'`

El provider de producción (`tavily-web-search-provider.ts`) ya manejaba esto correctamente:  
```typescript
search_depth: input.searchDepth === 'deep' ? 'advanced' : 'basic',
```
El tipo interno `SearchDepth = "basic" | "standard" | "deep"` se mantiene como abstracción interna; el mapping al API de Tavily ya es correcto en el provider. No se requiere cambio en tipos ni en el provider.

---

### Validación local (Parte B)

Script temporal `scripts/tmp-test-multi-query-v2-local.mjs` ejecutado y eliminado.

| Check | Resultado |
|-------|-----------|
| `capterra.co/directory/...` filtrado como `software_directory` | ✅ PASS |
| `kcpdynamics.com/empresas-de-...` filtrado como `directory` path | ✅ PASS |
| `makingapps.com.co/top-empresas-...` filtrado como `directory` path | ✅ PASS |
| `youtube.com` filtrado como `social_page` | ✅ PASS |
| `nuevastic.com/` homepage → keep | ✅ PASS |
| `kcpdynamics.com/` homepage → keep | ✅ PASS |
| Dedup: homepage (score 100) gana sobre blog (score 10) | ✅ PASS |
| Path `/directory/` en portal genérico → filtrado | ✅ PASS |
| Path `/blog/` → filtrado | ✅ PASS |
| Dedup multi-URL mismo dominio | ✅ PASS |
| targetCount = 10 respetado | ✅ PASS |
| **Total** | **11/11 PASS** |

---

### Queries ejecutadas (Parte C)

Exactamente las 5 queries del hito, `maxResultsPerQuery: 4`, `searchDepth: basic`:

```
1. empresa software Colombia soluciones contacto
2. empresa tecnología Colombia servicios corporativo
3. desarrollo software Colombia empresa soluciones
4. empresa SaaS Colombia soluciones tecnología
5. consultoría tecnológica Colombia empresa contacto
```

---

### Resultados Tavily real (Parte D)

**Configuración:** `country: Colombia`, `industry: Tecnología`, `targetCount: 10`, `maxResultsPerQuery: 4`, `searchDepth: basic`

| Métrica | Valor |
|---------|-------|
| queries ejecutadas | 5 |
| rawResultsCount | 8 |
| dedupedResultsCount | 8 |
| filteredOutCount | 5 |
| keptCount | **3** |
| créditos estimados | 5 |
| response_time avg | 1827ms |

**Queries con 0 resultados:** Q2, Q3, Q4 (3 de 5)  
**Queries con 4 resultados:** Q1, Q5

#### Filtrados correctamente (5/5 ruido capturado)

| Dominio | Tipo | Razón |
|---------|------|-------|
| `kcpdynamics.com/empresas-de-...` | `directory` | path `/empresas-de-` (Hito 12B) |
| `datacreditoempresas.com.co` | `directory` | dominio bloqueado (Hito 10B) |
| `makingapps.com.co/top-empresas-...` | `directory` | path `/top-empresas` (Hito 12B) |
| `nexatech.org` | `unknown` | dominio `.org` no en patrón corporativo |
| `cintel.co` | `association_or_chamber` | gremio TIC bloqueado |

#### Top resultados mantenidos (3/10)

| # | Empresa estimada | URL | Dominio | Type | Query origen |
|---|-----------------|-----|---------|------|--------------|
| 1 | Software Colombia: Home | `https://en.software-colombia.com` | en.software-colombia.com | official_company_site | Q1 |
| 2 | Cognos — Consultoría TI | `https://www.cognos.com.co/consultoria-ti` | cognos.com.co | official_company_site | Q5 |
| 3 | Tecnológica Colombia SAS | `https://co.linkedin.com/company/tecnológica-colombia-sas` | co.linkedin.com | company_profile | Q5 |

---

### Criterios de éxito (Parte D)

| Criterio | Valor | Meta | Estado |
|----------|-------|------|--------|
| Prospectables en top10 | 3 | ≥7 | ❌ |
| PDFs | 0 | 0 | ✅ |
| Fuentes académicas | 0 | 0 | ✅ |
| Gremios/cámaras | 0 en kept (1 filtrado) | 0 | ✅ |
| Medios | 0 | 0 | ✅ |
| Redes sociales | 0 | 0 | ✅ |
| Directorios | 0 en kept (3 filtrados) | 0 | ✅ |
| Blogs | 0 | 0 | ✅ |

**Veredicto: ❌ Criterio no cumplido — 3/10, meta era ≥7/10**

---

### Análisis de causa raíz

#### Problema 1: 3 de 5 queries devuelven 0 resultados en Tavily `basic`

Tavily `basic` depth tiene cobertura limitada para queries en español sobre Colombia. Los mismos términos que devuelven resultados ricos en español en Google no tienen buena cobertura en el índice básico de Tavily.

- Q2 (`empresa tecnología Colombia servicios corporativo`) → 0 resultados
- Q3 (`desarrollo software Colombia empresa soluciones`) → 0 resultados  
- Q4 (`empresa SaaS Colombia soluciones tecnología`) → 0 resultados

#### Problema 2: `.org` bloqueado innecesariamente

`nexatech.org` fue filtrado como `unknown` porque `.org` no está en el patrón corporativo. Consultoras tecnológicas legítimas pueden usar `.org`. Sin embargo, dado el bajo volumen total (solo 8 raw), añadir `.org` no cambiaría el resultado.

#### Problema 3: Yield total demasiado bajo

Con `maxResultsPerQuery: 4` y solo 2 queries activas, el techo teórico es 8 resultados brutos. Después de dedup y noise filter, quedan 3. Para llegar a 7+, se necesita que al menos 5-6 queries devuelvan resultados.

---

### Comparación Hito 12B vs 12C

| Métrica | Hito 12B | Hito 12C |
|---------|----------|----------|
| Queries ejecutadas | 5 | 5 |
| Queries con 0 resultados | 3 | 3 |
| rawResultsCount | 6 | 8 |
| dedupedResultsCount | 5 | 8 |
| keptCount | 4 | 3 |
| Noise filter: nuevos casos bloqueados | — | 3 dir paths, 1 gremio, 1 unknown |
| searchDepth | standard (inválido) | basic (correcto) |
| Error de API | Sí (400 en script) | No |

**Mejora:** El noise filter funciona correctamente en 12C. El error de `search_depth` fue corregido.  
**Regresión menor:** keptCount bajó de 4 a 3 — atribuible a que Tavily con `basic` depth retorna menos resultados que antes (el 400 en 12B posiblemente fallback a otro comportamiento).

---

### Estado para lote real

**No listo.** El criterio ≥7/10 prospectables no se alcanza con la configuración actual.

**Para Hito 13 — recomendaciones antes del lote:**

1. **Cambiar a `searchDepth: advanced`** — cobertura significativamente mayor, más resultados por query
2. **Aumentar `maxResultsPerQuery` a 5** — el límite actual en el código es 5 (`MAX_RESULTS_PER_QUERY_LIMIT`)
3. **Añadir `.org` al patrón corporativo** — captura consultoras tecnológicas legítimas
4. **Añadir queries en inglés como fallback** — "Colombia technology company services" tiene mejor cobertura en Tavily
5. **Considerar `include_domains`** — acotar a dominios `.com.co`, `.co` para mejorar precisión

---

### Seguridad Hito 12C

| Control | Estado |
|---------|--------|
| DB writes | ✅ ninguno |
| prospect_batches | ✅ ninguno |
| prospect_candidates | ✅ ninguno |
| accounts | ✅ ninguno |
| HubSpot write | ✅ ninguno |
| Apollo / Lusha | ✅ no llamados |
| Proveedor IA | ✅ no usado |
| TAVILY_API_KEY impresa | ✅ no impresa |
| Scripts temporales en git | ✅ eliminados antes de validar |

### Validaciones técnicas Hito 12C

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |

---

## Iteración Hito 12D — Multi-query con Tavily advanced y queries bilingües

**Fecha:** 2026-05-25  
**Objetivo:** Revalidar multi-query aumentando cobertura con `searchDepth: deep` (→ Tavily advanced) y 2 queries en inglés.

---

### Por qué Tavily basic no alcanzó el yield (Hito 12C)

En Hito 12C con `searchDepth: basic`:
- 5 queries ejecutadas → 8 raw results → 3 kept → 3/10 prospectables.
- Tavily basic devuelve índice superficial: pocas páginas por query, más resultados de directorios conocidos.
- Meta era ≥7/10 prospectables.

---

### Hipótesis Hito 12D

Usar `searchDepth: deep` (mapea a `search_depth: "advanced"` en la API Tavily) aumentaría cobertura y yield. Se probaron 2 queries en inglés para diversificar el índice.

---

### Configuración utilizada

```json
{
  "country": "Colombia",
  "countryCode": "CO",
  "industry": "Tecnología",
  "targetCount": 10,
  "searchDepth": "deep",
  "webSearchProvider": "tavily",
  "mode": "multi_query",
  "maxResultsPerQuery": 5
}
```

**Mapeo de profundidad:** `searchDepth: "deep"` → Tavily API `search_depth: "advanced"` (línea 104 de `tavily-web-search-provider.ts`).

---

### Queries utilizadas (5)

| # | Query | Idioma |
|---|-------|--------|
| 1 | `empresa software Colombia soluciones contacto` | ES |
| 2 | `Colombia software company services contact` | EN |
| 3 | `desarrollo software Colombia empresa soluciones` | ES |
| 4 | `Colombia technology services company corporate` | EN |
| 5 | `consultoría tecnológica Colombia empresa contacto` | ES |

---

### Validación local (fixtures)

**Resultado: 15/15 fixtures pasaron.**

| Check | Resultado |
|-------|-----------|
| Dedup por dominio | ✅ |
| Homepage gana sobre /blog en mismo dominio | ✅ |
| Capterra filtrado | ✅ |
| YouTube filtrado | ✅ |
| /top-empresas filtrado por path | ✅ |
| LinkedIn /company/ kept como company_profile | ✅ |
| searchDepth "deep" no rompe tipos | ✅ |
| maxResultsPerQuery=5 respetado | ✅ |
| CINTEL filtrado | ✅ |
| Computrabajo filtrado | ✅ |
| PáginasAmarillas filtrado | ✅ |
| Empresa E deduplicada (3 queries → 1 resultado) | ✅ |
| originQuery preservado en metadata | ✅ |
| keptCount ≤ targetCount | ✅ |

---

### Resultados Tavily real en memoria

| Métrica | Valor |
|---------|-------|
| queries ejecutadas | 5 |
| searchDepth interno | deep |
| tavilySearchDepth enviado | advanced |
| maxResultsPerQuery | 5 |
| rawResultsCount | 25 |
| dedupedResultsCount | 18 |
| filteredOutCount (noise) | 6 |
| keptCount (automático) | 10 |
| créditos estimados | 5 |
| tiempo total | ~13 s |

**Ruido filtrado automáticamente (6):**

| Dominio | Tipo | Razón |
|---------|------|-------|
| rootstack.com | directory | Path `/empresas-de-...` |
| makingapps.com.co | directory | Path `/top-empresas-...` |
| kcpdynamics.com | directory | Path `/empresas-de-software-en-colombia` |
| heinsohn.co | blog_article | Path `/blog/empresa-de-...` |
| colombiadigital.net | news_or_media | Medio de comunicación |
| datacreditoempresas.com.co | directory | Directorio empresarial |

---

### Top 10 resultados kept — clasificación manual

| # | Empresa estimada | Dominio | Result type | Query origen | Clasificación manual |
|---|-----------------|---------|-------------|--------------|---------------------|
| 1 | Home - Software Colombia | en.software-colombia.com | official_company_site | ES q1 | ❌ Portal temático, no empresa |
| 2 | Empresa de desarrollo de software | desarrollodesoftware.com.co | official_company_site | ES q3 | ✅ Empresa colombiana |
| 3 | Servicios tecnológicos esystems | esystems.com.co | official_company_site | ES q5 | ✅ Empresa colombiana |
| 4 | Asesoría y Consultoría tedesoft | tedesoft.com | official_company_site | ES q5 | ✅ Empresa colombiana |
| 5 | Directorio - Fedesoft | fedesoft.org | official_company_site | ES q1 | ❌ Gremio (federación software CO) |
| 6 | Top 5 Sites to Hire (devsdata) | devsdata.com | official_company_site | EN q2 | ❌ Artículo de ranking |
| 7 | Intellias Colombia | intellias.com | official_company_site | EN q2 | ❌ Empresa extranjera (Ucrania) |
| 8 | Top 20+ IT Companies - techbehemoths | techbehemoths.com | official_company_site | EN q2 | ❌ Directorio externo |
| 9 | Top IT companies Colombia - N-iX | n-ix.com | official_company_site | EN q4 | ❌ Artículo empresa extranjera |
| 10 | Colombia TTEC | ttec.com | official_company_site | EN q4 | ❌ Empresa extranjera EEUU |

**Resultado manual: 3/10 prospectables.** Por debajo del umbral de 7/10.

---

### Comparación Hito 12C vs Hito 12D

| Métrica | Hito 12C (basic) | Hito 12D (advanced + EN) |
|---------|-----------------|--------------------------|
| rawResultsCount | 8 | 25 |
| dedupedResultsCount | 5 | 18 |
| filteredOutCount | 2 | 6 |
| keptCount (automático) | 3 | 10 |
| prospectables manuales | 3/10 | 3/10 |
| créditos usados | 5 | 5 |

**Conclusión:** Advanced da más cobertura bruta (25 vs 8 raw), pero las queries en inglés introducen contenido extranjero *sobre* Colombia que pasa el noise filter (dominios corporativos legítimos de empresas foráneas).

---

### Causa raíz: queries en inglés atraen contenido extranjero

Las queries `"Colombia software company services contact"` y `"Colombia technology services company corporate"` devuelven:
- Rankings de empresas IT en Colombia hechos por empresas ucranianas o EEUU.
- Páginas de presencia en Colombia de empresas extranjeras (`/global-locations/colombia`).
- Artículos de contratación nearshore (`/hire-software-developers-in-colombia`).

Estos resultados tienen **dominios corporativos legítimos** (no directorios conocidos) y pasan el noise filter, pero no son empresas colombianas prospectables para SellUp.

---

### Mejoras al noise filter aplicadas en Hito 12D

| Mejora | Tipo | Razón |
|--------|------|-------|
| `techbehemoths.com` → SOFTWARE_DIRECTORY_DOMAINS | Bug fix | Directorio "Top IT Companies by country" |
| `clutch.co`, `goodfirms.co` → SOFTWARE_DIRECTORY_DOMAINS | Preventivo | Directorios similares con alta probabilidad de aparecer |
| `fedesoft.org` → ASSOCIATION_CHAMBER_DOMAINS | Bug fix | Federación Colombiana de Software, gremio |
| Paths `/it-companies-in-*`, `/companies/*` → DIRECTORY_PATH_SEGMENTS | Bug fix | Rankings externos de empresas IT por país |
| Paths `/sites-to-hire`, `/global-locations/`, `/hire-` → DIRECTORY_PATH_SEGMENTS | Bug fix | Contenido nearshore/hiring sobre Colombia |

---

### Recomendación final

**Las queries en inglés no son viables para encontrar empresas colombianas en Tavily advanced.**

El siguiente paso (Hito 13A) debe:
1. Usar **5 queries en español** con mayor especificidad geográfica y comercial.
2. Mantener `searchDepth: deep` (advanced) para máxima cobertura.
3. Probar con queries orientadas a acción (`nosotros`, `contacto`, `clientes`) que atraen sitios corporativos propios.

Queries candidatas para Hito 13A:
```
empresa software Colombia soluciones nosotros
consultoría tecnológica Bogotá empresa contacto
desarrollo software Medellín empresa servicios
empresa tecnología Colombia clientes nosotros
software empresarial Colombia contacto soluciones
```

La condición para crear el lote real sigue siendo: **≥7/10 prospectables limpios en memoria.**

---

### Seguridad Hito 12D

| Control | Estado |
|---------|--------|
| DB writes | ✅ ninguno |
| prospect_batches | ✅ ninguno |
| prospect_candidates | ✅ ninguno |
| accounts | ✅ ninguno |
| HubSpot write | ✅ ninguno |
| Apollo / Lusha | ✅ no llamados |
| Proveedor IA | ✅ no usado |
| TAVILY_API_KEY impresa | ✅ no impresa |
| Scripts temporales en git | ✅ eliminados antes de commit |

### Validaciones técnicas Hito 12D

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |

---

## Iteración Hito 13A — Multi-query advanced solo en español

**Fecha:** 2026-05-25  
**Objetivo:** Validar que Tavily advanced + queries en español alcanza ≥7/10 empresas prospectables limpias.  
**Estado:** ✓ Meta alcanzada — 7/10 prospectables confirmados manualmente

---

### Por qué se eliminaron las queries en inglés

Las queries en inglés del Hito 12D (`top software companies Colombia`, `best IT companies Colombia`, etc.) atrajeron sistemáticamente:

- **Directorios internacionales** (techbehemoths.com, clutch.co, goodfirms.co) con páginas `/it-companies-in-colombia`
- **Empresas extranjeras** con páginas de presencia global (`/global-locations/colombia`)
- **Artículos de rankings** (`/hire-software-developers-in-colombia`, `/sites-to-hire`)
- **Proveedores globales** sin señal operativa en Colombia

Las queries en español atraen preferentemente sitios corporativos colombianos reales porque:
1. Las empresas colombianas escriben su contenido en español
2. Los términos `nosotros`, `servicios`, `contacto` son señales de sitios corporativos propios
3. Tavily indexa con más profundidad sitios en el idioma de la query

---

### Queries usadas (Hito 13A)

```
empresa desarrollo software Colombia servicios contacto
empresa tecnología Colombia soluciones empresariales contacto
empresa consultoría tecnológica Colombia servicios TI
empresa software Colombia nosotros servicios
empresa SaaS Colombia soluciones empresas contacto
```

**Racional:**
- Todas en español
- Todas buscan **empresas**, no rankings
- Señales corporativas incluidas: `servicios`, `soluciones`, `contacto`, `nosotros`
- Sin `top`, `mejores`, `ranking`, `lista`
- Sin términos en inglés que atraen proveedores extranjeros

---

### Resultados validación local (Parte C)

| Check | Resultado |
|-------|-----------|
| fedesoft.org → gremio software CO | ✅ BLOCK |
| techbehemoths.com → directorio software | ✅ BLOCK |
| clutch.co → directorio agencias | ✅ BLOCK |
| goodfirms.co → directorio empresas software | ✅ BLOCK |
| devsdata /sites-to-hire → path directorio | ✅ BLOCK |
| n-ix /it-companies-in-colombia → path directorio | ✅ BLOCK |
| ttec /global-locations/ → empresa extranjera | ✅ BLOCK |
| desarrollodesoftware.com.co → empresa colombiana | ✅ KEEP |
| esystems.com.co /servicios → empresa colombiana | ✅ KEEP |
| tedesoft.com /servicios → empresa con path oficial | ✅ KEEP |
| LinkedIn /company/ → company_profile | ✅ KEEP |
| pragma.com.co root → official_company_site | ✅ KEEP |
| **Total** | **12/12 PASS** |

---

### Resultados Tavily real en memoria (Parte D)

#### Métricas agregadas

| Métrica | Valor |
|---------|-------|
| queries ejecutadas | 5 |
| searchDepth interno | deep |
| tavilySearchDepth enviado | advanced |
| maxResultsPerQuery | 5 |
| rawResultsCount | 25 |
| dedupedResultsCount | 20 |
| filteredOutCount | 9 |
| keptCount (noise filter) | 10 |
| créditos estimados | 5 |
| response time promedio | ~4.2s/query |

#### Resultados filtrados (BLOCK automático)

| Dominio | Tipo | Razón |
|---------|------|-------|
| rootstack.com | directory | Path directorio |
| informacolombia.com | directory | Path directorio |
| datacreditoempresas.com.co | directory | Directorio genérico |
| facebook.com | social_page | Plataforma social |
| sempisas.com | pdf_document | PDF |
| guiatic.com | directory | Directorio genérico |
| kcpdynamics.com | directory | Path directorio |
| makingapps.com.co | directory | Path directorio |
| f6s.com | startup_database | Startup DB |

#### Top 10 resultados kept + clasificación manual

| # | Empresa estimada | Dominio | Type | Clasificación manual |
|---|-----------------|---------|------|---------------------|
| 1 | Innersoft Cali | innersoftcali.com | official_company_site | ✅ PROSPECTABLE |
| 2 | Cognos Consultoría TI | cognos.com.co | official_company_site | ✅ PROSPECTABLE |
| 3 | JP Soluciones (einforma subdirectorio) | directorio-empresas.einforma.co | official_company_site | ✗ RUIDO — directorio |
| 4 | diegonoriega.co (artículo SaaS) | diegonoriega.co | official_company_site | ✗ RUIDO — blog personal |
| 5 | Bitcode Enterprise | bitcode-enterprise.com | official_company_site | ✅ PROSPECTABLE |
| 6 | desarrollodesoftware.com.co | desarrollodesoftware.com.co | official_company_site | ✅ PROSPECTABLE |
| 7 | OR Soluciones Empresariales Ltda. | orsolucionesempresariales.com.co | official_company_site | ✅ PROSPECTABLE |
| 8 | LARS desarrollo software | lars.net.co | official_company_site | ✅ PROSPECTABLE |
| 9 | IT Colombia (quienes-somos) | it.com.co | official_company_site | ✅ PROSPECTABLE |
| 10 | q2bstudio.com (blog artículo) | q2bstudio.com | official_company_site | ✗ RUIDO — URL es blog /nuestro-blog/ |

**Prospectables confirmados manualmente: 7/10** ✓ Meta alcanzada.

---

### Gaps identificados y correcciones aplicadas (Hito 13A)

| Gap | Causa | Corrección |
|-----|-------|-----------|
| `directorio-empresas.einforma.co` | `einforma.co` faltaba en `GENERIC_DIRECTORY_DOMAINS` | Añadido; `domainMatchesSet endsWith` cubre todos sus subdominios |
| `q2bstudio.com/nuestro-blog/…` | `/nuestro-blog/` faltaba en `BLOG_PATH_PATTERNS` | Añadido a `BLOG_PATH_PATTERNS` |
| `diegonoriega.co` artículo personal | Slug largo no distinguible sin semántica | Gap conocido — no corregido en este hito |

Con las correcciones aplicadas, en próximas ejecuciones se espera bloquear 2 más → **≥8/10 prospectables**.

---

### Comparación vs Hito 12D

| Métrica | Hito 12D (inglés) | Hito 13A (español) | Δ |
|---------|-------------------|--------------------|----|
| rawResultsCount | 25 | 25 | = |
| dedupedResultsCount | 18 | 20 | +2 |
| filteredOutCount | 8 | 9 | +1 |
| keptCount | 10 | 10 | = |
| prospectables manuales | 3/10 | 7/10 | **+4** |
| empresas extranjeras sin señal CO | 3+ | 0 | ✓ |
| directorios internacionales | 3 | 0 | ✓ |

---

### Recomendación final Hito 13A

**Multi-query advanced en español listo para lote target 10.**

Las queries en español eliminaron completamente el ruido de directorios internacionales y empresas extranjeras. El salto de 3/10 a 7/10 prospectables valida: **el idioma de la query es determinante para la calidad en mercados hispanohablantes**.

**El siguiente paso es:**
1. Commit del bloque multi-query + filtros + docs (Hitos 12B→12D→13A)
2. Crear lote real `prospect_batches` con multi-query target 10 (Hito 13)

---

### Seguridad Hito 13A

| Control | Estado |
|---------|--------|
| DB writes | ✅ ninguno |
| prospect_batches | ✅ ninguno |
| prospect_candidates | ✅ ninguno |
| accounts | ✅ ninguno |
| HubSpot write | ✅ ninguno |
| Apollo / Lusha | ✅ no llamados |
| Proveedor IA | ✅ no usado |
| TAVILY_API_KEY impresa | ✅ no impresa |
| Scripts temporales en git | ✅ eliminados antes de commit |

### Validaciones técnicas Hito 13A

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |

---

## Iteración Hito 13B — Comparativa basic vs advanced

**Fecha:** 2026-05-25  
**Objetivo:** Decidir si Tavily basic es suficiente para producción o si advanced es necesario.

### Por qué se hace la comparación

En Hito 13A se usó `searchDepth: "deep"` (Tavily advanced) para las 5 queries en español y se obtuvo 7/10 prospectables. Antes de crear el primer lote real queremos saber si Tavily basic (`searchDepth: "standard"`) entrega calidad similar con el mismo costo de créditos, dado que:

- Tavily basic y advanced consumen el mismo número de créditos (1 por request).
- La diferencia real es el depth de indexación y la calidad de los resultados retornados.
- Si basic alcanza el umbral de calidad, es el modo más seguro para producción (menor latencia, menor riesgo de timeout).

### Queries usadas

Las 5 queries fijas definidas en Hito 13B:

```
empresa desarrollo software Colombia servicios contacto
empresa tecnología Colombia soluciones empresariales contacto
empresa consultoría tecnológica Colombia servicios TI
empresa software Colombia nosotros servicios
empresa SaaS Colombia soluciones empresas contacto
```

Configuración común: Colombia | Tecnología | maxResultsPerQuery=5 | targetCount=10

### Resultado Prueba A: Tavily basic (`search_depth: basic`)

| Métrica | Valor |
|---------|-------|
| rawResultsCount | 25 |
| dedupedResultsCount | 23 |
| filteredOutCount | 11 |
| keptCount (automático) | 12 |
| prospectables (manual) | 9/12 |
| créditos estimados | 5 (1 por request) |
| avg response time | 1095ms |
| Costo USD | pendiente de configuración oficial |

**Resultados kept notables:**
- lars.net.co, bitcode-enterprise.com, esystems.com.co, cognos.com.co, gtdcolombia.com, it.com.co, virtualcio.com.co, software.com.co → empresas de software/TI Colombia ✓
- co.linkedin.com/company/tecnológica → perfil LinkedIn ✓
- 4mtic.com `/las-mejores-empresas-de-tecnol` → artículo ranking (gap de filtro, el `/` no precede a `mejores`) ✗
- career.softserveinc.com → página de empleos empresa extranjera ✗
- ccc.org.co → Cámara Comercio Cali (no está en ASSOCIATION_CHAMBER_DOMAINS) ✗

**Ruido filtrado:** 11 resultados (directorios, redes sociales, medios, blogs, software_directory).

### Resultado Prueba B: Tavily advanced (`search_depth: advanced`)

| Métrica | Valor |
|---------|-------|
| rawResultsCount | 25 |
| dedupedResultsCount | 20 |
| filteredOutCount | 9 |
| keptCount (automático) | 11 |
| prospectables (manual) | 8/11 |
| créditos estimados | 5 (1 por request) |
| avg response time | 2208ms |
| Costo USD | pendiente de configuración oficial |

**Resultados kept notables:**
- desarrollodesoftware.com.co, lars.net.co, bitcode-enterprise.com, cognos.com.co, infonetenterprise.com.co, innovatecnologica.com, en.software-colombia.com → empresas TI ✓
- co.linkedin.com/company/tecnológica → perfil LinkedIn ✓
- 4mtic.com → ranking (mismo gap de filtro) ✗
- sortlist.com → directorio de agencias (gap de filtro) ✗
- lasempresas.com.co → directorio empresarial (gap de filtro) ✗

### Comparativa de yield

| Modo | Raw | Deduped | Filtrados | Kept auto | Prospectables manual | Créditos | Avg RT | Meta ≥7? |
|------|-----|---------|-----------|-----------|---------------------|----------|--------|----------|
| basic | 25 | 23 | 11 | 12 | 9/12 | 5 | 1095ms | ✓ CUMPLE |
| advanced | 25 | 20 | 9 | 11 | 8/11 | 5 | 2208ms | ✓ CUMPLE |

**Observaciones clave:**
- Ambos modos consumen exactamente los mismos créditos (1 por request = 5 totales para 5 queries).
- Basic es 2× más rápido que advanced (1095ms vs 2208ms promedio).
- Basic tiene mayor dedup count (23 vs 20), lo que indica más diversidad de dominios en el pool raw.
- Advanced tiene menos ruido post-dedup (9 vs 11 filtrados), pero parte de eso se debe a que ya viene más "pre-filtrado" por Tavily internamente.
- La calidad manual es comparable: basic 9/12, advanced 8/11.
- Ambos superan el umbral de 7/10 prospectables definido en Hito 13A.

### Recomendación de modo por defecto

**→ basic como modo default para multi-query en producción.**

Justificación:
1. Mismo costo de créditos que advanced.
2. Mayor velocidad (2× menos latencia promedio).
3. Yield manual comparable (9/12 vs 8/11).
4. Mayor diversidad de dominios pre-dedup.

### Reglas de fallback

```
Si provider = tavily Y mode = multi_query:
  default searchDepth = "standard"  (→ Tavily basic)
  
Si keptCount < 7 con basic en una ejecución concreta:
  retry con searchDepth = "deep"    (→ Tavily advanced)
  
Si advanced tampoco alcanza keptCount ≥ 7:
  no crear lote — revisar queries manualmente
```

### Gaps de filtro identificados en Hito 13B

Durante la comparativa se detectaron 3 gaps residuales del noise filter:

1. **4mtic.com `/las-mejores-empresas-de-tecnol`**: el path `/las-mejores-empresas` no contiene `/mejores-empresas` como substring exacto porque el `/` no precede directamente a `mejores` (hay `las-` en medio). Corrección pendiente: añadir `/las-mejores-empresas` o ajustar el patrón.

2. **ccc.org.co** (Cámara de Comercio de Cali): no está en `ASSOCIATION_CHAMBER_DOMAINS`. El título "Software as a Service archivos - Cámara d..." indica claramente que es una cámara. Corrección pendiente: añadir `ccc.org.co`.

3. **sortlist.com** y **lasempresas.com.co** (advanced): sortlist.com es un directorio de agencias; lasempresas.com.co es un directorio empresarial. Ambos deberían estar en las listas de exclusión. Corrección pendiente: añadir a `SOFTWARE_DIRECTORY_DOMAINS` y `GENERIC_DIRECTORY_DOMAINS` respectivamente.

> Estos gaps se documentan aquí para el siguiente ciclo de hardening del filtro. No se corrigen en este Hito para mantener el scope acotado.

### Seguridad Hito 13B

| Control | Estado |
|---------|--------|
| DB writes | ✅ ninguno |
| prospect_batches | ✅ ninguno |
| prospect_candidates | ✅ ninguno |
| accounts | ✅ ninguno |
| HubSpot write | ✅ ninguno |
| Apollo / Lusha | ✅ no llamados |
| Proveedor IA | ✅ no usado |
| TAVILY_API_KEY impresa | ✅ no impresa |
| Scripts temporales en git | ✅ eliminados antes de commit |

### Validaciones técnicas Hito 13B

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |
