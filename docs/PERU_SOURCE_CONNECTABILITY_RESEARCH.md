# Peru Source Connectability Research

**Hito:** Perú.1B — Investigación formal de conectabilidad de fuentes y APIs Perú para Agente 1

**Fecha:** 2026-06-23

**HEAD:** `03d1a27` — feat(source-catalog): add SUNAT Peru bulk availability connector

**Propósito:** Investigar qué fuentes y APIs peruanas adicionales pueden conectarse a SellUp para prospección B2B, antes de construir Perú.2 con `pe_sunat_bulk`.

**Estado:** Research only. No runtime code modified.

---

## 1. Fuentes oficiales o públicas

### 1.1 SUNAT Padrón RUC Bulk — `pe_sunat_bulk`

| Atributo | Valor |
|---|---|
| Tipo | `official_registry` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | RUC, razón social, estado, condición, dirección, UBIGEO |
| Acceso | Descarga pública ZIP |
| Auth | No |
| Documentación técnica | Sí — SUNAT pública, portal datosabiertos.gob.pe |
| Costo | Gratuito |
| Plan trial | No aplica |
| Rate limits | Ninguno (archivo diario, descarga una vez al día) |
| Riesgos | Bajo — datos públicos tributarios |
| Encaje | `discovery` + `validation` + `enrichment` |
| Recomendación | `connect_now` |
| Estado actual | Conector implementado (`pe_sunat_bulk` en CATALOG_SOURCES, connector, normalizer) |
| Source key | `pe_sunat_bulk` |

**Justificación:** Es la base oficial del MVP Perú. Descarga diaria ZIP gratuita (~11-14M registros). Está lista para construirse en Perú.2 con connector y normalizer ya implementados.

---

### 1.2 SUNAT Consulta RUC Individual — `pe_sunat`

| Atributo | Valor |
|---|---|
| Tipo | `official_registry` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | RUC, razón social, estado, condición, dirección, UBIGEO, CIIU, representantes legales |
| Acceso | Web manual con captcha |
| Auth | No |
| Documentación técnica | No — portal web con formulario |
| Costo | Gratuito |
| Plan trial | No aplica |
| Rate limits | No documentados, captcha protege contra automatización |
| Riesgos | Legal-medio — SUNAT no prohíbe scraping explícitamente pero captcha indica protección antiautomatización; estabilidad baja |
| Encaje | `validation` |
| Recomendación | `build_later` — para validación puntual, no discovery |
| Source key | `pe_sunat` (ya en catálogo, `validation_only`) |

**Justificación:** Ya existe en catálogo como `validation_only`. No debe usarse para discovery masivo. Puede complementar `pe_sunat_bulk` para consultas individuales si el RUC no aparece en el padrón reducido.

---

### 1.3 Plataforma Nacional de Datos Abiertos (PNDA) — `datosabiertos.gob.pe`

| Atributo | Valor |
|---|---|
| Tipo | `public_dataset` |
| País | Perú (PE) |
| Sector | Todos — datasets de múltiples entidades |
| Datos | Variables según dataset. SUNAT, PRODUCE, OSIPTEL, OSCE, etc. |
| Acceso | CKAN (portal de datos abiertos) |
| Auth | No — descarga directa CSV/ZIP |
| Documentación técnica | Sí — CKAN API documentada (package_show, datastore_search) |
| Costo | Gratuito |
| Plan trial | No aplica |
| Rate limits | Estándar CKAN |
| Riesgos | Bajo — portal oficial de datos abiertos |
| Encaje | `technical_container` — contenedor de datasets |
| Recomendación | `manual_only` como contenedor, no como fuente directa. Los datasets específicos (SUNAT, PRODUCE, OSCE) se conectan como fuentes individuales |
| Source key | No sugerido — es portal, no fuente |

**Justificación:** La PNDA es el portal que aloja los datasets de SUNAT, PRODUCE y otras entidades. No es una fuente directa sino un contenedor. Cada dataset se consume individualmente.

---

### 1.4 OSCE / SEACE — `pe_seace`

| Atributo | Valor |
|---|---|
| Tipo | `procurement_signal` |
| País | Perú (PE) |
| Sector | Todos — proveedores del Estado |
| Datos | RUC, razón social, contratos, montos, estado |
| Acceso | Portal OSCE datos abiertos |
| Auth | No |
| Documentación técnica | Sí — gob.pe/14272, portal OSCE apps.osce.gob.pe |
| Costo | Gratuito |
| Riesgos | Bajo — datos públicos de contratación |
| Encaje | `commercial_signal` — señal B2G |
| Recomendación | `connect_now` |
| Source key | `pe_seace` (ya en catálogo) |

**Justificación:** Fuente oficial de contratación pública peruana. Complementa `pe_sunat_bulk` con señal B2G. Ya en catálogo como P1. Para MVP técnico debe mantenerse y conectarse cuando esté disponible el adapter.

---

### 1.5 PRODUCE — Directorio MiPyme / Manufactura — `pe_produce`

| Atributo | Valor |
|---|---|
| Tipo | `official_registry` |
| País | Perú (PE) |
| Sector | Manufactura / MiPyme |
| Datos | RUC, razón social, CIIU, UBIGEO |
| Acceso | **WAF-bloqueado** — ninguna URL estática machine-readable verificada |
| Auth | No aplica (acceso bloqueado) |
| Documentación técnica | Sí — datosabiertos.gob.pe (403 WAF) |
| Costo | Gratuito (cuando accesible manualmente) |
| Riesgos | **Alto** — portal bloqueado por CloudFront WAF para acceso programático |
| Encaje | `enrichment` — bloqueado hasta resolución institucional |
| Recomendación | **`POST_MVP_BLOCKED_BY_WAF`** |
| Source key | `pe_produce` (en catálogo; sin conector activo) |

