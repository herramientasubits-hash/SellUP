// Agente 2A — Bulk Enrichment Runner
// Hito 17A.10C — Ejecución controlada por cuenta

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { ContactEnrichmentBulkStatus } from './bulk-enrichment-types';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface BulkRunAccountResult {
  accountId: string;
  runId: string | null;
  status: 'succeeded' | 'failed' | 'no_candidates';
  candidatesCreated: number;
  error?: string;
}

export interface ExecuteBulkRunResult {
  bulkRunId: string;
  status: ContactEnrichmentBulkStatus;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  totalCandidatesCreated: number;
  accountResults: BulkRunAccountResult[];
  summary: Record<string, unknown>;
}

// ── Dependencias inyectables ──────────────────────────────────────────────────

export interface BulkRunnerDeps {
  loadBulkRun: (id: string) => Promise<{
    id: string;
    status: string;
    eligible_account_ids: string[];
    triggered_by: string;
  } | null>;

  loadAccount: (id: string) => Promise<{
    id: string;
    name: string | null;
    domain: string | null;
    country_code: string | null;
    hubspot_company_id: string | null;
  } | null>;

  updateBulkRunStatus: (
    id: string,
    status: ContactEnrichmentBulkStatus,
    extra?: Record<string, unknown>,
  ) => Promise<void>;

  updateBulkRunCounters: (
    id: string,
    counters: {
      total_processed: number;
      total_succeeded: number;
      total_failed: number;
      total_candidates_created: number;
      status: ContactEnrichmentBulkStatus;
      completed_at: string;
      summary: Record<string, unknown>;
    },
  ) => Promise<void>;

  createIndividualRun: (input: {
    accountId: string;
    name: string;
    domain: string | null;
    countryCode: string;
    hubspotCompanyId: string | null;
    triggeredBy: string;
    bulkRunId: string;
  }) => Promise<{ runId: string }>;

  executeApolloRun: (runId: string, triggeredByUserId: string) => Promise<{
    status: 'ready_for_review' | 'completed' | 'skipped' | 'error';
    candidatesCreated?: number;
    error?: string;
  }>;

  /**
   * AGENT2-AUDIT-FIXES-1 — la búsqueda masiva por el MISMO camino que la individual (HubSpot
   * primero, banco, Apollo, sitio web, frenos a Lusha). `null` = la búsqueda automática está
   * apagada en este entorno y se usa el camino de siempre (sólo Apollo).
   */
  runAutomaticForAccount?: (input: {
    accountId: string;
    name: string;
    domain: string | null;
    countryCode: string;
    hubspotCompanyId: string | null;
    triggeredBy: string;
    bulkRunId: string;
  }) => Promise<{ runId: string | null; failed: boolean; candidatesCreated: number; error?: string } | null>;
}

// ── Implementación real de dependencias ───────────────────────────────────────

export function buildDefaultBulkRunnerDeps(): BulkRunnerDeps {
  const admin = getAdminClient();

  return {
    async loadBulkRun(id) {
      const { data, error } = await admin
        .from('contact_enrichment_bulk_runs')
        .select('id, status, eligible_account_ids, triggered_by')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`loadBulkRun: ${error.message}`);
      return data ?? null;
    },

    async loadAccount(id) {
      const { data, error } = await admin
        .from('accounts')
        .select('id, name, domain, country_code, hubspot_company_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`loadAccount: ${error.message}`);
      return data ?? null;
    },

    async updateBulkRunStatus(id, status, extra) {
      const { error } = await admin
        .from('contact_enrichment_bulk_runs')
        .update({ status, ...extra })
        .eq('id', id);
      if (error) throw new Error(`updateBulkRunStatus: ${error.message}`);
    },

    async updateBulkRunCounters(id, counters) {
      const { error } = await admin
        .from('contact_enrichment_bulk_runs')
        .update(counters)
        .eq('id', id);
      if (error) throw new Error(`updateBulkRunCounters: ${error.message}`);
    },

    async createIndividualRun({ accountId, name, domain, countryCode, hubspotCompanyId, triggeredBy, bulkRunId }) {
      const { startContactEnrichmentRun } = await import(
        '@/server/agents/contact-enrichment-toolkit/contact-enrichment-runner'
      );

      const result = await startContactEnrichmentRun({
        confirmedCompany: {
          source: 'sellup',
          name,
          domain: domain ?? undefined,
          countryCode,
          hubspotCompanyId: hubspotCompanyId ?? undefined,
          sellupAccountId: accountId,
          matchConfidence: 1,
        },
        originalInput: { sellupAccountId: accountId },
        triggeredBy,
        bulkRunId,
      });

      return { runId: result.runId };
    },

    async executeApolloRun(runId, triggeredByUserId) {
      const { executeContactEnrichmentApolloRun } = await import(
        '@/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner'
      );
      return executeContactEnrichmentApolloRun(runId, triggeredByUserId);
    },

    async runAutomaticForAccount({ accountId, name, domain, countryCode, hubspotCompanyId, triggeredBy, bulkRunId }) {
      const { getContactEnrichmentRoutingConfigV1 } = await import(
        '@/modules/contact-enrichment-routing/routing-config.server'
      );
      if (!getContactEnrichmentRoutingConfigV1().automaticRoutingEnabled) return null;

      const { createContactEnrichmentRequest } = await import(
        '@/server/agents/contact-enrichment-toolkit/contact-enrichment-request-creator'
      );
      const { runAutomaticContactEnrichmentForRequestCore } = await import('./automatic-routing-action-core');

      const created = await createContactEnrichmentRequest({
        accountId,
        companyName: name,
        companyDomain: domain,
        companyCountryCode: countryCode,
        hubspotCompanyId,
        companyResolutionSource: 'sellup',
        triggeredBy,
      });
      if (created.status !== 'created') {
        return { runId: null, failed: true, candidatesCreated: 0, error: `No se pudo preparar la búsqueda: ${created.reason}` };
      }

      const result = await runAutomaticContactEnrichmentForRequestCore(
        created.request.id,
        triggeredBy,
        new Date().toISOString(),
      );
      // Las corridas de la solicitud quedan ligadas a la búsqueda masiva, como en el camino viejo.
      await admin.from('contact_enrichment_runs').update({ bulk_run_id: bulkRunId }).eq('request_id', created.request.id);
      return summarizeAutomaticResult(result);
    },
  };
}

