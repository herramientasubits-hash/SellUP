/**
 * Source family registry for source_company_snapshots read contracts.
 * Hito: EC4D5.APP-C1A — Source family registry + snapshot read types
 *
 * Classifies each active source_key by the cardinality contract of its
 * record identity within (source_key, country_code, source_year):
 *
 * - TAX_GRAIN: identity is fiscal (tax:<normalized_tax_id>), so one fiscal
 *   identity maps to at most one row. More than one row for the same fiscal
 *   identity is an invariant violation for these sources.
 * - NATIVE_RECORD_GRAIN: identity is a provider-native record id (e.g.
 *   provider/company for PanamaCompra, fedesoft-directory for Fedesoft),
 *   so the same fiscal identity may legitimately span multiple rows.
 *
 * Fail-closed on purpose: an unknown source_key throws instead of being
 * silently classified. Never default a new source to TAX_GRAIN — classify
 * it here explicitly when its writer lands.
 *
 * ec_scvs (SCVS Ecuador) is registered as NATIVE_RECORD_GRAIN: its physical
 * row identity is the provider-native `expediente`, not a fiscal id. RUC may
 * later be stored as normalized_tax_id but never defines the record identity.
 */

export type SourceFamily = 'TAX_GRAIN' | 'NATIVE_RECORD_GRAIN';

export const SOURCE_FAMILY_BY_SOURCE_KEY: Readonly<Record<string, SourceFamily>> = {
  cl_chilecompra_ocds: 'TAX_GRAIN',
  cr_sicop: 'TAX_GRAIN',
  hn_contrataciones_abiertas: 'TAX_GRAIN',
  do_dgcp: 'TAX_GRAIN',
  rd_dgii_bulk: 'TAX_GRAIN',
  gt_rgae_proveedores: 'TAX_GRAIN',
  co_siis: 'TAX_GRAIN',
  pa_panamacompra_convenio: 'NATIVE_RECORD_GRAIN',
  co_fedesoft: 'NATIVE_RECORD_GRAIN',
  ec_scvs: 'NATIVE_RECORD_GRAIN',
};

export function getSourceFamily(sourceKey: string): SourceFamily {
  const family = SOURCE_FAMILY_BY_SOURCE_KEY[sourceKey];
  if (family === undefined) {
    throw new Error(`Unknown source family for source_key: ${sourceKey}`);
  }
  return family;
}

export function isTaxGrainSource(sourceKey: string): boolean {
  return getSourceFamily(sourceKey) === 'TAX_GRAIN';
}

export function isNativeRecordGrainSource(sourceKey: string): boolean {
  return getSourceFamily(sourceKey) === 'NATIVE_RECORD_GRAIN';
}
