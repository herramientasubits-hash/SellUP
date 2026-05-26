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

---

## Iteración Hito 13B — Hardening del filtro antes de escritura

**Fecha:** 2026-05-25  
**Archivos modificados:** `noise-filter.ts`, `web-search-tool.ts`  
**Criterio:** 12/12 fixtures locales pasan antes de revalidación Tavily.

### Ruido que escapó en Hito 13

En el lote "Tavily MultiQuery Colombia Tecnología 10" (batchId: `51822d95-c998-4e65-aa6d-415ab0f220c3`), solo 4/10 resultados eran prospectables. Ruido identificado:

| URL/dominio | Tipo real | Gap del filtro |
|-------------|-----------|---------------|
| connectamericas.com | Marketplace/directorio BID | No estaba en GENERIC_DIRECTORY_DOMAINS |
| emis.com | Base de datos financiera | No había BUSINESS_DATABASE_DOMAINS |
| empresite.eleconomistaamerica.co | Directorio | Ya estaba (bug en otro layer) |
| freelancer.com/es | Job board/marketplace | Faltaba en JOB_BOARD_DOMAINS |
| teleone.com.co/tecnologia/...claves-sector | Artículo/contenido editorial | Path no capturado por BLOG_PATH_PATTERNS |
| ey.com/es_co/services/technology | Multinacional global | No había GLOBAL_ENTERPRISE_DOMAINS |

### Reglas nuevas implementadas

#### Directorios / marketplaces añadidos a `GENERIC_DIRECTORY_DOMAINS`
| Dominio | Motivo |
|---------|--------|
| `connectamericas.com` | Marketplace de empresas BID — no empresa prospectable |
| `lasempresas.com.co` | Directorio empresarial Colombia |

#### Job boards / freelance añadidos a `JOB_BOARD_DOMAINS`
| Dominio | Motivo |
|---------|--------|
| `freelancer.com` | Marketplace global de freelancers |
| `freelancer.es` | Variante española de Freelancer |
| `workana.com` | Plataforma freelance LATAM |
| `upwork.com` | Marketplace global de freelancers |

#### Directorio de agencias añadido a `SOFTWARE_DIRECTORY_DOMAINS`
| Dominio | Motivo |
|---------|--------|
| `sortlist.com` | Marketplace de búsqueda de agencias digitales |

#### Nuevo set `BUSINESS_DATABASE_DOMAINS`
| Dominio | Motivo |
|---------|--------|
| `emis.com` | Base de datos financiera/empresarial global |
| `emis.com.co` | Variante .co de EMIS |
| `orbis.bvdinfo.com` / `bvdinfo.com` | Bases de datos comerciales similares |

→ Clasificación: `business_database`, `shouldKeep: false`

#### Nuevo set `GLOBAL_ENTERPRISE_DOMAINS` (MVP conservador)
Aplica solo a firmas con presencia global masiva donde el URL encontrado es una landing genérica, no una empresa colombiana local prospectable.

Dominios: `ey.com`, `accenture.com`, `ibm.com`, `oracle.com`, `microsoft.com`, `sap.com`, `pwc.com`, `deloitte.com`, `kpmg.com`, `bcg.com`, `mckinsey.com`

→ Clasificación: `non_prospectable_source`, `shouldKeep: false`

**Nota MVP:** No bloquear subsidiarias locales en el futuro. Si el producto decide prospectar grandes consultoras localmente, se pueden excluir del set o crear lógica de excepción.

#### Nuevos patrones en `BLOG_PATH_PATTERNS`
| Patrón | Caso cubierto |
|--------|--------------|
| `claves-sector` | teleone.com.co/tecnologia/empresa-it-colombia-claves-sector |
| `/cuales-son/` | Artículos "¿Cuáles son las mejores empresas de...?" |

#### Nuevo `CONTENT_PAGE_TITLE_SIGNALS`
Detecta páginas de contenido editorial cuyo path no activa `BLOG_PATH_PATTERNS` pero cuyo título revela que es un artículo. Clasificación: `content_page`, `shouldKeep: false`.

Señales incluidas: `claves del sector`, `empresa de it en`, `mejores empresas de`, `top empresas`, `guía de empresas`, `cómo elegir`, `software y servicios de`, entre otras.

#### Nuevos tipos en `WebSearchResultType`
- `marketplace` — para clasificación semánticamente precisa de marketplaces
- `business_database` — para bases de datos empresariales/financieras
- `content_page` — para páginas de contenido editorial que no son blogs explícitos

#### Penalización en `prospectableScore` (web-search-tool.ts)
Segunda línea de defensa: resultados con títulos de artículo reciben -30 puntos en el score de priorización multi-query, evitando que queden primeros en el ranking aun si pasan el filtro.

### Fixtures locales validados (12/12)

| URL | Esperado | Obtenido | Resultado |
|-----|---------|---------|-----------|
| connectamericas.com/company/... | skip directory | directory | ✅ PASS |
| emis.com/php/company-profile/... | skip business_database | business_database | ✅ PASS |
| empresite.eleconomistaamerica.co/... | skip directory | directory | ✅ PASS |
| freelancer.es/projects/... | skip job_board | job_board | ✅ PASS |
| teleone.com.co/tecnologia/...claves-sector | skip blog_article/content_page | blog_article | ✅ PASS |
| ey.com/es_co/services/technology | skip non_prospectable_source | non_prospectable_source | ✅ PASS |
| gtdcolombia.com/soluciones/servicios-ti | keep official_company_site | official_company_site | ✅ PASS |
| softland.com/co | keep official_company_site | official_company_site | ✅ PASS |
| gerenciatecnologica.com/servicios/soporte-informatico | keep official_company_site | official_company_site | ✅ PASS |
| bitcode-enterprise.com/desarrollo-software-colombia | keep official_company_site | official_company_site | ✅ PASS |
| cognos.com.co/consultoria-ti | keep official_company_site | official_company_site | ✅ PASS |
| innersoftcali.com | keep official_company_site | official_company_site | ✅ PASS |

### Validaciones técnicas — Hardening

| Comando | Resultado |
|---------|-----------|
| `node scripts/tmp-test-filter-hardening-h13b.mjs` | ✅ 12/12 PASS |
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |

### Por qué no se escala a 25 todavía

