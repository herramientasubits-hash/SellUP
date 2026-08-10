/**
 * sellup-published-catalog-search-terms.ts — la lectura REAL de las dos vistas del
 * catálogo publicado, en la forma exacta en que PostgREST las devuelve.
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · CATALOG SOURCE-OF-TRUTH FINAL
 * ADDENDUM · §§ 6 y 7.
 *
 * ── Qué es y qué NO es ────────────────────────────────────────────────────────
 *
 * NO es un snapshot de producción. Vive en `__tests__/fixtures/` y ningún módulo de
 * `src/server` lo importa: el código de producción lee el catálogo en vivo
 * (`loadApolloSubindustryCatalogTerms`) y no tiene ningún respaldo estático. Este
 * archivo existe para que la suite pueda ejercitar ese loader y el contrato de
 * cobertura sin base de datos, contra datos que de verdad existen.
 *
 * Origen: `execute_sql` de SÓLO LECTURA contra Prod `lrdruowtadwbdulndlph`
 * (2026-08-10), catálogo `industry_catalog_versions.version = '1.0.0'`,
 * `status = 'published'`, `id = e4675daf-65a2-5e26-8640-58f1aeaee5ed`. Dos consultas:
 *
 *   SELECT catalog_version_id, catalog_version, subindustry_id, subindustry_name
 *   FROM public.active_industry_catalog;                              -- 73 filas
 *
 *   SELECT catalog_version_id, subindustry_id, term, term_type, weight
 *   FROM public.active_subindustry_search_terms
 *   WHERE term_type = 'keyword';                                      -- 107 filas
 *
 * Cero escrituras. Cero créditos. Cero llamadas a Apollo o Tavily.
 *
 * Generado por script y verificado: 73 subindustrias activas, 107 términos
 * `keyword`, 73/73 con al menos uno. Si el catálogo publicado cambia, este fixture
 * describe la versión `1.0.0` y nada más — y eso es correcto: los tests de deriva del
 * § 6 usan versiones sintéticas precisamente para no depender de que Prod siga igual.
 */

import {
  buildApolloSubindustryCatalogTermsResolution,
  type ApolloSubindustryCatalogTermsResolution,
} from '../../apollo-subindustry-catalog-terms-resolution';

export const CATALOG_VERSION = '1.0.0';
export const CATALOG_VERSION_ID = 'e4675daf-65a2-5e26-8640-58f1aeaee5ed';

/** Digest esperado de la resolución de `1.0.0`. Congelado a propósito. */
export const CATALOG_TERMS_SOURCE_HASH = '5b62440102c4f02e2cec37dd10e881d0e3cc6ebabc64a75290f80107cbd5be58';

