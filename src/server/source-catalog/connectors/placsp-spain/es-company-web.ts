/**
 * es-company-web.ts — la web de una empresa de la capa gratuita de España a partir de
 * su NOMBRE, comprobada con su propia página.
 *
 * SOURCES-ES-WEBS-1. Puro: sin env, sin I/O, sin DB, sin reloj. La descarga de las
 * páginas la hace `scripts/source-catalog/discover-es-company-webs.mts`.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * Ni la Plataforma de Contratación ni la BDNS publican la web de las empresas: sólo
 * 649 de 13.598 filas de `es_free_directory` la traían. La 2.ª corrida ES×Tecnología
 * (14-10-2026) propuso 10 grandes privadas sin web; el rescate con Claude tardó ~3
 * minutos, siguió con Tavily y Apollo y la corrida se quedó sin tiempo. Misma regla
 * que Venezuela (`ve-company-web.ts`) y El Salvador.
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * 1. Direcciones candidatas SÓLO desde el nombre (núcleo sin forma ni «(de) España»):
 *    todas las palabras pegadas, sin palabras de enlace, las dos primeras distintivas
 *    y la primera si es distintiva; con `.es`, `.com`, `.eu`, `.net`.
 * 2. La página tiene que NOMBRAR a la empresa (el nombre en su texto o, si es una
 *    palabra, en su título) y, fuera de `.es`, hablar de España. Una redirección sólo
 *    vale hacia otra dirección que salga del mismo nombre. Una página aparcada, en
 *    venta o «en construcción» nunca vale.
 *    Si el nombre es largo, también vale la MARCA: la dirección es su primera palabra
 *    distintiva (5+ letras), es `.es` y el título de la página la lleva.
 * 3. Si la web existe pero bloquea la lectura, sólo vale una `.es` cuya dirección ES
 *    el nombre completo pegado (8 letras o más).
 *
 * Nada difuso: si ninguna candidata cumple, la empresa sigue sin web (y el rescate la
 * busca como hasta ahora).
 */

import { plainUpperSpain, spainNameCore } from './es-name-keys';

/** Terminaciones probadas, en orden. */
export const ES_COMPANY_WEB_TLDS = ['es', 'com', 'eu', 'net'] as const;

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A', 'AL', 'I', 'D', 'L']);

/** Palabras que solas no identifican a una empresa (no se prueban como dirección). */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'GRUPO', 'SERVICIOS', 'SERVICIO', 'SISTEMAS', 'COMERCIAL', 'COMERCIO', 'INVERSIONES', 'DISTRIBUIDORA', 'DISTRIBUCIONES',
  'INDUSTRIAS', 'INDUSTRIAL', 'LABORATORIOS', 'LABORATORIO', 'CORPORACION', 'COMPANIA', 'EMPRESA', 'TECNOLOGIA',
  'TECNOLOGIAS', 'SOLUCIONES', 'INTERNACIONAL', 'ESPANA', 'ESPANOLA', 'ESPANOL', 'IBERICA', 'GLOBAL', 'GENERAL',
  'NACIONAL', 'PRODUCTOS', 'SUMINISTROS', 'SEGUROS', 'SOCIEDAD', 'ASOCIACION', 'COOPERATIVA', 'FUNDACION', 'CENTRO',
  'INSTALACIONES', 'CONSTRUCCIONES', 'OBRAS', 'PROYECTOS', 'INGENIERIA', 'CONSULTORIA', 'GESTION', 'TRANSPORTES',
  'HOSPITAL', 'CLINICA', 'SALUD', 'MEDICA', 'FARMACIA', 'AGRICOLA', 'ENERGIA', 'INFORMATICA', 'DIGITAL', 'TALLERES',
  'MANTENIMIENTO', 'LIMPIEZA', 'SEGURIDAD', 'ALIMENTACION', 'HOLDING', 'NUEVA', 'NUEVO', 'UNION',
]);