**Hallazgos — Hito Perú.3L-2A (2026-06-24):**

Investigación segura de URL estática. Sin bypass, sin spoofing, sin cookies.

| Portal | CIIU | Formato | URL Estática | Estado |
|---|---|---|---|---|
| datosabiertos.gob.pe (CKAN) | Sí | CSV/XLSX | Desconocida (403 WAF) | Bloqueado |
| transparencia.produce.gob.pe (Google Drive) | Sí (5 dígitos) | CSV | Sí (Google Drive) | **2015 — desactualizado** |
| ogeiee.produce.gob.pe Directorio | Sí | Formulario interactivo | No — formulario | ECONNREFUSED |
| producempresarial.pe PDFs | Solo agregados | PDF | Sí | No machine-readable |
| GitHub / Kaggle mirrors | — | — | Ninguno encontrado | — |

**Verdict:** `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL`

La única URL estática sin auth confirmada (`transparencia.produce.gob.pe` → Google Drive) tiene datos de 2015 — inutilizable para MVP. Todos los accesos 2022+ son WAF-bloqueados o formularios interactivos.

**Siguiente paso recomendado:** Evaluar **Migo API** como fuente CIIU fallback (RUC lookup → CIIU en tiempo real, sin descarga bulk).

---

### 1.6 RNP — Registro Nacional de Proveedores (OSCE)

| Atributo | Valor |
|---|---|
| Tipo | `official_registry` |
| País | Perú (PE) |
| Sector | Todos — proveedores del Estado |
| Datos | RUC, razón social, estado de habilitación, especialidad, domicilio |
| Acceso | OSCE — consulta web individual |
| Auth | No — consulta pública individual |
| Documentación técnica | Parcial — no hay API pública documentada |
| Costo | Gratuito |
| Riesgos | Medio — sin API pública documentada para consulta masiva |
| Encaje | `commercial_signal` |
| Recomendación | `evaluate_commercially` — post-MVP. El RNP tiene datos de proveedores habilitados que complementan SEACE. |
| Source key | `pe_rnp` |

**Justificación:** El RNP registra proveedores habilitados para contratar con el Estado. No tiene API pública documentada. La consulta es web manual. Post-MVP podría ser útil como señal complementaria a SEACE.

---

### 1.7 SUNARP — Personas Jurídicas

| Atributo | Valor |
|---|---|
| Tipo | `official_registry` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | Sociedades inscritas, representantes legales, vigencia |
| Acceso | Web manual — consulta individual |
| Auth | No |
| Documentación técnica | No |
| Costo | Gratuito |
| Riesgos | Medio — sin API, consulta web manual |
| Encaje | `manual_reference` |
| Recomendación | `manual_only` — solo consulta individual, no automatizable para MVP |
| Source key | No sugerido para MVP |

**Justificación:** SUNARP tiene información de representantes legales que no está disponible en SUNAT. Sin API pública. No conectable para MVP.

---

## 2. APIs privadas de datos RUC / SUNAT

### 2.1 OpenRUC (`openruc.com`)

| Atributo | Valor |
|---|---|
| Tipo | `private_api` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | RUC, razón social, estado, condición, dirección, UBIGEO |
| Acceso | API REST pública |
| Auth | No — sin API key |
| Documentación técnica | Sí — OpenAPI, GitHub (github.com/openruc), docs completos |
| Costo | Gratuito |
| Plan trial | No aplica (es gratis) |
| Rate limits | No documentados explícitamente; edge global |
| Riesgos | Bajo — datos públicos SUNAT. El servicio es patrocinado por Latinfo. Sin SLA formal. |
| Encaje | `validation` — fallback rápido de consulta RUC puntual |
| Recomendación | `evaluate_commercially` — excelente candidato como fallback de validación RUC para post-MVP. Es gratis, sin auth, datos oficiales. Construir adapter liviano cuando se necesite validación RUC puntual fuera del bulk. |
| Source key | `pe_openruc` |

**Justificación:** OpenRUC expone datos públicos de SUNAT sin auth, gratis, con documentación OpenAPI y código abierto. Es el candidato ideal como fallback de validación RUC puntual (cuando `pe_sunat_bulk` no tiene un RUC específico o se necesita consultar en tiempo real). Patrocinado por Latinfo. Sin SLA, pero para fallback es aceptable.

---

### 2.2 Migo API (`api.migo.pe`) — Evaluado en Perú.3M + Spike real Perú.3N-R

