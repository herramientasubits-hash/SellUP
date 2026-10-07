/**
 * gt-nit.ts — NIT de Guatemala: forma canónica y dígito verificador.
 *
 * SOURCES-GT-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * El NIT es un cuerpo de dígitos más un dígito verificador (módulo 11) que vale
 * 0-9 o «K» (cuando el cálculo da 10). Las 7.691 filas del listado de agentes de
 * retención del IVA de la SAT (01-04-2026) cumplen el cálculo: se usa para que
 * ninguna fuente meta un NIT mal copiado.
 *
 * Forma canónica: sin guion ni espacios, con la K en mayúscula («698827K»), igual
 * que la guarda la regla de `tax-identifier-rules.ts` y el RGAE.
 */

/** Cuerpo + verificador, con o sin guion. */
const NIT_SHAPE = /^(\d{1,12})([0-9K])$/;

/** Dígito verificador del cuerpo (módulo 11; 10 → «K»). */
export function guatemalaNitCheckDigit(body: string): string | null {
  if (!/^\d{1,12}$/.test(body)) return null;
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[i]) * (body.length + 1 - i);
  const digit = (11 - (sum % 11)) % 11;
  return digit === 10 ? 'K' : String(digit);
}

/**
 * NIT canónico si la forma y el dígito verificador cuadran; `null` si no. Acepta
 * el prefijo OCDS («GT-NIT-698827K»), guiones, puntos y espacios.
 */
export function canonicalGuatemalaNit(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toUpperCase().replace(/^GT-NIT-/, '').replace(/[\s.-]/g, '');
  const match = NIT_SHAPE.exec(text);
  // Hay NIT antiguos de 4 caracteres («2844» = 284 + 4) que el cálculo valida.
  if (match === null || text.length < 3) return null;
  return guatemalaNitCheckDigit(match[1]) === match[2] ? text : null;
}
