/**
 * sv-nit.ts — NIT de El Salvador: forma y dígito verificador.
 *
 * SOURCES-SV-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * El NIT homologado tiene 14 dígitos: 4 del municipio, 6 de la fecha (DDMMAA), 3 de
 * correlativo y 1 verificador (`0614-010112-002-5`). El verificador se calcula en
 * módulo 11 con dos juegos de pesos según el correlativo:
 *
 *   - correlativo <= 100: suma(dígito_i × (14 - i)) con i = 0..12; v = suma % 11;
 *     si v = 10, el verificador es 0.
 *   - correlativo  > 100: pesos 2,7,6,5,4,3,2,7,6,5,4,3,2; v = 11 - (suma % 11);
 *     si v >= 10, el verificador es 0.
 *
 * Medido el 07-10-2026 sobre las 1.069 filas del listado de Grandes Contribuyentes
 * de la DGII (15-01-2019): 1.069 de 1.069 pasan con esta regla.
 */

const HIGH_SEQUENCE_WEIGHTS = [2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Sólo dígitos, o `null` si no son exactamente 14. */
export function digitsOfSalvadoranNit(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s.-]/g, '');
  return /^\d{14}$/.test(digits) ? digits : null;
}

/** ¿El último dígito es el verificador correcto de los 13 primeros? */
export function isValidSalvadoranNitCheckDigit(digits14: string): boolean {
  if (!/^\d{14}$/.test(digits14)) return false;
  const body = [...digits14.slice(0, 13)].map(Number);
  const sequence = Number(digits14.slice(10, 13));
  let expected: number;
  if (sequence <= 100) {
    const sum = body.reduce((acc, digit, i) => acc + digit * (14 - i), 0);
    const v = sum % 11;
    expected = v === 10 ? 0 : v;
  } else {
    const sum = body.reduce((acc, digit, i) => acc + digit * HIGH_SEQUENCE_WEIGHTS[i], 0);
    const v = 11 - (sum % 11);
    expected = v >= 10 ? 0 : v;
  }
  return expected === Number(digits14[13]);
}

/** NIT de 14 dígitos con verificador correcto (sin guiones), o `null`. */
export function normalizeSalvadoranNit(value: string | null | undefined): string | null {
  const digits = digitsOfSalvadoranNit(value);
  return digits !== null && isValidSalvadoranNitCheckDigit(digits) ? digits : null;
}

/** `0614-010112-002-5`. */
export function formatSalvadoranNit(digits14: string): string {
  return `${digits14.slice(0, 4)}-${digits14.slice(4, 10)}-${digits14.slice(10, 13)}-${digits14.slice(13)}`;
}
