/**
 * ve-company-web.ts — la web de una entidad de la capa gratuita de Venezuela a partir
 * de su NOMBRE, comprobada con su propia página.
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj. La descarga de las
 * páginas la hace `scripts/source-catalog/discover-ve-company-webs.mts`.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * La SUDEASEG y la SUNAVAL no publican la web de sus reguladas. Sin web, la empresa
 * de la capa gratuita va a Descartadas («no cuenta para la meta») y el resto de la
 * meta se paga (Tavily, Claude, Apollo). Misma regla que El Salvador
 * (`sv-company-web.ts`, 08-10-2026).
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * 1. Direcciones candidatas SÓLO desde el nombre (núcleo sin forma ni «(de)
 *    Venezuela»): todas las palabras pegadas, sin palabras de enlace, y la primera
 *    palabra si es distintiva; con `.com.ve`, `.com`, `.ve`, `.net`.
 * 2. La página tiene que NOMBRAR a la entidad (el nombre completo en su texto o, si es
 *    una palabra, en su título) y, fuera de `.ve`, hablar de Venezuela. Una
 *    redirección sólo vale hacia otra dirección que salga del mismo nombre. Una página
 *    aparcada, en venta o «en construcción» nunca vale.
 * 3. Si la web existe pero bloquea la lectura, sólo vale una `.ve` cuya dirección ES
 *    el nombre completo pegado (8 letras o más).
 *
 * Nada difuso: si ninguna candidata cumple, la entidad sigue sin web (y el rescate la
 * busca como hasta ahora).
 */

import { plainUpperVenezuela, venezuelaNameCore } from './ve-name-keys';

/** Terminaciones probadas, en orden. */
export const VE_COMPANY_WEB_TLDS = ['com.ve', 'com', 've', 'net'] as const;

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A', 'AL']);

/** Palabras que solas no identifican a una empresa (no se prueban como dirección). */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'GRUPO', 'SERVICIOS', 'SERVICIO', 'SISTEMAS', 'COMERCIAL', 'COMERCIO', 'INVERSIONES', 'INVERSORA', 'DISTRIBUIDORA',
  'INDUSTRIAS', 'LABORATORIOS', 'LABORATORIO', 'CORPORACION', 'COMPANIA', 'EMPRESA', 'TECNOLOGIA', 'SOLUCIONES',
  'INTERNACIONAL', 'VENEZUELA', 'VENEZOLANA', 'VENEZOLANO', 'GLOBAL', 'GENERAL', 'NACIONAL', 'MEDICA', 'PRODUCTOS',
  'SUMINISTROS', 'SEGUROS', 'SEGURO', 'CORRETAJE', 'SOCIEDAD', 'ASOCIACION', 'COOPERATIVA', 'ADMINISTRADORA',
  'FINANCIADORA', 'AJUSTES', 'AJUSTADORES', 'ASESORES', 'FONDO', 'BANCO', 'CASA', 'CAPITAL', 'VALORES', 'PROMOTORA',
  'MEDICINA', 'SALUD', 'PLAN', 'ALIANZA', 'UNION',
]);

/** Núcleo del nombre sin «(de) Venezuela» final: «LOCKTON VENEZUELA» → LOCKTON. */
export function veCompanyWebNameKey(name: string | null | undefined): string {
  const core = venezuelaNameCore(name);
  const without = core.replace(/ (?:DE )?(?:VENEZUELA|VZLA)$/, '');
  return without.length >= 2 ? without : core;
}

const compact = (text: string): string => text.replace(/[^A-Z0-9]/g, '');

/** Etiquetas de dirección (sin terminación) que salen de un nombre, en orden. */
export function veCompanyWebLabels(name: string | null | undefined): string[] {
  const key = veCompanyWebNameKey(name);
  if (key.length < 2) return [];
  const words = key.split(' ').filter((w) => w.length > 0);
  const content = words.filter((w) => !LINK_WORDS.has(w));
  const out: string[] = [];
  const add = (label: string): void => {
    const l = label.toLowerCase();
    if (l.length >= 3 && l.length <= 40 && /[a-z]/.test(l) && !out.includes(l)) out.push(l);
  };
  add(compact(words.join('')));
  add(compact(content.join('')));
  const first = compact(content[0] ?? '');
  if (first.length >= 4 && !GENERIC_WORDS.has(first) && !/^\d+$/.test(first)) add(first);
  return out;
}

