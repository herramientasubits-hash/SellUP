/**
 * Source URL Quality Gate — Hito 16AB.43.29
 *
 * Clasifica la calidad de una URL fuente para determinar si un candidato
 * proviene de una página comercial/oficial o de contenido/directorio/registro.
 *
 * Regla general:
 *   official_homepage / official_product_page / official_solution_page / official_location_page → permitido
 *   official_partner_page → permitido con precaución (empresa candidata es el partner)
 *   content_article / blog_article / guide / directory / marketplace /
 *   partner_directory / partner_registration / generic_transformation_digital_page → bloqueado
 *
 * Sin IA. Sin llamadas externas. Completamente determinístico.
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type SourceUrlQuality =
  | 'official_homepage'
  | 'official_product_page'
  | 'official_solution_page'
  | 'official_location_page'
  | 'official_partner_page'
  | 'content_article'
  | 'blog_article'
  | 'guide'
  | 'directory'
  | 'marketplace'
  | 'partner_directory'
  | 'partner_registration'
  | 'career_or_staffing_page'
  | 'generic_transformation_digital_page'
  | 'glossary_or_educational_content'
  | 'editorial_media'
  | 'forum_or_community'
  | 'review_site'
  | 'landing_page'
  | 'unknown';

export type SourceUrlQualityResult = {
  quality: SourceUrlQuality;
  blocked: boolean;
  reason: string;
  /** Bonus de ranking: positivo = mejor posición, negativo = peor posición. */
  rankingBonus: number;
};

// ─── Calidades bloqueadas ─────────────────────────────────────────────────────

const BLOCKED_QUALITIES = new Set<SourceUrlQuality>([
  'content_article',
  'blog_article',
  'guide',
  'directory',
  'marketplace',
  'partner_directory',
  'partner_registration',
  'generic_transformation_digital_page',
  'glossary_or_educational_content',
  'editorial_media',
  'forum_or_community',
  'review_site',
  'landing_page',
]);

// ─── Bonos de ranking por calidad ────────────────────────────────────────────

const RANKING_BONUS: Record<SourceUrlQuality, number> = {
  official_homepage: 25,
  official_product_page: 20,
  official_solution_page: 20,
  official_location_page: 10,
  official_partner_page: 5,
  unknown: 0,
  career_or_staffing_page: -30,
  content_article: -80,
  blog_article: -80,
  guide: -60,
  directory: -80,
  marketplace: -70,
  partner_directory: -80,
  partner_registration: -80,
  generic_transformation_digital_page: -60,
  glossary_or_educational_content: -80,
  editorial_media: -90,
  forum_or_community: -90,
  review_site: -80,
  landing_page: -70,
};

// ─── Dominios de directorios de partners ────────────────────────────────────

const PARTNER_DIRECTORY_DOMAINS = new Set([
  'elioplus.com',
  'channele2e.com',
  'channelfutures.com',
  'crn.com',
  'channelpartnersonline.com',
  'idc.com',
  'partnerstack.com',
]);

// ─── Patrones de path que indican calidad oficial ────────────────────────────

const SOLUTION_PATH_PATTERNS = [
  '/implementacion-',
  '/implementacion/',
  '/implementar-',
  '/software-',
  '/plataforma-',
  '/plataforma/',
  '/crm-',
  '/erp-',
  '/lms-',
  '/hcm-',
  '/hrm-',
  '/productos/',
  '/product/',
  '/soluciones/',
  '/solutions/',
  '/servicios/',
  '/services/',
  '/aplicaciones/',
  '/tecnologia/',
  '/tecnología/',
];

const LOCATION_PATH_PATTERNS = [
  '/donde-estamos',
  '/nuestras-oficinas',
  '/nuestras-sedes',
  '/contacto',
  '/contact',
  '/oficina',
  '/colombia/',
  '/colombia',
  '/latam/',
  '/latinoamerica/',
  '/america-latina/',
  '/es-co/',
  '/en/co/',
];

