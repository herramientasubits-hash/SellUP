/**
 * Prospecting Toolkit — Query Builder (Hito 7C, actualizado Hito 16Y.2)
 *
 * Construye queries optimizadas para discovery de empresas reales.
 * Evita "B2B software" salvo en sectores tech/TIC.
 * Sin llamadas externas. Lógica completamente determinística.
 *
 * Hito 10B: añadidas exclusiones para Facebook, DataCrédito directorio y
 * PáginasAmarillas Colombia. Query tech usa slice(0, 5) en lugar de slice(0, 4).
 * Hito 16L: INDUSTRY_QUERY_STRATEGIES para Manufactura. Queries específicas
 * por país (Colombia, México) y fallback genérico. Tech sin cambios.
 * Hito 16Y.2: source-guided queries para Colombia/Tecnología. Ronda 1 mezcla
 * 3 subcluster + 2 site:-guided (fedesoft, colombiafintech). Ronda 2 mezcla
 * 3 ciudad+subindustria + 2 site:-guided (andicom, rutanmedellin).
 * Opción B interna — URLs derivadas del catálogo, pendiente integración directa.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CompanyDiscoveryQueryOptions = {
  industry: string;
  country: string;
  countryCode?: string | null;
  intent?: 'general' | 'linkedin' | 'website';
  catalogSourceUrls?: Array<string | null | undefined>;
};

export type SourceGuidedQueryMeta = {
  enabled: boolean;
  sources_used: string[];
};

// ─── Source-guided queries Colombia / Tecnología (Hito 16Y.2) ────────────────
// Opción B: mapa interno. URLs derivadas del catálogo (source-catalog.ts).
// Pendiente integración directa desde catalog-context-retriever en rondas futuras.

/** Ronda 1 — mix con buildCleanMultiQueryDiscoveryQueries */
const SOURCE_GUIDED_QUERIES_CO_TECH_R1 = [
  'site:fedesoft.org empresas software Colombia miembros',
  'site:colombiafintech.co fintech Colombia empresas miembros pagos',
] as const;

const SOURCE_GUIDED_KEYS_CO_TECH_R1 = ['co_fedesoft', 'co_colombia_fintech'] as const;

/** Ronda 2 — mix con buildExpandedMultiQueryDiscoveryQueries */
const SOURCE_GUIDED_QUERIES_CO_TECH_R2 = [
  'site:andicom.co expositores empresas tecnología Colombia software',
  'site:rutanmedellin.org startups tecnología Medellín software empresas',
] as const;

const SOURCE_GUIDED_KEYS_CO_TECH_R2 = ['co_andicom', 'co_ruta_n'] as const;

// ─── Sectores tech (permiten términos de software en la query) ─────────────────

const TECH_SECTOR_KEYWORDS = [
  'tecnología', 'tecnologia', 'technology', 'tech',
  'software', 'tic', ' ti ', ' it ', 'digital',
  'informática', 'informatica', 'sistemas', 'desarrollo',
  'saas', 'datos', 'data', 'ciberseguridad', 'cybersecurity',
  'ecommerce', 'e-commerce', 'fintech',
];

