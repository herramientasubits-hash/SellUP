/**
 * uy-company-web.ts — la web de una organización de la capa gratuita de Uruguay a
 * partir de su NOMBRE, comprobada con su propia página.
 *
 * SOURCES-UY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj. La descarga de las
 * páginas la hace `scripts/source-catalog/discover-uy-company-webs.mts`. Misma
 * regla que El Salvador (`sv-company-web.ts`, #655), con lo propio de Uruguay.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * El OCDS de ARCE no publica correos ni webs de sus proveedores (revisado el
 * 13-10-2026 en adjudicaciones de 2002 a 2025) y el Directorio de Empresas
 * Industriales del MIEM sólo da web a ~110 de las 2.118 organizaciones de la capa
 * gratuita. Sin web, la empresa va a Descartadas y no cuenta para la meta. La dueña
 * eligió (13-10-2026, «la B»): webs gratis por nombre primero, y el rescate con
 * Claude de la corrida para lo que quede.
 *
 * ── La regla ───────────────────────────────────────────────────────────────
 *
 * 1. Direcciones candidatas SÓLO desde el nombre (razón social sin forma ni
 *    «(del) Uruguay», y su sigla o alias del RUPE): todas las palabras pegadas, sin
 *    palabras de enlace, la primera palabra si es distintiva; con `.com.uy`, `.uy`,
 *    `.com`.
 * 2. La página tiene que NOMBRAR a la organización (el nombre completo en su texto
 *    o, si es una palabra, en su título) y, fuera de `.uy`, hablar de Uruguay; una
 *    redirección sólo vale hacia otra dirección que salga del nombre. Una página
 *    aparcada, en venta o «en construcción» nunca vale.
 * 3. Un nombre DÉBIL (una palabra común o corta, o «GRUPO MAS», «AMP SOLUTIONS»:
 *    menos de 5 letras distintivas o sólo palabras comunes) sólo vale si la
 *    página lo escribe junto a su forma societaria («Argas S.A.»). Medido el
 *    13-10-2026: «avance.com.uy» era un taller mecánico (no AVANCE S.R.L.) y
 *    «grupomas.com.uy» unos supermercados (no GRUPO MAS S.R.L.).
 * 4. Si la web existe pero bloquea la lectura (Cloudflare), sólo vale una `.uy` cuya
 *    dirección ES el nombre completo pegado (8 letras o más). Nunca se salta el muro.
 *
 * Nada difuso: si ninguna candidata cumple, la empresa sigue sin web (y el rescate la
 * busca como hasta ahora).
 */

import { plainUpperUruguay, uruguayNameCore } from './uy-name-keys';

/** Terminaciones probadas, en orden. */
export const UY_COMPANY_WEB_TLDS = ['com.uy', 'uy', 'com'] as const;

const LINK_WORDS: ReadonlySet<string> = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'E', 'EN', 'PARA', 'POR', 'A', 'AL']);

/** Palabras que solas no identifican a una empresa (no se prueban como dirección). */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'GRUPO', 'SERVICIOS', 'SERVICIO', 'SISTEMAS', 'COMERCIAL', 'COMERCIO', 'INVERSIONES', 'DISTRIBUIDORA', 'INDUSTRIAS',
  'LABORATORIOS', 'LABORATORIO', 'CORPORACION', 'COMPANIA', 'EMPRESA', 'TECNOLOGIA', 'TECNOLOGIAS', 'SOLUCIONES',
  'INTERNACIONAL', 'URUGUAY', 'URUGUAYA', 'ORIENTAL', 'MONTEVIDEO', 'GLOBAL', 'GENERAL', 'NACIONAL', 'MEDICA',
  'MEDICOS', 'PRODUCTOS', 'SUMINISTROS', 'EQUIPOS', 'DROGUERIA', 'FARMACIA', 'TELECOMUNICACIONES', 'COMUNICACIONES',
  'COOPERATIVA', 'ASOCIACION', 'SOCIEDAD', 'CENTRO', 'INSTITUTO', 'FUNDACION', 'CONSTRUCCIONES', 'CONSTRUCTORA',
  'TRANSPORTE', 'TRANSPORTES', 'IMPORTADORA', 'AGROPECUARIA', 'INGENIERIA', 'OBRAS', 'LIMPIEZA', 'SEGURIDAD',
]);

/** Núcleo del nombre sin «(del/de) Uruguay» final: «IBM DEL URUGUAY» → IBM. */
export function uyCompanyWebNameKey(name: string | null | undefined): string {
  const core = uruguayNameCore(name);
  const without = core.replace(/ (?:EN EL |DEL |DE )?URUGUAY$/, '');
  return without.length >= 2 ? without : core;
}

