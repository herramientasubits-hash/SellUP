/**
 * El mínimo de empleados que PIDIÓ la persona en el criterio libre del asistente.
 *
 * FEEDBACK 24-11 (FIGARANTIAS SAS): «Coloqué que fueran mayores a 300 empleados y
 * me arrojó una empresa que en HubSpot tiene 12». El texto decía «que tengan mas de
 * 300 empelados», pero el asistente fijaba siempre 200 (`WIZARD_SYSTEM_CONTROLS`) y
 * el escritor común también: el número de la persona no llegaba a ningún filtro.
 *
 * Una sola lectura para todo el flujo (asistente → Apollo → filtro final → rescate
 * con Claude), para que no haya dos respuestas distintas a «¿cuántos pidió?».
 *
 * Reglas:
 *   - Sólo SUBE el piso del ICP (200). «Más de 50» no baja la regla de la dueña.
 *   - Un número seguido de una unidad que no es gente («más de 90 días», «más de 300
 *     sedes», «más de 5 millones») no cuenta.
 *   - Puro: sin red, sin env.
 */

import { ICP_SIZE_GATE_DEFAULT_THRESHOLD } from './icp-size-gate';

/** Un mínimo de empleados más grande que esto es un error de tipeo, no un pedido. */
const MAX_REASONABLE_MIN_EMPLOYEES = 1_000_000;

/** Palabras que, justo después del número, dicen que NO se habla de empleados. */
const NON_HEADCOUNT_UNIT =
  /^\s*(?:%|dias?\b|semanas?\b|mes(?:es)?\b|anos?\b|horas?\b|minutos?\b|millon(?:es)?\b|mil\b|k\b|usd\b|us\$|\$|dolares?\b|pesos?\b|euros?\b|soles?\b|reales?\b|ventas?\b|clientes?\b|sedes?\b|sucursales?\b|tiendas?\b|oficinas?\b|paises?\b|ciudades?\b|productos?\b|days?\b|weeks?\b|months?\b|years?\b|hours?\b|million\b|dollars?\b|customers?\b|clients?\b|stores?\b|offices?\b|countries?\b|locations?\b)/;

const NUMBER = '(\\d{1,3}(?:[.,]\\d{3})+|\\d+)';

/** «más de N», «mayores a N», «mínimo N», «al menos N», «>N», «N+», «N o más». */
const THRESHOLD_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `(?:mas\\s+de|mayor(?:es)?\\s+(?:a|de)|superior(?:es)?\\s+a|por\\s+encima\\s+de|minimo(?:\\s+de)?|al\\s+menos|more\\s+than|over|above|at\\s+least|minimum(?:\\s+of)?|>=?)\\s*${NUMBER}`,
    'g',
  ),
  new RegExp(`${NUMBER}\\s*(?:\\+|o\\s+mas\\b|or\\s+more\\b|en\\s+adelante\\b)`, 'g'),
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** «1.000» y «1,000» son mil: un conteo de gente nunca tiene decimales. */
function parseCount(raw: string): number | null {
  const n = parseInt(raw.replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n <= MAX_REASONABLE_MIN_EMPLOYEES ? n : null;
}

/**
 * El mínimo de empleados escrito en el criterio libre, o `null` si no hay uno.
 * Si aparecen varios, manda el más alto (es lo más exigente que pidió la persona).
 */
export function extractMinEmployeesFromCriteria(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const cleaned = normalize(text);
  let best: number | null = null;
  for (const pattern of THRESHOLD_PATTERNS) {
    for (const match of cleaned.matchAll(pattern)) {
      const after = cleaned.slice((match.index ?? 0) + match[0].length);
      // En «N+» / «N o más» la unidad va después del sufijo; en «más de N», después del número.
      if (NON_HEADCOUNT_UNIT.test(after)) continue;
      const count = parseCount(match[1]);
      if (count !== null && (best === null || count > best)) best = count;
    }
  }
  return best;
}

/**
 * El umbral de empleados de una búsqueda: el piso del ICP (200, inclusivo) o lo que
 * pidió la persona si es más alto.
 */
export function resolveRequestedMinEmployees(additionalCriteria: string | null | undefined): number {
  const requested = extractMinEmployeesFromCriteria(additionalCriteria);
  return requested !== null && requested > ICP_SIZE_GATE_DEFAULT_THRESHOLD
    ? requested
    : ICP_SIZE_GATE_DEFAULT_THRESHOLD;
}
