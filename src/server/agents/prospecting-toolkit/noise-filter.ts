/**
 * Prospecting Toolkit — Filtro Anti-Ruido (Hito 7C, actualizado Hito 13A)
 *
 * Clasificación determinística de resultados de búsqueda web.
 * Sin IA ni llamadas externas.
 * Excluye job boards, blogs, posts sociales, directorios de software, startup DBs,
 * plataformas sociales completas (Facebook, Instagram, YouTube, TikTok, X),
 * directorios empresariales genéricos y contenido con año embebido en la URL.
 * Preserva sitios oficiales de empresa y perfiles de company en LinkedIn.
 *
 * Hito 10B — Ruido residual corregido:
 *   - Facebook videos/páginas ahora bloqueados a nivel de dominio (social_page)
 *   - Directorios empresariales (DataCrédito, PáginasAmarillas CO, etc.) añadidos
 *   - YEAR_IN_PATH actualizado: detecta años embebidos en segmento (/web2019/, /blog2024/)
 *   - Path /directorio/ bloqueado en cualquier dominio
 *
 * Hito 12D — Ruido de queries en inglés corregido:
 *   - techbehemoths.com, clutch.co, goodfirms.co añadidos a SOFTWARE_DIRECTORY_DOMAINS
 *   - fedesoft.org/fedesoft.com añadidos a ASSOCIATION_CHAMBER_DOMAINS (gremio software CO)
 *   - Paths de contenido extranjero sobre Colombia: /it-companies-in-*, /companies/*,
 *     /sites-to-hire, /global-locations/, /hire- bloqueados en DIRECTORY_PATH_SEGMENTS
 *
 * Hito 13A — Ruido de queries en español corregido:
 *   - einforma.co añadido a GENERIC_DIRECTORY_DOMAINS (faltaba variante .co de einforma.com)
 *     Cubre subdominios como directorio-empresas.einforma.co via domainMatchesSet endsWith
 *   - /nuestro-blog/ añadido a BLOG_PATH_PATTERNS (detecta blogs con prefijo "nuestro-")
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
  | 'social_page'
  | 'software_directory'
  | 'startup_database'
  | 'association_or_chamber'
  | 'academic_source'
  | 'pdf_document'
  | 'news_or_media'
  | 'sector_report'
  | 'non_prospectable_source'
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
  'capterra.co',        // Hito 12B: variante Colombia de Capterra
  'g2.com',
  'getapp.com',
  'softwareadvice.com',
  'trustradius.com',
  'softwareworld.co',
  'crozdesk.com',
  'alternativeto.net',
  'producthunt.com',
  'techbehemoths.com',  // Hito 12D: directorio "Top IT Companies" por país
  'clutch.co',          // Hito 12D: directorio de agencias de software
  'goodfirms.co',       // Hito 12D: directorio de empresas de software
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
  'paginasamarillas.com.co',   // Hito 10B: PáginasAmarillas Colombia
  'infocif.es',
  'einforma.com',
  'einforma.co',               // Hito 13A: variante .co de einforma (directorio-empresas.einforma.co)
  'datacreditoempresas.com.co', // Hito 10B: directorio empresarial DataCrédito
  'empresite.eleconomistaamerica.co', // Hito 10B: directorio El Economista CO
  'guiaempresas.universia.net.co',    // Hito 10B: guía empresas Universia CO
]);

/**
 * Plataformas sociales que NUNCA son candidatos prospectables.
 * Todo URL de estos dominios se descarta como social_page o social_post.
 * Excepción explícita: linkedin.com/company/ se trata por separado como company_profile.
 *
 * Hito 10B: añadido para bloquear Facebook videos/páginas que pasaban el filtro anterior.
 */
const SOCIAL_PLATFORM_DOMAINS = new Set([
  'facebook.com',
  'fb.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'snapchat.com',
]);

/**
 * Segmentos de ruta que indican listado de directorio empresarial o artículo
 * de lista de empresas (no sitio oficial de empresa).
 * Se aplican sobre cualquier dominio.
 *
 * Hito 12B: añadidos patrones de artículos "top-N empresas" y directorios
 * embebidos detectados en validación real de Tavily.
 */
