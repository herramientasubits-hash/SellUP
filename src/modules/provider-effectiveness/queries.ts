// Agente 2A — Provider Effectiveness Read Model (Hito 17B.4X.6C)
//
// Server-only reads for the provider-effectiveness read model. Individual
// (non-bulk) cohort only. No candidate PII is selected (no email/phone/
// full_name) — see §19 of the 17B.4X.6C prompt. No writes, no provider
// calls.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { ProviderUsageStatus } from '@/modules/usage-tracking/types';
import type { ContactEnrichmentRunStatus } from '@/modules/contact-enrichment/types';
import type {
  ContactEnrichmentRunEvidence,
  OfficialContactTraceEvidence,
  ProviderEffectivenessFilters,
  ProviderUsageEvidence,
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

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

function toNullableNumber(v: unknown): number | null {
  return v != null ? Number(v) : null;
}

// ── Cost metadata narrowing (mirrors §11 real persisted shapes) ─────────

const LUSHA_TRUTH_SOURCES = new Set(['actual', 'estimated', 'unknown']);

function narrowLushaCostTruthSource(metadata: Record<string, unknown>): 'actual' | 'estimated' | 'unknown' | null {
  const cost = asRecord(metadata.cost);
  const truthSource = cost?.truth_source;
  if (typeof truthSource === 'string' && LUSHA_TRUTH_SOURCES.has(truthSource)) {
    return truthSource as 'actual' | 'estimated' | 'unknown';
  }
  return null;
}

function hasApolloPricingEvidence(metadata: Record<string, unknown>): boolean {
  return (
    typeof metadata.pricing_source === 'string' ||
    typeof metadata.pricing_basis === 'string' ||
    typeof metadata.unit_cost_usd === 'number'
  );
}

// ── Raw row shapes ────────────────────────────────────────────────────────

interface RawRunRow {
  id: string;
  status: ContactEnrichmentRunStatus;
  created_at: string;
  agent_run_id: string | null;
  providers_used: string[] | null;
  summary: unknown;
}

interface RawUsageRow {
  agent_run_id: string | null;
  provider_key: string;
  status: ProviderUsageStatus;
  estimated_cost_usd: number | string | null;
  credits_used: number | string | null;
  duration_ms: number | null;
  metadata: unknown;
}

interface RawCandidateRow {
  id: string;
  enrichment_run_id: string | null;
  status: string;
}

interface RawContactRow {
  id: string;
  metadata: unknown;
}

// ── Fetch helpers (bounded, no N+1) ───────────────────────────────────────

async function fetchUsageRowsByAgentRunId(
  admin: ReturnType<typeof getAdminClient>,
  agentRunIds: string[],
): Promise<RawUsageRow[]> {
  if (agentRunIds.length === 0) return [];
  const { data, error } = await admin
    .from('provider_usage_logs')
    .select('agent_run_id, provider_key, status, estimated_cost_usd, credits_used, duration_ms, metadata')
    .in('agent_run_id', agentRunIds)
    .limit(20000);
  if (error) throw new Error(`provider-effectiveness: failed to load provider_usage_logs: ${error.message}`);
  return (data ?? []) as RawUsageRow[];
}

async function fetchCandidateRowsByRunId(
  admin: ReturnType<typeof getAdminClient>,
  runIds: string[],
): Promise<RawCandidateRow[]> {
  if (runIds.length === 0) return [];
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select('id, enrichment_run_id, status')
    .in('enrichment_run_id', runIds)
    .limit(20000);
  if (error) throw new Error(`provider-effectiveness: failed to load contact_enrichment_candidates: ${error.message}`);
  return (data ?? []) as RawCandidateRow[];
}

/** Contacts traced from an enrichment candidate, scoped to the comparable provider cohort. */
async function fetchTraceContactRows(admin: ReturnType<typeof getAdminClient>): Promise<RawContactRow[]> {
  const { data, error } = await admin
    .from('contacts')
    .select('id, metadata')
    .in('source', ['apollo', 'lusha'])
    .limit(50000);
  if (error) throw new Error(`provider-effectiveness: failed to load contacts: ${error.message}`);
  return (data ?? []) as RawContactRow[];
}

// ── Main evidence loader ──────────────────────────────────────────────────

/**
 * Loads the full individual (non-bulk) contact-enrichment run cohort with
 * joined provider usage, candidate, and trace-validated official contact
 * evidence, normalized for aggregators.ts. Date filters apply to
 * contact_enrichment_runs.created_at only ([dateFrom, dateTo) half-open).
 */
export async function fetchContactEnrichmentRunEvidence(
  filters: Pick<ProviderEffectivenessFilters, 'dateFrom' | 'dateTo'> = {},
): Promise<ContactEnrichmentRunEvidence[]> {
  const admin = getAdminClient();

  let runQuery = admin
    .from('contact_enrichment_runs')
    .select('id, status, created_at, agent_run_id, providers_used, summary')
    .is('bulk_run_id', null);
  if (filters.dateFrom) runQuery = runQuery.gte('created_at', filters.dateFrom);
  if (filters.dateTo) runQuery = runQuery.lt('created_at', filters.dateTo);

  const { data: runData, error: runError } = await runQuery.limit(20000);
  if (runError) throw new Error(`provider-effectiveness: failed to load contact_enrichment_runs: ${runError.message}`);
  const runRows = (runData ?? []) as RawRunRow[];
  if (runRows.length === 0) return [];

  const runIds = runRows.map((r) => r.id);
  const agentRunIds = Array.from(
    new Set(runRows.map((r) => r.agent_run_id).filter((id): id is string => id !== null)),
  );

  const [usageRows, candidateRows, contactRows] = await Promise.all([
    fetchUsageRowsByAgentRunId(admin, agentRunIds),
    fetchCandidateRowsByRunId(admin, runIds),
    fetchTraceContactRows(admin),
  ]);

  const usageByAgentRunId = new Map<string, RawUsageRow[]>();
  for (const row of usageRows) {
    if (!row.agent_run_id) continue;
    const bucket = usageByAgentRunId.get(row.agent_run_id) ?? [];
    bucket.push(row);
    usageByAgentRunId.set(row.agent_run_id, bucket);
  }

  const candidatesByRunId = new Map<string, RawCandidateRow[]>();
  for (const row of candidateRows) {
    if (!row.enrichment_run_id) continue;
    const bucket = candidatesByRunId.get(row.enrichment_run_id) ?? [];
    bucket.push(row);
    candidatesByRunId.set(row.enrichment_run_id, bucket);
  }

  // Narrow every trace-shaped contact once, then pre-filter by claimed run id.
  // Whether the claim is actually VALID (candidate belongs to that run,
  // candidate_source matches the provider) is aggregators.ts's job — see
  // isTraceValidOfficialContact.
  const traceContactsByRunId = new Map<string, OfficialContactTraceEvidence[]>();
  for (const contact of contactRows) {
    const meta = asRecord(contact.metadata);
    if (!meta) continue;
    const evidence: OfficialContactTraceEvidence = {
      metaSource: typeof meta.source === 'string' ? meta.source : null,
      metaSourceEnrichmentRunId: typeof meta.source_enrichment_run_id === 'string' ? meta.source_enrichment_run_id : null,
      metaSourceCandidateId: typeof meta.source_candidate_id === 'string' ? meta.source_candidate_id : null,
      metaCandidateSource: typeof meta.candidate_source === 'string' ? meta.candidate_source : null,
    };
    if (!evidence.metaSourceEnrichmentRunId) continue;
    const bucket = traceContactsByRunId.get(evidence.metaSourceEnrichmentRunId) ?? [];
    bucket.push(evidence);
    traceContactsByRunId.set(evidence.metaSourceEnrichmentRunId, bucket);
  }

  return runRows.map((run): ContactEnrichmentRunEvidence => {
    const usage: ProviderUsageEvidence[] = (run.agent_run_id ? usageByAgentRunId.get(run.agent_run_id) : undefined)?.map(
      (row) => {
        const metadata = asRecord(row.metadata) ?? {};
        return {
          providerKey: row.provider_key,
          status: row.status,
          estimatedCostUsd: toNullableNumber(row.estimated_cost_usd),
          creditsUsed: toNullableNumber(row.credits_used),
          durationMs: row.duration_ms,
          costMetadata: {
            truthSource: narrowLushaCostTruthSource(metadata),
            hasApolloPricingEvidence: hasApolloPricingEvidence(metadata),
          },
        };
      },
    ) ?? [];

    const candidates = candidatesByRunId.get(run.id) ?? [];
    const reviewableCandidateCount = candidates.length;
    const pendingCandidateCount = candidates.filter((c) => c.status === 'pending_review').length;
    const approvedCandidateCount = candidates.filter((c) => c.status === 'approved').length;

    return {
      runId: run.id,
      status: run.status,
      createdAt: run.created_at,
      providersUsed: asStringArray(run.providers_used),
      summary: asRecord(run.summary),
      usage,
      reviewableCandidateCount,
      pendingCandidateCount,
      approvedCandidateCount,
      candidateIds: candidates.map((c) => c.id),
      traceContactCandidates: traceContactsByRunId.get(run.id) ?? [],
    };
  });
}
