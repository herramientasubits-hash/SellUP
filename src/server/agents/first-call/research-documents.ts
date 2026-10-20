/**
 * Agente 3 · Primera llamada — juntar lo que se va a leer (sitio y noticias).
 *
 * Todo lo que entra aquí se descarga NOSOTROS (sitio oficial) o viene de Tavily
 * con su texto: así la cita de cada hecho se puede comprobar contra el texto real.
 */

import type { SafePageFetchResult } from '../prospecting-toolkit/website-verifier';
import { extractVisibleText } from '../prospecting-toolkit/claude-classifier/page-text';
import { isUbitsCompetitorDomain } from '../prospecting-toolkit/claude-classifier/ubits-competitors';
import { normalizeDomain } from '../prospecting-toolkit/normalization';
import { DOC_TEXT_MAX_CHARS, type ResearchDocument } from './research-prompt';
import { resultMentionsCompany } from './curated-match';
import { SEARCH_STEP_DOC_LABEL, type ResearchSearchStep } from './research-catalog';
import { MAX_SITE_PAGES, SITE_PAGE_LABELS, pickSitePages, type SitePageKind } from './site-pages';

/** Menos texto que esto = página vacía o bloqueada: no se manda al modelo. */
export const MIN_DOC_TEXT_CHARS = 200;
/** Texto de la portada: un poco más largo que el de las demás páginas. */
const HOME_TEXT_MAX_CHARS = 8_000;

export interface NewsResult {
  url: string;
  title: string | null;
  content: string | null;
  publishedOn: string | null;
}

export interface NewsSearchOutput {
  results: NewsResult[];
  /** Créditos que Tavily dijo cobrar (null = no informó). */
  credits: number | null;
  skipped: boolean;
  error: string | null;
}

export interface SiteReadResult {
  documents: ResearchDocument[];
  pageKinds: SitePageKind[];
  homeReachable: boolean;
  pagesRead: number;
}

