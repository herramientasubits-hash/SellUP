// Agente 2A — Lo que pasa DESPUÉS de «Buscar contactos» de una empresa (núcleo, DI).
//
// Bryan 29-10:
//  1. Un contacto de HubSpot que ya tiene correo, teléfono y LinkedIn no necesita revisión:
//     se aprueba solo y pasa directo a Contactos (con la MISMA aprobación que el botón
//     «Aprobar»: alcance, deduplicación, transacción y vínculo con su ficha de HubSpot).
//  2. El chat dice por separado cuántos quedan en «Por revisar» de búsquedas anteriores.
//
// Falla ABIERTO: si algo de esto no se puede leer o aprobar, la búsqueda ya terminó y se
// devuelve su resultado tal cual (los candidatos siguen en «Por revisar», como antes).

import type { RunAutomaticContactEnrichmentForRequestResult } from './automatic-routing-action-core';
import { isCompleteHubSpotCandidate } from './contact-search-summary';

/** Tope por búsqueda: cada aprobación sincroniza con HubSpot y la ruta tiene un tiempo máximo. */
export const MAX_HUBSPOT_AUTO_APPROVALS_PER_SEARCH = 25;

export interface FollowUpPendingCandidate {
  id: string;
  source: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  enrichment_run_id: string;
}

export interface ContactSearchFollowUpDeps {
  /** Corridas de la MISMA empresa que el usuario puede ver (sin las de esta búsqueda). */
  loadEarlierCompanyRunIds: (requestId: string, currentRunIds: readonly string[]) => Promise<string[]>;
  /** Candidatos `pending_review` de esas corridas. */
  loadPendingCandidates: (runIds: readonly string[]) => Promise<FollowUpPendingCandidate[]>;
  /** La aprobación normal de un candidato (la del botón «Aprobar»). */
  approveCandidate: (candidateId: string) => Promise<{ ok: boolean }>;
  maxAutoApprovals?: number;
}

export async function runContactSearchFollowUp(
  requestId: string,
  result: RunAutomaticContactEnrichmentForRequestResult,
  deps: ContactSearchFollowUpDeps,
): Promise<RunAutomaticContactEnrichmentForRequestResult> {
  if (!result.success || !result.automaticRoutingEnabled || !result.attempt1AttemptId) return result;

  const currentRunIds = [result.attempt1AttemptId, result.attempt2AttemptId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  const current = new Set(currentRunIds);

  let earlierRunIds: string[] = [];
  try {
    earlierRunIds = (await deps.loadEarlierCompanyRunIds(requestId, currentRunIds)).filter((id) => !current.has(id));
  } catch (err) {
    console.error('[contact-search-follow-up] earlier runs lookup failed', { requestId, error: err });
  }

  let pending: FollowUpPendingCandidate[];
  try {
    pending = await deps.loadPendingCandidates([...currentRunIds, ...earlierRunIds]);
  } catch (err) {
    console.error('[contact-search-follow-up] pending candidates lookup failed', { requestId, error: err });
    return result;
  }

  const max = deps.maxAutoApprovals ?? MAX_HUBSPOT_AUTO_APPROVALS_PER_SEARCH;
  // Primero los de esta búsqueda, después los que esperaban de antes.
  const complete = pending
    .filter((c) => isCompleteHubSpotCandidate(c))
    .sort((a, b) => Number(!current.has(a.enrichment_run_id)) - Number(!current.has(b.enrichment_run_id)))
    .slice(0, max);

  const approved = new Set<string>();
  let approvedNow = 0;
  let approvedEarlier = 0;
  for (const candidate of complete) {
    try {
      const outcome = await deps.approveCandidate(candidate.id);
      if (!outcome.ok) continue;
      approved.add(candidate.id);
      if (current.has(candidate.enrichment_run_id)) approvedNow += 1;
      else approvedEarlier += 1;
    } catch (err) {
      console.error('[contact-search-follow-up] auto-approval failed', { candidateId: candidate.id, error: err });
    }
  }

  const previousPending = pending.filter(
    (c) => !current.has(c.enrichment_run_id) && !approved.has(c.id),
  ).length;

  return {
    ...result,
    hubspotAutoApprovedContacts: approvedNow,
    hubspotAutoApprovedEarlierContacts: approvedEarlier,
    previousPendingReviewCandidates: previousPending,
  };
}
