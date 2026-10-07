/**
 * pa-free-directory-macro-table.ts — qué macro industria corresponde a una fila
 * del directorio gratuito de Panamá (`pa_free_directory`).
 *
 * SOURCES-PA-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Panamá no publica la actividad de las sociedades en un archivo abierto. Tres
 * clasificaciones, aprobadas por la dueña el 07-10-2026 («autorizo adelante» al
 * informe):
 *
 *   1. Proveedoras del Estado: lo que vendieron al Estado según el código UNSPSC
 *      de los artículos adjudicados (datos OCDS de PanamaCompra, 2022 a abril de
 *      2024). Misma tabla segmento/familia → macro que Paraguay
 *      (`py-dncp-macro-table.ts`, v1), igual que Guatemala y Costa Rica.
 *   2. Grandes Contribuyentes de la DGI que no venden al Estado (bancos,
 *      cerveceras, supermercados): tabla empresa → macro revisada por la dueña
 *      (`pa-large-taxpayer-macro-table.ts`).
 *   3. Entidades compradoras del Estado con RUC: sólo Gobierno.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';
import {
  macroHasPyDncpCoverage,
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscMacro,
  resolvePyUnspscRubro,
} from './py-dncp-macro-table';
import {
  macroHasPaLargeTaxpayerCoverage,
  PA_LARGE_TAXPAYER_MACRO_TABLE_VERSION,
  resolvePaLargeTaxpayerMacro,
} from './pa-large-taxpayer-macro-table';

/** Versión de la clasificación de Panamá (las tablas que reutiliza). */
export const PA_FREE_DIRECTORY_MACRO_TABLE_VERSION =
  `pa-free-directory-v1(${PY_DNCP_MACRO_TABLE_VERSION}+${PA_LARGE_TAXPAYER_MACRO_TABLE_VERSION})` as const;

/** Las entidades públicas se ofrecen sólo para Gobierno. */
export const PA_PUBLIC_ENTITY_MACRO: MacroIndustryKey = 'government';

/** Por qué fuente se clasificó la fila. */
export type PaDirectoryKind = 'panamacompra_supplier' | 'large_taxpayer' | 'public_entity';

/** Macro de una proveedora por monto adjudicado por familia UNSPSC (≥ 50 %), o `null`. */
export function resolvePaSupplierMacro(
  amountByFamily: Readonly<Record<string, number>>,
): { macroIndustryKey: MacroIndustryKey; share: number } | null {
  return resolvePyDncpSupplierMacro(amountByFamily);
}

/**
 * Macro de una fila según su fuente y su código, o `null`: familia UNSPSC de una
 * proveedora, RUC de un Gran Contribuyente (tabla revisada), o entidad pública.
 */
export function resolvePaDirectoryMacro(
  kind: string | null | undefined,
  code: string | null | undefined,
): MacroIndustryKey | null {
  if (kind === 'public_entity') return PA_PUBLIC_ENTITY_MACRO;
  if (kind === 'panamacompra_supplier') return resolvePyUnspscMacro(code);
  if (kind === 'large_taxpayer') return resolvePaLargeTaxpayerMacro(code);
  return null;
}

/** El rubro en palabras de una proveedora (familia UNSPSC), o `null`. */
export function resolvePaUnspscRubro(unspscFamily: string | null | undefined): string | null {
  return resolvePyUnspscRubro(unspscFamily);
}

/** ¿Tiene esta macro alguna fuente panameña clasificada? */
export function macroHasPaCoverage(macroIndustryKey: string | null | undefined): boolean {
  if (typeof macroIndustryKey !== 'string') return false;
  return (
    macroIndustryKey === PA_PUBLIC_ENTITY_MACRO ||
    macroHasPyDncpCoverage(macroIndustryKey) ||
    macroHasPaLargeTaxpayerCoverage(macroIndustryKey)
  );
}
