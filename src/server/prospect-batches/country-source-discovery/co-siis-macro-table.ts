/**
 * co-siis-macro-table.ts — qué macro industria corresponde a cada código CIIU
 * Rev. 4 A.C. (DANE, 4 dígitos) de las empresas colombianas del SIIS.
 *
 * SOURCES-CO-CLOSE-1. Tabla aprobada por la dueña el 06-10-2026 («adelante con
 * todo» sobre la propuesta «la tabla de Argentina v2, igual que Chile y Ecuador»).
 * Cambiarla es una decisión de producto: no se edita sin su visto bueno.
 *
 * ── 🔴 Por qué una tabla escrita a mano ─────────────────────────────────────
 *
 * Colombia usaba el índice derivado por palabras (`macro-ciiu-index`), que deja
 * Tecnología, Retail y Consumo masivo SIN NINGÚN código (medido 06-10-2026). En
 * las 7 corridas de Tecnología desde el 30-09 la capa gratuita propuso 0 empresas.
 * Los dos primeros dígitos del CIIU colombiano son la división de la CIIU Rev. 4,
 * así que la división se resuelve con la tabla aprobada para Argentina
 * (`AR_RNS_DIVISION_MACRO`). Lo propio de Colombia (clase de 4 dígitos, manda
 * sobre la división):
 *
 *   - 4645 «Comercio al por mayor de productos farmacéuticos, medicinales,
 *     cosméticos y de tocador» y 4773 «Comercio al por menor de productos
 *     farmacéuticos y medicinales…» → Salud. Ojo: en Colombia la 4645 incluye
 *     cosméticos (Unilever Andina cae aquí).
 *   - 4651 (mayoristas de computadores y programas), 4652 (de equipo electrónico y
 *     de telecomunicaciones) y 4741 (minoristas de computadores y
 *     telecomunicaciones, en la práctica integradores) → Tecnología, como
 *     Argentina v2 y Chile.
 *   - Una división que no aparece NO tiene macro y la fuente gratuita nunca ofrece
 *     esas empresas: hoteles y restaurantes, medios, investigación, educación (el
 *     asistente no tiene industria «Educación»), cultura y asociaciones. La
 *     división 84 (administración pública) apenas existe en el SIIS (5 filas mal
 *     clasificadas): Gobierno sale del directorio de entidades públicas.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import { listKnownCiiuCodes } from '@/server/source-catalog/connectors/socrata-colombia/normalizers';
import { AR_RNS_DIVISION_MACRO } from './ar-rns-macro-table';

/** Versión de la tabla. */
export const CO_SIIS_MACRO_TABLE_VERSION = 'co-ciiu4ac-siis-macro-v1' as const;

/** Clase CIIU (4 dígitos) → macro. Manda sobre la división. */
export const CO_SIIS_CLASS_MACRO: Readonly<Record<string, MacroIndustryKey>> = Object.freeze({
  '4645': 'health_pharma', // mayor de productos farmacéuticos, medicinales, cosméticos y de tocador
  '4773': 'health_pharma', // menor de productos farmacéuticos y medicinales (farmacias)
  '4651': 'technology', // mayor de computadores, equipo periférico y programas de informática
  '4652': 'technology', // mayor de equipo, partes y piezas electrónicos y de telecomunicaciones
  '4741': 'technology', // menor de computadores, equipos periféricos, programas y telecomunicaciones
});

/** La división 84 del SIIS no es Gobierno de verdad (ver cabecera). */
const EXCLUDED_DIVISIONS: ReadonlySet<string> = new Set(['84']);

/**
 * Códigos que el SIIS 2024 publica de verdad (medido en Producción el
 * 06-10-2026) y que el catálogo DANE de `listKnownCiiuCodes` no trae. Sirven
 * sólo para armar la lista de códigos de la consulta.
 */
const CO_SIIS_EXTRA_OBSERVED_CODES: readonly string[] = [
  '0115', '0130', '0164', '0230', '0722', '0723', '0812', '0820', '0892', '1031',
  '1032', '1033', '1051', '1052', '1311', '1312', '1313', '1394', '1513', '1523',
  '2014', '2432', '2513', '2592', '2593', '3012', '3110', '3120', '3210', '3314',
  '3315', '3319', '4610', '4724', '4729', '4732', '6615', '6619', '7111', '7112',
  '8414', '8523', '9900',
];

/** Código tal como llega (número, texto, sin el cero inicial) → 4 dígitos, o `null`. */
export function normalizeCoCiiuCode(raw: string | number | null | undefined): string | null {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw <= 0) return null;
    raw = String(raw);
  }
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return /^\d{3,4}$/.test(code) ? code.padStart(4, '0') : null;
}

/** Macro de UN código CIIU colombiano, o `null` si no tiene. */
export function resolveCoCiiuMacro(raw: string | number | null | undefined): MacroIndustryKey | null {
  const code = normalizeCoCiiuCode(raw);
  if (code === null) return null;
  const division = code.slice(0, 2);
  if (EXCLUDED_DIVISIONS.has(division)) return null;
  return CO_SIIS_CLASS_MACRO[code] ?? AR_RNS_DIVISION_MACRO[division] ?? null;
}

/** Los códigos de 4 dígitos que pertenecen a esta macro (para filtrar la consulta). */
export function listCoCiiuCodesForMacro(macroIndustryKey: string | null | undefined): readonly string[] {
  if (typeof macroIndustryKey !== 'string' || macroIndustryKey.trim() === '') return [];
  const all = new Set<string>([...listKnownCiiuCodes(), ...CO_SIIS_EXTRA_OBSERVED_CODES]);
  return [...all]
    .map((code) => normalizeCoCiiuCode(code))
    .filter((code): code is string => code !== null && resolveCoCiiuMacro(code) === macroIndustryKey)
    .sort();
}

/** ¿Tiene esta macro algún código colombiano clasificado? */
export function macroHasCoSiisCoverage(macroIndustryKey: string | null | undefined): boolean {
  return listCoCiiuCodesForMacro(macroIndustryKey).length > 0;
}
