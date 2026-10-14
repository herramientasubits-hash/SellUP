// Q3F-5AX.2 — Agent 1 Effectiveness read-only query layer (Phase 1).
//
// Server-only reads. Canonical run/batch source is `prospect_batches`; outcomes
// from `prospect_candidates`; cost from `provider_usage_logs`. Everything joins
// by batch_id. No writes, no upsert/insert/update/delete, no RPC, no provider
// calls. Mirrors the admin-client read pattern used by provider-effectiveness.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  fetchAllPages,
  fetchAllPagesInChunks,
  IN_FILTER_CHUNK_SIZE,
  type PaginatedReadResult,
} from '@/lib/supabase/paginated-read';
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

// ── Fetch helpers (paginados, sin N+1, sólo lectura) ─────────────────────────
//
// La API REST de Supabase devuelve como máximo 1.000 filas por petición: una
// sola petición con `.limit(20000)` dejaba fuera todo lo demás sin avisar. Cada
// lectura pagina con `.range()` (orden estable por id), parte las listas largas
// de ids en trozos para `.in()` y devuelve `truncated` si llega al tope de
// seguridad, en vez de cortar en silencio.

/** Superficie mínima del cliente que usan estas lecturas (inyectable en pruebas). */
type ReadQuery = {
  select(columns: string): ReadQuery;
  eq(column: string, value: unknown): ReadQuery;
  in(column: string, values: readonly unknown[]): ReadQuery;
  gte(column: string, value: string): ReadQuery;
  lt(column: string, value: string): ReadQuery;
  order(column: string, options?: { ascending?: boolean }): ReadQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};
export type Agent1ReadClient = { from(table: string): ReadQuery };

function orThrow<T>(table: string, read: PaginatedReadResult<unknown>): PaginatedReadResult<T> {
  if (read.error) throw new Error(`agent1-effectiveness: failed to load ${table}: ${read.error}`);
  return read as PaginatedReadResult<T>;
}

async function fetchBatchRows(
  admin: Agent1ReadClient,
  filters: Agent1EffectivenessFilters,
): Promise<PaginatedReadResult<RawBatchRow>> {
  const build = (createdByChunk: string[] | null) => (from: number, to: number) => {
    let query = admin
      .from('prospect_batches')
      .select('id, status, country_code, industry, created_by, created_at, source, name, metadata');

    if (filters.batchId) query = query.eq('id', filters.batchId);
    if (filters.createdBy) query = query.eq('created_by', filters.createdBy);
    if (createdByChunk) query = query.in('created_by', createdByChunk);
    if (filters.countryCode) query = query.eq('country_code', filters.countryCode);
    if (filters.industry) query = query.eq('industry', filters.industry);
    if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom);
    if (filters.dateTo) query = query.lt('created_at', filters.dateTo);

    return query.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to);
  };

  const read = filters.createdByIds
    ? await fetchAllPagesInChunks(filters.createdByIds, IN_FILTER_CHUNK_SIZE, build)
    : await fetchAllPages(build(null));
  return orThrow<RawBatchRow>('prospect_batches', read);
}

async function fetchCandidateRows(
  admin: Agent1ReadClient,
  batchIds: string[],
): Promise<PaginatedReadResult<RawCandidateRow>> {
  if (batchIds.length === 0) return { rows: [], truncated: false, error: null };
  const read = await fetchAllPagesInChunks(batchIds, IN_FILTER_CHUNK_SIZE, (chunk) => (from, to) =>
    admin
      .from('prospect_candidates')
      .select(
        'batch_id, status, duplicate_status, converted_account_id, record_origin, rejection_reason, classification_source, classification_confidence, source_primary, review_notes, reviewed_by, metadata',
      )
      .in('batch_id', chunk)
      .order('id', { ascending: true })
      .range(from, to),
  );
  return orThrow<RawCandidateRow>('prospect_candidates', read);
}

async function fetchUsageRows(
  admin: Agent1ReadClient,
  batchIds: string[],
  providerKey?: string,
): Promise<PaginatedReadResult<RawUsageRow>> {
  if (batchIds.length === 0) return { rows: [], truncated: false, error: null };
  const read = await fetchAllPagesInChunks(batchIds, IN_FILTER_CHUNK_SIZE, (chunk) => (from, to) => {
    let query = admin
      .from('provider_usage_logs')
      .select('batch_id, provider_key, operation_key, status, estimated_cost_usd, credits_used, results_returned')
      .in('batch_id', chunk);
    if (providerKey) query = query.eq('provider_key', providerKey);
    return query.order('id', { ascending: true }).range(from, to);
  });
  return orThrow<RawUsageRow>('provider_usage_logs', read);
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
  deps: { client?: Agent1ReadClient } = {},
): Promise<Agent1EffectivenessEvidence> {
  // Los filtros de persona / rol / grupo no dejan a nadie: no hay lotes.
  if (filters.createdByIds && filters.createdByIds.length === 0) {
    return { batches: [], candidates: [], usageLogs: [], readTruncated: false };
  }

  const admin = deps.client ?? (getAdminClient() as unknown as Agent1ReadClient);

  const batchRead = await fetchBatchRows(admin, filters);
  const batchRows = batchRead.rows;
  const batchIds = batchRows.map((b) => b.id);

  const [candidateRead, usageRead] = await Promise.all([
    fetchCandidateRows(admin, batchIds),
    fetchUsageRows(admin, batchIds, filters.providerKey),
  ]);
  const candidateRows = candidateRead.rows;
  const usageRows = usageRead.rows;

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

  return {
    batches,
    candidates,
    usageLogs,
    readTruncated: batchRead.truncated || candidateRead.truncated || usageRead.truncated,
  };
}
