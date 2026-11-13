// ============================================================
// Auditoría de candidatas y búsquedas (servidor). Sin 'use server' a propósito:
// en `actions.ts` era una acción exportada que cualquier cliente podía invocar
// con un actor arbitrario y escribir filas de auditoría falsas.
// ============================================================

import { createClient } from '@/lib/supabase/server';
import type { CandidateAuditAction } from './types';

export async function logProspectCandidateAudit(params: {
  batchId: string;
  candidateId?: string;
  actorUserId?: string;
  actionType: CandidateAuditAction;
  details?: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('prospect_candidate_audit').insert({
    batch_id: params.batchId,
    candidate_id: params.candidateId ?? null,
    actor_user_id: params.actorUserId ?? null,
    action_type: params.actionType,
    details: params.details ?? {},
  });

  // Q3F-5BB.11K-FIX — observability only: the audit insert used to swallow its
  // error silently, so a failed audit row was indistinguishable from a written
  // one. We now SURFACE it in the server log (action type + safe error info,
  // never the details payload — it can carry candidate PII). Control flow is
  // deliberately unchanged: no throw, no retry, no transaction. Making the
  // status write + audit atomic is a separate hito.
  if (error) {
    console.error(
      '[prospect-batches] audit insert failed:',
      params.actionType,
      params.candidateId ?? null,
      error.message,
    );
  }
}
