// Agente 2A — Cableado REAL de `runApprovedCandidateRevealContactSync`
// (AGENT2A-APPROVED-REVEAL-CONTACT-SYNC).
//
// Lo llama `pushCandidatePhoneRevealToHubSpot` —el único punto por el que pasan los cuatro caminos
// que guardan un teléfono revelado (aviso de Apollo, pata Lusha, recuperación, caché)— ANTES del
// envío del candidato. Server-only: corre sin sesión (webhook, cron), así que todo va con service
// role, acotado al contacto que la propia aprobación del candidato escribió en `matched_contacts_id`
// (la 128 lo revalida bajo lock) y firmado por quien pidió el reveal. NUNCA lanza.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runContactHubSpotAutoPhoneUpdateWired } from '@/modules/contacts/contact-hubspot-sync-runner';
import {
  runApprovedCandidateRevealContactSync,
  type ApprovedRevealContactSyncReport,
} from './approved-candidate-reveal-contact-sync-core';
import { buildCandidateScalarFallback } from './official-contact-approval-core';
import { checkProjectApprovedCandidatePhonesCapability } from './post-approval-reveal-capability';
import { projectApprovedCandidatePhonesOntoContact } from './post-approval-reveal-projection';
import { readCandidateScalarFactsForProjection } from './post-approval-reveal-read';

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function syncApprovedCandidateRevealOntoContact(
  candidateId: string,
): Promise<ApprovedRevealContactSyncReport | null> {
  try {
    const admin = createSupabaseAdminClient();
    const report = await runApprovedCandidateRevealContactSync(candidateId, {
      loadCandidate: async (id) => {
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .select('id, status, matched_contacts_id, phone_revealed_by')
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error('candidate read failed');
        if (!data) return null;
        const r = data as Record<string, unknown>;
        return {
          id: r.id as string,
          status: str(r.status),
          matchedContactsId: str(r.matched_contacts_id),
          revealedBy: str(r.phone_revealed_by),
        };
      },
      checkProjectionCapability: checkProjectApprovedCandidatePhonesCapability,
      // EL MISMO armado que usa la ficha del contacto (post-approval-reveal-actions): escalar del
      // candidato + su procedencia, invertidos por el builder único de la aprobación.
      project: async ({ candidateId: id, contactId, actorId }) => {
        const facts = await readCandidateScalarFactsForProjection(id);
        const scalarFallback = facts
          ? buildCandidateScalarFallback({
              phone: facts.phone,
              phoneMetadata: facts.phoneMetadata,
              countryCode: facts.countryCode,
            })
          : null;
        return projectApprovedCandidatePhonesOntoContact({
          candidateId: id,
          contactId,
          scalarFallback: scalarFallback as Record<string, unknown> | null,
          actorId,
          nowIso: new Date().toISOString(),
        });
      },
      // LA segunda fase, el mismo entrypoint que la ficha, la edición y el merge. Sólo cambia el
      // cliente: aquí no hay sesión de usuario.
      runHubSpotPhoneSyncFollowUp: (contactId, actorId) =>
        runContactHubSpotAutoPhoneUpdateWired(contactId, {
          actorId,
          nowIso: new Date().toISOString(),
          client: admin,
        }),
    });
    if (report.outcome === 'projection_failed') {
      console.error('[approved-candidate-reveal-contact-sync] not projected', {
        candidateId,
        projectionStatus: report.projectionStatus,
      });
    }
    return report;
  } catch (err) {
    console.error('[approved-candidate-reveal-contact-sync] unexpected failure', {
      candidateId,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return null;
  }
}