/** Cuántos candidatos dejó la búsqueda automática y si falló, para la tabla de la masiva. */
export function summarizeAutomaticResult(result: {
  success: boolean;
  status: string;
  blockedReason: string | null;
  attempt1AttemptId: string | null;
  providerCandidatesCreated: { apollo: number | null; lusha: number | null };
  failedProviders: string[];
  hubspotFirstCandidates?: number;
  contactBankCandidates?: number;
  companySiteCandidates?: number;
}): { runId: string | null; failed: boolean; candidatesCreated: number; error?: string } {
  const candidatesCreated =
    (result.providerCandidatesCreated.apollo ?? 0) +
    (result.providerCandidatesCreated.lusha ?? 0) +
    (result.hubspotFirstCandidates ?? 0) +
    (result.contactBankCandidates ?? 0) +
    (result.companySiteCandidates ?? 0);
  const failed =
    !result.success ||
    result.attempt1AttemptId === null ||
    (candidatesCreated === 0 && result.failedProviders.length > 0);
  return {
    runId: result.attempt1AttemptId,
    failed,
    candidatesCreated,
    ...(failed
      ? {
          error:
            result.failedProviders.length > 0
              ? `Falló ${result.failedProviders.join(' y ')} (${result.status})`
              : `La búsqueda no se pudo completar (${result.blockedReason ?? result.status})`,
        }
      : {}),
  };
}

// ── Runner puro (inyección de dependencias) ───────────────────────────────────

