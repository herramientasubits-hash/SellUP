/**
 * Agente 1 · Rescate con Claude — dependencias reales (sólo servidor).
 *
 * Todo con el cliente ADMINISTRATIVO: el rescate corre en segundo plano y la
 * tabla de reclamos globales sólo admite `service_role` (igual que Lusha).
 *
 * Escrituras: sólo `prospect_candidates` (metadata, tamaño estimado y, si Claude
 * demuestra que no cumple, `status='discarded'`), `prospect_discarded_dispositions`
 * (evidencia o paso a revisión) y el reclamo de identidad. Nunca aprueba nada.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { sendDispositionToReviewCore } from '@/modules/prospect-discards/send-to-review-core';
import { claimGlobalIdentitiesForPersistedCandidates } from '@/server/prospect-batches/global-identity-claims-store';
import type { ClassifiableCandidateRow } from '../classification-metadata';
import {
  classifyCompanyLive,
  loadClassifierCatalog,
  resolveActiveAnthropicModel,
} from '../classify-batch-candidates.server';
import { CLAUDE_CLASSIFIER_PROVIDER_KEY } from '../types';
import type { RescueBatchDeps } from './rescue-batch';
import { RESCUABLE_DISPOSITION_REASON_CODES, type RescuableDispositionRow } from './rescue-dispositions';

/** Reintentos si otro proceso escribió la fila entre la lectura y la escritura. */
const WRITE_MAX_ATTEMPTS = 3;

async function patchCandidate(
  candidateId: string,
  buildPatch: Parameters<RescueBatchDeps['patchCandidate']>[1],
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  for (let attempt = 0; attempt < WRITE_MAX_ATTEMPTS; attempt++) {
    const current = await admin
      .from('prospect_candidates')
      .select('metadata, status, updated_at')
      .eq('id', candidateId)
      .maybeSingle();
    if (current.error || !current.data) return false;
    const row = current.data as { metadata: Record<string, unknown> | null; status: string; updated_at: string };
    if (row.status !== 'needs_review') return false;
    const patch = buildPatch(row.metadata);
    if (!patch) return false;

    const { data, error } = await admin
      .from('prospect_candidates')
      .update(patch)
      .eq('id', candidateId)
      .eq('status', 'needs_review')
      .eq('updated_at', row.updated_at)
      .select('id');
    if (error) {
      console.error('[claude-rescue] candidate write failed:', error.message);
      return false;
    }
    if (Array.isArray(data) && data.length === 1) return true;
  }
  return false;
}

async function patchDispositionEvidence(
  dispositionId: string,
  buildEvidence: Parameters<RescueBatchDeps['patchDispositionEvidence']>[1],
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  for (let attempt = 0; attempt < WRITE_MAX_ATTEMPTS; attempt++) {
    const current = await admin
      .from('prospect_discarded_dispositions')
      .select('evidence, status, updated_at')
      .eq('id', dispositionId)
      .maybeSingle();
    if (current.error || !current.data) return false;
    const row = current.data as { evidence: Record<string, unknown> | null; status: string; updated_at: string };
    if (row.status !== 'discarded') return false;
    const evidence = buildEvidence(row.evidence);
    if (!evidence) return false;

    const { data, error } = await admin
      .from('prospect_discarded_dispositions')
      .update({ evidence })
      .eq('id', dispositionId)
      .eq('status', 'discarded')
      .eq('updated_at', row.updated_at)
      .select('id');
    if (error) {
      console.error('[claude-rescue] disposition write failed:', error.message);
      return false;
    }
    if (Array.isArray(data) && data.length === 1) return true;
  }
  return false;
}

export function buildLiveRescueBatchDeps(triggeredBy: string | null): RescueBatchDeps {
  return {
    resolveActiveModel: resolveActiveAnthropicModel,
    checkQuota: () => checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY),
    loadCatalog: loadClassifierCatalog,
    loadReviewCandidates: async (batchId) => {
      const { data, error } = await createSupabaseAdminClient()
        .from('prospect_candidates')
        .select('id, industry_id, industry, name, website, domain, country_code, country, status, metadata')
        .eq('batch_id', batchId)
        .eq('status', 'needs_review');
      if (error) throw new Error(`candidates_read_failed:${error.message}`);
      return (data ?? []) as ClassifiableCandidateRow[];
    },
    loadDispositions: async (batchId) => {
      const { data, error } = await createSupabaseAdminClient()
        .from('prospect_discarded_dispositions')
        .select('id, batch_id, candidate_id, status, name, domain, country_code, industry, reason_code, evidence')
        .eq('batch_id', batchId)
        .eq('status', 'discarded')
        .in('reason_code', [...RESCUABLE_DISPOSITION_REASON_CODES]);
      if (error) throw new Error(`dispositions_read_failed:${error.message}`);
      return (data ?? []) as RescuableDispositionRow[];
    },
    classify: classifyCompanyLive,
    logUsage: logProviderUsage,
    patchCandidate,
    patchDispositionEvidence,
    admitDisposition: async (dispositionId, origin) => {
      const outcome = await sendDispositionToReviewCore(
        {
          supabase: createSupabaseAdminClient(),
          actorUserId: triggeredBy as string,
          // El lote es de quien corrió la búsqueda: el rescate no cruza de lote.
          isBatchInScope: async () => true,
        },
        dispositionId,
        origin,
      );
      if (outcome.outcome === 'sent' || outcome.outcome === 'idempotent') return outcome.candidateId;
      console.error('[claude-rescue] admit failed:', outcome.outcome);
      return null;
    },
    claimIdentities: async (batchId, candidateIds) => {
      const outcome = await claimGlobalIdentitiesForPersistedCandidates(
        createSupabaseAdminClient(),
        batchId,
        candidateIds,
      );
      if (outcome.degraded) console.error('[claude-rescue] identity claims degraded for batch', batchId);
    },
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}