function toUrl(websiteOrDomain: string): string {
  const trimmed = websiteOrDomain.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function usable(page: SafePageFetchResult): boolean {
  return !!page.html && (page.httpStatus ?? 0) < 400;
}

/** Portada + hasta cinco páginas por tema, en paralelo. Nunca lanza. */
export async function readOfficialSite(
  websiteOrDomain: string | null,
  fetchPage: (url: string) => Promise<SafePageFetchResult>,
): Promise<SiteReadResult> {
  const empty: SiteReadResult = { documents: [], pageKinds: [], homeReachable: false, pagesRead: 0 };
  if (!websiteOrDomain) return empty;

  let home: SafePageFetchResult;
  try {
    home = await fetchPage(toUrl(websiteOrDomain));
  } catch {
    return empty;
  }
  if (!usable(home)) return empty;
  const homeUrl = home.finalUrl ?? home.requestedUrl;
  const homeText = extractVisibleText(home.html!, HOME_TEXT_MAX_CHARS);
  const documents: ResearchDocument[] = [];
  if (homeText.length >= MIN_DOC_TEXT_CHARS) {
    documents.push({ docId: '', url: homeUrl, label: 'Sitio oficial · Portada', kind: 'official_site', text: homeText, publishedOn: null });
  }

  const links = pickSitePages(home.html!, homeUrl, MAX_SITE_PAGES - 1);
  const pages = await Promise.all(
    links.map(async (link) => {
      try {
        const page = await fetchPage(link.url);
        if (!usable(page)) return null;
        const text = extractVisibleText(page.html!, DOC_TEXT_MAX_CHARS);
        if (text.length < MIN_DOC_TEXT_CHARS) return null;
        return { link, url: page.finalUrl ?? link.url, text };
      } catch {
        return null;
      }
    }),
  );
  const pageKinds: SitePageKind[] = [];
  for (const page of pages) {
    if (!page) continue;
    pageKinds.push(page.link.kind);
    documents.push({
      docId: '',
      url: page.url,
      label: SITE_PAGE_LABELS[page.link.kind],
      kind: 'official_site',
      text: page.text,
      publishedOn: null,
    });
  }
  return { documents, pageKinds, homeReachable: true, pagesRead: 1 + pages.filter(Boolean).length };
}

/** Sitios que no son fuente útil de una noticia sobre la empresa. */
const NOISE_HOSTS = /(^|\.)(facebook|instagram|twitter|x|tiktok|youtube|linkedin|pinterest|computrabajo|indeed|glassdoor|wikipedia)\.[a-z.]+$/i;

/**
 * LinkedIn sólo por el fragmento del buscador (nunca se abre la página) y sólo la página
 * de la empresa (`/company/`): `/posts/` y `/pulse/` suelen ser de personas (de un
 * empleado o de un homónimo), y perfiles y empleos tampoco.
 */
const LINKEDIN_COMPANY_PATH = /linkedin\.com\/company\//i;

/** El host de una URL sin `www.` (o `null`). */
export function hostOfUrl(url: string): string | null {
  return normalizeDomain(url);
}

/** Búsquedas en fuentes elegidas: traen notas del tema aunque no sean de la empresa. */
const FILTERED_STEPS: ReadonlySet<ResearchSearchStep> = new Set(['prensa', 'medios_talento', 'linkedin']);

/** Filtro para quedarse con la primera aparición de cada URL (varias búsquedas traen la misma). */
export function firstOfEachUrl(): (doc: ResearchDocument) => boolean {
  const seen = new Set<string>();
  return (doc) => {
    if (seen.has(doc.url)) return false;
    seen.add(doc.url);
    return true;
  };
}

/**
 * Resultados de búsqueda como documentos: sin redes, sin portales de empleo prohibidos y
 * sin competidores. `step` dice de qué búsqueda vienen (cambia la etiqueta y, en la de
 * LinkedIn, deja pasar sólo las páginas de empresa y sus publicaciones).
 */
export function newsToDocuments(
  results: readonly NewsResult[],
  companyDomain: string | null,
  step: ResearchSearchStep = 'noticias',
  companyName: string | null = null,
): ResearchDocument[] {
  const own = companyDomain ? normalizeDomain(companyDomain) : null;
  const seen = new Set<string>();
  const documents: ResearchDocument[] = [];
  for (const result of results) {
    const host = normalizeDomain(result.url);
    const text = [result.title, result.content].filter(Boolean).join('\n').trim();
    if (!host || isUbitsCompetitorDomain(result.url)) continue;
    const isLinkedIn = /(^|\.)linkedin\.com$/i.test(host);
    if (step === 'linkedin' ? !isLinkedIn || !LINKEDIN_COMPANY_PATH.test(result.url) : NOISE_HOSTS.test(host)) continue;
    if (text.length < 80 || seen.has(result.url)) continue;
    // En las fuentes elegidas (prensa, talento, LinkedIn) sólo entra lo que nombra a la empresa.
    if (companyName && FILTERED_STEPS.has(step) && !resultMentionsCompany(text, companyName, companyDomain)) continue;
    seen.add(result.url);
    // Un subdominio de la empresa (ir.empresa.com, blog.empresa.com) es la empresa hablando.
    const isOwn = own !== null && (host === own || host.endsWith(`.${own}`));
    const isReport = /\.pdf($|[?#])/i.test(result.url);
    documents.push({
      docId: '',
      url: result.url,
      label: isOwn
        ? isReport
          ? 'Sitio oficial · Informe'
          : 'Sitio oficial · Publicación'
        : step === 'linkedin'
          ? 'LinkedIn · fragmento del buscador'
          : `${SEARCH_STEP_DOC_LABEL[step]} · ${host}`,
      kind: isOwn ? 'official_site' : 'news',
      text: text.slice(0, DOC_TEXT_MAX_CHARS),
      publishedOn: result.publishedOn,
    });
  }
  return documents;
}

/** Numera los documentos D1, D2… en el orden en que se mandan. */
export function numberDocuments(documents: readonly ResearchDocument[]): ResearchDocument[] {
  return documents.map((d, i) => ({ ...d, docId: `D${i + 1}` }));
}
