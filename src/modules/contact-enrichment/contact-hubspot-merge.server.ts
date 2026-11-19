// Agente 2A — Cableado de la fusión en HubSpot ante el 409 del correo
// (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE, Bryan 19-11).
//
// Sin 'use server': ayudantes del servidor. Las decisiones viven en `contact-hubspot-merge-core.ts`;
// aquí se cablean Supabase y HubSpot. Nunca registra correos, teléfonos ni URLs de LinkedIn.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { loadContactPhonesForHubSpotMerge } from './contact-provider-phone-read';
import {
  fillEmptyHubSpotContactProperties,
  findHubSpotContactById,
  findHubSpotContactProfileByEmail,
  findHubSpotContactProfileById,
  getHubSpotContactSyncConnection,
  mergeHubSpotContacts,
  readHubSpotContactEmails,
  replaceHubSpotContactProperties,
  setHubSpotContactPrimaryCompany,
} from '@/server/integrations/hubspot-contact-sync';
import { findHubSpotOwnerByEmail, getHubSpotToken as getHubSpotCompanyToken } from '@/server/integrations/hubspot-company-create';
import { promoteHubSpotEmail, loadCompanyChangeContact } from './contact-company-change.server';
import { readContactWithSourceCandidate } from './official-contact-identity-completion.server';
import { EMAIL_CHECK_METADATA_KEY } from './email-change-classifier-core';
import {
  CONTACT_HUBSPOT_MERGE_HITO,
  HUBSPOT_MERGE_METADATA_KEY,
  classifyHubSpotMergeOffer,
  readPendingHubSpotEmailConflict,
  runHubSpotContactMerge,
  type HubSpotMergeOffer,
  type HubSpotMergeReport,
  type HubSpotProfileForMerge,
  type PendingHubSpotEmailConflict,
} from './contact-hubspot-merge-core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function canWriteHubSpotContacts(): Promise<boolean> {
  try {
    const connection = await getHubSpotContactSyncConnection();
    return connection.connected && connection.canWriteContacts;
  } catch {
    return false;
  }
}

export interface MergeContext {
  contactId: string;
  candidateId: string;
  conflict: PendingHubSpotEmailConflict | null;
  contact: {
    email: string | null;
    hubspotContactId: string | null;
    archivedAt: string | null;
    linkedinUrl: string | null;
    jobTitle: string | null;
    accountHubSpotCompanyId: string | null;
  };
}

/** El contacto, su candidato de origen (dueño del bloque `email_check`) y el 409 pendiente. */
export async function loadHubSpotMergeContext(contactId: string): Promise<MergeContext | null> {
  const { contact, candidate } = await readContactWithSourceCandidate(contactId);
  if (!contact || !candidate || candidate.matchedContactsId !== contact.id) return null;
  const full = await loadCompanyChangeContact(contactId);
  if (!full) return null;
  return {
    contactId,
    candidateId: candidate.id,
    conflict: readPendingHubSpotEmailConflict(candidate.enrichmentMetadata),
    contact: {
      email: full.email,
      hubspotContactId: full.hubspotContactId,
      archivedAt: full.archivedAt,
      linkedinUrl: full.linkedinUrl,
      jobTitle: full.jobTitle,
      accountHubSpotCompanyId: full.accountHubSpotCompanyId,
    },
  };
}

async function findProfileByEmail(email: string): Promise<HubSpotProfileForMerge | null> {
  const profile = await findHubSpotContactProfileByEmail(email); // LANZA sin conexión
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
    jobTitle: profile.jobTitle,
  };
}

/** Oferta para la ficha. Sólo consulta HubSpot si hay un 409 pendiente. Nunca lanza. */
export async function getHubSpotMergeOffer(contactId: string): Promise<HubSpotMergeOffer> {
  try {
    const context = await loadHubSpotMergeContext(contactId);
    if (!context?.conflict) return { status: 'none' };
    const pre = classifyHubSpotMergeOffer({ contact: context.contact, conflict: context.conflict, other: null });
    if (pre.status === 'none') return pre;
    let other: HubSpotProfileForMerge | null | 'error';
    try {
      other = await findProfileByEmail(context.conflict.foundEmail);
    } catch {
      other = 'error';
    }
    return classifyHubSpotMergeOffer({ contact: context.contact, conflict: context.conflict, other });
  } catch {
    return { status: 'none' };
  }
}

/**
 * Repunta SellUp al id resultante: el contacto (y cualquier otro contacto vinculado a alguno de los
 * dos ids) y los candidatos que apuntaban a ellos. Devuelve los OTROS contactos de SellUp tocados:
 * quedan anotados como pendiente de unificar (no se archivan ni se fusionan aquí).
 */
async function repointSellUp(contactId: string, fromIds: string[], toId: string): Promise<{ ok: true; otherContactIds: string[] } | { ok: false }> {
  const admin = createSupabaseAdminClient();
  const ids = fromIds.filter(Boolean);
  const { data, error } = await admin
    .from('contacts')
    .update({ hubspot_contact_id: toId })
    .in('hubspot_contact_id', ids)
    .select('id');
  if (error) return { ok: false };
  const touched = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (!touched.includes(contactId)) {
    const { error: own } = await admin.from('contacts').update({ hubspot_contact_id: toId }).eq('id', contactId);
    if (own) return { ok: false };
  }
  await admin.from('contact_enrichment_candidates').update({ matched_hubspot_contact_id: toId }).in('matched_hubspot_contact_id', ids);
  await admin
    .from('contact_enrichment_candidates')
    .update({ source_contact_id: toId })
    .eq('source', 'hubspot')
    .in('source_contact_id', ids);
  return { ok: true, otherContactIds: touched.filter((id) => id !== contactId) };
}

