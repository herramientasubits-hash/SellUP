/**
 * HUBSPOT-ACCOUNT-SYNC-1 — Completar las empresas que ya existen en SellUp.
 *
 * Por cada empresa activa:
 *   1. Pregunta al HubSpot REAL si su `hubspot_company_id` existe. Un 404 significa que el
 *      ID vino del sandbox con el que se trabajó antes.
 *   2. Si no existe (o no tenía ID), busca en el HubSpot real por dominio EXACTO: una sola
 *      coincidencia ⇒ se revincula; varias ⇒ a revisión; ninguna ⇒ «falta en HubSpot».
 *   3. Completa lo vacío con la ficha de HubSpot y pone responsable (dueño de HubSpot si es
 *      usuario de SellUp; si no, quien buscó la empresa).
 *   4. Con --official, intenta lo que siga vacío con las fuentes oficiales gratuitas.
 * Además informa cuántos prospectos por revisar apuntan a IDs del sandbox.
 *
 * NUNCA escribe en HubSpot. Las empresas «falta en HubSpot» sólo se listan.
 *
 * Uso (simulación, por defecto — no escribe nada):
 *   node --env-file=.env.local --import tsx scripts/accounts/backfill-hubspot-account-profiles.ts
 * Escribir en SellUp (Producción) exige las dos banderas:
 *   ... --apply --confirm-hubspot-account-backfill [--official]
 */

import { writeFileSync } from 'node:fs';
import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';
import {
  getHubSpotCompanyProfileById,
  searchHubSpotCompanyIdsByExactDomain,
} from '../../src/server/integrations/hubspot-company-search';
import {
  ACCOUNT_PROFILE_SNAPSHOT_SELECT,
  buildAccountProfileUpdate,
  loadHubSpotAccountProfile,
  type AccountProfileSnapshot,
} from '../../src/modules/accounts/hubspot-company-profile-sync.server';
import { decideHubSpotLink, pickBackfillSearcher, type CurrentHubSpotIdStatus } from '../../src/modules/accounts/hubspot-account-backfill-core';
import { normalizeAccountDomain } from '../../src/modules/contact-enrichment/hubspot-account-resolver';
import { enrichAccountWithOfficialSources } from '../../src/modules/accounts/account-official-enrichment.server';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const CONFIRMED = args.has('--confirm-hubspot-account-backfill');
const OFFICIAL = args.has('--official');
const reportArg = process.argv.find((a) => a.startsWith('--report='));
const REPORT_PATH = reportArg ? reportArg.slice('--report='.length) : null;

if (APPLY && !CONFIRMED) {
  console.error('confirmation_required: --apply exige --confirm-hubspot-account-backfill');
  process.exit(1);
}

type Row = AccountProfileSnapshot & {
  name: string;
  hubspot_company_id: string | null;
  created_by: string | null;
};

async function currentStatus(id: string | null): Promise<CurrentHubSpotIdStatus> {
  if (!id) return 'none';
  const r = await getHubSpotCompanyProfileById(id, ['name']);
  return r.status;
}

