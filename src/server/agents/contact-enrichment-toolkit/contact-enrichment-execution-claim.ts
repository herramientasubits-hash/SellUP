// Agente 2A — Atomic Execution Claim (Hito 17B.4X.7C.2)
//
// Closes the load→check→update race in the provider runners: a single
// conditional UPDATE ... WHERE status = 'ready_to_enrich' ... RETURNING
// claims the attempt for execution. Two concurrent callers racing on the
// same attemptId can never both win — Postgres re-evaluates the WHERE
// clause under the row lock, so whichever UPDATE commits second sees the
// already-'enriching' row and matches zero rows.
//
// Callers MUST NOT call any provider (Apollo/Lusha), write any candidate,
// or log any usage unless this returns status: 'claimed'.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ContactEnrichmentRunStatus } from '@/modules/contact-enrichment/types';

export interface ClaimableRunRow {
  id: string;
  agent_run_id: string | null;
  account_id: string | null;
  company_name: string;
  company_domain: string | null;
  company_country_code: string | null;
  status: ContactEnrichmentRunStatus;
  summary: Record<string, unknown>;
}

const CLAIM_SELECT =
  'id, agent_run_id, account_id, company_name, company_domain, company_country_code, status, summary';

export type ClaimExecutionResult =
  | { status: 'claimed'; row: ClaimableRunRow }
  | { status: 'not_ready'; currentStatus: ContactEnrichmentRunStatus | null }
  | { status: 'not_found' }
  | { status: 'error'; reason: string };

function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

export interface ClaimExecutionDeps {
  /**
   * Single conditional UPDATE ... WHERE status = 'ready_to_enrich' ...
   * RETURNING. Returns the claimed row, or `row: null` when the WHERE
   * clause matched zero rows (already claimed, terminal, or never
   * existed). This is the atomic operation — it must remain one round
   * trip, never a separate load followed by a separate update.
   */
  claimRow?: (attemptId: string) => Promise<{ row: ClaimableRunRow | null; error?: string }>;
  /**
   * Read-only existence/status check used ONLY after a failed claim, to
   * distinguish not_found from not_ready for error reporting. Never
   * mutates and never participates in the race — the claim has already
   * concluded by the time this runs.
   */
  loadCurrentStatus?: (
    attemptId: string,
  ) => Promise<{ found: true; status: ContactEnrichmentRunStatus } | { found: false }>;
}

async function defaultClaimRow(
  attemptId: string,
): Promise<{ row: ClaimableRunRow | null; error?: string }> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_runs')
    .update({ status: 'enriching', updated_at: new Date().toISOString() })
    .eq('id', attemptId)
    .eq('status', 'ready_to_enrich')
    .select(CLAIM_SELECT)
    .maybeSingle();

  if (error) return { row: null, error: error.message };
  return { row: (data as ClaimableRunRow | null) ?? null };
}

async function defaultLoadCurrentStatus(
  attemptId: string,
): Promise<{ found: true; status: ContactEnrichmentRunStatus } | { found: false }> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('contact_enrichment_runs')
    .select('status')
    .eq('id', attemptId)
    .maybeSingle();
  if (!data) return { found: false };
  return { found: true, status: data.status as ContactEnrichmentRunStatus };
}

/**
 * Atomically claims a contact_enrichment_runs row for execution: moves it
 * from ready_to_enrich to enriching in a single conditional UPDATE. Used by
 * the Apollo and Lusha runners before any provider call — not_ready,
 * not_found, and error all short-circuit before any provider call, any
 * candidate write, and any usage log.
 */
export async function claimContactEnrichmentAttemptForExecution(
  attemptId: string,
  deps: ClaimExecutionDeps = {},
): Promise<ClaimExecutionResult> {
  const { claimRow = defaultClaimRow, loadCurrentStatus = defaultLoadCurrentStatus } = deps;

  if (!attemptId || typeof attemptId !== 'string' || !attemptId.trim()) {
    return { status: 'not_found' };
  }

  const result = await claimRow(attemptId);
  if (result.error) {
    return { status: 'error', reason: result.error };
  }
  if (result.row) {
    return { status: 'claimed', row: result.row };
  }

  // Zero rows affected by the conditional UPDATE — either the row never
  // existed, or it exists but wasn't ready_to_enrich (already claimed by a
  // concurrent caller, or in a terminal state). Read-only lookup, safe
  // because the claim attempt already concluded above.
  const existence = await loadCurrentStatus(attemptId);
  if (!existence.found) {
    return { status: 'not_found' };
  }
  return { status: 'not_ready', currentStatus: existence.status };
}