const DIRECTORY_PATH_SEGMENTS = [
  '/directorio/',
  '/directorio-empresas/',
  '/empresas-directorio/',
  '/listado-empresas/',
  '/empresas-de-',        // Hito 12B: /empresas-de-software-en-colombia
  '/top-empresas',        // Hito 12B: /top-empresas-desarrollo-software-colombia
  '/mejores-empresas',    // Hito 12B: artículos de ranking de empresas
  '/lista-empresas',      // Hito 12B: /lista-empresas-tecnologia
  '/ranking-empresas',    // Hito 12B: artículos de ranking
  '/directory/',          // Hito 12B: /directory/ en portales tipo capterra.co
  '/it-companies-in-',    // Hito 12D: /it-companies-in-colombia (rankings externos)
  '/companies/',          // Hito 12D: /companies/colombia en directorios por país
  '/sites-to-hire',       // Hito 12D: artículos "Top N sites to hire developers"
  '/global-locations/',   // Hito 12D: páginas de presencia global de empresas extranjeras
  '/hire-',               // Hito 12D: /hire-software-developers-in-colombia
];

const ASSOCIATION_CHAMBER_DOMAINS = new Set([
  'cintel.co',
  'cintel.org.co',
  'tic-col.net',
  'asobarq.co',
  'fenalco.com.co',
  'andi.com.co',
  'ccb.org.co',
  'camarabogota.org.co',
  'camaramedallin.org.co',
  'cccali.org.co',
  'acit.org.co',
  'acofiex.org',
  'asomicroempresas.com.co',
  'acopi.org.co',
  'ascamara.org',
  'cccomercio.es',
  'camaras.es',
  'colombiatic.net',
  'mintic.gov.co',
  'fedesoft.org',           // Hito 12D: Federación Colombiana de Software — gremio
  'fedesoft.com',           // Hito 12D: variante de dominio Fedesoft
]);

const ACADEMIC_SOURCE_DOMAINS = new Set([
  'sciencedirect.com',
  'scholar.google.com',
  'arxiv.org',
  'researchgate.net',
  'ieee.org',
  'acm.org',
  'jstor.org',
  'bibliotecadigital.ccb.org.co',
  'javeriana.edu.co',
  'unal.edu.co',
  'ean.edu.co',
  'cife.edu.co',
  'uninorte.edu.co',
  '.edu.co',
  '.edu',
]);

const NEWS_MEDIA_DOMAINS = new Set([
  'dinero.com',
  'semana.com',
  'eltiempo.com',
  'portafolio.co',
  'larepublica.co',
  'elespectador.com',
  'lafm.com.co',
  'caracol.com.co',
  'rcnradio.com',
  'pulzo.com',
  'kienyke.com',
  'forbes.com.co',
  'forbes.es',
  'expansion.com',
  'emprendedores.es',
  'impactotic.co',
  'enter.co',
  'colombiadigital.net',
  'sistemasenlinea.com.co',
]);

