/**
 * apollo-subindustry-catalog-search-terms.ts — snapshot de `subindustry_search_terms`
 * para las 73 subindustrias del catálogo activo.
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · CATALOG SEARCH TERMS COVERAGE
 * ADDENDUM · §§ 1 y 6.
 *
 * El defecto que cierra: `apollo-subindustry-search-mapping.ts` sólo tiene entradas
 * para 2 de las 73 subindustrias del catálogo. Las 71 restantes no podían construir
 * NINGUNA búsqueda — el gate fail-closed del PR #246 las bloqueaba antes de gastar,
 * no porque no hubiera señal disponible, sino porque nadie la había conectado. La
 * base de datos ya tenía esa señal: `subindustry_search_terms` (228 filas sobre las
 * 73 subindustrias, migraciones 057/058/060, catálogo `1.0.0` en estado `published`
 * en Prod `lrdruowtadwbdulndlph` desde 2026-06-11).
 *
 * ── Qué entra en este snapshot y qué no ────────────────────────────────────────
 *
 * `subindustry_search_terms.term_type` tiene cuatro valores, y sólo uno es un
 * término POSITIVO listo para viajar a Apollo tal cual:
 *
 *   - `keyword`       → término literal, sin plantilla. TODAS las 73 subindustrias
 *                       tienen al menos uno (min 1, max 4, 107 términos en total).
 *   - `query_phrase`  → 72 de 73 filas llevan un placeholder `{country}` sin
 *                       resolver (`"cadena supermercados {country}"`); enviarlo tal
 *                       cual sería un literal roto, no una keyword.
 *   - `exclusion_term`→ señal NEGATIVA (para excluir, no para buscar). Enviarlo como
 *                       keyword positivo invertiría su propósito.
 *   - `source_hint`   → metadata de procedencia de la fuente, no una keyword.
 *
 * Este addendum sólo conecta `keyword`: es el único tipo que es, a la vez, positivo
 * y literal, y por sí solo ya cubre las 73 subindustrias. `query_phrase` con
 * sustitución de `{country}` queda fuera del alcance — no se declara "conectado" y
 * no se inventa una sustitución no pedida (§ 6 del addendum): conectarla es un
 * seguimiento aparte, con su propia auditoría de plantillas.
 *
 * ── Por qué un snapshot estático y no una consulta en vivo ─────────────────────
 *
 * `apollo-subindustry-search-mapping.ts` (el catálogo de 2/73) es TypeScript
 * estático a propósito: la ruta de construcción de queries es pura (sin I/O, sin
 * reloj) y el runner que la invoca no tiene un punto async antes de necesitarla.
 * Convertir esa ruta a async para una tabla de referencia que cambia con la
 * cadencia de un catálogo versionado (no con cada corrida) cambiaría el contrato de
 * `resolveApolloSubindustryQueryTerms` para sus consumidores existentes sin ninguna
 * ganancia operativa. Este snapshot seguía el MISMO patrón: datos de catálogo
 * generados desde una lectura de SOLO LECTURA contra Prod, congelados como TS.
 *
 * Riesgo declarado: este snapshot puede quedar desactualizado si el catálogo
 * publicado cambia sin regenerarlo. `listApolloSubindustryCatalogSearchTerms()`
 * existe para que una auditoría (o una futura regeneración) pueda comparar longitud
 * y nombres contra `SELLUP_ACTIVE_SUBINDUSTRY_NAMES` sin volver a tocar la base.
 *
 * Origen exacto: `execute_sql` de sólo lectura contra `lrdruowtadwbdulndlph`
 * (2026-08-10), catálogo `industry_catalog_versions.version = '1.0.0'`,
 * `status = 'published'`. Query:
 *
 *   SELECT s.id, s.name, t.term, t.weight
 *   FROM public.subindustries s
 *   JOIN public.subindustry_search_terms t ON t.subindustry_id = s.id
 *   WHERE t.active AND t.term_type = 'keyword'
 *   ORDER BY s.name, t.weight DESC NULLS LAST, t.term;
 *
 * Cero escrituras. Cero créditos. Cero llamadas a Apollo o Tavily.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

/** Una subindustria del catálogo con sus términos `keyword` activos, en orden de peso. */
export type ApolloSubindustryCatalogSearchTermsEntry = {
  /** UUID de `public.subindustries.id` en Prod. Trazabilidad, no se usa en el emparejamiento. */
  canonicalSubindustryId: string;
  /** Nombre EXACTO de `public.subindustries.name` — igual a `SELLUP_ACTIVE_SUBINDUSTRY_NAMES`. */
  canonicalSubindustry: string;
  /** `term_type = 'keyword'`, `active = true`, orden por `weight DESC`. */
  terms: readonly string[];
};

