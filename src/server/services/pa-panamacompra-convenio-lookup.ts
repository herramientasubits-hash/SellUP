/**
 * PanamaCompra Convenio Marco — Post-Approval Lookup Service — Centroamérica.5F
 *
 * Looks up a Panamanian company in source_company_snapshots using its
 * normalized RUC. Reads ONLY from the pre-loaded pa_panamacompra_convenio snapshot.
 * Never calls PanamaCompra API, DGI Panamá, or Registro Público Panamá.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call PanamaCompra API (listaProveedor, ObtenerInfoProveedor, ListarActosParametros, searchOrderList)
 * - Call DGI Panamá or any Hacienda Panamá endpoint
 * - Call Registro Público Panamá
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch source_coverage_summaries
 * - Be called for countries other than PA (enforced by caller guard)
 * - Validate RUC legally (not a fiscal/legal registry)
 * - Replace DGI Panamá as legal/tax registry
 * - Replace Registro Público Panamá
 * - Invent CIIU codes (official_ciiu_available is always false)
 *
 * Semantic obligations (enforced here):
 *   source_type: 'procurement_signal'    — PanamaCompra is commercial signal, NOT legal/tax
 *   coverage_scope: 'convenio_marco'     — only Convenio Marco, not all contracting
 *   legal_validation_status: 'not_applicable'
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 *   sector_source: 'not_provided_by_panamacompra'
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePanamaRuc } from '../source-catalog/connectors/panamacompra-pa/panamacompra-pa-normalizer';
import {
  SnapshotReadQueryError,
  probeLatestNativeSnapshotsByTaxId,
  probeNativeSnapshotsByTaxId,
  type SnapshotIdentityRow,
  type SnapshotReadClient,
} from '../source-catalog/snapshot-read/snapshot-read-contract';

const SOURCE_KEY = 'pa_panamacompra_convenio';
const COUNTRY_CODE = 'PA';

/**
 * Columns this reader projects. Includes source_year, required by the
 * latest-year cardinality-aware native probe.
 */
const SNAPSHOT_SELECT_COLUMNS = 'source_year, legal_name, normalized_tax_id, raw_data';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PaPanamaCompraLookupInput {
  ruc: string;
  year?: number;
}

export interface PaPanamaCompraLookupResult {
  matched: boolean;
  source_year: number | null;
  legal_name: string | null;
  normalized_tax_id: string | null;
  procurement_summary: PaPanamaCompraProcurementSummary | null;
  raw_data: Record<string, unknown> | null;
  reason: string | null;
}

export interface PaPanamaCompraProcurementSummary {
  coverage_scope: 'convenio_marco';
  convenios: unknown[];
  representative_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  branches: unknown[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function toArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
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

// ── Procurement summary extraction ────────────────────────────────────────────

function extractProcurementSummary(
  rawData: Record<string, unknown>,
): PaPanamaCompraProcurementSummary {
  return {
    coverage_scope: 'convenio_marco',
    convenios: toArr(rawData.convenios),
    representative_name: toStr(rawData.representative_name) ?? toStr(rawData.representativeName),
    phone: toStr(rawData.phone) ?? toStr(rawData.telefono),
    email: toStr(rawData.email) ?? toStr(rawData.correo),
    address: toStr(rawData.address) ?? toStr(rawData.direccion),
    branches: toArr(rawData.branches) ?? toArr(rawData.sucursales),
  };
}

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a Panamanian supplier in source_company_snapshots (pa_panamacompra_convenio)
 * by normalized RUC. If year is omitted, selects the most recent available year.
 *
 * Never calls PanamaCompra, DGI Panamá, or Registro Público — reads local snapshot only.
 */
export async function lookupPanamaCompraConvenioByRuc(
  input: PaPanamaCompraLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<PaPanamaCompraLookupResult> {
  const rucResult = normalizePanamaRuc(input.ruc);

  if (!rucResult.valid) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: null,
      procurement_summary: null,
      raw_data: null,
      reason: 'invalid_ruc_format',
    };
  }

  const normalizedRuc = rucResult.normalized;

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: normalizedRuc,
      procurement_summary: null,
      raw_data: null,
      reason: 'snapshot_unavailable',
    };
  }

  // No-match envelope shared across the several outcomes below so the external
  // result shape stays identical to the pre-migration reader.
  function noMatch(reason: string): PaPanamaCompraLookupResult {
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: normalizedRuc,
      procurement_summary: null,
      raw_data: null,
      reason,
    };
  }

  try {
    const client = sb as unknown as SnapshotReadClient<SnapshotIdentityRow>;

    // Migrated to the cardinality-aware native contract (EC4D5.APP-C5-R2):
    // pa_panamacompra_convenio is NATIVE_RECORD_GRAIN, so a single fiscal id can
    // legitimately map to more than one record. An exact year uses the
    // source_year-pinned native probe; the production path without year uses the
    // latest-year native probe. Neither truncates to a single arbitrary row;
    // multiple native records for one RUC surface as multiplicity, never a
    // silent pick.
    const result =
      input.year != null
        ? await probeNativeSnapshotsByTaxId({
            client,
            sourceKey: SOURCE_KEY,
            countryCode: COUNTRY_CODE,
            sourceYear: input.year,
            normalizedTaxId: normalizedRuc,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          })
        : await probeLatestNativeSnapshotsByTaxId({
            client,
            sourceKey: SOURCE_KEY,
            countryCode: COUNTRY_CODE,
            normalizedTaxId: normalizedRuc,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          });

    switch (result.status) {
      case 'RECORD_IDENTITY_NOT_FOUND':
        return noMatch('no_snapshot_match_by_ruc');
      case 'IDENTITY_UNAVAILABLE':
        return noMatch('invalid_ruc_format');
      case 'MULTI_RECORD_SAME_FISCAL_IDENTITY':
      // A native reader should never hit the TAX_GRAIN invariant status, but if
      // it ever does treat it as a controlled, observable cardinality guardrail
      // rather than a silent match.
      case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
        return noMatch('snapshot_cardinality_violation');
      case 'FOUND': {
        const row = result.row as Record<string, unknown>;
        const rawData = (row.raw_data as Record<string, unknown>) ?? {};

        return {
          matched: true,
          source_year: toNum(row.source_year),
          legal_name: toStr(row.legal_name),
          normalized_tax_id: toStr(row.normalized_tax_id) ?? normalizedRuc,
          procurement_summary: extractProcurementSummary(rawData),
          raw_data: rawData,
          reason: null,
        };
      }
    }
  } catch (err) {
    // A DB/transport failure surfaces as SnapshotReadQueryError from the
    // contract; preserve the pre-migration `snapshot_query_error` reason for it.
    if (err instanceof SnapshotReadQueryError) {
      return noMatch('snapshot_query_error');
    }
    const msg = err instanceof Error ? err.message : String(err);
    return noMatch(`lookup_error: ${msg.slice(0, 200)}`);
  }
}