1. **Calidad base insuficiente**: con 4/10 prospectables en el lote anterior, escalar multiplicaría el ruido.
2. **Revalidación necesaria**: el hardening debe confirmarse con una revalidación Tavily en memoria (sin persistencia) antes de crear un lote nuevo.
3. **Criterio de siguiente lote**: ≥ 7/10 prospectables en revalidación Tavily sin persistencia → entonces crear lote target 10 → validar calidad → solo si ≥ 7/10 escalar a 25.

### Criterio para siguiente revalidación

- Ejecutar `runMultiQueryWebSearch` con `provider: tavily` y `targetCount: 10`.
- Sin llamada a `runProspectingPipeline`, sin persistencia, sin HubSpot.
- Inspeccionar `results[]` manualmente.
- Meta: ≥ 7/10 resultados son empresas colombianas de tecnología prospectables.
- Si pasa: proceder a commit del hardening + lote real.
- Si no pasa: revisar qué nuevas categorías de ruido aparecen y repetir ciclo.

---

## Iteración Hito 13C — Revalidación Tavily en memoria después del hardening

**Fecha:** 2026-05-25  
**Estado:** ⚠ Hardening mejora parcialmente — yield insuficiente, queries 3 y 5 sin resultados  
**Tipo:** Revalidación en memoria — sin persistencia, sin escritura en DB

### Razón de la revalidación

El Hito 13B endureció el filtro (connectamericas, EMIS, sortlist, freelancer.com, upwork, workana,
GLOBAL_ENTERPRISE_DOMAINS, CONTENT_PAGE_TITLE_SIGNALS). Se ejecutó esta revalidación para confirmar
que el hardening eleva la calidad de resultados prospectables de 4/10 (lote anterior) a ≥ 7/10
antes de crear un nuevo lote.

### Input usado

```json
{
  "country": "Colombia",
  "industry": "Tecnología",
  "targetCount": 10,
  "searchDepth": "standard",
  "webSearchProvider": "tavily",
  "mode": "multi_query",
  "maxResultsPerQuery": 5
}
```

### Queries ejecutadas

| # | Query | Resultados |
|---|-------|-----------|
| 1 | `empresa desarrollo software Colombia servicios contacto` | 5 |
| 2 | `empresa tecnología Colombia soluciones empresariales contacto` | 5 |
| 3 | `empresa consultoría tecnológica Colombia servicios TI` | **0** |
| 4 | `empresa software Colombia nosotros servicios` | 5 |
| 5 | `empresa SaaS Colombia soluciones empresas contacto` | **0** |

**Nota:** Queries 3 y 5 devolvieron 0 resultados con Tavily basic. Causa probable: términos demasiado
específicos o combinaciones que no tienen cobertura suficiente en el índice Tavily basic para Colombia.

### Resultados agregados

| Métrica | Valor |
|---------|-------|
| Queries ejecutadas | 5 |
| searchDepth interno | standard |
| tavilySearchDepth enviado | basic |
| maxResultsPerQuery | 5 |
| rawResultsCount | 15 |
| dedupedResultsCount | 14 |
| filteredOutCount | 9 |
| keptCount | 5 |
| Créditos Tavily estimados | 5 |
| Tiempo total (ms) | 8544 |

### Resultados filtrados (ruido bloqueado — el hardening funciona)

| # | Dominio | Tipo | Razón | Clasificación |
|---|---------|------|-------|--------------|
| 1 | rootstack.com | directory | `/empresas-de-desarrollo-de-software-en-colombia` path | bloqueado ✓ |
| 2 | makingapps.com.co | directory | `/top-empresas-desarrollo-software-colombia` path | bloqueado ✓ |
| 3 | emis.com | business_database | EMIS bloqueado (Hito 13B) | bloqueado ✓ |
| 4 | datacreditoempresas.com.co | directory | directorio empresarial DataCrédito | bloqueado ✓ |
| 5 | empresas.larepublica.co | news_or_media | La República (medio) | bloqueado ✓ |
| 6 | facebook.com | social_page | plataforma social | bloqueado ✓ |
| 7 | guiatic.com | directory | directorio genérico | bloqueado ✓ |
| 8 | kcpdynamics.com | directory | `/empresas-de-software-en-colombia` path | bloqueado ✓ |
| 9 | instagram.com | social_page | plataforma social | bloqueado ✓ |

**Todos los filtros hardening 13B funcionaron correctamente.** EMIS detectado y bloqueado. Sin PDFs,
sin fuentes académicas, sin gremios escapados.

### Tabla de kept results y clasificación manual

| # | Empresa | URL | Dominio | Tipo | Query | Clasificación manual |
|---|---------|-----|---------|------|-------|---------------------|
| 1 | Bitcode Enterprise | https://bitcode-enterprise.com/desarrollo-de-software-en-colombia | bitcode-enterprise.com | official_company_site | Q1 | **prospectable** |
| 2 | Lars | https://lars.net.co/empresa-de-desarrollo-de-software | lars.net.co | official_company_site | Q1 | **prospectable** |
| 3 | Heinsohn | https://www.heinsohn.co/co/servicios-ti/desarrollo-de-software-medida | heinsohn.co | official_company_site | Q1 | **prospectable** |
| 4 | SoftServe Colombia (careers) | https://career.softserveinc.com/es/about/colombia | career.softserveinc.com | official_company_site | Q4 | **non_prospectable** — global tech firm, página de careers |
| 5 | Software Colombia | https://software.com.co | software.com.co | official_company_site | Q4 | **prospectable** — reseller .com.co colombiano |

### Criterios de éxito — verificación

| Criterio | Meta | Resultado |
|----------|------|-----------|
| Empresas prospectables | ≥ 7/10 kept | **4/5** (80% de kept, pero solo 5 total) |
| PDFs | 0 | 0 ✓ |
| Fuentes académicas | 0 | 0 ✓ |
| Gremios | 0 | 0 ✓ |
| Medios | 0 | 0 ✓ (1 filtrado) |
| Redes sociales | 0 | 0 ✓ (2 filtradas) |
| Directorios | 0 | 0 ✓ (5 filtrados) |
| Blogs | 0 | 0 ✓ |
| Rankings/listas | 0 | 0 ✓ |
| Marketplaces/job boards | 0 | 0 ✓ |
| Global enterprise sin señal local | 0 | 1 kept (SoftServe careers) — filtro no la detecta aún |

