/**
 * sv-company-web.ts — la web de una empresa de la capa gratuita de El Salvador a
 * partir de su NOMBRE, comprobada con su propia página.
 *
 * SOURCES-SV-COMPANY-WEB-1. Puro: sin env, sin I/O, sin DB, sin reloj. La descarga
 * de las páginas la hace `scripts/source-catalog/discover-sv-company-webs.mts`.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * COMPRASAL no publica correos ni webs de sus proveedores. En la 1.ª corrida
 * SV×Tecnología (08-10-2026, lote 6ff3a1b5) las 20 empresas de la capa gratuita
 * llegaron sin web, fueron a Descartadas («no cuenta para la meta») y el rescate sólo
 * encontró 2; el resto de la meta se fue a Tavily, Claude y Apollo. Con la web en la
 * fila, cuentan para la meta sin pagar.
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * 1. Direcciones candidatas SÓLO desde el nombre (razón social sin forma ni «(de) El
 *    Salvador», y el nombre comercial que la empresa registró en COMPRASAL): todas las
 *    palabras pegadas, sin palabras de enlace, la primera palabra si es distintiva;
 *    con `.com.sv`, `.sv`, `.com`, `.net`.
 * 2. La página tiene que NOMBRAR a la empresa (el nombre completo en su texto o, si
 *    es una palabra, en su título) y, fuera de `.sv`, hablar de El Salvador; una
 *    redirección sólo vale hacia otra dirección que salga de la razón social; un
 *    nombre comercial de una palabra sólo cuenta si está en la razón social. Medido
 *    el 08-10-2026: sin estas tres reglas salían «salud.com.sv», «telefonica.com» y
 *    «ehr.meditech.com». Una página aparcada,
 *    en venta o «en construcción» nunca vale.
 * 3. Si la web existe pero bloquea la lectura (Cloudflare), sólo vale una `.sv` cuya
 *    dirección ES el nombre completo pegado (8 letras o más: «datagraphics.com.sv» ↔
 *    DATA & GRAPHICS).
 *
 * Nada difuso: si ninguna candidata cumple, la empresa sigue sin web (y el rescate la
 * busca como hasta ahora).
 */

import { plainUpperSalvador, salvadorNameCore } from './sv-name-keys';

/** Terminaciones probadas, en orden. */
export const SV_COMPANY_WEB_TLDS = ['com.sv', 'sv', 'com', 'net'] as const;

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A', 'AL']);

/** Palabras que solas no identifican a una empresa (no se prueban como dirección). */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'GRUPO', 'SERVICIOS', 'SERVICIO', 'SISTEMAS', 'COMERCIAL', 'COMERCIO', 'INVERSIONES', 'DISTRIBUIDORA', 'INDUSTRIAS',
  'LABORATORIOS', 'LABORATORIO', 'CORPORACION', 'COMPANIA', 'EMPRESA', 'TECNOLOGIA', 'TECNOLOGIAS', 'SOLUCIONES',
  'INTERNACIONAL', 'CENTROAMERICA', 'CENTROAMERICANA', 'SALVADOR', 'GLOBAL', 'GENERAL', 'NACIONAL', 'MEDICA',
  'MEDICOS', 'PRODUCTOS', 'SUMINISTROS', 'EQUIPOS', 'DROGUERIA', 'FARMACIA', 'TELECOMUNICACIONES', 'COMUNICACIONES',
]);

/** Núcleo del nombre sin «(de) El Salvador» final: «IBW EL SALVADOR» → IBW. */
export function svCompanyWebNameKey(name: string | null | undefined): string {
  const core = salvadorNameCore(name);
  const without = core.replace(/ (?:DE )?EL SALVADOR$/, '');
  return without.length >= 2 ? without : core;
}

const compact = (text: string): string => text.replace(/[^A-Z0-9]/g, '');

/** Etiquetas de dirección (sin terminación) que salen de un nombre, en orden. */
export function svCompanyWebLabels(name: string | null | undefined): string[] {
  const key = svCompanyWebNameKey(name);
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
  if (first.length >= 3 && !GENERIC_WORDS.has(first) && !/^\d+$/.test(first)) add(first);
  return out;
}

/** Direcciones candidatas de una empresa por su razón social y su nombre comercial. */
export function svCompanyWebCandidates(names: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const label of svCompanyWebLabels(name)) {
      for (const tld of SV_COMPANY_WEB_TLDS) {
        const host = `${label}.${tld}`;
        if (!out.includes(host)) out.push(host);
      }
    }
  }
  return out;
}

/** Páginas aparcadas, en venta o sin contenido: nunca son la web de nadie. */
const PARKED_PAGE =
  /\b(DOMAIN (IS )?FOR SALE|THIS DOMAIN|BUY THIS DOMAIN|DOMINIO EN VENTA|DOMINIO A LA VENTA|UNDER CONSTRUCTION|EN CONSTRUCCION|COMING SOON|PROXIMAMENTE|PARKED|SEDO|GODADDY|HOSTGATOR|DEFAULT WEB PAGE|INDEX OF|ACCOUNT SUSPENDED|CUENTA SUSPENDIDA|WEBSITE IS UNDER)\b/;

