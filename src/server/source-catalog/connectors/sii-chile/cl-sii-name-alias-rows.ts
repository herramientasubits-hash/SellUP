/**
 * cl-sii-name-alias-rows.ts — filas de `cl_sii_name_alias`: el nombre comercial que
 * cierra una razón social del SII, como clave EXTRA para el RUT por nombre.
 *
 * SOURCES-CL-NAME-ALIAS-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * «EMPRESA DE TRANSMISION ELECTRICA TRANSEMEL S A» se busca como «Transemel». La
 * carga (`scripts/source-catalog/run-cl-sii-name-alias-etl.ts`) lee el registro
 * entero y sólo guarda la palabra final que:
 *   1. pasa `chileBrandTailKey` (5+ letras, no es una palabra genérica);
 *   2. sale en UNA sola sociedad de todo `cl_sii_registry`, en cualquier posición
 *      (Prod 07-10: «BANMEDICA» sale en el centro de servicios compartidos y en
 *      Banmédica Internacional ⇒ no se guarda);
 *   3. es de una sociedad con 10+ trabajadores informados (Transemel: 18);
 *   4. no viene de una razón social cortada: el SII corta muchas a 40 caracteres y
 *      la última palabra queda a medias («…MINISTERIO DE AGRICULT», «…HOSP DE
 *      SALAMANC»; prueba de carga del 07-10: 4.228 alias con varios así).
 * El alias apunta a la MISMA sociedad del registro: no es otra fuente de identidad.
 */

import { buildRecordIdentityKey, type RecordIdentityKey } from '../../record-identity';
import { normalizeChileRut } from '../res-chile/cl-res-registry-row';
import { CL_BRAND_ALIAS_MIN_WORKERS, chileBrandTailKey } from './cl-name-keys';

export const CL_SII_NAME_ALIAS_SOURCE_KEY = 'cl_sii_name_alias' as const;

/** Largo al que el SII corta la razón social: su última palabra puede estar a medias. */
export const CL_SII_TRUNCATED_NAME_LENGTH = 40;

/** Espacio de nombres de la identidad de un alias (`cl-name-alias:<RUT>:<clave>`). */
export const CL_NAME_ALIAS_IDENTITY_NAMESPACE = 'cl-name-alias' as const;

export type ClSiiNameAliasRow = {
  source_key: typeof CL_SII_NAME_ALIAS_SOURCE_KEY;
  country_code: 'CL';
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Una sociedad del registro, reducida a lo que la carga de alias usa. */
export type ClSiiAliasSourceRow = {
  rut: string | null;
  legalName: string | null;
  core: string | null;
  workers: number | null;
  metricsYear: number | null;
};

/**
 * La fila de alias de una sociedad, o null. `companiesWithWord` dice en cuántas
 * sociedades distintas del registro sale cada palabra (lo cuenta la carga).
 */
export function buildClSiiNameAliasRow(
  company: ClSiiAliasSourceRow,
  companiesWithWord: ReadonlyMap<string, number>,
  params: { sourceYear: number; importedAt: string },
): ClSiiNameAliasRow | null {
  const rut = normalizeChileRut(company.rut);
  const core = company.core?.trim() ?? '';
  if (rut === null || core.length === 0) return null;
  if ((company.legalName ?? '').trim().length === CL_SII_TRUNCATED_NAME_LENGTH) return null;
  if (company.workers === null || company.workers < CL_BRAND_ALIAS_MIN_WORKERS) return null;
  const key = chileBrandTailKey(core);
  if (key === null || companiesWithWord.get(key) !== 1) return null;
  const identity = buildRecordIdentityKey(CL_NAME_ALIAS_IDENTITY_NAMESPACE, `${rut}:${key}`);
  return {
    source_key: CL_SII_NAME_ALIAS_SOURCE_KEY,
    country_code: 'CL',
    source_year: params.sourceYear,
    tax_id: rut,
    normalized_tax_id: rut,
    legal_name: (company.legalName ?? core).trim(),
    normalized_legal_name: key,
    raw_data: {
      alias_origin: 'sii_brand_tail',
      registry_core: core,
      workers: company.workers,
      ...(company.metricsYear !== null ? { metrics_year: company.metricsYear } : {}),
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
