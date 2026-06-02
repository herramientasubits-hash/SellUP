/**
 * Script diagnóstico de datos QA del bloque 16AK.
 * Solo lectura — no escribe ni modifica ningún dato.
 *
 * Uso:
 *   npx tsx scripts/diagnose-qa-data.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Faltan variables de entorno. Ejecuta con dotenv o .env.local cargado.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Rango de fechas QA ────────────────────────────────────────
const DATE_FROM = '2026-06-01T00:00:00Z';
const DATE_TO   = '2026-06-03T00:00:00Z'; // exclusivo

// ── Nombres conocidos de accounts QA ─────────────────────────
const KNOWN_QA_ACCOUNT_NAMES = [
  'PRONALTE LIMITADA',
  'PROYECTOS Y CONSTRUCCIONES PROYCON S.A.S.',
  'CORPORACION DE TELEVIDENTES DE LETICIA EN LIQUIDACION',
  'M Y M ASESORES INMOBILIARIOS SAS - EN LIQUIDACION',
  'MOLA DIGITAL SAS - EN LIQUIDACION',
  'ESCANHER ABOGADOS SAS',
];

const KNOWN_QA_HUBSPOT_ID = '55436508695';

async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  DIAGNÓSTICO QA — SellUp bloque 16AK');
  console.log('  Rango: ' + DATE_FROM + ' → ' + DATE_TO);
  console.log('══════════════════════════════════════════════════════\n');

  // ── A. prospect_batches QA ───────────────────────────────────
  console.log('▶ A. prospect_batches — candidatos QA\n');

  const { data: qaBatches, error: bErr } = await admin
    .from('prospect_batches')
    .select('id, name, source, status, country_code, industry, created_at, metadata')
    .gte('created_at', DATE_FROM)
    .lt('created_at', DATE_TO)
    .eq('country_code', 'CO')
    .order('created_at', { ascending: false });

  if (bErr) console.error('  Error batches:', bErr.message);

  const batchIds = (qaBatches ?? []).map(b => b.id);
  console.log(`  Total batches CO [${DATE_FROM} → ${DATE_TO}]: ${qaBatches?.length ?? 0}`);
  if (qaBatches?.length) {
    for (const b of qaBatches) {
      console.log(`  - [${b.id.slice(0,8)}] "${b.name}" | source=${b.source} | status=${b.status} | ${b.created_at}`);
    }
  }

  // ── B. prospect_candidates QA ────────────────────────────────
  console.log('\n▶ B. prospect_candidates — candidatos QA\n');

  let candidateIds: string[] = [];
  let qaCandidates: Record<string, unknown>[] = [];

  if (batchIds.length > 0) {
    const { data: byBatch, error: cByBErr } = await admin
      .from('prospect_candidates')
      .select('id, name, status, review_status, source_primary, country_code, created_at, batch_id, converted_account_id')
      .in('batch_id', batchIds)
      .order('created_at', { ascending: false });

    if (cByBErr) console.error('  Error candidates by batch:', cByBErr.message);
    qaCandidates = [...(byBatch ?? [])];
  }

  // También buscar por source + fecha directamente
  const { data: bySource, error: cSrcErr } = await admin
    .from('prospect_candidates')
    .select('id, name, status, review_status, source_primary, country_code, created_at, batch_id, converted_account_id')
    .eq('source_primary', 'socrata_colombia')
    .eq('country_code', 'CO')
    .gte('created_at', DATE_FROM)
    .lt('created_at', DATE_TO)
    .order('created_at', { ascending: false });

  if (cSrcErr) console.error('  Error candidates by source:', cSrcErr.message);

  // Merge dedupado
  const mergedCandidates = new Map<string, Record<string, unknown>>();
  for (const c of [...qaCandidates, ...(bySource ?? [])]) {
    mergedCandidates.set(c.id as string, c);
  }
  const allCandidates = Array.from(mergedCandidates.values());
  candidateIds = allCandidates.map(c => c.id as string);

  console.log(`  Total candidatos QA (CO, socrata_colombia, rango fecha): ${allCandidates.length}`);
  const convertedCandidates = allCandidates.filter(c => c.converted_account_id !== null);
  console.log(`  Con converted_account_id (→ account creada): ${convertedCandidates.length}`);
  const convertedAccountIds = convertedCandidates.map(c => c.converted_account_id as string);

  // Sample primeros 10
  for (const c of allCandidates.slice(0, 10)) {
    console.log(`  - [${(c.id as string).slice(0,8)}] "${c.name}" | status=${c.status} | review_status=${c.review_status} | converted_account=${c.converted_account_id ? (c.converted_account_id as string).slice(0,8) : 'null'}`);
  }
  if (allCandidates.length > 10) console.log(`  ... y ${allCandidates.length - 10} más`);

  // ── C. accounts QA ────────────────────────────────────────────
  console.log('\n▶ C. accounts — QA candidatas a limpiar\n');

  let qaAccounts: Record<string, unknown>[] = [];

  // Por converted_account_id de candidatos
  if (convertedAccountIds.length > 0) {
    const { data: byConversion, error: aConvErr } = await admin
      .from('accounts')
      .select('id, name, source, pipeline_status, country_code, hubspot_company_id, created_at, metadata, archived_at')
      .in('id', convertedAccountIds);

    if (aConvErr) console.error('  Error accounts by conversion:', aConvErr.message);
    for (const a of byConversion ?? []) {
      qaAccounts.push(a);
    }
  }

  // Por nombres conocidos
  const { data: byName, error: aNameErr } = await admin
    .from('accounts')
    .select('id, name, source, pipeline_status, country_code, hubspot_company_id, created_at, metadata, archived_at')
    .in('name', KNOWN_QA_ACCOUNT_NAMES);

  if (aNameErr) console.error('  Error accounts by name:', aNameErr.message);

  // Por fecha + CO + source agent_1
  const { data: byDateSource, error: aDateErr } = await admin
    .from('accounts')
    .select('id, name, source, pipeline_status, country_code, hubspot_company_id, created_at, metadata, archived_at')
    .eq('country_code', 'CO')
    .in('source', ['agent_1', 'other'])
    .gte('created_at', DATE_FROM)
    .lt('created_at', DATE_TO);

  if (aDateErr) console.error('  Error accounts by date+source:', aDateErr.message);

  // Merge dedupado
  const mergedAccounts = new Map<string, Record<string, unknown>>();
  for (const a of [...qaAccounts, ...(byName ?? []), ...(byDateSource ?? [])]) {
    mergedAccounts.set(a.id as string, a);
  }
  const allAccounts = Array.from(mergedAccounts.values());
  const accountIds = allAccounts.map(a => a.id as string);

  console.log(`  Total accounts QA identificadas: ${allAccounts.length}`);

  const withHubspot = allAccounts.filter(a => a.hubspot_company_id !== null);
  console.log(`  Con hubspot_company_id (⚠️  NO borrar en HubSpot): ${withHubspot.length}`);
  const archived = allAccounts.filter(a => a.archived_at !== null);
  console.log(`  Ya archivadas: ${archived.length}`);

  for (const a of allAccounts) {
    const hsFlag = a.hubspot_company_id ? ` ⚠️  hubspot_id=${a.hubspot_company_id}` : '';
    const archivedFlag = a.archived_at ? ' [ARCHIVADA]' : '';
    console.log(`  - [${(a.id as string).slice(0,8)}] "${a.name}" | source=${a.source} | status=${a.pipeline_status}${archivedFlag}${hsFlag}`);
  }

  // ── D. prospect_candidate_audit ───────────────────────────────
  console.log('\n▶ D. prospect_candidate_audit — filas relacionadas\n');

  let auditCount = 0;
  if (batchIds.length > 0) {
    const { count, error: audErr } = await admin
      .from('prospect_candidate_audit')
      .select('id', { count: 'exact', head: true })
      .in('batch_id', batchIds);

    if (audErr) console.error('  Error audit count:', audErr.message);
    auditCount = count ?? 0;
  }
  console.log(`  Filas audit relacionadas a batches QA: ${auditCount}`);
  console.log('  (ON DELETE CASCADE desde prospect_batches → se borran automáticamente)');

  // ── E. Accounts con hubspot_company_id ────────────────────────
  console.log('\n▶ E. Accounts con hubspot_company_id (detalle completo)\n');
  if (withHubspot.length === 0) {
    console.log('  Ninguna account QA tiene hubspot_company_id.');
  } else {
    for (const a of withHubspot) {
      console.log(`  ⚠️  Account: "${a.name}"`);
      console.log(`     id:                ${a.id}`);
      console.log(`     hubspot_company_id: ${a.hubspot_company_id}`);
      console.log(`     pipeline_status:    ${a.pipeline_status}`);
      console.log(`     created_at:         ${a.created_at}`);
      console.log(`     NOTA: Este cleanup NO toca HubSpot. Limpiar HubSpot manualmente si necesario.`);
    }
  }

  // ── F. Validar que no tiene actividad real ────────────────────
  console.log('\n▶ F. Validar actividad real en accounts QA\n');

  // Verificar si existen tablas de actividad (meetings, proposals, business_cases)
  const ACTIVITY_TABLES = ['meetings', 'proposals', 'business_cases'];
  for (const table of ACTIVITY_TABLES) {
    if (accountIds.length === 0) break;
    const { count, error } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .in('account_id', accountIds);

    if (error) {
      // tabla puede no existir
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.log(`  ✓ Tabla '${table}' no existe → sin riesgo.`);
      } else {
        console.log(`  ? Tabla '${table}': error al consultar (${error.message})`);
      }
    } else {
      const flag = (count ?? 0) > 0 ? '⚠️ ' : '✓ ';
      console.log(`  ${flag}Tabla '${table}': ${count ?? 0} filas relacionadas.`);
    }
  }

  // ── Resumen final ─────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  RESUMEN\n');
  console.log(`  prospect_batches QA:          ${qaBatches?.length ?? 0}`);
  console.log(`  prospect_candidates QA:       ${allCandidates.length}`);
  console.log(`  prospect_candidate_audit QA:  ${auditCount}  (cascade)`);
  console.log(`  accounts QA:                  ${allAccounts.length}`);
  console.log(`  accounts con hubspot_id:      ${withHubspot.length}`);
  console.log(`  accounts ya archivadas:       ${archived.length}`);
  console.log('\n  IDs de batches QA:');
  for (const id of batchIds) console.log(`    ${id}`);
  console.log('\n  IDs de accounts QA:');
  for (const id of accountIds) console.log(`    ${id}`);
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n❌  Error inesperado:', e);
  process.exit(1);
});
