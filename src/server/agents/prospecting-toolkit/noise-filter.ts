/**
 * Prospecting Toolkit — Filtro Anti-Ruido (Hito 7C, actualizado Hito 13B)
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
 *
 * Hito 13B — Hardening pre-escritura de candidatos:
 *   - connectamericas.com, lasempresas.com.co añadidos a GENERIC_DIRECTORY_DOMAINS
 *   - freelancer.com/es, workana.com, upwork.com añadidos a JOB_BOARD_DOMAINS
 *   - sortlist.com añadido a SOFTWARE_DIRECTORY_DOMAINS
 *   - BUSINESS_DATABASE_DOMAINS nuevo: emis.com, emis.com.co
 *   - GLOBAL_ENTERPRISE_DOMAINS nuevo (MVP): ey.com + grandes consultoras globales
 *   - 'claves-sector', '/cuales-son/' añadidos a BLOG_PATH_PATTERNS
 *   - CONTENT_PAGE_TITLE_SIGNALS: detecta títulos de artículo que no son nombres de empresa
 *   - WebSearchResultType extendido: 'marketplace', 'business_database'
 *
 * Hito 13D — Bloqueo de páginas de careers y SoftServe:
 *   - softserveinc.com añadido a GLOBAL_ENTERPRISE_DOMAINS (cubre career.softserveinc.com vía subdominio)
 *   - hasCareerSubdomain: bloquea subdominios career.* / careers.* de cualquier dominio
 *   - CAREER_PATH_SEGMENTS: bloquea /careers/, /career/, /vacancies/, /jobs/, /job/ en cualquier dominio
 *
 * Hito 13H — Hardening final filtros:
 *   - Dominios .gov.co y .gob.co bloqueados genéricamente como non_prospectable_source
 *   - DIRECTORY_PATH_SEGMENTS ampliado: /top-, /top_, /ranking, /rankings,
 *     /mejores-, /mejores_, /listado, /lista-, /listas-
 *   - RANKING_TITLE_RE: regex que detecta "Top N" y "Ranking YYYY" en títulos
 *     para bloquear homepages cuyo título revela contenido de lista/ranking
 */

import type { WebSearchResult } from './types';

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export type WebSearchResultType =
  | 'official_company_site'
  | 'company_profile'
  | 'directory'
  | 'marketplace'
  | 'job_board'
  | 'blog_article'
  | 'content_page'
  | 'social_post'
  | 'social_page'
  | 'software_directory'
  | 'startup_database'
  | 'business_database'
  | 'association_or_chamber'
  | 'event_or_congress'
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
  'freelancer.com',   // Hito 13B: marketplace de freelancers — no empresa prospectable
  'freelancer.es',    // Hito 13B: variante española de Freelancer
  'workana.com',      // Hito 13B: plataforma freelance LATAM
  'upwork.com',       // Hito 13B: marketplace global de freelancers
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
  'sortlist.com',       // Hito 13B: marketplace de búsqueda de agencias
  'designrush.com',    // Hito 13D: directorio de agencias digitales — no empresa prospectable
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
  'connectamericas.com',              // Hito 13B: marketplace/directorio de empresas BID
  'lasempresas.com.co',               // Hito 13B: directorio empresarial Colombia
]);

/**
 * Bases de datos financieras y empresariales comerciales.
 * Indexan perfiles de empresa pero no son empresas prospectas.
 * Hito 13B: detecta EMIS y similares que escapaban el filtro anterior.
 */
const BUSINESS_DATABASE_DOMAINS = new Set([
  'emis.com',     // Hito 13B: base de datos financiera/empresarial global
  'emis.com.co',  // Hito 13B: variante .co de EMIS para Colombia
  'orbis.bvdinfo.com',
  'bvdinfo.com',
]);

/**
 * Multinacionales globales que no son empresas colombianas objetivo para prospección local.
 * Regla MVP Hito 13B: se aplica conservadoramente — solo firmas con presencia global masiva
 * donde el URL encontrado es una landing genérica, no una empresa local prospectable.
 * No bloquear dominios de subsidiarias locales si se identifican en el futuro.
 */
