/**
 * pre119-catalog-views.ts — Las dos vistas de catálogo, antes y después del
 * cutover de la migración 119.
 *
 * AGENT1-MACRO-CATALOG-PRE119-LEGACY-READERS-1 · §§ 10, 11, 14, 18, 19 y 20.
 *
 * ── Procedencia de los datos ──────────────────────────────────────────────────
 *
 * `V1_*` se leyó de Producción en SÓLO LECTURA el 2026-08-12: 8 industrias y 73
 * subindustrias de la versión `1.0.0 published`, con sus UUID determinísticos
 * reales, sus `applicable_countries` reales y su orden real. No es una muestra ni
 * una aproximación: es la forma exacta que las cuatro rutas de importación y las
 * dos superficies del wizard ven HOY, y por eso sirve como base de paridad (§ 11).
 *
 * `V2_*` se deriva de `MACRO_INDUSTRIES` —la única fuente de la taxonomía macro en
 * código— y de los UUID que la migración 118 siembra. Derivarlo en vez de
 * transcribirlo es deliberado: si alguien añade, quita o renombra una macro
 * industria, la simulación post-119 cambia con ella y § 14 sigue siendo una
 * comprobación real, no una copia que se puede quedar vieja.
 *
 * ── Qué modela el estado post-119 ─────────────────────────────────────────────
 *
 * Después del cutover: `v1 archived`, `v2 published`. Entonces
 *
 *   active_macro_industry_catalog → 12 filas (v2)
 *   active_industry_catalog       → 0 filas
 *
 * El cero de la vista legacy NO se corrige aquí ni se falsea (§ 18): la vista hace
 * INNER JOIN con `subindustries` y un catálogo macro no tiene ninguna, así que cero
 * es su respuesta CORRECTA. Lo que la suite comprueba es que ningún consumidor vivo
 * lea ese cero como «catálogo no disponible».
 */

import {
  MACRO_INDUSTRIES,
  MACRO_INDUSTRY_CATALOG_VERSION,
  LEGACY_INDUSTRY_CATALOG_VERSION,
} from '@/modules/macro-industry-catalog/macro-industries';

// ─── Versiones ────────────────────────────────────────────────────────────────

export const V1_CATALOG_VERSION = LEGACY_INDUSTRY_CATALOG_VERSION;
export const V1_CATALOG_VERSION_ID = 'e4675daf-65a2-5e26-8640-58f1aeaee5ed';

export const V2_CATALOG_VERSION = MACRO_INDUSTRY_CATALOG_VERSION;
export const V2_CATALOG_VERSION_ID = 'b2c4e6a8-0d1f-4a3b-8c5d-7e9f0a1b2c3d';

// ─── v1: las 8 industrias publicadas (Producción, sólo lectura) ───────────────

type IndustrySeed = { id: string; name: string; slug: string; sortOrder: number };

