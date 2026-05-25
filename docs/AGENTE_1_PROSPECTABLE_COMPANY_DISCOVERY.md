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
