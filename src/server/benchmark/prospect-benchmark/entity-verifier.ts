/**
 * Benchmark — Entity Verifier (Hito 16AB.23.1)
 *
 * Clasificación determinística de tipo de entidad y detección de nombres sospechosos.
 * Sin llamadas externas. Sin efectos secundarios. Provider-agnostic.
 */

import type { EntityType } from './types';

// ─── Patrones de URL por tipo ─────────────────────────────────────────────────

const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com']);

const KNOWN_DIRECTORY_HOSTS = new Set([
  'latamfintech.co',
  'paginas-amarillas.co',
  'yellowpages.com.co',
  'directorio.co',
  'empresa.com.co',
  'colombia.com',
  'portafolio.co',
  'larepublica.co',
  'semana.com',
  'dinero.com',
  'elempresario.com.co',
]);

const KNOWN_ASSOCIATION_HOSTS = new Set([
  'colombiafintech.co',
  'fedesoft.com.co',
  'cintel.org.co',
  'ccit.org.co',
  'camaraedtech.com',
  'camacol.co',
]);

const DIRECTORY_PATH_PATTERNS = [
  /\/segments?\//i,
  /\/categories?\//i,
  /\/tags?\//i,
  /\/directorio\//i,
  /\/listado\//i,
  /\/empresas\//i,
  /\/ranking\//i,
];

const ARTICLE_PATH_PATTERNS = [
  /\/blog\//i,
  /\/news\//i,
  /\/noticias?\//i,
  /\/articulo\//i,
  /\/post\//i,
  /\/noticia\//i,
  /\/contenido\//i,
  /\/publicacion(es)?\//i,
];

// ─── Patrones de nombre sospechoso ────────────────────────────────────────────

const QUESTION_MARK_RE = /\?/;

const EMOJI_RE = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u;

const ALT_TEXT_RE = /\b(icon|image|img|logo|isotype|home|banner|thumbnail|avatar|hero)\b/i;

const ASSOCIATION_WORDS_RE =
  /\b(asociaci[oó]n|gremio|c[aá]mara\s+de\s+comercio|federaci[oó]n|uni[oó]n\s+de|liga\s+de|alianza\s+de|consorcio|comit[eé]|colectivo|ecosistema)\b/i;

const CONTENT_VERBS_RE =
  /\b(protege|descubre|conoce|consulta|recomiendan|aprende|explora|accede|mejora|optimiza|impulsa|transforma|gu[ií]a|guía de|aprende|empieza|descarga|suscr[ií]bete)\b/i;

const CONTENT_WORDS_RE =
  /\b(art[ií]culo|noticias?|gu[ií]a|ranking|los mejores|las mejores|mejores empresas|mejores herramientas|soluci[oó]n(es)?|consultor[ií]a|evento|conferencia|webinar|foro|podcast|newsletter|reporte|informe|tendencias)\b/i;

