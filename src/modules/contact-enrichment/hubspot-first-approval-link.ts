// AGENT2-HUBSPOT-FIRST-1 — Vincular al contacto aprobado con su registro de HubSpot
//
// Un candidato de «Primero HubSpot» ya ES un contacto de HubSpot. Al aprobarlo se crea el
// contacto de SellUp y, ANTES de la sincronización posterior a la aprobación, se le pone el
// `hubspot_contact_id` del candidato: así el sync reconoce el vínculo y no crea un contacto
// duplicado en HubSpot. Nunca pisa un vínculo existente ni lanza.

import type { SupabaseClient } from '@supabase/supabase-js';

export type HubSpotApprovalLinkOutcome = 'linked' | 'not_hubspot_candidate' | 'already_linked' | 'error';

export async function linkApprovedHubSpotCandidate(
  admin: SupabaseClient,
  candidateId: string,
  contactId: string,
): Promise<HubSpotApprovalLinkOutcome> {
  try {
    const { data: candidate, error } = await admin
      .from('contact_enrichment_candidates')
      .select('source, source_contact_id, matched_hubspot_contact_id')
      .eq('id', candidateId)
      .maybeSingle();
    if (error || !candidate) return 'error';
    if (candidate.source !== 'hubspot') return 'not_hubspot_candidate';

    const hubspotContactId = (candidate.matched_hubspot_contact_id ?? candidate.source_contact_id) as string | null;
    if (!hubspotContactId) return 'error';

    const { data: updated, error: updateError } = await admin
      .from('contacts')
      .update({ hubspot_contact_id: hubspotContactId })
      .eq('id', contactId)
      .is('hubspot_contact_id', null)
      .select('id');
    if (updateError) return 'error';
    return Array.isArray(updated) && updated.length === 1 ? 'linked' : 'already_linked';
  } catch (err) {
    console.error('[hubspot-first-approval-link] failed', { candidateId, contactId, error: err });
    return 'error';
  }
}