/**
 * Las 73 subindustrias del catálogo activo, en orden alfabético (igual que
 * `SELLUP_ACTIVE_SUBINDUSTRY_NAMES`).
 */
const APOLLO_SUBINDUSTRY_CATALOG_SEARCH_TERMS: readonly ApolloSubindustryCatalogSearchTermsEntry[] = [
  { canonicalSubindustryId: '52787e3c-6e77-5fb2-b62b-dd999c4df07e', canonicalSubindustry: 'Agritech', terms: ['agricultura de precisión empresa tech'] },
  { canonicalSubindustryId: 'eaefd820-c413-571b-b9ba-2100eed3e49f', canonicalSubindustry: 'Agroindustria y Procesamiento Primario', terms: ['agroexportadora LATAM empresa'] },
  { canonicalSubindustryId: 'abf86c42-cf23-532c-8343-5db4e225b57e', canonicalSubindustry: 'Auditoría, Contabilidad y Advisory Financiero', terms: ['empresa auditora contable LATAM'] },
  { canonicalSubindustryId: '4d764405-cdb7-526e-9468-73fa008bbdc6', canonicalSubindustry: 'Banca Tradicional', terms: ['entidad bancaria regulada', 'corporativo banca empresas'] },
  { canonicalSubindustryId: '9ff59aa5-f2b2-5271-a506-73470ba9a4d2', canonicalSubindustry: 'Bienes de Capital y Maquinaria', terms: ['equipo industrial empresa manufactura'] },
  { canonicalSubindustryId: 'c2ad5ec0-571a-520e-a026-53a0dc75e260', canonicalSubindustry: 'BPO y Contact Center', terms: ['empresa outsourcing procesos LATAM'] },
  { canonicalSubindustryId: '14fdb758-d9d0-56b8-a899-4b2529e87a43', canonicalSubindustry: 'Brokers e Intermediarios de Seguros', terms: ['intermediario de seguros corporativo'] },
  { canonicalSubindustryId: 'c92627a7-95c6-542f-bb35-f88d401e53c4', canonicalSubindustry: 'Cadena de Frío y Logística Farmacéutica', terms: ['almacenamiento temperatura controlada medicamentos'] },
  { canonicalSubindustryId: '3e9f8993-6d08-5206-8f71-d69b9f99a71c', canonicalSubindustry: 'Certificación Profesional B2B', terms: ['proveedor certificaciones tech B2B'] },
  { canonicalSubindustryId: '40a655f2-0c1a-545d-973a-fb357d6b8da9', canonicalSubindustry: 'Ciberseguridad', terms: ['ciberseguridad empresas', 'SOC gestión de seguridad'] },
  { canonicalSubindustryId: 'b43b5ddd-5c4e-5c09-a693-d9b2e3c32ce6', canonicalSubindustry: 'Construcción e Infraestructura', terms: ['empresa construcción infraestructura EPC'] },
  { canonicalSubindustryId: 'd6b54f2b-6de3-55de-b84d-fa894fe5e7a8', canonicalSubindustry: 'Consultoría de Estrategia y Gestión', terms: ['firma de consultoría de gestión LATAM', 'Big 4 consultoría estratégica'] },
  { canonicalSubindustryId: '4668b75d-d69f-50ca-902e-d85767652d79', canonicalSubindustry: 'Cooperativas y Entidades Financieras Solidarias', terms: ['cooperativa de ahorro y crédito'] },
  { canonicalSubindustryId: '7564d31e-3d32-5c3e-b795-81093419f83a', canonicalSubindustry: 'Courier y Mensajería Empresarial', terms: ['última milla B2B empresa'] },
  { canonicalSubindustryId: '24ea07e9-5a06-5236-92a3-b1f677e9e4fb', canonicalSubindustry: 'CRO e Investigación Clínica', terms: ['organización de investigación clínica'] },
  { canonicalSubindustryId: '228440c9-a8d7-51b9-96cd-47bac896b0cf', canonicalSubindustry: 'Cuidado Personal, Higiene y Hogar (FMCG)', terms: ['FMCG cuidado personal LATAM'] },
  { canonicalSubindustryId: 'a23eabe9-1ec6-5fd3-a34f-8d5a4573536f', canonicalSubindustry: 'Data Analytics y Business Intelligence', terms: ['analítica de datos plataforma B2B', 'data warehouse empresa'] },
  { canonicalSubindustryId: '33236dc9-8af2-542f-b88b-06b1584a01f9', canonicalSubindustry: 'Dispositivos Médicos y MedTech', terms: ['medtech empresa LATAM', 'equipamiento hospitalario distribuidor'] },
  { canonicalSubindustryId: 'c08be8e0-c6a9-5988-8a00-6fc666146f06', canonicalSubindustry: 'Distribuidores Farmacéuticos', terms: ['cadena distribución medicamentos'] },
  { canonicalSubindustryId: '87a07024-5d94-55fe-b122-7137ad3c9a12', canonicalSubindustry: 'Ecommerce Enablement', terms: ['plataforma e-commerce B2B', 'comercio electrónico empresa proveedora'] },
  { canonicalSubindustryId: '40cfe3da-ee54-59bf-b8c3-2b4f3e9a37ff', canonicalSubindustry: 'Edtech: Plataformas de Aprendizaje', terms: ['plataforma LMS empresa tecnológica', 'e-learning plataforma B2B'] },
  { canonicalSubindustryId: '87b9e0c7-0d17-5400-93e8-b62906fedf6a', canonicalSubindustry: 'Energía, Minería y Servicios Industriales', terms: ['oil gas empresa LATAM', 'energías renovables empresa operadora'] },
  { canonicalSubindustryId: '975b1e2b-cd1f-59be-a00a-645de8d6ec34', canonicalSubindustry: 'Equipamiento y Suministros Hospitalarios', terms: ['proveedor equipos médicos hospital'] },
  { canonicalSubindustryId: '0f8a58ca-4ff5-5c96-8856-15ec3b74d50c', canonicalSubindustry: 'Escuelas de Negocios y Formación Ejecutiva', terms: ['MBA ejecutivo LATAM', 'formación ejecutiva liderazgo empresa'] },
  { canonicalSubindustryId: '2b2ead23-b436-5b62-910e-997995ad2cd2', canonicalSubindustry: 'Fabricantes de Alimentos y Bebidas (FMCG)', terms: ['empresa FMCG consumo masivo LATAM', 'CPG food beverage empresa'] },
  { canonicalSubindustryId: 'fe8187a9-9e99-5f85-bf36-a1de8c0ec0c4', canonicalSubindustry: 'Facilities, Aseo Industrial y Seguridad Privada', terms: ['vigilancia seguridad privada empresa'] },
  { canonicalSubindustryId: 'c4291ea6-67e1-52ff-ae79-5a67939cf448', canonicalSubindustry: 'Factoring, Leasing y Crédito Empresarial', terms: ['leasing empresarial financiero', 'crédito empresarial no bancario'] },
  { canonicalSubindustryId: 'd49ba019-c2e4-59b5-bc58-12724ec1f152', canonicalSubindustry: 'Farmacias Cadena y Retail de Salud', terms: ['droguerías cadena retail farmacia'] },
  { canonicalSubindustryId: 'c81af5fd-147f-5525-b9e5-906230842846', canonicalSubindustry: 'Fintech B2B: Servicios Financieros', terms: ['neobank empresa finanzas', 'open banking empresa operadora'] },
  { canonicalSubindustryId: '3fc7bafb-654b-5b0a-853e-8c8d0b302c99', canonicalSubindustry: 'Fintech: Infraestructura y Pagos', terms: ['plataforma de pagos digitales', 'infraestructura de pagos B2B', 'wallet digital empresa tecnológica'] },
  { canonicalSubindustryId: '87822a25-bfed-5194-8931-b80e2898ea79', canonicalSubindustry: 'Fondos de Inversión y Gestión de Activos', terms: ['asset management empresa LATAM'] },
  { canonicalSubindustryId: '2b631bf6-425d-53ce-8f9d-d156713df570', canonicalSubindustry: 'Formación Corporativa y Corporate Training', terms: ['formación in-company B2B', 'proveedor training empresas'] },
  { canonicalSubindustryId: 'adcfeed3-fc65-5c45-bf66-7910446075ca', canonicalSubindustry: 'Freight Forwarders y Agencias de Aduana', terms: ['agente de carga internacional LATAM'] },
  { canonicalSubindustryId: '0155eef1-a6d1-5cfc-8d8a-05ce8bec9828', canonicalSubindustry: 'Govtech y Ciudades Inteligentes', terms: ['gobierno digital empresa', 'ciudad inteligente smart city B2B'] },
  { canonicalSubindustryId: '8efb5b7b-4790-570d-ade7-a44effcd5a49', canonicalSubindustry: 'Grupos Educativos Multi-sede', terms: ['holding educativo LATAM'] },
  { canonicalSubindustryId: '37fdfe1f-b082-5aa2-9269-5adcbbcf1108', canonicalSubindustry: 'Healthtech B2B', terms: ['health tech empresa B2B', 'salud digital plataforma', 'telemedicina B2B empresa tecnológica'] },
  { canonicalSubindustryId: '2edbb8fe-8d78-5a3f-a0bb-55ec9b1303db', canonicalSubindustry: 'HRtech y Gestión del Talento', terms: ['software de recursos humanos', 'plataforma de gestión del talento', 'nómina digital LATAM'] },
  { canonicalSubindustryId: 'f3cc3f97-f1ca-57ec-b407-3fb0cca4c843', canonicalSubindustry: 'Infraestructura Cloud y DevOps', terms: ['cloud computing empresas', 'proveedor cloud LATAM', 'cloud hosting B2B'] },
  { canonicalSubindustryId: 'c7cd8535-8714-58ba-ad16-2d157102cb48', canonicalSubindustry: 'Institutos Técnicos y Vocacionales', terms: ['formación técnica profesional LATAM', 'SENA OTEC SENATI CONALEP'] },
  { canonicalSubindustryId: 'f286731d-fa78-507c-932c-b028ff6f00d7', canonicalSubindustry: 'Insurtech', terms: ['tecnología de seguros B2B'] },
  { canonicalSubindustryId: '81203ac3-a280-5d00-97b1-330f429c8495', canonicalSubindustry: 'Inteligencia Artificial y Machine Learning', terms: ['inteligencia artificial empresa B2B', 'IA generativa B2B'] },
  { canonicalSubindustryId: '6c83d574-3ca3-5579-bf8e-9c450c4f43c7', canonicalSubindustry: 'Investigación de Mercados e Inteligencia Comercial', terms: ['market research inteligencia de negocios'] },
  { canonicalSubindustryId: '1b885eed-5d52-5c0b-be1f-a79797d1e7a9', canonicalSubindustry: 'IoT y Hardware Conectado', terms: ['hardware conectado empresa tecnológica'] },
  { canonicalSubindustryId: '431a0c19-885d-5f59-ae46-a4e22f7e9486', canonicalSubindustry: 'Laboratorios Clínicos y Diagnóstico', terms: ['red de laboratorios clínicos'] },
  { canonicalSubindustryId: '8515cd86-1a51-577b-b71c-b4907d56ce1f', canonicalSubindustry: 'Laboratorios Farmacéuticos', terms: ['pharma empresa LATAM'] },
  { canonicalSubindustryId: '014296cc-98e4-5433-bc2f-bbcbcadbf252', canonicalSubindustry: 'Legaltech', terms: ['firma electrónica B2B', 'contratos inteligentes empresa tech'] },
  { canonicalSubindustryId: 'e729fcea-2082-55b8-a945-8ed65adac821', canonicalSubindustry: 'Logística para Minería y Energía', terms: ['transporte especializado industria extractiva'] },
  { canonicalSubindustryId: '9158a6ee-d7ce-524b-a7e9-dc24f3269f92', canonicalSubindustry: 'Manufactura Exportadora y Zona Franca', terms: ['maquiladora exportación LATAM'] },
  { canonicalSubindustryId: '1a00c933-fc42-5767-bc47-dd0f9be5c9fd', canonicalSubindustry: 'Marketing Technology y Sales Tech', terms: ['marketing automation empresa', 'plataforma de automatización de marketing'] },
  { canonicalSubindustryId: '2bffda5f-45f2-5a36-84e5-5038562c6916', canonicalSubindustry: 'Medicina Prepagada y EPS', terms: ['plan de salud corporativo'] },
  { canonicalSubindustryId: '76d05169-addd-50f4-b0ef-67e6a0b07fc5', canonicalSubindustry: 'Metalmecánica y Autopartes', terms: ['fabricante autopartes LATAM', 'acería siderurgia manufactura metal'] },
  { canonicalSubindustryId: '5a217eb2-0a0e-5a74-b131-e7a34ebe3cb5', canonicalSubindustry: 'Operadores Logísticos 3PL y 4PL', terms: ['proveedor logística B2B LATAM'] },
  { canonicalSubindustryId: '8f893965-daf2-508f-95c7-bbc332595f3e', canonicalSubindustry: 'Operadores Omnicanal y Ecommerce Retail', terms: ['retail omnichannel ecommerce físico'] },
  { canonicalSubindustryId: 'ae3d1714-e36a-549c-986e-fc53ffa63d80', canonicalSubindustry: 'Operadores Portuarios y Aeroportuarios de Carga', terms: ['terminal portuaria empresa logística'] },
  { canonicalSubindustryId: 'bdce83c0-9d1f-58a8-82de-7289c676ab0a', canonicalSubindustry: 'Proptech e Inmobiliaria Digital', terms: ['plataforma inmobiliaria digital'] },
  { canonicalSubindustryId: 'ec013b35-657a-5a4d-b500-477222d724bc', canonicalSubindustry: 'QA, Testing y Automatización (RPA)', terms: ['RPA automatización de procesos', 'testing automatizado empresa B2B'] },
  { canonicalSubindustryId: '55386a47-3bec-510a-91c6-ba61341f5676', canonicalSubindustry: 'Químicos, Plásticos y Packaging Industrial', terms: ['fabricante packaging embalajes'] },
  { canonicalSubindustryId: '041e7562-9bac-596f-a8a2-346f390c0fe8', canonicalSubindustry: 'Redes Hospitalarias y Clínicas', terms: ['grupo hospitalario clínicas'] },
  { canonicalSubindustryId: '9d036663-b424-5989-9bfc-02c85b0c25c8', canonicalSubindustry: 'Retailers Especializados', terms: ['cadena electrodomésticos ferretería materiales'] },
  { canonicalSubindustryId: 'df0765ed-3842-5b2e-a320-b0cee73b11d4', canonicalSubindustry: 'Salud Ocupacional y Medicina Laboral', terms: ['medicina del trabajo empresa', 'SST seguridad salud trabajo empresa'] },
  { canonicalSubindustryId: 'b9c5711c-21fa-51f9-8aca-30d12a012dd9', canonicalSubindustry: 'Seguros de Vida y Personas', terms: ['seguro de vida corporativo grupal'] },
  { canonicalSubindustryId: '968f71cb-1483-538b-83e2-6eaaf6467dcf', canonicalSubindustry: 'Seguros Generales', terms: ['compañía de seguros P&C'] },
  { canonicalSubindustryId: 'dd4c52eb-81ec-5de5-97f3-6ab745bbae7c', canonicalSubindustry: 'Servicios Legales y Compliance', terms: ['estudio jurídico compliance corporativo'] },
  { canonicalSubindustryId: '3107711d-2a6c-557e-9fd2-4f49e16df9e2', canonicalSubindustry: 'Software Empresarial (SaaS / ERP / CRM)', terms: ['SaaS B2B', 'software empresarial', 'ERP LATAM', 'plataforma de gestión empresarial'] },
  { canonicalSubindustryId: 'b684211e-413a-54d3-8989-a8139e2c1285', canonicalSubindustry: 'Software Factory y Nearshore', terms: ['nearshore development LATAM', 'staff augmentation empresa tecnológica'] },
  { canonicalSubindustryId: '0e890f25-655c-5061-b354-f86c3ab29062', canonicalSubindustry: 'Staffing y Servicios Temporales', terms: ['outsourcing nómina personal empresa'] },
  { canonicalSubindustryId: 'e2c051f9-8e52-5218-9542-dbe8c8cbc28d', canonicalSubindustry: 'Supermercados e Hipermercados', terms: ['hipermercado hard discount retail'] },
  { canonicalSubindustryId: '7d2ce6cb-2dbd-5c46-93dc-502241887d69', canonicalSubindustry: 'Telco y Comunicaciones', terms: ['telecomunicaciones empresa operadora', 'CPaaS comunicaciones en la nube B2B'] },
  { canonicalSubindustryId: '912a4b36-8597-5204-bb8e-814fb0769505', canonicalSubindustry: 'Tiendas por Departamento, Moda y Calzado', terms: ['cadena moda retail fashion'] },
  { canonicalSubindustryId: '695bf6e7-c121-5bc5-940a-5def8d79f523', canonicalSubindustry: 'Transporte de Carga Terrestre', terms: ['flota de camiones empresa transporte'] },
  { canonicalSubindustryId: '1779cc43-079d-5a5f-9e15-902f3cdbabae', canonicalSubindustry: 'Universidades e Institutos Privados', terms: ['instituto de educación superior privado'] },
  { canonicalSubindustryId: 'a4db23d2-6d94-5463-a171-fbee80028206', canonicalSubindustry: 'Universidades Públicas con Capacidad de Compra', terms: ['universidad nacional autónoma'] },
  { canonicalSubindustryId: '2effb010-8309-5e97-92dd-3b50a5400de6', canonicalSubindustry: 'Warehousing y Fulfillment B2B', terms: ['bodegaje almacenamiento empresarial LATAM'] },
];

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Todas las entradas del snapshot. Sólo lectura — para auditoría (§ 6) y para
 * regenerar el snapshot si el catálogo publicado cambia.
 */