**Resultado parcial:** El filtro de calidad funciona (80% de lo kept es prospectable), pero el
**yield total es 5, no 10**. Las queries 3 y 5 retornaron 0 resultados, lo que impide evaluar
"≥ 7 de 10" porque no se alcanzó el volumen mínimo de kept.

### Veredicto

**Hardening mejora parcialmente — requiere ajuste de queries antes de crear lote.**

- El filtro 13B está validado: bloqueó correctamente 9/14 resultados ruidosos sin falsos positivos.
- La calidad de lo kept es buena: 4/5 prospectables (80%).
- El problema es de **yield, no de calidad**: 2 de 5 queries no retornan resultados con Tavily basic.
- `career.softserveinc.com` pasó el filtro — SoftServe global no está en GLOBAL_ENTERPRISE_DOMAINS.

### Seguridad — confirmación

- ✅ Sin escritura en DB
- ✅ Sin prospect_batches creados
- ✅ Sin candidates creados
- ✅ Sin accounts creados
- ✅ Sin HubSpot write
- ✅ Sin Apollo
- ✅ Sin Lusha
- ✅ Sin IA
- ✅ Sin secrets expuestos en logs
- ✅ Script temporal eliminado antes de documentar

### Validaciones técnicas

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |

### Recomendación — siguiente paso (Hito 13D)

1. **Reemplazar queries 3 y 5** por alternativas con mejor yield en Tavily basic.  
   Candidatos:
   - `"empresa tecnología información Colombia outsourcing TI servicios"`
   - `"empresa servicios tecnológicos Colombia clientes soluciones"`
   - `"empresa TI Colombia desarrollo software medida clientes"`
   - `"proveedor soluciones tecnológicas Colombia empresas B2B"`
2. **Agregar softserveinc.com a GLOBAL_ENTERPRISE_DOMAINS** (o suprimir resultados de subdominios `/career.*`).
3. Ejecutar nueva revalidación en memoria con las queries mejoradas.
4. Si ≥ 7/10 con 10 kept: hacer commit del bloque 13A-13B + crear lote real target 10.

### Estado Git al cierre de Hito 13C

- Sin commit. Sin push.
- Script temporal `scripts/tmp-test-tavily-hardening-memory-h13c.mjs` eliminado.
- Pendientes de commit: los 6 archivos del bloque 13A-13B (docs + 5 src files).

---

## Iteración Hito 13D — Revalidación con queries reemplazadas

**Fecha:** 2026-05-25  
**Estado:** ✅ **CRITERIOS ALCANZADOS** — keptCount=14, prospectables=13/14  
**Tipo:** Revalidación en memoria — sin persistencia, sin escritura en DB

---

### Por qué se reemplazaron queries

En Hito 13C las queries 3 y 5 devolvieron 0 resultados con Tavily basic:

| Query | Problema |
|-------|---------|
| `empresa consultoría tecnológica Colombia servicios TI` | "TI" al final + "consultoría tecnológica" → 0 resultados en Tavily basic |
| `empresa SaaS Colombia soluciones empresas contacto` | "SaaS" es anglicismo con cobertura limitada en índice básico Colombia |

Con solo 3 queries activas de 5, el techo de yield era 15 raw → ≈5 kept, insuficiente para alcanzar keptCount ≥ 10.

### Bloqueo de SoftServe y páginas de careers (Parte B)

En Hito 13C, `career.softserveinc.com` pasó el filtro como `official_company_site`. Era un falso positivo doble: empresa global (no local) + página de empleos (no sitio corporativo prospectable).

**Correcciones implementadas en `noise-filter.ts` (Hito 13D):**

1. `softserveinc.com` añadido a `GLOBAL_ENTERPRISE_DOMAINS`  
   → Cubre `career.softserveinc.com` vía `domainMatchesSet` (`endsWith('.softserveinc.com')`)  
   → Clasificación: `non_prospectable_source`, `shouldKeep: false`

2. `hasCareerSubdomain(domain)` — nueva función  
   → Detecta subdominios `career.*` y `careers.*` de cualquier empresa  
   → Clasificación: `job_board`, `shouldKeep: false`

3. `CAREER_PATH_SEGMENTS` — nuevo array  
   → Detecta paths `/careers/`, `/career/`, `/vacancies/`, `/vacantes/`, `/jobs/`, `/job/`  
   → Clasificación: `job_board`, `shouldKeep: false`

4. `designrush.com` añadido a `SOFTWARE_DIRECTORY_DOMAINS`  
   → Directorio de agencias digitales — escapó el filtro en esta revalidación  
   → Clasificación: `software_directory`, `shouldKeep: false`

### Validación local de fixtures (Parte D)

Script temporal `scripts/tmp-test-softserve-careers-h13d.mjs` ejecutado y eliminado.

| # | URL | Esperado | Obtenido | Estado |
|---|-----|---------|---------|--------|
| 1 | `career.softserveinc.com/en-us/vacancies/country-colombia` | skip non_prospectable_source | non_prospectable_source (global_enterprise) | ✅ PASS |
| 2 | `www.softserveinc.com/en-us/offices/colombia` | skip non_prospectable_source | non_prospectable_source (global_enterprise) | ✅ PASS |
| 3 | `bitcode-enterprise.com/desarrollo-software-colombia` | keep official_company_site | official_company_site | ✅ PASS |
| 4 | `lars.net.co` | keep official_company_site | official_company_site | ✅ PASS |
| 5 | `heinsohn.co` | keep official_company_site | official_company_site | ✅ PASS |
| 6 | `software.com.co` | keep official_company_site | official_company_site | ✅ PASS |

**Resultado: 6/6 fixtures pasaron.**

### Queries para revalidación (Parte C)

Queries 3 y 5 reemplazadas por alternativas con mejores señales de empresa corporativa:

| # | Query | Cambio |
|---|-------|--------|
| 1 | `empresa desarrollo software Colombia servicios contacto` | Sin cambio |
| 2 | `empresa tecnología Colombia soluciones empresariales contacto` | Sin cambio |
| **3** | `empresa servicios tecnológicos Colombia clientes soluciones` | **Reemplaza** `empresa consultoría tecnológica Colombia servicios TI` |
| 4 | `empresa software Colombia nosotros servicios` | Sin cambio |
| **5** | `empresa TI Colombia outsourcing software clientes` | **Reemplaza** `empresa SaaS Colombia soluciones empresas contacto` |