| Atributo | Valor |
|---|---|
| Tipo | `validation_only` (RUC lookup bajo demanda — NO fuente CIIU) |
| País | Perú (PE) |
| Sector | Todos |
| Datos reales confirmados (spike Perú.3N-R) | RUC, razón social, estado del contribuyente, condición de domicilio, dirección, ubigeo. **No devuelve CIIU, actividad económica ni representantes legales.** |
| Acceso | API REST con Bearer token |
| Auth | Bearer token (`MIGO_API_KEY` — solo variable de entorno, nunca en código/docs/logs/commits) |
| Documentación técnica | Sí — docs.migo.pe |
| Endpoint validado | `GET /api/v1/ruc/{ruc}` |
| Endpoint batch | No validado en spike — no relevante para caso de uso CIIU |
| Costo | Demo: 700q/7d gratis → Básico: S/15/mes (40K) → Empresa: S/25/mes (80K) → Premium: S/25/mes (150K) |
| Riesgos | Bajo para validación RUC. ToS no revisados formalmente. |
| Encaje | `validation_only` — validar RUC puntual (estado, condición, domicilio). NO usar para CIIU ni discovery. |
| Verdict Perú.3M | `SPIKE_WITH_TEST_KEY` (basado en documentación, sin spike real) |
| **Verdict Perú.3N-R (spike real)** | **`MIGO_NOT_USEFUL_FOR_CIIU`** — payload real no contiene CIIU ni actividad económica |
| Estrategia actualizada | Migo queda como `validation_only` opcional. **No usar como fuente CIIU.** |
| Source key | `pe_migo_api` |
| Estado en catálogo | `P2 / validation_only` |

**Resultado del spike real Perú.3N-R:** El payload real de Migo devuelve `ruc`, `nombre_o_razon_social`, `estado_del_contribuyente`, `condicion_de_domicilio`, `ubigeo`, `direccion`, `actualizado_en`. Los campos `containsCiiu`, `containsCiiuRev3`, `containsCiiuRev4`, `containsActivityDescription`, `containsSecondaryActivities`, `containsLegalRepresentatives` son todos `false`. Verdict: `MIGO_NOT_USEFUL_FOR_CIIU`. Ver evaluación completa en `docs/PERU_MIGO_API_CIIU_EVALUATION.md` §13.

---

### 2.3 APIS.net.pe / Decolecta

| Atributo | Valor |
|---|---|
| Tipo | `private_api` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | RUC, razón social, estado, condición, dirección, DNI (descontinuado por protección de datos) |
| Acceso | API REST con Bearer token |
| Auth | API key (Bearer token) |
| Documentación técnica | Sí — decolecta.gitbook.io |
| Costo | No hay pricing público visible tras registro |
| Plan trial | Sí — registro para generar token |
| Rate limits | No documentados |
| Riesgos | Medio-alto — es un proveedor individual (Juan E. Huamani Mendoza). Descontinuó servicio de DNI por normativa de datos personales. Sin SLA formal. El origen de datos combina scraping con padrón SUNAT. |
| Encaje | `validation` |
| Recomendación | `reject_for_mvp` — proveedor individual sin garantías empresariales. Mejor usar OpenRUC (gratis, documentado) o Migo (estructura empresarial) si se necesita API privada. |
| Source key | N/A — rechazado |

**Justificación:** APIS.net.pe/Decolecta es mantenido por un desarrollador individual. Ya descontinuó parte del servicio (consulta DNI) por normativa de protección de datos. El origen de datos incluye scraping. Especialmente para uso productivo en SellUp, Migo API o Perú API son opciones más estables.

---

### 2.4 Perú API (`peruapi.com`)

| Atributo | Valor |
|---|---|
| Tipo | `private_api` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | RUC, DNI, tipo de cambio. RUC: razón social, estado, condición, dirección, UBIGEO, sucursales. |
| Acceso | API REST con API Key (X-API-KEY header o query param) |
| Auth | API key |
| Documentación técnica | Sí — peruapi.com/documentacion, completa con ejemplos |
| Costo | Free: 100/día, 1000/mes. Basic: 1000/día, 30000/mes. Pro: 4000/día, 120000/mes. Business: 10000/día, 300000/mes. |
| Plan trial | Sí — plan Free |
| Rate limits | Free: 10 rpm. Basic: 60 rpm. Pro: 150 rpm. Business: 400 rpm. |
| Riesgos | Medio — proveedor privado. Datos de SUNAT con fallback a proveedores autorizados. Dependencia de tercero. |
| Encaje | `validation` + `enrichment` |
| Recomendación | `evaluate_commercially` — post-MVP. Buena documentación, planes claros, límites explícitos. Útil como fallback de validación RUC. |
| Source key | `pe_peruapi` |

**Justificación:** Perú API es un proveedor con documentación profesional, planes transparentes y panel de control. Ofrece API Bulk (beta) para consultas masivas. Post-MVP puede ser alternativa o complemento a Migo API.

---

### 2.5 ApiPeru.dev / apiperu.dev

| Atributo | Valor |
|---|---|
| Tipo | `private_api` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | RUC, DNI, tipo de cambio, CPE, comisiones AFP, establecimientos anexos, representantes legales |
| Acceso | API REST con Bearer token |
| Auth | Bearer token |
| Documentación técnica | Sí — docs.apiperu.dev, completa con GitBook |
| Costo | Free: 100 consultas/mes. Micro: S/5/mes (2,500). Básico: S/15/mes (50,000). Plus: S/25/mes (100,000). Premium: S/45/mes (250,000). |
| Plan trial | Sí — plan Free |
| Rate limits | No documentados explícitamente |
| Riesgos | Medio — proveedor privado |
| Encaje | `validation` + `enrichment` |
| Recomendación | `evaluate_commercially` — post-MVP. Incluye representantes legales y establecimientos anexos. |
| Source key | `pe_apiperudev` |

**Justificación:** ApiPeru.dev ofrece representantes legales y establecimientos anexos, datos valiosos que no están en el padrón reducido SUNAT. Precios competitivos. Post-MVP.

---

### 2.6 Excel Negocios — Macro / API