export async function executeBulkContactEnrichmentRun(
  input: { bulkRunId: string; triggeredByUserId: string },
  deps: BulkRunnerDeps = buildDefaultBulkRunnerDeps(),
): Promise<ExecuteBulkRunResult> {
  const { bulkRunId, triggeredByUserId } = input;

  // 1. Cargar bulk run
  const bulkRun = await deps.loadBulkRun(bulkRunId);
  if (!bulkRun) {
    throw new Error(`Bulk run no encontrado: ${bulkRunId}`);
  }

  if (bulkRun.status !== 'created') {
    throw new Error(
      `Bulk run no está en estado ejecutable (estado actual: ${bulkRun.status})`,
    );
  }

  const eligibleAccountIds: string[] = bulkRun.eligible_account_ids ?? [];

  if (eligibleAccountIds.length === 0) {
    await deps.updateBulkRunStatus(bulkRunId, 'failed', {
      summary: { error: 'Sin cuentas elegibles para ejecutar' },
      completed_at: new Date().toISOString(),
    });
    return {
      bulkRunId,
      status: 'failed',
      totalProcessed: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalCandidatesCreated: 0,
      accountResults: [],
      summary: { error: 'Sin cuentas elegibles para ejecutar' },
    };
  }

  // 2. Marcar como running
  await deps.updateBulkRunStatus(bulkRunId, 'running', {
    started_at: new Date().toISOString(),
  });

  // 3. Procesar cada cuenta secuencialmente
  const accountResults: BulkRunAccountResult[] = [];
  let totalCandidatesCreated = 0;

  for (const accountId of eligibleAccountIds) {
    let runId: string | null = null;

    try {
      const account = await deps.loadAccount(accountId);
      if (!account || !account.name || !account.country_code) {
        accountResults.push({
          accountId,
          runId: null,
          status: 'failed',
          candidatesCreated: 0,
          error: 'Cuenta no encontrada o datos insuficientes',
        });
        continue;
      }

      // 4a. Mismo camino que la búsqueda individual, si está encendida en este entorno.
      const automatic = deps.runAutomaticForAccount
        ? await deps.runAutomaticForAccount({
            accountId,
            name: account.name,
            domain: account.domain,
            countryCode: account.country_code,
            hubspotCompanyId: account.hubspot_company_id,
            triggeredBy: triggeredByUserId,
            bulkRunId,
          })
        : null;
      if (automatic) {
        runId = automatic.runId;
        totalCandidatesCreated += automatic.failed ? 0 : automatic.candidatesCreated;
        accountResults.push({
          accountId,
          runId,
          status: automatic.failed ? 'failed' : automatic.candidatesCreated > 0 ? 'succeeded' : 'no_candidates',
          candidatesCreated: automatic.failed ? 0 : automatic.candidatesCreated,
          ...(automatic.error ? { error: automatic.error } : {}),
        });
        continue;
      }

      // 4. Crear run individual con bulk_run_id
      const created = await deps.createIndividualRun({
        accountId,
        name: account.name,
        domain: account.domain,
        countryCode: account.country_code,
        hubspotCompanyId: account.hubspot_company_id,
        triggeredBy: triggeredByUserId,
        bulkRunId,
      });
      runId = created.runId;

      // 5. Ejecutar Apollo para ese run
      const apolloResult = await deps.executeApolloRun(runId, triggeredByUserId);

      const candidates = apolloResult.candidatesCreated ?? 0;
      totalCandidatesCreated += candidates;

      if (apolloResult.status === 'error') {
        accountResults.push({
          accountId,
          runId,
          status: 'failed',
          candidatesCreated: 0,
          error: apolloResult.error ? `Apollo retornó error: ${apolloResult.error}` : 'Apollo retornó error',
        });
      } else if (candidates === 0) {
        accountResults.push({
          accountId,
          runId,
          status: 'no_candidates',
          candidatesCreated: 0,
        });
      } else {
        accountResults.push({
          accountId,
          runId,
          status: 'succeeded',
          candidatesCreated: candidates,
        });
      }
    } catch (err) {
      accountResults.push({
        accountId,
        runId,
        status: 'failed',
        candidatesCreated: 0,
        error: err instanceof Error ? err.message : 'Error desconocido',
      });
    }
  }

  // 6. Calcular contadores finales
  const totalProcessed = accountResults.length;
  // succeeded + no_candidates cuentan como procesados sin error técnico
  const totalSucceeded = accountResults.filter(
    (r) => r.status === 'succeeded' || r.status === 'no_candidates',
  ).length;
  const totalFailed = accountResults.filter((r) => r.status === 'failed').length;
  const accountsWithoutCandidates = accountResults.filter(
    (r) => r.status === 'no_candidates',
  ).length;

  // 7. Determinar estado final
  let finalStatus: ContactEnrichmentBulkStatus;
  if (totalFailed === 0) {
    finalStatus = 'completed';
  } else if (totalSucceeded > 0) {
    finalStatus = 'completed_with_errors';
  } else {
    finalStatus = 'failed';
  }

  const summaryFinal: Record<string, unknown> = {
    total_processed: totalProcessed,
    total_candidates_created: totalCandidatesCreated,
    total_accounts_eligible: eligibleAccountIds.length,
    accounts_with_candidates: accountResults.filter((r) => r.status === 'succeeded').length,
    accounts_without_candidates: accountsWithoutCandidates,
    accounts_failed: totalFailed,
    account_details: accountResults.map((r) => ({
      account_id: r.accountId,
      run_id: r.runId,
      status: r.status,
      candidates_created: r.candidatesCreated,
      ...(r.error ? { error: r.error } : {}),
    })),
  };

  // 8. Persistir resultado final
  await deps.updateBulkRunCounters(bulkRunId, {
    total_processed: totalProcessed,
    total_succeeded: totalSucceeded,
    total_failed: totalFailed,
    total_candidates_created: totalCandidatesCreated,
    status: finalStatus,
    completed_at: new Date().toISOString(),
    summary: summaryFinal,
  });

  return {
    bulkRunId,
    status: finalStatus,
    totalProcessed,
    totalSucceeded,
    totalFailed,
    totalCandidatesCreated,
    accountResults,
    summary: summaryFinal,
  };
}