/** Filas de `public.active_industry_catalog`, tal cual. */
export const PUBLISHED_CATALOG_ROWS = [
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '52787e3c-6e77-5fb2-b62b-dd999c4df07e', subindustry_name: 'Agritech' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'eaefd820-c413-571b-b9ba-2100eed3e49f', subindustry_name: 'Agroindustria y Procesamiento Primario' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'abf86c42-cf23-532c-8343-5db4e225b57e', subindustry_name: 'Auditoría, Contabilidad y Advisory Financiero' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '4d764405-cdb7-526e-9468-73fa008bbdc6', subindustry_name: 'Banca Tradicional' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', subindustry_name: 'Bienes de Capital y Maquinaria' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'c2ad5ec0-571a-520e-a026-53a0dc75e260', subindustry_name: 'BPO y Contact Center' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '14fdb758-d9d0-56b8-a899-4b2529e87a43', subindustry_name: 'Brokers e Intermediarios de Seguros' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'c92627a7-95c6-542f-bb35-f88d401e53c4', subindustry_name: 'Cadena de Frío y Logística Farmacéutica' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '3e9f8993-6d08-5206-8f71-d69b9f99a71c', subindustry_name: 'Certificación Profesional B2B' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '40a655f2-0c1a-545d-973a-fb357d6b8da9', subindustry_name: 'Ciberseguridad' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', subindustry_name: 'Construcción e Infraestructura' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', subindustry_name: 'Consultoría de Estrategia y Gestión' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '4668b75d-d69f-50ca-902e-d85767652d79', subindustry_name: 'Cooperativas y Entidades Financieras Solidarias' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '7564d31e-3d32-5c3e-b795-81093419f83a', subindustry_name: 'Courier y Mensajería Empresarial' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', subindustry_name: 'CRO e Investigación Clínica' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '228440c9-a8d7-51b9-96cd-47bac896b0cf', subindustry_name: 'Cuidado Personal, Higiene y Hogar (FMCG)' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', subindustry_name: 'Data Analytics y Business Intelligence' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '33236dc9-8af2-542f-b88b-06b1584a01f9', subindustry_name: 'Dispositivos Médicos y MedTech' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'c08be8e0-c6a9-5988-8a00-6fc666146f06', subindustry_name: 'Distribuidores Farmacéuticos' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '87a07024-5d94-55fe-b122-7137ad3c9a12', subindustry_name: 'Ecommerce Enablement' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', subindustry_name: 'Edtech: Plataformas de Aprendizaje' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '87b9e0c7-0d17-5400-93e8-b62906fedf6a', subindustry_name: 'Energía, Minería y Servicios Industriales' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '975b1e2b-cd1f-59be-a00a-645de8d6ec34', subindustry_name: 'Equipamiento y Suministros Hospitalarios' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', subindustry_name: 'Escuelas de Negocios y Formación Ejecutiva' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '2b2ead23-b436-5b62-910e-997995ad2cd2', subindustry_name: 'Fabricantes de Alimentos y Bebidas (FMCG)' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', subindustry_name: 'Facilities, Aseo Industrial y Seguridad Privada' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'c4291ea6-67e1-52ff-ae79-5a67939cf448', subindustry_name: 'Factoring, Leasing y Crédito Empresarial' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'd49ba019-c2e4-59b5-bc58-12724ec1f152', subindustry_name: 'Farmacias Cadena y Retail de Salud' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'c81af5fd-147f-5525-b9e5-906230842846', subindustry_name: 'Fintech B2B: Servicios Financieros' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', subindustry_name: 'Fintech: Infraestructura y Pagos' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '87822a25-bfed-5194-8931-b80e2898ea79', subindustry_name: 'Fondos de Inversión y Gestión de Activos' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '2b631bf6-425d-53ce-8f9d-d156713df570', subindustry_name: 'Formación Corporativa y Corporate Training' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'adcfeed3-fc65-5c45-bf66-7910446075ca', subindustry_name: 'Freight Forwarders y Agencias de Aduana' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', subindustry_name: 'Govtech y Ciudades Inteligentes' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '8efb5b7b-4790-570d-ade7-a44effcd5a49', subindustry_name: 'Grupos Educativos Multi-sede' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', subindustry_name: 'Healthtech B2B' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', subindustry_name: 'HRtech y Gestión del Talento' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', subindustry_name: 'Infraestructura Cloud y DevOps' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'c7cd8535-8714-58ba-ad16-2d157102cb48', subindustry_name: 'Institutos Técnicos y Vocacionales' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'f286731d-fa78-507c-932c-b028ff6f00d7', subindustry_name: 'Insurtech' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '81203ac3-a280-5d00-97b1-330f429c8495', subindustry_name: 'Inteligencia Artificial y Machine Learning' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', subindustry_name: 'Investigación de Mercados e Inteligencia Comercial' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', subindustry_name: 'IoT y Hardware Conectado' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '431a0c19-885d-5f59-ae46-a4e22f7e9486', subindustry_name: 'Laboratorios Clínicos y Diagnóstico' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '8515cd86-1a51-577b-b71c-b4907d56ce1f', subindustry_name: 'Laboratorios Farmacéuticos' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '014296cc-98e4-5433-bc2f-bbcbcadbf252', subindustry_name: 'Legaltech' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'e729fcea-2082-55b8-a945-8ed65adac821', subindustry_name: 'Logística para Minería y Energía' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', subindustry_name: 'Manufactura Exportadora y Zona Franca' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', subindustry_name: 'Marketing Technology y Sales Tech' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '2bffda5f-45f2-5a36-84e5-5038562c6916', subindustry_name: 'Medicina Prepagada y EPS' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '76d05169-addd-50f4-b0ef-67e6a0b07fc5', subindustry_name: 'Metalmecánica y Autopartes' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', subindustry_name: 'Operadores Logísticos 3PL y 4PL' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '8f893965-daf2-508f-95c7-bbc332595f3e', subindustry_name: 'Operadores Omnicanal y Ecommerce Retail' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'ae3d1714-e36a-549c-986e-fc53ffa63d80', subindustry_name: 'Operadores Portuarios y Aeroportuarios de Carga' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', subindustry_name: 'Proptech e Inmobiliaria Digital' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'ec013b35-657a-5a4d-b500-477222d724bc', subindustry_name: 'QA, Testing y Automatización (RPA)' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '55386a47-3bec-510a-91c6-ba61341f5676', subindustry_name: 'Químicos, Plásticos y Packaging Industrial' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '041e7562-9bac-596f-a8a2-346f390c0fe8', subindustry_name: 'Redes Hospitalarias y Clínicas' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '9d036663-b424-5989-9bfc-02c85b0c25c8', subindustry_name: 'Retailers Especializados' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'df0765ed-3842-5b2e-a320-b0cee73b11d4', subindustry_name: 'Salud Ocupacional y Medicina Laboral' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', subindustry_name: 'Seguros de Vida y Personas' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '968f71cb-1483-538b-83e2-6eaaf6467dcf', subindustry_name: 'Seguros Generales' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', subindustry_name: 'Servicios Legales y Compliance' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '3107711d-2a6c-557e-9fd2-4f49e16df9e2', subindustry_name: 'Software Empresarial (SaaS / ERP / CRM)' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'b684211e-413a-54d3-8989-a8139e2c1285', subindustry_name: 'Software Factory y Nearshore' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '0e890f25-655c-5061-b354-f86c3ab29062', subindustry_name: 'Staffing y Servicios Temporales' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', subindustry_name: 'Supermercados e Hipermercados' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '7d2ce6cb-2dbd-5c46-93dc-502241887d69', subindustry_name: 'Telco y Comunicaciones' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '912a4b36-8597-5204-bb8e-814fb0769505', subindustry_name: 'Tiendas por Departamento, Moda y Calzado' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '695bf6e7-c121-5bc5-940a-5def8d79f523', subindustry_name: 'Transporte de Carga Terrestre' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '1779cc43-079d-5a5f-9e15-902f3cdbabae', subindustry_name: 'Universidades e Institutos Privados' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: 'a4db23d2-6d94-5463-a171-fbee80028206', subindustry_name: 'Universidades Públicas con Capacidad de Compra' },
  { catalog_version_id: CATALOG_VERSION_ID, catalog_version: CATALOG_VERSION, subindustry_id: '2effb010-8309-5e97-92dd-3b50a5400de6', subindustry_name: 'Warehousing y Fulfillment B2B' },
] as const;