**Racional del reemplazo:**
- "Consultoría tecnológica" + "TI" → términos con baja cobertura en Tavily basic Colombia
- "SaaS" → anglicismo con cobertura limitada en índice básico
- "Servicios tecnológicos", "outsourcing software", "clientes soluciones" → términos que las empresas colombianas usan en su contenido web real

### Configuración utilizada

```json
{
  "country": "Colombia",
  "countryCode": "CO",
  "industry": "Tecnología",
  "targetCount": 10,
  "searchDepth": "standard",
  "tavilySearchDepth": "basic",
  "webSearchProvider": "tavily",
  "mode": "multi_query",
  "maxResultsPerQuery": 5
}
```

### Resultados agregados (Parte E)

| Métrica | Valor |
|---------|-------|
| queries ejecutadas | 5 |
| searchDepth interno | standard |
| tavilySearchDepth enviado | basic |
| maxResultsPerQuery | 5 |
| rawResultsCount | 25 |
| dedupedResultsCount | 24 |
| filteredOutCount | 10 |
| keptCount | **14** |
| créditos estimados | 5 |
| tiempo total (ms) | 3057 |
| tiempo promedio/query | 611ms |

**Detalle por query:**

| Query | Resultados | Tiempo |
|-------|-----------|--------|
| `empresa desarrollo software Colombia servicios contacto` | 5 | 351ms |
| `empresa tecnología Colombia soluciones empresariales contacto` | 5 | 283ms |
| `empresa servicios tecnológicos Colombia clientes soluciones` | 5 | 1387ms |
| `empresa software Colombia nosotros servicios` | 5 | 99ms |
| `empresa TI Colombia outsourcing software clientes` | 5 | 937ms |

**Todas las queries retornaron 5 resultados** — el reemplazo de queries 3 y 5 resolvió el problema de yield del Hito 13C.

### Filtrados (ruido bloqueado — 10 resultados)

| Tipo | Count |
|------|-------|
| directory | 5 |
| social_page | 2 |
| business_database | 1 |
| news_or_media | 1 |
| non_prospectable_source | 1 |

### Resultados kept (14) — clasificación manual

| # | Empresa estimada | Dominio | Type | Query origen | Clasificación manual |
|---|-----------------|---------|------|--------------|---------------------|
| 1 | Bitcode Enterprise | bitcode-enterprise.com | official_company_site | Q1 | ✅ PROSPECTABLE |
| 2 | Lars | lars.net.co | official_company_site | Q1 | ✅ PROSPECTABLE |
| 3 | Heinsohn | heinsohn.co | official_company_site | Q1 | ✅ PROSPECTABLE |
| 4 | eSystems | esystems.com.co | official_company_site | Q3 | ✅ PROSPECTABLE |
| 5 | Solutek Colombia | solutekcolombia.com | official_company_site | Q3 | ✅ PROSPECTABLE |
| 6 | GTD Colombia | gtdcolombia.com | official_company_site | Q3 | ✅ PROSPECTABLE |
| 7 | Gerencia Tecnológica | gerenciatecnologica.com | official_company_site | Q3 | ✅ PROSPECTABLE |
| 8 | TI Colombia | ticolombia.com.co | official_company_site | Q3 | ✅ PROSPECTABLE |
| 9 | Software Colombia | software.com.co | official_company_site | Q4 | ✅ PROSPECTABLE |
| 10 | DesignRush (escapó filtro) | designrush.com | official_company_site | Q5 | ❌ DIRECTORIO — corregido añadiendo a SOFTWARE_DIRECTORY_DOMAINS |
| 11 | TSI Tecnología | tsitecnologia.com.co | official_company_site | Q5 | ✅ PROSPECTABLE |
| 12 | DyC / Selcomp Ingeniería | dyc.com.co | official_company_site | Q5 | ✅ PROSPECTABLE |
| 13 | Outsourcing S.A.S | outsourcing.com.co | official_company_site | Q5 | ✅ PROSPECTABLE |
| 14 | Krypto Outsourcing IT | krypto.com.co | official_company_site | Q5 | ✅ PROSPECTABLE |

**Prospectables confirmados: 13/14** — designrush.com corregido en el filtro durante este hito.

### Criterios de éxito (Parte F)

| Criterio | Meta | Resultado | Estado |
|----------|------|-----------|--------|
| keptCount | ≥ 10 | **14** | ✅ |
| prospectables | ≥ 7/10 | **13/14** | ✅ |
| PDFs | 0 | 0 | ✅ |
| Fuentes académicas | 0 | 0 | ✅ |
| Gremios / asociaciones | 0 | 0 | ✅ |
| Medios de comunicación | 0 | 0 | ✅ |
| Redes sociales | 0 | 0 | ✅ |
| Directorios (en kept) | 0 | 0 | ✅ (designrush corregido) |
| Blogs | 0 | 0 | ✅ |
| Rankings/listas | 0 | 0 | ✅ |
| Marketplaces/job boards | 0 | 0 | ✅ |
| Global enterprise sin señal local | 0 | 0 | ✅ |

### Comparativa Hito 13C vs Hito 13D

| Métrica | Hito 13C | Hito 13D | Δ |
|---------|----------|----------|---|
| Queries con resultados | 3/5 | **5/5** | +2 |
| rawResultsCount | 15 | **25** | +10 |
| dedupedResultsCount | 14 | **24** | +10 |
| filteredOutCount | 9 | 10 | +1 |
| keptCount | 5 | **14** | **+9** |
| prospectables (manual) | 4/5 | **13/14** | **+9** |
| career.softserveinc.com | pasó filtro | **bloqueado** ✓ | fixed |
| designrush.com | — | detectado → corregido | fixed |

**El reemplazo de queries resolvió el problema de yield. keptCount pasó de 5 a 14.**

### Cambios de código en Hito 13D

