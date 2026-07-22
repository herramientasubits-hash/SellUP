/**
 * Ecuador SCVS — Snapshot Lookup Service — EC-SCVS-4.
 *
 * Looks up an already-imported SCVS Ecuador company in
 * `source_company_snapshots`. Reads ONLY the pre-loaded ec_scvs snapshot.
 * Never calls SCVS/Supercias, SRI Ecuador, or any external API.
 *
 * IDENTITY MODEL (critical — see source-family-registry + ec-scvs-record-identity):
 *   ec_scvs is NATIVE_RECORD_GRAIN. The physical row identity is the
 *   provider-native `expediente` (`expediente:<trim(expediente)>`), NOT the RUC.
 *   The same fiscal identity (RUC) may legitimately span MULTIPLE expedientes,
 *   so a RUC lookup can resolve to more than one record. This reader NEVER
 *   collapses that to one arbitrary row: multiplicity is surfaced as an
 *   observable outcome (`multiple_records_same_ruc`) with the record count and
 *   the bounded list of record_identity_keys, so a caller can disambiguate.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call SCVS/Supercias, SRI Ecuador, or any external endpoint
 * - Call Tavily, Apollo, Lusha, or any LLM/provider
 * - Write to source_company_snapshots or any table (read-only)
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Connect to prospection (no runtime integration in this hito)
 * - Be used for source_keys/countries other than ec_scvs / EC
 * - Use the TAX_GRAIN read helpers (ec_scvs is a native-record source)
 * - Collapse a RUC to one arbitrary row via single-row truncation
 * - Treat legal_name / RUC as the physical record identity
 *
 * Contract usage:
 *   by expediente (exact record identity) → readSnapshotByRecordIdentityKey
 *   by RUC + year                          → probeNativeSnapshotsByTaxId
 *   by RUC latest year (no year)           → probeLatestNativeSnapshotsByTaxId
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEcuadorRuc } from '../source-catalog/connectors/ec-scvs/ec-ruc-normalizer';
import { deriveEcScvsRecordIdentity } from '../source-catalog/connectors/ec-scvs/ec-scvs-record-identity';
import {
  SnapshotReadQueryError,
  probeLatestNativeSnapshotsByTaxId,
  probeNativeSnapshotsByTaxId,
  readSnapshotByRecordIdentityKey,
  type SnapshotIdentityRow,
  type SnapshotReadClient,
} from '../source-catalog/snapshot-read/snapshot-read-contract';

const SOURCE_KEY = 'ec_scvs';
const COUNTRY_CODE = 'EC';

/**
 * Columns this reader projects. Includes source_year (required by the
 * latest-year native probe) and record_identity_key (echoed back on a match
 * and on RUC multiplicity).
 */
const SNAPSHOT_SELECT_COLUMNS =
  'source_year, legal_name, normalized_tax_id, record_identity_key, raw_data';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EcScvsExpedienteLookupInput {
  expediente: string;
  year: number;
}

export interface EcScvsRucLookupInput {
  ruc: string;
  year: number;
}

export interface EcScvsLatestRucLookupInput {
  ruc: string;
}

/**
 * Company fields projected from raw_data. SCVS is an official_company_registry:
 * it does NOT report corporate status, objeto social, legal representative, or
 * CIIU, and implies neither SRI nor legal validation.
 */
export interface EcScvsCompanySummary {
  source_type: string | null;
  expediente: string | null;
  ruc: string | null;
  nombre: string | null;
  tipo: string | null;
  pro_codigo: string | null;
  provincia: string | null;
  legal_validation_status: string | null;
  tax_validation_status: string | null;
  source_status: string | null;
  human_review_required: boolean;
}

