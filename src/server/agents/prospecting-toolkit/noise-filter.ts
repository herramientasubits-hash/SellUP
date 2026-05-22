/**
 * Prospecting Toolkit — Filtro Anti-Ruido (Hito 7C)
 *
 * Clasificación determinística de resultados de búsqueda web.
 * Sin IA ni llamadas externas.
 * Excluye job boards, blogs, posts sociales, directorios de software, startup DBs.
 * Preserva sitios oficiales de empresa y perfiles de company en LinkedIn.
 */

import type { WebSearchResult } from './types';

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type WebSearchResultType =
  | 'official_company_site'
  | 'company_profile'
  | 'directory'
  | 'job_board'
  | 'blog_article'
  | 'social_post'
  | 'software_directory'
  | 'startup_database'
  | 'unknown';

export type NoiseClassification = {
  resultType: WebSearchResultType;
  shouldKeep: boolean;
  reason: string;
};

export type FilteredSearchResults = {
  kept: WebSearchResult[];
  filtered: Array<{ result: WebSearchResult; classification: NoiseClassification }>;
  rawCount: number;
  keptCount: number;
  filteredCount: number;
};

// ─── Listas de dominios ruidosos ──────────────────────────────────────────────

const JOB_BOARD_DOMAINS = new Set([
  'computrabajo.com',
  'indeed.com',
  'glassdoor.com',
  'bumeran.com',
  'trabajando.com',
  'zonajobs.com',
  'multitrabajos.com',
  'elempleo.com',
  'opcionempleo.com',
  'occ.com.mx',
  'occ.com',
  'trabajos.com',
  'linkedin.com/jobs',
]);

const SOFTWARE_DIRECTORY_DOMAINS = new Set([
  'comparasoftware.com',
  'capterra.com',
  'g2.com',
  'getapp.com',
  'softwareadvice.com',
  'trustradius.com',
  'softwareworld.co',
  'crozdesk.com',
  'alternativeto.net',
  'producthunt.com',
]);

const STARTUP_DATABASE_DOMAINS = new Set([
  'crunchbase.com',
  'f6s.com',
  'ensun.io',
  'startupblink.com',
  'growjo.com',
  'tracxn.com',
  'dealroom.co',
  'angel.co',
  'angellist.com',
]);

const GENERIC_DIRECTORY_DOMAINS = new Set([
  'guiatic.com',
  'yelp.com',
  'foursquare.com',
  'yellowpages.com',
  'paginasamarillas.com.mx',
  'paginasamarillas.cl',
  'infocif.es',
  'einforma.com',
]);

// Patrones de ruta que indican artículo o blog
const BLOG_PATH_PATTERNS = [
  '/blog/',
  '/articulo/',
  '/artículo/',
  '/article/',
  '/post/',
  '/posts/',
  '/noticias/',
  '/news/',
  '/nota/',
  '/novedades/',
  '/recursos/',
  '/insights/',
  '/opinion/',
  '/opinión/',
];

// Patrón de año en ruta (indica artículo con fecha)
const YEAR_IN_PATH = /\/20(1[5-9]|2[0-9])\//;

// Patrones de posts sociales (domain + path prefix)
const SOCIAL_POST_PATH_PREFIXES: Array<{ domain: string; prefix: string }> = [
  { domain: 'linkedin.com', prefix: '/posts/' },
  { domain: 'linkedin.com', prefix: '/pulse/' },
  { domain: 'facebook.com', prefix: '/posts/' },
  { domain: 'twitter.com', prefix: '/status/' },
  { domain: 'x.com', prefix: '/status/' },
];

// ─── Helpers internos ─────────────────────────────────────────────────────────

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Verifica si el dominio (o su dominio padre) está en el Set dado.
 * Permite detectar subdominios como "co.computrabajo.com" → "computrabajo.com".
 */
function domainMatchesSet(domain: string, set: Set<string>): boolean {
  if (set.has(domain)) return true;
  for (const entry of set) {
    if (domain.endsWith(`.${entry}`)) return true;
  }
  return false;
}

