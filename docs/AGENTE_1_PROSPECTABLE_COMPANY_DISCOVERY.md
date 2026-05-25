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

## Próximo paso — Hito 10

**✓ Condiciones cumplidas para generar lote real:**
- Query ganadora identificada con tasa 4/5 prospectables
- Noise filter actualizado y validado con 12/12 fixtures
- Dominios ruidosos específicos (CINTEL, TIC Colombia, Impacto TIC) bloqueados
- `classifySearchResult` sin bugs de runtime

**Configuración sugerida para Hito 10:**
- Query: V2 (arriba)
- `targetCount`: 10
- Provider: `tavily`
- Badge: `controlled_real_test`
- Sin escribir en HubSpot hasta validación manual
