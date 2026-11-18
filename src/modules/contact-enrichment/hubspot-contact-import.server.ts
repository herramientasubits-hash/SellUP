// Agente 2A — Cableado de «Traer» un contacto de HubSpot como candidato aprobado al instante
// (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE). La decisión vive en `hubspot-contact-import-core.ts`.
//
// La aprobación es la MISMA `approveContactCandidate` del botón «Aprobar» (con la sesión de quien
// trae el contacto): crea el contacto oficial con `metadata.source_candidate_id`, lo vincula a su
// contacto de HubSpot (`linkApprovedHubSpotCandidate`) y corre el autosync de siempre, que sólo
// completa propiedades VACÍAS en HubSpot. Desde la ficha ya se puede revelar lo que falte.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createOrLinkContactFromHubSpot } from '@/modules/contacts/actions';
import { approveContactCandidate } from './actions';
import type { ExistingContactForDedup } from './candidate-review-core';
import { readCandidateCompanyReassignment } from './candidate-company-reassignment-core';
import {
  runHubSpotContactImport,
  type HubSpotContactImportResult,
  type HubSpotContactToImport,
} from './hubspot-contact-import-core';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function importHubSpotContactAsApprovedCandidate(input: {
  accountId: string;
  triggeredBy: string;
  contact: HubSpotContactToImport;
}): Promise<HubSpotContactImportResult> {
  const admin = createSupabaseAdminClient();
  const { contact } = input;

  return runHubSpotContactImport(input, {
    async findPendingCandidateIds(accountId, hubspotContactId) {
      const { data, error } = await admin
        .from('contact_enrichment_candidates')
        .select('id, enrichment_metadata, run:contact_enrichment_runs ( account_id )')
        .eq('source', 'hubspot')
        .eq('status', 'pending_review')
        .eq('source_contact_id', hubspotContactId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => {
          // La empresa efectiva: la reasignada a mano, si la hay; si no, la de la búsqueda.
          const reassigned = readCandidateCompanyReassignment(row.enrichment_metadata);
          const runRaw = row.run;
          const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as { account_id?: unknown } | null;
          return (reassigned?.account_id ?? str(run?.account_id)) === accountId;
        })
        .map((row) => row.id as string);
    },

    async loadAccountContacts(accountId) {
      // La MISMA lectura que la deduplicación de la aprobación (migración 166: todos los contactos
      // vivos de la empresa, no sólo los que ve la sesión).
      const { data, error } = await admin
        .from('contacts')
        .select('id, email, linkedin_url, full_name')
        .eq('account_id', accountId)
        .is('archived_at', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as ExistingContactForDedup[];
    },

    async loadAccount(accountId) {
      const { data, error } = await admin
        .from('accounts')
        .select('id, name, domain, country_code, hubspot_company_id')
        .eq('id', accountId)
        .maybeSingle();
      if (error || !data) return null;
      const r = data as Record<string, unknown>;
      return {
        id: r.id as string,
        name: str(r.name) ?? 'Empresa',
        domain: str(r.domain),
        countryCode: str(r.country_code),
        hubspotCompanyId: str(r.hubspot_company_id),
      };
    },

    async createRun(row) {
      const { data, error } = await admin.from('contact_enrichment_runs').insert(row).select('id').single();
      if (error || !data) {
        console.error('[hubspot-contact-import] run insert failed:', error?.message);
        return null;
      }
      return data.id as string;
    },

    async insertCandidate(row) {
      const { data, error } = await admin.from('contact_enrichment_candidates').insert(row).select('id').single();
      if (error || !data) {
        console.error('[hubspot-contact-import] candidate insert failed:', error?.message);
        return null;
      }
      return data.id as string;
    },

    approveCandidate: (candidateId) => approveContactCandidate(candidateId),

    async discardHalfDone({ runId, candidateId }) {
      // Nunca se borra un candidato aprobado: su contacto apunta a él (`source_candidate_id`).
      if (candidateId) {
        await admin.from('contact_enrichment_candidates').delete().eq('id', candidateId).neq('status', 'approved');
      }
      if (runId) {
        const { count } = await admin
          .from('contact_enrichment_candidates')
          .select('id', { count: 'exact', head: true })
          .eq('enrichment_run_id', runId);
        if (count === 0) await admin.from('contact_enrichment_runs').delete().eq('id', runId);
      }
    },

    legacyCreateOrLink: () =>
      createOrLinkContactFromHubSpot({
        account_id: input.accountId,
        hubspot_contact_id: contact.hubspotContactId,
        first_name: contact.firstName,
        last_name: contact.lastName,
        full_name: contact.fullName,
        email: contact.email,
        linkedin_url: contact.linkedinUrl,
        job_title: contact.jobTitle,
      }),

    log: (event, detail) => console.error(`[hubspot-contact-import] ${event}`, detail),
  });
}
