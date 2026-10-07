/**
 * gt-guatecompras-macro-table.ts — qué macro industria corresponde a una empresa
 * guatemalteca según LO QUE VENDE AL ESTADO: el código UNSPSC de los artículos de
 * los procesos de Guatecompras que se le adjudicaron.
 *
 * SOURCES-GT-CLOSE-1.
 *
 * Guatecompras clasifica cada artículo con el mismo catálogo UNSPSC que la DNCP
 * de Paraguay, así que se usa la MISMA tabla segmento/familia → macro que la dueña
 * aprobó el 06-10-2026 para Paraguay (`py-dncp-macro-table.ts`, v1). La versión
 * propia deja claro de dónde salió la clasificación de una fila de Guatemala. La
 * dueña autorizó usarla para Guatemala el 06-10-2026 («adelante y autorizo todo»,
 * tras el informe con la propuesta).
 *
 * Volumen medido (Guatecompras 2023-2026): 6.059 sociedades con adjudicaciones,
 * 4.541 con una macro dominante.
 *
 * ── Relevancia (no hay tamaño oficial) ──────────────────────────────────────
 *
 * Ninguna fuente abierta de Guatemala publica trabajadores ni ingresos por
 * empresa. La capa gratuita sólo ofrece sociedades que sean agentes de retención
 * del IVA (la SAT los designa entre los contribuyentes especiales) o a las que el
 * Estado adjudicó al menos Q5 millones en 2023-2026. Nunca se inventa un número de
 * trabajadores: el filtro de tamaño sigue decidiendo con lo que traigan los demás.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import {
  macroHasPyDncpCoverage,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscMacro,
  resolvePyUnspscRubro,
} from './py-dncp-macro-table';
import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Versión de la tabla para Guatemala (misma clasificación que `py-unspsc-dncp-macro-v1`). */
export const GT_GUATECOMPRAS_MACRO_TABLE_VERSION = 'gt-unspsc-guatecompras-macro-v1' as const;

/** Monto mínimo adjudicado en 2023-2026 (quetzales) para entrar sin ser agente del IVA. */
export const GT_GUATECOMPRAS_MIN_AWARDED_GTQ = 5_000_000;

/** Macro dominante de una empresa por monto y familia UNSPSC (≥ 50 %), o `null`. */
export function resolveGtGuatecomprasSupplierMacro(
  amountByFamily: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  return resolvePyDncpSupplierMacro(amountByFamily);
}

/** Macro de una clase UNSPSC (o su prefijo), o `null`. */
export function resolveGtUnspscMacro(raw: string | null | undefined): MacroIndustryKey | null {
  return resolvePyUnspscMacro(raw);
}

/** Rubro en palabras de una clase UNSPSC (para la columna «Industria»), o `null`. */
export function resolveGtUnspscRubro(raw: string | null | undefined): string | null {
  return resolvePyUnspscRubro(raw);
}

/** ¿Tiene esta macro alguna clase UNSPSC clasificada? */
export function macroHasGtGuatecomprasCoverage(macroIndustryKey: string | null | undefined): boolean {
  return macroHasPyDncpCoverage(macroIndustryKey);
}

/** ¿Es la empresa lo bastante relevante para la capa gratuita? */
export function isGtGuatecomprasRelevant(input: { satIvaAgent: boolean; awardedGtq: number }): boolean {
  return input.satIvaAgent || (Number.isFinite(input.awardedGtq) && input.awardedGtq >= GT_GUATECOMPRAS_MIN_AWARDED_GTQ);
}
