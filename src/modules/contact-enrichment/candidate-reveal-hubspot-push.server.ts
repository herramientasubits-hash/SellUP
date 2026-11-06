// Agente 2A — Cableado REAL de `runCandidateRevealHubSpotPush` (AGENT2A-HUBSPOT-REVEAL-PUSH).
//
// Lo llaman, justo después de guardar el dato en el candidato, todos los caminos que revelan:
//   * «Revelar LinkedIn» / «Revelar correo» (candidate-identity-completion-actions.ts);
//   * el teléfono: aviso de Apollo (webhook), pata Lusha del waterfall, recuperación (cron) y
//     acierto de caché.
//
// Server-only: Supabase service role + adaptadores HubSpot de `hubspot-contact-sync.ts`. NUNCA
// lanza: el reveal ya está guardado y cobrado, HubSpot no puede convertirlo en un fallo.
//
// AGENT2A-APPROVED-REVEAL-CONTACT-SYNC — para el teléfono, el atajo de abajo hace DOS cosas, en
// este orden y nunca en paralelo:
//   1. si el candidato está aprobado, lleva el número a su contacto OFICIAL (proyección 128/131 +
//      segunda fase hacia HubSpot por `contacts.hubspot_contact_id`);
//   2. el envío del candidato de siempre (sólo vacíos).
// Las dos escrituras a HubSpot usan la MISMA regla de sólo-vacíos (`planRevealedPhonesForHubSpot`),
// y la segunda relee HubSpot después de la primera: lo que ya llegó no vuelve a viajar. No
// compiten; la segunda cubre lo que la primera no pudo (RPC no desplegada, contacto sin vínculo,
// LinkedIn/correo).

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  fillEmptyHubSpotContactEmail,
  fillEmptyHubSpotContactProperties,
  findHubSpotContactById,
  getHubSpotContactSyncConnection,
} from '@/server/integrations/hubspot-contact-sync';
import {
  CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY,
  runCandidateRevealHubSpotPush,
  type CandidateRevealPushCandidate,
  type CandidateRevealPushReport,
  type CandidateRevealPushTrigger,
} from './candidate-reveal-hubspot-push-core';
import type { RevealedPhoneForHubSpot } from '@/modules/contacts/contact-hubspot-sync-core';
import { syncApprovedCandidateRevealOntoContact } from './approved-candidate-reveal-contact-sync.server';

const CANDIDATE_SELECT =
  'id, status, source, source_contact_id, matched_hubspot_contact_id, matched_contacts_id, phone, linkedin_url, email, enrichment_metadata';

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function pushCandidateRevealToHubSpot(
  candidateId: string,
  trigger: CandidateRevealPushTrigger,
): Promise<CandidateRevealPushReport | null> {
  try {
    const admin = createSupabaseAdminClient();
    const report = await runCandidateRevealHubSpotPush(candidateId, trigger, {
      nowIso: new Date().toISOString(),
      loadCandidate: async (id): Promise<CandidateRevealPushCandidate | null> => {
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .select(CANDIDATE_SELECT)
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const r = data as Record<string, unknown>;
        const metadata = r.enrichment_metadata;
        return {
          id: r.id as string,
          status: str(r.status),
          source: str(r.source),
          sourceContactId: str(r.source_contact_id),
          matchedHubSpotContactId: str(r.matched_hubspot_contact_id),
          matchedContactsId: str(r.matched_contacts_id),
          phone: str(r.phone),
          linkedinUrl: str(r.linkedin_url),
          email: str(r.email),
          enrichmentMetadata:
            metadata && typeof metadata === 'object' && !Array.isArray(metadata)
              ? (metadata as Record<string, unknown>)
              : {},
        };
      },
      // AGENT2A-REVEAL-PHONE-SLOTS — el contacto de HubSpot del contacto OFICIAL (candidatos de
      // Apollo/Lusha aprobados: su vínculo con HubSpot lo escribió el autosync en `contacts`).
      loadOfficialContactHubSpotId: async (contactId) => {
        const { data, error } = await admin
          .from('contacts')
          .select('hubspot_contact_id')
          .eq('id', contactId)
          .is('archived_at', null)
          .maybeSingle();
        if (error) throw new Error('official contact read failed');
        return str((data as Record<string, unknown> | null)?.hubspot_contact_id);
      },
      // Los números VIVOS del candidato, el principal primero, sin los marcados como inválidos.
      loadRevealedPhones: async (id): Promise<RevealedPhoneForHubSpot[]> => {
        const { data, error } = await admin
          .from('contact_enrichment_candidate_phones')
          .select('display_phone, normalized_phone, phone_type, phone_status')
          .eq('candidate_id', id)
          .is('suppressed_at', null)
          .order('is_primary', { ascending: false })
          .order('first_seen_at', { ascending: true });
        if (error || !Array.isArray(data)) throw new Error('candidate phones read failed');
        const phones: RevealedPhoneForHubSpot[] = [];
        for (const row of data as Record<string, unknown>[]) {
          if (row.phone_status === 'invalid') continue;
          const value = str(row.display_phone)?.trim() || str(row.normalized_phone)?.trim() || null;
          if (value) phones.push({ phone: value, type: str(row.phone_type) });
        }
        return phones;
      },
      checkConnection: getHubSpotContactSyncConnection,
      findHubSpotContactById,
      fillEmptyHubSpotContactProperties,
      fillEmptyHubSpotContactEmail,
      persistTrace: async (id, enrichmentMetadata) => {
        // Relectura justo antes de escribir: otro camino (p. ej. el webhook) pudo tocar la
        // metadata entre la lectura del núcleo y este punto. Sólo se reemplaza el bloque propio.
        const { data } = await admin
          .from('contact_enrichment_candidates')
          .select('enrichment_metadata')
          .eq('id', id)
          .maybeSingle();
        const current = (data?.enrichment_metadata as Record<string, unknown> | null) ?? {};
        const { error } = await admin
          .from('contact_enrichment_candidates')
          .update({
            enrichment_metadata: {
              ...current,
              [CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY]:
                enrichmentMetadata[CANDIDATE_REVEAL_HUBSPOT_PUSH_METADATA_KEY],
            },
          })
          .eq('id', id);
        if (error) throw new Error(error.message);
      },
    });
    if (report.outcome === 'failed' || report.outcome === 'hubspot_contact_unreadable') {
      console.error('[candidate-reveal-hubspot-push] not delivered', {
        candidateId,
        trigger,
        outcome: report.outcome,
        error: report.error,
      });
    }
    return report;
  } catch (err) {
    console.error('[candidate-reveal-hubspot-push] unexpected failure', {
      candidateId,
      trigger,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return null;
  }
}

/**
 * Atajo para los `persist` del teléfono: sólo dispara si de verdad se guardó un número.
 *
 * Primero el contacto oficial (si el candidato está aprobado), después el envío del candidato.
 * Ninguno de los dos lanza.
 */
export async function pushCandidatePhoneRevealToHubSpot(
  candidateId: string,
  phone: string | null | undefined,
  trigger: CandidateRevealPushTrigger,
): Promise<void> {
  if (typeof phone !== 'string' || phone.trim().length === 0) return;
  await syncApprovedCandidateRevealOntoContact(candidateId);
  await pushCandidateRevealToHubSpot(candidateId, trigger);
}
