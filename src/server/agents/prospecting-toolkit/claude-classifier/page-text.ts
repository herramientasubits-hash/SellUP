/**
 * Agente 1 · Clasificador Claude — texto visible de la página (puro).
 *
 * Convierte el HTML descargado por nosotros en texto plano acotado. Ese texto es
 * (a) lo que Claude lee y (b) contra lo que verificamos que sus citas existen.
 */

/** Tope de caracteres que se envían al modelo (~3k tokens). */
export const MAX_PAGE_TEXT_CHARS = 12_000;

/**
 * Cuánto HTML bajan los lectores de Claude (clasificador, rescate, buscador de
 * empresas). Prod 06-10 (CL×Salud, e4fec102): en sitios WordPress/Elementor
 * (meds.cl, ucmchile.cl) los primeros 50 KB son sólo estilos; el texto con el
 * nombre de la empresa venía después y nunca se leía. El texto que se usa sigue
 * acotado a MAX_PAGE_TEXT_CHARS.
 */
export const CLAUDE_PAGE_MAX_HTML_BYTES = 400_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  ccedil: 'ç',
  atilde: 'ã',
  otilde: 'õ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * AUDIT-A1-WS7 — atributos de un elemento que NO se ve: `hidden`, `aria-hidden="true"`
 * o estilo en línea `display:none` / `visibility:hidden`. Su texto no es de la
 * página que lee una persona y no puede servir para verificar una cita.
 */
const HIDDEN_ATTRS =
  /\shidden(?:\s|=|\/?>|$)|\saria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;
const VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'track']);

/** Quita los elementos ocultos con todo su contenido (respetando el anidamiento del mismo tag). */
export function stripHiddenElements(html: string): string {
  const openTag = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let out = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = openTag.exec(html)) !== null) {
    const [whole, rawName, attrs] = match;
    const name = rawName.toLowerCase();
    if (!HIDDEN_ATTRS.test(attrs)) continue;
    out += html.slice(cursor, match.index);
    if (VOID_TAGS.has(name) || attrs.trimEnd().endsWith('/')) {
      cursor = match.index + whole.length;
      openTag.lastIndex = cursor;
      continue;
    }
    // Busca el cierre que empareja, contando aperturas y cierres del mismo tag.
    const sameTag = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
    sameTag.lastIndex = match.index + whole.length;
    let depth = 1;
    let end = html.length;
    let inner: RegExpExecArray | null;
    while ((inner = sameTag.exec(html)) !== null) {
      depth += inner[1] === '/' ? -1 : 1;
      if (depth === 0) {
        end = inner.index + inner[0].length;
        break;
      }
    }
    out += ' ';
    cursor = end;
    openTag.lastIndex = end;
  }
  return out + html.slice(cursor);
}

export function extractVisibleText(html: string, maxChars: number = MAX_PAGE_TEXT_CHARS): string {
  const withoutInvisible = stripHiddenElements(html.replace(/<!--[\s\S]*?-->/g, ' '))
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ')
    // HTML cortado por el tope de bytes: un bloque invisible o un <head> sin cerrar
    // llega hasta el final; nunca es texto de la página.
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*$/i, ' ');
  const text = decodeEntities(
    withoutInvisible
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * Normalización para comparar citas: minúsculas, sin tildes, espacios colapsados,
 * sin comillas tipográficas. Evita falsos "no encontrado" por formato.
 */
export function normalizeForQuoteMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”«»"]/g, '"')
    .replace(/[‘’´`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Longitud mínima de una cita para que cuente como evidencia. */
export const MIN_QUOTE_CHARS = 12;

/**
 * AGENT1-CLAUDE-SECTOR-QUOTE-1 — la misma cita sin puntuación: «Intelligent
 * automation, RPA» y «intelligent automation (RPA)» son el mismo texto de la página.
 * Sólo letras, números y espacios; las palabras siguen tienen que estar TODAS y en
 * el mismo orden.
 */
function lettersOnly(text: string): string {
  return normalizeForQuoteMatch(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** «…» o «...» separan trozos de una cita recortada. */
const QUOTE_ELLIPSIS = /\s*(?:…|\.{3,})\s*/;

/**
 * ¿Cómo aparece la cita en el texto?
 *   · `exact`    — contigua (con o sin puntuación);
 *   · `stitched` — sólo uniendo trozos separados por «…» (en orden);
 *   · `null`     — no aparece.
 *
 * AUDIT-A1-WS7 — el prompt pide no unir frases de partes distintas: una cita
 * «cosida» sigue valiendo para COMPLETAR un dato (compatibilidad), pero NUNCA para
 * descartar una empresa (`quoteStitched` en la evidencia verificada).
 */
export function quoteMatchKind(quote: string, text: string): 'exact' | 'stitched' | null {
  const q = normalizeForQuoteMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;
  const normalizedText = normalizeForQuoteMatch(text);
  if (normalizedText.includes(q)) return 'exact';

  // AGENT1-CLAUDE-SECTOR-QUOTE-1 — Prod 14-10: 7 de 49 sectores rechazados con
  // `quote_not_found_in_official_page` aunque la página estaba descargada. Dos
  // tolerancias que NO inventan texto: (1) la puntuación no cuenta; (2) una cita
  // recortada con «…» vale si CADA trozo (de MIN_QUOTE_CHARS o más) aparece, en orden.
  const plainText = ` ${lettersOnly(text)} `;
  const fragments = q
    .split(QUOTE_ELLIPSIS)
    .map((f) => lettersOnly(f))
    .filter((f) => f.length > 0);
  if (fragments.length === 0 || fragments.some((f) => f.length < MIN_QUOTE_CHARS)) return null;
  let from = 0;
  for (const fragment of fragments) {
    const at = plainText.indexOf(` ${fragment} `, from);
    if (at === -1) return null;
    from = at + fragment.length;
  }
  return fragments.length > 1 ? 'stitched' : 'exact';
}

export function quoteAppearsInText(quote: string, text: string): boolean {
  return quoteMatchKind(quote, text) !== null;
}
