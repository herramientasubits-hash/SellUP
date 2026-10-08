/**
 * cr-free-directory-macro-table.ts — qué macro industria corresponde a una
 * empresa o entidad del directorio gratuito de Costa Rica.
 *
 * SOURCES-CR-CLOSE-1.
 *
 * ── 🔴 No hay tabla nueva: se reutilizan las dos ya aprobadas ───────────────
 *
 * Costa Rica no publica la actividad de las sociedades en un archivo abierto (la
 * consulta de Hacienda bloquea por geografía). Cada fila del directorio se
 * clasifica con la tabla ya aprobada que corresponde a su fuente:
 *
 *   - Proveedoras del Estado (ofertas de SICOP 2022-2024): por LO QUE VENDEN, con
 *     la tabla UNSPSC de Paraguay tal cual (`py-dncp-macro-table.ts`, «tabla PY
 *     aprobada», 06-10-2026): SICOP codifica cada producto con UNSPSC. La macro es
 *     la que suma al menos la mitad del monto ofertado.
 *   - Empresas en Zona Franca (PROCOMER): por su actividad CAECR, que es la CIIU
 *     Rev. 4 adaptada, con la tabla de Perú/Argentina (`pe-sunat-macro-table.ts`).
 *   - Entidades públicas (instituciones compradoras de SICOP): Gobierno, como en
 *     Colombia.
 *   - Socios de la Cámara de Industrias (CICR): por la actividad que declaran, con
 *     la tabla de palabras clave de `cr-cicr-macro-table.ts` (v2, PROPUESTA
 *     pendiente del visto bueno de la dueña).
 *
 * La dueña del producto aprobó reutilizar las dos tablas el 06-10-2026. Cambiar la
 * clasificación es una decisión de producto: no se edita sin su visto bueno.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import {
  macroHasPyDncpCoverage,
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscMacro,
  resolvePyUnspscRubro,
} from './py-dncp-macro-table';
import { CR_CICR_ACTIVITY_TABLE_VERSION, resolveCrCicrActivityMacro } from './cr-cicr-macro-table';
import { macroHasPeCoverage, PE_SUNAT_MACRO_TABLE_VERSION, resolvePeActivityMacro } from './pe-sunat-macro-table';

/** Versión de la clasificación de Costa Rica (las dos tablas que reutiliza). */
export const CR_FREE_DIRECTORY_MACRO_TABLE_VERSION =
  `cr-free-directory-v2(${PY_DNCP_MACRO_TABLE_VERSION}+${PE_SUNAT_MACRO_TABLE_VERSION}+${CR_CICR_ACTIVITY_TABLE_VERSION})` as const;

/** Las entidades públicas se ofrecen sólo para Gobierno. */
export const CR_PUBLIC_ENTITY_MACRO: MacroIndustryKey = 'government';

/** Por qué fuente se clasificó la fila. */
export type CrDirectoryKind = 'sicop_supplier' | 'zona_franca' | 'public_entity' | 'cicr_member';

/** Macro de una proveedora de SICOP por monto ofertado por familia UNSPSC (≥ 50 %). */
export function resolveCrSicopSupplierMacro(
  amountByFamily: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  return resolvePyDncpSupplierMacro(amountByFamily);
}

/** Macro de una empresa de Zona Franca por su actividad CAECR (4 dígitos). */
export function resolveCrCaecrMacro(caecr: string | null | undefined): MacroIndustryKey | null {
  return resolvePeActivityMacro(caecr);
}

/** Macro de una fila del directorio según su fuente y su código, o `null`. */
export function resolveCrDirectoryMacro(
  kind: string | null | undefined,
  code: string | null | undefined,
): MacroIndustryKey | null {
  if (kind === 'public_entity') return CR_PUBLIC_ENTITY_MACRO;
  if (kind === 'zona_franca') return resolveCrCaecrMacro(code);
  if (kind === 'sicop_supplier') return resolvePyUnspscMacro(code);
  // Socios de CICR: no traen código, la actividad declarada va en el segundo argumento.
  if (kind === 'cicr_member') return resolveCrCicrActivityMacro(code);
  return null;
}

/** El rubro en palabras de una proveedora de SICOP (familia UNSPSC), o `null`. */
export function resolveCrSicopRubro(unspscFamily: string | null | undefined): string | null {
  return resolvePyUnspscRubro(unspscFamily);
}

/** ¿Tiene esta macro alguna fuente costarricense clasificada? */
export function macroHasCrCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    macroIndustryKey === CR_PUBLIC_ENTITY_MACRO ||
    macroHasPyDncpCoverage(macroIndustryKey) ||
    macroHasPeCoverage(macroIndustryKey)
  );
}