/** Lo que la descarga dejó de una página. */
export type SvFetchedPage = {
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
export type SvCompanyWebRejection =
  | 'no_response'
  | 'parked'
  | 'not_named'
  | 'not_salvadoran'
  | 'blocked_not_exact'
  | 'redirected_elsewhere';

const registrableLabel = (host: string): string => {
  const parts = host.toLowerCase().replace(/^www\d?\./, '').split('.');
  const keep = parts.length >= 3 && parts[parts.length - 1].length === 2 && ['com', 'org', 'net', 'edu', 'gob'].includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep)[0] ?? '';
};

/** Nombres de la empresa: la razón social (manda) y los nombres comerciales de COMPRASAL. */
export type SvCompanyNames = { legal: readonly string[]; trade: readonly string[] };

/**
 * Las claves que puede nombrar la página: las de la razón social y, de los nombres
 * comerciales, las de varias palabras o la palabra suelta que ya está en la razón
 * social («IBW» de COMUNICACIONES IBW). Un nombre comercial suelto ajeno a la razón
 * social («SALUD» de una cooperativa ganadera) nunca.
 */
function nameKeys(names: SvCompanyNames): string[] {
  const legalKeys = names.legal.map((n) => svCompanyWebNameKey(n)).filter((k) => k.length >= 2);
  const legalWords = new Set(legalKeys.flatMap((k) => k.split(' ')));
  const tradeKeys = names.trade
    .map((n) => svCompanyWebNameKey(n))
    .filter((k) => k.length >= 2 && (k.includes(' ') || legalWords.has(k)));
  return [...new Set([...legalKeys, ...tradeKeys])];
}

/**
 * ¿Es esta página la web de la empresa? Devuelve el dominio a guardar o por qué no.
 *
 *   - Una redirección a otra dirección sólo vale si esa dirección también sale de la
 *     razón social («menfar.com» → «menarini.com» no).
 *   - Fuera de `.sv`, la página tiene que hablar de El Salvador: «telefonica.com» es
 *     la de España, «dhl.com» la de todo el mundo.
 *   - Bloqueada por un muro de bots: sólo una `.sv` cuya dirección es el nombre
 *     completo pegado (8 letras o más).
 */
export function svCompanyWebVerdict(
  page: SvFetchedPage,
  names: SvCompanyNames,
): { domain: string; check: 'page_names_company' | 'blocked_exact_name'; matchedKey: string } | { rejected: SvCompanyWebRejection } {
  if (page.status === null || page.finalHost === null) return { rejected: 'no_response' };
  const keys = nameKeys(names);
  const legalLabels = new Set(names.legal.flatMap((n) => svCompanyWebLabels(n)));
  const finalLabel = registrableLabel(page.finalHost);
  const requestedLabel = registrableLabel(page.host);
  if (finalLabel !== requestedLabel && !legalLabels.has(finalLabel)) return { rejected: 'redirected_elsewhere' };
  const domain = page.finalHost.toLowerCase().replace(/^www\d?\./, '');
  const salvadoran = domain.endsWith('.sv');

  if (page.blocked) {
    const exact = keys.find((k) => compact(k).toLowerCase() === requestedLabel && requestedLabel.length >= 8);
    return exact !== undefined && salvadoran ? { domain, check: 'blocked_exact_name', matchedKey: exact } : { rejected: 'blocked_not_exact' };
  }
  const title = ` ${plainUpperSalvador(page.title ?? '')} `;
  const text = ` ${plainUpperSalvador(`${page.title ?? ''} ${page.text ?? ''}`)} `;
  if (PARKED_PAGE.test(text)) return { rejected: 'parked' };
  if (!salvadoran && !text.includes(' SALVADOR')) return { rejected: 'not_salvadoran' };
  for (const key of keys) {
    const words = key.split(' ');
    if (words.length >= 2 && text.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
    // «DATA & GRAPHICS» se escribe «Data & Graphics» o «DataGraphics» en la página.
    if (compact(key).length >= 8 && compact(text).includes(compact(key))) return { domain, check: 'page_names_company', matchedKey: key };
    // Una palabra («GBM», «LETERAGO») en el título.
    if (words.length === 1 && key.length >= 3 && title.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
  }
  return { rejected: 'not_named' };
}

/** Título y texto visible de un HTML (sin scripts ni estilos), recortado. */
export function svExtractPageText(html: string, maxChars = 20_000): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
  return { title, text };
}

/** ¿Respuesta de un bloqueo de bots y no de la web? */
export function svIsBotWall(status: number | null, title: string | null): boolean {
  const t = (title ?? '').toLowerCase();
  return t.includes('attention required') || t.includes('just a moment') || ((status === 403 || status === 503) && t.includes('cloudflare'));
}