/** Núcleo del nombre sin «(de) España» final: «VODAFONE ESPANA» → VODAFONE. */
export function spainCompanyWebNameKey(name: string | null | undefined): string {
  const core = spainNameCore(name);
  const without = core.replace(/ (?:DE )?(?:ESPANA|SPAIN|IBERICA|IBERIA)$/, '');
  return without.length >= 2 ? without : core;
}

const compact = (text: string): string => text.replace(/[^A-Z0-9]/g, '');

/** Etiquetas de dirección (sin terminación) que salen de un nombre, en orden. */
export function spainCompanyWebLabels(name: string | null | undefined): string[] {
  const key = spainCompanyWebNameKey(name);
  if (key.length < 2) return [];
  const words = key.split(' ').filter((w) => w.length > 0);
  const content = words.filter((w) => !LINK_WORDS.has(w));
  const distinctive = content.filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w) && !/^\d+$/.test(w));
  const out: string[] = [];
  const add = (label: string): void => {
    const l = label.toLowerCase();
    if (l.length >= 3 && l.length <= 40 && /[a-z]/.test(l) && !out.includes(l)) out.push(l);
  };
  add(compact(words.join('')));
  add(compact(content.join('')));
  if (distinctive.length >= 2) add(compact(distinctive.slice(0, 2).join('')));
  const first = compact(content[0] ?? '');
  if (first.length >= 4 && !GENERIC_WORDS.has(first) && !/^\d+$/.test(first)) add(first);
  return out;
}

/** Direcciones candidatas de una empresa por sus nombres. */
export function spainCompanyWebCandidates(names: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const label of spainCompanyWebLabels(name)) {
      for (const tld of ES_COMPANY_WEB_TLDS) {
        const host = `${label}.${tld}`;
        if (!out.includes(host)) out.push(host);
      }
    }
  }
  return out;
}

/** Páginas aparcadas, en venta o sin contenido: nunca son la web de nadie. */
const PARKED_PAGE =
  /\b(DOMAIN (IS )?FOR SALE|THIS DOMAIN|BUY THIS DOMAIN|DOMINIO EN VENTA|DOMINIO A LA VENTA|ESTE DOMINIO|UNDER CONSTRUCTION|EN CONSTRUCCION|COMING SOON|PROXIMAMENTE|PARKED|SEDO|GODADDY|DONDOMINIO|HUGEDOMAINS|DEFAULT WEB PAGE|INDEX OF|ACCOUNT SUSPENDED|CUENTA SUSPENDIDA|WEBSITE IS UNDER|SITIO EN MANTENIMIENTO|PAGINA EN MANTENIMIENTO)\b/;

/** Señales de que una web fuera de `.es` es de España. */
const SPAIN_MARKERS = / (ESPANA|SPAIN|MADRID|BARCELONA|VALENCIA|SEVILLA|BILBAO|ZARAGOZA|MALAGA|NIF|CIF|S A U|S L U|SOCIEDAD ANONIMA|SOCIEDAD LIMITADA) /;

/** Lo que la descarga dejó de una página. */
export type EsFetchedPage = {
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
export type EsCompanyWebRejection = 'no_response' | 'parked' | 'not_named' | 'not_spanish' | 'blocked_not_exact' | 'redirected_elsewhere';

const SECOND_LEVEL = ['com', 'org', 'net', 'edu', 'gob', 'nom', 'co'];

function registrableParts(host: string): string[] {
  const parts = host.toLowerCase().replace(/^www\d?\./, '').split('.');
  const keep = parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep);
}

const registrableLabel = (host: string): string => registrableParts(host)[0] ?? '';

/** Dominio a guardar: sin «www.» y registrable («tienda.x.es» → «x.es»). */
function storedDomain(host: string): string {
  return registrableParts(host).join('.');
}

