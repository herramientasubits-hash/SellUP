// Agente 2A — Bulk Enrichment Eligibility
// Hito 17A.10B — Eligibility checker puro + helper DB (solo lectura)

import type {
  BulkEnrichmentEligibilityResult,
  BulkEnrichmentEligibleAccount,
  BulkEnrichmentSkippedAccount,
  BulkEnrichmentSkipReason,
} from './bulk-enrichment-types';

// ── Tipos de entrada para la función pura ────────────────────────────────────

export interface BulkEligibilityAccountInput {
  id: string;
  name: string | null;
  domain?: string | null;
  country_code?: string | null;
}

export interface BulkEligibilityInput {
  accounts: BulkEligibilityAccountInput[];
  activeRunsByAccountId: Map<string, Array<{ status: string }>>;
  pendingCandidateAccountIds: Set<string>;
}

// Statuses de runs que bloquean enriquecimiento
const IN_PROGRESS_STATUSES = new Set(['pending', 'resolving', 'ready_to_enrich', 'enriching']);
const READY_FOR_REVIEW_STATUS = 'ready_for_review';

// ── Función pura ─────────────────────────────────────────────────────────────

export function evaluateBulkContactEnrichmentEligibility(
  input: BulkEligibilityInput,
): BulkEnrichmentEligibilityResult {
  const eligible: BulkEnrichmentEligibleAccount[] = [];
  const skipped: BulkEnrichmentSkippedAccount[] = [];

  for (const account of input.accounts) {
    const skipReason = getSkipReason(account, input);
    if (skipReason !== null) {
      skipped.push({ accountId: account.id, name: account.name, reason: skipReason });
    } else {
      eligible.push({
        accountId: account.id,
        name: account.name!,
        domain: account.domain ?? null,
        countryCode: account.country_code!,
      });
    }
  }

  return {
    selectedCount: input.accounts.length,
    eligible,
    skipped,
    estimatedApolloCredits: eligible.length,
  };
}

function getSkipReason(
  account: BulkEligibilityAccountInput,
  input: BulkEligibilityInput,
): BulkEnrichmentSkipReason | null {
  // Prioridad 1: country_code ausente
  if (!account.country_code) return 'missing_country_code';

  // Prioridad 2: nombre insuficiente
  if (!account.name || account.name.trim().length < 2) return 'insufficient_company_data';

  const runs = input.activeRunsByAccountId.get(account.id) ?? [];

  // Prioridad 3: run activo en curso
  const hasActiveRun = runs.some((r) => IN_PROGRESS_STATUSES.has(r.status));
  if (hasActiveRun) return 'enrichment_in_progress';

  // Prioridad 4: ya hay run ready_for_review
  const hasReadyRun = runs.some((r) => r.status === READY_FOR_REVIEW_STATUS);
  if (hasReadyRun) return 'already_ready_for_review';

  // Prioridad 5: candidatos pending_review sin aprobar
  if (input.pendingCandidateAccountIds.has(account.id)) return 'pending_candidates_exist';

  return null;
}

// ── Helper DB (solo lectura) ─────────────────────────────────────────────────

import { createClient } from '@/lib/supabase/server';

export async function checkBulkContactEnrichmentEligibility(
  accountIds: string[],
): Promise<BulkEnrichmentEligibilityResult> {
  const uniqueIds = [...new Set(accountIds)];
  const supabase = await createClient();

  const [accountsResult, runsResult, candidatesResult] = await Promise.all([
    supabase
      .from('accounts')
      .select('id, name, domain, country_code')
      .in('id', uniqueIds),
    supabase
      .from('contact_enrichment_runs')
      .select('account_id, status')
      .in('account_id', uniqueIds)
      .in('status', [
        'pending',
        'resolving',
        'ready_to_enrich',
        'enriching',
        'ready_for_review',
      ]),
    supabase
      .from('contact_enrichment_candidates')
      .select('enrichment_run_id, contact_enrichment_runs!inner(account_id)')
      .eq('status', 'pending_review')
      .in('contact_enrichment_runs.account_id', uniqueIds),
  ]);

  // Construir mapa de runs activos por account_id
  const activeRunsByAccountId = new Map<string, Array<{ status: string }>>();
  for (const run of runsResult.data ?? []) {
    if (!run.account_id) continue;
    const existing = activeRunsByAccountId.get(run.account_id) ?? [];
    existing.push({ status: run.status });
    activeRunsByAccountId.set(run.account_id, existing);
  }

  // Construir set de cuentas con candidatos pending_review
  const pendingCandidateAccountIds = new Set<string>();
  for (const candidate of candidatesResult.data ?? []) {
    const run = (candidate.contact_enrichment_runs as unknown) as { account_id: string } | null;
    if (run?.account_id) pendingCandidateAccountIds.add(run.account_id);
  }

  const accounts: BulkEligibilityAccountInput[] = (accountsResult.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    domain: a.domain,
    country_code: a.country_code,
  }));

  return evaluateBulkContactEnrichmentEligibility({
    accounts,
    activeRunsByAccountId,
    pendingCandidateAccountIds,
  });
}
