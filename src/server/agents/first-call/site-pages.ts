/**
 * Agente 3 · Primera llamada — qué páginas del sitio oficial leer (puro).
 *
 * De la portada se sacan los enlaces internos y se eligen, por palabras de la
 * URL o del texto del enlace, hasta una página por tema: «nosotros», empleo,
 * prensa, sostenibilidad y sedes. Leerlas es gratis (las descargamos nosotros).
 */

import { normalizeDomain } from '../prospecting-toolkit/normalization';

export type SitePageKind = 'about' | 'careers' | 'news' | 'sustainability' | 'locations';

/** Portada + hasta cinco páginas: el tope de páginas que se leen por empresa. */
export const MAX_SITE_PAGES = 6;

const KIND_PATTERNS: ReadonlyArray<readonly [SitePageKind, RegExp]> = [
  ['careers', /(trabaja|trabajo|empleo|vacante|carrera|careers?|jobs?|talento|unete|únete|join|work-with-us|bolsa)/i],
  ['news', /(prensa|noticia|news|sala-de-prensa|press|comunicado|blog|actualidad|novedades)/i],
  ['about', /(nosotros|quienes|quiénes|about|empresa|historia|compan[iy]|acerca|conocenos|conócenos|who-we-are)/i],
  ['sustainability', /(sostenib|sustentab|sustainab|responsabilidad|informe|reporte|memoria|esg|rse|impacto)/i],
  ['locations', /(sedes|oficinas|ubicacion|ubicación|locations|presencia|paises|países|tiendas|sucursales)/i],
];

/** Orden en que se eligen: lo más útil para una primera llamada primero. */
export const SITE_PAGE_PRIORITY: readonly SitePageKind[] = ['about', 'careers', 'news', 'sustainability', 'locations'];

export const SITE_PAGE_LABELS: Readonly<Record<SitePageKind, string>> = {
  about: 'Sitio oficial · Nosotros',
  careers: 'Sitio oficial · Empleo',
  news: 'Sitio oficial · Prensa',
  sustainability: 'Sitio oficial · Sostenibilidad',
  locations: 'Sitio oficial · Sedes',
};

const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|#|$)/i;

export interface SitePageLink {
  url: string;
  kind: SitePageKind;
}

function anchorLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const text = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    links.push({ href: match[2].trim(), text });
  }
  return links;
}

function sameSite(url: URL, baseDomain: string): boolean {
  const domain = normalizeDomain(url.href);
  // La misma empresa o un subdominio suyo; nunca un dominio padre («com.co»).
  return !!domain && (domain === baseDomain || domain.endsWith(`.${baseDomain}`));
}

/** Tipo de página según la ruta o, si la ruta no dice nada, el texto del enlace. */
export function classifySitePage(path: string, linkText: string): SitePageKind | null {
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(path)) return kind;
  }
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(linkText)) return kind;
  }
  return null;
}

/**
 * Enlaces internos de la portada, uno por tema y en orden de prioridad. Nunca la
 * portada misma, archivos (PDF, imágenes) ni otros dominios.
 */
export function pickSitePages(html: string, pageUrl: string, max: number = MAX_SITE_PAGES - 1): SitePageLink[] {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return [];
  }
  const baseDomain = normalizeDomain(base.href);
  if (!baseDomain) return [];

  const byKind = new Map<SitePageKind, string>();
  for (const link of anchorLinks(html)) {
    if (!link.href || link.href.startsWith('#') || /^(mailto|tel|javascript):/i.test(link.href)) continue;
    let url: URL;
    try {
      url = new URL(link.href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || !sameSite(url, baseDomain)) continue;
    if (SKIP_EXTENSIONS.test(url.pathname)) continue;
    const path = decodeURIComponent(url.pathname).toLowerCase();
    if (path === '/' || path === base.pathname.toLowerCase()) continue;
    const kind = classifySitePage(path, link.text);
    if (!kind || byKind.has(kind)) continue;
    url.hash = '';
    byKind.set(kind, url.href);
  }

  return SITE_PAGE_PRIORITY.filter((kind) => byKind.has(kind))
    .slice(0, Math.max(0, max))
    .map((kind) => ({ kind, url: byKind.get(kind)! }));
}
