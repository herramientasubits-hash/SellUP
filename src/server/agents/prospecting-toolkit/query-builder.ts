import type { SearchQueryType } from './types';

/**
 * Prospecting Toolkit — Query Builder (Hito 7C, actualizado Hito 16Z.2)
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
 * 3 subcluster + 2 source-guided. Ronda 2 mezcla 3 ciudad+subindustria + 2 source-guided.
 * Hito 16Y.3: queries source-guided cambiadas de site: a señal-sin-site para evitar
 * que la fuente misma aparezca como candidato. pre-llm-result-filter bloquea los
 * dominios fuente como guardrail adicional.
 * Hito 16Z.1: R2 usa ANDICOM + SECOP II como señales source-guided para ampliar
 * universo con proveedores tecnológicos B2G. Ruta N (Medellín-céntrico) reemplazada
 * por SECOP II (cobertura nacional). secop.gov.co ya bloqueado por check .gov.co.
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

// Hito 16Y.3: queries sin site: para evitar que la fuente misma aparezca como candidato.
// Las fuentes (Fedesoft, Colombia Fintech, ANDICOM, Ruta N) actúan como señales de contexto
// — indican dónde buscar, no qué empresa devolver. El pre-llm-result-filter bloquea
// cualquier dominio de fuente que escape como guardrail adicional.

/** Ronda 1 — mix con buildCleanMultiQueryDiscoveryQueries */
const SOURCE_GUIDED_QUERIES_CO_TECH_R1 = [
  'empresas miembros Fedesoft software Colombia sitio oficial corporativo',
  'fintech asociadas Colombia Fintech pagos Colombia empresa sitio oficial',
] as const;

/**
 * Devuelve true si al menos una subindustria corresponde a fintech.
 * Usado para decidir si incluir la query source-guided de Colombia Fintech.
 */
function hasFintechSubindustry(subindustries: string[]): boolean {
  return subindustries.some((s) => {
    const lower = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return lower.includes('fintech') || lower.includes('pagos') || lower.includes('payment');
  });
}

const SOURCE_GUIDED_KEYS_CO_TECH_R1 = ['co_fedesoft', 'co_colombia_fintech'] as const;

/** Ronda 2 — mix con buildExpandedMultiQueryDiscoveryQueries */
// Hito 16Z.1: SECOP II reemplaza Ruta N (Medellín-céntrico → cobertura nacional B2G).
// Query sin site: — SECOP II actúa como señal contextual de proveedores tech del Estado.
const SOURCE_GUIDED_QUERIES_CO_TECH_R2 = [
  'empresas expositoras ANDICOM tecnología Colombia software sitio oficial',
  'proveedores tecnología Colombia SECOP II software servicios TI sitio oficial',
] as const;

const SOURCE_GUIDED_KEYS_CO_TECH_R2 = ['co_andicom', 'co_secop2'] as const;

// ─── Subindustrias: normalización y construcción de queries (Hito 16AB.43.14) ──

/**
 * Términos canónicos para detectar EdTech independientemente del idioma o formato.
 * Centralizado aquí para evitar duplicación en tests y producción.
 */
const EDTECH_CANONICAL_TERMS = [
  'edtech',
  'ed-tech',
  'tecnologia educativa',
  'tecnología educativa',
  'learning technology',
  'learning tech',
];

/** Devuelve true si el nombre de la subindustria corresponde a EdTech. */
function isEdTechSubindustry(name: string): boolean {
  const n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return EDTECH_CANONICAL_TERMS.some((t) => n.includes(
    t.normalize('NFD').replace(/[̀-ͯ]/g, ''),
  ));
}

/**
 * Deduplica, recorta y elimina vacíos de la lista de subindustrias.
 * Retorna un nuevo array sin modificar el original.
 */
function normalizeSubindustries(subindustries: string[] | undefined): string[] {
  if (!subindustries || subindustries.length === 0) return [];
  return [...new Set(subindustries.map((s) => s.trim()).filter((s) => s.length > 0))];
}

/**
 * Construye una query de discovery para una subindustria específica.
 * Usa un vocabulario controlado para EdTech; para el resto usa el nombre canónico.
 */
function buildSubindustryQuery(subindustry: string, country: string, round: 1 | 2): string {
  if (isEdTechSubindustry(subindustry)) {
    return round === 1
      ? `empresa EdTech aprendizaje corporativo ${country} plataforma`
      : `empresa EdTech tecnología educativa ${country} clientes corporativos`;
  }
  return round === 1
    ? `empresa ${subindustry} ${country} soluciones clientes corporativos`
    : `empresa ${subindustry} ${country} proveedores corporativos clientes`;
}

/**
 * Inyecta hasta 2 queries de subindustria reemplazando queries base.
 * Mantiene el total de queries constante: no aumenta el costo Tavily.
 * Las queries source-guided se preservan siempre.
 */
