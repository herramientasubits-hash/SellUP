// Agente 2A — Lecturas y escritura del reveal de correo / LinkedIn desde la ficha del contacto
// OFICIAL (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE). La decisión vive en
// `official-contact-identity-completion-core.ts`.
//
// La escritura en `contacts` va por `updateContact` (el escritor oficial, con su auditoría y su
// control de acceso), igual que el LinkedIn de la búsqueda rápida (#903). Nunca lanza.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { updateContact } from '@/modules/contacts/actions';
import {
  buildOfficialContactSourceCandidateRow,
  buildOfficialContactSourceRunRow,
  planCandidateChannelFillFromContact,
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

// ── AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE (Bryan 18-11) ─────────────────────────────

/**
 * Lleva al candidato de origen el correo / LinkedIn que el CONTACTO tiene y el candidato no, para
 * buscar con ellos (sólo campos vacíos; nunca pisa). Devuelve el candidato releído.
 */
export async function fillSourceCandidateChannelsFromContact(
  contact: OfficialContactForChannelReveal,
  candidate: SourceCandidateForChannelReveal,
): Promise<SourceCandidateForChannelReveal> {
  const patch = planCandidateChannelFillFromContact({ contact, candidate });
  if (Object.keys(patch).length === 0) return candidate;
  const update: Record<string, unknown> = {};
  if (patch.email) update.email = patch.email.toLowerCase();
  if (patch.linkedin_url) update.linkedin_url = patch.linkedin_url;
  let query = createSupabaseAdminClient().from('contact_enrichment_candidates').update(update).eq('id', candidate.id);
  if (patch.email) query = query.is('email', null);
  if (patch.linkedin_url) query = query.is('linkedin_url', null);
  const { error } = await query;
  if (error) return candidate;
  return (await readSourceCandidateForChannelReveal(candidate.id)) ?? candidate;
}

/**
 * Un contacto SIN candidato de origen (creado a mano o traído antes de #904) recibe uno, ya
 * aprobado y apuntando a él, para que la ficha pueda revelar con el mismo pipeline. Corrida
 * interna oculta del historial. Idempotente: si mientras tanto otro clic ya le puso uno, se usa
 * ése y se borra el recién creado. Devuelve el id del candidato o null.
 */
export async function ensureOfficialContactSourceCandidate(contactId: string, actorId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contacts')
    .select(
      'id, account_id, first_name, last_name, full_name, email, linkedin_url, job_title, hubspot_contact_id, archived_at, metadata, account:account_id ( name, domain, country_code, hubspot_company_id )',
    )
    .eq('id', contactId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  if (str(r.archived_at)) return null;
  const metadata = r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {};
  const existing = resolveOfficialContactSourceCandidateId(metadata);
  if (existing.kind === 'resolved') return existing.candidateId;
  if (existing.kind === 'malformed') return null;

  const accountRaw = r.account;
  const account = (Array.isArray(accountRaw) ? accountRaw[0] : accountRaw) as Record<string, unknown> | null | undefined;
  const contact = {
    id: r.id as string,
    accountId: r.account_id as string,
    accountName: str(account?.name),
    accountDomain: str(account?.domain),
    accountCountryCode: str(account?.country_code),
    accountHubSpotCompanyId: str(account?.hubspot_company_id),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    fullName: str(r.full_name) ?? 'Contacto',
    email: str(r.email),
    linkedinUrl: str(r.linkedin_url),
    jobTitle: str(r.job_title),
    hubspotContactId: str(r.hubspot_contact_id),
  };
  const nowIso = new Date().toISOString();
  const { data: run, error: runError } = await admin
    .from('contact_enrichment_runs')
    .insert(buildOfficialContactSourceRunRow(contact, actorId))
    .select('id')
    .single();
  if (runError || !run) return null;
  const runId = run.id as string;
  const { data: candidate, error: candidateError } = await admin
    .from('contact_enrichment_candidates')
    .insert(buildOfficialContactSourceCandidateRow(contact, runId, actorId, nowIso))
    .select('id')
    .single();
  if (candidateError || !candidate) {
    await admin.from('contact_enrichment_runs').delete().eq('id', runId);
    return null;
  }
  const candidateId = candidate.id as string;

  // Sólo si sigue sin candidato (otro clic pudo ganar la carrera): se relee y se escribe.
  const { data: fresh } = await admin.from('contacts').select('metadata').eq('id', contactId).maybeSingle();
  const freshMetadata =
    fresh?.metadata && typeof fresh.metadata === 'object' && !Array.isArray(fresh.metadata)
      ? (fresh.metadata as Record<string, unknown>)
      : {};
  const raced = resolveOfficialContactSourceCandidateId(freshMetadata);
  if (raced.kind === 'resolved') {
    await admin.from('contact_enrichment_candidates').delete().eq('id', candidateId);
    await admin.from('contact_enrichment_runs').delete().eq('id', runId);
    return raced.candidateId;
  }
  const { error: linkError } = await admin
    .from('contacts')
    .update({ metadata: { ...freshMetadata, source_candidate_id: candidateId } })
    .eq('id', contactId);
  if (linkError) {
    await admin.from('contact_enrichment_candidates').delete().eq('id', candidateId);
    await admin.from('contact_enrichment_runs').delete().eq('id', runId);
    return null;
  }
  return candidateId;
}
