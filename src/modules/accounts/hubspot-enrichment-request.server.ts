// HUBSPOT-ENRICHMENT-REQUEST-1 — «Enriquecer empresa de HubSpot» (cableado)
//
// Corre, en orden y esperando cada paso, las tres piezas que ya completan empresas:
//   1. Ficha de HubSpot (sólo lectura): lo vacío y el responsable (`syncAccountFromHubSpotProfile`).
//   2. País e industria (`completeAccountProfile`), con `writeHubSpot: false`.
//   3. Catálogos oficiales gratuitos: número fiscal, razón social y tamaño
//      (`enrichAccountWithOfficialSources`). Va después del país porque lo necesita.
// Luego deja constancia en `metadata.hubspot_enrichment_request` y devuelve el resumen.
//
// 0 escrituras en HubSpot: lo cubre `hubspot-enrichment-request-no-writes-static.test.ts`.
// Sin 'use server': sólo lo llama la acción de servidor, que ya validó sesión y alcance.

import type { SupabaseClient } from '@supabase/supabase-js';
import { assignmentUserName, loadActiveAssignmentUser } from '@/modules/assignment/assignment.server';
import { enrichAccountWithOfficialSources } from './account-official-enrichment.server';
import { completeAccountProfile } from './account-profile-completion.server';
import { syncAccountFromHubSpotProfile } from './hubspot-company-profile-sync.server';
import {
  ENRICHMENT_REQUEST_METADATA_KEY,
  isEnrichmentRequestInFlight,
  summarizeEnrichmentRequest,
  type EnrichmentRequestSummary,
  type EnrichmentSnapshot,
} from './hubspot-enrichment-request';

const SNAPSHOT_SELECT =
  'id, name, owner_id, hubspot_company_id, tax_identifier, legal_name, country, industry, company_size, metadata';

interface AccountRow extends EnrichmentSnapshot {
  id: string;
  name: string;
  hubspot_company_id: string | null;
  metadata: Record<string, unknown> | null;
}

export type HubSpotEnrichmentRequestResult =
  | { ok: true; accountId: string; accountName: string; summary: EnrichmentRequestSummary }
  | { ok: false; reason: 'account_unavailable' | 'not_linked' | 'in_progress'; message: string };

/** Los pasos, inyectables para probar el orden y los argumentos sin base ni proveedores. */
export interface HubSpotEnrichmentRequestDeps {
  syncFromHubSpot: typeof syncAccountFromHubSpotProfile;
  completeProfile: typeof completeAccountProfile;
  enrichOfficial: typeof enrichAccountWithOfficialSources;
  loadOwnerName: (admin: SupabaseClient, userId: string) => Promise<string | null>;
}

export const defaultHubSpotEnrichmentRequestDeps: HubSpotEnrichmentRequestDeps = {
  syncFromHubSpot: syncAccountFromHubSpotProfile,
  completeProfile: completeAccountProfile,
  enrichOfficial: enrichAccountWithOfficialSources,
  loadOwnerName: async (admin, userId) => {
    const user = await loadActiveAssignmentUser(admin, userId);
    return user ? assignmentUserName(user) : null;
  },
};

async function loadAccount(admin: SupabaseClient, accountId: string): Promise<AccountRow | null> {
  const { data, error } = await admin
    .from('accounts')
    .select(SNAPSHOT_SELECT)
    .eq('id', accountId)
    .is('archived_at', null)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as AccountRow;
}

function snapshotOf(row: AccountRow): EnrichmentSnapshot {
  return {
    owner_id: row.owner_id,
    tax_identifier: row.tax_identifier,
    legal_name: row.legal_name,
    country: row.country,
    industry: row.industry,
    company_size: row.company_size,
  };
}