/** ¿Es esta página la web de la empresa? Devuelve el dominio a guardar o por qué no. */
export function spainCompanyWebVerdict(
  page: EsFetchedPage,
  names: readonly string[],
): { domain: string; check: 'page_names_company' | 'title_names_brand' | 'blocked_exact_name'; matchedKey: string } | { rejected: EsCompanyWebRejection } {
  if (page.status === null || page.finalHost === null) return { rejected: 'no_response' };
  const keys = [...new Set(names.map((n) => spainCompanyWebNameKey(n)).filter((k) => k.length >= 2))];
  const ownLabels = new Set(names.flatMap((n) => spainCompanyWebLabels(n)));
  const finalLabel = registrableLabel(page.finalHost);
  const requestedLabel = registrableLabel(page.host);
  if (finalLabel !== requestedLabel && !ownLabels.has(finalLabel)) return { rejected: 'redirected_elsewhere' };
  const domain = storedDomain(page.finalHost);
  const spanish = domain.endsWith('.es');

  if (page.blocked) {
    const exact = keys.find((k) => compact(k).toLowerCase() === requestedLabel && requestedLabel.length >= 8);
    return exact !== undefined && spanish ? { domain, check: 'blocked_exact_name', matchedKey: exact } : { rejected: 'blocked_not_exact' };
  }
  const title = ` ${plainUpperSpain(page.title ?? '')} `;
  const text = ` ${plainUpperSpain(`${page.title ?? ''} ${page.text ?? ''}`)} `;
  if (PARKED_PAGE.test(text)) return { rejected: 'parked' };
  if (!spanish && !SPAIN_MARKERS.test(text)) return { rejected: 'not_spanish' };
  for (const key of keys) {
    const words = key.split(' ');
    if (words.length >= 2 && text.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
    if (compact(key).length >= 8 && compact(text).includes(compact(key))) return { domain, check: 'page_names_company', matchedKey: key };
    if (words.length === 1 && key.length >= 3 && title.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
  }
  // Marca: la dirección pedida ES la primera palabra distintiva del nombre (5+ letras) y
  // el TÍTULO de la página la lleva («HIBERUS IT DEVELOPMENT SERVICES» ↔ hiberus.com, «Hiberus»).
  // Sólo en `.es`: «ROVER INFRAESTRUCTURAS» no es rover.com (otra empresa, otro país).
  for (const key of spanish ? keys : []) {
    const brand = key.split(' ').find((w) => !LINK_WORDS.has(w));
    if (brand === undefined || brand.length < 5 || GENERIC_WORDS.has(brand) || key === brand) continue;
    if (compact(brand).toLowerCase() === requestedLabel && title.includes(` ${brand} `)) {
      return { domain, check: 'title_names_brand', matchedKey: brand };
    }
  }
  return { rejected: 'not_named' };
}

/**
 * Una marca que encabeza esta cantidad de razones sociales o más es una palabra común.
 * Medido el 14-10-2026: HERMANOS 2.738, BODEGAS 455, AVICOLA 252, INDUSTRIA 53, TEXTIL
 * 26; las marcas de grupo no pasan de 10 (ORANGE 10, HIBERUS 7, SOTHIS 6, VITHAS 5).
 */
export const ES_COMMON_FIRST_WORD_MIN = 20;

/** Primera palabra del núcleo de cada razón social, contada. */
export function spainFirstWordCounts(legalNames: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of legalNames) {
    const first = spainCompanyWebNameKey(name).split(' ').find((w) => !LINK_WORDS.has(w));
    if (first !== undefined && first.length > 0) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  return counts;
}

/**
 * ¿Se acepta una web hallada por marca? Sólo si la marca no es una palabra común
 * («Bodega González Byass» no es bodega.es; «Hermanos San Juan» no es hermanos.es).
 * Las comprobadas por el nombre completo se aceptan siempre.
 */
export function acceptNameCheckedWeb(
  result: { check: string; matchedKey: string },
  firstWordCounts: ReadonlyMap<string, number>,
): boolean {
  if (result.check !== 'title_names_brand') return true;
  return (firstWordCounts.get(result.matchedKey) ?? 0) < ES_COMMON_FIRST_WORD_MIN;
}
