// Agente 2A — Cableado del arranque de la colección de un contacto «legacy» antes de proyectar el
// teléfono revelado después de aprobar (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE, Bryan 19-11).
//
// Server-only, con service role (también corre sin sesión: aviso de Apollo, pata Lusha, cron).
// Las decisiones viven en `legacy-contact-phone-bootstrap-core.ts`. La escritura de la colección
// es la RPC 169 (una transacción); aquí sólo se escribe `contacts.metadata.provider_phone`, que es
// lo que la ficha muestra como «Teléfono Apollo / Lusha». Si el número nuevo entró como secundario
// (la fase 2 no corre), se envía a HubSpot al primer campo vacío. Nunca registra números.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  BOOTSTRAP_LEGACY_CONTACT_PHONE_FN,
  parseBootstrapLegacyContactPhoneEnvelope,
  planProviderPhoneNotice,
  projectWithLegacyContactBootstrap,
  shouldPushProjectedPhonesToHubSpot,
} from './legacy-contact-phone-bootstrap-core';
import { pushContactPhonesToHubSpotEmptySlots } from './contact-projected-phones-hubspot-push.server';
import { readLegacyContactScalar, readNewestProviderPhone } from './contact-provider-phone-read';
import { projectApprovedCandidatePhonesOntoContact } from './post-approval-reveal-projection';
import type {
  ProjectApprovedCandidatePhonesOutcome,
  ProjectApprovedCandidatePhonesRequest,
} from './post-approval-reveal-core';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function writeProviderPhoneNotice(contactId: string, phonesInserted: number): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('contacts').select('phone, metadata').eq('id', contactId).maybeSingle();
  if (!data) return;
  const row = data as { phone?: unknown; metadata?: unknown };
  const metadata = isRecord(row.metadata) ? row.metadata : {};
  const block = planProviderPhoneNotice({
    phonesInserted,
    contactPhone: str(row.phone),
    current: metadata.provider_phone,
    newest: await readNewestProviderPhone(contactId),
  });
  if (!block) return;
  await admin.from('contacts').update({ metadata: { ...metadata, provider_phone: block } }).eq('id', contactId);
}

/**
 * LA proyección post-aprobación (128/131) con el arranque de la colección legacy (169) cuando hace
 * falta. Mismo contrato que `projectApprovedCandidatePhonesOntoContact`: LANZA si la proyección no
 * se completó.
 */
export async function projectApprovedCandidatePhonesWithLegacyBootstrap(
  request: ProjectApprovedCandidatePhonesRequest,
): Promise<ProjectApprovedCandidatePhonesOutcome> {
  const contactId = request.contactId;
  const result = await projectWithLegacyContactBootstrap(contactId, {
    project: () => projectApprovedCandidatePhonesOntoContact(request),
    readContactScalar: () => readLegacyContactScalar(contactId),
    bootstrap: async (params) => {
      const { data, error } = await createSupabaseAdminClient().rpc(BOOTSTRAP_LEGACY_CONTACT_PHONE_FN, params);
      // El mensaje del driver se descarta: PostgreSQL puede citar el número.
      if (error) return 'unparseable';
      return parseBootstrapLegacyContactPhoneEnvelope(data);
    },
    nowIso: () => new Date().toISOString(),
  });
  if (result.bootstrap && result.bootstrap !== 'bootstrapped' && result.bootstrap !== 'collection_present') {
    console.error('[legacy-contact-phone-bootstrap] not bootstrapped', { contactId, status: result.bootstrap });
  }
  if (result.outcome.status === 'projected' && result.outcome.phonesInserted > 0) {
    try {
      await writeProviderPhoneNotice(contactId, result.outcome.phonesInserted);
    } catch {
      // El número ya está en la colección; el aviso de la ficha es secundario.
    }
  }
  // La fase 2 sólo corre si cambió el saliente; si el número entró como secundario, se envía aquí.
  if (shouldPushProjectedPhonesToHubSpot(result.outcome)) {
    const pushed = await pushContactPhonesToHubSpotEmptySlots(contactId);
    if (pushed === 'failed' || pushed === 'unreadable') {
      console.error('[legacy-contact-phone-bootstrap] hubspot phone push', { contactId, outcome: pushed });
    }
  }
  return result.outcome;
}
