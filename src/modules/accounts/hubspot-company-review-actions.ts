'use server';

// Agente 2A — Server action: resolver un match HubSpot pendiente (Task B5)
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Cablea `runResolveHubSpotCompanyMatch` (núcleo puro) sobre Supabase real vía la fábrica
// fail-closed `createSupabaseAdminClient` (nunca `createClient(process.env...)` inline). La
// decisión "different" delega en `createHubSpotCompanyForAccountWired` (Task B4, extendido
// aquí), que crea la empresa SIN volver a evaluar el match — el humano ya decidió.

import { requireActiveUserForEnrichment } from '@/modules/contact-enrichment/actions';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runResolveHubSpotCompanyMatch } from './hubspot-company-resolution-review-core';
import { createHubSpotCompanyForAccountWired } from './hubspot-company-resolution-wiring';

export async function resolveHubSpotCompanyMatchAction(input: {
  accountId: string;
  decision: 'same' | 'different';
}): Promise<{ ok: boolean }> {
  const { internalUserId } = await requireActiveUserForEnrichment();

  try {
    const admin = createSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    const result = await runResolveHubSpotCompanyMatch(input, {
      loadAccount: async (accountId) => {
        const { data, error } = await admin
          .from('accounts')
          .select('id, metadata')
          .eq('id', accountId)
          .maybeSingle();
        if (error) {
          console.error('[hubspot-company-review-actions] loadAccount query failed', { accountId, error });
          return null;
        }
        return data
          ? { id: data.id as string, metadata: (data.metadata as Record<string, unknown>) ?? {} }
          : null;
      },
      updateAccount: async (accountId, patch) => {
        const { error } = await admin.from('accounts').update(patch).eq('id', accountId);
        if (error) {
          console.error('[hubspot-company-review-actions] updateAccount failed', { accountId, error });
        }
      },
      createCompany: async (accountId) => createHubSpotCompanyForAccountWired(accountId),
      nowIso,
      loadWaitingContacts: async (accountId) => {
        const { data, error } = await admin
          .from('contacts')
          .select('id, metadata')
          .eq('account_id', accountId)
          .is('archived_at', null);
        if (error) {
          console.error('[hubspot-company-review-actions] loadWaitingContacts query failed', { accountId, error });
          return [];
        }
        return (data ?? [])
          .filter((row) => {
            const meta = (row.metadata as Record<string, unknown> | null) ?? {};
            // Debe coincidir EXACTAMENTE con la clave que escribe
            // `triggerContactHubSpotSync`/`markWaitingForCompanyReview` en
            // `hubspot-contact-approval-sync.ts` (Task E1) — es una señal propia, distinta de
            // `accounts.metadata.hubspot_sync_status` (misma palabra, otra tabla, otro
            // significado) y de `contacts.metadata.hubspot_sync.status` (vocabulario cerrado de
            // contact-hubspot-sync-state.ts, que no incluye este estado).
            return meta.hubspot_company_review_pending === true;
          })
          .map((row) => row.id as string);
      },
      syncContact: async (contactId) => {
        // Llama al MISMO punto de entrada que la aprobación (Task E1) — no reimplementa nada.
        // Se atribuye a QUIEN resolvió la revisión: es un UUID real de `internal_users` (viaja
        // hasta `contact_audit.actor_user_id`, que tiene FK a esa tabla), nunca un valor de
        // relleno.
        //
        // Import dinámico (no estático): `contact-enrichment/hubspot-contact-approval-sync.ts`
        // importa `resolveAccountHubSpotCompanyWired` de `@/modules/accounts/hubspot-company-
        // resolution-wiring` (verificado con
        // `grep -rn "from '@/modules/accounts" src/modules/contact-enrichment/*.ts`), así que un
        // `import` estático aquí cerraría un ciclo accounts -> contact-enrichment -> accounts a
        // nivel de módulo.
        const { triggerContactHubSpotSync } = await import(
          '@/modules/contact-enrichment/hubspot-contact-approval-sync'
        );
        await triggerContactHubSpotSync(contactId, internalUserId);
      },
    });

    return { ok: result.ok };
  } catch (error) {
    console.error('[hubspot-company-review-actions] resolveHubSpotCompanyMatchAction failed', {
      accountId: input.accountId,
      decision: input.decision,
      error,
    });
    return { ok: false };
  }
}
