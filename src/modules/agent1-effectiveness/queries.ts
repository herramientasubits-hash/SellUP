// Q3F-5AX.2 — Agent 1 Effectiveness read-only query layer (Phase 1).
//
// Server-only reads. Canonical run/batch source is `prospect_batches`; outcomes
// from `prospect_candidates`; cost from `provider_usage_logs`. Everything joins
// by batch_id. No writes, no upsert/insert/update/delete, no RPC, no provider
// calls. Mirrors the admin-client read pattern used by provider-effectiveness.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type {
  Agent1BatchRow,
  Agent1CandidateRow,
  Agent1EffectivenessEvidence,
  Agent1EffectivenessFilters,
  Agent1UsageRow,
} from './types';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

const MAX_ROWS = 20000;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function toNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNullableInteger(v: unknown): number | null {
  const n = toNullableNumber(v);
  return n == null ? null : Math.trunc(n);
}

// ── Batch metadata narrowing (best-effort, never throws) ──────────────────────

/**
 * Reads the best-effort "generated"/returned candidate count from batch
 * metadata. Uses pipeline_summary_post_write.returned_before_writer when
 * present (see candidate-writer.ts). Returns null if the batch does not expose
 * it — a NULL is treated as a partial-outcome signal, never invented.
 */
function readGeneratedCandidateCount(metadata: unknown): number | null {
  const meta = asRecord(metadata);
  if (!meta) return null;
  const pipeline = asRecord(meta.pipeline_summary_post_write);
  if (pipeline) {
    const returned = toNullableInteger(pipeline.returned_before_writer);
    if (returned != null) return returned;
  }
  return null;
}

/**
 * Resuelve el estado que el tablero usa para «lotes sin empresas nuevas».
 *
 * AGENT1-LOCAL-CUT8 · DECISIÓN A — `adaptive_discovery.result_status` ya no se
 * escribe: era un veredicto de objetivo derivado de FILAS y el objetivo lo
 * declara ahora `accepted_for_target`. La semántica del tablero NO cambia, así
 * que se resuelve desde donde sigue siendo verdad.
 *
 *   1. metadata HISTÓRICA — si la fila trae `result_status`, se respeta tal cual.
 *      Los lotes anteriores al corte no se reescriben y siguen agregando igual.
 *   2. metadata NUEVA — sin `result_status`, «sin empresas nuevas» es
 *      `persisted_count === 0`, que es un hecho de filas y siempre lo fue.
 *
 * 🔴 Con `persisted_count > 0` se devuelve `null` y NO un estado de éxito. El
 * tablero sólo consume `no_new_candidates`; inventar aquí `success_partial` o
 * `success_target_reached` sería reconstruir desde filas justo el veredicto que
 * la DECISIÓN A retira, y esta capa no tiene la aceptación para decidirlo.
 */
function readAdaptiveResultStatus(metadata: unknown): string | null {
  const meta = asRecord(metadata);
  if (!meta) return null;
  const adaptive = asRecord(meta.adaptive_discovery);
  if (!adaptive) return null;

  const status = adaptive.result_status;
  if (typeof status === 'string') return status;

  const persisted = adaptive.persisted_count;
  if (typeof persisted === 'number' && Number.isFinite(persisted)) {
    return persisted === 0 ? 'no_new_candidates' : null;
  }
  return null;
}

// ── Raw DB row shapes ─────────────────────────────────────────────────────────

interface RawBatchRow {
  id: string;
  status: string | null;
  country_code: string | null;
  industry: string | null;
  created_by: string | null;
  created_at: string | null;
  source: string | null;
  name: string | null;
  metadata: unknown;
}

interface RawCandidateRow {
  batch_id: string;
  status: string | null;
  duplicate_status: string | null;
  converted_account_id: string | null;
  // Q3F-5AY.4 — persisted classification columns (migration 093, all NULL today).
  record_origin: string | null;
  rejection_reason: string | null;
  classification_source: string | null;
  classification_confidence: number | string | null;
  // Raw signals for the runtime fallback classifier when persisted cols are NULL.
  source_primary: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  metadata: unknown;
}

interface RawUsageRow {
  batch_id: string | null;
  provider_key: string;
  operation_key: string;
  status: string | null;
  estimated_cost_usd: number | string | null;
  credits_used: number | string | null;
  results_returned: number | null;
}

// ── Fetch helpers (bounded, no N+1, read-only) ────────────────────────────────

