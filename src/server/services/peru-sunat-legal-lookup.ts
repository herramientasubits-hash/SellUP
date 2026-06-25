/**
 * Perú SUNAT Legal Lookup Service (Perú.5A)
 *
 * Server-side service for legal validation of Peru candidates
 * against the SUNAT Padrón Reducido snapshot stored in Supabase.
 *
 * GUARDRAILS — this service must NEVER:
 * - Download padron_reducido_ruc.zip
 * - Read from .tmp/sunat-peru/ filesystem paths
 * - Call SUNAT API endpoints directly
 * - Call Migo API
 * - Call Tavily or any web search API
 * - Return CIIU or sector_inferred data
 * - Insert into prospect_candidates or prospect_batches
 *
 * All reads come from the pre-loaded Supabase snapshot only.
 * The snapshot is populated by an offline worker (not Vercel).
 * See docs/PERU_MVP_ACTIVATION_PLAN.md §2.4, §7, §9.
 */

import { createClient } from '@supabase/supabase-js';
import {
  normalizeRuc,
  isValidRuc,
} from '../source-catalog/connectors/sunat-peru/normalizers';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://lrdruowtadwbdulndlph.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SNAPSHOT_TABLE = 'peru_sunat_ruc_snapshot';

// ── Types ──────────────────────────────────────────────────────

export type PeruLegalValidationStatus =
  | 'verified'
  | 'not_found'
  | 'flagged'
  | 'pending_snapshot_validation'
  | 'snapshot_unavailable';

export type PeruLegalValidationReason =
  | 'ruc_found_active_habido'
  | 'ruc_not_found_in_snapshot'
  | 'taxpayer_inactive'
  | 'domicile_not_habido'
  | 'snapshot_not_loaded'
  | 'invalid_ruc_format'
  | 'missing_ruc';

export interface PeruSunatRucSnapshotRow {
  ruc: string;
  legal_name: string;
  taxpayer_status: string | null;
  domicile_condition: string | null;
  ubigeo: string | null;
  department: string | null;
  province: string | null;
  district: string | null;
  address: string | null;
  source_key: string;
  snapshot_period: string | null;
  snapshot_loaded_at: string | null;
  is_active: boolean;
  is_habido: boolean;
}

export interface PeruSunatLegalLookupResult {
  status: PeruLegalValidationStatus;
  reason: PeruLegalValidationReason;
  ruc: string | null;
  legalName: string | null;
  taxpayerStatus: string | null;
  domicileCondition: string | null;
  ubigeo: string | null;
  department: string | null;
  province: string | null;
  district: string | null;
  isActive: boolean | null;
  isHabido: boolean | null;
  snapshotPeriod: string | null;
  snapshotLoadedAt: string | null;
  checkedAt: string;
}

export interface PeruLegalValidationInput {
  ruc: string;
  expectedLegalName?: string;
}

export interface PeruLegalValidationOutput {
  input: PeruLegalValidationInput;
  result: PeruSunatLegalLookupResult;
}

// ── Pure logic ─────────────────────────────────────────────────

/**
 * Derives the validation result from a snapshot row (or its absence).
 * Pure function — no I/O, fully testable without Supabase.
 */
