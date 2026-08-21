# AGENT1 · Matriz de cobertura de subindustria (search vs precision)

**Fase:** AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 1 (read-only audit)
**Fecha de lectura:** 2026-08-11
**Origen:** `execute_sql` de SÓLO LECTURA contra Prod `lrdruowtadwbdulndlph`
**Catálogo:** `industry_catalog_versions.version = '1.0.0'`, `status = 'published'`,
`catalog_version_id = e4675daf-65a2-5e26-8640-58f1aeaee5ed`, `published_at = 2026-06-11`
**Escrituras:** 0 · **Migraciones:** 0 · **Llamadas a proveedor:** 0 · **Créditos:** 0

Las consultas exactas que produjeron esta tabla están en
[`agent1_subindustry_precision_coverage_audit.sql`](agent1_subindustry_precision_coverage_audit.sql).

---

## Totales leídos (no heredados de documentos previos)

| Métrica | Valor |
|---|---|
| `catalog_version` | `1.0.0` |
| `catalog_version_id` | `e4675daf-65a2-5e26-8640-58f1aeaee5ed` |
| `active_industries` | 8 / 8 |
| `active_subindustries` | 73 / 73 |
| `total_search_terms` (activos) | 228 |
| `keyword_terms` | 107 (73/73 subindustrias con ≥1) |
| `query_phrase_terms` | 76 (71 subindustrias) |
| `exclusion_terms` | 35 (30 subindustrias) |
| `source_hint_terms` | 10 (9 subindustrias) |
| `subindustry_aliases` (activos) | 127 |
| `subindustry_rules` (activos) | 364 — **todos** `execution_layer = 'model'` |
| `SEARCH_COVERED` | **73 / 73 = 100.00 %** |
| `PRECISION_MAPPED` | **2 / 73 = 2.74 %** |
| `PRECISION_UNMAPPED` | **71 / 73 = 97.26 %** |
| `AUTO_CONFIRM_POSSIBLE` | **2 / 73 = 2.74 %** |

`PRECISION_MAPPED` NO se deriva de tener search terms. Se deriva de tener entrada en
`SUBINDUSTRY_ANCHOR_TERMS` (`src/server/agents/prospecting-toolkit/apollo-subindustry-precision.ts`),
que es el ÚNICO catálogo que produce `subindustryMapped: true`.

---

## Leyenda de columnas

- `kw` / `qp` / `ex` / `sh` — filas activas en `subindustry_search_terms` por `term_type`
  (`keyword`, `query_phrase`, `exclusion_term`, `source_hint`).
- `al` — filas activas en `subindustry_aliases`.
- `inc` / `exc` — filas activas en `subindustry_rules` con `rule_type` `inclusion` / `exclusion`
  (todas `execution_layer = 'model'`: prosa para el LLM, sin consumidor de código hoy).
- `SC` — search covered (`effectiveTerms.length > 0` en `resolveApolloSubindustrySearchCoverage`).
- `PM` — precision mapped (`SUBINDUSTRY_ANCHOR_TERMS[key]` existe).
- `AC` — auto-confirm posible (`subindustryMatch: 'confirmed'` alcanzable ⇒ puede contar hacia target).
- `fail_closed_reason` — código real que emite el evaluador cuando `AC = no`.

Para las 71 sin mapping, los valores de precisión son constantes y conocidos:

```
precision_mapping_exists            = false
precision_mapping_type              = (ninguno)
precision_positive_signals          = 0
precision_negative_signals          = 0
precision_provider_industry_values  = 0
precision_aliases/synonyms          = 0 (los 127 alias del catálogo NO los lee la precisión)
precision_conflict_rules            = 0
auto_confirm_possible               = false
fail_closed_reason                  = subindustry_not_mapped → SubindustryRequirementMatch 'unmapped'
```

---

## Matriz completa (73 subindustrias activas)