const compact = (text: string): string => text.replace(/[^A-Z0-9]/g, '');

/** Etiquetas de dirección (sin terminación) que salen de un nombre, en orden. */
export function uyCompanyWebLabels(name: string | null | undefined): string[] {
  const key = uyCompanyWebNameKey(name);
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

/** Direcciones candidatas de una organización por su razón social y sus alias. */
export function uyCompanyWebCandidates(names: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const label of uyCompanyWebLabels(name)) {
      for (const tld of UY_COMPANY_WEB_TLDS) {
        const host = `${label}.${tld}`;
        if (!out.includes(host)) out.push(host);
      }
    }
  }
  return out;
}

/**
 * Palabras comunes (castellano e inglés de negocios) que, como nombre de una
 * empresa, también son el de muchas otras: «PROYECTOS», «BRILLANTE», «CIRCULAR».
 */
const COMMON_NAME_WORDS: ReadonlySet<string> = new Set([
  'AVANCE', 'BRILLANTE', 'CIRCULAR', 'PROYECTOS', 'PROYECTO', 'OFICINA', 'RATIO', 'SOLUTIONS', 'CONSULTING', 'SOFTWARE',
  'SISTEMAS', 'SERVICIOS', 'SOLUCIONES', 'TECNOLOGIA', 'TECNOLOGIAS', 'INFORMATICA', 'DIGITAL', 'NETWORK', 'NETWORKS',
  'SYSTEMS', 'GROUP', 'GRUPO', 'CONSULTORES', 'CONSULTORA', 'INGENIERIA', 'INGENIEROS', 'DESARROLLO', 'DESARROLLOS',
  'GESTION', 'NEGOCIOS', 'MERCADO', 'MERCADOS', 'IMPORT', 'EXPORT', 'COMERCIAL', 'INDUSTRIAL', 'GENERAL', 'CENTRAL',
  'NORTE', 'ESTE', 'OESTE', 'PROGRESO', 'FUTURO', 'ESTRELLA', 'AURORA', 'HORIZONTE', 'PUNTO', 'LINEA', 'RED', 'REDES',
  'ENERGIA', 'AMBIENTE', 'LIMPIEZA', 'SEGURIDAD', 'TRANSPORTE', 'TRANSPORTES', 'LOGISTICA', 'SALUD', 'MEDICA',
  'FARMA', 'VIDA', 'MUNDO', 'PLANETA', 'UNION', 'ALIANZA', 'INTEGRAL', 'TOTAL', 'GLOBAL', 'MASTER', 'PRIME', 'SMART',
  'PLUS', 'MAX', 'PRO', 'TECH', 'DATA', 'INFO', 'WEB', 'NET', 'CLOUD', 'SOFT', 'LABS', 'STUDIO', 'ESTUDIO', 'TALLER',
  'FABRICA', 'CONSTRUCCIONES', 'OBRAS', 'MONTAJES', 'INSTALACIONES', 'EQUIPOS', 'INSUMOS', 'SUMINISTROS', 'PRODUCTOS',
  'DISTRIBUIDORA', 'DISTRIBUCIONES', 'REPRESENTACIONES', 'INVERSIONES', 'EMPRENDIMIENTOS', 'NEXO', 'CLAVE', 'ACCESO',
  'SOLAR', 'AGUA', 'TIERRA', 'FUEGO', 'AIRE', 'SOL', 'LUNA', 'MAR', 'RIO', 'CAMPO', 'VERDE', 'AZUL', 'ROJO', 'BLANCO',
]);

/** Palabras de un nombre que sí lo distinguen (sin enlaces ni palabras genéricas o comunes). */
function distinctiveWords(key: string): string[] {
  return key.split(' ').filter((w) => w.length > 0 && !LINK_WORDS.has(w) && !GENERIC_WORDS.has(w) && !COMMON_NAME_WORDS.has(w));
}

/** ¿Es un nombre débil (pocas letras distintivas o sólo palabras comunes)? */
export function isWeakUyCompanyName(key: string): boolean {
  return compact(distinctiveWords(key).join("")).length < 5;
}

/** El nombre seguido de su forma societaria en el texto («ARGAS S A», «AVANCE SRL»). */
function namedWithLegalForm(text: string, key: string): boolean {
  return new RegExp(` ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (S A S|S A|SA|SAS|S R L|SRL|LTDA|LIMITADA|SOCIEDAD ANONIMA|SOCIEDAD DE RESPONSABILIDAD LIMITADA)( |$)`).test(text);
}

