/**
 * EC SCVS — Enrichment Adapter — EC-SCVS-5
 *
 * Post-discovery enrichment adapter for Ecuador SCVS (Superintendencia de Compañías)
 * commercial registry. Operates EXCLUSIVELY from snapshot in source_company_snapshots.
 *
 * Contract usage:
 *   by RUC (latest year)  → probeLatestNativeSnapshotsByTaxId
 *
 * Identity model (NATIVE_RECORD_GRAIN):
 *   Physical row identity = expediente (not RUC).
 *   RUC is fiscal/commercial ID, not row identity.
 *   Multiple expedientes per RUC are legitimate.
 *   Multiplicity is surfaced as observable outcome, never silently collapsed.
 *
 * Guardrails:
 *   - Only country_code='EC' (enforced by gate)
 *   - Reads only source_company_snapshots (no external API)
 *   - No TAX_GRAIN helpers (NATIVE_RECORD_GRAIN)
 *   - Never arbitrary selection of ambiguous rows
 *   - Fail-soft: errors → status='error', never throw
 *
 * Only server-side. No use in Client Components.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { probeLatestNativeSnapshotsByTaxId } from '../../snapshot-read/snapshot-read-contract';
import type { SnapshotReadClient, SnapshotIdentityRow } from '../../snapshot-read/snapshot-read-contract';
import { normalizeEcuadorRuc } from './ec-ruc-normalizer';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../../enrichment/types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const SOURCE_KEY = 'ec_scvs' as const;
const COUNTRY_CODE = 'EC' as const;
const SUPPORTED_CAPABILITIES: SourceCapability[] = [
  'enrichment_after_discovery',
  'tax_id_validation',
  'commercial_signals',
  'prioritization',
];

const SNAPSHOT_SELECT_COLUMNS =
  'source_year, legal_name, normalized_tax_id, record_identity_key, raw_data';

// ─── Supabase admin client ────────────────────────────────────────────────────

function getAdminSupabase(): SupabaseClient | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(url, serviceKey);
}

// ─── Result builders ──────────────────────────────────────────────────────────

function buildMatchedResult(
  row: Record<string, unknown>,
): SourceEnrichmentOutput {
  return {
    sourceKey: SOURCE_KEY,
    status: 'matched',
    matchedBy: null,
    confidence: 1,
    sourceYear: typeof row['source_year'] === 'number' ? row['source_year'] : undefined,
    priorityBoost: 0,
    signals: {
      record_identity_key: row['record_identity_key'],
      expediente_found: true,
    },
  };
}

function buildAmbiguousResult(
  recordCount: number,
  recordIdentityKeys: readonly string[],
): SourceEnrichmentOutput {
  return {
    sourceKey: SOURCE_KEY,
    status: 'no_match',
    matchedBy: null,
    confidence: 0,
    priorityBoost: 0,
    reason: `ruc_multiplicity_detected: ${recordCount} expedientes`,
    signals: {
      ruc_multiplicity: 'multiple',
      record_count: recordCount,
      record_identity_keys: Array.from(recordIdentityKeys),
      human_review_required: true,
    },
  };
}

function buildNotFoundResult(): SourceEnrichmentOutput {
  return {
    sourceKey: SOURCE_KEY,
    status: 'no_match',
    matchedBy: null,
    confidence: 0,
    priorityBoost: 0,
    reason: 'no_snapshot_match_by_ruc',
  };
}

function buildSkippedResult(reason: string): SourceEnrichmentOutput {
  return {
    sourceKey: SOURCE_KEY,
    status: 'skipped',
    matchedBy: null,
    confidence: 0,
    priorityBoost: 0,
    reason,
  };
}

function buildErrorResult(reason: string): SourceEnrichmentOutput {
  return {
    sourceKey: SOURCE_KEY,
    status: 'error',
    matchedBy: null,
    confidence: 0,
    priorityBoost: 0,
    reason: reason.slice(0, 200),
  };
}

// ─── Main enrichment adapter ──────────────────────────────────────────────────

export const ecScvsEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: SOURCE_KEY,
  supportedCapabilities: SUPPORTED_CAPABILITIES,

  async enrichCandidate(input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> {
    const { countryCode, candidateTaxId } = input;

    // Guard: EC only
    if ((countryCode ?? '').toUpperCase() !== 'EC') {
      return buildSkippedResult('not_ec_country');
    }

    // Guard: RUC required
    if (!candidateTaxId || !candidateTaxId.trim()) {
      return buildSkippedResult('missing_ruc');
    }

    const rawRuc = candidateTaxId.trim();
    const rucResult = normalizeEcuadorRuc(rawRuc);

    // Guard: RUC must be valid format
    if (rucResult.status !== 'valid' || !rucResult.normalized) {
      return buildSkippedResult(`invalid_ruc_format: ${rucResult.status}`);
    }

    const normalizedRuc = rucResult.normalized;

    try {
      const supabase = getAdminSupabase();
      if (!supabase) {
        return buildErrorResult('snapshot_unavailable (SUPABASE_SERVICE_ROLE_KEY not configured)');
      }

      // Probe for RUC matches in latest year (NATIVE_RECORD_GRAIN).
      // Cast through `unknown` to the minimal contract surface — mirrors every
      // other snapshot reader (e.g. siis-enrichment-adapter). The direct cast
      // short-circuits the structural check between supabase-js's deeply generic
      // PostgrestQueryBuilder and SnapshotReadClient, which otherwise triggers
      // "Type instantiation is excessively deep and possibly infinite" (TS2589).
      const probeResult = await probeLatestNativeSnapshotsByTaxId({
        client: supabase as unknown as SnapshotReadClient<SnapshotIdentityRow>,
        sourceKey: SOURCE_KEY,
        countryCode: COUNTRY_CODE,
        normalizedTaxId: normalizedRuc,
        selectColumns: SNAPSHOT_SELECT_COLUMNS,
      });

      // Handle probe results
      if (probeResult.status === 'FOUND' && probeResult.row) {
        // Single match found
        return buildMatchedResult(probeResult.row);
      }

      if (probeResult.status === 'MULTI_RECORD_SAME_FISCAL_IDENTITY') {
        // Multiple expedientes for same RUC — surface as ambiguous (human review)
        return buildAmbiguousResult(
          probeResult.recordCount,
          probeResult.recordIdentityKeys ?? [],
        );
      }

      if (probeResult.status === 'RECORD_IDENTITY_NOT_FOUND') {
        // No snapshot records for this RUC
        return buildNotFoundResult();
      }

      if (probeResult.status === 'IDENTITY_UNAVAILABLE') {
        // RUC normalization failed or missing
        return buildSkippedResult('identity_unavailable');
      }

      // Unexpected status
      return buildErrorResult(`unexpected_probe_status: ${probeResult.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return buildErrorResult(msg);
    }
  },
};
