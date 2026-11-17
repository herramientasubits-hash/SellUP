// Agente 2A — Cableado REAL de `quick-search-linkedin-attach-core.ts`
// (AGENT2A-LINKEDIN-SEARCH-ATTACH-EXISTING).
//
// Lo llama la búsqueda puntual por LinkedIn cuando el correo encontrado ya pertenece a un
// candidato «Por revisar» o a un contacto de SellUp que el usuario puede ver/tocar (la acción
// comprueba el alcance ANTES de llamar aquí). Service role, como el resto de la búsqueda.
//
// HubSpot sólo vía la regla de sólo-vacíos: el candidato usa el envío de lo revelado de siempre
// (`pushCandidateRevealToHubSpot`); el contacto, `fillHubSpotContactLinkedin` sobre
// `contacts.hubspot_contact_id`. NUNCA lanza.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { updateContact } from '@/modules/contacts/actions';
import {
  fillEmptyHubSpotContactProperties,
  findHubSpotContactById,
  getHubSpotContactSyncConnection,
} from '@/server/integrations/hubspot-contact-sync';
import { pushCandidateRevealToHubSpot } from './candidate-reveal-hubspot-push.server';
import {
  attachSearchedLinkedinToCandidate,
  attachSearchedLinkedinToContact,
  fillHubSpotContactLinkedin,
  type ContactLinkedinAttachReport,
  type LinkedinAttachOutcome,
} from './quick-search-linkedin-attach-core';

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Guarda el LinkedIn buscado en el candidato «Por revisar» y lo envía a HubSpot. */
export async function attachSearchedLinkedinToPendingCandidate(
  candidateId: string,
  linkedinUrl: string,
): Promise<LinkedinAttachOutcome> {
  try {
    const admin = createSupabaseAdminClient();
    return await attachSearchedLinkedinToCandidate(
      { candidateId, linkedinUrl },
      {
        nowIso: new Date().toISOString(),
        async loadCandidate(id) {
          const { data, error } = await admin
            .from('contact_enrichment_candidates')
            .select('id, status, linkedin_url, enrichment_metadata')
            .eq('id', id)
            .maybeSingle();
          if (error) throw new Error('candidate read failed');
          if (!data) return null;
          const r = data as Record<string, unknown>;
          return {
            id: r.id as string,
            status: str(r.status),
            linkedinUrl: str(r.linkedin_url),
            enrichmentMetadata: asRecord(r.enrichment_metadata),
          };
        },
        async writeCandidateLinkedin(id, input) {
          let query = admin
            .from('contact_enrichment_candidates')
            .update({ linkedin_url: input.linkedinUrl, enrichment_metadata: input.enrichmentMetadata })
            .eq('id', id)
            .eq('status', 'pending_review');
          query = input.expectedCurrent === null ? query.is('linkedin_url', null) : query.eq('linkedin_url', input.expectedCurrent);
          const { data, error } = await query.select('id');
          if (error) throw new Error('candidate write failed');
          return Array.isArray(data) && data.length > 0;
        },
        async pushToHubSpot(id) {
          await pushCandidateRevealToHubSpot(id, 'quick_search_linkedin');
        },
      },
    );
  } catch {
    return 'failed';
  }
}

/**
 * Guarda el LinkedIn buscado en el contacto de SellUp y lo envía a su contacto de HubSpot.
 *
 * La escritura va por `updateContact` (el escritor oficial de `contacts`, con su auditoría y su
 * control de acceso): este módulo sólo LEE la tabla `contacts`.
 */
export async function attachSearchedLinkedinToSellUpContact(
  contactId: string,
  linkedinUrl: string,
): Promise<ContactLinkedinAttachReport> {
  try {
    const admin = createSupabaseAdminClient();
    return await attachSearchedLinkedinToContact(
      { contactId, linkedinUrl },
      {
        async loadContact(id) {
          const { data, error } = await admin
            .from('contacts')
            .select('id, linkedin_url, hubspot_contact_id')
            .eq('id', id)
            .is('archived_at', null)
            .maybeSingle();
          if (error) throw new Error('contact read failed');
          if (!data) return null;
          const r = data as Record<string, unknown>;
          return {
            id: r.id as string,
            linkedinUrl: str(r.linkedin_url),
            hubspotContactId: str(r.hubspot_contact_id),
          };
        },
        async writeContactLinkedin(id, input) {
          // Relectura justo antes de escribir: si otro proceso cambió el LinkedIn, no se pisa.
          const { data, error } = await admin
            .from('contacts')
            .select('linkedin_url')
            .eq('id', id)
            .is('archived_at', null)
            .maybeSingle();
          if (error || !data) return false;
          if (str((data as Record<string, unknown>).linkedin_url) !== input.expectedCurrent) return false;
          const saved = await updateContact(id, { linkedin_url: input.linkedinUrl });
          return saved.success;
        },
        fillHubSpotLinkedin: (hubspotContactId, url) =>
          fillHubSpotContactLinkedin(hubspotContactId, url, {
            checkConnection: getHubSpotContactSyncConnection,
            findHubSpotContactById,
            fillEmptyHubSpotContactProperties,
          }),
      },
    );
  } catch {
    return { outcome: 'failed', hubspot: null };
  }
}