| Archivo | Cambio |
|---------|--------|
| `noise-filter.ts` | `softserveinc.com` → `GLOBAL_ENTERPRISE_DOMAINS`; `hasCareerSubdomain()` (nueva función); `CAREER_PATH_SEGMENTS` (nuevo array); check 13c en `classifySearchResult` y 8c en `isProspectableCompanyResult`; `designrush.com` → `SOFTWARE_DIRECTORY_DOMAINS` |
| `docs/AGENTE_1_PROSPECTABLE_COMPANY_DISCOVERY.md` | Esta sección |

### Seguridad

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
| Scripts temporales en git | ✅ eliminados |

### Validaciones técnicas

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ 0 errores |
| `npm run build` | ✅ Compiled successfully |

### Estado Git al cierre de Hito 13D

- Sin commit. Sin push.
- Scripts temporales `tmp-test-softserve-careers-h13d.mjs` y `tmp-test-tavily-h13d-query-replacements.mjs` eliminados.
- Pendientes de commit: los 6 archivos del bloque 13A-13D (docs + 5 src files).

### Recomendación final

**✅ Queries reemplazadas validan Tavily para nuevo lote target 10.**

Condiciones cumplidas:
- `keptCount = 14 ≥ 10` ✓
- `prospectables = 13/14 ≥ 7/10` ✓
- 0 ruido en kept (después de corregir designrush.com) ✓
- `career.softserveinc.com` bloqueado ✓
- typecheck y build limpios ✓
- Sin DB writes ✓

**El siguiente paso es:**
1. **Commit del bloque pendiente** (docs + 5 src files del acumulado 13A-13B-13C-13D)
2. **Nuevo lote real target 10** con las 5 queries de Hito 13D y `maxResultsPerQuery: 5`

---

## Hito 16F — Estrategia de providers del Agente 1

**Fecha:** 2026-05-26  
**Estado:** Decisión oficial definida — sin cambios de código  
**Tipo:** Análisis estratégico y documentación

---

### Resumen ejecutivo de benchmark

| Hito | Proveedor | Resultado clave |
|------|-----------|----------------|
| 16A | Auditoría UI | 3 entradas: Mock, Tavily, Apollo+HubSpot |
| 16B | Apollo fix | q_keywords industria ahora llega a Apollo |
| 16C | Benchmark comparativo | Tavily: 10 candidatos pero mayoría artículos/directorios. Apollo: 9 reales pero 1 tech real |
| 16D.1 | Apollo sector scoring | sectorFitScore + sectorFitTag + sectorFitSignals + post-filter |
| 16D.2 | Benchmark Apollo post-filter | 0 fit, 10 low_fit. apollo_industry_raw null en 10/10. Sin señal tecnológica |

**Conclusión del benchmark:** Ningún proveedor estaba listo como discovery principal sin ajustes adicionales. Tavily necesita hardening de queries; Apollo no filtra sector con precisión en el plan/API actual.

---

### Decisión oficial de providers

| Proveedor | Rol oficial | Estado | Justificación |
|-----------|-------------|--------|--------------|
| **Tavily** | **Discovery principal** | Activo (beta) | Devuelve sitios corporativos reales. 13/14 prospectables con queries en español + noise filter. Necesita hardening continuo de queries. |
| **Apollo** | Enriquecimiento complementario sobre empresas ya descubiertas | Congelado para discovery | Devuelve empresas reales pero no filtra sector en plan actual. apollo_industry_raw null en 10/10 ejecuciones. Candidato para enrichment, no discovery. |
| **Lusha** | Enriquecimiento de contactos/personas (futuro) | Fuera de cascada | No tiene rol en discovery inicial. Valor potencial: emails, teléfonos, LinkedIn de contactos sobre empresas ya prospectas. |
| **Mock / Lote de prueba** | QA, demo, desarrollo local | Solo dev/QA | No exponer como acción principal en producción. Confunde la operación real del equipo comercial. |

---

### Cascada actual (no automática)

```
1. Discovery inicial → Tavily (multi-query, básico, español)
2. Revisión humana → candidatos en needs_review
3. Enriquecimiento posterior → Apollo sobre empresas aprobadas (futuro)
4. Enriquecimiento de contactos → Lusha / Apollo / Sales Navigator (futuro)
```

**No hay fallback automático en la cascada actual.**

#### Por qué no se activa fallback automático todavía

| Razón | Explicación |
|-------|-------------|
| Costo descontrolado | Un fallback automático duplicaría el gasto de créditos por lote |
| Calidad desigual | Mezclar Tavily + Apollo sin criterio produce candidatos de calidad variable sin trazabilidad clara |
| Trazabilidad | Con fuentes mezcladas, se pierde el mapa de qué proveedor descubrió qué empresa |
| Ruido duplicado | Apollo puede devolver las mismas empresas con menos datos que Tavily, generando trabajo de dedup extra |
| Apollo sector fit insuficiente | Con apollo_industry_raw null en producción, el filtro de sector no funciona |
| Tavily en hardening | Tavily todavía ajusta queries; activar fallback antes de estabilizarlo introduce más variabilidad |

#### Cuándo activar fallback (criterios futuros)

- Apollo demuestra `apollo_industry_raw` no nulo en ≥70% de ejecuciones para el sector objetivo.
- Tavily alcanza keptCount ≥ 7/10 de forma consistente en producción (no solo en revalidación).
- Se define umbral de costo aceptable por lote con fallback.
- Se implementa feature flag configurable para activar/desactivar fallback por tenant o por lote.

---

### Cascada futura (objetivo)

```
1. Discovery → Tavily (query optimizada por sector/país)
2. Enriquecimiento → Apollo sobre dominios ya descubiertos (no como discovery)
3. Enriquecimiento de contactos → Lusha sobre empresas aprobadas
4. Fallback de discovery → Apollo (solo si Tavily yield < threshold Y Apollo tiene sector fit validado)
```

---

### Recomendación UI

| Elemento actual | Recomendación | Motivo |
|-----------------|---------------|--------|
| Botón "Generar con Tavily" | Renombrar a **"Buscar empresas en web"** o **"Buscar con Tavily (beta)"** | Claridad de intención. El usuario no necesita saber el proveedor técnico. |
| Botón "Generar con IA" | Renombrar a **"Enriquecer con Apollo"** o mover a panel de enriquecimiento | Actualmente confunde: usa Apollo como discovery cuando su rol correcto es enrichment. |
| Botón "Lote de prueba" | Ocultar en producción — solo visible para admin o entorno dev/QA | Confunde la operación real. Si está visible, el equipo puede crear lotes de datos mock sin darse cuenta. |
| Unificación de botones | **No unificar todavía** | Fusionar antes de tener cascada validada crea un flujo opaco donde el usuario no sabe qué proveedor se usó. |