export function listApolloSubindustryCatalogSearchTerms(): ApolloSubindustryCatalogSearchTermsEntry[] {
  return APOLLO_SUBINDUSTRY_CATALOG_SEARCH_TERMS.map((entry) => ({
    ...entry,
    terms: [...entry.terms],
  }));
}

/**
 * Términos de catálogo para UNA subindustria, o `null` si el nombre no es
 * EXACTAMENTE uno de los 73 nombres canónicos.
 *
 * Emparejamiento por IGUALDAD, no por substring: el wizard envía el nombre
 * canónico completo (viene de un selector cerrado sobre las 73), así que no hace
 * falta —y sería peligroso— la tolerancia a alias parciales que sí necesita
 * `apollo-subindustry-search-mapping` (ese catálogo nombra sinónimos libres; este
 * nombra filas de una tabla). Igualdad exacta también evita que este catálogo
 * termine emparejando por accidente con alguna de las claves libres de
 * `SUBINDUSTRY_KEYWORD_MAP` (p. ej. `'Educación Corporativa'`, que NO es uno de los
 * 73 nombres canónicos —el canónico es `'Formación Corporativa y Corporate
 * Training'`— y debe seguir cayendo en el mapa histórico exactamente como antes).
 */
export function resolveApolloSubindustryCatalogSearchTerms(
  subindustry: string | null | undefined,
): { canonicalSubindustryId: string; canonicalSubindustry: string; terms: string[] } | null {
  if (!subindustry?.trim()) return null;
  const normalized = normalizeKey(subindustry);
  if (normalized === '') return null;

  for (const entry of APOLLO_SUBINDUSTRY_CATALOG_SEARCH_TERMS) {
    if (normalizeKey(entry.canonicalSubindustry) === normalized) {
      return {
        canonicalSubindustryId: entry.canonicalSubindustryId,
        canonicalSubindustry: entry.canonicalSubindustry,
        terms: [...entry.terms],
      };
    }
  }
  return null;
}
