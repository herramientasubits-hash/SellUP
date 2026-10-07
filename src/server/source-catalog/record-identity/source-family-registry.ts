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
  // SOURCES-AR-RNS-1 — un CUIT, una fila (proveedoras del Estado del RNS de Argentina).
  ar_rns: 'TAX_GRAIN',
  // SOURCES-AR-CUIT-BY-NAME-1 — un CUIT, una fila (todas las sociedades activas del RNS).
  ar_rns_registry: 'TAX_GRAIN',
  // SOURCES-AR-E2E-1 — un CUIT, una fila (sociedades activas con ≥100 trabajadores en ATP 2020).
  ar_atp_employers: 'TAX_GRAIN',
  // SOURCES-PE-RUC-BY-NAME-1 — un RUC, una fila (sociedades activas y habidas de SUNAT).
  pe_sunat_registry: 'TAX_GRAIN',
  // SOURCES-PY-RUC-BY-NAME-1 — un RUC, una fila (sociedades activas del padrón de la SET).
  py_set_registry: 'TAX_GRAIN',
  // SOURCES-UY-RUT-BY-NAME-1 — un RUT, una fila (empresas activas del RUPE de Uruguay).
  uy_rupe_registry: 'TAX_GRAIN',
  // SOURCES-US-EIN-BY-NAME-1 — un EIN, una fila (empresas activas de la SEC; ONG del IRS).
  us_sec_edgar_registry: 'TAX_GRAIN',
  us_irs_eo_registry: 'TAX_GRAIN',
  // SOURCES-ES-NIF-BY-NAME-1 — un NIF, una fila (sociedades adjudicatarias en España).
  es_placsp_registry: 'TAX_GRAIN',
  mx_compranet_rfc_registry: 'TAX_GRAIN',
  // SOURCES-MX-RFC-PUBLIC-LISTS-1 — un RFC, una fila (importadores, donatarias SAT, proveedores NL).
  mx_rfc_public_lists_registry: 'TAX_GRAIN',
  pa_panamacompra_ruc_registry: 'TAX_GRAIN',
  hn_ocds_rtn_registry: 'TAX_GRAIN',
  // SOURCES-CL-RUT-BY-NAME-1 — un RUT, una fila (sociedades del Registro de Empresas y Sociedades).
  cl_res_registry: 'TAX_GRAIN',
  cl_sii_registry: 'TAX_GRAIN',
  // SOURCES-EC-FREE-DISCOVERY-1 — un RUC, una fila (compañías activas de 200+ empleados de la SCVS).
  ec_scvs_directory: 'TAX_GRAIN',
  // SOURCES-EC-CLOSE-1 — un RUC, una fila: compañías activas de la SCVS con empleados,
  // su sigla, y el catastro del SRI (entidades públicas y nombre comercial).
  ec_scvs_registry: 'TAX_GRAIN',
  ec_scvs_alias_registry: 'TAX_GRAIN',
  ec_sri_registry: 'TAX_GRAIN',
  // SOURCES-CL-SII-FREE-DISCOVERY-1 — un RUT, una fila (personas jurídicas del SII con 100+ trabajadores).
  cl_sii_directory: 'TAX_GRAIN',
  // SOURCES-PE-FREE-DISCOVERY-1 — un RUC, una fila (sociedades y entidades de SUNAT con 200+ trabajadores).
  pe_sunat_directory: 'TAX_GRAIN',
  // SOURCES-CR-CEDULA-BY-NAME-1 — una cédula jurídica, una fila (PYMES MEIC + proveedores SICOP con nombre).
  cr_company_registry: 'TAX_GRAIN',
  // SOURCES-DO-SIZE-SIGNAL-1 — un RNC, una fila (empresas con señal de tamaño; nombres comerciales).
  do_dgii_size_registry: 'TAX_GRAIN',
  do_dgii_trade_name_registry: 'TAX_GRAIN',
  // SOURCES-BO-CLOSE-1 — un NIT, una fila (grandes contribuyentes PRICO/GRACO y
  // operadores PRIO/OEA, con nombre del SEPREC).
  bo_large_taxpayers: 'TAX_GRAIN',
  pa_panamacompra_convenio: 'NATIVE_RECORD_GRAIN',
  // SOURCES-BO-CLOSE-1 — una fila por ficha de gob.bo (`gobbo:<slug>`): las entidades
  // públicas no tienen NIT publicado.
  bo_public_entities: 'NATIVE_RECORD_GRAIN',
  // SOURCES-PE-CLOSE-1 — varias filas por RUC (una por clave de nombre: alias del
  // padrón, entidad pública, entidad contratante OECE): identidad `pe-name-alias:<RUC>:<clave>`.
  pe_sunat_name_alias: 'NATIVE_RECORD_GRAIN',
  co_fedesoft: 'NATIVE_RECORD_GRAIN',
  ec_scvs: 'NATIVE_RECORD_GRAIN',
  // SOURCES-EC-CLOSE-2 — hasta 3 marcas por RUC: la 1.ª con clave tax:<RUC>, las demás
  // sri_trade:<RUC>-<n>. Un RUC puede tener varias filas.
  ec_sri_trade_name_registry: 'NATIVE_RECORD_GRAIN',
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