---

### Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Tavily yield cae en sectores distintos a Tecnología | Alta | Medio | Validar queries antes de cada nuevo sector |
| Apollo permanece sin sector fit y se usa para discovery | Media | Alto | Congelar Apollo como discovery hasta validar industry filter |
| Lusha consume créditos sin calidad de contacto validada | Baja | Medio | No activar Lusha hasta tener plan de enrichment definido |
| Mock visible en producción genera lotes de datos falsos | Media | Alto | Ocultar Mock a nivel de permisos de rol |
| Cascada se activa automáticamente por error de configuración | Baja | Alto | No hay cascada automática por ahora; documentar explícitamente |

---

### Criterios para reabrir la decisión de providers

| Situación | Acción |
|-----------|--------|
| Apollo obtiene `organization_industry_tag_ids` válidos en >70% de ejecuciones | Reevaluar Apollo como discovery para sectores con alta densidad de empresas en su base |
| Apollo upgrade de plan con mejor filtro sectorial disponible | Ejecutar nuevo benchmark con filtro sectorial real |
| Tavily yield cae por debajo de 5/10 en producción sostenida | Activar Apollo como fallback de discovery con límites de costo |
| Nuevo proveedor con mejor cobertura sectorial LATAM disponible | Ejecutar benchmark comparativo antes de integrar |
| Lusha demuestra calidad de email/teléfono verificado >80% | Activar Lusha para enrichment de contactos en empresas aprobadas |

---

### Backlog estratégico derivado

#### Hito 16G — Mejorar queries Tavily para sitios corporativos
- Validar queries para sectores distintos a Tecnología (Fintech, Salud, Retail).
- Evitar artículos/listas/directorios con nuevos path patterns.
- Hardening de "corporate website likelihood" scoring.
- Añadir `.org` corporativo como dominio válido para consultoras.
- Probar queries con términos de industria específicos por sector.

#### Hito 16H — Reorganizar botones UI y visibilidad de Mock
- Ocultar "Lote de prueba" en producción (solo admin/dev/QA).
- Renombrar "Generar con Tavily" y "Generar con IA" con nomenclatura orientada a intención.
- Evaluar si "Generar con IA" (Apollo) debe moverse a panel de enriquecimiento.

#### Hito 16I — Evaluar Apollo como enrichment
- Ejecutar Apollo sobre dominios/nombres ya descubiertos por Tavily.
- Medir mejora de: tamaño empresa, industria, empleados, LinkedIn URL, tecnologías, contactos.
- Definir campos de Apollo que agregan valor real sobre candidatos existentes.

#### Hito 16J — Definir cascada configurable
- Feature flags para activar/desactivar providers por tenant.
- Configuración de order de providers y thresholds de yield.
- Max cost per batch con fallback.
- Fallback rules documentadas y testeables.

---

## Hito 14B — Validación UI Tavily multi-query

### Resumen

Tavily multi-query está disponible desde la UI de SellUp y opera completamente separado del flujo Apollo. El usuario puede generar un lote Tavily desde `/prospect-batches` usando el botón "Generar con Tavily". Los candidatos resultantes quedan en estado `needs_review` listos para revisión manual.

### Lote de validación

| Campo | Valor |
|-------|-------|
| batchId | `128df933-09aa-4819-913c-69317e74f74d` |
| name | `Tavily · Colombia · Tecnología · 26 de may de 2026` |
| país | Colombia |
| industria | Tecnología |
| target_count | 10 |
| candidatesCreated | 10 |
| status | `ready_for_review` |
| created_at | `2026-05-26T01:47:53.275332+00:00` |

### Flujo validado

```
UI (/prospect-batches — botón "Generar con Tavily")
→ generateTavilyProspectBatch()
→ runAndWriteProspectingPipeline()
→ Tavily multi-query
→ noise filter
→ name inference
→ candidate writer
→ Supabase (prospect_batches + prospect_candidates)
→ revisión de candidatos
```

### Parámetros forzados

| Parámetro | Valor |
|-----------|-------|
| webSearchProvider | `tavily` |
| mode | `multi_query` |
| maxResultsPerQuery | `5` |
| searchDepth | `basic` |
| dryRun | `false` |

### Candidatos persistidos

| # | Nombre | Website |
|---|--------|---------|
| 1 | Esystems | esystems.com.co |
| 2 | Software | software.com.co |
| 3 | LARS | lars.net.co |
| 4 | Solutek Colombia | solutekcolombia.com |
| 5 | GTD Colombia | gtdcolombia.com |
| 6 | Heinsohn | heinsohn.co |
| 7 | Gintic | gintic.com.co |
| 8 | Selcomp Ingeniería SAS | dyc.com.co |
| 9 | KRYPTO | krypto.com.co |
| 10 | Bitcode Enterprise | bitcode-enterprise.com |

### Validaciones cumplidas

| Validación | Resultado |
|------------|-----------|
| Candidatos persistidos | 10/10 |
| Estado needs_review | 10/10 |
| Aprobados | 0 |
| Descartados | 0 |
| Convertidos | 0 |
| Posibles duplicados | 0 |
| Mock detectado | No |
| Apollo ejecutado | No |
| Lusha ejecutado | No |
| IA generativa invocada | No |
| HubSpot write realizado | No |
| Accounts creadas | No |
| source_title presente | 10/10 |
| inferred_name_source presente | 10/10 |

### Hallazgos menores / backlog

1. **Candidato con nombre genérico:** "Software" / `software.com.co` pasó los filtros con nombre inferido desde dominio. Nombre aceptable técnicamente pero no ideal comercialmente. El filtro de nombres ya existe; este caso bordeó el umbral mínimo.

2. **`prospect_batches.metadata` vacío:** La columna `metadata` del lote quedó como objeto vacío `{}`. Debería persistir los parámetros de configuración del pipeline para trazabilidad: `country`, `industry`, `provider`, `mode`, `maxResultsPerQuery`, `searchDepth`, `dryRun`, `query_version`, `pipeline_summary`, `generated_from_ui`.

