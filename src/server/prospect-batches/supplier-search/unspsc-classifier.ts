/**
 * Clasificador UNSPSC de «Proveedores de una empresa»: la tabla UNSPSC → industria
 * aprobada por la dueña (Paraguay 06-10, reutilizada en Colombia y Chile el 15-10).
 * Las familias se guardan con 4 dígitos.
 */

import {
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscRubro,
} from '@/server/prospect-batches/country-source-discovery/py-dncp-macro-table';
import type { ProcurementClassifier } from './procurement-links';

/** «V1.43211500» / «43211500» / «4321» → «4321»; otra cosa ⇒ `null`. */
export function unspscFamily(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().replace(/^V1\./i, '');
  return /^\d{4,8}$/.test(code) ? code.slice(0, 4) : null;
}

export const UNSPSC_CLASSIFIER: ProcurementClassifier = {
  tableVersion: PY_DNCP_MACRO_TABLE_VERSION,
  classify: (amountByFamily) => resolvePyDncpSupplierMacro(amountByFamily),
  rubroOf: (family) => resolvePyUnspscRubro(family),
};