| Atributo | Valor |
|---|---|
| Tipo | `private_api` |
| País | Perú (PE) |
| Sector | Todos |
| Datos | RUC, razón social, estado, condición, dirección, teléfonos, correos electrónicos, actividades económicas, representantes legales |
| Acceso | Herramienta Excel con macros + API |
| Auth | Cuenta paga |
| Documentación técnica | Parcial — sitio web informativo, video demostrativo |
| Costo | S/200 + IGV (6 meses, hasta 4,000 RUCs) |
| Plan trial | No claro — producto de pago |
| Rate limits | No documentados |
| Riesgos | Alto — basado en scraping de SUNAT. Sin API REST formal. Datos de contacto (teléfonos, correos) pueden violar normativa de protección de datos. Proveedor individual. |
| Encaje | `contact_enrichment` |
| Recomendación | `reject_for_mvp` — alto riesgo por scraping. Datos de contacto personales sin verificación de legalidad. No hay API REST estándar. Precio único, no suscripción escalable. |
| Source key | N/A — rechazado |

**Justificación:** Excel Negocios es una herramienta de macros Excel que hace scraping de SUNAT para obtener datos de contacto (teléfonos, correos). No tiene API REST formal. Los datos de contacto extraídos por scraping pueden violar términos de SUNAT y normativa de protección de datos. No recomendado para SellUp.

---

### 2.7 Latinfo (`latinfo.dev`)

| Atributo | Valor |
|---|---|
| Tipo | `private_api` — plataforma de inteligencia de datos públicos |
| País | Perú (PE), Colombia (CO), Chile (CL), Brasil (BR), Ecuador (EC), Argentina (AR) |
| Sector | Todos |
| Datos | RUC, razón social, estado, condición, dirección, sanciones (OSCE, OEFA), deuda coactiva SUNAT, contratación pública (SEACE), RNP, score KYB |
| Acceso | API REST con API key |
| Auth | API key |
| Documentación técnica | Sí — latinfo.dev, OpenRUC es su proyecto open source |
| Costo | Tiene plan gratuito (1,000 créditos/mes) |
| Plan trial | Sí — 1,000 créditos/mes gratis |
| Rate limits | No documentados explícitamente |
| Riesgos | Medio — proveedor privado pero con respaldo de OpenRUC (open source). Datos de fuentes públicas oficiales. Dependencia de tercero. |
| Encaje | `enrichment` + `commercial_signal` + `risk_assessment` |
| Recomendación | `evaluate_commercially` — alta prioridad post-MVP. Latinfo es el único proveedor que cruza múltiples fuentes (SUNAT, OSCE, OEFA, SEACE, RNP) en una sola API y ofrece score KYB. Tiene plan gratuito generoso y es el sponsor de OpenRUC (open source). |
| Source key | `pe_latinfo` |

**Justificación:** Latinfo es estratégicamente interesante: (1) cruza SUNAT + OSCE + OEFA + SEACE + RNP en una API, (2) ofrece score KYB (riesgo), (3) patrocina OpenRUC como open source, (4) cubre 6 países LatAm. Post-MVP puede ser una plataforma de enriquecimiento y señal comercial completa para Perú y potencialmente para Colombia, Chile, Brasil, Ecuador y Argentina.

---

### 2.8 Verifica.id

| Atributo | Valor |
|---|---|
| Tipo | `private_api` — KYC/AML |
| País | Perú (PE) |
| Sector | Todos — verificación de identidad |
| Datos | RUC, DNI, carnet de extranjería, reportes AML, biometría |
| Acceso | API REST documentada |
| Auth | API key |
| Documentación técnica | Sí — docs.verifica.id |
| Costo | No público — planes personalizados |
| Plan trial | No claro |
| Rate limits | No documentados |
| Riesgos | Medio — enfocado en KYC/AML, no en prospección B2B. Precio enterprise probable. |
| Encaje | `manual_reference` — para validación de identidad/KYC |
| Recomendación | `reject_for_mvp` — no es una fuente de prospección B2B. Es una plataforma de verificación de identidad y cumplimiento KYC/AML. Podría ser útil post-MVP para validación de identidad, pero no para discovery o enriquecimiento de prospectos. |
| Source key | N/A — fuera de alcance para Agente 1 |

**Justificación:** Verifica.id está orientado a KYC/AML (conozca a su cliente / lavado de activos), no a prospección B2B. Precios enterprise no públicos. No recomendado para Agente 1.

---

### 2.9 Otros proveedores menores (json.pe, consultadatos.com, factiliza.com, apimanager.online)

| Proveedor | Tipo | Observación | Recomendación |
|---|---|---|---|
| json.pe | API RUC/DNI | Token Bearer, documentada, +50K desarrolladores. Planes desde pago. | `evaluate_commercially` post-MVP |
| consultadatos.com | API RUC/DNI | Plan gratuito (30 consultas/7 días). Datos de contacto no verificados. | `reject_for_mvp` — datos de contacto sensible |
| factiliza.com | API RUC/DNI/facturación | 100 consultas gratis. Documentación parcial. | `evaluate_commercially` post-MVP |
| apimanager.online | API RUC/DNI | Free: 20 consultas. Planes desde S/25/mes. Búsqueda por RUC o razón social. | `evaluate_commercially` post-MVP — destacable porque permite búsqueda por razón social |

**Justificación general:** Existe un ecosistema amplio de APIs de consulta RUC en Perú. La mayoría son wrappers de SUNAT con distintos modelos de negocio. Para MVP, `pe_sunat_bulk` es suficiente. Post-MVP, se puede evaluar Migo, Perú API o Latinfo como complementos.

---

## 3. Plataformas B2B / inteligencia comercial

### 3.1 Apollo.io

