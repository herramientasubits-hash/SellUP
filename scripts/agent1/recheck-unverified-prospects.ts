/**
 * FEEDBACK 29-10 — Verificar de una vez los prospectos que quedaron «sin verificar».
 *
 * Corre la misma revisión de duplicados que el botón «Verificar ahora» (SellUp + HubSpot, de
 * sólo lectura en HubSpot) sobre cada prospecto en revisión con `duplicate_status` en
 * `unchecked` / `insufficient_data`, y guarda lo que encuentre. Si SellUp o HubSpot no
 * responden para uno, ese no se toca. NUNCA escribe en HubSpot, no aprueba ni descarta nada.
 *
 * Uso (simulación, por defecto — no escribe nada):
 *   node --env-file=.env.local --import tsx scripts/agent1/recheck-unverified-prospects.ts
 * Escribir en SellUp (Producción) exige las dos banderas:
 *   ... --apply --confirm-recheck-unverified-prospects [--report=/ruta/informe.json]
 */

import { writeFileSync } from 'node:fs';
import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { detectCandidateDuplicates } from '../../src/server/prospect-batches/duplicate-detection';
import { recheckCandidateDuplicates } from '../../src/server/prospect-batches/candidate-duplicate-recheck.server';
import { decideDuplicateRecheck } from '../../src/modules/prospect-batches/duplicate-recheck';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const CONFIRMED = args.has('--confirm-recheck-unverified-prospects');
const reportArg = process.argv.find((a) => a.startsWith('--report='));
const REPORT_PATH = reportArg ? reportArg.slice('--report='.length) : null;

if (APPLY && !CONFIRMED) {
  console.error('confirmation_required: --apply exige --confirm-recheck-unverified-prospects');
  process.exit(1);
}

interface Row {
  id: string;
  batch_id: string;
  name: string;
  website: string | null;
  domain: string | null;
  country_code: string | null;
  tax_identifier: string | null;
  normalized_name: string | null;
  duplicate_status: string;
}

async function main(): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('prospect_candidates')
    .select('id, batch_id, name, website, domain, country_code, tax_identifier, normalized_name, duplicate_status')
    .eq('status', 'needs_review')
    .eq('record_origin', 'production')
    .in('duplicate_status', ['unchecked', 'insufficient_data'])
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  console.log(`${rows.length} prospectos sin verificar · modo ${APPLY ? 'ESCRIBIR' : 'simulación'}`);
  const totals: Record<string, number> = {};
  const report: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    let status: string;
    let hubspotId: string | null = null;
    let accountId: string | null = null;
    if (APPLY) {
      const r = await recheckCandidateDuplicates(admin, row.id);
      status = r.ok ? r.outcome.duplicateStatus : `sin_cambio:${r.reason}`;
      if (r.ok) {
        hubspotId = r.outcome.matchedHubSpotCompanyId;
        accountId = r.outcome.matchedAccountId;
        const { error: auditError } = await admin.from('prospect_candidate_audit').insert({
          batch_id: row.batch_id,
          candidate_id: row.id,
          actor_user_id: null,
          action_type: 'candidate_updated',
          details: {
            action: 'duplicate_rechecked',
            source: 'backfill_recheck_unverified_2026_10_29',
            previous_duplicate_status: row.duplicate_status,
            new_duplicate_status: r.outcome.duplicateStatus,
            matched_account_id: accountId,
            matched_hubspot_company_id: hubspotId,
          },
        });
        if (auditError) console.error(`  auditoría falló para ${row.id}: ${auditError.message}`);
      }
    } else {
      const result = await detectCandidateDuplicates({
        supabase: admin,
        candidate: {
          id: row.id,
          name: row.name,
          website: row.website,
          domain: row.domain,
          country_code: row.country_code,
          tax_identifier: row.tax_identifier,
          normalized_name: row.normalized_name,
        },
        includeHubSpot: true,
      });
      const decision = decideDuplicateRecheck(result);
      status = decision.kind === 'write' ? decision.duplicateStatus : 'sin_cambio:unknown';
      if (decision.kind === 'write') {
        hubspotId = decision.matchedHubSpotCompanyId;
        accountId = decision.matchedAccountId;
      }
    }
    totals[status] = (totals[status] ?? 0) + 1;
    report.push({ id: row.id, name: row.name, before: row.duplicate_status, after: status, hubspot: hubspotId, account: accountId });
    console.log(`  ${row.name} → ${status}${hubspotId ? ` (HubSpot ${hubspotId})` : ''}${accountId ? ` (SellUp ${accountId})` : ''}`);
  }

  console.log('\nTotales:', totals);
  if (REPORT_PATH) writeFileSync(REPORT_PATH, JSON.stringify({ apply: APPLY, totals, report }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