/** Direcciones candidatas de una entidad por sus nombres. */
export function veCompanyWebCandidates(names: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const label of veCompanyWebLabels(name)) {
      for (const tld of VE_COMPANY_WEB_TLDS) {
        const host = `${label}.${tld}`;
        if (!out.includes(host)) out.push(host);
      }
    }
  }
  return out;
}

/** Páginas aparcadas, en venta o sin contenido: nunca son la web de nadie. */
const PARKED_PAGE =
  /\b(DOMAIN (IS )?FOR SALE|THIS DOMAIN|BUY THIS DOMAIN|DOMINIO EN VENTA|DOMINIO A LA VENTA|UNDER CONSTRUCTION|EN CONSTRUCCION|COMING SOON|PROXIMAMENTE|PARKED|SEDO|GODADDY|HOSTGATOR|HUGEDOMAINS|DEFAULT WEB PAGE|INDEX OF|ACCOUNT SUSPENDED|CUENTA SUSPENDIDA|WEBSITE IS UNDER|SITIO EN MANTENIMIENTO)\b/;

/** Lo que la descarga dejó de una página. */
export type VeFetchedPage = {
  /** Dirección pedida (sin protocolo). */
  host: string;
  /** Dirección final tras redirecciones (sin protocolo), si respondió. */
  finalHost: string | null;
  status: number | null;
  /** `true` si respondió un bloqueo de bots (Cloudflare «Attention Required», 403/503). */
  blocked: boolean;
  title: string | null;
  /** Texto visible (sin etiquetas), recortado. */
  text: string | null;
};

/** Por qué una página no se acepta. */
export type VeCompanyWebRejection = 'no_response' | 'parked' | 'not_named' | 'not_venezuelan' | 'blocked_not_exact' | 'redirected_elsewhere';

const registrableLabel = (host: string): string => {
  const parts = host.toLowerCase().replace(/^www\d?\./, '').split('.');
  const keep = parts.length >= 3 && parts[parts.length - 1].length === 2 && ['com', 'org', 'net', 'edu', 'gob', 'co', 'web'].includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep)[0] ?? '';
};

/** Dominio a guardar: sin «www.» y registrable («portal.x.com.ve» → «x.com.ve»). */
function storedDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\d?\./, '').split('.');
  const keep = parts.length >= 3 && parts[parts.length - 1].length === 2 && ['com', 'org', 'net', 'edu', 'gob', 'co', 'web'].includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/**
 * ¿Es esta página la web de la entidad? Devuelve el dominio a guardar o por qué no.
 */
export function veCompanyWebVerdict(
  page: VeFetchedPage,
  names: readonly string[],
): { domain: string; check: 'page_names_company' | 'blocked_exact_name'; matchedKey: string } | { rejected: VeCompanyWebRejection } {
  if (page.status === null || page.finalHost === null) return { rejected: 'no_response' };
  const keys = [...new Set(names.map((n) => veCompanyWebNameKey(n)).filter((k) => k.length >= 2))];
  const ownLabels = new Set(names.flatMap((n) => veCompanyWebLabels(n)));
  const finalLabel = registrableLabel(page.finalHost);
  const requestedLabel = registrableLabel(page.host);
  if (finalLabel !== requestedLabel && !ownLabels.has(finalLabel)) return { rejected: 'redirected_elsewhere' };
  const domain = storedDomain(page.finalHost);
  const venezuelan = domain.endsWith('.ve');

  if (page.blocked) {
    const exact = keys.find((k) => compact(k).toLowerCase() === requestedLabel && requestedLabel.length >= 8);
    return exact !== undefined && venezuelan ? { domain, check: 'blocked_exact_name', matchedKey: exact } : { rejected: 'blocked_not_exact' };
  }
  const title = ` ${plainUpperVenezuela(page.title ?? '')} `;
  const text = ` ${plainUpperVenezuela(`${page.title ?? ''} ${page.text ?? ''}`)} `;
  if (PARKED_PAGE.test(text)) return { rejected: 'parked' };
  if (!venezuelan && !/ (VENEZUELA|CARACAS|VALENCIA|MARACAIBO|BARQUISIMETO) /.test(text)) return { rejected: 'not_venezuelan' };
  for (const key of keys) {
    const words = key.split(' ');
    if (words.length >= 2 && text.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
    if (compact(key).length >= 8 && compact(text).includes(compact(key))) return { domain, check: 'page_names_company', matchedKey: key };
    if (words.length === 1 && key.length >= 3 && title.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
  }
  return { rejected: 'not_named' };
}