/** Páginas aparcadas, en venta o sin contenido: nunca son la web de nadie. */
const PARKED_PAGE =
  /\b(DOMAIN (IS )?FOR SALE|THIS DOMAIN|BUY THIS DOMAIN|DOMINIO EN VENTA|DOMINIO A LA VENTA|UNDER CONSTRUCTION|EN CONSTRUCCION|COMING SOON|PROXIMAMENTE|PARKED|SEDO|GODADDY|HOSTGATOR|DEFAULT WEB PAGE|INDEX OF|ACCOUNT SUSPENDED|CUENTA SUSPENDIDA|WEBSITE IS UNDER|SITIO EN MANTENIMIENTO)\b/;

/** Lo que la descarga dejó de una página. */
export type UyFetchedPage = {
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
export type UyCompanyWebRejection =
  | 'no_response'
  | 'parked'
  | 'not_named'
  | 'not_uruguayan'
  | 'blocked_not_exact'
  | 'redirected_elsewhere';

const SECOND_LEVEL: ReadonlySet<string> = new Set(['com', 'org', 'net', 'edu', 'gub', 'mil']);

const registrableLabel = (host: string): string => {
  const parts = host.toLowerCase().replace(/^www\d?\./, '').split('.');
  const keep = parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-keep)[0] ?? '';
};

/**
 * ¿Es esta página la web de la organización? Devuelve el dominio a guardar o por
 * qué no.
 */
export function uyCompanyWebVerdict(
  page: UyFetchedPage,
  names: readonly string[],
): { domain: string; check: 'page_names_company' | 'blocked_exact_name'; matchedKey: string } | { rejected: UyCompanyWebRejection } {
  if (page.status === null || page.finalHost === null) return { rejected: 'no_response' };
  const keys = [...new Set(names.map((n) => uyCompanyWebNameKey(n)).filter((k) => k.length >= 2))];
  const nameLabels = new Set(names.flatMap((n) => uyCompanyWebLabels(n)));
  const finalLabel = registrableLabel(page.finalHost);
  const requestedLabel = registrableLabel(page.host);
  if (finalLabel !== requestedLabel && !nameLabels.has(finalLabel)) return { rejected: 'redirected_elsewhere' };
  const domain = page.finalHost.toLowerCase().replace(/^www\d?\./, '');
  const uruguayan = domain.endsWith('.uy');

  if (page.blocked) {
    const exact = keys.find((k) => compact(k).toLowerCase() === requestedLabel && requestedLabel.length >= 8);
    return exact !== undefined && uruguayan ? { domain, check: 'blocked_exact_name', matchedKey: exact } : { rejected: 'blocked_not_exact' };
  }
  const title = ` ${plainUpperUruguay(page.title ?? '')} `;
  const text = ` ${plainUpperUruguay(`${page.title ?? ''} ${page.text ?? ''}`)} `;
  if (PARKED_PAGE.test(text)) return { rejected: 'parked' };
  if (!uruguayan && !text.includes(' URUGUAY') && !text.includes(' MONTEVIDEO')) return { rejected: 'not_uruguayan' };
  for (const key of keys) {
    const words = key.split(' ');
    // Un nombre débil sólo vale escrito junto a su forma societaria.
    if (isWeakUyCompanyName(key)) {
      if (namedWithLegalForm(text, key)) return { domain, check: 'page_names_company', matchedKey: key };
      continue;
    }
    if (words.length >= 2 && text.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
    // «DATA & GRAPHICS» se escribe «Data & Graphics» o «DataGraphics» en la página.
    if (compact(key).length >= 8 && compact(text).includes(compact(key))) return { domain, check: 'page_names_company', matchedKey: key };
    // Una palabra («TILSOR», «EFICE») en el título.
    if (words.length === 1 && key.length >= 3 && title.includes(` ${key} `)) return { domain, check: 'page_names_company', matchedKey: key };
  }
  return { rejected: 'not_named' };
}

/** Título y texto visible de un HTML (sin scripts ni estilos), recortado. */
export function uyExtractPageText(html: string, maxChars = 20_000): { title: string | null; text: string } {
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
export function uyIsBotWall(status: number | null, title: string | null): boolean {
  const t = (title ?? '').toLowerCase();
  return t.includes('attention required') || t.includes('just a moment') || ((status === 403 || status === 503) && t.includes('cloudflare'));
}
