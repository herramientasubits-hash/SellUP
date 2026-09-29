/**
 * Agente 1 · Clasificador Claude — texto visible de la página (puro).
 *
 * Convierte el HTML descargado por nosotros en texto plano acotado. Ese texto es
 * (a) lo que Claude lee y (b) contra lo que verificamos que sus citas existen.
 */

/** Tope de caracteres que se envían al modelo (~3k tokens). */
export const MAX_PAGE_TEXT_CHARS = 12_000;

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

export function extractVisibleText(html: string, maxChars: number = MAX_PAGE_TEXT_CHARS): string {
  const withoutInvisible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ');
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

export function quoteAppearsInText(quote: string, text: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizeForQuoteMatch(text).includes(q);
}
