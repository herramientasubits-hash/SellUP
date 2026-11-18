// Agente 2A — Lecturas y escritura del reveal de correo / LinkedIn desde la ficha del contacto
// OFICIAL (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE). La decisión vive en
// `official-contact-identity-completion-core.ts`.
//
// La escritura en `contacts` va por `updateContact` (el escritor oficial, con su auditoría y su
// control de acceso), igual que el LinkedIn de la búsqueda rápida (#903). Nunca lanza.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { updateContact } from '@/modules/contacts/actions';
import {
  planOfficialContactChannelFill,
  resolveDurableSourceCandidate,
  type OfficialContactForChannelReveal,
  type SourceCandidateForChannelReveal,
} from './official-contact-identity-completion-core';
import { resolveOfficialContactSourceCandidateId } from './post-approval-reveal-core';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function readOfficialContactForChannelReveal(contactId: string): Promise<OfficialContactForChannelReveal | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('contacts')
    .select('id, archived_at, email, linkedin_url, metadata')
    .eq('id', contactId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    archivedAt: str(r.archived_at),
    email: str(r.email),
    linkedinUrl: str(r.linkedin_url),
    metadata: r.metadata ?? null,
  };
}

export async function readSourceCandidateForChannelReveal(
  candidateId: string,
): Promise<SourceCandidateForChannelReveal | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('contact_enrichment_candidates')
    .select('id, status, source, source_contact_id, matched_contacts_id, apollo_person_id, email, linkedin_url, enrichment_metadata')
    .eq('id', candidateId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  const metadata = r.enrichment_metadata;
  return {
    id: r.id as string,
    status: str(r.status),
    source: str(r.source),
    sourceContactId: str(r.source_contact_id),
    matchedContactsId: str(r.matched_contacts_id),
    apolloPersonId: str(r.apollo_person_id),
    email: str(r.email),
    linkedinUrl: str(r.linkedin_url),
    enrichmentMetadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null,
  };
}

/** El contacto y su candidato de origen (o null si el contacto no tiene uno durable). */
export async function readContactWithSourceCandidate(contactId: string): Promise<{
  contact: OfficialContactForChannelReveal | null;
  candidate: SourceCandidateForChannelReveal | null;
}> {
  const contact = await readOfficialContactForChannelReveal(contactId);
  const link = contact ? resolveOfficialContactSourceCandidateId(contact.metadata) : null;
  const candidate = link?.kind === 'resolved' ? await readSourceCandidateForChannelReveal(link.candidateId) : null;
  return { contact, candidate };
}

/**
 * Lleva al contacto oficial el correo y el LinkedIn que su candidato de origen ya tiene, sólo a
 * los campos vacíos. Gratis (no llama a ningún proveedor) e idempotente. A HubSpot ya los llevó
 * el envío del candidato en cuanto se guardaron.
 */
export async function syncApprovedCandidateChannelsOntoContact(
  candidateId: string,
): Promise<{ updated: Array<'email' | 'linkedin_url'> }> {
  try {
    const candidate = await readSourceCandidateForChannelReveal(candidateId);
    const contactId = candidate?.matchedContactsId ?? null;
    if (!candidate || !contactId) return { updated: [] };
    const contact = await readOfficialContactForChannelReveal(contactId);
    if (!resolveDurableSourceCandidate(contact, candidate).ok || !contact) return { updated: [] };
    const patch = planOfficialContactChannelFill({ contact, candidate });
    const fields = Object.keys(patch) as Array<'email' | 'linkedin_url'>;
    if (fields.length === 0) return { updated: [] };
    const saved = await updateContact(contact.id, patch);
    return { updated: saved.success ? fields : [] };
  } catch (err) {
    console.error('[official-contact-identity-completion] sync failed', {
      candidateId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return { updated: [] };
  }
}
