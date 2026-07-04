/**
 * Honduras Contrataciones Abiertas — OCDS Types
 *
 * Fuente: OCP Data Registry, publicación 122, archivos anuales .jsonl.gz.
 * Portal directo (contratacionesabiertas.gob.hn) inestable; usar OCP Registry.
 *
 * Solo lectura. Sin DB. Sin UI. Hito Centroamérica.8C.1
 *
 * Identificadores relevantes:
 *   HN-RTN  — Registro Tributario Nacional (14 dígitos)
 *   X-ONCAE-SUPPLIERS-HC1 — legacy sin RTN, ignorar en este hito
 */

// ─── OCP Registry ──────────────────────────────────────────────────────────────

export const HN_SOURCE_KEY = 'hn_contrataciones_abiertas' as const;

/**
 * URL estable de descarga OCP Data Registry para Honduras (pub 122).
 *
 * Endpoint download?name=YEAR.jsonl.gz redirige automáticamente a Fastly CDN.
 * Más estable que hardcodear IDs Fastly internos (/3360/, etc.) que pueden cambiar.
 * Node fetch sigue redirects por defecto.
 *
 * Override completo posible via HN_OCP_FEED_URL_OVERRIDE (ignora year).
 */
export function hnAnnualFeedUrl(year: number): string {
  const override = process.env['HN_OCP_FEED_URL_OVERRIDE'];
  if (override) return override;
  return `https://data.open-contracting.org/en/publication/122/download?name=${year}.jsonl.gz`;
}

// ─── RTN Normalizer output ─────────────────────────────────────────────────────

export type HnRtnNormalizeResult =
  | { raw: string; normalized: string; isValid: true }
  | { raw: string | null; normalized: null; isValid: false; reason: HnRtnInvalidReason };

export type HnRtnInvalidReason =
  | 'missing'
  | 'invalid_length'
  | 'non_numeric';

// ─── OCDS raw shapes (defensivos/parciales) ────────────────────────────────────

export type OcdsIdentifier = {
  scheme?: string | null;
  id?: string | number | null;
  legalName?: string | null;
};

export type OcdsAddress = {
  countryName?: string | null;
  region?: string | null;
};

export type OcdsParty = {
  id?: string | number | null;
  name?: string | null;
  identifier?: OcdsIdentifier | null;
  roles?: string[] | null;
  address?: OcdsAddress | null;
};

export type OcdsValue = {
  amount?: number | null;
  currency?: string | null;
};

export type OcdsAwardSupplier = {
  id?: string | number | null;
  name?: string | null;
};

export type OcdsAward = {
  id?: string | number | null;
  status?: string | null;
  date?: string | null;
  value?: OcdsValue | null;
  suppliers?: OcdsAwardSupplier[] | null;
};

export type OcdsTender = {
  id?: string | number | null;
  title?: string | null;
  status?: string | null;
  procurementMethod?: string | null;
  tenderPeriod?: { startDate?: string | null; endDate?: string | null } | null;
};

export type OcdsRelease = {
  ocid?: string | null;
  date?: string | null;
  tag?: string[] | null;
  tender?: OcdsTender | null;
  parties?: OcdsParty[] | null;
  awards?: OcdsAward[] | null;
};

// ─── Adapter output ────────────────────────────────────────────────────────────

/**
 * Candidato técnico producido por el adapter.
 * Listo para inspección en dry-run; no se escribe en DB en este hito.
 */
export type HnOcdsCandidate = {
  sourceKey: typeof HN_SOURCE_KEY;
  countryCode: 'HN';
  supplierName: string;
  rawRtn: string;
  normalizedRtn: string;
  rtnValid: true;
  roles: string[];
  ocids: string[];
  awardsCount: number;
  tendersCount: number;
  contractsCount: number;
  totalAwardAmount: number | null;
  latestDate: string | null;
  legalEntityHint: 'likely_legal_entity' | 'unknown_or_person_natural_risk';
  legalEntityReason: string | null;
  source: 'ocp_registry_jsonl';
  metadata: {
    rawIdentifierId: string | null;
  };
};

// ─── Dry-run summary ──────────────────────────────────────────────────────────

export type HnDryRunSummary = {
  source_key: typeof HN_SOURCE_KEY;
  year: number;
  lines_read: number;
  parties_seen: number;
  supplier_or_tenderer_seen: number;
  hn_rtn_seen: number;
  valid_rtn_count: number;
  invalid_rtn_count: number;
  legacy_scheme_ignored: number;
  unique_valid_rtn: number;
  likely_legal_entity_count: number;
  unknown_or_person_natural_risk_count: number;
  sample_masked_suppliers: string[];
  writes_performed: 0;
};
