/**
 * br-domain.ts — dominios web de Brasil: la etiqueta propia de un dominio, si el
 * dominio del correo del cadastro de la Receita ENCAJA con el nombre de la
 * empresa, y los dominios del Estado.
 *
 * SOURCES-BR-LIGHT-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué «encaja con el nombre» (medido el 13-10-2026) ───────────────────
 *
 * De las 1,43 M empresas del subconjunto, 727 mil tienen correo corporativo, pero
 * 512 mil de esos correos son de la contadora, del abogado o del grupo que lleva
 * los papeles («contabilizei.com.br» aparece en 2.167 empresas,
 * «btgpactual.com» en 8.523 sociedades del grupo y en sus fondos). Sólo 215 mil
 * encajan con el nombre. Un dominio que no encaja NUNCA es la web de la empresa.
 */

import {
  emailDomain,
  isNonCorporateDomain,
  normalizeWebsiteHost,
} from '@/server/source-catalog/connectors/co-public-entities/co-domain';

/** Correo gratuito o de proveedor de internet de Brasil: nunca es la web de la empresa. */
export const BR_NON_CORPORATE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com', 'r7.com',
  'zipmail.com.br', 'oi.com.br', 'hotmail.com.br', 'outlook.com.br', 'live.com.br', 'yahoo.com.br',
  'gmail.com.br', 'ibest.com.br', 'click21.com.br', 'superig.com.br', 'pop.com.br', 'brturbo.com.br',
  'sercomtel.com.br', 'netsite.com.br', 'veloxmail.com.br', 'brfree.com.br', 'itelefonica.com.br',
  'onda.com.br', 'mailbr.com.br', 'yahoo.com.ar', 'hotmail.com.ar',
]);

/** Segundos niveles de `.br` («com.br», «gov.br», «sp.gov.br»…). */
const BR_SECOND_LEVEL: ReadonlySet<string> = new Set([
  'com', 'net', 'org', 'gov', 'edu', 'coop', 'med', 'adv', 'ind', 'eng', 'eti', 'art', 'tur', 'jus', 'mil',
  'leg', 'mp', 'def', 'emp', 'srv', 'inf', 'agr', 'tec', 'ong', 'esp', 'far', 'odo', 'psi', 'arq', 'bio',
]);

/** Siglas de los 27 estados, que van delante de `gov.br`, `leg.br`, `jus.br`, `mp.br`. */
const BR_STATES: ReadonlySet<string> = new Set([
  'ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi',
  'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to',
]);

/** Dominios del Estado brasileño. */
const BR_PUBLIC_SECTOR_DOMAIN = /(^|\.)(gov|leg|jus|mp|mil|def)\.br$/;

/** ¿Dominio del Estado brasileño (`.gov.br`, `.leg.br`, `.jus.br`, `.mp.br`…)? */
export function isBrazilPublicSectorDomain(domain: string | null | undefined): boolean {
  return typeof domain === 'string' && BR_PUBLIC_SECTOR_DOMAIN.test(domain.toLowerCase());
}

/**
 * El dominio registrable: «correio.itau.com.br» → «itau.com.br»,
 * «www.saopaulo.sp.gov.br» → «saopaulo.sp.gov.br», «ir.weg.net» → «weg.net».
 */
export function registrableBrazilDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  if (parts.length < 2) return parts.join('.');
  if (parts[parts.length - 1] !== 'br') return parts.slice(-2).join('.');
  let keep = 2;
  if (parts.length >= 3 && BR_SECOND_LEVEL.has(parts[parts.length - 2])) keep = 3;
  if (keep === 3 && parts.length >= 4 && BR_STATES.has(parts[parts.length - 3])) keep = 4;
  return parts.slice(-keep).join('.');
}

/** La etiqueta propia del dominio, sólo letras y dígitos: «magazineluiza.com.br» → «magazineluiza». */
export function brazilDomainLabel(domain: string | null | undefined): string {
  if (typeof domain !== 'string') return '';
  const host = normalizeWebsiteHost(domain) ?? domain.trim().toLowerCase();
  const first = registrableBrazilDomain(host).split('.')[0] ?? '';
  return first.replace(/[^a-z0-9]/g, '');
}

/** ¿Tienen dos dominios la misma etiqueta propia («embraer.com» ↔ «embraer.com.br»)? */
export function brazilDomainLabelsAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = brazilDomainLabel(a);
  return left.length >= 2 && left === brazilDomainLabel(b);
}

/** Palabras que no identifican a la empresa. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'para', 'com', 'ltda', 'sa', 's', 'a', 'me', 'epp', 'eireli', 'cia',
  'companhia', 'comercio', 'industria', 'servicos', 'brasil', 'brasileira', 'brasileiro', 'grupo', 'holding',
  'participacoes', 'empreendimentos', 'sociedade', 'anonima', 'limitada', 'municipio', 'prefeitura', 'municipal',
  'estado', 'governo', 'secretaria', 'universidade', 'federal', 'estadual', 'hospital', 'camara',
]);

const LINK_WORDS: ReadonlySet<string> = new Set(['de', 'do', 'da', 'dos', 'das', 'e']);

function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/**
 * ¿El dominio encaja con alguno de los nombres? Sí si la etiqueta contiene una
 * palabra propia de 4+ letras del nombre («magazineluiza» ↔ LUIZA), si es parte
 * del nombre pegado («weg» no: 3 letras; «sabesp» ↔ SABESP), o si es la sigla de
 * las palabras del nombre (3+ letras: «cpfl»).
 */
export function brazilDomainFitsName(domain: string | null | undefined, names: readonly (string | null | undefined)[]): boolean {
  const label = brazilDomainLabel(domain);
  if (label.length < 3) return false;
  for (const name of names) {
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    const all = words(name);
    const own = all.filter((w) => !STOP_WORDS.has(w));
    if (own.some((w) => w.length >= 4 && label.includes(w))) return true;
    if (own.some((w) => w.length === 3 && label === w)) return true;
    if (label.length >= 4 && own.join('').includes(label)) return true;
    const acronym = all.filter((w) => !LINK_WORDS.has(w)).map((w) => w[0]).join('');
    if (acronym.length >= 3 && (label === acronym || (acronym.length >= 4 && label.startsWith(acronym)))) return true;
  }
  return false;
}

/**
 * La web de una empresa a partir del correo del cadastro: el dominio registrable
 * cuando es corporativo y ENCAJA con su nombre. Un dominio del Estado sólo vale
 * para un ente público. `null` en cualquier otro caso.
 */
export function brazilCompanyDomainFromEmail(input: {
  email: string | null | undefined;
  names: readonly (string | null | undefined)[];
  publicEntity: boolean;
}): string | null {
  const raw = input.email?.includes('@') ? emailDomain(input.email) : normalizeWebsiteHost(input.email ?? null);
  if (raw === null) return null;
  const registrable = registrableBrazilDomain(raw);
  if (isNonCorporateDomain(registrable) || isNonCorporateDomain(raw)) return null;
  if (BR_NON_CORPORATE_EMAIL_DOMAINS.has(registrable)) return null;
  if (isBrazilPublicSectorDomain(registrable) && !input.publicEntity) return null;
  return brazilDomainFitsName(registrable, input.names) ? registrable : null;
}

/** Clave de búsqueda por dominio guardada en `normalized_legal_name`: «@magazineluiza». */
export function brazilDomainLookupKey(domain: string | null | undefined): string | null {
  const label = brazilDomainLabel(domain);
  return label.length >= 2 ? `@${label}` : null;
}