function injectSubindustryQueries(
  baseQueries: string[],
  sourceGuidedQueries: string[],
  subindustries: string[],
  country: string,
  round: 1 | 2,
): string[] {
  const normalized = normalizeSubindustries(subindustries);
  if (normalized.length === 0) return [...baseQueries, ...sourceGuidedQueries];

  const maxSubind = Math.min(normalized.length, 2, baseQueries.length);
  const subindQueries = normalized.slice(0, maxSubind).map((s) => buildSubindustryQuery(s, country, round));
  const remainingBaseSlots = Math.max(0, baseQueries.length - maxSubind);
  const keptBase = baseQueries.slice(0, remainingBaseSlots);

  return [...subindQueries, ...keptBase, ...sourceGuidedQueries];
}

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
        'empresa fabricante Colombia planta producción certificaciones',
        'empresa metalmecánica Colombia manufactura fábrica corporativo',
        'empresa empaques plásticos Colombia fabricante producción',
        'empresa textil confección Colombia planta manufactura',
        'empresa alimentos Colombia fábrica producción certificaciones',
      ],
      mexico: [
        'empresa fabricante México planta producción industrial',
        'empresa maquiladora México manufactura fábrica industrial',
        'empresa metalmecánica México Monterrey fabricante industrial',
        'empresa autopartes México Querétaro planta manufactura',
        'empresa plásticos empaques México fábrica producción corporativo',
        'empresa alimentos bebidas México planta producción fábrica',
        'empresa química farmacéutica México planta manufactura industrial',
        'empresa electrónica electrodomésticos México Tijuana Juárez manufactura',
        'empresa textil confección México planta producción corporativo',
        'empresa papel cartón envases México fábrica producción industrial',
      ],
    },
    genericFallback: (country: string) => [
      `empresa fabricante ${country} planta producción corporativo`,
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
    return `empresas ${industry} ${country} servicios soluciones corporativo ${exclusions}`.trim();
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
    // Variante 1: Lenguaje de servicios/soluciones → atrae sitios corporativos operacionales
    `empresas de ${industry} ${country} servicios tecnología corporativo ${siteExclusions}`.trim(),

    // Variante 2: Lenguaje de desarrollo/soluciones → evita portales sectoriales
    `empresas desarrollo de ${industry} ${country} soluciones clientes ${siteExclusions}`.trim(),

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
  subindustries?: string[],
): string[] {
  const isTech = isTechSector(industry);

  if (isTech) {
    // Hito 16V.1 + 16Y.2: Colombia usa 3 subcluster + 2 source-guided (Ronda 1).
    // Hito 16AB.43.14: subindustrias inyectan hasta 2 queries reemplazando subclusters.
    // Hito 16AB.43.23: fintech base query movida al último slot para que sea desplazada
    // primero cuando se inyectan subindustrias no-fintech. La source-guided de Colombia
    // Fintech se omite cuando hay subindustrias explícitas que no incluyen fintech.
    if (normalizeKey(country) === 'colombia') {
      const normalized = normalizeSubindustries(subindustries ?? []);
      const baseQueries = [
        'empresa software gestión RRHH nómina Colombia pymes corporativo',
        'empresa ciberseguridad Colombia protección datos empresas corporativo',
        'empresa fintech pagos Colombia clientes corporativos soluciones',
      ];
      // Incluir la query source-guided de Colombia Fintech solo cuando:
      // (a) no hay subindustrias (búsqueda general de tech en Colombia), o
      // (b) al menos una subindustria es fintech.
      const includeFintech = normalized.length === 0 || hasFintechSubindustry(normalized);
      const r1SourceGuided = includeFintech
        ? [...SOURCE_GUIDED_QUERIES_CO_TECH_R1]
        : [SOURCE_GUIDED_QUERIES_CO_TECH_R1[0]]; // Fedesoft only — skip Colombia Fintech
      return injectSubindustryQueries(baseQueries, r1SourceGuided, subindustries ?? [], country, 1);
    }
    // Queries validadas en Hito 13D con Tavily basic mode (otros países/Tecnología).
    const baseQueries = [
      `empresa desarrollo software ${country} servicios clientes`,
      `empresa tecnología ${country} soluciones empresariales corporativo`,
      `empresa servicios tecnológicos ${country} clientes soluciones`,
      `empresa software ${country} clientes servicios`,
      `empresa TI ${country} outsourcing software clientes`,
    ];
    return injectSubindustryQueries(baseQueries, [], subindustries ?? [], country, 1);
  }

  // Hito 16L: estrategia específica por industria antes del fallback genérico.
  const industrySpecific = resolveIndustrySpecificQueries(industry, country);
  if (industrySpecific) {
    return injectSubindustryQueries(industrySpecific, [], subindustries ?? [], country, 1);
  }

  const sectorTerms = getSectorTerms(industry);
  const primary = sectorTerms.primary[0] ?? `empresas ${industry}`;
  const secondary = sectorTerms.secondary[0] ?? industry;

  const baseQueries = [
    `${primary} ${country} servicios corporativo`,
    `empresas ${industry} ${country} corporativo soluciones`,
    `${secondary} ${country} empresa servicios`,
    `compañías ${industry} ${country} soluciones corporativas`,
    `${primary} ${country} empresa corporativo`,
  ];
  return injectSubindustryQueries(baseQueries, [], subindustries ?? [], country, 1);
}