export interface EcScvsLookupResult {
  matched: boolean;
  record_identity_key: string | null;
  source_year: number | null;
  legal_name: string | null;
  normalized_tax_id: string | null;
  company_summary: EcScvsCompanySummary | null;
  raw_data: Record<string, unknown> | null;
  /**
   * Number of records the RUC resolved to when it maps to more than one native
   * record (`multiple_records_same_ruc`); null otherwise.
   */
  record_count: number | null;
  /**
   * Bounded list of record_identity_keys for the ambiguous RUC, so a caller can
   * disambiguate the expedientes; null unless `multiple_records_same_ruc`.
   */
  record_identity_keys: readonly string[] | null;
  reason: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toBool(v: unknown): boolean {
  return v === true;
}

function extractCompanySummary(rawData: Record<string, unknown>): EcScvsCompanySummary {
  return {
    source_type: toStr(rawData.source_type),
    expediente: toStr(rawData.expediente),
    ruc: toStr(rawData.ruc),
    nombre: toStr(rawData.nombre),
    tipo: toStr(rawData.tipo),
    pro_codigo: toStr(rawData.pro_codigo),
    provincia: toStr(rawData.provincia),
    legal_validation_status: toStr(rawData.legal_validation_status),
    tax_validation_status: toStr(rawData.tax_validation_status),
    source_status: toStr(rawData.source_status),
    human_review_required: toBool(rawData.human_review_required),
  };
}

// ── Admin client ───────────────────────────────────────────────────────────────

function getAdminSupabase(): SupabaseClient | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key);
}

// ── Result factories ─────────────────────────────────────────────────────────

function noMatch(
  reason: string,
  normalizedTaxId: string | null = null,
): EcScvsLookupResult {
  return {
    matched: false,
    record_identity_key: null,
    source_year: null,
    legal_name: null,
    normalized_tax_id: normalizedTaxId,
    company_summary: null,
    raw_data: null,
    record_count: null,
    record_identity_keys: null,
    reason,
  };
}

function toMatch(
  row: Record<string, unknown>,
  normalizedTaxId: string | null,
): EcScvsLookupResult {
  const rawData = (row.raw_data as Record<string, unknown>) ?? {};
  return {
    matched: true,
    record_identity_key: toStr(row.record_identity_key),
    source_year: toNum(row.source_year),
    legal_name: toStr(row.legal_name),
    normalized_tax_id: toStr(row.normalized_tax_id) ?? normalizedTaxId,
    company_summary: extractCompanySummary(rawData),
    raw_data: rawData,
    record_count: null,
    record_identity_keys: null,
    reason: null,
  };
}

/**
 * Maps a SnapshotReadQueryError (DB/transport failure) to a stable no-match
 * reason. Infrastructure failure must NEVER masquerade as "not found".
 */