async function fetchBatchRows(
  admin: ReturnType<typeof getAdminClient>,
  filters: Agent1EffectivenessFilters,
): Promise<RawBatchRow[]> {
  let query = admin
    .from('prospect_batches')
    .select('id, status, country_code, industry, created_by, created_at, source, name, metadata');

  if (filters.batchId) query = query.eq('id', filters.batchId);
  if (filters.createdBy) query = query.eq('created_by', filters.createdBy);
  if (filters.countryCode) query = query.eq('country_code', filters.countryCode);
  if (filters.industry) query = query.eq('industry', filters.industry);
  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
  if (filters.dateTo) query = query.lt('created_at', filters.dateTo);

  const { data, error } = await query.limit(MAX_ROWS);
  if (error) throw new Error(`agent1-effectiveness: failed to load prospect_batches: ${error.message}`);
  return (data ?? []) as RawBatchRow[];
}

async function fetchCandidateRows(
  admin: ReturnType<typeof getAdminClient>,
  batchIds: string[],
): Promise<RawCandidateRow[]> {
  if (batchIds.length === 0) return [];
  const { data, error } = await admin
    .from('prospect_candidates')
    .select(
      'batch_id, status, duplicate_status, converted_account_id, record_origin, rejection_reason, classification_source, classification_confidence, source_primary, review_notes, reviewed_by, metadata',
    )
    .in('batch_id', batchIds)
    .limit(MAX_ROWS);
  if (error) throw new Error(`agent1-effectiveness: failed to load prospect_candidates: ${error.message}`);
  return (data ?? []) as RawCandidateRow[];
}

async function fetchUsageRows(
  admin: ReturnType<typeof getAdminClient>,
  batchIds: string[],
  providerKey?: string,
): Promise<RawUsageRow[]> {
  if (batchIds.length === 0) return [];
  let query = admin
    .from('provider_usage_logs')
    .select('batch_id, provider_key, operation_key, status, estimated_cost_usd, credits_used, results_returned')
    .in('batch_id', batchIds);
  if (providerKey) query = query.eq('provider_key', providerKey);

  const { data, error } = await query.limit(MAX_ROWS);
  if (error) throw new Error(`agent1-effectiveness: failed to load provider_usage_logs: ${error.message}`);
  return (data ?? []) as RawUsageRow[];
}

// ── Main evidence loader ──────────────────────────────────────────────────────

/**
 * Loads the batch-scoped evidence for the read model. Batch filters apply to
 * prospect_batches; candidates and usage logs are scoped to the resolved batch
 * ids (conceptual join by batch_id). The provider filter narrows only the cost
 * rows. Read-only end to end.
 */
export async function fetchAgent1EffectivenessEvidence(
  filters: Agent1EffectivenessFilters = {},
): Promise<Agent1EffectivenessEvidence> {
  const admin = getAdminClient();

  const batchRows = await fetchBatchRows(admin, filters);
  const batchIds = batchRows.map((b) => b.id);

  const [candidateRows, usageRows] = await Promise.all([
    fetchCandidateRows(admin, batchIds),
    fetchUsageRows(admin, batchIds, filters.providerKey),
  ]);

  const batches: Agent1BatchRow[] = batchRows.map((b) => ({
    id: b.id,
    status: b.status,
    countryCode: b.country_code,
    industry: b.industry,
    createdBy: b.created_by,
    createdAt: b.created_at,
    generatedCandidateCount: readGeneratedCandidateCount(b.metadata),
    adaptiveResultStatus: readAdaptiveResultStatus(b.metadata),
    source: b.source,
    name: b.name,
    metadata: asRecord(b.metadata),
  }));

  const candidates: Agent1CandidateRow[] = candidateRows.map((c) => ({
    batchId: c.batch_id,
    status: c.status,
    duplicateStatus: c.duplicate_status,
    convertedAccountId: c.converted_account_id,
    recordOrigin: c.record_origin,
    rejectionReason: c.rejection_reason,
    classificationSource: c.classification_source,
    classificationConfidence: toNullableInteger(c.classification_confidence),
    sourcePrimary: c.source_primary,
    reviewNotes: c.review_notes,
    reviewedBy: c.reviewed_by,
    metadata: asRecord(c.metadata),
  }));

  const usageLogs: Agent1UsageRow[] = usageRows.map((u) => ({
    batchId: u.batch_id,
    providerKey: u.provider_key,
    operationKey: u.operation_key,
    status: u.status,
    estimatedCostUsd: toNullableNumber(u.estimated_cost_usd),
    creditsUsed: toNullableNumber(u.credits_used),
    resultsReturned: toNullableInteger(u.results_returned),
  }));

  return { batches, candidates, usageLogs };
}