const GLOBAL_ENTERPRISE_DOMAINS = new Set([
  'ey.com',         // Hito 13B: Big Four global — no prospecto local Colombia
  'accenture.com',
  'ibm.com',
  'oracle.com',
  'microsoft.com',
  'sap.com',
  'pwc.com',
  'deloitte.com',
  'kpmg.com',
  'bcg.com',
  'mckinsey.com',
  'softserveinc.com', // Hito 13D: empresa global de IT — cubre career.softserveinc.com vía subdominio
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
  '/top-',                // Hito 13H: /top-10-empresas, /top-apps, etc.
  '/top_',                // Hito 13H: variante con guion bajo
  '/ranking',             // Hito 13H: /ranking, /rankings, /ranking-software
  '/rankings',            // Hito 13H: /rankings/ explícito
  '/mejores-',            // Hito 13H: /mejores-software, /mejores-apps (más genérico que /mejores-empresas)
  '/mejores_',            // Hito 13H: variante con guion bajo
  '/listado',             // Hito 13H: /listado, /listado-empresas (más genérico que /listado-empresas/)
  '/lista-',              // Hito 13H: /lista-software, /lista-empresas (más genérico)
  '/listas-',             // Hito 13H: /listas-de-empresas, /listas-software
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
  'andicom.co',             // Hito 16AB.43.14: congreso TIC Colombia — no empresa
  'ccc.org.co',             // Hito 16AB.43.14: Cámara de Comercio de Cali — no empresa
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
  'claves-sector',  // Hito 13B: slug de artículo "claves del sector" (teleone.com.co case)
  '/cuales-son/',   // Hito 13B: artículos tipo "¿Cuáles son las mejores empresas de...?"
];

/**
 * Señales en el título que indican contenido editorial, no nombre de empresa.
 * Se aplican sobre result.title para detectar páginas de contenido que
 * escapan el filtro de path (p.ej. /tecnologia/empresa-it-colombia-claves-sector).
 * Hito 13B: complementa BLOG_PATH_PATTERNS para títulos de artículo.
 */
const CONTENT_PAGE_TITLE_SIGNALS = [
  'claves del sector',
  'claves-del-sector',
  'empresa de it en',
  'empresa it en colombia',
  'empresas de tecnología en',
  'mejores empresas de',
  'top empresas',
  'guía de empresas',
  'cómo elegir',
  'software y servicios de',
  'consultor/a comercial',
  '| ey ',
  '| accenture',
  '| ibm ',
  '| oracle ',
  '| deloitte',
  '| pwc ',
  '| kpmg ',
];

/**
 * Detecta títulos de listado/ranking aunque la URL sea la homepage.
 * Hito 13H: complementa DIRECTORY_PATH_SEGMENTS cuando Tavily devuelve la
 * homepage pero el título revela que el contenido es una lista o ranking.
 * Ejemplos: "Top 10 empresas..." / "Ranking 2025" / "Mejores 5 apps"
 */
const RANKING_TITLE_RE = /\btop\s+\d+\b|\branking\s+20\d{2}\b|\branking\s+de\b|\bmejores?\s+\d+\b/i;

// ─── Detección semántica de organizaciones no-empresa (Hito 16AB.43.14) ────────
//
// Captura eventos, congresos y cámaras de comercio cuyo dominio no aparece en
// ASSOCIATION_CHAMBER_DOMAINS. Aplica únicamente sobre título y snippet, nunca
// sobre el dominio o path, para evitar falsos positivos en empresas que tienen
// secciones /events o que venden software para eventos.

/**
 * Frases que indican cámara de comercio en el título o snippet.
 * Estas frases son altamente específicas — no aparecen en nombres de empresas.
 */
const CHAMBER_TITLE_SIGNALS = [
  'cámara de comercio',
  'camara de comercio',
  'chamber of commerce',
  'cámara de comercio e industria',
  'camara de comercio e industria',
];

/**
 * Términos fuertes de evento o congreso.
 * Seguidos de "de " indican casi siempre un evento, no una empresa.
 * Ejemplo: "Congreso de Tecnología Colombia 2025"
 */
const EVENT_CONGRESS_STRONG_TERMS = [
  'congreso de ',
  'conferencia de ',
  'convención de ',
  'convencion de ',
  'feria de ',
  'feria internacional de ',
  'simposio de ',
  'encuentro nacional de ',
  'cumbre de ',
];

/**
 * Señales corporativas que indican que el resultado ES una empresa que trabaja
 * con eventos — no un evento en sí mismo. Cuando están en el título, cancelan
 * la detección de evento_or_congress para evitar falsos positivos.
 * Ejemplos: "EventManager | Software para gestión de eventos B2B"
 */
const CORPORATE_OVERRIDE_SIGNALS = [
  'software para',
  'software de',
  'plataforma para',
  'plataforma de',
  'soluciones para',
  'servicios para',
  'gestión de eventos',
  'organización de eventos',
  'empresa de eventos',
  'tecnología para',
];

type NonCompanyOrgDetection = {
  isNonCompanyOrg: boolean;
  subtype: 'event_or_congress' | 'association_or_chamber' | null;
  reason: string;
};

/**
 * Detecta semánticamente si un resultado es una organización no-empresa.
 * Retorna `isNonCompanyOrg: false` cuando el título tiene señales corporativas
 * que indican que la entidad ES una empresa relacionada con eventos.
 * Solo inspecciona título y snippet — no el dominio ni el path.
 */
function detectNonCompanyOrg(result: {
  title?: string | null;
  snippet?: string | null;
}): NonCompanyOrgDetection {
  const titleLower = (result.title ?? '').toLowerCase();
  const snippetLower = (result.snippet ?? '').toLowerCase();
  const combinedLower = `${titleLower} ${snippetLower}`;

  // Cámara de comercio: señal muy específica — no aparece en nombres de empresas.
  if (CHAMBER_TITLE_SIGNALS.some((s) => combinedLower.includes(s))) {
    return {
      isNonCompanyOrg: true,
      subtype: 'association_or_chamber',
      reason: 'Título/snippet indica cámara de comercio — no empresa prospectable',
    };
  }

  // Evento/congreso: verificar primero que no haya señal corporativa de override.
  const hasCorporateOverride = CORPORATE_OVERRIDE_SIGNALS.some((s) => titleLower.includes(s));
  if (!hasCorporateOverride) {
    if (EVENT_CONGRESS_STRONG_TERMS.some((s) => titleLower.includes(s))) {
      return {
        isNonCompanyOrg: true,
        subtype: 'event_or_congress',
        reason: 'Título indica evento o congreso — no empresa prospectable',
      };
    }
  }

  return { isNonCompanyOrg: false, subtype: null, reason: '' };
}

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

function hasCareerSubdomain(domain: string): boolean {
  return domain.startsWith('career.') || domain.startsWith('careers.');
}

// Segmentos de ruta que indican página de empleo/vacantes de una empresa.
// Hito 13D: bloquea URLs de sección de carreras que no son sitios oficiales prospectables.
const CAREER_PATH_SEGMENTS = [
  '/careers/',
  '/career/',
  '/vacancies/',
  '/vacantes/',
  '/jobs/',
  '/job/',
];

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

  // 3b-sem. Detección semántica de organizaciones no-empresa (Hito 16AB.43.14)
  const nonCompanyOrgCheck = detectNonCompanyOrg(result);
  if (nonCompanyOrgCheck.isNonCompanyOrg) {
    return {
      isProspectable: false,
      reason: nonCompanyOrgCheck.reason,
      resultType: nonCompanyOrgCheck.subtype === 'event_or_congress' ? 'event_or_congress' : 'association_or_chamber',
    };
  }

  // 3b. Dominios gubernamentales colombianos (Hito 13H)
  if (domain.endsWith('.gov.co') || domain.endsWith('.gob.co')) {
    return {
      isProspectable: false,
      reason: `Dominio gubernamental colombiano (${domain}) — no es empresa prospectable`,
      resultType: 'non_prospectable_source',
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

  // 7e. Bases de datos financieras/empresariales (Hito 13B)
  if (domainMatchesSet(domain, BUSINESS_DATABASE_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Base de datos empresarial/financiera (${domain}) — no empresa prospectable`,
      resultType: 'business_database',
    };
  }

  // 7f. Multinacionales globales — MVP discovery local Colombia (Hito 13B)
  if (domainMatchesSet(domain, GLOBAL_ENTERPRISE_DOMAINS)) {
    return {
      isProspectable: false,
      reason: `Multinacional global (${domain}) — no es empresa prospectable local`,
      resultType: 'non_prospectable_source',
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

  // 8c. Páginas de careers/empleos (Hito 13D)
  if (hasCareerSubdomain(domain) || CAREER_PATH_SEGMENTS.some((seg) => path.includes(seg))) {
    return {
      isProspectable: false,
      reason: 'Página de careers/empleos — no es sitio oficial prospectable',
      resultType: 'job_board',
    };
  }

  // 8b. Título de artículo — página de contenido editorial (Hito 13B/13H)
  const titleLower = (result.title ?? '').toLowerCase();
  const isContentPageTitle = CONTENT_PAGE_TITLE_SIGNALS.some((s) => titleLower.includes(s));
  const isRankingTitle = RANKING_TITLE_RE.test(titleLower);
  if (isContentPageTitle || isRankingTitle) {
    return {
      isProspectable: false,
      reason: 'Título indica página de contenido editorial o listado/ranking, no empresa prospectable',
      resultType: 'content_page',
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

  // 7c. Bases de datos financieras/empresariales (Hito 13B)
  if (domainMatchesSet(domain, BUSINESS_DATABASE_DOMAINS)) {
    return {
      resultType: 'business_database',
      shouldKeep: false,
      reason: `Base de datos empresarial/financiera: ${domain}`,
    };
  }

  // 7d. Multinacionales globales — MVP discovery local Colombia (Hito 13B)
  if (domainMatchesSet(domain, GLOBAL_ENTERPRISE_DOMAINS)) {
    return {
      resultType: 'non_prospectable_source',
      shouldKeep: false,
      reason: `Multinacional global (${domain}) — no es empresa prospectable local`,
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

  // 9b. Dominios gubernamentales colombianos (Hito 13H)
  // .gov.co y .gob.co son dominios de entidades del Estado, no empresas prospectables.
  if (domain.endsWith('.gov.co') || domain.endsWith('.gob.co')) {
    return {
      resultType: 'non_prospectable_source',
      shouldKeep: false,
      reason: `Dominio gubernamental colombiano (${domain}) — no es empresa prospectable`,
    };
  }

  // 9c. Detección semántica de organizaciones no-empresa (Hito 16AB.43.14)
  // Captura eventos, congresos y cámaras cuyo dominio no está en la lista estática.
  const nonCompanyOrg = detectNonCompanyOrg(result);
  if (nonCompanyOrg.isNonCompanyOrg) {
    return {
      resultType: nonCompanyOrg.subtype === 'event_or_congress' ? 'event_or_congress' : 'association_or_chamber',
      shouldKeep: false,
      reason: nonCompanyOrg.reason,
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

  // 13b. Título de artículo — página de contenido sin señal de blog en URL (Hito 13B/13H)
  // Detecta casos donde el dominio es prospectable pero el título revela contenido editorial.
  // Hito 13H: RANKING_TITLE_RE captura "Top 10 empresas...", "Ranking 2025", etc., que
  // Tavily puede devolver con la homepage como URL (el path sería "/" y no se bloquearía por path).
  const isContentPageTitle = CONTENT_PAGE_TITLE_SIGNALS.some(
    (s) => titleText.includes(s),
  );
  const isRankingTitle = RANKING_TITLE_RE.test(titleText);
  if (isContentPageTitle || isRankingTitle) {
    return {
      resultType: 'content_page',
      shouldKeep: false,
      reason: 'Título indica página de contenido editorial o listado/ranking, no empresa prospectable',
    };
  }

  // 13c. Páginas de careers/empleos (Hito 13D)
  // Subdominio career.*/careers.* o path /careers/, /career/, /vacancies/, /jobs/, /job/
  // No son sitios oficiales prospectos — son la sección de empleo de la empresa.
  const isCareerSubdomain = hasCareerSubdomain(domain);
  const hasCareerPath = CAREER_PATH_SEGMENTS.some((seg) => path.includes(seg));
  if (isCareerSubdomain || hasCareerPath) {
    return {
      resultType: 'job_board',
      shouldKeep: false,
      reason: isCareerSubdomain
        ? `Subdominio de careers (${domain}) — página de empleos, no sitio oficial prospectable`
        : `Path de careers/empleos — sección de vacantes, no sitio oficial prospectable`,
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
