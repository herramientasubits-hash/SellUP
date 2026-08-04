/**
 * sellup-subindustry-catalog-names.ts — Los nombres REALES de subindustria del
 * catálogo activo de SellUp, congelados como fixture.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2-FIX · § 8.
 *
 * Por qué existe: el § 8 exige reejecutar el emparejamiento de alias contra el
 * catálogo real y probar que ninguna subindustria distinta de «Supermercados e
 * Hipermercados» resuelve a su mapping. Hacerlo con una consulta viva ataría la
 * suite a la base de datos de Producción — justo lo que el § 12 prohíbe en este PR.
 *
 * Origen: lectura de SOLO LECTURA de `active_industry_catalog.subindustry_name`
 * (73 nombres distintos, catálogo activo). Cero escrituras, cero créditos.
 *
 * El seguimiento de `subindustry_search_terms` (228 términos) queda fuera de este
 * PR y con él la posibilidad de sustituir esta lista por una lectura gestionada.
 */

/** 73 subindustrias del catálogo activo, en orden alfabético. */
export const SELLUP_ACTIVE_SUBINDUSTRY_NAMES: readonly string[] = [
  'Agritech',
  'Agroindustria y Procesamiento Primario',
  'Auditoría, Contabilidad y Advisory Financiero',
  'Banca Tradicional',
  'Bienes de Capital y Maquinaria',
  'BPO y Contact Center',
  'Brokers e Intermediarios de Seguros',
  'Cadena de Frío y Logística Farmacéutica',
  'Certificación Profesional B2B',
  'Ciberseguridad',
  'Construcción e Infraestructura',
  'Consultoría de Estrategia y Gestión',
  'Cooperativas y Entidades Financieras Solidarias',
  'Courier y Mensajería Empresarial',
  'CRO e Investigación Clínica',
  'Cuidado Personal, Higiene y Hogar (FMCG)',
  'Data Analytics y Business Intelligence',
  'Dispositivos Médicos y MedTech',
  'Distribuidores Farmacéuticos',
  'Ecommerce Enablement',
  'Edtech: Plataformas de Aprendizaje',
  'Energía, Minería y Servicios Industriales',
  'Equipamiento y Suministros Hospitalarios',
  'Escuelas de Negocios y Formación Ejecutiva',
  'Fabricantes de Alimentos y Bebidas (FMCG)',
  'Facilities, Aseo Industrial y Seguridad Privada',
  'Factoring, Leasing y Crédito Empresarial',
  'Farmacias Cadena y Retail de Salud',
  'Fintech B2B: Servicios Financieros',
  'Fintech: Infraestructura y Pagos',
  'Fondos de Inversión y Gestión de Activos',
  'Formación Corporativa y Corporate Training',
  'Freight Forwarders y Agencias de Aduana',
  'Govtech y Ciudades Inteligentes',
  'Grupos Educativos Multi-sede',
  'Healthtech B2B',
  'HRtech y Gestión del Talento',
  'Infraestructura Cloud y DevOps',
  'Institutos Técnicos y Vocacionales',
  'Insurtech',
  'Inteligencia Artificial y Machine Learning',
  'Investigación de Mercados e Inteligencia Comercial',
  'IoT y Hardware Conectado',
  'Laboratorios Clínicos y Diagnóstico',
  'Laboratorios Farmacéuticos',
  'Legaltech',
  'Logística para Minería y Energía',
  'Manufactura Exportadora y Zona Franca',
  'Marketing Technology y Sales Tech',
  'Medicina Prepagada y EPS',
  'Metalmecánica y Autopartes',
  'Operadores Logísticos 3PL y 4PL',
  'Operadores Omnicanal y Ecommerce Retail',
  'Operadores Portuarios y Aeroportuarios de Carga',
  'Proptech e Inmobiliaria Digital',
  'QA, Testing y Automatización (RPA)',
  'Químicos, Plásticos y Packaging Industrial',
  'Redes Hospitalarias y Clínicas',
  'Retailers Especializados',
  'Salud Ocupacional y Medicina Laboral',
  'Seguros de Vida y Personas',
  'Seguros Generales',
  'Servicios Legales y Compliance',
  'Software Empresarial (SaaS / ERP / CRM)',
  'Software Factory y Nearshore',
  'Staffing y Servicios Temporales',
  'Supermercados e Hipermercados',
  'Telco y Comunicaciones',
  'Tiendas por Departamento, Moda y Calzado',
  'Transporte de Carga Terrestre',
  'Universidades e Institutos Privados',
  'Universidades Públicas con Capacidad de Compra',
  'Warehousing y Fulfillment B2B',
];

/** La única subindustria del catálogo con mapping explícito de búsqueda Apollo. */
export const SELLUP_SUBINDUSTRY_WITH_APOLLO_MAPPING = 'Supermercados e Hipermercados' as const;

/**
 * Nombres genéricos que NO son subindustrias del catálogo y que la contención
 * bidireccional anterior resolvía por error a «Supermercados e Hipermercados»:
 * `retail` cabía en el alias `grocery retail`, `alimentos` en `retail de alimentos`
 * y `food` en `food retail`.
 */
export const GENERIC_NAMES_THAT_MUST_NOT_MATCH: readonly string[] = [
  'Retail',
  'retail',
  'Alimentos',
  'alimentos',
  'Food',
  'food',
  'Retail y Consumo',
  'Comercio',
  'Consumo masivo',
  'Tiendas',
  'Cadena',
  'Store',
];