async function resolveOwnerIdForEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  const token = await getHubSpotCompanyToken();
  if (!token) return null;
  const owner = await findHubSpotOwnerByEmail(email, token);
  return owner?.id ? String(owner.id) : null;
}

/** Anota la fusión en el bloque `email_check` del candidato y en `contacts.metadata`. */
async function recordMerge(context: MergeContext, report: HubSpotMergeReport, actorId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const entry = {
    hito: CONTACT_HUBSPOT_MERGE_HITO,
    outcome: report.outcome,
    at: nowIso,
    by: actorId,
    primary_hubspot_contact_id: report.primaryHubSpotContactId,
    merged_from_hubspot_contact_id: report.mergedFromHubSpotContactId,
    merged_hubspot_contact_id: report.mergedHubSpotContactId,
    http_status: report.httpStatus,
    steps: report.steps,
    // Pendiente (Bryan 19-11): unificar en SellUp los contactos duplicados.
    other_sellup_contact_ids: report.otherSellupContactIds,
  };
  const succeeded = report.outcome === 'merged' || report.outcome === 'promoted_on_retry' || report.outcome === 'already_same';

  const { data: cand } = await admin
    .from('contact_enrichment_candidates')
    .select('enrichment_metadata')
    .eq('id', context.candidateId)
    .maybeSingle();
  const metadata = isRecord((cand as { enrichment_metadata?: unknown } | null)?.enrichment_metadata)
    ? ((cand as { enrichment_metadata: Record<string, unknown> }).enrichment_metadata)
    : {};
  const block = isRecord(metadata[EMAIL_CHECK_METADATA_KEY]) ? (metadata[EMAIL_CHECK_METADATA_KEY] as Record<string, unknown>) : null;
  if (block) {
    await admin
      .from('contact_enrichment_candidates')
      .update({
        enrichment_metadata: {
          ...metadata,
          [EMAIL_CHECK_METADATA_KEY]: {
            ...block,
            ...(succeeded ? { hubspot_outcome: report.outcome === 'merged' ? 'merged' : 'promoted' } : {}),
            [HUBSPOT_MERGE_METADATA_KEY]: entry,
          },
        },
      })
      .eq('id', context.candidateId);
  }

  if (report.outcome === 'merged') {
    const { data: row } = await admin.from('contacts').select('metadata').eq('id', context.contactId).maybeSingle();
    const contactMetadata = isRecord((row as { metadata?: unknown } | null)?.metadata)
      ? ((row as { metadata: Record<string, unknown> }).metadata)
      : {};
    const history = Array.isArray(contactMetadata.hubspot_merges) ? contactMetadata.hubspot_merges.filter(isRecord) : [];
    await admin
      .from('contacts')
      .update({ metadata: { ...contactMetadata, hubspot_merges: [...history, entry].slice(-10) } })
      .eq('id', context.contactId);
  }
}

/** Fusiona (ya confirmado por una persona). Nunca lanza. */
export async function runHubSpotMergeForContact(input: {
  contactId: string;
  actorId: string;
  actorEmail: string | null;
}): Promise<HubSpotMergeReport | null> {
  try {
    const context = await loadHubSpotMergeContext(input.contactId);
    if (!context) return null;
    if (!(await canWriteHubSpotContacts())) {
      return {
        outcome: 'hubspot_unavailable',
        primaryHubSpotContactId: null,
        mergedFromHubSpotContactId: context.contact.hubspotContactId,
        mergedHubSpotContactId: null,
        httpStatus: null,
        steps: {
          repoint: 'skipped',
          email: 'skipped',
          linkedin: 'skipped',
          jobTitle: 'skipped',
          owner: 'skipped',
          phones: 'skipped',
          company: 'skipped',
        },
        otherSellupContactIds: [],
      };
    }
    const report = await runHubSpotContactMerge(
      { conflict: context.conflict, contact: context.contact },
      {
        findByEmail: findProfileByEmail,
        promotePrimaryEmail: (id, email) => promoteHubSpotEmail(id, email),
        merge: mergeHubSpotContacts,
        repoint: ({ fromIds, toId }) => repointSellUp(input.contactId, fromIds, toId),
        readMerged: async (id) => {
          const [fill, profile] = await Promise.all([findHubSpotContactById(id), findHubSpotContactProfileById(id)]);
          if (!fill || !fill.properties) return null;
          return { properties: fill.properties, ownerId: profile?.ownerId ?? null };
        },
        readPrimaryEmail: async (id) => {
          const emails = await readHubSpotContactEmails(id);
          return emails ? emails.primary : undefined;
        },
        loadSellupPhones: () => loadContactPhonesForHubSpotMerge(input.contactId),
        resolveActorOwnerId: () => resolveOwnerIdForEmail(input.actorEmail),
        replaceProperties: (id, props) => replaceHubSpotContactProperties(id, props),
        fillPhones: (id, plan) => fillEmptyHubSpotContactProperties(id, plan),
        setPrimaryCompany: setHubSpotContactPrimaryCompany,
      },
    );
    if (report.outcome !== 'not_pending') await recordMerge(context, report, input.actorId);
    return report;
  } catch (err) {
    console.error('[contact-hubspot-merge] unexpected failure', {
      contactId: input.contactId,
      error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return null;
  }
}