const PRODUCT_PATH_PATTERNS = [
  '/producto',
  '/product',
  '/features/',
  '/caracteristicas/',
  '/plataforma',
  '/platform',
  '/software',
  '/suite/',
  '/modulo',
  '/module',
];

// ─── Patrones de path que indican contenido/ruido ────────────────────────────

const BLOG_PATH_WITH_S = [
  '/blogs/',
  '/blog/',
  '/noticias/',
  '/news/',
  '/articulo/',
  '/article/',
  '/post/',
  '/posts/',
  '/novedades/',
  '/insights/',
  '/recursos/',
  '/resources/',
];

const GUIDE_PATH_PATTERNS = [
  '/guide/',
  '/full-guide/',
  '/guia/',
  '/guía/',
  '/tutorial/',
  '/how-to/',
  '/como-',
  '/que-es-',
];

const PARTNER_REGISTRATION_PATH_SIGNALS = [
  'business-model',
  'become-a-partner',
  'become-partner',
  'partner-program',
  'partner-registration',
  'partner-signup',
  'registro-partner',
  'registrate-partner',
];

const PARTNER_DIRECTORY_PATH_SIGNALS = [
  '/channel-partners/',
  '/partner-directory/',
  '/partner-finder/',
  '/find-a-partner/',
  '/partners-list/',
  '/partners-ecosystem/',
  '/ecosystem/partners/',
  '/resellers/',
  '/channel-partner/',
];

const TRANSFORMATION_DIGITAL_PATH_SIGNALS = [
  'transformacion-digital',
  'transformación-digital',
  'digital-transformation',
  'transformacion_digital',
  'agencia-transformacion',
  'agencia-digital-transformation',
];

// Paths de landing pages de marketing/campaña — fuente primaria débil
const LANDING_PAGE_PATH_SIGNALS = [
  '/lp/',
  '/landing/',
  '/landing-page/',
];

const ARTICLE_SLUG_SIGNALS = [
  '-es-clave',
  '-clave-para',
  'la-importancia-',
  'la-tecnologia-',
  'la-tecnología-',
  'por-que-',
  'por-qué-',
  '-y-su-importancia',
  '-en-tu-empresa',
  '-de-tu-empresa',
  '-para-tu-empresa',
  '-para-su-empresa',
  '-en-las-empresas',
  '-y-como-',
  'tendencias-en-',
  'beneficios-de-',
  'ventajas-de-',
  'como-mejorar-',
  'como-implementar-',
  'tips-para-',
  '-en-colombia-y-',
];