async function writeRequestBlock(
  admin: SupabaseClient,
  accountId: string,
  block: Record<string, unknown>,
): Promise<void> {
  // Se relee `metadata`: los pasos anteriores la cambian y no hay que pisarlos.
  const { data } = await admin.from('accounts').select('metadata').eq('id', accountId).maybeSingle();
  const current = (data?.metadata as Record<string, unknown> | null | undefined) ?? {};
  const { error } = await admin
    .from('accounts')
    .update({ metadata: { ...current, [ENRICHMENT_REQUEST_METADATA_KEY]: block } })
    .eq('id', accountId);
  if (error) {
    console.error('[hubspot-enrichment-request] metadata write failed', { accountId, error: error.message });
  }
}

async function runStep(label: string, accountId: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (err) {
    // Un paso caído no frena los siguientes: el resumen final dice qué quedó sin completar.
    console.error(`[hubspot-enrichment-request] ${label} failed`, {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runHubSpotEnrichmentRequest(
  admin: SupabaseClient,
  input: { accountId: string; requesterId: string; now?: () => Date },
  deps: HubSpotEnrichmentRequestDeps = defaultHubSpotEnrichmentRequestDeps,
): Promise<HubSpotEnrichmentRequestResult> {
  const now = input.now ?? (() => new Date());
  const before = await loadAccount(admin, input.accountId);
  if (!before) {
    return { ok: false, reason: 'account_unavailable', message: 'No encontré esa empresa en SellUp.' };
  }
  if (!before.hubspot_company_id) {
    return {
      ok: false,
      reason: 'not_linked',
      message: 'Esta empresa no está vinculada a HubSpot. Tráela primero desde HubSpot.',
    };
  }
  const startedAt = now();
  if (isEnrichmentRequestInFlight(before.metadata, startedAt.getTime())) {
    return {
      ok: false,
      reason: 'in_progress',
      message: 'Ya estoy enriqueciendo esta empresa. Espera a que termine.',
    };
  }

  const startedIso = startedAt.toISOString();
  await writeRequestBlock(admin, input.accountId, {
    status: 'running',
    requested_by: input.requesterId,
    started_at: startedIso,
  });

  await runStep('hubspot profile sync', input.accountId, () =>
    deps.syncFromHubSpot(admin, {
      accountId: input.accountId,
      hubspotCompanyId: before.hubspot_company_id,
      searcherUserId: input.requesterId,
      actorUserId: input.requesterId,
      nowIso: startedIso,
    }),
  );
  await runStep('profile completion', input.accountId, () =>
    deps.completeProfile(admin, {
      accountId: input.accountId,
      actorUserId: input.requesterId,
      nowIso: now().toISOString(),
      writeHubSpot: false,
    }),
  );
  await runStep('official sources', input.accountId, () =>
    deps.enrichOfficial(admin, {
      accountId: input.accountId,
      actorUserId: input.requesterId,
      nowIso: now().toISOString(),
    }),
  );

  const after = (await loadAccount(admin, input.accountId)) ?? before;
  const ownerAfter = after.owner_id;
  const ownerName =
    ownerAfter && ownerAfter !== input.requesterId ? await deps.loadOwnerName(admin, ownerAfter) : null;
  const summary = summarizeEnrichmentRequest({
    before: snapshotOf(before),
    after: snapshotOf(after),
    requesterId: input.requesterId,
    ownerName,
  });

  await writeRequestBlock(admin, input.accountId, {
    status: summary.status,
    requested_by: input.requesterId,
    started_at: startedIso,
    completed_at: now().toISOString(),
    filled: summary.filled,
    still_missing: summary.stillMissing,
    ownership: summary.ownership,
  });

  if (summary.ownership === 'assigned_to_requester') {
    const { error } = await admin.from('account_audit').insert({
      account_id: input.accountId,
      actor_user_id: input.requesterId,
      action_type: 'account_owner_changed',
      details: { from: before.owner_id, to: input.requesterId, via: 'hubspot_enrichment_request' },
    });
    if (error) console.error('[hubspot-enrichment-request] audit insert failed:', error.message);
  }

  return { ok: true, accountId: after.id, accountName: after.name, summary };
}