### Tecnología (20)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| Software Empresarial (SaaS / ERP / CRM) | `software-empresarial` | 4 | 2 | 2 | 2 | 5 | 2 | 3 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Ciberseguridad | `ciberseguridad` | 2 | 2 | 1 | 1 | 4 | 2 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Infraestructura Cloud y DevOps | `infraestructura-cloud-devops` | 3 | 1 | 1 | 0 | 4 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Fintech: Infraestructura y Pagos | `fintech-infraestructura-pagos` | 3 | 1 | 2 | 1 | 4 | 1 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| HRtech y Gestión del Talento | `hrtech-gestion-talento` | 3 | 1 | 1 | 0 | 4 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Marketing Technology y Sales Tech | `martech-salestech` | 2 | 1 | 1 | 0 | 3 | 0 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Inteligencia Artificial y Machine Learning | `inteligencia-artificial-ml` | 2 | 2 | 0 | 0 | 4 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Ecommerce Enablement | `ecommerce-enablement` | 2 | 0 | 1 | 0 | 2 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Healthtech B2B | `healthtech-b2b` | 3 | 0 | 2 | 0 | 3 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Proptech e Inmobiliaria Digital | `proptech` | 1 | 1 | 1 | 0 | 2 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Legaltech | `legaltech` | 2 | 1 | 1 | 0 | 3 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Insurtech | `insurtech` | 1 | 1 | 1 | 0 | 2 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Govtech y Ciudades Inteligentes | `govtech` | 2 | 1 | 1 | 0 | 3 | 2 | 3 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Agritech | `agritech` | 1 | 1 | 1 | 0 | 3 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Data Analytics y Business Intelligence | `data-analytics-bi` | 2 | 1 | 0 | 0 | 4 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| IoT y Hardware Conectado | `iot-hardware-conectado` | 1 | 1 | 1 | 0 | 3 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Software Factory y Nearshore | `software-factory-nearshore` | 2 | 1 | 1 | 1 | 4 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Telco y Comunicaciones | `telecomunicaciones-tech` | 2 | 1 | 0 | 0 | 4 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| QA, Testing y Automatización (RPA) | `qa-testing-automatizacion` | 2 | 1 | 0 | 0 | 4 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Edtech: Plataformas de Aprendizaje | `edtech-plataformas` | 2 | 1 | 2 | 0 | 3 | 1 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |

### Servicios Financieros (8)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| Banca Tradicional | `banca-tradicional` | 2 | 1 | 1 | 1 | 3 | 2 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Seguros Generales | `seguros-generales` | 1 | 1 | 0 | 1 | 2 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Seguros de Vida y Personas | `seguros-vida-personas` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Brokers e Intermediarios de Seguros | `brokers-intermediarios-seguros` | 1 | 1 | 1 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Fintech B2B: Servicios Financieros | `fintech-b2b-servicios` | 2 | 1 | 1 | 0 | 3 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Factoring, Leasing y Crédito Empresarial | `factoring-leasing-credito` | 2 | 1 | 0 | 0 | 0 | 2 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Fondos de Inversión y Gestión de Activos | `fondos-gestion-activos` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Cooperativas y Entidades Financieras Solidarias | `cooperativas-financieras` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |

### Salud (9)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| Redes Hospitalarias y Clínicas | `redes-hospitalarias-clinicas` | 1 | 1 | 2 | 0 | 2 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Laboratorios Farmacéuticos | `laboratorios-farmaceuticos` | 1 | 1 | 1 | 0 | 2 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Distribuidores Farmacéuticos | `distribuidores-farmaceuticos` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Dispositivos Médicos y MedTech | `dispositivos-medicos-medtech` | 2 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Laboratorios Clínicos y Diagnóstico | `laboratorios-clinicos-diagnostico` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Salud Ocupacional y Medicina Laboral | `salud-ocupacional` | 2 | 1 | 0 | 0 | 2 | 1 | 0 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Medicina Prepagada y EPS | `medicina-prepagada-eps` | 1 | 3 | 1 | 1 | 5 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| CRO e Investigación Clínica | `cro-investigacion-clinica` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Equipamiento y Suministros Hospitalarios | `equipamiento-hospitalario` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |

### Educación (7)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| Universidades e Institutos Privados | `universidades-institutos-privados` | 1 | 1 | 1 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Universidades Públicas con Capacidad de Compra | `universidades-publicas-relevantes` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Escuelas de Negocios y Formación Ejecutiva | `escuelas-negocios-ejecutiva` | 2 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Formación Corporativa y Corporate Training | `formacion-corporativa-b2b` | 2 | 1 | 1 | 1 | 3 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Institutos Técnicos y Vocacionales | `institutos-tecnicos-vocacionales` | 2 | 1 | 0 | 0 | 5 | 1 | 0 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Certificación Profesional B2B | `certificacion-profesional-b2b` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Grupos Educativos Multi-sede | `grupos-educativos-red` | 1 | 1 | 0 | 0 | 0 | 2 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |

### Retail y Consumo (7)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| **Supermercados e Hipermercados** | `supermercados-hipermercados` | 1 | 1 | 0 | 0 | 2 | 2 | 2 | ✅ | **✅** | **✅** | — (confirmable) |
| **Tiendas por Departamento, Moda y Calzado** | `tiendas-departamento-moda` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | **✅** | **✅** | — (confirmable) |
| Farmacias Cadena y Retail de Salud | `farmacias-cadena-retail` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Retailers Especializados | `retailers-especializados` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Operadores Omnicanal y Ecommerce Retail | `operadores-omnicanal` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Fabricantes de Alimentos y Bebidas (FMCG) | `fabricantes-alimentos-bebidas` | 2 | 1 | 0 | 0 | 3 | 2 | 3 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Cuidado Personal, Higiene y Hogar (FMCG) | `cuidado-personal-higiene-hogar` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |

### Manufactura e Industria (7)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| Metalmecánica y Autopartes | `metalmecanica-autopartes` | 2 | 1 | 0 | 0 | 3 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Químicos, Plásticos y Packaging Industrial | `quimicos-plasticos-packaging` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Bienes de Capital y Maquinaria | `bienes-capital-maquinaria` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Manufactura Exportadora y Zona Franca | `manufactura-exportadora` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Construcción e Infraestructura | `construccion-obra-civil` | 1 | 1 | 0 | 1 | 4 | 1 | 0 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Energía, Minería y Servicios Industriales | `energia-mineria-servicios` | 2 | 1 | 1 | 0 | 4 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Agroindustria y Procesamiento Primario | `agroindustria-procesadora` | 1 | 1 | 1 | 0 | 3 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |

### Consultoría y Servicios Profesionales (7)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| Consultoría de Estrategia y Gestión | `consultoria-estrategia-gestion` | 2 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Auditoría, Contabilidad y Advisory Financiero | `auditoria-contabilidad` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Servicios Legales y Compliance | `servicios-legales-compliance` | 1 | 1 | 1 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| BPO y Contact Center | `bpo-contact-center` | 1 | 1 | 1 | 0 | 4 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Staffing y Servicios Temporales | `staffing-servicios-temporales` | 1 | 1 | 1 | 0 | 3 | 1 | 1 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Facilities, Aseo Industrial y Seguridad Privada | `facilities-seguridad-privada` | 1 | 1 | 1 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Investigación de Mercados e Inteligencia Comercial | `investigacion-mercados-inteligencia` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |

### Logística y Transporte (8)

| Subindustria | slug | kw | qp | ex | sh | al | inc | exc | SC | PM | AC | fail_closed_reason |
|---|---|--:|--:|--:|--:|--:|--:|--:|:--:|:--:|:--:|---|
| Operadores Logísticos 3PL y 4PL | `operadores-logisticos-3pl-4pl` | 1 | 1 | 0 | 0 | 3 | 1 | 0 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Transporte de Carga Terrestre | `transporte-carga-terrestre` | 1 | 1 | 0 | 0 | 0 | 1 | 0 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Freight Forwarders y Agencias de Aduana | `freight-forwarders-aduana` | 1 | 1 | 0 | 0 | 3 | 1 | 0 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Cadena de Frío y Logística Farmacéutica | `cadena-frio-farmaceutica` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Warehousing y Fulfillment B2B | `warehousing-fulfillment` | 1 | 1 | 0 | 0 | 0 | 1 | 0 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Operadores Portuarios y Aeroportuarios de Carga | `operadores-portuarios-aeroportuarios` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Logística para Minería y Energía | `logistica-mineria-energia` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |
| Courier y Mensajería Empresarial | `courier-mensajeria-empresarial` | 1 | 1 | 0 | 0 | 0 | 2 | 2 | ✅ | ❌ | ❌ | subindustry_not_mapped |