async function main(): Promise<void> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: accounts, error } = await admin
    .from('accounts')
    .select(`${ACCOUNT_PROFILE_SNAPSHOT_SELECT}, name, hubspot_company_id, created_by`)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const report: Array<Record<string, unknown>> = [];
  const totals: Record<string, number> = {};
  const bump = (k: string): void => {
    totals[k] = (totals[k] ?? 0) + 1;
  };

  for (const raw of (accounts ?? []) as unknown as Row[]) {
    const status = await currentStatus(raw.hubspot_company_id);
    const domainMatchIds =
      status === 'found' || status === 'unavailable' || !raw.domain
        ? null
        : await searchHubSpotCompanyIdsByExactDomain(normalizeAccountDomain(raw.domain) ?? raw.domain);
    const decision = decideHubSpotLink({
      currentHubspotCompanyId: raw.hubspot_company_id,
      currentStatus: domainMatchIds === null && status !== 'found' && raw.domain ? 'unavailable' : status,
      domainMatchIds,
    });
    bump(`link:${decision.action}`);

    // Quién buscó: corrida de contactos → lote del Agente 1 → creador.
    const runId = (raw.metadata?.source_contact_enrichment_run_id as string | undefined) ?? null;
    const { data: run } = runId
      ? await admin.from('contact_enrichment_runs').select('triggered_by').eq('id', runId).maybeSingle()
      : { data: null };
    const { data: cand } = await admin
      .from('prospect_candidates')
      .select('batch:prospect_batches!prospect_candidates_batch_id_fkey(created_by)')
      .eq('converted_account_id', raw.id)
      .limit(1)
      .maybeSingle();
    const batchRaw = (cand as { batch?: unknown } | null)?.batch;
    const batch = (Array.isArray(batchRaw) ? batchRaw[0] : batchRaw) as { created_by?: string | null } | undefined;
    const searcher = pickBackfillSearcher({
      contactSearchTriggeredBy: (run?.triggered_by as string | null | undefined) ?? null,
      agent1BatchCreatedBy: batch?.created_by ?? null,
      accountCreatedBy: raw.created_by,
    });

    const linkedId =
      decision.action === 'keep' || decision.action === 'relink' ? decision.hubspotCompanyId : null;
    const load = linkedId ? await loadHubSpotAccountProfile(admin, linkedId) : null;
    const profile = load?.status === 'found' ? load : null;
    const { patch, ownerSource } = buildAccountProfileUpdate(raw, profile, searcher);

    const relinkPatch =
      decision.action === 'relink' && decision.hubspotCompanyId !== raw.hubspot_company_id
        ? { hubspot_company_id: decision.hubspotCompanyId }
        : {};
    const columns = [...Object.keys(relinkPatch), ...Object.keys(patch)];
    if (columns.length > 0) bump('accounts_with_changes');

    report.push({
      account_id: raw.id,
      name: raw.name,
      domain: raw.domain,
      hubspot_id_before: raw.hubspot_company_id,
      hubspot_id_status: status,
      decision: decision.action,
      hubspot_id_after: linkedId,
      review_candidates: decision.action === 'review' ? decision.candidateIds : undefined,
      owner_source: ownerSource,
      columns,
    });

    if (APPLY && columns.length > 0) {
      const { error: upErr } = await admin
        .from('accounts')
        .update({
          ...relinkPatch,
          ...patch,
          metadata: {
            ...(raw.metadata ?? {}),
            ...(decision.action === 'relink' && decision.previousHubspotCompanyId
              ? { sandbox_hubspot_company_id: decision.previousHubspotCompanyId }
              : {}),
            hubspot_profile_sync: {
              synced_at: nowIso,
              source: 'backfill_hubspot_account_sync_1',
              hubspot_company_id: linkedId,
              link_decision: decision.action,
              filled_columns: columns,
              owner_source: ownerSource,
            },
          },
        })
        .eq('id', raw.id);
      if (upErr) {
        bump('apply_errors');
        console.error('update failed', raw.id, upErr.message);
      } else {
        bump('applied');
      }
    }
    if (APPLY && OFFICIAL) {
      const r = await enrichAccountWithOfficialSources(admin, { accountId: raw.id, actorUserId: null, nowIso });
      bump(`official:${r.status}`);
    }
  }

  // Prospectos por revisar que apuntan a una empresa de HubSpot: ¿cuántos son del sandbox?
  const { data: cands } = await admin
    .from('prospect_candidates')
    .select('id, matched_hubspot_company_id')
    .eq('status', 'needs_review')
    .not('matched_hubspot_company_id', 'is', null);
  for (const c of cands ?? []) {
    const s = await currentStatus(c.matched_hubspot_company_id as string);
    bump(`review_candidates_hubspot_id:${s}`);
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry_run', official: APPLY && OFFICIAL, totals }, null, 2));
  if (REPORT_PATH) {
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log('report:', REPORT_PATH);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