// Patrones de ruta que indican artículo o blog
const BLOG_PATH_PATTERNS = [
  '/blog/',
  '/nuestro-blog/', // Hito 13A: /nuestro-blog/ en portales corporativos (q2bstudio)
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

// Patrón de año en ruta (indica artículo con fecha).
// Hito 10B: actualizado para capturar años embebidos en segmentos de path:
//   Antes detectaba: /2019/  /2024/
//   Ahora detecta:   /2019/  /2024/  /web2019/  /blog2020/  /noticias2019/
// La expresión \w* permite cero o más caracteres de palabra antes/después del año.
const YEAR_IN_PATH = /\/\w*20(?:1[5-9]|2\d)\w*\//i;

// Patrones de posts/contenido social dentro de plataformas con excepciones (LinkedIn).
// Facebook, Twitter/X quedan cubiertos por SOCIAL_PLATFORM_DOMAINS y ya no necesitan
// estar aquí, pero se mantienen como capa de defensa en profundidad.
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

function isPdfDocument(url: string): boolean {
  return url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('/pdf');
}

/**
 * Evalúa si un resultado es una empresa prospectable legítima.
 *
 * INCLUSIÓN (lo que QUEREMOS):
 * - Empresas con dominio corporativo propio (.com, .com.co, .co, .es, .mx, .cl)
 * - Sitios con estructura oficial (/about, /nosotros, /empresa, /soluciones, /servicios, /contacto)
 * - Perfiles de empresa en LinkedIn
 *
 * EXCLUSIÓN (lo que NO QUEREMOS):
 * - Asociaciones y cámaras (CINTEL, ANDI, FENALCO, etc.)
 * - Fuentes académicas (ScienceDirect, scholar.google, bibliotecadigital)
 * - Documentos PDF
 * - Medios y noticias (Dinero, Semana, El Tiempo, etc.)
 * - Directorios de software (Capterra, G2, comparasoftware)
 * - Bases de datos de startups (Crunchbase, F6S, Ensun)
 * - Portales de empleo (Computrabajo, Indeed, etc.)
 * - Posts sociales
 * - Blogs y artículos
 */
export function isProspectableCompanyResult(result: {
  url: string;
  title?: string | null;
  snippet?: string | null;
}): {
  isProspectable: boolean;
  reason: string;
  resultType: WebSearchResultType;
} {
  const domain = extractDomain(result.url);
  const path = extractPath(result.url);

  if (!domain) {
    return {
      isProspectable: false,
      reason: 'URL inválida o sin dominio extraíble',
      resultType: 'unknown',
    };
  }

  // ─── EXCLUSIONES (Ruido explícito) ───────────────────────────────────────────

  // 1. Documentos PDF
  if (isPdfDocument(result.url)) {
    return {
      isProspectable: false,
      reason: 'Documento PDF — no es un sitio web de empresa',
      resultType: 'pdf_document',
    };
  }

  // 2. Plataformas sociales completas (Hito 10B).
  // Ninguna URL de facebook, instagram, youtube, tiktok, x/twitter es candidato.
  // LinkedIn se trata por separado más adelante (excepción /company/).
  if (domainMatchesSet(domain, SOCIAL_PLATFORM_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Plataforma social (${domain}) — no es sitio oficial de empresa`,
      resultType: 'social_page',
    };
  }

  // 3. Asociaciones y cámaras
  if (domainMatchesSet(domain, ASSOCIATION_CHAMBER_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Asociación o cámara (${domain}), no empresa prospectable`,
      resultType: 'association_or_chamber',
    };
  }

  // 4. Fuentes académicas
  if (
    domainMatchesSet(domain, ACADEMIC_SOURCE_DOMAINS) ||
    domain.endsWith('.edu.co') ||
    domain.endsWith('.edu')
  ) {
    return {
      isProspectable: false,
      reason: `Fuente académica (${domain})`,
      resultType: 'academic_source',
    };
  }

  // 5. Medios y noticias
  if (domainMatchesSet(domain, NEWS_MEDIA_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Medio de comunicación o noticia (${domain})`,
      resultType: 'news_or_media',
    };
  }

  // 6. Job boards
  if (domainMatchesSet(domain, JOB_BOARD_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Portal de empleo (${domain})`,
      resultType: 'job_board',
    };
  }

  // 7. Directorios de software
  if (domainMatchesSet(domain, SOFTWARE_DIRECTORY_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Directorio de software (${domain}) — no empresa prospectable`,
      resultType: 'software_directory',
    };
  }

  // 7b. Bases de datos de startups
  if (domainMatchesSet(domain, STARTUP_DATABASE_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Base de datos de startups (${domain}) — no empresa prospectable`,
      resultType: 'startup_database',
    };
  }

  // 7c. Directorios genéricos (por dominio)
  if (domainMatchesSet(domain, GENERIC_DIRECTORY_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Directorio empresarial (${domain}) — no empresa prospectable`,
      resultType: 'directory',
    };
  }

  // 7d. Directorios por path (Hito 10B): /directorio/ en cualquier dominio
  if (DIRECTORY_PATH_SEGMENTS.some((seg) => path.includes(seg))) {
    return {
      isProspectable: false,
      reason: `Path indica listado de directorio — no empresa prospectable`,
      resultType: 'directory',
    };
  }

  // 8. Posts sociales y blogs
  for (const { domain: socialDomain, prefix } of SOCIAL_POST_PATH_PREFIXES) {
    if (domain.includes(socialDomain) && path.includes(prefix)) {
      return {
        isProspectable: false,
        reason: `Post social en ${domain}`,
        resultType: 'social_post',
      };
    }
  }

  const hasBlogPath = BLOG_PATH_PATTERNS.some((pattern) =>
    path.includes(pattern)
  );
  // Hito 10B: YEAR_IN_PATH actualizado — captura /web2019/, /blog2020/, etc.
  const hasYearInPath = YEAR_IN_PATH.test(path);
  const isBlogSubdomain = hasBlogSubdomain(domain);

  if (isBlogSubdomain || hasBlogPath || hasYearInPath) {
    return {
      isProspectable: false,
      reason: 'Artículo o blog — no es sitio oficial de empresa',
      resultType: 'blog_article',
    };
  }

  // ─── INCLUSIONES (Empresa legítima) ──────────────────────────────────────────

  // LinkedIn company pages son útiles para validar empresa
  if (isLinkedInCompanyPage(domain, path)) {
    return {
      isProspectable: true,
      reason: 'Perfil de empresa en LinkedIn — fuente de validación',
      resultType: 'company_profile',
    };
  }

  // Dominio corporativo con extensión regional/internacional
  const corpDomainPattern = /\.(com|com\.co|co|es|mx|cl|ar|pe|ve|ec|pa|uy|cr|do|sv|hn|ni|gt|bo|py|br|pt|fr|it|de|uk|nl|be|ch|se|no|fi|dk|pl|cz|at|ie|nz|au|sg|hk|cn|in|jp|kr|th|my|id|ph|vn)$/i;

  if (corpDomainPattern.test(domain)) {
    // Detectar si parece ser un sitio oficial de empresa
    // (no es blog ni directorio ni servicio genérico)
    const hasOfficialPathPatterns = [
      '/about',
      '/nosotros',
      '/empresa',
      '/quienes-somos',
      '/company',
      '/soluciones',
      '/servicios',
      '/products',
      '/services',
      '/contacto',
      '/contactanos',
      '/contact',
      '/team',
      '/equipo',
    ].some((pattern) => path.toLowerCase().includes(pattern));

    // Si tiene patrones de sitio oficial o es root, es prospectable
    if (hasOfficialPathPatterns || path === '/' || path === '') {
      return {
        isProspectable: true,
        reason: `Dominio corporativo con estructura de sitio oficial (${domain})`,
        resultType: 'official_company_site',
      };
    }

    // Incluso sin patrones obvios, un dominio corporativo sin ruido es candidato
    return {
      isProspectable: true,
      reason: `Dominio corporativo legítimo (${domain}) — candidato a empresa prospectable`,
      resultType: 'official_company_site',
    };
  }

  // Default: no prospectable (no fits corporate domain pattern)
  return {
    isProspectable: false,
    reason: `Dominio no corporativo (${domain}) — no matches patrones de empresa prospectable`,
    resultType: 'unknown',
  };
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

  // 1. Plataformas sociales completas (Hito 10B).
  // Facebook, Instagram, YouTube, TikTok, X/Twitter y similares nunca son candidatos,
  // independientemente del path. LinkedIn es la única excepción (tratada en paso 2).
  if (domainMatchesSet(domain, SOCIAL_PLATFORM_DOMAINS)) {
    return {
      resultType: 'social_page',
      shouldKeep: false,
      reason: `Plataforma social (${domain}) — no es sitio oficial de empresa`,
    };
  }

  // 2. Posts/contenido de LinkedIn (antes de la excepción de company page)
  for (const { domain: socialDomain, prefix } of SOCIAL_POST_PATH_PREFIXES) {
    if (domain.includes(socialDomain) && path.includes(prefix)) {
      return {
        resultType: 'social_post',
        shouldKeep: false,
        reason: `Post social en ${domain}`,
      };
    }
  }

  // 3. LinkedIn company pages → útiles para identificar empresa
  if (isLinkedInCompanyPage(domain, path)) {
    return {
      resultType: 'company_profile',
      shouldKeep: true,
      reason: 'Perfil de empresa en LinkedIn',
    };
  }

  // 4. Job boards (incluyendo subdominios como co.computrabajo.com)
  if (domainMatchesSet(domain, JOB_BOARD_DOMAINS)) {
    return {
      resultType: 'job_board',
      shouldKeep: false,
      reason: `Portal de empleo: ${domain}`,
    };
  }

  // 5. Directorios de software
  if (domainMatchesSet(domain, SOFTWARE_DIRECTORY_DOMAINS)) {
    return {
      resultType: 'software_directory',
      shouldKeep: false,
      reason: `Directorio de software: ${domain}`,
    };
  }

  // 6. Bases de datos de startups
  if (domainMatchesSet(domain, STARTUP_DATABASE_DOMAINS)) {
    return {
      resultType: 'startup_database',
      shouldKeep: false,
      reason: `Base de datos de startups: ${domain}`,
    };
  }

  // 7. Directorios genéricos (por dominio)
  if (domainMatchesSet(domain, GENERIC_DIRECTORY_DOMAINS)) {
    return {
      resultType: 'directory',
      shouldKeep: false,
      reason: `Directorio empresarial: ${domain}`,
    };
  }

  // 7b. Directorios por patrón de path (Hito 10B).
  // Captura listados de empresas embebidos en portales que no son directorios puros.
  if (DIRECTORY_PATH_SEGMENTS.some((seg) => path.includes(seg))) {
    return {
      resultType: 'directory',
      shouldKeep: false,
      reason: `Path indica listado de directorio (${path.split('/').slice(0, 3).join('/')})`,
    };
  }

  // 8. PDFs y documentos
  if (isPdfDocument(result.url)) {
    return {
      resultType: 'pdf_document',
      shouldKeep: false,
      reason: 'Documento PDF detectado',
    };
  }

  // 9. Asociaciones y cámaras de comercio
  if (domainMatchesSet(domain, ASSOCIATION_CHAMBER_DOMAINS)) {
    return {
      resultType: 'association_or_chamber',
      shouldKeep: false,
      reason: `Asociación o cámara: ${domain}`,
    };
  }

  // 10. Fuentes académicas
  if (
    domainMatchesSet(domain, ACADEMIC_SOURCE_DOMAINS) ||
    domain.endsWith('.edu.co') ||
    domain.endsWith('.edu')
  ) {
    return {
      resultType: 'academic_source',
      shouldKeep: false,
      reason: `Fuente académica: ${domain}`,
    };
  }

  // 11. Noticias y medios de comunicación
  if (domainMatchesSet(domain, NEWS_MEDIA_DOMAINS)) {
    return {
      resultType: 'news_or_media',
      shouldKeep: false,
      reason: `Sitio de noticias o media: ${domain}`,
    };
  }

  // 12. Reportes, artículos sectoriales e informes académicos (por título/snippet)
  const titleText = (result.title ?? '').toLowerCase();
  const snippetText = (result.snippet ?? '').toLowerCase();

  const SECTOR_REPORT_TITLE_SIGNALS = [
    'biblioteca digital', 'sector tic', 'sector tecnología', 'sector tecnologia',
    'informe sectorial', 'reporte sectorial', 'estudio de mercado',
    'análisis del sector', 'analisis del sector', 'panorama del sector',
    'tendencias del sector', 'industria tic', 'tic colombia',
  ];
  const isSectorTitleSignal = SECTOR_REPORT_TITLE_SIGNALS.some(
    (s) => titleText.includes(s) || snippetText.includes(s),
  );
  if (isSectorTitleSignal) {
    return {
      resultType: 'sector_report',
      shouldKeep: false,
      reason: 'Título o snippet indica reporte/fuente sectorial, no empresa prospectable',
    };
  }

  // Reporte genérico si el dominio también es de research/market
  const hasReportKeyword =
    /reporte|análisis|estudio|tendencias|informe/i.test(result.snippet ?? '') ||
    /reporte|análisis|estudio|tendencias|informe/i.test(result.title ?? '');
  if (
    hasReportKeyword &&
    (domain.includes('research') || domain.includes('market') || domain.includes('analyst'))
  ) {
    return {
      resultType: 'sector_report',
      shouldKeep: false,
      reason: 'Reporte o análisis de sector detectado',
    };
  }

  // 13. Artículos de blog por subdominio o patrón de URL (Hito 10B: incluye año embebido)
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
          : 'Año en segmento de URL (contenido con fecha)',
    };
  }

  // 14. Default: candidato a sitio oficial de empresa
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
