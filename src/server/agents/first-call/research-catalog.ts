/**
 * Agente 3 (Rumbo) · dónde buscar a una empresa (puro).
 *
 * Dueña 19-10: la investigación tenía dos búsquedas abiertas en la web y casi siempre
 * volvía sin una noticia local con fecha. Ahora, además de esas dos, Rumbo busca la
 * empresa DENTRO de fuentes elegidas por país e industria (prensa de negocios, medios y
 * gremios del sector, medios de talento y rankings de empleadores), en lo que la propia
 * empresa publica (su sitio y su blog) y en los fragmentos públicos de LinkedIn que
 * devuelve el buscador (nunca se abre linkedin.com).
 *
 * Medido el 19-10 (banco de 10 empresas): sólo el modo `news` de Tavily trae la fecha de
 * publicación, así que la prensa y los medios de talento van en ese modo; las vacantes
 * en portales de selección no dejaron ningún dato y se quitaron.
 *
 * Todo pasa por Tavily con `include_domains` (`site:` no está soportado) y búsqueda
 * `basic` (1 crédito). Nada de esto inventa datos: cada resultado sigue siendo un
 * documento que el verificador de citas tiene que encontrar palabra por palabra.
 */

import { resolveMacroIndustryByDisplayName, isMacroIndustryKey, type MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { COUNTRY_SOURCE_CATALOG, type CountrySourceCatalog } from './research-catalog-data';

/** Tavily acepta hasta 300; más de esto diluye el ranking de una búsqueda de 6–8 resultados. */
export const MAX_INCLUDE_DOMAINS = 30;

/**
 * Prensa de negocios regional, que cubre a casi todos los países de la región. Los medios
 * de UN país (Expansión de España, Forbes Centroamérica, RRHHDigital y DCH de España)
 * van sólo en el catálogo de ese país: en Chile, RRHHDigital se llevaba los 6 resultados de
 * talento (Pizza Pizza, Prod 19-10).
 */
export const REGIONAL_BUSINESS_PRESS: readonly string[] = [
  'bloomberglinea.com',
  'americaeconomia.com',
  'bnamericas.com',
  'infobae.com',
];

/** Rankings de empleadores y medios de talento regionales. */
export const REGIONAL_HR_MEDIA: readonly string[] = [
  'merco.info',
  'greatplacetowork.com',
  'top-employers.com',
];

/** Sitios que nunca aportan un dato verificable de la empresa (redes, portales de empleo, directorios de datos). */
export const RESEARCH_NOISE_DOMAINS: readonly string[] = [
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'pinterest.com',
  'wikiwand.com',
  'dbpedia.org',
  'glassdoor.com',
  'indeed.com',
  'computrabajo.com',
  'bumeran.com',
  'zonajobs.com.ar',
  'laborum.cl',
  'elempleo.com',
  'trabajando.com',
  'occ.com.mx',
  'infojobs.net',
  'catho.com.br',
  'zoominfo.com',
  'dnb.com',
  'crunchbase.com',
  'rocketreach.co',
  'lusha.com',
  'apollo.io',
  'signalhire.com',
  'empresite.eleconomista.es',
  'einforma.com',
  'infocif.es',
  'emis.com',
  'datosperu.org',
  'universidadperu.com',
];

/** Redes: nunca son el sitio propio de la empresa. */
const SOCIAL_HOSTS = /(^|\.)(linkedin|facebook|instagram|twitter|x|tiktok|youtube)\.[a-z.]+$/i;

/** Lo que se busca en el sitio de la propia empresa: lo que ella misma cuenta, con fecha. */
const OWNED_SITE_TERMS = 'noticias OR blog OR comunicado OR sostenibilidad OR formación OR talento';
/** Lo que se busca en los medios de talento: premios de empleador, programas, cultura. */
const HR_MEDIA_TERMS = 'talento OR formación OR liderazgo OR cultura OR empleador OR ranking';

export type ResearchSearchStep = 'noticias' | 'talento' | 'prensa' | 'medios_talento' | 'sitio_propio' | 'linkedin';

export interface ResearchSearch {
  step: ResearchSearchStep;
  /** Clave del registro de uso (Uso de IA agrupa por esta). */
  operationKey: string;
  query: string;
  topic: 'news' | 'general';
  includeDomains?: readonly string[];
  excludeDomains?: readonly string[];
  maxResults?: number;
}

/** Cómo se etiqueta en la ficha lo que trajo cada búsqueda. */
export const SEARCH_STEP_DOC_LABEL: Record<ResearchSearchStep, string> = {
  noticias: 'Noticia',
  talento: 'Noticia',
  prensa: 'Prensa',
  medios_talento: 'Talento',
  sitio_propio: 'Sitio oficial',
  linkedin: 'LinkedIn',
};

function unique(domains: Iterable<string>): string[] {
  return [...new Set([...domains].map((d) => d.trim().toLowerCase()).filter(Boolean))];
}

/** La macro industria de la cuenta (guardada como clave o como su nombre visible). */
export function accountMacroIndustry(industry: string | null | undefined): MacroIndustryKey | null {
  if (!industry) return null;
  if (isMacroIndustryKey(industry)) return industry;
  return resolveMacroIndustryByDisplayName(industry)?.key ?? null;
}

export interface AccountSources {
  /** Prensa de negocios del país, medios del sector y prensa regional. */
  press: string[];
  /** Medios de talento del país y rankings de empleadores. */
  hrMedia: string[];
  /** ¿Hay catálogo propio de este país? (si no, sólo lo regional) */
  countryCovered: boolean;
}

/** Las fuentes donde buscar a una empresa de este país e industria. */
export function sourcesForAccount(countryCode: string | null | undefined, industry: string | null | undefined): AccountSources {
  const catalog: CountrySourceCatalog | undefined = countryCode ? COUNTRY_SOURCE_CATALOG[countryCode.toUpperCase()] : undefined;
  const macro = accountMacroIndustry(industry);
  const sector = catalog && macro ? (catalog.industryMedia[macro] ?? []) : [];
  // El sector primero: si hay que recortar, se recorta la prensa regional.
  const press = unique([...sector, ...(catalog?.businessPress ?? []), ...REGIONAL_BUSINESS_PRESS]).slice(0, MAX_INCLUDE_DOMAINS);
  const hrMedia = unique([...(catalog?.hrMedia ?? []), ...REGIONAL_HR_MEDIA]).slice(0, MAX_INCLUDE_DOMAINS);
  return { press, hrMedia, countryCovered: !!catalog };
}

/**
 * Dónde aparece públicamente el decisor de RR. HH. de un país: nombramientos, entrevistas,
 * ponentes y premios (las fuentes del decisor de cada informe, más los medios de talento).
 */
export function decisionMakerSourcesFor(countryCode: string | null | undefined): string[] {
  const catalog = countryCode ? COUNTRY_SOURCE_CATALOG[countryCode.toUpperCase()] : undefined;
  if (!catalog) return [];
  return unique([...catalog.decisionMakerSources, ...catalog.hrMedia, ...catalog.businessPress]).slice(0, MAX_INCLUDE_DOMAINS);
}

/** El dominio de la empresa sin protocolo, `www.` ni ruta. */
export function bareDomain(websiteOrDomain: string | null | undefined): string | null {
  if (!websiteOrDomain) return null;
  const host = websiteOrDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
  return host.includes('.') ? host : null;
}

/**
 * El plan de búsquedas de la empresa. Con `extended` en falso queda el de siempre (dos
 * búsquedas abiertas); con verdadero suma las de fuentes elegidas. Como mucho 6 créditos.
 */
export function buildResearchSearchPlan(params: {
  name: string;
  country: string | null;
  countryCode: string | null;
  industry: string | null;
  domain: string | null;
  extended: boolean;
}): ResearchSearch[] {
  const quoted = `"${params.name}"`;
  const exclude = params.extended ? RESEARCH_NOISE_DOMAINS : undefined;
  const plan: ResearchSearch[] = [
    { step: 'noticias', operationKey: 'account_research_news', query: `${quoted} ${params.country ?? ''}`.trim(), topic: 'news', excludeDomains: exclude },
    { step: 'talento', operationKey: 'account_research_talent', query: `${quoted} empleo formación talento cultura`, topic: 'general', excludeDomains: exclude },
  ];
  if (!params.extended) return plan;

  const sources = sourcesForAccount(params.countryCode, params.industry);
  plan.push({ step: 'prensa', operationKey: 'account_research_press', query: quoted, topic: 'news', includeDomains: sources.press, maxResults: 8 });
  plan.push({ step: 'medios_talento', operationKey: 'account_research_hr_media', query: `${quoted} ${HR_MEDIA_TERMS}`, topic: 'news', includeDomains: sources.hrMedia });
  const own = bareDomain(params.domain);
  // Una cuenta cuyo «sitio» es su página de LinkedIn o Facebook no tiene sitio propio que buscar.
  if (own && !SOCIAL_HOSTS.test(own)) {
    plan.push({ step: 'sitio_propio', operationKey: 'account_research_owned', query: `${quoted} ${OWNED_SITE_TERMS}`, topic: 'general', includeDomains: [own] });
  }
  plan.push({ step: 'linkedin', operationKey: 'account_research_linkedin', query: `${quoted} ${params.country ?? ''}`.trim(), topic: 'general', includeDomains: ['linkedin.com'] });
  return plan;
}
