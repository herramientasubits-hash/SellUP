// Agente 2A — Aplicar lo que dijo «Verificar correo» en el contacto OFICIAL
// (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
// Sin 'use server': ayudantes del servidor. La clasificación (`email-change-classifier-core.ts`)
// ya decidió QUÉ es el correo; aquí se escribe:
//
//   * correo nuevo de la misma empresa → principal en SellUp (el anterior queda en
//     `metadata.previous_emails`) y en HubSpot (el anterior como correo adicional). Si el contacto no
//     está en HubSpot, el autosync de siempre lo busca por el correo, lo vincula o lo crea;
//   * correo personal → `metadata.personal_email` en SellUp y correo ADICIONAL en HubSpot.
//
// Las escrituras en `contacts` van por `updateContact` (el escritor oficial, con su control de
// acceso). Nunca registra correos.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getContactById, updateContact } from '@/modules/contacts/actions';
import { triggerContactHubSpotSync } from './hubspot-contact-approval-sync';
import { addHubSpotPersonalEmail, promoteHubSpotEmail } from './contact-company-change.server';
import {
  EMAIL_CHECK_METADATA_KEY,
  readEmailCheckBlock,
  type EmailCheckResolution,
} from './email-change-classifier-core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Correos anteriores del contacto (`metadata.previous_emails`), el más reciente al final. */
export function appendPreviousEmail(
  metadata: Record<string, unknown>,
  entry: { email: string; replaced_at: string; replaced_by: string },
): Record<string, unknown> {
  const list = Array.isArray(metadata.previous_emails) ? metadata.previous_emails.filter(isRecord) : [];
  const email = entry.email.trim().toLowerCase();
  const kept = list.filter((item) => typeof item.email === 'string' && item.email.trim().toLowerCase() !== email);
  return { ...metadata, previous_emails: [...kept, { ...entry, email, source: 'verify_email' }].slice(-10) };
}

/** Anota en la comprobación guardada del candidato cómo se resolvió (y qué pasó en HubSpot). */
export async function markEmailCheckResolution(
  candidateId: string,
  resolution: EmailCheckResolution,
  actorId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('contact_enrichment_candidates').select('enrichment_metadata').eq('id', candidateId).maybeSingle();
  const metadata = isRecord((data as { enrichment_metadata?: unknown } | null)?.enrichment_metadata)
    ? ((data as { enrichment_metadata: Record<string, unknown> }).enrichment_metadata)
    : {};
  const block = readEmailCheckBlock(metadata);
  if (!block) return;
  const raw = isRecord(metadata[EMAIL_CHECK_METADATA_KEY]) ? (metadata[EMAIL_CHECK_METADATA_KEY] as Record<string, unknown>) : {};
  await admin
    .from('contact_enrichment_candidates')
    .update({
      enrichment_metadata: {
        ...metadata,
        [EMAIL_CHECK_METADATA_KEY]: {
          ...raw,
          resolution,
          resolved_at: new Date().toISOString(),
          resolved_by: actorId,
          ...extra,
        },
      },
    })
    .eq('id', candidateId);
}

export interface EmailApplyReport {
  contactUpdated: boolean;
  /** Desenlace en HubSpot (sin valores). */
  hubspot: string;
}

/** Caso B — el correo nuevo de la misma empresa pasa a principal. */
export async function applySameCompanyNewEmail(input: {
  contactId: string;
  candidateId: string;
  newEmail: string;
  actorId: string;
}): Promise<EmailApplyReport> {
  const contact = await getContactById(input.contactId);
  if (!contact) return { contactUpdated: false, hubspot: 'not_attempted' };
  const newEmail = input.newEmail.trim().toLowerCase();
  const previous = contact.email?.trim().toLowerCase() ?? null;
  const nowIso = new Date().toISOString();
  const metadata = isRecord(contact.metadata) ? contact.metadata : {};
  const saved = await updateContact(input.contactId, {
    email: newEmail,
    metadata: previous && previous !== newEmail
      ? appendPreviousEmail(metadata, { email: previous, replaced_at: nowIso, replaced_by: input.actorId })
      : metadata,
  });
  if (!saved.success) return { contactUpdated: false, hubspot: 'not_attempted' };

  // El candidato de origen también: lo siguiente que se revele o verifique parte del correo actual.
  await createSupabaseAdminClient().from('contact_enrichment_candidates').update({ email: newEmail }).eq('id', input.candidateId);

  let hubspot: string;
  if (contact.hubspot_contact_id) {
    hubspot = await promoteHubSpotEmail(contact.hubspot_contact_id, newEmail);
  } else {
    // Sin vínculo: el motor de siempre busca por el correo nuevo, vincula o crea y asocia a la
    // empresa de la cuenta. Nunca lanza hacia aquí.
    try {
      await triggerContactHubSpotSync(input.contactId, input.actorId);
      hubspot = 'autosync';
    } catch {
      hubspot = 'autosync_failed';
    }
  }
  await markEmailCheckResolution(input.candidateId, 'applied', input.actorId, { hubspot_outcome: hubspot });
  return { contactUpdated: true, hubspot };
}

/** Caso C — correo personal: aparte en SellUp y como adicional en HubSpot (nunca principal). */
export async function applyPersonalEmail(input: {
  contactId: string;
  candidateId: string;
  email: string;
  provider: 'apollo' | 'lusha' | null;
  actorId: string;
}): Promise<EmailApplyReport> {
  const contact = await getContactById(input.contactId);
  if (!contact) return { contactUpdated: false, hubspot: 'not_attempted' };
  const email = input.email.trim().toLowerCase();
  const metadata = isRecord(contact.metadata) ? contact.metadata : {};
  const saved = await updateContact(input.contactId, {
    metadata: {
      ...metadata,
      personal_email: { email, found_at: new Date().toISOString(), provider: input.provider, found_by: input.actorId },
    },
  });
  if (!saved.success) return { contactUpdated: false, hubspot: 'not_attempted' };
  const hubspot = contact.hubspot_contact_id ? await addHubSpotPersonalEmail(contact.hubspot_contact_id, email) : 'not_in_hubspot';
  await markEmailCheckResolution(input.candidateId, 'applied', input.actorId, { hubspot_outcome: hubspot });
  return { contactUpdated: true, hubspot };
}