function hasBlogSubdomain(domain: string): boolean {
  return domain.startsWith('blog.') || domain.startsWith('blogs.');
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function isLinkedInCompanyPage(domain: string, path: string): boolean {
  return domain.includes('linkedin.com') && (
    path.startsWith('/company/') || path.includes('/company/')
  );
}

// ─── Clasificador principal ───────────────────────────────────────────────────

/**
 * Clasifica un resultado de búsqueda web.
 * Completamente determinístico — sin IA ni llamadas externas.
 */
export function classifySearchResult(result: {
  url: string;
  title?: string | null;
  snippet?: string | null;
}): NoiseClassification {
  const domain = extractDomain(result.url);
  const path = extractPath(result.url);

  if (!domain) {
    return {
      resultType: 'unknown',
      shouldKeep: false,
      reason: 'URL inválida o sin dominio extraíble',
    };
  }

  // 1. Posts sociales (verificar antes de company pages)
  for (const { domain: socialDomain, prefix } of SOCIAL_POST_PATH_PREFIXES) {
    if (domain.includes(socialDomain) && path.includes(prefix)) {
      return {
        resultType: 'social_post',
        shouldKeep: false,
        reason: `Post social en ${domain}`,
      };
    }
  }

  // 2. LinkedIn company pages → útiles para identificar empresa
  if (isLinkedInCompanyPage(domain, path)) {
    return {
      resultType: 'company_profile',
      shouldKeep: true,
      reason: 'Perfil de empresa en LinkedIn',
    };
  }

  // 3. Job boards (incluyendo subdominios como co.computrabajo.com)
  if (domainMatchesSet(domain, JOB_BOARD_DOMAINS)) {
    return {
      resultType: 'job_board',
      shouldKeep: false,
      reason: `Portal de empleo: ${domain}`,
    };
  }

  // 4. Directorios de software
  if (domainMatchesSet(domain, SOFTWARE_DIRECTORY_DOMAINS)) {
    return {
      resultType: 'software_directory',
      shouldKeep: false,
      reason: `Directorio de software: ${domain}`,
    };
  }

  // 5. Bases de datos de startups
  if (domainMatchesSet(domain, STARTUP_DATABASE_DOMAINS)) {
    return {
      resultType: 'startup_database',
      shouldKeep: false,
      reason: `Base de datos de startups: ${domain}`,
    };
  }

  // 6. Directorios genéricos
  if (domainMatchesSet(domain, GENERIC_DIRECTORY_DOMAINS)) {
    return {
      resultType: 'directory',
      shouldKeep: false,
      reason: `Directorio genérico: ${domain}`,
    };
  }

  // 7. Artículos de blog por subdominio o patrón de URL
  const hasBlogPath = BLOG_PATH_PATTERNS.some((pattern) => path.includes(pattern));
  const hasYearInPath = YEAR_IN_PATH.test(path);
  const isBlogSubdomain = hasBlogSubdomain(domain);

  if (isBlogSubdomain || hasBlogPath || hasYearInPath) {
    return {
      resultType: 'blog_article',
      shouldKeep: false,
      reason: isBlogSubdomain
        ? `Subdominio de blog: ${domain}`
        : hasBlogPath
          ? 'Patrón de blog/artículo en la URL'
          : 'Fecha en la URL (artículo con timestamp)',
    };
  }

  // 8. Default: candidato a sitio oficial de empresa
  return {
    resultType: 'official_company_site',
    shouldKeep: true,
    reason: 'Dominio sin patrones de ruido — candidato a sitio oficial de empresa',
  };
}

/**
 * Aplica el filtro anti-ruido a un conjunto de resultados de búsqueda.
 * Enriquece el metadata de cada resultado con su clasificación.
 */
export function filterNoiseResults(results: WebSearchResult[]): FilteredSearchResults {
  const kept: WebSearchResult[] = [];
  const filtered: FilteredSearchResults['filtered'] = [];

  for (const result of results) {
    const classification = classifySearchResult(result);

    const enriched: WebSearchResult = {
      ...result,
      metadata: {
        ...result.metadata,
        result_type: classification.resultType,
        noise_filtered: !classification.shouldKeep,
        filter_reason: classification.reason,
      },
    };

    if (classification.shouldKeep) {
      kept.push(enriched);
    } else {
      filtered.push({ result: enriched, classification });
    }
  }

  return {
    kept: kept.map((r, i) => ({ ...r, rank: i + 1 })),
    filtered,
    rawCount: results.length,
    keptCount: kept.length,
    filteredCount: filtered.length,
  };
}
