# Catálogo de fuentes de prospección por país y sector

**Versión:** 0.2 — Catálogo consolidado  
**Fecha:** 2026-05-21  
**Estado:** Borrador v0.2 — pendiente validación comercial / legal / técnica  
**Complementa:** [AGENTE_1_GENERACION_ENRIQUECIMIENTO_PROSPECTOS.md](./AGENTE_1_GENERACION_ENRIQUECIMIENTO_PROSPECTOS.md)  
**Autor:** SellUp Product & Research  
**Países cubiertos:** 17 — Colombia, México, Chile, Perú, Ecuador, Argentina, Brasil, Uruguay, Paraguay, Bolivia, Costa Rica, Panamá, Guatemala, El Salvador, Honduras, Nicaragua, República Dominicana

---

## Tabla de contenidos

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Principios de uso](#2-principios-de-uso)
3. [Identificadores fiscales por país](#3-identificadores-fiscales-por-país)
4. [Tipos de fuente](#4-tipos-de-fuente)
5. [Criterios de evaluación](#5-criterios-de-evaluación)
6. [Fuentes globales y regionales](#6-fuentes-globales-y-regionales)
7. [Colombia](#7-colombia)
8. [México](#8-méxico)
9. [Chile](#9-chile)
10. [Perú](#10-perú)
11. [Ecuador](#11-ecuador)
12. [Argentina](#12-argentina)
13. [Brasil](#13-brasil)
14. [Uruguay](#14-uruguay)
15. [Paraguay](#15-paraguay)
16. [Bolivia](#16-bolivia)
17. [Costa Rica](#17-costa-rica)
18. [Panamá](#18-panamá)
19. [Guatemala](#19-guatemala)
20. [El Salvador](#20-el-salvador)
21. [Honduras](#21-honduras)
22. [Nicaragua](#22-nicaragua)
23. [República Dominicana](#23-república-dominicana)
24. [Fuentes sectoriales regionales](#24-fuentes-sectoriales-regionales)
25. [Taxonomía de sectores y keywords](#25-taxonomía-de-sectores-y-keywords)
26. [P0 recomendadas para MVP](#26-p0-recomendadas-para-mvp)
27. [Riesgos legales y técnicos](#27-riesgos-legales-y-técnicos)
28. [Brechas de investigación](#28-brechas-de-investigación)
29. [Recomendación final](#29-recomendación-final)

---

## 1. Resumen ejecutivo

Este catálogo consolida fuentes públicas, oficiales, gremiales, sectoriales y comerciales de 17 países de América Latina para alimentar el **Agente 1 — Generación y enriquecimiento de prospectos** de SellUp.

El ecosistema de datos B2B en LatAm es heterogéneo: los países del Cono Sur (Chile, Uruguay, Argentina) y Brasil muestran la mayor madurez en datos abiertos y APIs gubernamentales. Colombia, México y Perú tienen registros fiscales con capacidad de descarga masiva aunque con restricciones de uso. Centroamérica y el Caribe presentan la menor automatización, con la mayoría de consultas solo disponibles de forma manual vía web.

### Estrategia por capas (orden de operación)

No hay una fuente única. La estrategia correcta es operar en capas:

| Capa | Qué hace | Fuentes típicas |
|---|---|---|
| **1. Discovery** | Encontrar nuevas empresas por país/industria | DENUE, RUES, SUNAT, CNPJ, registros abiertos |
| **2. Normalización / deduplicación** | Identificar si ya existe en SellUp o HubSpot | NIT/RUC/RFC/CNPJ/CUIT como ancla de identidad |
| **3. Validación legal o tributaria** | Confirmar existencia, razón social, estado activo | SUNAT, SII, DGII, Supercias, SEPREC |
| **4. Enriquecimiento básico** | Completar industria, tamaño, estado, ubicación | DENUE (MX), Supercias ranking (EC), PRODUCE (PE) |
| **5. Señales comerciales** | Detectar empresas que ya compran servicios | SECOP II (CO), ChileCompra (CL), SEACE (PE), SERCOP (EC) |
| **6. Fuentes pagadas** | Solo cuando las capas anteriores no alcanzan | Apollo, Lusha, CIAL D&B, Kompass |

La recomendación para MVP es comenzar con las capas 1–5 usando las fuentes P0 disponibles por país, y escalar a Apollo solo cuando las fuentes públicas no alcanzan la cantidad objetivo definida por el usuario.

---

## 2. Principios de uso

Estos principios son obligatorios para cualquier implementación del Agente 1 que use este catálogo:

1. **Fuentes oficiales y abiertas primero.** No gastar créditos Apollo o Lusha si una fuente pública puede resolver el discovery o la validación.
2. **No depender solo de Apollo/Lusha.** Ambos tienen cobertura débil en LatAm comparado con USA/Europa. Tasas de rebote del 25–40% en datos de contacto son esperables.
3. **Usar el identificador fiscal como ancla de identidad.** NIT, RUC, RFC, CNPJ, CUIT o RUT son la clave de deduplicación más confiable de la región. Sin identificador fiscal, la deduplicación es por nombre/dominio y tiene mayor margen de error.
4. **Distinguir empresa de persona natural.** Muchos padrones tributarios incluyen personas naturales con negocio. El agente debe filtrar o marcar estos registros para no generar prospectos individuales como si fueran empresas.
5. **No hacer scraping agresivo.** Solo usar APIs documentadas y datasets oficiales de portales de datos abiertos. No evadir login, paywall o captcha.
6. **No asumir API donde solo hay formulario web.** Muchas fuentes permiten consulta pública individual pero no autorizan automatización masiva.
7. **No usar datos personales sensibles como fuente base.** Los datos de personas jurídicas en registros públicos son de libre acceso en la mayoría de los países. Los datos de personas naturales (contactos, emails directos) requieren base legal.
8. **Medir efectividad de cada fuente.** Registrar: fuente, candidatos generados, candidatos aprobados, costo. El catálogo debe evolucionar basándose en datos reales de ejecución.
9. **Validar términos de uso antes de automatizar.** Antes de integrar cualquier fuente en el agente, verificar ToS, robots.txt si aplica, y límites de uso.
10. **Nunca crear en HubSpot sin revisión humana.** Ningún candidato derivado de estas fuentes se sincroniza con HubSpot de forma automática.

---

## 3. Identificadores fiscales por país

El identificador fiscal es la clave más confiable para deduplicación en LatAm. Dos empresas con el mismo NIT/RUC son la misma entidad jurídica.

| País | Identificador principal | Formato orientativo | Uso en deduplicación | Nota |
|---|---|---|---|---|
| Colombia | **NIT** (Número de Identificación Tributaria) | 9 dígitos + dígito verificador | Clave primaria de deduplicación. Presente en RUES, SECOP, datos.gov.co | Incluye personas naturales con NIT comercial — filtrar |
| México | **RFC** (Registro Federal de Contribuyentes) | 12 caracteres (personas morales) | Alta confiabilidad como ancla | CAPTCHA en SAT limita validación masiva automática |
| Chile | **RUT** (Rol Único Tributario) | Hasta 8 dígitos + dígito verificador | Presente en RES, SII, ChileCompra | También aplica a personas naturales — filtrar por tipo |
| Perú | **RUC** (Registro Único de Contribuyentes) | 11 dígitos | Presente en padrón SUNAT descargable | Condición "habido/no habido" como señal de calidad |
| Ecuador | **RUC** | 13 dígitos | Presente en SCVS y SRI | Empresas: RUC termina en 001 |
| Argentina | **CUIT** (Clave Única de Identificación Tributaria) | 11 dígitos | Presente en ARCA/AFIP y datos.jus.gob.ar | También CDI para personas físicas |
| Brasil | **CNPJ** (Cadastro Nacional da Pessoa Jurídica) | 14 dígitos | Fuente: Receita Federal. Open data de alta calidad | Matrices y filiales tienen CNPJ distintos |
| Uruguay | **RUT** (Registro Único Tributario) | 12 dígitos | DGI Uruguay | Diferente al RUT chileno |
| Paraguay | **RUC** | Variable | SET Paraguay | Sin descarga masiva oficial verificada |
| Bolivia | **NIT** | 9–13 dígitos | SEPREC / SIN Bolivia | Sistema en transición tras reemplazar FUNDEMPRESA |
| Costa Rica | **Cédula jurídica** | 10 dígitos | Registro Nacional | También aplica a sociedades extranjeras |
| Panamá | **RUC** | Variable | DGI / Panama Emprende | PANADATA agrega datos por RUC |
| Guatemala | **NIT** | Variable | SAT Guatemala | NIT puede coincidir entre personas naturales y jurídicas |
| El Salvador | **NIT** | 14 dígitos | Ministerio de Hacienda | También NRC (registro comercial) |
| Honduras | **RTN** (Registro Tributario Nacional) | 14 dígitos | SAR Honduras | Cámara Cortés usa RTN en registro mercantil |
| Nicaragua | **RUC** | Variable | DGI Nicaragua | Cobertura digital muy limitada |
| República Dominicana | **RNC** (Registro Nacional de Contribuyentes) | 9 dígitos (empresas) | DGII — descarga TXT/CSV disponible | DNI o cédula para personas naturales |

> **Regla operativa:** Al normalizar un candidato, siempre intentar extraer el identificador fiscal. Si no está disponible, marcar el campo `missing_fields` con `fiscal_id` y reducir el `confidence_score` del candidato.

---

## 4. Tipos de fuente

| Tipo | Descripción | Ejemplo |
|---|---|---|
| **Discovery** | Encontrar nuevas empresas por país/industria | DENUE (MX), RUES (CO), CNPJ Receita (BR) |
| **Validación legal** | Confirmar existencia, razón social, estado registral | RES (CL), SCVS (EC), Registro Mercantil (GT) |
| **Validación tributaria** | Confirmar NIT/RUC/RFC, actividad, estado activo/inactivo | SUNAT (PE), SII (CL), DGII (DO), SAT (MX) |
| **Duplicidad** | Comparar contra registros existentes | Cualquier fuente con identificador fiscal |
| **Enriquecimiento básico** | Completar industria, tamaño, ubicación, estado | DENUE (22 campos), Supercias ranking (EC), PRODUCE (PE) |
| **Sectorial / gremial** | Afinar por industria o gremio específico | INEXMODA, CANIETI, Superfinanciera CO |
| **Señales comerciales** | Detectar empresas que compran servicios (B2G como proxy) | SECOP II (CO), ChileCompra (CL), SEACE (PE), SERCOP (EC) |
| **Fuente comercial / pagada** | Proveedor externo con cobertura amplia pero costo por uso | Apollo, Lusha, CIAL D&B, Kompass, PANADATA |

---

## 5. Criterios de evaluación

Para cada fuente en el catálogo se usan los siguientes atributos:

| Criterio | Escala / Valores |
|---|---|
| **Tipo de fuente** | Ver §4 |
| **Automatización MVP** | `Alta` — API documentada o descarga masiva libre · `Media` — descarga disponible o API parcial · `Baja` — portal web con limitaciones · `Manual` — solo consulta individual · `No recomendada` — scraping, paywall o ToS restrictivo |
| **Prioridad** | `P0` — usar primero en MVP · `P1` — útil pero validar antes de integrar · `P2` — backlog, evaluación futura |

---

## 6. Fuentes globales y regionales

Fuentes transversales aplicables a múltiples países de la región.

| Fuente | URL | Tipo | Cobertura LatAm | Uso recomendado | Automatización MVP | Costo | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|---|
| **Apollo.io** | [apollo.io](https://www.apollo.io/) | Discovery, Enriquecimiento, Pagada | Global. Cobertura LatAm existe pero débil vs. USA/Europa | Discovery de empresas cuando fuentes públicas no alcanzan. Ya configurado en SellUp | Alta | Planes desde ~$49/mes | Datos desactualizados en LatAm; tasa de rebote 25–40% en emails/teléfonos. Es el eslabón 5 de la cascada del Agente 1 | **P0** (en cascada) |
| **Lusha** | [lusha.com](https://www.lusha.com/) | Enriquecimiento de contactos, Pagada | Global. Cobertura LatAm débil | Solo para enriquecer contactos/personas en candidatos ya aprobados. Nunca como discovery | Baja — uso puntual | $300 USD/mes (anual). 40,800 créditos compartidos, corte noviembre | No validado funcionalmente en SellUp a la fecha. No usar para discovery masivo. Créditos compartidos entre usuarios | **P1** (enriquecimiento posterior) |
| **OpenCorporates** | [opencorporates.com](https://opencorporates.com/) | Validación legal, Duplicidad | 145+ jurisdicciones. Colombia (`/co`), México (`/mx`), Chile (`/cl`) confirmados. Perú y Ecuador parciales | Validación cross-border de existencia legal. Detección de filiales multinacionales | Media — API paga para uso masivo; consulta individual gratuita | Freemium / API paga | Frescura variable en LatAm. No incluye contactos. Útil para validación puntual, no discovery primario | **P1** |
| **CIAL Dun & Bradstreet** | [cialdnb.com](https://www.cialdnb.com/) | Enriquecimiento, Validación, Pagada | Argentina, Brasil, México, Perú + resto LatAm | Enriquecimiento B2B: DUNS number, financieros estimados, jerarquía corporativa, contactos ejecutivos | Alta — API D&B disponible | Pago enterprise (precio por contrato) | Costo elevado; nivel enterprise. Para países con brechas de datos públicos es la alternativa más completa | **P1** |
| **Kompass LatAm** | [us.kompass.com](https://us.kompass.com/) | Discovery, Enriquecimiento, Pagada | 70+ países incluyendo principales LatAm | Búsqueda por sector, tamaño, país; exportación de listas | Media | Pago | Cobertura y actualización variables. Menos preciso que D&B en LatAm | **P2** |
| **IDB FINLAC** | [data.iadb.org](https://data.iadb.org/) | Sectorial, Validación | LatAm regional | 2.000+ instituciones financieras LatAm con variables de performance | Alta — descarga libre | Gratuito | Solo sector financiero regulado | **P1** |
| **Latam Fintech Hub** | [latamfintech.co/directorio](https://www.latamfintech.co/directorio) | Sectorial | Colombia, México, Chile, Perú, Argentina, Brasil | Fintechs LatAm por país, segmento y etapa | Baja / Manual | Gratuito | Cobertura fintech únicamente; actualización variable | **P1** |
| **PANADATA** | [panadata.net](https://www.panadata.net/) | Validación, Duplicidad, Comercial | Colombia, Ecuador, Panamá | Búsqueda de sociedades, directores, sanciones. API REST disponible | Alta — API paga | Pago / plan | Plataforma privada con costo. Útil como agregador para los 3 países cubiertos | **P1** |
| **Open Contracting Partnership** | [open-contracting.org](https://www.open-contracting.org/) | Señales comerciales, Referencia | Regional | Estándar de datos de contratación pública (OCDS). Identificar países con datos estructurados | Media | Gratuito | No es fuente de prospectos por sí sola; es referencia para encontrar portales nacionales | **P1** |
| **ALADI — Pymes Grandes Negocios** | [pymesgrandesnegocios.org](https://pymesgrandesnegocios.org/) | Discovery regional, Sectorial | Regional LatAm | Plataforma de conexión PYME regional, comercio exterior | Media | Gratuito | Confirmar acceso estructurado y calidad de datos antes de integrar | **P2** |
| **LinkedIn Sales Navigator** | [linkedin.com/sales](https://business.linkedin.com/sales-solutions/sales-navigator) | Señales comerciales, Enriquecimiento | Global — buena presencia en CO, MX, CL; menor en PE, EC | Identificar decisores individuales y señales de cambio de cargo. No para generación masiva | Manual — no hay API ni exportación masiva permitida | ~$99–149/mes | ToS prohíbe scraping y exportación masiva. Límite de 2,500 resultados por búsqueda. No integrable automáticamente | **P1** (uso manual del equipo) |
| **FELABAN** | [felaban.com](https://felaban.com/) | Sectorial — Servicios financieros | 19 países LatAm + Caribe | Directorio de bancos y entidades financieras reguladas afiliadas. Fuente de referencia para sector bancario: nombre institución, país, tipo de entidad | Manual | Gratuito — info pública | Solo sector bancario regulado. No incluye fintech ni cooperativas no afiliadas | **P1** |
| **ALAS** — Asociación Latinoamericana de Seguros | [alas-seguros.org](https://alas-seguros.org/) | Sectorial — Seguros | Regional LatAm | Directorio de aseguradoras y reaseguradoras afiliadas. Fuente de referencia para sector asegurador | Manual | Gratuito — info pública | Solo aseguradoras; actualización variable | **P2** |
| **Fintech Iberoamérica** | [fintechiberoamerica.com](https://fintechiberoamerica.com/) | Sectorial — Fintech | España + LatAm (CO, MX, CL, PE, AR, BR) | Directorio de fintechs del ecosistema iberoamericano. Complementa Latam Fintech Hub con presencia española | Manual | Gratuito | Cobertura variable; verificar URL antes de integrar | **P2** |

---

## 7. Colombia

### Lectura general

Colombia tiene uno de los ecosistemas de datos empresariales más desarrollados de LatAm. El RUES (Registro Único Empresarial y Social) centraliza todas las cámaras de comercio del país. La plataforma datos.gov.co ofrece API Socrata documentada para múltiples datasets. SECOP II / Colombia Compra Eficiente es la mejor señal comercial B2G de la región. La principal limitación es que las bases segmentadas por sector/tamaño tienen costo cuando se solicitan a las cámaras. Supersociedades SIIS es gratuita y cubre las empresas más grandes del país con estados financieros históricos.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **RUES** — Registro Único Empresarial y Social | [rues.org.co](https://www.rues.org.co/) | Discovery, Validación legal, Duplicidad | Todos (excluye ESAL y soc. civiles) | Fuente primaria de discovery. Validar NIT, razón social, CIIU, estado, fecha matrícula. Ancla de deduplicación | Media — consulta individual gratuita; descarga masiva condicional; APIs de terceros (Verifik, Apitude) | Sin API oficial pública gratuita. Descarga masiva gratuita requiere matrícula renovada. Bases segmentadas: pago según cámara | **P0** |
| **RUES — Reportes descargables** | [rues.org.co/reportes](https://www.rues.org.co/reportes) | Discovery | Todos | Segmentación inicial por tipo de registro y actividad CIIU | Media | Requiere criterios de filtro; revisar ToS | **P0** |
| **CCB Data Store** — Cámara Bogotá | [datastore.ccb.org.co](https://datastore.ccb.org.co/) | Discovery, Enriquecimiento | Todos | Descarga segmentada por CIIU, ciudad, tamaño, activos. Incluye nombre de decisor. Única fuente con API y datos enriquecidos para Colombia | Alta — API / Web Service disponible | Pago; requiere contrato con CCB. Precio por volumen de registros | **P0** |
| **Supersociedades SIIS** | [siis.ia.supersociedades.gov.co](https://siis.ia.supersociedades.gov.co/) | Discovery, Enriquecimiento | Todos (grandes y medianas empresas vigiladas) | Estados financieros históricos desde 1995. Ranking 1,000 más grandes. Datos IFRS. NIT, CIIU, departamento. Priorizar por tamaño y salud financiera | Alta — descarga libre Excel/CSV con filtros | Solo empresas vigiladas por Supersociedades; no PYMES | **P0** |
| **Datos Abiertos Colombia** | [datos.gov.co — empresas](https://www.datos.gov.co/Estad-sticas-Nacionales/Empresas-registradas/y69t-3r2t) | Discovery, Duplicidad | Todos | Datasets de empresas por CCB regional, CSV/JSON con API Socrata | Alta — API CKAN / Socrata documentada | Actualización irregular por cámara. Calidad heterogénea entre jurisdicciones | **P0** |
| **SECOP II — Proveedores Registrados** | [datos.gov.co — SECOP II](https://www.datos.gov.co/Gastos-Gubernamentales/SECOP-II-Proveedores-Registrados/qmzu-gj57) | Señales comerciales | Tecnología, Salud, Educación, Seguridad/HSE, Servicios, Retail B2G | Señal de intención: empresas que ya venden al Estado. Validación de empresa activa y solvente | Alta — API Socrata + descarga directa | Solo empresas con contratación pública. Sesgo B2G | **P0** |
| **Colombia Compra Eficiente — datos abiertos** | [colombiacompra.gov.co/transparencia/datos-abiertos](https://www.colombiacompra.gov.co/transparencia/datos-abiertos) | Señales comerciales | Todos, especialmente B2G | Contratos, proveedores, categorías, montos | Alta | Requiere limpieza fuerte de nombres y NIT | **P0** |
| **DANE — Directorio Estadístico de Empresas** | [geoportal.dane.gov.co — DEE](https://geoportal.dane.gov.co/geovisores/economia/directorio-estadistico-de-empresas/) | Discovery, Enriquecimiento | Todos — bueno para análisis territorial | Identificar empresas por municipio/sector CIIU. Cruza RUES + RUT + RELAB + encuestas | Media — descarga capas georeferenciadas | Actualización periódica, no diaria. Ideal para análisis territorial | **P1** |
| **Superfinanciera — Entidades Vigiladas** | [superfinanciera.gov.co/entidades](https://www.superfinanciera.gov.co/entidades/) · [dataset](https://www.datos.gov.co/Hacienda-y-Cr-dito-P-blico/Entidades-vigiladas-por-la-Superfinanciera/sr9n-792w) | Validación, Discovery | Servicios financieros | Lista completa de bancos, aseguradoras, AFP, fiduciarias, comisionistas. Fuente de verdad del sector financiero regulado | Alta — API Socrata vía datos.gov.co | No incluye contacto operativo | **P0** (para sector financiero) |
| **MinSalud — REPS** (Registro de Prestadores) | [prestadores.minsalud.gov.co](https://prestadores.minsalud.gov.co/directorio/consultaips.aspx) | Discovery, Enriquecimiento | Salud | Directorio completo de IPS: nombre, dirección, teléfono, email, web, representante legal | Baja — consulta web; descarga masiva requiere solicitud formal | Sin API pública documentada | **P0** (para sector salud) |
| **ANDI — Cámaras sectoriales** | [andi.com.co/Home/Camaras](https://www.andi.com.co/Home/Camaras) | Sectorial | Textil, Automotriz, Salud, Alimentos, Manufactura | Directorio de afiliados por cámara sectorial | Manual | Solo socios ANDI; principalmente grandes empresas | **P1** |
| **Inexmoda — Directorio Proveedores** | [directorio.inexmoda.org.co](https://directorio.inexmoda.org.co/) | Sectorial | Textil / Moda / Manufactura textil | Directorio actualizado de empresas del sector moda Colombia. Público y gratuito | Baja — portal web paginado | No incluye contacto directo. Volumen limitado | **P1** |
| **ProColombia — Directorio Exportadores** | [procolombia.co/colombiatrade/exportador](https://procolombia.co/colombiatrade/exportador) | Sectorial | Textil, manufactura, tecnología | Empresas exportadoras verificadas con sector, contacto, línea de exportación | Baja | Solo exportadores | **P1** |
| **Colombia Fintech** | [colombiafintech.co](https://colombiafintech.co/) | Sectorial | Servicios financieros / Fintech | 365+ miembros del ecosistema fintech colombiano | Manual | Solo fintech | **P1** |
| **FENALCO Antioquia — Directorio** | [directorio.fenalcoantioquia.com](https://directorio.fenalcoantioquia.com/) | Sectorial | Retail, Comercio minorista | Directorio público de empresas comerciales en Antioquia | Baja — web | Cobertura regional (Antioquia) | **P1** |
| **Cámara de Comercio de Bogotá — bases** | [ccb.org.co — bases de datos](https://www.ccb.org.co/servicios/haz-crecer-tu-empresa/incrementa-tus-ventas/bases-de-datos-empresariales) | Discovery, Enriquecimiento | Todos | Bases de datos empresariales descargables por sector | Manual | Pago; condiciones comerciales | **P1** |

**Campos disponibles RUES / CCB:** NIT, razón social, nombre comercial, CIIU, municipio/departamento, tipo societario, tamaño, activos, fecha matrícula, estado, representante legal.

---

## 8. México

### Lectura general

México tiene la mejor fuente pública de prospección de LatAm: el **DENUE (INEGI)**. Con más de 6 millones de establecimientos, API REST gratuita con token, 22 campos por registro (incluyendo teléfono y email del establecimiento), y descarga masiva por estado o nacional, es la primera opción sin discusión. El SAT tiene captcha agresivo — no automatizar. CompraNet e IMSS Datos Abiertos son excelentes señales comerciales.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **DENUE** — Directorio Estadístico Nacional de Unidades Económicas | [inegi.org.mx/app/mapa/denue](https://www.inegi.org.mx/app/mapa/denue/) | Discovery, Enriquecimiento | Todos — 6M+ establecimientos | Primera opción para México. Filtrar por municipio, actividad SCIAN, nombre, tamaño | Alta | Datos de establecimiento, no de persona decisora. Actualización periódica (Censos 2024). Teléfonos/emails pueden estar desactualizados | **P0** |
| **API DENUE** | [inegi.org.mx/servicios/api\_denue.html](https://www.inegi.org.mx/servicios/api_denue.html) | Discovery, Enriquecimiento | Todos | API REST gratuita con token. 22 campos. Descarga masiva CSV/SHP | Alta — token gratuito con registro en INEGI | Límites de rate a confirmar | **P0** |
| **SIEM** — Sistema de Información Empresarial Mexicano | [siem.economia.gob.mx](https://siem.economia.gob.mx/) · [dataset](https://www.datos.gob.mx/dataset/sistema_informacion_empresarial_mexicano) | Discovery | Comercio, Manufactura, Servicios, Turismo | Empresas registradas en cámaras (CANACO, CANACINTRA). Dataset descargable en datos.gob.mx | Media — portal web + dataset público | Actualización depende de renovación en cámaras. Menos robusto que DENUE | **P0** |
| **SAT — Validador RFC** | [agsc.siat.sat.gob.mx](https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf) | Validación tributaria | Todos | Validación puntual de RFC, razón social, régimen | Manual — captcha | No automatizar scraping masivo | **P1** |
| **CompraNet** — contratos históricos | [datos.gob.mx — CompraNet histórico](https://www.datos.gob.mx/dataset/contratos_expedientes_sistema_historico_compranet) · [compranet.hacienda.gob.mx](https://compranet.hacienda.gob.mx/) | Señales comerciales | Tecnología, Salud, Educación, Seguridad | Proveedores del gobierno federal con historial de contratos | Media — dataset histórico 2010–2022 en datos.gob.mx | Dataset histórico; no en tiempo real. Para contratos activos usar portal principal | **P1** |
| **IMSS — Padrón de Patrones** | [datos.imss.gob.mx](http://datos.imss.gob.mx/) | Señales comerciales, Validación | Todos | Empleadores formales: razón social, sector SCIAN, número de asegurados. Señal de empresa activa con empleados | Alta — descarga masiva CSV mensual | No incluye contacto. Solo empleadores formales IMSS | **P1** |
| **REPSE** — Registro de Empresas Especializadas | [repse.stps.gob.mx](https://repse.stps.gob.mx/) | Discovery, Señales comerciales | Outsourcing, Servicios especializados, Seguridad | Empresas prestadoras de servicios especializados (outsourcing). RFC, actividad, estado | Alta — consulta pública con exportación parcial | Gratuito | **P1** |
| **CANACINTRA — Directorio Industrial** | [canacintra.net/directorio.php](https://www.canacintra.net/directorio.php) | Sectorial | Manufactura, Textil, Automotriz | Directorio de afiliados de la cámara industrial más grande de México | Baja — web paginado | Solo afiliados; cobertura parcial | **P1** |
| **AMIA** | [amia.com.mx](https://amia.com.mx/) | Sectorial | Automotriz | OEMs y ensambladores afiliados. Estadísticas mensuales de ventas | Manual | Solo terminales / armadoras. No cubre toda la cadena de autopartes | **P1** |
| **CANAIVE** — delegaciones | [canaive.mx](https://canaive.mx/) | Sectorial | Textil, Vestido, Moda | Cámara Nacional de la Industria del Vestido. Directorios por delegación estatal | Baja — por delegación, no consolidado nacional | Directorios no unificados | **P1** |
| **CANIETI** | [canieti.org/nuestros-afiliados](https://canieti.org/nuestros-afiliados) | Sectorial | Tecnología / TIC | 1,000+ empresas afiliadas. Directorio público con nombre de empresa | Baja — web | No incluye contacto directo | **P1** |
| **ANTAD** | [antad.net/asociados](https://antad.net/asociados/) | Sectorial | Retail, Autoservicio | Cadenas de supermercados, tiendas departamentales y clubes de precio | Manual | Lista de asociados; no directorio de contactos | **P1** |

**Campos disponibles DENUE:** Código CLEE, ID establecimiento, nombre, razón social, SCIAN, estrato de empleo, dirección completa (calle, número, colonia, CP), teléfono, email, web, coordenadas geográficas.

---

## 9. Chile

### Lectura general

Chile tiene un ecosistema de datos públicos maduro. El Registro de Empresas y Sociedades (RES) en datos.gob.cl ofrece descarga CSV gratuita de alta calidad. ChileCompra es la mejor señal comercial B2G de la región junto con SECOP II. El SII tiene captcha agresivo — la ruta práctica para validación masiva es mediante APIs de terceros de pago (ej. BaseAPI.cl). SENCE-OTEC es la mejor fuente para el sector de formación corporativa en LatAm.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **RES** — Registro de Empresas y Sociedades | [datos.gob.cl — RES](https://datos.gob.cl/dataset/registro-de-empresas-y-sociedades) · [sre.cl](https://sre.cl/) | Discovery, Validación legal | Todos | Descarga CSV gratuita: RUT, razón social, giro, región, fecha constitución, tipo. Base de deduplicación | Alta — descarga libre CSV/JSON/TSV/XML | Solo régimen simplificado (Ley 20.659). Sin datos de contacto | **P0** |
| **SII** — Estadísticas y Nómina | [sii.cl — estadísticas](https://www.sii.cl/sobre_el_sii/estadisticas_de_empresas.html) · [nómina jurídicas](https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html) | Validación tributaria, Discovery | Todos — por actividad económica | Contribuyentes activos por giro tributario, RUT, domicilio. Nómina pública descargable | Media — nómina descargable; consulta individual tiene captcha | Sin API oficial gratuita masiva; APIs de terceros (BaseAPI.cl) de pago | **P0** |
| **ChileCompra** — datos abiertos | [datos-abiertos.chilecompra.cl](https://datos-abiertos.chilecompra.cl/) · [mercadopublico.cl](https://www.mercadopublico.cl/) | Señales comerciales | Seguridad/HSE, Salud, Tecnología, Educación, Servicios | Proveedores del Estado con historial de contratos y rubros | Alta — API pública y datos abiertos | Sesgo B2G. Normalizar RUT y nombres | **P0** |
| **SOFOFA** — Gremios asociados | [sofofa.cl/membresia/gremios-asociados](https://sofofa.cl/membresia/gremios-asociados/) | Sectorial | Manufactura, Textil, Retail, Tecnología | 42 gremios sectoriales y 7,000+ empresas asociadas | Manual — directorio web por gremio | Sin descarga masiva directa | **P1** |
| **SENCE** — Registro OTEC | [sence.gob.cl/organismos/otec](https://sence.gob.cl/organismos/otec) | Discovery, Sectorial | Educación / Formación corporativa | Lista completa de OTEC registrados (organismos de capacitación): nombre, RUT, región | Alta — exportación CSV disponible | Solo sector formación laboral | **P0** (sector educación/formación) |
| **ANAC** | [anac.cl](https://www.anac.cl/) | Sectorial | Automotriz | 38 empresas representadas (60 marcas ligeras, 24 camiones, 16 buses) | Manual | Directorio completo requiere contacto | **P1** |
| **ACTI** | [acti.cl](https://acti.cl/) | Sectorial | Tecnología | Asociación Chilena de Empresas de TI. Directorio de miembros | Baja — requiere registro | Registro gratuito para acceder al directorio | **P1** |
| **AACH** | [portal.aach.cl](https://portal.aach.cl/) | Sectorial, Validación | Servicios financieros — seguros | Lista de aseguradoras reguladas en Chile | Baja | Lista institucional | **P1** |
| **CCS** — Cámara de Comercio de Santiago | [ccs.cl](https://www.ccs.cl/) | Sectorial | Retail, Comercio, Servicios | Directorio de socios con registro | Baja — requiere registro | Cobertura de socios, no exhaustiva | **P1** |

---

## 10. Perú

### Lectura general

El **Padrón RUC de SUNAT** es la mejor fuente pública de Perú: descarga ZIP diaria gratuita con todos los contribuyentes activos, condición "habido/no habido" como señal de calidad, clasificación CIIU. PRODUCE tiene un directorio open data de grandes empresas manufactureras ya segmentado. OSCE/SEACE es la señal B2G más completa. Limitación principal: ninguna fuente incluye teléfono ni email directo.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **SUNAT — Padrón RUC** (descarga masiva) | [sunat.gob.pe — padrón](https://www.sunat.gob.pe/descargaPRR/mrc137_padron_reducido.html) · [datosabiertos.gob.pe](https://www.datosabiertos.gob.pe/dataset/padr%C3%B3n-ruc-superintendencia-nacional-de-aduanas-y-de-administraci%C3%B3n-tributaria-sunat) | Discovery, Validación tributaria, Duplicidad | Todos | ZIP periódico: RUC, razón social, estado, condición habido/no habido, ubigeo, CIIU. Actualización diaria 23:00 | Alta — ZIP gratuito; proyectos open source en GitHub automatizan el proceso | Sin contacto (teléfono/email). El padrón "reducido" omite algunos campos del completo | **P0** |
| **SUNAT — Consulta RUC individual** | [e-consultaruc.sunat.gob.pe](https://e-consultaruc.sunat.gob.pe/) | Validación tributaria | Todos | Validar RUC puntual, razón social, estado | Manual — posible captcha | No automatizar scraping | **P0** |
| **PRODUCE — Directorio Manufactura** | [datosabiertos.gob.pe — manufactura](https://www.datosabiertos.gob.pe/dataset/directorio-de-grandes-empresas-del-sector-manufactura) | Discovery, Enriquecimiento | Manufactura | Grandes empresas manufactureras: RUC, ubigeo, CIIU. Ya segmentado | Alta — descarga CSV directa | Solo grandes empresas manufactura | **P0** (sector manufactura) |
| **OSCE / SEACE — Portal Datos Abiertos** | [gob.pe — OECE datos abiertos](https://www.gob.pe/14272-acceder-al-portal-de-datos-abiertos-del-oece) · [apps.osce.gob.pe](https://apps.osce.gob.pe/) | Señales comerciales | Todos | Proveedores del Estado: historial de contratos, monto, sector, RUC | Alta — portal de consultas y datos abiertos | Sesgo B2G; normalizar RUC | **P0** |
| **SUNARP — Personas Jurídicas** | [sunarp.gob.pe — búsqueda](https://www.sunarp.gob.pe/bus-personas-juridicas.asp) | Validación legal | Todos | Sociedades inscritas: nombre, RUC, representante legal, vigencia | Baja — consulta individual | Sin descarga masiva documentada | **P1** |
| **Perú Compras — Acuerdos Marco** | [catalogos.perucompras.gob.pe](https://www.catalogos.perucompras.gob.pe/) | Señales comerciales | Tecnología, Salud, Seguridad, Educación, Retail institucional | Proveedores en catálogos de compras consolidadas | Baja — acceso público limitado | Requiere acceso para algunas funciones | **P1** |
| **SNI** — Sociedad Nacional de Industrias | [sni.org.pe](https://www.sni.org.pe/) | Sectorial | Manufactura, Textil, Alimentos, Química | Comités sectoriales: alimentos, química, telecomunicaciones, metal, plásticos, textil y calzado | Manual | Afiliados; no directorio completo público | **P1** |
| **ADEX** | [adexperu.org.pe](https://www.adexperu.org.pe/) | Sectorial | Comercio exterior, Manufactura, Agroindustria | Exportadores peruanos verificados | Manual | Solo exportadores | **P1** |
| **APESOFT** | [apesoft.org](https://www.apesoft.org/) | Sectorial | Tecnología / Software | 60+ empresas de software afiliadas | Manual — vía contacto | Directorio no en línea abierto | **P1** |
| **CCL Negocios** | [cclnegocios.pe](https://cclnegocios.pe/) | Discovery, Sectorial | Todos | 10,000+ empresas asociadas. Directorio de la Cámara de Comercio de Lima | Baja — requiere afiliación | Directorio no es público gratuito | **P1** |

---

## 11. Ecuador

### Lectura general

La **Superintendencia de Compañías (SCVS)** es la fuente principal de Ecuador. Ofrece descarga CSV/ODS en el portal de datos abiertos del gobierno. El **INEC REEM** (Directorio Estadístico de Empresas) es la fuente estadística más completa para segmentación sectorial y de tamaño. **SERCOP** es el portal de compras públicas con API OCDS documentada. Limitación: ninguna fuente oficial incluye email ni teléfono directos.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **SCVS** — Superintendencia de Compañías | [appscvsgen.supercias.gob.ec — consulta](https://appscvsgen.supercias.gob.ec/consultaCompanias/societario/busquedaCompanias.jsf) · [dataset](https://datosabiertos.gob.ec/dataset/directorio-de-companias) · [ranking](https://appscvsmovil.supercias.gob.ec/ranking/reporte.html) | Discovery, Validación legal, Duplicidad | Todos | Directorio completo: RUC, razón social, estado, objeto social, provincia. Dataset descargable en CSV/ODS. Ranking con datos adicionales | Media-Alta — dataset descargable; consulta web individual para validación | Sin datos de contacto ni tamaño en dataset básico. Actualización puede no ser en tiempo real | **P0** |
| **SRI** — Consulta RUC en línea | [srienlinea.sri.gob.ec — consulta](https://srienlinea.sri.gob.ec/sri-en-linea/consulta/27) | Validación tributaria | Todos | Validar RUC, razón social, actividad, domicilio, estado tributario | Manual — captcha | Solo validación individual | **P0** |
| **INEC REEM** — Directorio de Empresas | [ecuadorencifras.gob.ec — directorio](https://www.ecuadorencifras.gob.ec/directoriodeempresas/) | Discovery, Enriquecimiento | Todos | Estadísticas por CIIU, tamaño, provincia, ingresos. Actualización semestral 2024 disponible. Microdatos via ANDA | Alta — datos descargables desde ANDA | Microdatos nominativos bajo solicitud formal. Datos estadísticos, no directorio empresa-a-empresa directamente | **P1** |
| **SERCOP** — Contrataciones Abiertas Ecuador | [datosabiertos.compraspublicas.gob.ec](https://datosabiertos.compraspublicas.gob.ec/) | Señales comerciales | Seguridad/HSE, Salud, Tecnología, Educación, Servicios | API OCDS + datos abiertos: proveedores, contratos, montos, rubros | Alta — API documentada OCDS | Sesgo B2G; normalizar RUC | **P0** |
| **Cámara de Industrias y Producción** | [cip.org.ec](https://cip.org.ec/) | Sectorial | Manufactura, Industria, Seguridad industrial | Discovery sectorial del sector productivo | Manual | Directorio de afiliados | **P1** |
| **CCQ** — Cámara de Comercio de Quito | [ccq.ec](https://ccq.ec/) | Discovery, Sectorial | Todos | 3,000+ empresas. Directorio con afiliación | Baja — afiliación | Acceso restringido a afiliados | **P1** |
| **AESOFT** | [aesoft.com.ec](https://aesoft.com.ec/) | Sectorial | Tecnología / Software | Empresas de software ecuatorianas asociadas | Manual | Solo tecnología; afiliados | **P2** |

---

## 12. Argentina

### Lectura general

Argentina tiene el **Registro Nacional de Sociedades** disponible como dataset mensual gratuito en datos.jus.gob.ar (ZIP con CUIT, razón social, domicilio). La IGJ cubre específicamente CABA. AFIP/ARCA tiene captcha en consultas individuales. CESSI es la mejor fuente sectorial para tecnología con 1,800+ empresas. Limitación: datos de contacto (email, teléfono) no disponibles en fuentes públicas.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **Registro Nacional de Sociedades** | [datos.jus.gob.ar — RNS](https://datos.jus.gob.ar/dataset/registro-nacional-de-sociedades) | Discovery, Validación legal | Todos | Descarga mensual: CUIT, razón social, fecha constitución, domicilio fiscal. Actualización el 15 de cada mes | Alta — descarga ZIP mensual libre | No incluye contacto. Solo sociedades inscriptas | **P0** |
| **ARCA / AFIP** — Constancia de Inscripción | [seti.afip.gob.ar — constancia](https://seti.afip.gob.ar/padron-puc-constancia-internet/ConsultaConstanciaAction.do) | Validación tributaria | Todos | Validación puntual de CUIT, razón social, domicilio, actividad, régimen | Manual — captcha en consulta individual | Sin descarga masiva directa | **P0** |
| **IGJ** — Entidades constituidas (CABA) | [datos.jus.gob.ar — IGJ](https://datos.jus.gob.ar/dataset/entidades-constituidas-en-la-inspeccion-general-de-justicia-igj) | Discovery, Validación | Todos (jurisdicción CABA) | Dataset open data de sociedades constituidas ante IGJ | Alta — descarga libre | Cobertura limitada a CABA (Inspección General de Justicia) | **P1** |
| **datos.gob.ar** | [datos.gob.ar](https://datos.gob.ar/) | Discovery, Señales comerciales | Todos según dataset | Portal nacional de datos abiertos. Datasets complementarios por sector | Media | Requiere curaduría; calidad variable | **P1** |
| **CESSI** | [cessi.org.ar](https://cessi.org.ar/) | Sectorial | Tecnología | 1,800+ empresas de software representadas | Manual | Solo sector software/TI | **P1** |
| **UIA** — Unión Industrial Argentina | [uia.org.ar](https://www.uia.org.ar/) | Sectorial | Manufactura / Industria | Gremio industrial nacional. Cámaras sectoriales | Manual | Solo afiliados | **P1** |
| **ADEFA** — Fabricantes automotrices | [adefa.com.ar](https://adefa.com.ar/) | Sectorial | Automotriz | Fabricantes de vehículos en Argentina | Manual | Solo terminales | **P1** |

---

## 13. Brasil

### Lectura general

Brasil tiene la mejor fuente de datos empresariales de LatAm: **Receita Federal CNPJ Dados Abertos**. Descarga masiva mensual gratuita con razón social, CNAE (equivalente a CIIU), municipio, CEP, situación, fecha de apertura y socios. **OpenCNPJ (cnpj.ws)** es la API de tercero más usada — gratuita, sin autenticación, 50 req/seg. La complejidad técnica es alta (archivos de GBs comprimidos, requiere ETL). La ley LGPD es la más estricta de la región para datos personales.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **Receita Federal — CNPJ Dados Abertos** | [dados.gov.br — CNPJ](https://dados.gov.br/dados/conjuntos-dados/cadastro-nacional-da-pessoa-juridica---cnpj) · [receitafederal PT](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/dados-abertos) | Discovery, Validación tributaria, Duplicidad | Todos | Descarga completa mensual: CNPJ, razón social, CNAE, municipio, CEP, situación, fecha apertura, socios | Alta — descarga ZIP mensual libre | Archivos de varios GBs comprimidos; requiere pipeline de limpieza y ETL. Sin email/teléfono | **P0** |
| **OpenCNPJ / cnpj.ws** | [cnpj.ws](https://www.cnpj.ws/pt-BR) | Discovery, Enriquecimiento | Todos | API REST gratuita. Sin autenticación. 50 req/seg por IP. CNPJ → razón social, CNAE, municipio, socios | Alta — sin auth, 50 req/seg | Tercero sin SLA formal. Misma limitación de datos que Receita Federal (sin email/tel) | **P0** |
| **Base dos Dados — RAIS** | [basedosdados.org — RAIS](https://basedosdados.org/dataset/3e7c4d58-96ba-448e-b053-d385a829ef00) | Señales comerciales, Enriquecimiento | Todos | Empleadores formales por CNAE, estado, tamaño vía BigQuery público | Alta — BigQuery público | Solo establecimientos con empleados formales. Requiere cuenta Google | **P1** |
| **dados.gov.br** | [dados.gov.br](https://dados.gov.br/) | Discovery, Señales | Todos según dataset | Portal nacional de datos abiertos. Datasets complementarios por sector | Media | Calidad variable; algunas descargas requieren login gov.br | **P1** |
| **FIESP / CNI** | [fiesp.com.br](https://www.fiesp.com.br/) · [cni.com.br](https://www.cni.com.br/) | Sectorial | Manufactura / Industria | Gremios industriales. Publicaciones sectoriales | Manual | Solo afiliados; no directorio masivo público | **P1** |

---

## 14. Uruguay

### Lectura general

Uruguay tiene un ecosistema de datos relativamente maduro para su tamaño. El **DEI-MIEM** (Directorio de Empresas Industriales) es la fuente más estructurada con descarga directa en múltiples formatos. La DGI es la autoridad tributaria con validación de RUT. Uruguay XXI es útil para empresas con proyección internacional. Cobertura general menor que los países grandes de la región.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **DEI — MIEM** (Directorio Empresas Industriales) | [catalogodatos.gub.uy — DEI](https://catalogodatos.gub.uy/dataset/miem-dei) | Discovery, Enriquecimiento | Manufactura, Textil, Tecnología industrial, Alimentaria | Empresas industriales inscritas: nombre, RUT, actividad, localización. CSV/XLSX/JSON/XML | Alta — descarga directa multi-formato | Solo inscripciones voluntarias; cobertura parcial. Foco industrial | **P0** |
| **DGI** — Dirección General Impositiva | [gub.uy/dgi](https://www.gub.uy/direccion-general-impositiva/) · [certificado único](https://servicios.dgi.gub.uy/serviciosenlinea/dgi--servicios-en-linea--consulta-de-certifcado-unico) | Validación tributaria | Todos | Validación tributaria puntual. Certificado único de regularidad fiscal | Manual | Consulta individual; no discovery masivo | **P1** |
| **Uruguay XXI** | [uruguayxxi.gub.uy](https://www.uruguayxxi.gub.uy/) | Señales comerciales, Sectorial | Todos — foco en empresas con inversión extranjera | Empresas con proyección internacional; información sectorial de contacto | Manual | Solo empresas con presencia internacional | **P1** |
| **Cámara de Industrias del Uruguay** | [ciu.com.uy](https://www.ciu.com.uy/) | Sectorial | Manufactura / Industria | Gremio industrial. Socios y publicaciones sectoriales | Manual | Afiliados | **P1** |
| **ARCE / RUPE** — Registro Único de Proveedores del Estado | [comprasestatales.gub.uy](https://www.comprasestatales.gub.uy/) | Señales comerciales | Todos | Proveedores habilitados para contratar con el Estado | Media | Confirmar descarga estructurada | **P1** |

---

## 15. Paraguay

### Lectura general

Paraguay tiene cobertura de datos pública limitada. El **SET Paraguay (DNIT)** permite validación individual de RUC pero no descarga masiva documentada. La **DNCP** (Contrataciones Públicas) es la mejor señal comercial B2G con datos abiertos disponibles. DIRGE/INE tiene directorio empresarial pero acceso a microdatos puede requerir solicitud formal. Tratar como país P1 en primera versión del agente.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **SET / DNIT — Perfil contribuyente** | [servicios.set.gov.py — perfil público](https://servicios.set.gov.py/eset-publico/perfilPublicoContribIService.do) · [DNIT sin clave](https://www.dnit.gov.py/web/portal-institucional/servicios-online-sin-clave-de-acceso) | Validación tributaria | Todos | Validar RUC, razón social, tipo contribuyente, domicilio, actividad | Manual — web individual | Sin API; sin descarga masiva confirmada | **P0** |
| **DNCP** — Contrataciones Públicas | [contrataciones.gov.py/datos/def/Proveedor](https://www.contrataciones.gov.py/datos/def/Proveedor) | Señales comerciales | Todos | Proveedores del Estado: historial, monto, sector | Alta — datos abiertos disponibles | Solo B2G | **P1** |
| **DIRGE — INE Paraguay** | [ine.gov.py/dirge](https://www.ine.gov.py/dirge/) | Discovery, Enriquecimiento | Todos | Directorio de empresas industriales/comerciales/servicios: RUC, actividad, tamaño | Media — datos vía ANDA del INE | Acceso a microdatos nominativos puede requerir solicitud formal | **P1** |
| **Unión Industrial Paraguaya** | [uip.org.py](https://www.uip.org.py/) | Sectorial | Manufactura / Industria | Gremio industrial. Socios sectoriales | Manual | Afiliados | **P1** |
| **DNIT — Documentación API (web service)** | [documentación técnica DNIT](https://www.dnit.gov.py/documents/20123/209165/ESP_MAR_CP_SERVICIO_WEB_CONSULTA_PUBLICA.pdf) | Validación tributaria (API) | Todos | Evaluar integraciones autorizadas con DNIT | Media — requiere API key / registro | No asumir acceso abierto | **P1** |

---

## 16. Bolivia

### Lectura general

Bolivia está en transición. El **SEPREC** reemplazó a FUNDEMPRESA en 2022 como registro de comercio. La digitalización está en curso y no se ha confirmado API pública ni descarga masiva estructurada. El **SIN (NIT)** es el identificador fiscal principal. Para MVP, tratar Bolivia como país P1 con validación manual o vía Apollo.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **SEPREC** — Registro de Comercio | [miempresa.seprec.gob.bo](https://miempresa.seprec.gob.bo/) · [seprec.gob.bo](https://www.seprec.gob.bo/) | Validación legal, Discovery | Todos | Matrícula comercial, habilitación, búsqueda de empresas inscritas y renovadas | Manual-Media — portal web; digitalización en curso | Sistema reciente; sin API ni descarga masiva verificada | **P0** |
| **SIN** — Servicio de Impuestos Nacionales | [impuestos.gob.bo](https://www.impuestos.gob.bo/) | Validación tributaria | Todos | Validar NIT, razón social, estado tributario | Manual | Consulta individual | **P1** |
| **SIIP PRODUCE** — Base Empresarial | [siip.produccion.gob.bo](https://siip.produccion.gob.bo/repSIIP2/formSeprec.php) | Discovery, Enriquecimiento | Manufactura, Comercio | Historial del Registro de Comercio con filtros | Media — portal de consulta web | Actualización irregular | **P1** |
| **SICOES** — Sistema de Contrataciones | [sicoes.gob.bo](https://www.sicoes.gob.bo/) | Señales comerciales | Todos | Proveedores del Estado boliviano | Media | Confirmar estructura de datos abiertos | **P1** |
| **Cámara Nacional de Industrias** | [cni.bo](https://www.cni.bo/) | Sectorial | Manufactura / Industria | Gremio industrial. Socios y sectores | Manual | Afiliados | **P1** |
| **Cámara Nacional de Comercio** | [cnc.bo](https://www.cnc.bo/) | Sectorial | Retail / Comercio | Gremio comercial. Socios y directorios | Manual | Afiliados | **P1** |

---

## 17. Costa Rica

### Lectura general

Costa Rica tiene el **Registro Nacional** como fuente de validación societaria. El **INEC DEE** (Directorio de Empresas y Establecimientos) es la fuente estadística más completa. **SICOP** es el portal de compras públicas. PROCOMER cubre empresas exportadoras. La automatización es limitada en general — tratar como P1 para MVP.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **Registro Nacional** — Personas Jurídicas | [rnpdigital.com — personas jurídicas](https://www.rnpdigital.com/personas_juridicas/) | Validación legal | Todos | Validar cédula jurídica, representante legal, estado | Manual — portal de consultas | Sin API pública gratuita documentada | **P0** |
| **INEC — DEE** (Directorio de Empresas y Establecimientos) | [sistemas.inec.cr — DEE](https://sistemas.inec.cr/pad5/index.php/catalog/366) | Discovery, Enriquecimiento | Todos | Directorio 2024: actividad CIIU, tamaño, ubicación | Media — metadatos en INEC; microdatos bajo solicitud | Acceso a datos nominativos limitado | **P0** |
| **SICOP** — Sistema de Compras Públicas | [sicop.go.cr](https://www.sicop.go.cr/) | Señales comerciales | Tecnología, Salud, Educación, Seguridad | Proveedores del Estado con historial de contratos | Media | Confirmar estructura de datos abiertos | **P1** |
| **MEIC — Sistema SIEC / Directorio PYMES** | [pymes.cr/siec](https://pymes.cr/siec/) | Discovery | Manufactura, Comercio, Servicios | Directorio de PYMES costarricenses | Media | Actualización variable | **P1** |
| **PROCOMER** | [procomer.com](https://www.procomer.com/) · [datos abiertos](https://www.comex.go.cr/transparencia/datos-abiertos/) | Señales comerciales, Sectorial | Exportadores, Retail, Manufactura | Empresas exportadoras con actividad internacional verificada | Manual-Media | Solo exportadores | **P1** |
| **Cámara de Industrias de Costa Rica** | [cicr.com](https://www.cicr.com/) | Sectorial | Manufactura / Industria | Gremio industrial. Socios y sectores | Manual | Afiliados | **P1** |

---

## 18. Panamá

### Lectura general

Panamá tiene una particularidad importante: **PANADATA** es el agregador privado más completo con API REST para registros públicos de Panamá (y también Colombia y Ecuador). El **Registro Público** y **Panama Emprende** son las fuentes oficiales. Para MVP, PANADATA puede ser la ruta más práctica aunque es paga. La DGI (RUC) permite validación fiscal individual.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **Panama Emprende** — Avisos de Operación | [panamaemprende.gob.pa — consulta pública](https://www.panamaemprende.gob.pa/consulta-publica-new) | Discovery, Validación legal | Retail, Servicios, Salud, Educación, Manufactura | Registro de avisos de operación / licencias comerciales activas | Media — revisar si permite descarga | Confirmar estructura y acceso | **P0** |
| **Registro Público** — Panamá Digital | [panamadigital.gob.pa — servicios registrales](https://www.panamadigital.gob.pa/OnlineServices?page=7) | Validación legal | Todos | Validar sociedades y datos registrales | Manual | Puede requerir flujo de consulta o validaciones | **P0** |
| **DGI** — Registro Único de Contribuyentes | [dgi.mef.gob.pa/Ruc/Ruc](https://dgi.mef.gob.pa/Ruc/Ruc) | Validación tributaria | Todos | Validación fiscal puntual por RUC | Manual | Solo validación individual | **P1** |
| **PanamáCompra** | [panamacompra.gob.pa](https://www.panamacompra.gob.pa/) | Señales comerciales | Tecnología, Salud, Educación, Seguridad | Proveedores activos del Estado panameño | Media | Confirmar estructura de datos abiertos | **P1** |
| **PANADATA** | [panadata.net/es/organizaciones](https://www.panadata.net/es/organizaciones) | Validación, Enriquecimiento, Comercial | Todos | API REST para búsqueda de sociedades, directores, sanciones. Cubre CO, EC y PA | Alta — API paga | Plataforma privada con costo. Evaluar relación costo/beneficio | **P1** |
| **Cámara de Comercio, Industrias y Agricultura** | [panacamara.com](https://www.panacamara.com/) | Sectorial | Retail, Industria, Servicios | Gremio principal empresarial de Panamá. Directorios de socios | Manual | Afiliados | **P1** |

---

## 19. Guatemala

### Lectura general

El **Registro Mercantil General** es la fuente principal para validación societaria. Tiene portal de consultas (e-Consultas) pero sin API pública documentada. SAT/NIT permite validación tributaria individual. **Guatecompras** es el portal de compras públicas con datos OCDS. Para MVP, Guatemala funciona principalmente como destino de validación manual o Apollo.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **Registro Mercantil General** | [registromercantil.gob.gt](https://www.registromercantil.gob.gt/) · [eportal](https://eportal.registromercantil.gob.gt/) | Validación legal | Todos | Buscar y validar sociedades mercantiles: representante legal, capital, estado | Manual — e-Consultas web | Sin API; sin descarga masiva. Mantenimiento frecuente del portal | **P0** |
| **SAT Guatemala** — NIT | [portal.sat.gob.gt](https://portal.sat.gob.gt/) | Validación tributaria | Todos | Validar NIT, razón social, actividad económica | Manual — web | Solo validación individual | **P1** |
| **Guatecompras** (OCDS) | [guatecompras.gt](https://www.guatecompras.gt/) | Señales comerciales | Tecnología, Salud, Educación, Seguridad | Proveedores del Estado. Datos parcialmente estructurados | Media | Confirmar descarga o API | **P1** |
| **SEGEPLAN** — Portal de Proyectos | [segeplan.gob.gt](https://www.segeplan.gob.gt/) | Señales comerciales | Construcción, Infraestructura, Tecnología, Servicios | Proyectos y proveedores del Estado guatemalteco. Complementa Guatecompras con contexto de planificación nacional | Media | Confirmar estructura de datos abiertos antes de integrar | **P2** |
| **AGEXPORT** | [agexport.org.gt](https://agexport.org.gt/) | Sectorial | Exportadores, Manufactura, Agroindustria | Discovery de exportadores guatemaltecos | Manual | Solo exportadores / afiliados | **P1** |
| **Cámara de Industria de Guatemala** | [industriaguatemala.org](https://www.industriaguatemala.org/) | Sectorial | Manufactura / Industria | Gremio industrial. Publicaciones y socios | Manual | Afiliados | **P1** |

---

## 20. El Salvador

### Lectura general

El **CNR** (Centro Nacional de Registros) es la fuente principal para validación. El portal **eCNR** permite consultas en línea pero sin API ni exportación masiva. Para discovery estructurado no se encontró una fuente pública robusta. **Comprasal** es el portal de compras públicas. El Salvador requiere investigación adicional antes de incluirlo en automatización. Para MVP: validación manual o Apollo.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **CNR** — Centro Nacional de Registros | [cnr.gob.sv](https://www.cnr.gob.sv/) | Validación legal | Todos | Registro de comercio: sociedades, representantes legales. Portal eCNR disponible | Manual — portal eCNR | Sin API ni descarga masiva documentada | **P0** |
| **MH** — Ministerio de Hacienda / NIT | [portaldgii.mh.gob.sv — NIT](https://portaldgii.mh.gob.sv/ssc/serviciosinclave/consulta/duinit/) | Validación tributaria | Todos | Validación puntual de NIT | Manual — posible captcha | Solo validación individual; no discovery | **P1** |
| **Comprasal** | [comprasal.gob.sv](https://www.comprasal.gob.sv/) | Señales comerciales | Tecnología, Salud, Educación, Seguridad | Proveedores del Estado salvadoreño | Media | Confirmar estructura de datos abiertos | **P1** |
| **Cámara de Comercio e Industria** | [camarasal.com](https://camarasal.com/) | Sectorial | Comercio, Industria, Retail | Directorio gremial | Manual | Afiliados | **P1** |
| **ASI El Salvador** | [industriaelsalvador.com](https://www.industriaelsalvador.com/) | Sectorial | Manufactura / Industria | Asociación Salvadoreña Industrial. Publicaciones sectoriales | Manual | Afiliados | **P1** |

> **Brecha:** El Salvador no tiene una fuente pública estructurada y descargable de empresas comparable a los países grandes de la región. No incluir en automatización MVP.

---

## 21. Honduras

### Lectura general

Honduras tiene el registro mercantil descentralizado en cámaras de comercio regionales. **Empresas Abiertas** agrega datos de múltiples cámaras pero sin API verificada. La CCIC (Cortés/San Pedro Sula) y la CCIT (Tegucigalpa) son las cámaras con mayor cobertura. El SAR/RTN permite validación tributaria individual. Para MVP: validación manual o Apollo.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **Empresas Abiertas Honduras** | [empresasabiertas.com](https://empresasabiertas.com/) | Discovery, Validación legal | Todos | Búsqueda centralizada de sociedades de múltiples cámaras hondureñas | Media — web con búsqueda | Sin API documentada. Plataforma privada. Cobertura limitada a cámaras participantes | **P0** |
| **Mi Empresa en Línea** — COHDEFOR/CCICH | [miempresaenlinea.hn](https://www.miempresaenlinea.hn/) | Validación legal, Discovery | Todos | Portal de trámites y registro de empresas en línea. Complementa el registro mercantil descentralizado | Manual | Sin API documentada. Verificar estado operativo del portal antes de integrar | **P1** |
| **CCIC** — Registro Mercantil Cortés | [registromercantil.ccichonduras.org](https://registromercantil.ccichonduras.org/) | Validación legal | Todos | Empresas y socios de la región de Cortés (San Pedro Sula) | Manual | Solo región Cortés | **P1** |
| **CCIT** — Registro Mercantil Francisco Morazán | [ccit.hn/registromercantil](https://www.ccit.hn/registromercantil) | Validación legal | Todos | Consulta mercantil regional de Tegucigalpa | Manual | Cobertura regional | **P1** |
| **SAR Honduras** — RTN | [sar.gob.hn](https://www.sar.gob.hn/) | Validación tributaria | Todos | Validar RTN, razón social, estado tributario | Manual | Solo validación individual | **P1** |
| **HonduCompras** | [honducompras.gob.hn](https://www.honducompras.gob.hn/) | Señales comerciales | Tecnología, Salud, Educación, Seguridad | Proveedores del Estado hondureño | Media | Confirmar estructura | **P1** |
| **COHEP** | [cohep.com](https://www.cohep.com/) | Sectorial | Multisectorial | Consejo Hondureño de la Empresa Privada. Señales y directorios gremiales | Manual | Afiliados | **P1** |

---

## 22. Nicaragua

### Lectura general

Nicaragua es el país con menor cobertura de datos públicos digitales de la región. No hay fuente pública estructurada y descargable de empresas. La DGI permite validación individual de RUC. El Registro Público tiene consulta web básica. **No incluir en automatización MVP.** Usar únicamente Apollo o validación manual para prospectos nicaragüenses.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **DGI Nicaragua** — Consulta RUC | [dgi.gob.ni](https://www.dgi.gob.ni/) | Validación tributaria | Todos | Validar RUC, razón social, estado tributario | Manual | Sin API; datos muy limitados | **P1** |
| **Registro Público** | [registropublico.gob.ni](https://www.registropublico.gob.ni/) | Validación legal | Todos | Consulta básica de sociedades por NAM o razón social | Manual — web muy básico | Sin API; sin descarga masiva | **P1** |
| **NicaraguaCompra / SISCAE** | [nicaraguacompra.gob.ni](https://www.nicaraguacompra.gob.ni/) | Señales comerciales | Todos B2G | Proveedores del Estado nicaragüense | Baja | Confirmar estructura | **P2** |
| **Cámara de Industrias** | [cadin.org.ni](https://cadin.org.ni/) | Sectorial | Manufactura / Industria | Gremio industrial | Manual | Afiliados | **P2** |
| **Cámara de Comercio** | [cccn.org.ni](https://www.cccn.org.ni/) | Sectorial | Comercio / Retail | Directorio gremial | Manual | Afiliados | **P2** |

> **Nota:** Nicaragua tiene la cobertura de datos públicos más limitada de los 17 países cubiertos. No integrar en automatización MVP.

---

## 23. República Dominicana

### Lectura general

La **DGII** (Dirección General de Impuestos Internos) es la fuente más utilizable de RD: permite consulta de RNC y tiene descarga TXT/CSV del padrón de contribuyentes. El Registro Mercantil está descentralizado por Cámara de Comercio provincial. El **ONE** (Oficina Nacional de Estadística) tiene directorio de empresas y establecimientos. Para la región Caribe/Centroamérica, RD tiene el ecosistema de datos más maduro junto con Panamá.

### Fuentes recomendadas

| Fuente | URL | Tipo | Sectores útiles | Uso recomendado | Automatización MVP | Riesgos / límites | Prioridad |
|---|---|---|---|---|---|---|---|
| **DGII** — Consulta RNC | [dgii.gov.do — RNC](https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx) · [herramientas](https://dgii.gov.do/herramientas/consultas/Paginas/default.aspx) | Validación tributaria, Discovery | Todos | Validar RNC, razón social, estado, actividad económica. Descarga TXT/CSV disponible. Actualización diaria | Media-Alta — descarga CSV/TXT disponible | APIs de tercero (dgiiapicloud.com) de pago para uso intensivo | **P0** |
| **ONE** — Directorio de Empresas y Establecimientos | [one.gob.do](https://www.one.gob.do/) | Discovery, Enriquecimiento | Todos | Directorio estadístico de empresas y establecimientos | Media — revisar disponibilidad de descarga actualizada | Datos estadísticos; actualización variable | **P0** |
| **Registro Mercantil** — Consultas | [app.registromercantil.do/consultas](https://app.registromercantil.do/consultas) | Validación legal | Todos | Validar registro mercantil y vigencia de empresa | Manual | Consulta puntual; no discovery masivo | **P1** |
| **Cámara de Comercio y Producción de Santo Domingo** | [camarasantodomingo.do](https://www.camarasantodomingo.do/) | Validación, Sectorial | Todos | Administra el Registro Mercantil en Santo Domingo. Formalización y directorio de socios | Manual | Solo jurisdicción Santo Domingo | **P1** |
| **Fedocámaras** | [fedocamaras.do/Socios/ListadoCamaras](https://www.fedocamaras.do/Socios/ListadoCamaras) | Sectorial, Referencia | Todos | Listado de cámaras de comercio provinciales. Ruta para fuentes camerales regionales | Manual | No es directorio de empresas | **P2** |
| **ONAPI** — Oficina Nacional de la Propiedad Industrial | [onapi.gob.do](https://onapi.gob.do/) | Señales comerciales, Validación | Todos — especialmente Tecnología, Manufactura, Farmacéutica | Búsqueda de marcas registradas, patentes y modelos de utilidad por empresa. Señal de empresa activa con actividad comercial formal | Manual | Solo empresas con propiedad industrial registrada. No es discovery primario | **P2** |

---

## 24. Fuentes sectoriales regionales

### Textil / Manufactura

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[INEXMODA — Directorio](https://directorio.inexmoda.org.co/)** | Colombia | Discovery del sector moda: marcas, fabricantes, proveedores textiles registrados en Colombia | Baja — portal web paginado | **P1** | No incluye contacto directo; volumen limitado |
| **[ANDI — Cámara Moda y Textiles](https://www.andi.com.co/Home/Camara/3-moda-y-textiles)** | Colombia | Empresas afiliadas a la cámara moda y textiles de ANDI | Manual | **P1** | Solo socios ANDI; principalmente grandes empresas |
| **[CANAIVE](https://canaive.mx/)** — delegaciones | México | Directorio de la industria del vestido por delegación estatal | Baja — por delegación, no unificado | **P1** | Directorios no consolidados; requiere recorrer delegaciones |
| **[SOFOFA — Gremios](https://sofofa.cl/membresia/gremios-asociados/)** | Chile | 42 gremios sectoriales incluyendo manufactura y textil, 7,000+ empresas asociadas | Manual — directorio web por gremio | **P1** | Sin descarga masiva directa |
| **[SNI — Comité Textil](https://www.sni.org.pe/)** | Perú | Comités sectoriales SNI: textil y calzado, alimentos, química, metal | Manual | **P1** | Solo afiliados; directorio no es público completo |

### Automotriz

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[AMIA](https://amia.com.mx/)** | México | OEMs y ensambladoras afiliadas; estadísticas mensuales de ventas por marca | Manual — lista pública de terminales | **P1** | Solo terminales (Tier 0); no cubre autopartes Tier 1/2/3 |
| **[ANAC](https://www.anac.cl/)** | Chile | 38 empresas representadas (60 marcas ligeras, 24 camiones, 16 buses) | Manual | **P1** | Solo representantes y distribuidores registrados |
| **[ANDI — Cámara Automotriz](https://www.andi.com.co/)** | Colombia | Cámara del sector automotriz: ensambladoras, distribuidores, autopartes afiliadas | Manual | **P1** | Solo afiliados ANDI |
| **[ADEFA](https://adefa.com.ar/)** | Argentina | Fabricantes de vehículos en Argentina: terminales y marca | Manual — lista institucional pública | **P1** | Solo terminales; no incluye autopartes ni concesionarios |
| **[ANDEMOS](https://www.andemos.org/)** | Colombia | Estadísticas de ventas de vehículos por marca y segmento. Señal de mercado activo | Media — datos descargables en portal | **P1** | Solo estadísticas; no directorio de empresas |

### Seguridad / HSE

No existe un directorio regional consolidado de empresas clientes/proveedoras HSE. Estrategia recomendada: filtrar fuentes fiscales por CIIU/SCIAN de sectores de alto riesgo + directorios de gremios HSE específicos.

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[CCS — Consejo Colombiano de Seguridad](https://ccs.org.co/)** | Colombia | Empresas certificadas en SST/HSE y publicaciones sectoriales. Directorio de socios por sector | Manual | **P1** | Solo socios CCS; no exhaustivo |
| **[ACHS](https://www.achs.cl/)** | Chile | Red de salud ocupacional y clínicas. Empresas adherentes al sistema de mutualidades | Manual | **P1** | No es directorio de empresas clientes |
| **IMSS — Padrón de Patrones** filtrado por SCIAN | México | Empleadores formales en sectores de alto riesgo: construcción (SCIAN 23), manufactura pesada (31–33), minería (21) | Alta — filtro por SCIAN en descarga CSV | **P1** | No incluye contacto. Solo empleadores IMSS formales |
| **SUNAT Padrón RUC** filtrado por CIIU | Perú | Empresas activas en CIIU de sectores industriales con riesgo laboral: manufactura, construcción, minería | Alta — filtro por CIIU en ZIP | **P1** | Sin datos de contacto |
| **[COPNIA](https://www.copnia.gov.co/)** | Colombia | Profesionales y empresas de ingeniería con matrícula vigente. Componente HSE en proyectos de infraestructura | Manual | **P2** | Profesionales y firmas registradas; no directorio de clientes empresariales |

### Retail

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[FENALCO Antioquia](https://directorio.fenalcoantioquia.com/)** | Colombia (Antioquia) | Directorio público de empresas comerciales en Antioquia: retail, comercio minorista, servicios | Baja — portal web | **P1** | Cobertura regional (solo Antioquia); sin contacto directo |
| **[ANTAD](https://antad.net/asociados/)** | México | Cadenas de supermercados, tiendas departamentales y clubes de precio asociados | Manual — lista de asociados pública | **P1** | Solo cadenas grandes asociadas; no PYME retail |
| **[CNC Chile](https://www.cnc.cl/)** | Chile | Cámara Nacional de Comercio. Gremio del sector retail y servicios | Manual | **P2** | Sin directorio de empresas público; solo info institucional |
| **[CCL Negocios](https://cclnegocios.pe/)** | Perú | 10,000+ empresas asociadas a la Cámara de Comercio de Lima. Directorio multisectorial con sesgo retail/comercio | Baja — requiere afiliación | **P1** | Directorio no público gratuito; acceso por membresía |

### Servicios financieros / Fintech

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[Superfinanciera — Entidades Vigiladas](https://www.superfinanciera.gov.co/entidades/)** | Colombia | Lista completa de bancos, aseguradoras, AFP, fiduciarias, comisionistas vigilados. Fuente de verdad del sector financiero regulado CO | Alta — API Socrata vía datos.gov.co | **P0** | Solo entidades vigiladas; no fintech no reguladas |
| **[Fasecolda](https://www.fasecolda.com/)** | Colombia | Directorio de aseguradoras del mercado colombiano. Publicaciones estadísticas del sector | Baja — info pública | **P1** | Solo aseguradoras afiliadas |
| **[Colombia Fintech](https://colombiafintech.co/)** | Colombia | 365+ miembros del ecosistema fintech colombiano: pagos, crédito, seguros, inversión | Manual | **P1** | Solo fintech; no banca tradicional |
| **[Latam Fintech Hub — Directorio](https://www.latamfintech.co/directorio)** | CO, MX, CL, PE, AR, BR | Fintechs LatAm por país, segmento y etapa de desarrollo | Manual | **P1** | Solo fintech; actualización variable |
| **[IDB FINLAC](https://data.iadb.org/)** | Regional LatAm | 2,000+ instituciones financieras LatAm con variables de performance: rentabilidad, morosidad, tamaño | Alta — descarga libre | **P1** | Solo sector financiero regulado supervisado |
| **[AACH](https://portal.aach.cl/)** | Chile | Lista de aseguradoras reguladas por la Comisión para el Mercado Financiero (CMF) en Chile | Baja — lista institucional | **P1** | Solo aseguradoras reguladas Chile |
| **[FinteChile](https://fintechile.org/)** | Chile | Directorio de fintechs chilenas. Ecosistema local de pagos, crédito, wealthtech | Manual | **P1** | Solo fintech Chile |
| **[FELABAN](https://felaban.com/)** | 19 países LatAm + Caribe | Bancos y entidades financieras afiliadas por país. Fuente de referencia regional del sector bancario formal | Manual | **P1** | Solo sector bancario regulado; no cooperativas ni fintech |
| **[ALAS — Asociación Latinoamericana de Seguros](https://alas-seguros.org/)** | Regional LatAm | Aseguradoras y reaseguradoras por país. Complementa Superfinanciera y AACH | Manual | **P2** | Solo sector asegurador regulado; actualización variable |

### Tecnología

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[CANIETI](https://canieti.org/nuestros-afiliados)** | México | 1,000+ empresas TIC afiliadas. Directorio público por nombre de empresa | Baja — portal web paginado | **P1** | Sin contacto directo; sin segmentación avanzada |
| **[CESSI](https://cessi.org.ar/)** | Argentina | 1,800+ empresas de software y servicios TI representadas | Manual | **P1** | Solo sector software/TI Argentina |
| **[ACTI](https://acti.cl/)** | Chile | Asociación Chilena de Empresas de TI. Directorio de miembros con datos básicos | Baja — requiere registro gratuito | **P1** | Registro gratuito para acceder al directorio completo |
| **[CCIT](https://www.ccit.org.co/)** | Colombia | Cámara Colombiana de Informática y Telecomunicaciones. Publicaciones y agremiación TI | Manual | **P2** | Sin directorio de empresas público accesible |
| **[APESOFT](https://www.apesoft.org/)** | Perú | 60+ empresas de software afiliadas. Discovery del ecosistema software peruano | Manual — vía contacto con APESOFT | **P1** | Directorio no disponible en línea abierto |
| **[AESOFT](https://aesoft.com.ec/)** | Ecuador | Empresas de software ecuatorianas asociadas. Directorio sectorial TI Ecuador | Manual | **P2** | Solo tecnología Ecuador; afiliados únicamente |

### Salud

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[MinSalud — REPS](https://prestadores.minsalud.gov.co/directorio/consultaips.aspx)** | Colombia | Directorio completo de IPS: nombre, NIT, dirección, teléfono, email, web, representante legal | Baja — consulta web; descarga masiva requiere solicitud formal | **P0** | Sin API pública documentada; carga masiva requiere gestión |
| **[Datos Abiertos CO — IPS](https://www.datos.gov.co/Salud-y-Protecci-n-Social/Listado-de-Instituciones-de-Salud/fgk8-hnys)** | Colombia | Listado de instituciones de salud habilitadas con NIT y datos básicos. API Socrata disponible | Alta — API Socrata | **P0** | Puede tener datos desactualizados vs. REPS oficial |
| **[ACHC](https://achc.org.co/)** | Colombia | Asociación Colombiana de Hospitales y Clínicas. Grandes clínicas y hospitales afiliados | Manual | **P1** | Solo grandes establecimientos de salud afiliados |
| **[ACEMI](https://acemi.org.co/)** | Colombia | EPS y aseguradoras de salud colombianas. Directorio institucional del sector asegurador salud | Manual — info pública | **P1** | Solo EPS reguladas; no clínicas ni hospitales |
| **[ANHP México](https://anhp.mx/)** | México | Hospitales privados afiliados a la Asociación Nacional. Directorio del sector hospitalario privado | Manual | **P1** | Solo hospitales privados afiliados a ANHP |

### Educación / Formación corporativa

| Fuente | Países / cobertura | Uso recomendado | Automatización MVP | Prioridad | Riesgos |
|---|---|---|---|---|---|
| **[SENCE — OTEC](https://sence.gob.cl/organismos/otec)** | Chile | Lista completa de organismos de capacitación laboral registrados: nombre, RUT, región. Mejor fuente de formación corporativa en LatAm | Alta — CSV descargable gratuito | **P0** | Solo sector formación laboral formal regulado por SENCE |
| **[Startupeable EdTech LatAm](https://startupeable.com/edtech/)** | Regional LatAm | Mapa de fintechs y edtechs por país y segmento. Señal de ecosistema EdTech emergente | Manual | **P2** | Actualización variable; no es directorio estructurado de empresas |
| **[SENA](https://www.sena.edu.co/)** | Colombia | Referencia del ecosistema de formación corporativa colombiano. No es directorio de empresas clientes | Manual | **P2** | Solo referencia institucional; no fuente de prospectos |

---

## 25. Taxonomía de sectores y keywords

Esta tabla orienta al Agente 1 para expandir búsquedas en fuentes con texto libre o clasificación CIIU/SCIAN.

| Sector | Keywords base | Variantes LatAm | Códigos orientativos |
|---|---|---|---|
| **Textil / Manufactura textil** | textil, confección, moda, vestuario, prendas, telas, hilandería, uniformes, indumentaria, fibras, tejidos | CO: dotaciones, uniformes escolares; MX: maquiladoras, industria del vestido; CL: vestuario; PE: alpaca, fibra natural | CIIU 13-14 · SCIAN 313-316 |
| **Automotriz** | automotriz, autopartes, vehículos, concesionarios, ensamblaje, flotas, repuestos, motos | MX: armadoras, Tier 1/2/3; CO: distribuidores oficiales; CL: importadoras; PE: talleres, flotas | CIIU 29, 45 · SCIAN 3361-3363, 4411-4412 |
| **Seguridad / HSE** | seguridad industrial, salud ocupacional, HSE, SST, riesgos laborales, EPP, señalización, extinción incendios, vigilancia, seguridad privada | CO: ARL, COPASST; MX: IMSS, STPS; CL: mutualidades; PE: SUNAFIL; EHS, prevención | CIIU 80, 7490, 4669 · SCIAN 5616, 5629 |
| **Retail** | retail, comercio minorista, tiendas, consumo masivo, cadenas, supermercados, conveniencia, grandes superficies, e-commerce, franquicias | CO: droguerías, grandes cadenas; MX: tiendas departamentales, clubes de precio; CL: farmacias; PE: boticas | CIIU 47 · SCIAN 44-45 |
| **Servicios financieros** | banca, seguros, fintech, cooperativas, fondos, fiduciaria, leasing, factoring, microfinanzas, corredores de bolsa, aseguradoras | CO: AFP, EPS (salud); MX: SOFOM, SOFINCO; CL: administradoras de fondos, isapres; PE: cajas municipales | CIIU 64-66 · SCIAN 52 |
| **Tecnología** | software, SaaS, TI, ciberseguridad, desarrollo, telecomunicaciones, cloud, inteligencia artificial, ERP, CRM, transformación digital, BPO | CO: Colombia TIC; MX: nearshore, maquiladoras TI; CL: startups, ACTI; PE: outsourcing TI; AR: industria del software | CIIU 62-63 · SCIAN 5112, 5415, 5179 |
| **Salud** | clínicas, hospitales, laboratorios, salud ocupacional, aseguradoras, diagnóstico, imágenes, odontología, psicología, rehabilitación, dispositivos médicos | CO: IPS, EPS; MX: IMSS, ISSSTE, hospitales privados; CL: isapres, centros médicos; PE: MINSA, ESSALUD; DO: ARS | CIIU 86-88 · SCIAN 621-622 |
| **Educación / Formación corporativa** | universidades, capacitación, formación, e-learning, educación corporativa, LMS, entrenamiento, certificaciones, academias, escuelas de negocio, edtech | CO: SENA, cajas de compensación; MX: CONALEP, IPN, proveedores e-learning; CL: SENCE, OTEC; PE: SENATI; AR: institutos terciarios | CIIU 85 · SCIAN 611-619 |

### Notas de uso

- Los **códigos CIIU** se usan en Colombia (RUES), Perú (SUNAT), Ecuador (SCVS), Bolivia (SEPREC).
- Los **códigos SCIAN** se usan en México (DENUE/INEGI).
- Chile (SII) usa clasificación propia basada en CIIU adaptada.
- Al buscar en API DENUE: filtrar por parámetro `actividad` con código SCIAN de 6 dígitos o nombre de la actividad.
- Al buscar en padrón SUNAT o RUES: filtrar por `codigo_ciiu`.

---

## 26. P0 recomendadas para MVP

### P0 automatizables (API o descarga masiva confirmada)

| País | Fuente | Por qué es P0 | Automatización |
|---|---|---|---|
| **México** | DENUE / API DENUE | 6M+ establecimientos, API REST gratuita con token, 22 campos (incluye tel/email del establecimiento), descarga masiva | Alta |
| **Colombia** | Supersociedades SIIS | 1,000 más grandes + financieros IFRS. Gratuito. Descarga Excel/CSV | Alta |
| **Colombia** | SECOP II / Colombia Compra | Señal comercial B2G más robusta de la región. API Socrata + descarga | Alta |
| **Colombia** | Datos Abiertos Colombia | Datasets de empresas por CCB regional con API CKAN/Socrata | Alta |
| **Chile** | RES / datos.gob.cl | Descarga CSV gratuita de alta calidad. Base de deduplicación con RUT | Alta |
| **Chile** | ChileCompra / datos-abiertos.chilecompra.cl | API pública + datos abiertos. Proveedores del Estado con RUT y rubros | Alta |
| **Chile** | SENCE-OTEC | CSV descargable. Mejor fuente para sector formación corporativa en LatAm | Alta |
| **Perú** | SUNAT Padrón RUC (descarga ZIP) | ZIP diario gratuito. RUC + estado habido/no habido + CIIU. Mejor fuente de Perú | Alta |
| **Perú** | PRODUCE Manufactura | Open data ya segmentado por manufactura. Descarga directa CSV | Alta |
| **Perú** | OSCE / SEACE datos abiertos | Señal B2G. Proveedores del Estado con RUC y categorías | Alta |
| **Ecuador** | SCVS / Supercias ranking + dataset | Descarga CSV/ODS en datosabiertos.gob.ec. Ranking con datos adicionales | Media-Alta |
| **Ecuador** | SERCOP datos abiertos | API OCDS documentada. Compras públicas Ecuador | Alta |
| **Brasil** | Receita Federal CNPJ Dados Abertos | La fuente más completa de LatAm. Descarga masiva mensual gratuita | Alta (requiere ETL) |
| **Brasil** | OpenCNPJ / cnpj.ws | API REST gratuita, sin auth, 50 req/seg. Enriquecimiento en tiempo real | Alta |
| **Argentina** | datos.jus.gob.ar — Registro Nacional de Sociedades | ZIP mensual libre con CUIT, razón social, domicilio. Actualización el 15 | Alta |
| **Uruguay** | DEI MIEM / catalogodatos.gub.uy | CSV/JSON/XML libre. Empresas industriales con RUT y actividad | Alta |
| **Rep. Dominicana** | DGII / Consulta RNC + descarga TXT/CSV | Descarga del padrón RNC disponible. Actualización diaria | Media-Alta |

### P0 manuales / precargables (sin API pero de alta utilidad)

| País | Fuente | Por qué precargar | Método |
|---|---|---|---|
| **Colombia** | RUES (bases segmentadas) | NIT + CIIU + estado. Fuente de validación más confiable de CO | Compra a CCB o descarga por cámara |
| **Colombia** | CCB Data Store | La única fuente con datos enriquecidos por sector/tamaño + nombre de decisor | Contrato con CCB |
| **Colombia** | MinSalud REPS | Directorio completo de IPS con teléfono y email | Carga manual o scraping autorizado |
| **México** | CANIETI, ANTAD, AMIA | Listas sectoriales públicas de afiliados | Carga manual de CSV/listas |
| **Chile** | SOFOFA, SENCE-OTEC | Listas sectoriales de gremios y OTEC | SENCE: CSV automático; SOFOFA: manual |
| **Colombia** | INEXMODA, FENALCO Antioquia | Directorios sectoriales públicos | Carga manual |
| **Perú** | SNI, ADEX, CCL Negocios | Fuentes sectoriales con afiliados verificados | Manual |

### P1 — Validar antes de integrar

Argentina (AFIP/ARCA), Paraguay (DNCP señal B2G), Bolivia (SEPREC web), Costa Rica (INEC DEE + Registro Nacional), Panamá (Panama Emprende + Registro Público), Guatemala (Registro Mercantil), El Salvador (CNR), Honduras (Empresas Abiertas).

---

## 27. Riesgos legales y técnicos

### Privacidad y datos personales — Leyes por país

| País | Ley | Implicaciones B2B |
|---|---|---|
| **Colombia** | Ley 1581/2012 + D.1377/2013 (SIC) | Datos de personas jurídicas en registros públicos: libre acceso. Contactos de personas naturales: consentimiento o interés legítimo documentado |
| **Brasil** | LGPD — Lei 13.709/2018 (ANPD) | La más estricta de la región. CNPJ es público. Contactos individuales requieren base legal. Multas hasta 2% del faturamento, máx R$50M |
| **Chile** | Ley 19.628/1999 + modernización en curso | Datos de personas jurídicas en registros públicos: libre uso. Modernización alineará con GDPR europeo |
| **México** | LFPDPPP 2010 (INAI) | Datos de personas morales: no protegidos. Personas físicas (contactos): requieren aviso de privacidad |
| **Perú** | Ley 29733/2011 (ARSDP) | Datos de personas jurídicas en registros públicos: libre acceso. Personas naturales: consentimiento |
| **Ecuador** | Ley Orgánica de Protección de Datos Personales 2021 | Ley moderna. Datos públicos de personas jurídicas: utilizables. Contactos individuales: requieren base legal |
| **Argentina** | Ley 25.326/2000 (AAIP) | Registro de bases con fines comerciales ante AAIP es obligatorio. Datos empresariales en registros públicos: accesibles |

### Restricciones de scraping y ToS

- **RUES Colombia:** ToS de Confecámaras prohíben scraping masivo. Ruta legal: CCB Data Store (pago) o datasets datos.gov.co
- **SII Chile:** Prohíbe expresamente el scraping automatizado. Usar APIs de terceros que operan bajo sus propios ToS
- **SUNAT Perú:** El padrón reducido es oficial y descargable. Scraping de e-consultaruc está en zona gris
- **SAT México:** Prohíbe consulta automatizada masiva de RFC. DENUE es la ruta legal
- **CNPJ Brasil:** Open data oficial. OpenCNPJ (cnpj.ws) es la API tercero más confiable
- **LinkedIn:** ToS prohíbe scraping y exportación masiva explícitamente. Límite de 2,500 resultados por búsqueda

**Regla general:** Ningún portal regional expone APIs gratuitas para datos de contacto individual (email/teléfono directo de personas). Esos datos solo están disponibles legalmente vía servicios de enriquecimiento comerciales (Apollo, Lusha, CIAL D&B) con acuerdos de datos establecidos.

### Transferencia transfronteriza de datos

Brasil (LGPD) y Ecuador (Ley 2021) tienen las restricciones más explícitas. Para un pipeline LATAM centralizado, documentar la base legal de cada transferencia o considerar arquitectura de datos regionalmente distribuida.

### Otros riesgos técnicos

| Riesgo | Descripción | Mitigación |
|---|---|---|
| **CAPTCHA / login** | SAT (MX), SII (CL), SAR (HN), DGI (EC) tienen captcha en consultas individuales | No automatizar; usar API alternativa o descarga masiva |
| **Datos desactualizados** | Directorios de gremios, cámaras y algunos registros públicos no se actualizan con frecuencia | Guardar `source_date`, `last_checked_at` por candidato |
| **Sesgo B2G** | Compras públicas solo cubren empresas que venden al Estado; puede excluir empresas puramente B2B privadas | Usar como señal complementaria, no única |
| **Cobertura desigual** | MX, CO, BR, CL, PE tienen excelentes fuentes. CentroAmérica y Caribe tienen cobertura limitada | Ajustar expectativas de calidad por país |
| **Personas naturales** | Muchos padrones incluyen personas naturales con RUC/NIT. Si se incluyen como empresas, contaminan el lote | Filtrar por tipo de contribuyente (persona moral/jurídica) en cada país |
| **Normalización compleja** | S.A.S., SAS, S.A. de C.V., Ltda., SpA, S.R.L., S.A., E.I.R.L. son el mismo tipo de entidad | Implementar reglas de limpieza de sufijos legales antes de comparar |
| **Terceros sin SLA** | cnpj.ws, APIs de Verifik/Apitude, PANADATA son servicios de terceros sin garantía de disponibilidad | No usar como única fuente; siempre tener fallback |

---

## 28. Brechas de investigación

| Área | Descripción | Impacto en MVP |
|---|---|---|
| **El Salvador, Nicaragua, Honduras** | No se identificó fuente pública estructurada y descargable de empresas comparable a países grandes. Discovery solo manual o vía Apollo | No incluir en automatización MVP primera versión |
| **APIs oficiales por país sin confirmar** | RUES (Colombia), SEPREC (Bolivia), Registro Nacional (CR), Registro Mercantil (GT): sin API pública documentada | Confirmar antes de integrar; tratar como Manual |
| **Términos de uso por fuente** | Antes de automatizar cualquier fuente, verificar ToS, robots.txt y límites de uso. No documentados para todas las fuentes de este catálogo | Obligatorio antes de producción |
| **Directorios sectoriales por país** | Textil en Chile/Perú/Ecuador, HSE en toda la región, salud en MX/AR/BR: no se encontraron equivalentes a INEXMODA o MinSalud REPS | Investigación adicional por sector/país |
| **Fuentes de datos propias de UBITS** | ¿Tiene UBITS bases de clientes, prospectos o contactos previos reutilizables? | Alto impacto en calidad de primera ola de prospectos |
| **Sectores prioritarios reales del equipo** | De los 8 sectores documentados, el equipo comercial debe definir los 2–3 con mayor pipeline actual | Define qué fuentes sectoriales cargar primero |
| **Costo de bases de Cámaras de Comercio** | CCB (Bogotá), Cámara Medellín: ¿cuánto cuesta una base segmentada de 5,000 empresas por industria? | Alternativa al consumo de créditos Apollo para CO |
| **Validación funcional de Lusha** | La integración Lusha no ha sido validada con API Key real en SellUp a la fecha de este documento | Bloqueante para enriquecimiento automático de contactos |
| **Restricciones legales de uso masivo** | Uso comercial de padrón SUNAT, RUC Ecuador, RUES Colombia: validar si los ToS permiten uso comercial masivo | Riesgo legal si no se documenta |
| **DENUE token de acceso** | Registrarse en INEGI para obtener token gratuito y confirmar límites de rate para México | Primer paso técnico para activar México |
| **Dominio web empresarial** | Los registros oficiales raramente incluyen el dominio web de la empresa | Siempre requerirá capa adicional de enriquecimiento (Apollo, búsqueda web) |

---

## 29. Recomendación final

Este catálogo es la **fuente oficial** para orientar las decisiones del Agente 1 sobre qué fuentes consultar por país y sector. No todas las fuentes documentadas se integrarán en el MVP.

### Resumen de madurez de datos por país

| Nivel | Países |
|---|---|
| **Alto** — API/open data + actualizados | Brasil, México (DENUE), Chile, Colombia (parcial con CCB Data Store) |
| **Medio** — Datos públicos, automatización limitada | Perú, Ecuador, Argentina, Uruguay, Rep. Dominicana |
| **Bajo** — Consulta manual, sin API, cobertura limitada | Paraguay, Bolivia, Guatemala, Panamá, Costa Rica, El Salvador, Honduras |
| **Muy bajo** — Datos mínimos, digitalización incipiente | Nicaragua |

### Cascada recomendada para MVP del Agente 1

```
1. Base interna SellUp
2. HubSpot (contexto + deduplicación)
3. Fuentes P0 precargadas o con API clara (según tabla §26)
4. Apollo.io (cuando fuentes 1-3 no alcanzan el objetivo)
5. Lusha (solo enriquecimiento de contactos en candidatos ya aprobados)
6. Web / IA (solo en mode profundo, fuera de primera versión)
```

### Primera ola de automatización fuerte (MVP)

- **México:** DENUE (API REST gratuita) — activar primero
- **Colombia:** datos.gov.co (SECOP II, empresas) + SIIS Supersociedades
- **Ecuador:** SCVS ranking CSV + SERCOP API OCDS
- **Chile:** RES datos.gob.cl + ChileCompra datos abiertos
- **Perú:** SUNAT Padrón RUC ZIP + SEACE datos abiertos
- **Brasil:** Receita Federal CNPJ (si se acepta complejidad técnica) + OpenCNPJ API
- **Rep. Dominicana:** DGII descarga RNC

### Primera ola manual / precargable (MVP)

Argentina, Uruguay, Paraguay, Bolivia, Costa Rica, Panamá, Guatemala, El Salvador, Honduras, Nicaragua → usar **HubSpot + Apollo** como fuentes primarias. Agregar fuentes P0 manuales cuando el equipo consiga bases o listas sectoriales verificadas.

### Regla crítica de automatización segura

> Si una fuente no tiene **API documentada** o **dataset descargable oficial**, no se automatiza en la primera versión del agente. Se usa como lista precargada manualmente o como fuente de validación manual asistida.

---

*Documento consolidado el 2026-05-21. Versión 0.2.*  
*Todas las fuentes citadas son reales y verificables al momento de la investigación. Disponibilidad, cobertura y condiciones de uso pueden cambiar.*  
*Próximo paso: priorizar países y sectores comercialmente relevantes para UBITS, resolver brechas del §28, y hacer commit de este catálogo junto con el documento del Agente 1.*