/** Filas `keyword` de `public.active_subindustry_search_terms`, tal cual. */
export const PUBLISHED_CATALOG_KEYWORD_TERM_ROWS = [
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '014296cc-98e4-5433-bc2f-bbcbcadbf252', term: 'firma electrónica B2B', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '014296cc-98e4-5433-bc2f-bbcbcadbf252', term: 'contratos inteligentes empresa tech', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', term: 'gobierno digital empresa', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', term: 'ciudad inteligente smart city B2B', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '041e7562-9bac-596f-a8a2-346f390c0fe8', term: 'grupo hospitalario clínicas', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '0e890f25-655c-5061-b354-f86c3ab29062', term: 'outsourcing nómina personal empresa', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', term: 'MBA ejecutivo LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', term: 'formación ejecutiva liderazgo empresa', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '14fdb758-d9d0-56b8-a899-4b2529e87a43', term: 'intermediario de seguros corporativo', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '1779cc43-079d-5a5f-9e15-902f3cdbabae', term: 'instituto de educación superior privado', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', term: 'marketing automation empresa', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', term: 'plataforma de automatización de marketing', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', term: 'hardware conectado empresa tecnológica', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '228440c9-a8d7-51b9-96cd-47bac896b0cf', term: 'FMCG cuidado personal LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', term: 'organización de investigación clínica', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2b2ead23-b436-5b62-910e-997995ad2cd2', term: 'empresa FMCG consumo masivo LATAM', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2b2ead23-b436-5b62-910e-997995ad2cd2', term: 'CPG food beverage empresa', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2b631bf6-425d-53ce-8f9d-d156713df570', term: 'formación in-company B2B', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2b631bf6-425d-53ce-8f9d-d156713df570', term: 'proveedor training empresas', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2bffda5f-45f2-5a36-84e5-5038562c6916', term: 'plan de salud corporativo', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', term: 'software de recursos humanos', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', term: 'plataforma de gestión del talento', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', term: 'nómina digital LATAM', term_type: 'keyword', weight: 0.80 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '2effb010-8309-5e97-92dd-3b50a5400de6', term: 'bodegaje almacenamiento empresarial LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3107711d-2a6c-557e-9fd2-4f49e16df9e2', term: 'SaaS B2B', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3107711d-2a6c-557e-9fd2-4f49e16df9e2', term: 'software empresarial', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3107711d-2a6c-557e-9fd2-4f49e16df9e2', term: 'ERP LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3107711d-2a6c-557e-9fd2-4f49e16df9e2', term: 'plataforma de gestión empresarial', term_type: 'keyword', weight: 0.80 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '33236dc9-8af2-542f-b88b-06b1584a01f9', term: 'medtech empresa LATAM', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '33236dc9-8af2-542f-b88b-06b1584a01f9', term: 'equipamiento hospitalario distribuidor', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', term: 'health tech empresa B2B', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', term: 'salud digital plataforma', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', term: 'telemedicina B2B empresa tecnológica', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3e9f8993-6d08-5206-8f71-d69b9f99a71c', term: 'proveedor certificaciones tech B2B', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', term: 'plataforma de pagos digitales', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', term: 'infraestructura de pagos B2B', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', term: 'wallet digital empresa tecnológica', term_type: 'keyword', weight: 0.80 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '40a655f2-0c1a-545d-973a-fb357d6b8da9', term: 'ciberseguridad empresas', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '40a655f2-0c1a-545d-973a-fb357d6b8da9', term: 'SOC gestión de seguridad', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', term: 'plataforma LMS empresa tecnológica', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', term: 'e-learning plataforma B2B', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '431a0c19-885d-5f59-ae46-a4e22f7e9486', term: 'red de laboratorios clínicos', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '4668b75d-d69f-50ca-902e-d85767652d79', term: 'cooperativa de ahorro y crédito', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '4d764405-cdb7-526e-9468-73fa008bbdc6', term: 'entidad bancaria regulada', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '4d764405-cdb7-526e-9468-73fa008bbdc6', term: 'corporativo banca empresas', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '52787e3c-6e77-5fb2-b62b-dd999c4df07e', term: 'agricultura de precisión empresa tech', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '55386a47-3bec-510a-91c6-ba61341f5676', term: 'fabricante packaging embalajes', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', term: 'proveedor logística B2B LATAM', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '695bf6e7-c121-5bc5-940a-5def8d79f523', term: 'flota de camiones empresa transporte', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', term: 'market research inteligencia de negocios', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '7564d31e-3d32-5c3e-b795-81093419f83a', term: 'última milla B2B empresa', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '76d05169-addd-50f4-b0ef-67e6a0b07fc5', term: 'fabricante autopartes LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '76d05169-addd-50f4-b0ef-67e6a0b07fc5', term: 'acería siderurgia manufactura metal', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '7d2ce6cb-2dbd-5c46-93dc-502241887d69', term: 'telecomunicaciones empresa operadora', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '7d2ce6cb-2dbd-5c46-93dc-502241887d69', term: 'CPaaS comunicaciones en la nube B2B', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '81203ac3-a280-5d00-97b1-330f429c8495', term: 'inteligencia artificial empresa B2B', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '81203ac3-a280-5d00-97b1-330f429c8495', term: 'IA generativa B2B', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '8515cd86-1a51-577b-b71c-b4907d56ce1f', term: 'pharma empresa LATAM', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '87822a25-bfed-5194-8931-b80e2898ea79', term: 'asset management empresa LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '87a07024-5d94-55fe-b122-7137ad3c9a12', term: 'plataforma e-commerce B2B', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '87a07024-5d94-55fe-b122-7137ad3c9a12', term: 'comercio electrónico empresa proveedora', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '87b9e0c7-0d17-5400-93e8-b62906fedf6a', term: 'oil gas empresa LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '87b9e0c7-0d17-5400-93e8-b62906fedf6a', term: 'energías renovables empresa operadora', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '8efb5b7b-4790-570d-ade7-a44effcd5a49', term: 'holding educativo LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '8f893965-daf2-508f-95c7-bbc332595f3e', term: 'retail omnichannel ecommerce físico', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '912a4b36-8597-5204-bb8e-814fb0769505', term: 'cadena moda retail fashion', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', term: 'maquiladora exportación LATAM', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '968f71cb-1483-538b-83e2-6eaaf6467dcf', term: 'compañía de seguros P&C', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '975b1e2b-cd1f-59be-a00a-645de8d6ec34', term: 'proveedor equipos médicos hospital', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '9d036663-b424-5989-9bfc-02c85b0c25c8', term: 'cadena electrodomésticos ferretería materiales', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', term: 'equipo industrial empresa manufactura', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', term: 'analítica de datos plataforma B2B', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', term: 'data warehouse empresa', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'a4db23d2-6d94-5463-a171-fbee80028206', term: 'universidad nacional autónoma', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'abf86c42-cf23-532c-8343-5db4e225b57e', term: 'empresa auditora contable LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'adcfeed3-fc65-5c45-bf66-7910446075ca', term: 'agente de carga internacional LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'ae3d1714-e36a-549c-986e-fc53ffa63d80', term: 'terminal portuaria empresa logística', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', term: 'empresa construcción infraestructura EPC', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'b684211e-413a-54d3-8989-a8139e2c1285', term: 'nearshore development LATAM', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'b684211e-413a-54d3-8989-a8139e2c1285', term: 'staff augmentation empresa tecnológica', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', term: 'seguro de vida corporativo grupal', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', term: 'plataforma inmobiliaria digital', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c08be8e0-c6a9-5988-8a00-6fc666146f06', term: 'cadena distribución medicamentos', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c2ad5ec0-571a-520e-a026-53a0dc75e260', term: 'empresa outsourcing procesos LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c4291ea6-67e1-52ff-ae79-5a67939cf448', term: 'leasing empresarial financiero', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c4291ea6-67e1-52ff-ae79-5a67939cf448', term: 'crédito empresarial no bancario', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c7cd8535-8714-58ba-ad16-2d157102cb48', term: 'formación técnica profesional LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c7cd8535-8714-58ba-ad16-2d157102cb48', term: 'SENA OTEC SENATI CONALEP', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c81af5fd-147f-5525-b9e5-906230842846', term: 'neobank empresa finanzas', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c81af5fd-147f-5525-b9e5-906230842846', term: 'open banking empresa operadora', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'c92627a7-95c6-542f-bb35-f88d401e53c4', term: 'almacenamiento temperatura controlada medicamentos', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'd49ba019-c2e4-59b5-bc58-12724ec1f152', term: 'droguerías cadena retail farmacia', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', term: 'firma de consultoría de gestión LATAM', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', term: 'Big 4 consultoría estratégica', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', term: 'estudio jurídico compliance corporativo', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'df0765ed-3842-5b2e-a320-b0cee73b11d4', term: 'medicina del trabajo empresa', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'df0765ed-3842-5b2e-a320-b0cee73b11d4', term: 'SST seguridad salud trabajo empresa', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', term: 'hipermercado hard discount retail', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'e729fcea-2082-55b8-a945-8ed65adac821', term: 'transporte especializado industria extractiva', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'eaefd820-c413-571b-b9ba-2100eed3e49f', term: 'agroexportadora LATAM empresa', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'ec013b35-657a-5a4d-b500-477222d724bc', term: 'RPA automatización de procesos', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'ec013b35-657a-5a4d-b500-477222d724bc', term: 'testing automatizado empresa B2B', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'f286731d-fa78-507c-932c-b028ff6f00d7', term: 'tecnología de seguros B2B', term_type: 'keyword', weight: 0.90 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', term: 'cloud computing empresas', term_type: 'keyword', weight: 1.00 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', term: 'proveedor cloud LATAM', term_type: 'keyword', weight: 0.95 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', term: 'cloud hosting B2B', term_type: 'keyword', weight: 0.85 },
  { catalog_version_id: CATALOG_VERSION_ID, subindustry_id: 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', term: 'vigilancia seguridad privada empresa', term_type: 'keyword', weight: 0.90 },
] as const;

/**
 * La resolución que el loader produce a partir de esas filas, construida con la MISMA
 * función de producción para que el fixture no pueda describir una forma que el
 * runtime no produce.
 */
export function buildPublishedCatalogTermsResolution(): ApolloSubindustryCatalogTermsResolution {
  const bySubindustry = new Map<string, string[]>();
  for (const row of PUBLISHED_CATALOG_KEYWORD_TERM_ROWS) {
    const bucket = bySubindustry.get(row.subindustry_id);
    if (bucket) bucket.push(row.term);
    else bySubindustry.set(row.subindustry_id, [row.term]);
  }
  return buildApolloSubindustryCatalogTermsResolution({
    catalogVersion: CATALOG_VERSION,
    catalogVersionId: CATALOG_VERSION_ID,
    termType: 'keyword',
    entries: PUBLISHED_CATALOG_ROWS.filter((row) => bySubindustry.has(row.subindustry_id)).map(
      (row) => ({
        canonicalSubindustryId: row.subindustry_id,
        canonicalSubindustry: row.subindustry_name,
        terms: bySubindustry.get(row.subindustry_id) ?? [],
      }),
    ),
  });
}