export function buildLegalLookupResult(
  ruc: string,
  row: PeruSunatRucSnapshotRow | null,
  opts: { snapshotAvailable: boolean },
): PeruSunatLegalLookupResult {
  const checkedAt = new Date().toISOString();
  const normalizedRuc = normalizeRuc(ruc);

  if (!isValidRuc(normalizedRuc)) {
    return {
      status: 'flagged',
      reason: 'invalid_ruc_format',
      ruc: normalizedRuc || null,
      legalName: null,
      taxpayerStatus: null,
      domicileCondition: null,
      ubigeo: null,
      department: null,
      province: null,
      district: null,
      isActive: null,
      isHabido: null,
      snapshotPeriod: null,
      snapshotLoadedAt: null,
      checkedAt,
    };
  }

  if (!opts.snapshotAvailable) {
    return {
      status: 'snapshot_unavailable',
      reason: 'snapshot_not_loaded',
      ruc: normalizedRuc,
      legalName: null,
      taxpayerStatus: null,
      domicileCondition: null,
      ubigeo: null,
      department: null,
      province: null,
      district: null,
      isActive: null,
      isHabido: null,
      snapshotPeriod: null,
      snapshotLoadedAt: null,
      checkedAt,
    };
  }

  if (!row) {
    return {
      status: 'not_found',
      reason: 'ruc_not_found_in_snapshot',
      ruc: normalizedRuc,
      legalName: null,
      taxpayerStatus: null,
      domicileCondition: null,
      ubigeo: null,
      department: null,
      province: null,
      district: null,
      isActive: null,
      isHabido: null,
      snapshotPeriod: null,
      snapshotLoadedAt: null,
      checkedAt,
    };
  }

  if (!row.is_active) {
    return {
      status: 'flagged',
      reason: 'taxpayer_inactive',
      ruc: row.ruc,
      legalName: row.legal_name,
      taxpayerStatus: row.taxpayer_status,
      domicileCondition: row.domicile_condition,
      ubigeo: row.ubigeo,
      department: row.department,
      province: row.province,
      district: row.district,
      isActive: false,
      isHabido: row.is_habido,
      snapshotPeriod: row.snapshot_period,
      snapshotLoadedAt: row.snapshot_loaded_at,
      checkedAt,
    };
  }

  if (!row.is_habido) {
    return {
      status: 'flagged',
      reason: 'domicile_not_habido',
      ruc: row.ruc,
      legalName: row.legal_name,
      taxpayerStatus: row.taxpayer_status,
      domicileCondition: row.domicile_condition,
      ubigeo: row.ubigeo,
      department: row.department,
      province: row.province,
      district: row.district,
      isActive: true,
      isHabido: false,
      snapshotPeriod: row.snapshot_period,
      snapshotLoadedAt: row.snapshot_loaded_at,
      checkedAt,
    };
  }

  return {
    status: 'verified',
    reason: 'ruc_found_active_habido',
    ruc: row.ruc,
    legalName: row.legal_name,
    taxpayerStatus: row.taxpayer_status,
    domicileCondition: row.domicile_condition,
    ubigeo: row.ubigeo,
    department: row.department,
    province: row.province,
    district: row.district,
    isActive: true,
    isHabido: true,
    snapshotPeriod: row.snapshot_period,
    snapshotLoadedAt: row.snapshot_loaded_at,
    checkedAt,
  };
}

// ── I/O functions ──────────────────────────────────────────────

function getAdminSupabase() {
  if (!supabaseServiceKey) {
    throw new Error('supabase_service_role_not_configured');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * Lookup a Peru company by RUC against the SUNAT snapshot in Supabase.
 * Returns snapshot_unavailable when Supabase is unreachable or not configured.
 * Returns not_found when RUC is valid but absent from the snapshot.
 */
export async function lookupPeruSunatByRuc(
  ruc: string,
): Promise<PeruSunatLegalLookupResult> {
  const normalizedRuc = normalizeRuc(ruc);

  if (!isValidRuc(normalizedRuc)) {
    return buildLegalLookupResult(ruc, null, { snapshotAvailable: true });
  }

  let admin;
  try {
    admin = getAdminSupabase();
  } catch {
    return buildLegalLookupResult(normalizedRuc, null, { snapshotAvailable: false });
  }

  try {
    const { data, error } = await admin
      .from(SNAPSHOT_TABLE)
      .select(
        'ruc, legal_name, taxpayer_status, domicile_condition, ubigeo, department, province, district, address, source_key, snapshot_period, snapshot_loaded_at, is_active, is_habido',
      )
      .eq('ruc', normalizedRuc)
      .maybeSingle();

    if (error) {
      return buildLegalLookupResult(normalizedRuc, null, { snapshotAvailable: false });
    }

    return buildLegalLookupResult(
      normalizedRuc,
      data as PeruSunatRucSnapshotRow | null,
      { snapshotAvailable: true },
    );
  } catch {
    return buildLegalLookupResult(normalizedRuc, null, { snapshotAvailable: false });
  }
}

/**
 * Validate the legal status of a Peru candidate by RUC.
 * Wraps lookupPeruSunatByRuc with the original input for audit trail.
 */
export async function validatePeruCandidateLegalStatus(
  input: PeruLegalValidationInput,
): Promise<PeruLegalValidationOutput> {
  const result = await lookupPeruSunatByRuc(input.ruc);
  return { input, result };
}