| Atributo | Valor |
|---|---|
| Tipo | `b2b_enrichment` |
| País | Global — cobertura Perú existe pero limitada |
| Datos | Empresas, contactos, emails, teléfonos, decisores |
| Acceso | API REST con API key |
| Auth | API key |
| Documentación técnica | Sí |
| Costo | Desde ~$49/mes |
| Plan trial | Sí |
| Rate limits | Según plan |
| Riesgos | Medio — datos de contacto personales, tasa de rebote 25-40% en LatAm. Ya se usa en SellUp como capa de enriquecimiento. |
| Encaje | `contact_enrichment` |
| Recomendación | `connect_now` — pero en cascada (último eslabón), no para discovery primario. Ya configurado en SellUp. |
| Source key | No aplica (fuente global ya existente) |

**Justificación:** Apollo ya está integrado en SellUp como capa de enriquecimiento de contactos. Para Perú, debe usarse como eslabón final de la cascada, no como fuente de discovery primario. La cobertura de Apollo en Perú es limitada comparada con USA/Europa.

---

### 3.2 Lusha

| Atributo | Valor |
|---|---|
| Tipo | `b2b_enrichment` |
| País | Global — cobertura LatAm débil |
| Datos | Contactos, emails, teléfonos |
| Acceso | API REST |
| Auth | API key |
| Documentación técnica | Sí |
| Costo | ~$300/mes |
| Plan trial | Sí |
| Rate limits | Según plan |
| Riesgos | Medio — datos de contacto personales. Cobertura Latám limitada. No validado funcionalmente en SellUp. |
| Encaje | `contact_enrichment` |
| Recomendación | `evaluate_commercially` — post-MVP. No usar para discovery masivo. |
| Source key | No aplica |

**Justificación:** Lusha no está validado aún en SellUp. Cobertura LatAm débil. Post-MVP se puede evaluar como complemento a Apollo para enriquecimiento de contactos.

---

### 3.3 Kaspr

| Atributo | Valor |
|---|---|
| Tipo | `b2b_enrichment` |
| País | Global |
| Datos | Contactos, teléfonos |
| Acceso | API REST |
| Auth | API key |
| Documentación técnica | Sí |
| Costo | Desde ~$49/mes |
| Riesgos | Medio — datos de contacto personales. Cobertura LatAm no documentada. |
| Encaje | `contact_enrichment` |
| Recomendación | `reject_for_mvp` — sin evidencia de cobertura sólida en Perú. Apollo ya cubre esta necesidad. Post-MVP evaluar si hay necesidad no cubierta. |
| Source key | N/A |

---

### 3.4 Sales Navigator (LinkedIn)

| Atributo | Valor |
|---|---|
| Tipo | `b2b_enrichment` |
| País | Global — cobertura Perú moderada |
| Datos | Decisores, empresas, cambios de cargo |
| Acceso | Web manual — no hay API pública que permita automatización masiva |
| Auth | Cuenta paga |
| Documentación técnica | No para automatización |
| Costo | ~$99–149/mes |
| Riesgos | Alto — ToS prohíben scraping y exportación masiva. Límite 2,500 resultados por búsqueda. |
| Encaje | `manual_reference` — uso manual del equipo comercial |
| Recomendación | `reject_for_mvp` para flujo automático. Uso manual aceptable pero no integrable en pipeline IA. |
| Source key | N/A |

**Justificación:** Sales Navigator no tiene API que permita automatización masiva. Su uso está limitado a consulta manual. Los términos de servicio prohíben scraping. No debe integrarse en el flujo automático del Agente 1.

---

### 3.5 Otras plataformas

| Plataforma | Observación | Recomendación |
|---|---|---|
| ZoomInfo | Cobertura LatAm limitada | `reject_for_mvp` |
| CIAL Dun & Bradstreet | Cobertura Perú, plan enterprise | `evaluate_commercially` post-MVP |
| Kompass | Cobertura Perú, calidad variable | `reject_for_mvp` |

---

## 4. Herramientas de scraping / extracción

### 4.1 Apify

| Atributo | Valor |
|---|---|
| Tipo | `scraping_tool` |
| País | Global |
| Acceso | Plataforma con actores predefinidos |
| Auth | Cuenta paga |
| Riesgos | Alto para LinkedIn — viola ToS. Para fuentes públicas sin restricciones, riesgo bajo. |
| Recomendación | `reject_for_mvp` para LinkedIn. Evaluar individualmente por actor/fuente. |

---

### 4.2 PhantomBuster

| Atributo | Valor |
|---|---|
| Tipo | `scraping_tool` |
| País | Global |
| Acceso | API con Phantoms predefinidos |
| Auth | Cuenta paga |
| Riesgos | Alto — LinkedIn ToS violation. La plataforma ha sido bloqueada por LinkedIn. |
| Recomendación | `reject_for_mvp` — riesgo legal alto. No recomendado para ningún flujo de SellUp. |

---

### 4.3 Octoparse

| Atributo | Valor |
|---|---|
| Tipo | `scraping_tool` |
| País | Global |
| Acceso | Software de escritorio |
| Auth | Cuenta paga |
| Riesgos | Medio — depende de la fuente scrapeada. Herramienta generalista. |
| Recomendación | `reject_for_mvp` — no hay caso de uso claro para Perú que requiera scraping cuando hay fuentes oficiales disponibles. |

---

### 4.4 Thunderbit

