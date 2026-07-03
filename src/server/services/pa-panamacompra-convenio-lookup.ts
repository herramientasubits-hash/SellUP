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

const SNAPSHOT_TABLE = 'source_company_snapshots';
const SOURCE_KEY = 'pa_panamacompra_convenio';
const COUNTRY_CODE = 'PA';

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

  try {
    let query = sb
      .from(SNAPSHOT_TABLE)
      .select('source_year, legal_name, normalized_tax_id, raw_data')
      .eq('source_key', SOURCE_KEY)
      .eq('country_code', COUNTRY_CODE)
      .eq('normalized_tax_id', normalizedRuc);

    if (input.year != null) {
      query = query.eq('source_year', input.year);
    } else {
      query = query.order('source_year', { ascending: false });
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      return {
        matched: false,
        source_year: null,
        legal_name: null,
        normalized_tax_id: normalizedRuc,
        procurement_summary: null,
        raw_data: null,
        reason: 'snapshot_query_error',
      };
    }

    if (!data) {
      return {
        matched: false,
        source_year: null,
        legal_name: null,
        normalized_tax_id: normalizedRuc,
        procurement_summary: null,
        raw_data: null,
        reason: 'no_snapshot_match_by_ruc',
      };
    }

    const row = data as Record<string, unknown>;
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      matched: false,
      source_year: null,
      legal_name: null,
      normalized_tax_id: normalizedRuc,
      procurement_summary: null,
      raw_data: null,
      reason: `lookup_error: ${msg.slice(0, 200)}`,
    };
  }
}