---

## Las 2 subindustrias con precisión, en detalle

| Campo | Supermercados e Hipermercados | Tiendas por Departamento, Moda y Calzado |
|---|--:|--:|
| `precision_mapping_type` | hardcode TypeScript (`SUBINDUSTRY_ANCHOR_TERMS`) | hardcode + familias (`SUBINDUSTRY_ANCHOR_FAMILIES`) |
| `precision_positive_signals` (anclas) | 17 | 30 (8 department_store + 14 fashion_apparel + 8 footwear) |
| `precision_negative_signals` — excluyente | 18 | 0 |
| `precision_negative_signals` — en conflicto | 15 | 0 |
| `precision_broad_industry_terms` | 12 | 20 |
| `precision_contradictory_industry_terms` | 12 | 31 |
| `precision_provider_industry_values` | los mismos términos, leídos sobre `industry`/`industries` | idem |
| `precision_aliases/synonyms` de discovery | 14 (`APOLLO_SUBINDUSTRY_CATALOG.aliases`) | 10 |
| `precision_conflict_rules` | modelo de negocio (mayorista, delivery, marketplace) | industria declarada contradictoria (incl. supermercado) |
| `subindustryMatchFamily` | `none` (no distingue familias) | `department_store` / `fashion_apparel` / `footwear` |
| Demanda observada (queries Apollo que la mencionan) | **20** | **8** |

## Demanda real observada (read-only, `provider_usage_logs`)

`provider_key='apollo'`, `operation_key='organizations_search'`, 65 filas, 2026-07-01 → 2026-08-11.

Por industria (`metadata->>'industry'`):

| Industria | búsquedas | primera | última |
|---|--:|---|---|
| Educación | 34 | 2026-07-01 | 2026-07-15 |
| Retail y Consumo | 24 | 2026-07-30 | 2026-08-11 |
| Salud | 4 | 2026-07-01 | 2026-07-01 |
| Tecnología | 2 | 2026-07-15 | 2026-07-15 |
| Servicios Financieros | 1 | 2026-07-27 | 2026-07-27 |

Por subindustria mencionada en `metadata->>'query'`:

| Subindustria | búsquedas | precision hoy |
|---|--:|---|
| Supermercados e Hipermercados | 20 | ✅ mapped |
| **Formación Corporativa y Corporate Training** | **13** | ❌ unmapped |
| Tiendas por Departamento, Moda y Calzado | 8 | ✅ mapped |
| Laboratorios Clínicos y Diagnóstico | 1 | ❌ unmapped |
| Medicina Prepagada y EPS | 1 | ❌ unmapped |

**Caveat obligatorio:** n pequeño y dominado por corridas de QA de la propia usuaria
(incluida la corrida `ce957e2f` ya diagnosticada). Es telemetría real, no una encuesta de
mercado: sirve para ordenar, no para justificar por sí sola una ola.

## Vocabulario de proveedor REALMENTE observado

`provider_industry_raw_label_observations` — 10 etiquetas distintas, 13 observaciones,
**todas** de `operation_key = 'organization_enrichment'` (ninguna de `organizations_search`),
2026-07-15 → 2026-07-31, `source_vocabulary_key = 'apollo_organization_industry'`:

`banking` (2) · `financial services` (2) · `retail` (2) · `accounting` · `capital markets` ·
`investment banking` · `investment management` · `management consulting` · `oil & energy` ·
`professional training & coaching`

`provider_industry_mapping_snapshots` / `_concept_entries` / `_mapping_associations`: **0 filas**
(migración 084 sembró la identidad de vocabulario, 1 fila; el DRAFT fue borrado por 085).
No existe ninguna normalización provider→industria publicada.