export const V1_INDUSTRIES: readonly IndustrySeed[] = [
  { id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', name: 'Tecnología', slug: 'tecnologia', sortOrder: 1 },
  { id: '7f728594-1ad2-5837-abed-88b90b067e21', name: 'Servicios Financieros', slug: 'servicios-financieros', sortOrder: 2 },
  { id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', name: 'Salud', slug: 'salud', sortOrder: 3 },
  { id: '263192bb-4db8-585c-9220-a9eabb77f9e9', name: 'Educación', slug: 'educacion', sortOrder: 4 },
  { id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', name: 'Retail y Consumo', slug: 'retail', sortOrder: 5 },
  { id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', name: 'Manufactura e Industria', slug: 'manufactura', sortOrder: 6 },
  { id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', name: 'Consultoría y Servicios Profesionales', slug: 'consultoria-servicios-profesionales', sortOrder: 7 },
  { id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', name: 'Logística y Transporte', slug: 'logistica-transporte', sortOrder: 8 },
];

/** § 13 — la industria que v2 deja fuera A PROPÓSITO. */
export const EDUCATION_INDUSTRY_ID = '263192bb-4db8-585c-9220-a9eabb77f9e9';
export const EDUCATION_INDUSTRY_NAME = 'Educación';

// ─── v1: las 73 subindustrias publicadas ──────────────────────────────────────

type SubindustrySeed = {
  industry_id: string;
  subindustry_id: string;
  subindustry_name: string;
  subindustry_slug: string;
  subindustry_sort_order: number;
  applicable_countries: string[] | null;
};

export const V1_SUBINDUSTRIES: readonly SubindustrySeed[] = [
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '3107711d-2a6c-557e-9fd2-4f49e16df9e2', subindustry_name: 'Software Empresarial (SaaS / ERP / CRM)', subindustry_slug: 'software-empresarial', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '40a655f2-0c1a-545d-973a-fb357d6b8da9', subindustry_name: 'Ciberseguridad', subindustry_slug: 'ciberseguridad', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', subindustry_name: 'Infraestructura Cloud y DevOps', subindustry_slug: 'infraestructura-cloud-devops', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', subindustry_name: 'Fintech: Infraestructura y Pagos', subindustry_slug: 'fintech-infraestructura-pagos', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', subindustry_name: 'HRtech y Gestión del Talento', subindustry_slug: 'hrtech-gestion-talento', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', subindustry_name: 'Marketing Technology y Sales Tech', subindustry_slug: 'martech-salestech', subindustry_sort_order: 6, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '81203ac3-a280-5d00-97b1-330f429c8495', subindustry_name: 'Inteligencia Artificial y Machine Learning', subindustry_slug: 'inteligencia-artificial-ml', subindustry_sort_order: 7, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '87a07024-5d94-55fe-b122-7137ad3c9a12', subindustry_name: 'Ecommerce Enablement', subindustry_slug: 'ecommerce-enablement', subindustry_sort_order: 8, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', subindustry_name: 'Healthtech B2B', subindustry_slug: 'healthtech-b2b', subindustry_sort_order: 9, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', subindustry_name: 'Proptech e Inmobiliaria Digital', subindustry_slug: 'proptech', subindustry_sort_order: 10, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '014296cc-98e4-5433-bc2f-bbcbcadbf252', subindustry_name: 'Legaltech', subindustry_slug: 'legaltech', subindustry_sort_order: 11, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: 'f286731d-fa78-507c-932c-b028ff6f00d7', subindustry_name: 'Insurtech', subindustry_slug: 'insurtech', subindustry_sort_order: 12, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', subindustry_name: 'Govtech y Ciudades Inteligentes', subindustry_slug: 'govtech', subindustry_sort_order: 13, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '52787e3c-6e77-5fb2-b62b-dd999c4df07e', subindustry_name: 'Agritech', subindustry_slug: 'agritech', subindustry_sort_order: 14, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', subindustry_name: 'Data Analytics y Business Intelligence', subindustry_slug: 'data-analytics-bi', subindustry_sort_order: 15, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', subindustry_name: 'IoT y Hardware Conectado', subindustry_slug: 'iot-hardware-conectado', subindustry_sort_order: 16, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: 'b684211e-413a-54d3-8989-a8139e2c1285', subindustry_name: 'Software Factory y Nearshore', subindustry_slug: 'software-factory-nearshore', subindustry_sort_order: 17, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '7d2ce6cb-2dbd-5c46-93dc-502241887d69', subindustry_name: 'Telco y Comunicaciones', subindustry_slug: 'telecomunicaciones-tech', subindustry_sort_order: 18, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: 'ec013b35-657a-5a4d-b500-477222d724bc', subindustry_name: 'QA, Testing y Automatización (RPA)', subindustry_slug: 'qa-testing-automatizacion', subindustry_sort_order: 19, applicable_countries: null },
  { industry_id: '06854cd2-3748-5c3b-bcf9-5c5087c1b3f3', subindustry_id: '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', subindustry_name: 'Edtech: Plataformas de Aprendizaje', subindustry_slug: 'edtech-plataformas', subindustry_sort_order: 20, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: '4d764405-cdb7-526e-9468-73fa008bbdc6', subindustry_name: 'Banca Tradicional', subindustry_slug: 'banca-tradicional', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: '968f71cb-1483-538b-83e2-6eaaf6467dcf', subindustry_name: 'Seguros Generales', subindustry_slug: 'seguros-generales', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', subindustry_name: 'Seguros de Vida y Personas', subindustry_slug: 'seguros-vida-personas', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: '14fdb758-d9d0-56b8-a899-4b2529e87a43', subindustry_name: 'Brokers e Intermediarios de Seguros', subindustry_slug: 'brokers-intermediarios-seguros', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: 'c81af5fd-147f-5525-b9e5-906230842846', subindustry_name: 'Fintech B2B: Servicios Financieros', subindustry_slug: 'fintech-b2b-servicios', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: 'c4291ea6-67e1-52ff-ae79-5a67939cf448', subindustry_name: 'Factoring, Leasing y Crédito Empresarial', subindustry_slug: 'factoring-leasing-credito', subindustry_sort_order: 6, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: '87822a25-bfed-5194-8931-b80e2898ea79', subindustry_name: 'Fondos de Inversión y Gestión de Activos', subindustry_slug: 'fondos-gestion-activos', subindustry_sort_order: 7, applicable_countries: null },
  { industry_id: '7f728594-1ad2-5837-abed-88b90b067e21', subindustry_id: '4668b75d-d69f-50ca-902e-d85767652d79', subindustry_name: 'Cooperativas y Entidades Financieras Solidarias', subindustry_slug: 'cooperativas-financieras', subindustry_sort_order: 8, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: '041e7562-9bac-596f-a8a2-346f390c0fe8', subindustry_name: 'Redes Hospitalarias y Clínicas', subindustry_slug: 'redes-hospitalarias-clinicas', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: '8515cd86-1a51-577b-b71c-b4907d56ce1f', subindustry_name: 'Laboratorios Farmacéuticos', subindustry_slug: 'laboratorios-farmaceuticos', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: 'c08be8e0-c6a9-5988-8a00-6fc666146f06', subindustry_name: 'Distribuidores Farmacéuticos', subindustry_slug: 'distribuidores-farmaceuticos', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: '33236dc9-8af2-542f-b88b-06b1584a01f9', subindustry_name: 'Dispositivos Médicos y MedTech', subindustry_slug: 'dispositivos-medicos-medtech', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: '431a0c19-885d-5f59-ae46-a4e22f7e9486', subindustry_name: 'Laboratorios Clínicos y Diagnóstico', subindustry_slug: 'laboratorios-clinicos-diagnostico', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: 'df0765ed-3842-5b2e-a320-b0cee73b11d4', subindustry_name: 'Salud Ocupacional y Medicina Laboral', subindustry_slug: 'salud-ocupacional', subindustry_sort_order: 6, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: '2bffda5f-45f2-5a36-84e5-5038562c6916', subindustry_name: 'Medicina Prepagada y EPS', subindustry_slug: 'medicina-prepagada-eps', subindustry_sort_order: 7, applicable_countries: ['AR', 'BR', 'CL', 'CO', 'EC', 'MX', 'PE', 'UY'] },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', subindustry_name: 'CRO e Investigación Clínica', subindustry_slug: 'cro-investigacion-clinica', subindustry_sort_order: 8, applicable_countries: null },
  { industry_id: '2c5f0aa0-9116-50ef-838d-68dc01f33ada', subindustry_id: '975b1e2b-cd1f-59be-a00a-645de8d6ec34', subindustry_name: 'Equipamiento y Suministros Hospitalarios', subindustry_slug: 'equipamiento-hospitalario', subindustry_sort_order: 9, applicable_countries: null },
  { industry_id: '263192bb-4db8-585c-9220-a9eabb77f9e9', subindustry_id: '1779cc43-079d-5a5f-9e15-902f3cdbabae', subindustry_name: 'Universidades e Institutos Privados', subindustry_slug: 'universidades-institutos-privados', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: '263192bb-4db8-585c-9220-a9eabb77f9e9', subindustry_id: 'a4db23d2-6d94-5463-a171-fbee80028206', subindustry_name: 'Universidades Públicas con Capacidad de Compra', subindustry_slug: 'universidades-publicas-relevantes', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: '263192bb-4db8-585c-9220-a9eabb77f9e9', subindustry_id: '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', subindustry_name: 'Escuelas de Negocios y Formación Ejecutiva', subindustry_slug: 'escuelas-negocios-ejecutiva', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: '263192bb-4db8-585c-9220-a9eabb77f9e9', subindustry_id: '2b631bf6-425d-53ce-8f9d-d156713df570', subindustry_name: 'Formación Corporativa y Corporate Training', subindustry_slug: 'formacion-corporativa-b2b', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: '263192bb-4db8-585c-9220-a9eabb77f9e9', subindustry_id: 'c7cd8535-8714-58ba-ad16-2d157102cb48', subindustry_name: 'Institutos Técnicos y Vocacionales', subindustry_slug: 'institutos-tecnicos-vocacionales', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: '263192bb-4db8-585c-9220-a9eabb77f9e9', subindustry_id: '3e9f8993-6d08-5206-8f71-d69b9f99a71c', subindustry_name: 'Certificación Profesional B2B', subindustry_slug: 'certificacion-profesional-b2b', subindustry_sort_order: 6, applicable_countries: null },
  { industry_id: '263192bb-4db8-585c-9220-a9eabb77f9e9', subindustry_id: '8efb5b7b-4790-570d-ade7-a44effcd5a49', subindustry_name: 'Grupos Educativos Multi-sede', subindustry_slug: 'grupos-educativos-red', subindustry_sort_order: 7, applicable_countries: null },
  { industry_id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', subindustry_id: 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', subindustry_name: 'Supermercados e Hipermercados', subindustry_slug: 'supermercados-hipermercados', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', subindustry_id: '912a4b36-8597-5204-bb8e-814fb0769505', subindustry_name: 'Tiendas por Departamento, Moda y Calzado', subindustry_slug: 'tiendas-departamento-moda', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', subindustry_id: 'd49ba019-c2e4-59b5-bc58-12724ec1f152', subindustry_name: 'Farmacias Cadena y Retail de Salud', subindustry_slug: 'farmacias-cadena-retail', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', subindustry_id: '9d036663-b424-5989-9bfc-02c85b0c25c8', subindustry_name: 'Retailers Especializados', subindustry_slug: 'retailers-especializados', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', subindustry_id: '8f893965-daf2-508f-95c7-bbc332595f3e', subindustry_name: 'Operadores Omnicanal y Ecommerce Retail', subindustry_slug: 'operadores-omnicanal', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', subindustry_id: '2b2ead23-b436-5b62-910e-997995ad2cd2', subindustry_name: 'Fabricantes de Alimentos y Bebidas (FMCG)', subindustry_slug: 'fabricantes-alimentos-bebidas', subindustry_sort_order: 6, applicable_countries: null },
  { industry_id: 'e9338391-f2d1-5c84-90da-49a5508e4d3f', subindustry_id: '228440c9-a8d7-51b9-96cd-47bac896b0cf', subindustry_name: 'Cuidado Personal, Higiene y Hogar (FMCG)', subindustry_slug: 'cuidado-personal-higiene-hogar', subindustry_sort_order: 7, applicable_countries: null },
  { industry_id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', subindustry_id: '76d05169-addd-50f4-b0ef-67e6a0b07fc5', subindustry_name: 'Metalmecánica y Autopartes', subindustry_slug: 'metalmecanica-autopartes', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', subindustry_id: '55386a47-3bec-510a-91c6-ba61341f5676', subindustry_name: 'Químicos, Plásticos y Packaging Industrial', subindustry_slug: 'quimicos-plasticos-packaging', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', subindustry_id: '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', subindustry_name: 'Bienes de Capital y Maquinaria', subindustry_slug: 'bienes-capital-maquinaria', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', subindustry_id: '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', subindustry_name: 'Manufactura Exportadora y Zona Franca', subindustry_slug: 'manufactura-exportadora', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', subindustry_id: 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', subindustry_name: 'Construcción e Infraestructura', subindustry_slug: 'construccion-obra-civil', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', subindustry_id: '87b9e0c7-0d17-5400-93e8-b62906fedf6a', subindustry_name: 'Energía, Minería y Servicios Industriales', subindustry_slug: 'energia-mineria-servicios', subindustry_sort_order: 6, applicable_countries: ['CO', 'PE', 'CL', 'MX', 'BR', 'AR', 'BO', 'EC'] },
  { industry_id: 'da9e4f93-b45e-5874-94de-a7b50f739daa', subindustry_id: 'eaefd820-c413-571b-b9ba-2100eed3e49f', subindustry_name: 'Agroindustria y Procesamiento Primario', subindustry_slug: 'agroindustria-procesadora', subindustry_sort_order: 7, applicable_countries: ['CO', 'PE', 'EC', 'MX', 'CL', 'BR', 'AR', 'GT', 'CR'] },
  { industry_id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', subindustry_id: 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', subindustry_name: 'Consultoría de Estrategia y Gestión', subindustry_slug: 'consultoria-estrategia-gestion', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', subindustry_id: 'abf86c42-cf23-532c-8343-5db4e225b57e', subindustry_name: 'Auditoría, Contabilidad y Advisory Financiero', subindustry_slug: 'auditoria-contabilidad', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', subindustry_id: 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', subindustry_name: 'Servicios Legales y Compliance', subindustry_slug: 'servicios-legales-compliance', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', subindustry_id: 'c2ad5ec0-571a-520e-a026-53a0dc75e260', subindustry_name: 'BPO y Contact Center', subindustry_slug: 'bpo-contact-center', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', subindustry_id: '0e890f25-655c-5061-b354-f86c3ab29062', subindustry_name: 'Staffing y Servicios Temporales', subindustry_slug: 'staffing-servicios-temporales', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', subindustry_id: 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', subindustry_name: 'Facilities, Aseo Industrial y Seguridad Privada', subindustry_slug: 'facilities-seguridad-privada', subindustry_sort_order: 6, applicable_countries: null },
  { industry_id: 'e1c4e056-c7f5-5f81-988e-bd69b7e8f949', subindustry_id: '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', subindustry_name: 'Investigación de Mercados e Inteligencia Comercial', subindustry_slug: 'investigacion-mercados-inteligencia', subindustry_sort_order: 7, applicable_countries: null },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', subindustry_name: 'Operadores Logísticos 3PL y 4PL', subindustry_slug: 'operadores-logisticos-3pl-4pl', subindustry_sort_order: 1, applicable_countries: null },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: '695bf6e7-c121-5bc5-940a-5def8d79f523', subindustry_name: 'Transporte de Carga Terrestre', subindustry_slug: 'transporte-carga-terrestre', subindustry_sort_order: 2, applicable_countries: null },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: 'adcfeed3-fc65-5c45-bf66-7910446075ca', subindustry_name: 'Freight Forwarders y Agencias de Aduana', subindustry_slug: 'freight-forwarders-aduana', subindustry_sort_order: 3, applicable_countries: null },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: 'c92627a7-95c6-542f-bb35-f88d401e53c4', subindustry_name: 'Cadena de Frío y Logística Farmacéutica', subindustry_slug: 'cadena-frio-farmaceutica', subindustry_sort_order: 4, applicable_countries: null },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: '2effb010-8309-5e97-92dd-3b50a5400de6', subindustry_name: 'Warehousing y Fulfillment B2B', subindustry_slug: 'warehousing-fulfillment', subindustry_sort_order: 5, applicable_countries: null },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: 'ae3d1714-e36a-549c-986e-fc53ffa63d80', subindustry_name: 'Operadores Portuarios y Aeroportuarios de Carga', subindustry_slug: 'operadores-portuarios-aeroportuarios', subindustry_sort_order: 6, applicable_countries: null },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: 'e729fcea-2082-55b8-a945-8ed65adac821', subindustry_name: 'Logística para Minería y Energía', subindustry_slug: 'logistica-mineria-energia', subindustry_sort_order: 7, applicable_countries: ['CO', 'PE', 'CL', 'MX', 'BR', 'AR', 'BO', 'EC'] },
  { industry_id: '11b032ad-e9d4-5390-8bc8-cd740ac28e4e', subindustry_id: '7564d31e-3d32-5c3e-b795-81093419f83a', subindustry_name: 'Courier y Mensajería Empresarial', subindustry_slug: 'courier-mensajeria-empresarial', subindustry_sort_order: 8, applicable_countries: null },
];

// ─── Proyección a filas de vista ──────────────────────────────────────────────

const industryById = new Map(V1_INDUSTRIES.map((i) => [i.id, i]));

/** Filas de `active_macro_industry_catalog` bajo v1 publicada. */
export function v1MacroViewRows(): Record<string, unknown>[] {
  return V1_INDUSTRIES.map((i) => ({
    catalog_version_id: V1_CATALOG_VERSION_ID,
    catalog_version: V1_CATALOG_VERSION,
    industry_id: i.id,
    industry_name: i.name,
    industry_slug: i.slug,
    industry_description: null,
    industry_sort_order: i.sortOrder,
    has_active_subindustries: true,
  }));
}

/** Filas de `active_industry_catalog` bajo v1 publicada — las 73 del cruce. */
export function v1LegacyViewRows(): Record<string, unknown>[] {
  return V1_SUBINDUSTRIES.map((s) => {
    const industry = industryById.get(s.industry_id)!;
    return {
      catalog_version_id: V1_CATALOG_VERSION_ID,
      catalog_version: V1_CATALOG_VERSION,
      industry_id: industry.id,
      industry_name: industry.name,
      industry_slug: industry.slug,
      industry_description: null,
      industry_sort_order: industry.sortOrder,
      subindustry_id: s.subindustry_id,
      subindustry_name: s.subindustry_name,
      subindustry_slug: s.subindustry_slug,
      subindustry_description: null,
      subindustry_sort_order: s.subindustry_sort_order,
      applicable_countries: s.applicable_countries,
    };
  });
}

/** Los 12 UUID que la migración 118 siembra, en orden de `sortOrder`. */
export function v2IndustryId(sortOrder: number): string {
  const n = String(sortOrder).padStart(2, '0');
  return `c10000${n}-0000-4000-8000-0000000000${n}`;
}

/**
 * Filas de `active_macro_industry_catalog` bajo v2 publicada — las 12 macro
 * industrias. Derivadas de `MACRO_INDUSTRIES`, no transcritas (§ 14).
 */
export function v2MacroViewRows(): Record<string, unknown>[] {
  return [...MACRO_INDUSTRIES]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => ({
      catalog_version_id: V2_CATALOG_VERSION_ID,
      catalog_version: V2_CATALOG_VERSION,
      industry_id: v2IndustryId(m.sortOrder),
      industry_name: m.displayName,
      industry_slug: m.slug,
      industry_description: null,
      industry_sort_order: m.sortOrder,
      has_active_subindustries: false,
    }));
}

/**
 * Filas de `active_industry_catalog` bajo v2 publicada: CERO.
 *
 * § 18 — es el resultado correcto de la vista, no una avería que haya que
 * enmascarar. La vista hace INNER JOIN con `subindustries` y v2 no tiene ninguna.
 */
export function v2LegacyViewRows(): Record<string, unknown>[] {
  return [];
}

// ─── Doble de Supabase ────────────────────────────────────────────────────────

export type ViewResponse = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

/**
 * Respuesta por tabla o vista. Las claves de catálogo son las que importan; se
 * admite `internal_users` porque las rutas de importación resuelven la identidad
 * interna antes de tocar el catálogo, y sin ella no se puede atravesar la ruta
 * entera en una prueba sin base de datos.
 */
export type CatalogViewFixture = Partial<
  Record<
    | 'active_macro_industry_catalog'
    | 'active_industry_catalog'
    | 'active_subindustry_aliases'
    | 'active_subindustry_search_terms'
    | 'internal_users',
    ViewResponse
  >
>;

export type CatalogSupabaseStub = {
  client: unknown;
  /** Vistas efectivamente consultadas, en orden. Prueba de qué se leyó y qué no. */
  reads: string[];
};

/**
 * Doble de sólo lectura del cliente Supabase, limitado a las vistas de catálogo.
 *
 * Registra cada lectura para que la suite pueda afirmar algo más fuerte que «el
 * resultado es correcto»: que bajo la taxonomía macro la vista legacy NO se
 * consulta en absoluto (§ 3). Una tabla no declarada en el fixture LANZA, así que
 * una lectura nueva no puede colarse sin que un test lo note.
 */
export function createCatalogSupabaseStub(
  fixture: CatalogViewFixture,
): CatalogSupabaseStub {
  const reads: string[] = [];

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'fixture-auth-user' } },
        error: null,
      }),
    },
    from(table: string) {
      const response = fixture[table as keyof CatalogViewFixture];
      if (!response) {
        throw new Error(`unexpected catalog read: ${table}`);
      }
      reads.push(table);

      const result = Promise.resolve(response);
      const chain = {
        select: () => chain,
        eq: () => chain,
        /** `.single()` devuelve la primera fila, como PostgREST. */
        single: async () => ({
          data: response.data?.[0] ?? null,
          error: response.error,
        }),
        then: (...args: Parameters<Promise<ViewResponse>['then']>) =>
          result.then(...args),
        catch: (...args: Parameters<Promise<ViewResponse>['catch']>) =>
          result.catch(...args),
      };
      return chain;
    },
  };

  return { client, reads };
}

/** Atajo: el estado de Producción HOY — v1 publicada, v2 en draft. */
export function currentProductionFixture(): CatalogViewFixture {
  return {
    active_macro_industry_catalog: { data: v1MacroViewRows(), error: null },
    active_industry_catalog: { data: v1LegacyViewRows(), error: null },
    active_subindustry_aliases: { data: [], error: null },
  };
}

/** Atajo: el estado DESPUÉS de la 119 — v1 archived, v2 published. */
export function post119Fixture(): CatalogViewFixture {
  return {
    active_macro_industry_catalog: { data: v2MacroViewRows(), error: null },
    active_industry_catalog: { data: v2LegacyViewRows(), error: null },
    active_subindustry_aliases: { data: [], error: null },
  };
}