function isTechSector(industry: string): boolean {
  const lower = ` ${industry.toLowerCase()} `;
  return TECH_SECTOR_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Detección manufactura ────────────────────────────────────────────────────

const MANUFACTURING_SECTOR_KEYWORDS = [
  'manufactur', 'manufacturing', 'maquiladora', 'maquila',
];

function isManufacturingSector(industry: string): boolean {
  const lower = industry.toLowerCase();
  return MANUFACTURING_SECTOR_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Estrategias de query por industria (Hito 16L) ───────────────────────────

type IndustryQueryStrategy = {
  countryOverrides: Record<string, string[]>;
  genericFallback: (country: string) => string[];
};

const INDUSTRY_QUERY_STRATEGIES: Record<string, IndustryQueryStrategy> = {
  manufactura: {
    countryOverrides: {
      colombia: [
        'empresa fabricante Colombia planta producción contacto nosotros',
        'empresa metalmecánica Colombia manufactura fábrica corporativo',
        'empresa empaques plásticos Colombia fabricante producción',
        'empresa textil confección Colombia planta manufactura',
        'empresa alimentos Colombia fábrica producción certificaciones',
      ],
      mexico: [
        'empresa fabricante México planta producción nosotros contacto',
        'empresa maquiladora México manufactura fábrica contacto',
        'empresa metalmecánica México Monterrey fabricante industrial',
        'empresa autopartes México Querétaro planta manufactura',
        'empresa plásticos empaques México fábrica producción corporativo',
        'empresa alimentos bebidas México planta producción fábrica contacto',
        'empresa química farmacéutica México planta manufactura industrial',
        'empresa electrónica electrodomésticos México Tijuana Juárez manufactura',
        'empresa textil confección México planta producción corporativo',
        'empresa papel cartón envases México fábrica producción nosotros',
      ],
    },
    genericFallback: (country: string) => [
      `empresa fabricante ${country} planta producción contacto`,
      `empresa metalmecánica ${country} fabricante industrial`,
      `empresa empaques plásticos ${country} fábrica manufactura`,
      `empresa textil confección ${country} planta producción`,
      `empresa alimentos ${country} fábrica producción`,
    ],
  },
};

/**
 * Normaliza un string quitando acentos y convirtiendo a minúsculas.
 * Permite buscar "México" → "mexico", "Colombia" → "colombia".
 */
function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Resuelve queries específicas por industria y país.
 * Devuelve null si no hay estrategia definida para esa industria.
 */
function resolveIndustrySpecificQueries(industry: string, country: string): string[] | null {
  let strategyKey: string | null = null;

  if (isManufacturingSector(industry)) {
    strategyKey = 'manufactura';
  }

  if (!strategyKey) return null;

  const strategy = INDUSTRY_QUERY_STRATEGIES[strategyKey];
  const countryKey = normalizeKey(country);
  return strategy.countryOverrides[countryKey] ?? strategy.genericFallback(country);
}

// ─── Términos de sector por industria ────────────────────────────────────────

type SectorTerms = {
  primary: string[];
  secondary: string[];
};

function getSectorTerms(industry: string): SectorTerms {
  const lower = industry.toLowerCase();

  if (
    lower.includes('textil') || lower.includes('textile') ||
    lower.includes('confeccion') || lower.includes('moda') ||
    lower.includes('garment') || lower.includes('apparel') ||
    lower.includes('vestido') || lower.includes('clothing')
  ) {
    return {
      primary: ['industria textil', 'empresas textiles', 'manufacturas textiles'],
      secondary: ['confección', 'moda', 'fabricantes textiles', 'sector textil'],
    };
  }

  if (
    lower.includes('salud') || lower.includes('health') ||
    lower.includes('clinica') || lower.includes('clínica') ||
    lower.includes('hospital') || lower.includes('farmaceu') ||
    lower.includes('medic') || lower.includes('ips') || lower.includes('eps')
  ) {
    return {
      primary: ['sector salud', 'empresas sector salud'],
      secondary: ['clínicas', 'laboratorios', 'prestadores salud', 'hospitales'],
    };
  }

  if (
    lower.includes('financiero') || lower.includes('financial') ||
    lower.includes('banca') || lower.includes('banco') ||
    lower.includes('seguros') || lower.includes('fintech') ||
    lower.includes('aseguradora')
  ) {
    return {
      primary: ['sector financiero', 'empresas financieras'],
      secondary: ['bancos', 'aseguradoras', 'instituciones financieras'],
    };
  }

  if (
    lower.includes('automotri') || lower.includes('automotive') ||
    lower.includes('autopart')
  ) {
    return {
      primary: ['industria automotriz', 'empresas automotrices'],
      secondary: ['autopartes', 'fabricantes automotriz', 'proveedores automotriz'],
    };
  }

  if (
    lower.includes('manufactur') || lower.includes('manufactu') ||
    (lower.includes('industrial') && !lower.includes('financi'))
  ) {
    return {
      primary: ['industria manufacturera', 'empresas manufactureras'],
      secondary: ['fabricantes', 'planta industrial', 'sector manufactura'],
    };
  }

  if (
    lower.includes('agr') || lower.includes('alimento') || lower.includes('food') ||
    lower.includes('agropec') || lower.includes('agroindustri')
  ) {
    return {
      primary: ['sector agropecuario', 'empresas agroindustriales'],
      secondary: ['agroalimentos', 'industria alimentaria', 'empresas agro'],
    };
  }

  if (
    lower.includes('construccion') || lower.includes('construcción') ||
    lower.includes('inmobiliaria') || lower.includes('real estate')
  ) {
    return {
      primary: ['sector construcción', 'empresas constructoras'],
      secondary: ['inmobiliarias', 'constructoras', 'desarrolladoras'],
    };
  }

  if (
    lower.includes('logística') || lower.includes('logistica') ||
    lower.includes('transporte') || lower.includes('transport') ||
    lower.includes('distribuc')
  ) {
    return {
      primary: ['sector logística', 'empresas transporte y logística'],
      secondary: ['distribución', 'carga', 'operadores logísticos'],
    };
  }

  if (
    lower.includes('educaci') || lower.includes('education') ||
    lower.includes('formaci') || lower.includes('capacitaci')
  ) {
    return {
      primary: ['sector educativo', 'instituciones educativas'],
      secondary: ['universidades', 'colegios', 'capacitación empresarial'],
    };
  }

  if (
    lower.includes('retail') || lower.includes('comercio') ||
    lower.includes('minorista')
  ) {
    return {
      primary: ['sector comercio', 'empresas retail'],
      secondary: ['comercio minorista', 'distribuidores', 'cadenas comerciales'],
    };
  }

  // Default genérico: usar el nombre de la industria directamente
  return {
    primary: [`empresas ${industry}`, `sector ${industry}`],
    secondary: ['empresa', 'compañía', 'corporativo'],
  };
}

// ─── Dominios de exclusión para operadores -site: ────────────────────────────

export function buildNoiseExclusionTerms(): string[] {
  // Orden: los más impactantes primero (los primeros N se usan en queries cortas).
  // Hito 10B: facebook.com, datacreditoempresas.com.co y paginasamarillas.com.co añadidos.
  return [
    '-site:computrabajo.com',
    '-site:indeed.com',
    '-site:glassdoor.com',
    '-site:facebook.com',                    // Hito 10B: redes sociales
    '-site:comparasoftware.com',
    '-site:datacreditoempresas.com.co',       // Hito 10B: directorio DataCrédito
    '-site:paginasamarillas.com.co',          // Hito 10B: directorio PáginasAmarillas CO
    '-site:capterra.com',
    '-site:g2.com',
    '-site:crunchbase.com',
    '-site:f6s.com',
    '-site:ensun.io',
    '-site:linkedin.com/posts',
    '-site:guiatic.com',
    '-site:getapp.com',
    '-site:cintel.co',
    '-site:tic-col.net',
    '-site:impactotic.co',
    '-site:sciencedirect.com',
    '-filetype:pdf',
  ];
}

// ─── Query builder principal ──────────────────────────────────────────────────

/**
 * Genera la query principal de búsqueda para discovery de empresas reales.
 * Distingue sectores tech (donde "software" es relevante) de otros sectores.
 * Incluye exclusiones -site: para reducir ruido en la búsqueda.
 */
export function buildCompanyDiscoveryQuery(opts: CompanyDiscoveryQueryOptions): string {
  const { industry, country, intent = 'general' } = opts;

  switch (intent) {
    case 'linkedin':
      return `site:linkedin.com/company ${industry} ${country} empresa`;

    case 'website':
      return buildWebsiteDiscoveryQuery(industry, country);

    default:
      return buildGeneralDiscoveryQuery(industry, country);
  }
}

function buildGeneralDiscoveryQuery(industry: string, country: string): string {
  const sectorTerms = getSectorTerms(industry);
  const isTech = isTechSector(industry);

  if (isTech) {
    // Tech: 5 exclusiones (incluye facebook.com y datacreditoempresas.com.co de Hito 10B)
    const exclusions = buildNoiseExclusionTerms().slice(0, 5).join(' ');
    return `empresas ${industry} ${country} servicios soluciones contacto ${exclusions}`.trim();
  }

  // No-tech: 4 exclusiones compactas
  const exclusions = buildNoiseExclusionTerms().slice(0, 4).join(' ');
  const primaryTerm = sectorTerms.primary[0];
  return `${primaryTerm} ${country} empresa corporativo ${exclusions}`.trim();
}

/**
 * Hito 9 Part B: Generate 5 query variants optimized for finding concrete,
 * prospectable companies rather than sector sources, associations, or directories.
 *
 * Each variant uses different linguistic angles to attract company websites:
 * - Variant 1: Services/solutions language (operational)
 * - Variant 2: Company contact/engagement language
 * - Variant 3: Regional domain hints + exclude directories
 * - Variant 4: Structure/site pattern matching
 * - Variant 5: Corporate identity language
 */
export function buildProspectableCompanyDiscoveryQueries(
  industry: string,
  country: string,
): string[] {
  const exclusions = buildNoiseExclusionTerms();
  // Use targeted exclusions without -filetype:pdf (not supported by all providers)
  const siteExclusions = exclusions.filter((e) => e.startsWith('-site:')).slice(0, 5).join(' ');

  return [
    // Variante 1: Lenguaje de servicios/contacto → atrae sitios corporativos operacionales
    `empresas de ${industry} ${country} servicios tecnología contacto ${siteExclusions}`.trim(),

    // Variante 2: Lenguaje de desarrollo/soluciones → evita portales sectoriales
    `empresas desarrollo de ${industry} ${country} soluciones nosotros ${siteExclusions}`.trim(),

    // Variante 3: Consultoras IT → ángulo de servicios IT concreto
    `consultoras ${industry} ${country} servicios IT empresas -site:crunchbase.com -site:g2.com -site:capterra.com`.trim(),

    // Variante 4: SaaS/soluciones empresariales → atrae empresas de producto
    `empresas SaaS ${country} ${industry} soluciones empresariales -site:comparasoftware.com -site:capterra.com`.trim(),

    // Variante 5: Dominio regional + identidad corporativa
    `empresa ${industry} ${country} corporativo sitio web soluciones -site:cintel.co -site:tic-col.net -site:impactotic.co`.trim(),
  ];
}

/**
 * Hito 12B: Queries de intención limpia sin operadores -site: para uso en
 * multi-query con pocos resultados por query (maxResultsPerQuery ≤ 5).
 * El noise filter actúa como defensa primaria contra directorios y ruido.
 */
export function buildCleanMultiQueryDiscoveryQueries(
  industry: string,
  country: string,
): string[] {
  const isTech = isTechSector(industry);

  if (isTech) {
    // Hito 16V.1 + 16Y.2: Colombia usa 3 subcluster + 2 source-guided (Ronda 1).
    if (normalizeKey(country) === 'colombia') {
      return [
        'empresa fintech pagos Colombia clientes corporativos soluciones',
        'empresa software gestión RRHH nómina Colombia pymes corporativo',
        'empresa ciberseguridad Colombia protección datos empresas contacto',
        ...SOURCE_GUIDED_QUERIES_CO_TECH_R1,
      ];
    }
    // Queries validadas en Hito 13D con Tavily basic mode (otros países/Tecnología).
    // Q3 y Q5 reemplazan "consultoría TI" y "SaaS" que devolvían 0 resultados (Hito 13C).
    return [
      `empresa desarrollo software ${country} servicios contacto`,
      `empresa tecnología ${country} soluciones empresariales contacto`,
      `empresa servicios tecnológicos ${country} clientes soluciones`,
      `empresa software ${country} nosotros servicios`,
      `empresa TI ${country} outsourcing software clientes`,
    ];
  }

  // Hito 16L: estrategia específica por industria antes del fallback genérico.
  const industrySpecific = resolveIndustrySpecificQueries(industry, country);
  if (industrySpecific) return industrySpecific;

  const sectorTerms = getSectorTerms(industry);
  const primary = sectorTerms.primary[0] ?? `empresas ${industry}`;
  const secondary = sectorTerms.secondary[0] ?? industry;

  return [
    `${primary} ${country} servicios contacto nosotros`,
    `empresas ${industry} ${country} corporativo soluciones contacto`,
    `${secondary} ${country} empresa servicios`,
    `compañías ${industry} ${country} soluciones contacto`,
    `${primary} ${country} empresa corporativo`,
  ];
}

function buildWebsiteDiscoveryQuery(industry: string, country: string): string {
  const sectorTerms = getSectorTerms(industry);
  const primaryTerm = sectorTerms.primary[0];
  return `${primaryTerm} ${country} sitio web contacto empresa`;
}

// ─── Expanded queries para búsqueda incremental (Hito 16T.1) ─────────────────

/**
 * Queries alternativas para ronda 2 de búsqueda incremental.
 * Complementan a buildCleanMultiQueryDiscoveryQueries con ángulos distintos.
 * Sin exclusiones -site: para maximizar cobertura en ronda de expansión.
 *
 * Hito 16T.1: primera versión para Colombia/Tecnología con fallback genérico.
 */
export function buildExpandedMultiQueryDiscoveryQueries(
  industry: string,
  country: string,
  _options?: Record<string, unknown>,
): string[] {
  const countryKey = normalizeKey(country);

  // Hito 16V.1 + 16Y.2: Colombia/Tech usa 3 ciudad+subindustria + 2 source-guided (Ronda 2).
  if (isTechSector(industry) && countryKey === 'colombia') {
    return [
      'empresa desarrollo software Medellín nearshore clientes internacionales',
      'empresa software Cali soluciones empresariales clientes nosotros',
      'empresa cloud infraestructura Colombia servicios TI corporativo',
      ...SOURCE_GUIDED_QUERIES_CO_TECH_R2,
    ];
  }

  if (isTechSector(industry)) {
    return [
      `empresa software empresarial ${country} soluciones corporativas contacto`,
      `proveedor SaaS B2B ${country} clientes empresas nosotros`,
      `empresa automatización procesos ${country} ERP implementación`,
      `compañía consultoría TI ${country} transformación digital`,
      `empresa desarrollo aplicaciones ${country} clientes corporativos`,
    ];
  }

  // Fallback genérico para sectores no-tech
  const sectorTerms = getSectorTerms(industry);
  const primary = sectorTerms.primary[0] ?? `empresas ${industry}`;
  return [
    `${primary} ${country} empresas proveedores nosotros contacto`,
    `empresas ${industry} ${country} servicios especializados contacto`,
    `compañías ${industry} ${country} líderes del sector nosotros`,
    `${industry} empresas ${country} corporativo soluciones`,
    `proveedores ${industry} ${country} empresas contacto corporativo`,
  ];
}

// ─── API pública: source-guided queries ──────────────────────────────────────

/**
 * Retorna metadata sobre queries guiadas por fuentes para un país/industria.
 * Usado por el pipeline para enriquecer metadata sin llamadas externas.
 */
export function getSourceGuidedQueryMeta(
  country: string,
  industry: string,
  round: 1 | 2 = 1,
): SourceGuidedQueryMeta {
  if (isTechSector(industry) && normalizeKey(country) === 'colombia') {
    return {
      enabled: true,
      sources_used: round === 1
        ? [...SOURCE_GUIDED_KEYS_CO_TECH_R1]
        : [...SOURCE_GUIDED_KEYS_CO_TECH_R2],
    };
  }
  return { enabled: false, sources_used: [] };
}

/**
 * Genera queries guiadas por fuentes de catálogo para un país/industria.
 * MVP soporta Colombia/Tecnología; fallback: array vacío.
 * No reemplaza las queries estándar — se integra mediante mix en el query-builder.
 */
export function buildSourceGuidedDiscoveryQueries(
  country: string,
  industry: string,
  _sources?: string[],
  options?: { round?: 1 | 2; maxQueries?: number },
): string[] {
  const round = options?.round ?? 1;
  const maxQueries = options?.maxQueries ?? 2;

  if (isTechSector(industry) && normalizeKey(country) === 'colombia') {
    const pool = round === 1
      ? [...SOURCE_GUIDED_QUERIES_CO_TECH_R1]
      : [...SOURCE_GUIDED_QUERIES_CO_TECH_R2];
    return pool.slice(0, maxQueries);
  }
  return [];
}

/**
 * Genera múltiples queries candidatas para un contexto de búsqueda.
 * Permite ejecutar búsquedas paralelas y combinar resultados.
 */
export function buildSectorSpecificSearchTerms(opts: {
  industry: string;
  country: string;
  countryCode?: string | null;
  catalogSourceUrls?: Array<string | null | undefined>;
}): string[] {
  const { industry, country, catalogSourceUrls = [] } = opts;
  const sectorTerms = getSectorTerms(industry);
  const isTech = isTechSector(industry);
  const queries: string[] = [];

  // Query 1: general optimizada (sin ruido)
  queries.push(buildCompanyDiscoveryQuery({ industry, country, intent: 'general' }));

  // Query 2: sinónimos de sector
  if (sectorTerms.secondary.length > 0) {
    const secondaryTerm = sectorTerms.secondary[0];
    queries.push(`${secondaryTerm} ${country} empresa oficial sector`);
  }

  // Query 3: basada en URL de fuente oficial del catálogo
  const validUrls = catalogSourceUrls.filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  if (validUrls.length > 0) {
    try {
      const sourceHost = new URL(validUrls[0]).hostname;
      queries.push(`site:${sourceHost} ${industry} ${country}`);
    } catch {
      // URL inválida — ignorar
    }
  }

  // Query 4: tech-specific si aplica
  if (isTech) {
    queries.push(`empresas software ${country} directorio gremio cámara sector`);
  }

  return queries.filter((q) => q.trim().length > 0);
}
