'use server';

/**
 * Agente 1 · «Competidores de una empresa» — botón «Verificar tamaño» de una
 * competidora pequeña (1 crédito de Apollo, a demanda; decisión de la dueña 21-10).
 * Con 200 empleados o más vuelve a revisión por el MISMO camino que «Enviar a
 * revisión» (alcance comercial y «una empresa, un vendedor»).
 */

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { requireActiveUser, logProspectCandidateAudit } from '@/modules/prospect-batches/actions';
import { isBatchInScope } from '@/modules/prospect-discards/batch-in-scope.server';
import { sendCandidateToReviewCore } from '@/modules/prospect-discards/send-to-review-core';
import { claimGlobalIdentitiesForPersistedCandidates } from '@/server/prospect-batches/global-identity-claims-store';
import { isCompetitorSmallCompany } from './competitor-small-companies';
import {
  buildSizeVerificationMetadata,
  describeSizeVerification,
  readCompetitorSizeVerification,
} from './competitor-size-verification';

const requestSchema = z.object({ candidateId: z.string().uuid() }).strict();

export type VerifySizeResult = { ok: true; message: string; sentToReview: boolean } | { ok: false; message: string };

type CandidateRow = {
  id: string;
  batch_id: string;
  name: string;
  domain: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

export async function verifyCompetitorSizeAction(request: unknown): Promise<VerifySizeResult> {
  const { internalUserId } = await requireActiveUser();
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: 'Solicitud inválida.' };

  const supabase = await createClient();
  const { data } = await supabase
    .from('prospect_candidates')
    .select('id, batch_id, name, domain, status, metadata')
    .eq('id', parsed.data.candidateId)
    .maybeSingle();
  const candidate = data as CandidateRow | null;
  if (!candidate) return { ok: false, message: 'No encontramos esta empresa.' };
  if (!(await isBatchInScope(candidate.batch_id))) return { ok: false, message: 'Esta empresa está fuera de tu alcance.' };
  // Ya verificada: no se vuelve a pagar.
  const previous = readCompetitorSizeVerification(candidate.metadata);
  if (previous) return { ok: true, message: describeSizeVerification(previous.decision, previous.employees), sentToReview: false };
  if (candidate.status !== 'discarded' || !isCompetitorSmallCompany(candidate.metadata)) {
    return { ok: false, message: 'Sólo se verifica el tamaño de una competidora pequeña.' };
  }
  if (!candidate.domain) return { ok: false, message: 'Esta empresa no tiene sitio web: no se puede verificar su tamaño.' };

  const { lookupApolloEmployeeCount } = await import(
    '@/server/prospect-batches/competitor-search/competitor-size-verify.server'
  );
  const lookup = await lookupApolloEmployeeCount({
    domain: candidate.domain,
    name: candidate.name,
    batchId: candidate.batch_id,
    candidateId: candidate.id,
    usageKey: `competitor_size_verify:${candidate.id}:${randomUUID()}`,
    userId: internalUserId,
  });
  if (!lookup.ok) {
    return {
      ok: false,
      message:
        lookup.reason === 'apollo_disabled'
          ? 'Apollo no está activo en este momento.'
          : lookup.reason === 'apollo_quota_unavailable'
            ? 'Se agotó la cuota de Apollo de este mes.'
            : 'La fuente principal no respondió. Intenta de nuevo.',
    };
  }

  const { metadata, decision } = buildSizeVerificationMetadata(candidate.metadata, lookup.employees, new Date().toISOString());
  const { error: updateError } = await supabase
    .from('prospect_candidates')
    .update({ metadata, ...(lookup.employees ? { employee_count: lookup.employees } : {}) })
    .eq('id', candidate.id)
    .eq('status', 'discarded');
  if (updateError) return { ok: false, message: 'No se pudo guardar el tamaño. Intenta de nuevo.' };

  let sentToReview = false;
  if (decision === 'above') {
    const outcome = await sendCandidateToReviewCore(
      {
        supabase,
        actorUserId: internalUserId,
        isBatchInScope,
        claimGlobalIdentities: (batchId: string, candidateIds: string[]) =>
          claimGlobalIdentitiesForPersistedCandidates(createSupabaseAdminClient(), batchId, candidateIds),
      },
      candidate.id,
    );
    sentToReview = outcome.outcome === 'sent';
    if (outcome.outcome === 'sent') {
      await logProspectCandidateAudit({
        batchId: outcome.batchId,
        candidateId: outcome.candidateId,
        actorUserId: internalUserId,
        actionType: 'candidate_sent_to_review',
        details: { ...outcome.auditDetails, source: 'competitor_size_verification', employees: lookup.employees },
      }).catch(() => undefined);
    }
    if (outcome.outcome === 'claimed_by_other_seller') {
      return { ok: true, message: 'Se confirmó que es grande, pero otro vendedor ya la tiene.', sentToReview: false };
    }
  }
  revalidatePath(`/prospect-batches/${candidate.batch_id}`);
  return { ok: true, message: describeSizeVerification(decision, lookup.employees), sentToReview };
}