| Atributo | Valor |
|---|---|
| Tipo | `scraping_tool` |
| País | Global |
| Acceso | Browser extension + API |
| Auth | Cuenta |
| Riesgos | Medio — herramienta nueva, sin track récord en LatAm |
| Recomendación | `reject_for_mvp` |

---

## 5. Tabla comparativa completa

| Fuente | Tipo | Acceso | Auth | Datos clave | Costo/Trial | Riesgo | Recomendación | Source key sugerido |
|---|---|---|---|---|---|---|---|---|
| SUNAT Padrón RUC Bulk | `official_registry` | ZIP descarga | No | RUC, razón social, estado, condición, dirección, UBIGEO | Gratuito | Bajo | `connect_now` | `pe_sunat_bulk` |
| SUNAT Consulta Individual | `official_registry` | Web manual | No | RUC completo, representantes, CIIU | Gratuito | Medio | `build_later` | `pe_sunat` |
| OpenRUC | `private_api` | API REST | No | RUC, razón social, estado, dirección | Gratuito | Bajo | `evaluate_commercially` | `pe_openruc` |
| Migo API | `private_api` | API REST | API key | RUC + representantes + locales anexos | S/15–25/mes, trial 7d | Medio | `evaluate_commercially` | `pe_migo_api` |
| APIS.net.pe | `private_api` | API REST | Bearer token | RUC parcial | No pricing público | Medio-Alto | `reject_for_mvp` | N/A |
| Perú API | `private_api` | API REST | API key | RUC + sucursales | Free: 100/día, Basic desde pago | Medio | `evaluate_commercially` | `pe_peruapi` |
| ApiPeru.dev | `private_api` | API REST | Bearer token | RUC + representantes + establecimientos | Free: 100/mes, Micro S/5/mes | Medio | `evaluate_commercially` | `pe_apiperudev` |
| Excel Negocios | `private_api` | Excel macros | Cuenta | RUC + teléfonos + correos | S/200 (6 meses) | Alto | `reject_for_mvp` | N/A |
| Latinfo | `private_api` | API REST | API key | RUC + sanciones + deuda + SEACE + RNP + score KYB | Free: 1,000 créditos/mes | Medio | `evaluate_commercially` | `pe_latinfo` |
| Verifica.id | `private_api` | API REST | API key | RUC + KYC/AML | Enterprise | Medio | `reject_for_mvp` | N/A |
| OSCE/SEACE | `procurement_signal` | Portal/Datos abiertos | No | Contratos, proveedores, montos | Gratuito | Bajo | `connect_now` | `pe_seace` |
| PRODUCE | `official_registry` | WAF-bloqueado | No | RUC, CIIU, manufactura | Gratuito | **Alto** | `POST_MVP_BLOCKED_BY_WAF` | `pe_produce` |
| RNP | `official_registry` | Web manual | No | Proveedores habilitados Estado | Gratuito | Medio | `evaluate_commercially` | `pe_rnp` |
| SUNARP | `official_registry` | Web manual | No | Representantes legales, sociedades | Gratuito | Medio | `manual_only` | N/A |
| PNDA | `public_dataset` | CKAN | No | Múltiples datasets | Gratuito | Bajo | `manual_only` | N/A (contenedor) |
| Apollo.io | `b2b_enrichment` | API REST | API key | Contactos, emails, decisores | Desde $49/mes | Medio | `connect_now` (cascada) | Global |
| Lusha | `b2b_enrichment` | API REST | API key | Contactos, teléfonos | ~$300/mes | Medio | `evaluate_commercially` | Global |
| Kaspr | `b2b_enrichment` | API REST | API key | Contactos | Desde $49/mes | Medio | `reject_for_mvp` | N/A |
| Sales Navigator | `b2b_enrichment` | Web manual | Cuenta | Decisores | ~$99–149/mes | Alto | `reject_for_mvp` | N/A |
| Apify | `scraping_tool` | Plataforma | Cuenta | Variable | Pago | Alto | `reject_for_mvp` | N/A |
| PhantomBuster | `scraping_tool` | Phantoms | Cuenta | Variable | Pago | Alto | `reject_for_mvp` | N/A |

---

## 6. Veredicto por categoría

### 6.1 Fuentes oficiales / públicas

| Veredicto |
|---|
| ✅ **SUNAT Padrón RUC Bulk (`pe_sunat_bulk`):** BASE DEL MVP PERÚ. Conector implementado. Proceder con Perú.2. |
| ✅ **SUNAT Consulta Individual (`pe_sunat`):** Ya en catálogo como `validation_only`. Mantener. |
| ✅ **OSCE/SEACE (`pe_seace`):** Fuente B2G oficial. Mantener en catálogo. Conectar post-MVP. |
| 🚫 **PRODUCE (`pe_produce`):** WAF-bloqueado. Sin URL estática machine-readable para datos 2022+. Verdict: `POST_MVP_BLOCKED_BY_WAF`. Evaluar Migo API como fallback CIIU. |
| ⏸️ **RNP (`pe_rnp`):** Evaluar post-MVP. Sin API pública. |
| ⏸️ **SUNARP:** Solo consulta manual. No conectar en MVP. |
| ⏸️ **PNDA:** Contenedor técnico. No es fuente directa. |

### 6.2 APIs privadas RUC