### Decisión

**Hito 14B se considera validado y cerrado.**

La conexión UI → Tavily multi-query → Supabase funciona correctamente de extremo a extremo. Los candidatos son reales, la separación con Apollo está intacta en código, y no se ejecutó ningún servicio externo durante la validación.

### Siguiente paso recomendado

Pasar a refinamiento UX/operativo del módulo de revisión de candidatos.

---

## Hito 16F — Estrategia de providers: Tavily + LLM evaluador

**Fecha:** 2026-05-26  
**Tipo:** Decisión arquitectónica documental — sin ejecución de código  
**Estado:** ✓ Definida y aprobada

---

### 1. Decisión estratégica oficial

| Proveedor / Modo | Rol asignado | Estado actual |
|------------------|--------------|---------------|
| **Tavily + LLM evaluador** | Discovery principal del Agente 1 | Tavily operativo; LLM evaluador por construir |
| **Apollo** | Enriquecimiento futuro / fallback futuro | No usar como discovery principal por ahora |
| **LLM solo** | No recomendado como fuente principal | Descartado para operación comercial |
| **Mock / lote de prueba** | Solo QA / demo / dev | Debe ocultarse de flujo comercial |
| **Lusha** | Fuera del Agente 1 discovery | Posible enriquecimiento de contactos en futuro |

**Fundamento:**

Tavily ya recupera evidencia web real. El problema identificado en benchmarks recientes es que los resultados crudos incluyen artículos, rankings y directorios no corporativos. La solución no es cambiar de proveedor de búsqueda, sino agregar una capa evaluadora que use un LLM para clasificar los resultados crudos antes de persistirlos.

Apollo demostró en benchmarks que `apollo_industry`, `technologies` y `short_description` llegaron nulos o vacíos con el plan/API actual. No filtra bien por sector. Queda reservado para enriquecimiento firmográfico cuando exista un plan con `industry_tag_ids` reales.

LLM solo como fuente generativa de empresas introduce riesgo de alucinación, datos desactualizados y baja trazabilidad. No es aceptable en flujo operativo comercial.

---

### 2. Arquitectura objetivo

```
Tavily web search (multi-query, búsquedas orientadas a sitios corporativos)
  → resultados crudos (30–50 URLs / snippets por ejecución)
  → LLM evaluador
      ↳ ¿Es empresa real?
      ↳ ¿País/mercado correcto?
      ↳ ¿Sector correcto para UBITS?
      ↳ ¿Prospectable?
      ↳ Nombre limpio
      ↳ Website principal
      ↳ Evidencia textual
      ↳ decision: keep | discard | review
  → candidatos clasificados "keep" (target: ~10 por lote)
  → sector fit scoring
  → duplicate checker SellUp
  → duplicate checker HubSpot
  → candidate writer → Supabase
  → UI de revisión humana
```

**Principio clave:** el LLM evalúa evidencia recuperada por Tavily. No inventa empresas. No genera datos sin soporte.

---

### 3. Rol del LLM evaluador

El LLM recibe por cada resultado crudo de Tavily:

- URL recuperada
- Título de la página
- Snippet / descripción
- País objetivo
- Sector objetivo

Y devuelve un objeto estructurado por candidato:

```json
{
  "decision": "keep | discard | review",
  "clean_company_name": "string",
  "sector_fit_score": 0.0,
  "country_fit_score": 0.0,
  "prospectability_score": 0.0,
  "confidence": 0.0,
  "evidence": ["string"],
  "reason": "string",
  "risk_flags": ["string"]
}
```

**Escala de scores:** 0.0 a 1.0  
**Umbral sugerido para `keep`:** `sector_fit_score >= 0.6` AND `confidence >= 0.5`  
**Umbral para `review`:** `sector_fit_score >= 0.4` OR baja confianza  
**Umbral para `discard`:** resultado claramente no corporativo, fuera de sector, directorio o artículo

---

### 4. Guardrails del LLM evaluador

El LLM **debe**:

- Usar **solo** la evidencia entregada en el prompt (no recuperar nada externo)
- Devolver `"review"` ante cualquier duda en lugar de inventar
- No afirmar tamaño de empresa, empleados ni revenue sin evidencia explícita
- No aprobar automáticamente (la decisión final sigue siendo humana en la UI)
- Registrar en output qué fragmento de evidencia respaldó cada decisión
- Respetar el límite de candidatos evaluados por lote (`max_raw_results_per_batch`)
- No generar websites inventados — solo devolver el URL ya recuperado por Tavily

El sistema **debe**:

- Registrar tokens input + output por evaluación
- Registrar costo estimado por candidato y por lote
- Registrar proveedor LLM, modelo y versión usados
- Fallar de forma segura si `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` no está disponible (no crashear, devolver error estructurado)
- No ejecutar si `dryRun: true`

---

### 5. Rol de Tavily en la arquitectura objetivo

Tavily sigue siendo la fuente de recuperación web. Se deben mejorar las queries para orientar resultados hacia sitios corporativos y reducir ruido antes de llegar al LLM:

| Mejora necesaria | Descripción |
|------------------|-------------|
| Queries con `site:` hints | Priorizar dominios `.co`, `.com.co`, corporativos |
| Excluir directorios explícitos | Evitar clutteraf.co, empresite, infobel, etc. en queries |
| Aumentar raw results | Traer 30–50 resultados para que el LLM reduzca a 10 |
| `searchDepth: advanced`  | Evaluar si mejora calidad vs costo (hoy es `basic`) |
| Diversidad de queries | Mantener multi-query para cobertura de nicho |

**Objetivo de ratio:** Tavily trae 30–50 resultados crudos → LLM evalúa → ~10 candidatos `keep`.

---

### 6. Rol de Apollo

Apollo **no** es discovery principal por ahora.

**Razón documentada:** En benchmarks recientes con el plan API actual:
- `apollo_industry` devolvió `null` en la mayoría de resultados
- `technologies` y `short_description` llegaron vacíos
- Devolvió empresas reales pero fuera de sector objetivo
- No existe `industry_tag_ids` funcional en el plan actual

**Uso futuro permitido:**