function mapCaughtError(err: unknown, normalizedTaxId: string | null): EcScvsLookupResult {
  if (err instanceof SnapshotReadQueryError) {
    return noMatch('snapshot_query_error', normalizedTaxId);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return noMatch(`lookup_error: ${msg.slice(0, 200)}`, normalizedTaxId);
}

// ── 1. exact lookup by expediente (record identity) ───────────────────────────

/**
 * Looks up the single SCVS row for an exact expediente within
 * (ec_scvs, EC, year). Uses the exact record-identity contract: CN1 guarantees
 * zero-or-one row, so this never picks arbitrarily. The `expediente` is turned
 * into the native record_identity_key via the connector's identity deriver.
 */
export async function lookupEcScvsByExpediente(
  input: EcScvsExpedienteLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<EcScvsLookupResult> {
  const identity = deriveEcScvsRecordIdentity({ expediente: input.expediente });
  if (identity.status !== 'resolved') {
    return noMatch('invalid_expediente');
  }
  const recordIdentityKey = identity.recordIdentityKey;

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return noMatch('snapshot_unavailable');
  }

  try {
    const client = sb as unknown as SnapshotReadClient<SnapshotIdentityRow>;
    const result = await readSnapshotByRecordIdentityKey({
      client,
      sourceKey: SOURCE_KEY,
      countryCode: COUNTRY_CODE,
      sourceYear: input.year,
      recordIdentityKey,
      selectColumns: SNAPSHOT_SELECT_COLUMNS,
    });

    switch (result.status) {
      case 'IDENTITY_UNAVAILABLE':
        return noMatch('invalid_expediente');
      case 'RECORD_IDENTITY_NOT_FOUND':
        return noMatch('no_snapshot_match');
      case 'FOUND':
        return toMatch(result.row as Record<string, unknown>, null);
      // A native exact-identity lookup cannot surface these, but keep the switch
      // exhaustive and fail observably rather than silently.
      case 'MULTI_RECORD_SAME_FISCAL_IDENTITY':
      case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
        return noMatch('snapshot_cardinality_violation');
    }
  } catch (err) {
    return mapCaughtError(err, null);
  }
}

// ── 2. lookup by RUC at an exact year (native probe) ───────────────────────────

/**
 * Probes SCVS records for a RUC within (ec_scvs, EC, year). Because ec_scvs is
 * NATIVE_RECORD_GRAIN, a RUC may map to several expedientes: multiplicity is
 * reported (`multiple_records_same_ruc`) with the count and bounded identity
 * keys, never collapsed to one arbitrary row.
 */
export async function lookupEcScvsByRuc(
  input: EcScvsRucLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<EcScvsLookupResult> {
  const rucResult = normalizeEcuadorRuc(input.ruc);
  if (rucResult.status !== 'valid' || rucResult.normalized === null) {
    return noMatch('invalid_ruc');
  }
  const normalizedRuc = rucResult.normalized;

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return noMatch('snapshot_unavailable', normalizedRuc);
  }

  try {
    const client = sb as unknown as SnapshotReadClient<SnapshotIdentityRow>;
    const result = await probeNativeSnapshotsByTaxId({
      client,
      sourceKey: SOURCE_KEY,
      countryCode: COUNTRY_CODE,
      sourceYear: input.year,
      normalizedTaxId: normalizedRuc,
      selectColumns: SNAPSHOT_SELECT_COLUMNS,
    });
    return resolveNativeRucResult(result, normalizedRuc);
  } catch (err) {
    return mapCaughtError(err, normalizedRuc);
  }
}

// ── 3. lookup by RUC at the latest available year (native probe) ───────────────

/**
 * Probes SCVS records for a RUC at its MOST RECENT source_year within
 * (ec_scvs, EC). Safe replacement for the legacy "latest available year"
 * pattern on a native source: multiplicity within the latest year is reported
 * as `multiple_records_same_ruc`, never an arbitrary silent pick.
 */
export async function lookupLatestEcScvsByRuc(
  input: EcScvsLatestRucLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<EcScvsLookupResult> {
  const rucResult = normalizeEcuadorRuc(input.ruc);
  if (rucResult.status !== 'valid' || rucResult.normalized === null) {
    return noMatch('invalid_ruc');
  }
  const normalizedRuc = rucResult.normalized;

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return noMatch('snapshot_unavailable', normalizedRuc);
  }

  try {
    const client = sb as unknown as SnapshotReadClient<SnapshotIdentityRow>;
    const result = await probeLatestNativeSnapshotsByTaxId({
      client,
      sourceKey: SOURCE_KEY,
      countryCode: COUNTRY_CODE,
      normalizedTaxId: normalizedRuc,
      selectColumns: SNAPSHOT_SELECT_COLUMNS,
    });
    return resolveNativeRucResult(result, normalizedRuc);
  } catch (err) {
    return mapCaughtError(err, normalizedRuc);
  }
}

// ── shared native RUC result mapping ───────────────────────────────────────────

/**
 * Maps a native-probe SnapshotReadResult to the reader's external shape. Shared
 * by the exact-year and latest-year RUC paths so both expose multiplicity
 * identically. Never picks a row silently on multiplicity.
 */
function resolveNativeRucResult(
  result: Awaited<ReturnType<typeof probeNativeSnapshotsByTaxId>>,
  normalizedRuc: string,
): EcScvsLookupResult {
  switch (result.status) {
    case 'IDENTITY_UNAVAILABLE':
      return noMatch('invalid_ruc', normalizedRuc);
    case 'RECORD_IDENTITY_NOT_FOUND':
      return noMatch('no_snapshot_match', normalizedRuc);
    case 'FOUND':
      return toMatch(result.row as Record<string, unknown>, normalizedRuc);
    case 'MULTI_RECORD_SAME_FISCAL_IDENTITY': {
      const multi = noMatch('multiple_records_same_ruc', normalizedRuc);
      return {
        ...multi,
        record_count: result.recordCount,
        record_identity_keys: result.recordIdentityKeys ?? [],
      };
    }
    // A native probe should not emit the TAX_GRAIN invariant status, but if it
    // ever does, surface it observably rather than as a silent match.
    case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
      return noMatch('snapshot_cardinality_violation', normalizedRuc);
  }
}