| Veredicto |
|---|
| ⏸️ **OpenRUC:** Recomendado como fallback de validación RUC post-MVP. Gratuito, sin auth, open source. |
| ⏸️ **Migo API:** Mejor candidato para API RUC privada post-MVP. Trial disponible. Representantes legales. |
| ⏸️ **Perú API / ApiPeru.dev:** Alternativas post-MVP con planes free. |
| ⏸️ **Latinfo:** Alta prioridad post-MVP. Cruzas múltiples fuentes, score KYB, 6 países. |
| ❌ **APIS.net.pe / Decolecta:** Rechazado. Proveedor individual, datos parciales, sin garantías. |
| ❌ **Excel Negocios:** Rechazado. Scraping de SUNAT, datos de contacto no verificados legalmente. |
| ❌ **Verifica.id:** Fuera de alcance para Agente 1 (KYC/AML). |

### 6.3 B2B / Contact data

| Veredicto |
|---|
| ✅ **Apollo.io:** Ya integrado. Usar como último eslabón de la cascada. |
| ⏸️ **Lusha:** Evaluar post-MVP. No validado en SellUp. |
| ❌ **Kaspr:** Sin evidencia de cobertura Perú. |
| ❌ **Sales Navigator:** No integrar automáticamente. Uso manual aceptable. Prohibido scraping. |

### 6.4 Scraping / extracción

| Veredicto |
|---|
| ❌ **PhantomBuster:** Rechazado. Riesgo legal alto (LinkedIn ToS). |
| ❌ **Apify / Octoparse / Thunderbit:** Rechazados para MVP. No hay caso de uso que justifique scraping cuando hay fuentes oficiales disponibles. |

---

## 7. Recomendación de arquitectura para Perú

### MVP (Perú.2 actual)

| Fuente | Rol | Modo |
|---|---|---|
| `pe_sunat_bulk` | Discovery + validación RUC masiva | Wizard discovery |
| `pe_sunat` | Validación individual complementaria | Validation only |
| `pe_seace` | Señal B2G | Maintenance — conectar adapter post-MVP |
| `pe_produce` | Señal manufactura | Maintenance |

**MVP flow:**

```
candidato (nombre, dominio, linkedin)
  ↓
pe_sunat_bulk → identity resolver (RUC → nombre/estado)
  ↓
¿Match en SUNAT?
  ├── Sí → enrichment con datos SUNAT (estado, condición, ubicación, CIIU)
  │         → señal SEACE si aplica (post-MVP)
  │         → enriquecimiento Apollo (post-MVP)
  │         → HubSpot
  └── No → señal débil
            → human_review_required
```

### Post-MVP (priorizado)

| Prioridad | Fuente | Tipo | Costo estimado |
|---|---|---|---|
| P1 | Latinfo | Enriquecimiento multi-fuente + score KYB | Gratis (1,000 créditos/mes) |
| P1 | OpenRUC | Fallback validación RUC (gratis, sin auth) | Gratuito |
| P2 | Migo API | Representantes legales + locales anexos | S/15–25/mes |
| P2 | OSCE/SEACE adapter | Señal B2G automática | Gratuito |
| P3 | RNP | Proveedores habilitados Estado | Gratuito |
| P3 | Apollo/Lusha | Contact enrichment | Desde $49/mes |

### Rechazado / No recomendado

| Fuente | Motivo |
|---|---|
| APIS.net.pe | Proveedor individual, sin garantías |
| Excel Negocios | Scraping, datos de contacto no verificados |
| PhantomBuster | Riesgo legal (LinkedIn ToS) |
| Sales Navigator (automático) | ToS prohíbe automatización |
| Verifica.id | Fuera de alcance (KYC/AML) |
| Kaspr | Sin evidencia de cobertura Perú |

---

## 8. Archivos modificados

| Archivo | Cambio |
|---|---|
| `docs/PERU_SOURCE_CONNECTABILITY_RESEARCH.md` | **Creado** — documento de investigación formal |
| `AUDITORIA-FUENTES-IA.md` | **Actualizado** — referencia al hito Perú.1B |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | **Actualizado** — sección Perú con nuevas fuentes investigadas |

---

## 9. Confirmaciones de no modificación

| Recurso | Confirmación |
|---|---|
| `CATALOG_SOURCES` (`source-catalog.ts`) | ✅ No modificado |
| `source-discovery-preflight.ts` | ✅ No modificado |
| `SOURCE_DISCOVERY_REGISTRY` | ✅ No modificado |
| `connector-registry.ts` | ✅ No modificado |
| `enrichment-adapter-registry.ts` | ✅ No modificado |
| `validated-source-configs.ts` | ✅ No modificado |
| `package.json` / `package-lock.json` | ✅ No modificado |
| Supabase | ✅ No tocado |
| Colombia (CO) | ✅ No tocado |
| México (MX) | ✅ No tocado |
| Chile (CL) | ✅ No tocado |
| INAPI | ✅ No tocado |
| Connectors creados | ✅ Ninguno |

---

## 10. Validaciones

| Comando | Resultado |
|---|---|
| `npm run test:inapi` | |
| `npm run test:inapi-safety` | |
| `npm run typecheck` | |
| `npm run build` | |
| `git diff --check` | |
| `git diff --name-only` | |

*(Resultados se completarán después de ejecutar las validaciones)*

---

## 11. Siguiente hito recomendado

**Perú.2 — Construir pipeline de disponibilidad masiva con `pe_sunat_bulk`**

Construir el pipeline completo de `pe_sunat_bulk` usando el conector ya implementado:

1. Completar normalización de datos SUNAT (RUC, razón social, estado, condición, UBIGEO, CIIU).
2. Conectar wizard discovery para Perú usando `pe_sunat_bulk` como fuente principal.
3. Configurar `source-discovery-preflight` para que recomiende `pe_sunat_bulk` para Perú.
4. Registrar en `SOURCE_DISCOVERY_REGISTRY`.
5. Probar con una corrida de discovery controlada.
6. Validar tasa de match, calidad de datos y cobertura CIIU.