// ─── Helpers internos ─────────────────────────────────────────────────────────

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function pathDepth(path: string): number {
  return path.split('/').filter((s) => s.length > 0).length;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Clasifica la calidad de una URL fuente para un candidato.
 *
 * @param url     URL del candidato (sourceUrl o website)
 * @param name    Nombre del candidato (opcional, para señales adicionales)
 */
export function classifySourceUrlQuality(
  url: string | null,
  name?: string | null,
): SourceUrlQualityResult {
  if (!url) {
    return { quality: 'unknown', blocked: false, reason: 'URL no disponible', rankingBonus: 0 };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
  } catch {
    return { quality: 'unknown', blocked: false, reason: 'URL no parseable', rankingBonus: 0 };
  }

  const domain = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsedUrl.pathname.toLowerCase();
  const depth = pathDepth(path);
  const nameLower = (name ?? '').toLowerCase();

  // ── 1. Directorio de partners (dominio) ──────────────────────────────────────
  if (PARTNER_DIRECTORY_DOMAINS.has(domain)) {
    return {
      quality: 'partner_directory',
      blocked: true,
      reason: `Dominio de directorio de partners (${domain})`,
      rankingBonus: RANKING_BONUS.partner_directory,
    };
  }

  // ── 2. Directorio de partners (path) ─────────────────────────────────────────
  if (PARTNER_DIRECTORY_PATH_SIGNALS.some((s) => path.includes(s))) {
    return {
      quality: 'partner_directory',
      blocked: true,
      reason: `Path indica directorio de partners: ${path.slice(0, 80)}`,
      rankingBonus: RANKING_BONUS.partner_directory,
    };
  }

  // ── 2b. Marketplace / solutions catalog (checked anywhere in path) ────────────
  // Paths containing /marketplace/ indicate a marketplace or solutions catalog,
  // not a company's official website. Must be checked before solution/product paths
  // to ensure marketplace URLs like ecosystem.hubspot.com/es/marketplace/solutions/
  // are blocked as marketplace rather than allowed as official_solution_page.
  if (
    path.includes('/marketplace/') ||
    path.includes('/app-marketplace/') ||
    path.includes('/app-store/') ||
    path.includes('/solutions-directory/') ||
    path.includes('/vendor-directory/') ||
    path.includes('/integration-marketplace/') ||
    path.includes('/partner-catalog/')
  ) {
    return {
      quality: 'marketplace',
      blocked: true,
      reason: `Path indica marketplace/directorio: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.marketplace,
    };
  }

  // ── 3. Registro de partners ───────────────────────────────────────────────────
  // Detecta cuando el URL es del programa de partners del fabricante, no del partner.
  // Condición: path contiene /partner/ más al menos una señal de registro.
  if (path.includes('/partner/') || path.includes('/partners/')) {
    const hasRegistrationSignal = PARTNER_REGISTRATION_PATH_SIGNALS.some((s) => path.includes(s));
    const hasDoublePartner = (path.match(/\/partner\//g) ?? []).length >= 2;
    if (hasRegistrationSignal || hasDoublePartner) {
      return {
        quality: 'partner_registration',
        blocked: true,
        reason: `Path indica registro/programa de partners: ${path.slice(0, 80)}`,
        rankingBonus: RANKING_BONUS.partner_registration,
      };
    }
  }

  // ── 4. Blog con /blogs/ (plural) — ya /blog/ está en noise-filter ────────────
  if (BLOG_PATH_WITH_S.some((s) => path.includes(s))) {
    return {
      quality: 'blog_article',
      blocked: true,
      reason: `Path indica artículo/blog: ${path.slice(0, 80)}`,
      rankingBonus: RANKING_BONUS.blog_article,
    };
  }

  // ── 5a. Glosario / contenido educativo ──────────────────────────────────────────
  // Detecta /glossary/, /glosario/, /es/glossary/, /hub/que-es
  if (
    path.includes('/glossary/') ||
    path.includes('/glosario/') ||
    path.includes('/hub/que-es')
  ) {
    return {
      quality: 'glossary_or_educational_content',
      blocked: true,
      reason: `Path indica glosario/contenido educativo: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.glossary_or_educational_content,
    };
  }

  // ── 5b. Editorial media (crónica, noticia) ────────────────────────────────────
  if (
    path.includes('/cronica/') ||
    path.includes('/noticia/') ||
    path.includes('/noticias/') ||
    path.includes('/edicion/')
  ) {
    return {
      quality: 'editorial_media',
      blocked: true,
      reason: `Path indica contenido editorial/noticia: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.editorial_media,
    };
  }

  // ── 5c. Foro / comunidad ──────────────────────────────────────────────────────
  if (
    path.includes('/forum/') ||
    path.includes('/forums/') ||
    path.includes('/comments/')
  ) {
    return {
      quality: 'forum_or_community',
      blocked: true,
      reason: `Path indica foro/comunidad: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.forum_or_community,
    };
  }

  // ── 5d. Review / compare site ──────────────────────────────────────────────────
  if (
    path.includes('/reviews/') ||
    path.includes('/compare/') ||
    path.includes('/comparar/')
  ) {
    return {
      quality: 'review_site',
      blocked: true,
      reason: `Path indica sitio de reseñas/comparación: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.review_site,
    };
  }

  // ── 5e. Guía o tutorial ───────────────────────────────────────────────────────
  if (GUIDE_PATH_PATTERNS.some((s) => path.includes(s))) {
    return {
      quality: 'guide',
      blocked: true,
      reason: `Path indica guía o tutorial: ${path.slice(0, 80)}`,
      rankingBonus: RANKING_BONUS.guide,
    };
  }

  // ── 6. Transformación digital genérica ───────────────────────────────────────
  if (TRANSFORMATION_DIGITAL_PATH_SIGNALS.some((s) => path.includes(s))) {
    return {
      quality: 'generic_transformation_digital_page',
      blocked: true,
      reason: `Path indica página genérica de transformación digital: ${path.slice(0, 80)}`,
      rankingBonus: RANKING_BONUS.generic_transformation_digital_page,
    };
  }

  // ── 7. Artículo de contenido (slug largo con señales editoriales) ─────────────
  const hasArticleSlug = ARTICLE_SLUG_SIGNALS.some((s) => path.includes(s));
  const hasVeryLongSlug = depth === 1 && path.length > 70; // slug muy largo en primer nivel
  if (hasArticleSlug || hasVeryLongSlug) {
    return {
      quality: 'content_article',
      blocked: true,
      reason: `Path indica artículo de contenido: ${path.slice(0, 80)}`,
      rankingBonus: RANKING_BONUS.content_article,
    };
  }

  // ── 7b. Landing page de marketing/campaña — fuente primaria débil ────────────
  // Cubre patrones /lp/, /landing/, /landing-page/ que indican una página
  // de campaña, no la homepage ni una página de producto oficial.
  if (LANDING_PAGE_PATH_SIGNALS.some((s) => path.includes(s))) {
    return {
      quality: 'landing_page',
      blocked: true,
      reason: `Path indica landing page de marketing: ${path.slice(0, 80)}`,
      rankingBonus: RANKING_BONUS.landing_page,
    };
  }

  // ── 8. Homepage oficial (profundidad 0 o 1 con locale) ───────────────────────
  if (depth === 0 || (depth === 1 && /^\/[a-z]{2}(-[a-z]{2})?\/?\s*$/.test(path))) {
    return {
      quality: 'official_homepage',
      blocked: false,
      reason: 'Homepage oficial',
      rankingBonus: RANKING_BONUS.official_homepage,
    };
  }

  // ── 9. Página de producto oficial ────────────────────────────────────────────
  if (PRODUCT_PATH_PATTERNS.some((s) => path.includes(s))) {
    return {
      quality: 'official_product_page',
      blocked: false,
      reason: `Página de producto oficial: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.official_product_page,
    };
  }

  // ── 10. Página de solución oficial ───────────────────────────────────────────
  if (SOLUTION_PATH_PATTERNS.some((s) => path.includes(s))) {
    return {
      quality: 'official_solution_page',
      blocked: false,
      reason: `Página de solución oficial: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.official_solution_page,
    };
  }

  // ── 11. Página de ubicación/presencia ────────────────────────────────────────
  if (LOCATION_PATH_PATTERNS.some((s) => path.includes(s))) {
    return {
      quality: 'official_location_page',
      blocked: false,
      reason: `Página de ubicación/presencia: ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.official_location_page,
    };
  }

  // ── 12. Partner page (empresa candidata es el partner mismo) ─────────────────
  if (path.includes('/partner') || path.includes('/socios') || nameLower.includes('partner')) {
    return {
      quality: 'official_partner_page',
      blocked: false,
      reason: `Página de partner (empresa candidata es el partner): ${path.slice(0, 60)}`,
      rankingBonus: RANKING_BONUS.official_partner_page,
    };
  }

  // ── 13. Desconocida — no bloqueada por defecto para no romper candidatos válidos
  return {
    quality: 'unknown',
    blocked: false,
    reason: `URL sin clasificar: ${path.slice(0, 60) || '/'}`,
    rankingBonus: RANKING_BONUS.unknown,
  };
}

/** True si el tipo de calidad es un URL bloqueado por el gate. */
export function isBlockedBySourceUrlQuality(result: SourceUrlQualityResult): boolean {
  return BLOCKED_QUALITIES.has(result.quality);
}