const MARKETING_PHRASE_RE =
  /\b(la mejor|el mejor|#\d+|top \d+|c[oó]mo|qu[eé] es|para tu|para su|para una|para pyme|gratis|free|descuento)\b/i;

// Long name threshold (beyond which it's almost certainly a title/description)
const MAX_COMPANY_NAME_LENGTH = 65;

// ─── Clasificación por URL ────────────────────────────────────────────────────

export function classifyByUrl(url: string | null): EntityType | null {
  if (!url) return null;

  let hostname: string;
  let pathname: string;

  try {
    const u = new URL(url);
    hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    pathname = u.pathname.toLowerCase();
  } catch {
    return null;
  }

  if (REDDIT_HOSTS.has(hostname) || REDDIT_HOSTS.has(`www.${hostname}`)) return 'forum_post';
  if (KNOWN_ASSOCIATION_HOSTS.has(hostname)) return 'association';

  // Directory host with segment/category path = directory
  if (KNOWN_DIRECTORY_HOSTS.has(hostname)) {
    if (DIRECTORY_PATH_PATTERNS.some((p) => p.test(pathname))) return 'directory';
    // Top-level pages of news/media = article
    if (ARTICLE_PATH_PATTERNS.some((p) => p.test(pathname))) return 'article';
    return 'directory';
  }

  if (DIRECTORY_PATH_PATTERNS.some((p) => p.test(pathname))) return 'directory';
  if (ARTICLE_PATH_PATTERNS.some((p) => p.test(pathname))) return 'article';

  return null;
}

// ─── Clasificación por nombre ─────────────────────────────────────────────────

export type NameAnalysis = {
  suspicious: boolean;
  likely_type: EntityType | null;
  reason: string | null;
};

export function analyzeNameSuspicion(name: string): NameAnalysis {
  const trimmed = name.trim();

  if (QUESTION_MARK_RE.test(trimmed)) {
    return { suspicious: true, likely_type: 'forum_post', reason: 'Name contains question mark — likely a forum question or article title' };
  }

  if (EMOJI_RE.test(trimmed)) {
    return { suspicious: true, likely_type: null, reason: 'Name contains emoji — likely a social post or category label, not a legal entity' };
  }

  if (ALT_TEXT_RE.test(trimmed)) {
    return { suspicious: true, likely_type: 'unknown', reason: 'Name appears to be image alt text (icon/logo/isotype/home)' };
  }

  if (ASSOCIATION_WORDS_RE.test(trimmed)) {
    return { suspicious: true, likely_type: 'association', reason: 'Name contains association/federation keyword' };
  }

  if (CONTENT_VERBS_RE.test(trimmed)) {
    return { suspicious: true, likely_type: 'article', reason: 'Name contains action verb typical of article or service-page title' };
  }

  if (CONTENT_WORDS_RE.test(trimmed)) {
    return { suspicious: true, likely_type: 'article', reason: 'Name contains content/editorial keyword, not a company name' };
  }

  if (MARKETING_PHRASE_RE.test(trimmed)) {
    return { suspicious: true, likely_type: 'article', reason: 'Name contains marketing/SEO phrase typical of landing page or article title' };
  }

  if (trimmed.length > MAX_COMPANY_NAME_LENGTH) {
    return {
      suspicious: true,
      likely_type: 'article',
      reason: `Name exceeds ${MAX_COMPANY_NAME_LENGTH} characters (${trimmed.length}) — almost certainly an article title or page description`,
    };
  }

  return { suspicious: false, likely_type: null, reason: null };
}

// ─── Clasificador principal ───────────────────────────────────────────────────

export type EntityClassification = {
  entity_type: EntityType;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  send_to_identity_resolution: boolean;
};

export function classifyEntity(
  name: string,
  url: string | null,
  description: string | null,
): EntityClassification {
  // 1. Hard URL-based rejection
  const urlType = classifyByUrl(url);
  if (urlType === 'forum_post') {
    return {
      entity_type: 'forum_post',
      confidence: 'high',
      reason: `URL belongs to a forum/social platform (${url})`,
      send_to_identity_resolution: false,
    };
  }
  if (urlType === 'association') {
    // If the name looks like a company it could still be worth resolution
    const nameAnalysis = analyzeNameSuspicion(name);
    return {
      entity_type: 'association',
      confidence: 'high',
      reason: `URL belongs to a known association/trade body (${url})`,
      send_to_identity_resolution: nameAnalysis.suspicious,
    };
  }
  if (urlType === 'directory') {
    return {
      entity_type: 'directory',
      confidence: 'high',
      reason: `URL matches directory/listing pattern (${url})`,
      send_to_identity_resolution: true, // may mention a real company
    };
  }

  // 2. Name analysis
  const nameAnalysis = analyzeNameSuspicion(name);
  if (nameAnalysis.suspicious) {
    const likelyType = nameAnalysis.likely_type ?? (urlType ?? 'unknown');
    // Article or URL-derived article type → send to identity resolution
    const isContent = likelyType === 'article' || likelyType === 'blog_post' || urlType === 'article';
    return {
      entity_type: likelyType,
      confidence: 'medium',
      reason: nameAnalysis.reason ?? 'Suspicious name pattern detected',
      // urlType cannot be 'directory' here (already returned above) — kept for clarity
      send_to_identity_resolution: isContent,
    };
  }

  // 3. URL article path (even if name looks OK)
  if (urlType === 'article') {
    return {
      entity_type: 'article',
      confidence: 'medium',
      reason: `URL matches article/blog path pattern — name may be a company but URL is not the official site`,
      send_to_identity_resolution: true,
    };
  }

  // 4. Description-based hints (only if name was already suspicious or type is unknown)
  if (description) {
    const descLower = description.toLowerCase();
    if (descLower.includes('somos la asociación') || descLower.includes('somos el ecosistema')) {
      return {
        entity_type: 'association',
        confidence: 'medium',
        reason: 'Description identifies entity as an association or trade body',
        send_to_identity_resolution: false,
      };
    }
  }

  // 5. Default: treat as company candidate
  return {
    entity_type: 'company',
    confidence: 'low',
    reason: 'No rejection signals detected — treating as company candidate (requires further verification)',
    send_to_identity_resolution: false,
  };
}

// ─── Helpers exportados ───────────────────────────────────────────────────────

export function isRedditUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === 'reddit.com' || host.endsWith('.reddit.com');
  } catch {
    return false;
  }
}

export function isNonOfficialHost(url: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return (
      REDDIT_HOSTS.has(host) ||
      KNOWN_DIRECTORY_HOSTS.has(host) ||
      KNOWN_ASSOCIATION_HOSTS.has(host)
    );
  } catch {
    return false;
  }
}