**Post-MVP (Perú.3 en adelante):**

7. Conectar `pe_seace` como señal B2G (enrichment adapter).
8. Evaluar OpenRUC como fallback de validación RUC en tiempo real.
9. Evaluar Latinfo como plataforma de enriquecimiento multi-fuente y score KYB.
10. Evaluar Migo API para representantes legales y establecimientos anexos.

---

## 12. Hito cerrado — Perú.3H: Vercel-safe SUNAT snapshot strategy + raw sample boundary

**HEAD:** `0c2a86d` — feat(source-catalog): add SUNAT Peru sample parse dry run

### Veredicto

Arquitectura Vercel-safe documentada y frontera de privacidad de `fullSampleLines` reforzada. PE permanece en `SAFE_CONNECTOR_ONLY`. No se activó Perú en registry/preflight/wizard.

### Decisión de arquitectura Vercel-safe

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARQUITECTURA VERCEL-SAFE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  VERCEL (Serverless / Runtime wizard)                             │
│  ─────────────────────────────────────────                        │
│  ✅ Mostrar resultados ya procesados desde Supabase                │
│  ✅ Consultar snapshot de empresas PE normalizadas                │
│  ✅ Lanzar ejecución externa/job (trigger, no ejecución)          │
│  ✅ Availability checks livianos (HEAD, metadata HTTP)             │
│  ❌ NO descargar padron_reducido_ruc.zip                          │
│  ❌ NO descomprimir 1.55 GB                                       │
│  ❌ NO parsear millones de filas                                  │
│  ❌ NO hacer deeper scan en request de usuario                    │
│  ❌ NO generar snapshot completo en runtime serverless             │
│                                                                   │
│  WORKER / BACKEND JOB / LOCAL CONTROLLED PROCESS                  │
│  ─────────────────────────────────────────                        │
│  ✅ Descargar ZIP completo (cuando se autorice)                   │
│  ✅ Descomprimir localmente/worker                                │
│  ✅ Filtrar RUC 20 (empresas B2B)                                 │
│  ✅ Normalizar empresas (razón social, estado, ubigeo)            │
│  ✅ Generar snapshot                                              │
│  ✅ Persistir snapshot en Supabase (cuando exista diseño)         │
│                                                                   │
│  SUPABASE                                                         │
│  ─────────                                                         │
│  Debe ser la fuente consultable por SellUp:                       │
│  - empresas PE normalizadas                                       │
│  - RUC, razón social, estado, condición, ubigeo                   │
│  - metadata de snapshot, fecha de corte, fuente                   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Estado y frontera de `fullSampleLines`

| Aspecto | Decisión |
|---------|----------|
| ¿Qué es? | Artefacto interno de dry-run que conecta extractor + parser |
| ¿Dónde vive? | Solo en `SunatBulkSampleExtractionOutput.sample.fullSampleLines` |
| ¿Quién lo consume? | `runSunatBulkSampleParseDryRun` internamente |
| ¿Aparece en output público? | No — `SunatBulkSampleParseDryRunOutput` no lo incluye |
| ¿Debe persistirse? | No |
| ¿Debe exponerse en UI? | No |
| ¿Debe ir a metadata de candidatos? | No |
| ¿Límite duro? | Sí — `ABSOLUTE_MAX_LINES = 200` |
| ¿Se sanitiza? | Sí — solo existe en output interno del extractor |

### Confirmaciones

| Confirmación | Estado |
|-------------|--------|
| PE sigue SAFE_CONNECTOR_ONLY | ✅ |
| No se activó preflight/registry/wizard | ✅ |
| No se descargó ZIP completo | ✅ |
| No se escribió Supabase | ✅ |
| fullSampleLines es solo dry-run interno | ✅ |
| No existen rawRows/allRows/fullRows en output | ✅ |
| Siguiente hito será local/offline/development-only | ✅ |

### Archivos modificados en Perú.3H

| Archivo | Cambio |
|---------|--------|
| `docs/PERU_SOURCE_CONNECTABILITY_RESEARCH.md` | Añadida §12 (este documento) |
| `AUDITORIA-FUENTES-IA.md` | Añadida decisión Perú.3H |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | Añadida nota arquitectura Vercel-safe |
| `src/server/source-catalog/connectors/sunat-peru/types.ts` | JSDoc marcando fullSampleLines como internal-only |
| `src/server/source-catalog/connectors/sunat-peru/sunat-sample-extractor.ts` | JSDoc marcando fullSampleLines como internal-only |
| `src/server/source-catalog/connectors/sunat-peru/__tests__/sunat-sample-parse-dry-run.test.ts` | Test que fullSampleLines no está en output público |

### Próximo hito autorizado

**Perú.3I — Local/offline deeper scan of SUNAT RUC 20 companies.**

Este hito DEBE ejecutarse en entorno local/worker/development-only. No debe correr en Vercel.

Pasos:
1. Descargar ZIP completo en entorno local.
2. Extraer TXT completo.
3. Filtrar RUC 20 (empresas B2B).
4. Normalizar primeras N empresas como muestra de calidad.
5. Reportar cobertura, distribución geográfica y sectores CIIU.
6. NO guardar en Supabase aún — es exploratory research.
7. NO exponer en UI.
8. NO crear candidatos ni batches.

**No ejecutar hasta que se autorice explícitamente el hito Perú.3I.**