function buildWebsiteDiscoveryQuery(industry: string, country: string): string {
  const sectorTerms = getSectorTerms(industry);
  const primaryTerm = sectorTerms.primary[0];
  return `${primaryTerm} ${country} sitio web corporativo empresa`;
}

// ─── Expanded queries para búsqueda incremental (Hito 16T.1) ─────────────────

/**
 * Queries alternativas para ronda 2 de búsqueda incremental.
 * Complementan a buildCleanMultiQueryDiscoveryQueries con ángulos distintos.
 * Sin exclusiones -site: para maximizar cobertura en ronda de expansión.
 *
 * Hito 16T.1: primera versión para Colombia/Tecnología con fallback genérico.
 * Hito 16AB.43.24: añadido options.excludeSources para gating de SECOP en contextos no-gobierno.
 */
export function buildExpandedMultiQueryDiscoveryQueries(
  industry: string,
  country: string,
  subindustries?: string[],
  options?: { excludeSources?: string[] },
): string[] {
  const countryKey = normalizeKey(country);
  const excludeSources = options?.excludeSources ?? [];

  // Hito 16V.1 + 16Y.2: Colombia/Tech usa 3 ciudad+subindustria + 2 source-guided (Ronda 2).
  // Hito 16AB.43.14: subindustrias inyectan hasta 2 queries reemplazando queries base.
  // Hito 16AB.43.24: si co_secop2 excluido (contexto no-gobierno), reemplaza por query de implementador.
  if (isTechSector(industry) && countryKey === 'colombia') {
    const baseQueries = [
      'empresa desarrollo software Medellín nearshore clientes internacionales',
      'empresa software Cali soluciones empresariales clientes corporativo',
      'empresa cloud infraestructura Colombia servicios TI corporativo',
    ];
    const secopExcluded = excludeSources.includes('co_secop2');
    const r2SourceGuided = secopExcluded
      ? [
          SOURCE_GUIDED_QUERIES_CO_TECH_R2[0], // ANDICOM preservado
          'implementador software empresarial Colombia SaaS ERP CRM sitio oficial corporativo', // reemplaza SECOP
        ]
      : [...SOURCE_GUIDED_QUERIES_CO_TECH_R2];
    return injectSubindustryQueries(baseQueries, r2SourceGuided, subindustries ?? [], country, 2);
  }

  if (isTechSector(industry)) {
    const baseQueries = [
      `empresa software empresarial ${country} soluciones corporativas clientes`,
      `proveedor SaaS B2B ${country} clientes empresas corporativo`,
      `empresa automatización procesos ${country} ERP implementación`,
      `compañía consultoría TI ${country} transformación digital`,
      `empresa desarrollo aplicaciones ${country} clientes corporativos`,
    ];
    return injectSubindustryQueries(baseQueries, [], subindustries ?? [], country, 2);
  }

  // Fallback genérico para sectores no-tech
  const sectorTerms = getSectorTerms(industry);
  const primary = sectorTerms.primary[0] ?? `empresas ${industry}`;
  const baseQueries = [
    `${primary} ${country} empresas proveedores líderes sector`,
    `empresas ${industry} ${country} servicios especializados corporativo`,
    `compañías ${industry} ${country} líderes del sector corporativo`,
    `${industry} empresas ${country} corporativo soluciones`,
    `proveedores ${industry} ${country} empresas soluciones corporativo`,
  ];
  return injectSubindustryQueries(baseQueries, [], subindustries ?? [], country, 2);
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
 * Hito 16Z.2: Clasifica una query para trazabilidad query→candidato.
 * Determina si la query es source_guided (y qué fuente) o standard.
 * Sin llamadas externas — lógica determinística.
 */
export function classifyQuery(
  queryText: string,
  country: string,
  industry: string,
): { queryType: SearchQueryType; querySourceKey: string | null } {
  if (isTechSector(industry) && normalizeKey(country) === 'colombia') {
    const r1Idx = (SOURCE_GUIDED_QUERIES_CO_TECH_R1 as readonly string[]).indexOf(queryText);
    if (r1Idx >= 0) {
      return { queryType: 'source_guided', querySourceKey: SOURCE_GUIDED_KEYS_CO_TECH_R1[r1Idx] };
    }
    const r2Idx = (SOURCE_GUIDED_QUERIES_CO_TECH_R2 as readonly string[]).indexOf(queryText);
    if (r2Idx >= 0) {
      return { queryType: 'source_guided', querySourceKey: SOURCE_GUIDED_KEYS_CO_TECH_R2[r2Idx] };
    }
  }
  return { queryType: 'standard', querySourceKey: null };
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