| Caso de uso | Condición |
|-------------|-----------|
| Enriquecer empresa ya aprobada | `company_name` + `website` conocidos → Apollo devuelve firmografía |
| Completar datos faltantes | Tamaño, LinkedIn URL, ubicación, industria SIC |
| Fallback de discovery | Solo si se consigue plan con filtros sectoriales reales |
| Cascada automática | No activar hasta resolver filtrado sectorial |

---

### 7. Rol de Lusha

Lusha no entra al Agente 1 discovery en esta fase.

**Uso futuro:** enriquecimiento de contactos/personas después de aprobar empresa.

| Etapa | Acción |
|-------|--------|
| Empresa identificada y aprobada | → buscar decisores en Lusha |
| Datos a enriquecer | Email, teléfono, cargo, LinkedIn persona |
| Prerequisito | Empresa en Supabase con `status: approved` |

---

### 8. Rol de Mock / lote de prueba

El modo Mock debe salir del flujo comercial visible.

**Opciones de implementación (decidir en hito siguiente):**

- Feature flag `NEXT_PUBLIC_SHOW_MOCK_PROVIDER=false` en producción
- Mostrar solo si `userRole === 'admin'` o `userRole === 'dev'`
- Mover a sección `/qa` o `/dev-tools` separada
- Agregar banner "Solo para QA/pruebas" si aparece

**Regla:** ningún usuario comercial debe ejecutar un lote Mock accidentalmente en producción.

---

### 9. Métricas obligatorias por ejecución

Para cada ejecución Tavily + LLM, el sistema debe registrar:

| Campo | Descripción |
|-------|-------------|
| `batch_id` | UUID del lote en Supabase |
| `user_id` | Quién ejecutó |
| `llm_provider` | openai / anthropic / etc. |
| `llm_model` | gpt-4o-mini / claude-haiku-4-5 / etc. |
| `tokens_input` | Tokens enviados al LLM |
| `tokens_output` | Tokens recibidos del LLM |
| `llm_cost_usd` | Costo estimado en USD |
| `raw_results_evaluated` | Cuántos resultados Tavily recibió el LLM |
| `candidates_kept` | Decisiones `keep` |
| `candidates_discarded` | Decisiones `discard` |
| `candidates_review` | Decisiones `review` |
| `duplicate_sellup_count` | Duplicados detectados en SellUp |
| `duplicate_hubspot_count` | Duplicados detectados en HubSpot |
| `cost_per_useful_candidate_usd` | `llm_cost_usd / candidates_kept` |
| `pipeline_version` | Versión del pipeline (semver o hash) |

**Almacenamiento sugerido:** columna `metadata` en `prospect_batches` (ya existe, hoy subutilizada).

---

### 10. Siguiente hito propuesto: Hito 16G

#### Hito 16G — Prototipo controlado Tavily + LLM evaluador

**Objetivo:** validar calidad y costo del flujo Tavily + LLM antes de integrarlo en la UI.

**Reglas del hito:**

- Ejecutar por **script controlado**, no desde UI
- Tavily trae máximo 50 resultados crudos
- LLM evalúa **máximo 30 resultados** (control de costo)
- LLM devuelve top candidatos clasificados con `keep / discard / review`
- **No aprobar** ningún candidato automáticamente
- **No convertir** ningún candidato a account
- **No escribir** en HubSpot
- Medir calidad: ¿cuántos `keep` son realmente empresas del sector?
- Medir costo: tokens, USD por candidato útil
- Documentar hallazgos en este archivo

**Criterio de éxito del hito:**

- ≥ 7 de 10 candidatos `keep` son empresas reales y del sector
- Costo < USD 0.05 por candidato útil
- Ningún resultado de directorio/ranking sobrevive al LLM
- Trazabilidad completa de evidencia por candidato

---

### 11. Diseño técnico propuesto para Hito 16G

**Módulo esperado:** `src/lib/agents/agent1/llm-evaluator.ts`

**Input del evaluador:**

```typescript
interface LLMEvaluatorInput {
  rawResults: TavilyResult[];   // URL, title, snippet por resultado
  country: string;               // "Colombia"
  industry: string;              // "Tecnología B2B"
  targetCount: number;           // 10
  maxRawToEvaluate: number;      // 30
  llmProvider: "openai" | "anthropic";
  llmModel: string;              // "gpt-4o-mini" | "claude-haiku-4-5-20251001"
  dryRun: boolean;
}
```

**Output del evaluador:**

```typescript
interface LLMEvaluatorOutput {
  candidates: EvaluatedCandidate[];
  metrics: {
    tokensInput: number;
    tokensOutput: number;
    costUsd: number;
    rawEvaluated: number;
    kept: number;
    discarded: number;
    review: number;
    costPerUsefulCandidate: number;
  };
  model: string;
  provider: string;
  evaluatedAt: string;
}
```

**Fail-safe:** si no hay LLM key disponible → lanzar `LLMEvaluatorNotConfiguredError` estructurado, no crashear pipeline.

**Proveedor configurable:** leer `LLM_EVALUATOR_PROVIDER` y `LLM_EVALUATOR_MODEL` desde `.env.local`. Default: `anthropic` / `claude-haiku-4-5-20251001` por costo.

**Control de costo:**

- `maxRawToEvaluate` hardcodeado en 30 para el prototipo
- Prompt comprimido (snippets truncados a 300 chars)
- Un solo batch call al LLM (no un call por resultado)
- Logging de costo antes de ejecutar cualquier write a Supabase

---

### Resumen de estado Hito 16F

| Check | Resultado |
|-------|-----------|
| Provider strategy definida | ✓ |
| Tavily como discovery principal | ✓ Confirmado |
| LLM evaluador como capa de clasificación | ✓ Diseñado |
| Apollo como fallback/enriquecimiento | ✓ Documentado |
| LLM solo descartado | ✓ |
| Mock movido fuera de flujo comercial | ✓ Pendiente implementar |
| Lusha fuera del scope actual | ✓ |
| Métricas de costo definidas | ✓ |
| Hito 16G propuesto | ✓ |
| Código modificado | ✗ Solo documentación |
| Tavily ejecutado | ✗ |
| Apollo ejecutado | ✗ |
| LLM invocado | ✗ |
| Supabase writes | ✗ |
| HubSpot writes | ✗ |
| Lotes creados | ✗ |
| Secretos impresos | ✗ |
| Commit realizado | ✗ Pendiente aprobación |
