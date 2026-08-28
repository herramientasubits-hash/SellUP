// Cableado REAL de `runContactHubSpotApprovalSync`. Vive fuera de `actions.ts` (que sí es
// `'use server'`) para poder ser importado desde el barrido de la revisión de empresa
// (Task B6) sin que ese módulo tenga que pasar por una server action.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveAccountHubSpotCompanyWired } from '@/modules/accounts/hubspot-company-resolution-wiring';
import { runContactHubSpotAutoSync } from '@/modules/contacts/contact-hubspot-autosync-core';
import { runSyncContactToHubSpot } from '@/modules/contacts/contact-hubspot-sync-core';
import { buildContactHubSpotSyncDeps } from '@/modules/contacts/contact-hubspot-sync-runner';
import { runContactHubSpotApprovalSync } from './hubspot-contact-approval-sync-core';

/**
 * Punto de entrada ÚNICO para llevar un contacto ya aprobado a HubSpot. Lo usan:
 *   - el hook de aprobación (Task E2), con el `internalUserId` de quien aprobó;
 *   - el barrido tras resolver una revisión de empresa (Task B6), con el `internalUserId` de
 *     quien resolvió la revisión (`resolveHubSpotCompanyMatchAction` ya lo autentica).
 *
 * `actorId` es OBLIGATORIO y tiene que ser un UUID real de `internal_users`: viaja hasta
 * `contact_audit.actor_user_id`, que es `uuid` con FK a esa tabla — un valor de relleno como
 * `'system'` rompería esa escritura en cuanto se cablee. No hay valor por defecto a propósito:
 * un llamador nuevo que lo olvide rompe la compilación en vez de fallar en producción con una
 * violación de FK.
 */
export async function triggerContactHubSpotSync(
  contactId: string,
  actorId: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  await runContactHubSpotApprovalSync(contactId, {
    loadContactAccountId: async (id) => {
      const { data, error } = await admin.from('contacts').select('account_id').eq('id', id).maybeSingle();
      if (error) {
        console.error('[hubspot-contact-approval-sync] loadContactAccountId failed', { contactId: id, error });
        return null;
      }
      return (data?.account_id as string | null) ?? null;
    },
    resolveCompany: (accountId) => resolveAccountHubSpotCompanyWired(accountId, nowIso),
    syncContact: async (id) =>
      runContactHubSpotAutoSync(id, {
        // AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC: siempre activo, sin interruptor — decisión
        // explícita del usuario en el diseño.
        enabled: true,
        nowIso,
        loadSubject: async (subjectId) => {
          const { data, error } = await admin
            .from('contacts')
            .select('id, hubspot_contact_id, metadata')
            .eq('id', subjectId)
            .is('archived_at', null)
            .maybeSingle();
          if (error) {
            console.error('[hubspot-contact-approval-sync] loadSubject failed', { contactId: subjectId, error });
            return null;
          }
          if (!data) return null;
          return {
            id: data.id as string,
            hubspot_contact_id: (data.hubspot_contact_id as string | null) ?? null,
            metadata: (data.metadata as Record<string, unknown> | null) ?? {},
          };
        },
        runSync: async (subjectId) =>
          runSyncContactToHubSpot(
            subjectId,
            await buildContactHubSpotSyncDeps({
              actorId,
              nowIso,
              method: 'auto',
            }),
          ),
        persistAnnex: async (subjectId, metadata) => {
          const { error } = await admin.from('contacts').update({ metadata }).eq('id', subjectId);
          return { error: error?.message };
        },
      }),
    markWaitingForCompanyReview: async (id) => {
      const { data, error: readError } = await admin.from('contacts').select('metadata').eq('id', id).maybeSingle();
      if (readError) {
        console.error('[hubspot-contact-approval-sync] markWaitingForCompanyReview read failed', { contactId: id, error: readError });
        return;
      }
      const existing = (data?.metadata as Record<string, unknown> | null) ?? {};
      const { error: writeError } = await admin
        .from('contacts')
        .update({ metadata: { ...existing, hubspot_sync_status: 'waiting_company_review' } })
        .eq('id', id);
      if (writeError) {
        console.error('[hubspot-contact-approval-sync] markWaitingForCompanyReview write failed', { contactId: id, error: writeError });
      }
    },
  });
}
