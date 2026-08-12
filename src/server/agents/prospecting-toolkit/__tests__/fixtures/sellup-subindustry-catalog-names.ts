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

/** La primera subindustria del catálogo con mapping explícito de búsqueda Apollo. */
export const SELLUP_SUBINDUSTRY_WITH_APOLLO_MAPPING = 'Supermercados e Hipermercados' as const;

/**
 * Subindustrias del catálogo activo con mapping explícito de búsqueda Apollo, en el
 * orden en que el catálogo las declara.
 *
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 9 — «Tiendas por Departamento, Moda y
 * Calzado» entró porque es la subindustria que la corrida live `ce957e2f` eligió y
 * que no tenía términos: sin entrada, el reparto ANY-OF no podía representarla y el
 * gate del § 7 habría bloqueado una selección legítima del wizard.
 *
 * Las 71 restantes siguen SIN mapping, y eso es un hecho operativo, no un detalle
 * de test: una corrida que las elija no puede construir una consulta que las cubra
 * y se bloquea antes de gastar. Conectar `subindustry_search_terms` (228 términos
 * sobre las 73) es el seguimiento registrado en `apollo-subindustry-search-mapping`.
 */
export const SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING = [
  'Supermercados e Hipermercados',
  'Tiendas por Departamento, Moda y Calzado',
] as const;

/**
 * PHASE 2C — subindustrias con política de PRECISIÓN en modo `full`.
 *
 * Son las DOS históricas, y coinciden con las de búsqueda por accidente de la
 * historia, no por definición: `search_covered` y `precision_mapped` son
 * propiedades INDEPENDIENTES (73/73 frente a 11/73). Se declara aparte de
 * `SELLUP_SUBINDUSTRIES_WITH_APOLLO_MAPPING` justamente para que ampliar una no
 * arrastre a la otra en silencio.
 */
export const SELLUP_SUBINDUSTRIES_WITH_PRECISION_FULL = [
  'Supermercados e Hipermercados',
  'Tiendas por Departamento, Moda y Calzado',
] as const;

/**
 * PHASE 2C · Ola 1 — las NUEVE subindustrias con política de precisión en modo
 * `confirm_only`, con el nombre canónico EXACTO del catálogo activo.
 *
 * Los nombres se leyeron de `active_industry_catalog` en Producción (sólo lectura) y
 * NO son las abreviaturas del encargo: cinco de las nueve difieren. La identidad de
 * precisión se resuelve por igualdad exacta desde PHASE 2A, así que una regla
 * declarada como «Farmacias Cadena» o «Redes Hospitalarias» no resolvería nunca y
 * sería código muerto.
 *
 * «Formación Corporativa y Corporate Training» NO está: § 21. Es la subindustria con
 * más demanda observada sin mapear (13 búsquedas) y la decisión de dejarla fuera es
 * de la dueña del producto.
 */
export const SELLUP_SUBINDUSTRIES_WITH_PRECISION_CONFIRM_ONLY = [
  'Banca Tradicional',
  'Ciberseguridad',
  'Escuelas de Negocios y Formación Ejecutiva',
  'Fabricantes de Alimentos y Bebidas (FMCG)',
  'Farmacias Cadena y Retail de Salud',
  'Laboratorios Clínicos y Diagnóstico',
  'Medicina Prepagada y EPS',
  'Redes Hospitalarias y Clínicas',
  'Universidades e Institutos Privados',
] as const;

/** Las 11 subindustrias con política de precisión: 2 en `full` + 9 en `confirm_only`. */
export const SELLUP_SUBINDUSTRIES_WITH_PRECISION_MAPPING = [
  ...SELLUP_SUBINDUSTRIES_WITH_PRECISION_FULL,
  ...SELLUP_SUBINDUSTRIES_WITH_PRECISION_CONFIRM_ONLY,
] as const;

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
