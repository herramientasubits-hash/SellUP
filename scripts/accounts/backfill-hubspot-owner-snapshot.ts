/**
 * ACCOUNT-OWNER-HUBSPOT-NOTICE-1 — Guardar el dueño de HubSpot de las empresas que ya existen.
 *
 * Por cada empresa activa enlazada a HubSpot, lee (sólo lectura) quién es el dueño de la empresa
 * en HubSpot y lo guarda en `accounts.metadata.hubspot_owner`, para que la ficha avise cuando no
 * coincide con el responsable. NO cambia responsables, NO completa otros datos, NUNCA escribe en
 * HubSpot.
 *
 * Uso (simulación, por defecto — no escribe nada):
 *   node --env-file=.env.local --import tsx scripts/accounts/backfill-hubspot-owner-snapshot.ts
 * Escribir en SellUp (Producción) exige las dos banderas:
 *   ... --apply --confirm-hubspot-owner-snapshot [--report=/ruta/informe.json]
 */

import { writeFileSync } from 'node:fs';
import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { loadHubSpotAccountProfile } from '../../src/modules/accounts/hubspot-company-profile-sync.server';
import { buildHubSpotOwnerSnapshot, describeOwnerVsHubSpot } from '../../src/modules/accounts/account-owner-hubspot';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const CONFIRMED = args.has('--confirm-hubspot-owner-snapshot');
const reportArg = process.argv.find((a) => a.startsWith('--report='));
const REPORT_PATH = reportArg ? reportArg.slice('--report='.length) : null;

if (APPLY && !CONFIRMED) {
  console.error('confirmation_required: --apply exige --confirm-hubspot-owner-snapshot');
  process.exit(1);
}

interface Row {
  id: string;
  name: string;
  owner_id: string | null;
  hubspot_company_id: string;
  metadata: Record<string, unknown> | null;
}

async function main(): Promise<void> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('accounts')
    .select('id, name, owner_id, hubspot_company_id, metadata')
    .is('archived_at', null)
    .not('hubspot_company_id', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const totals: Record<string, number> = {};
  const bump = (k: string): void => {
    totals[k] = (totals[k] ?? 0) + 1;
  };
  const report: Array<Record<string, unknown>> = [];

  for (const row of (data ?? []) as Row[]) {
    const load = await loadHubSpotAccountProfile(admin, row.hubspot_company_id);
    if (load.status !== 'found') {
      bump(`hubspot:${load.status}`);
      report.push({ account_id: row.id, name: row.name, hubspot: load.status });
      continue;
    }
    const snapshot = buildHubSpotOwnerSnapshot({
      hubspotOwnerId: load.mapping.hubspotOwnerId,
      hubspotOwnerEmail: load.mapping.hubspotOwnerEmail,
      hubspotOwnerUserId: load.hubspotOwnerUserId,
      nowIso,
    });
    const metadata = { ...(row.metadata ?? {}), hubspot_owner: snapshot };
    const notice = describeOwnerVsHubSpot({ ownerId: row.owner_id, metadata });
    bump(notice ? `notice:${notice.kind}` : 'notice:none');
    report.push({ account_id: row.id, name: row.name, hubspot_owner: snapshot.email, notice: notice?.kind ?? null });

    if (APPLY) {
      // Sólo metadatos: el responsable no se toca.
      const { error: upErr } = await admin.from('accounts').update({ metadata }).eq('id', row.id);
      if (upErr) {
        bump('apply_errors');
        console.error('update failed', row.id, upErr.message);
      } else {
        bump('applied');
      }
    }
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry_run', accounts: data?.length ?? 0, totals }, null, 2));
  if (REPORT_PATH) {
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log('report:', REPORT_PATH);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
