/**
 * Script de limpieza QA — bloque 16AK, Colombia/RUES.
 * Usa el mismo admin client que la Server Action.
 *
 * Uso:
 *   # Preview (solo lectura):
 *   npx tsx scripts/run-qa-cleanup.ts preview
 *
 *   # Execute (DELETE físico):
 *   npx tsx scripts/run-qa-cleanup.ts execute
 *
 * Variables requeridas: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Cargar con: set -a && source .env.local && set +a
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Faltan variables de entorno.');
  process.exit(1);
}

const MODE = (process.argv[2] ?? 'preview') as 'preview' | 'execute';
if (MODE !== 'preview' && MODE !== 'execute') {
  console.error('❌  Modo inválido. Usa: preview | execute');
  process.exit(1);
}

// ── Configuración del cleanup ─────────────────────────────────
const DATE_FROM    = '2026-06-01T00:00:00Z';
const DATE_TO      = '2026-06-03T00:00:00Z';
const COUNTRY_CODE = 'CO';

const KNOWN_QA_NAMES = [
  'PRONALTE LIMITADA',
  'PROYECTOS Y CONSTRUCCIONES PROYCON S.A.S.',
  'CORPORACION DE TELEVIDENTES DE LETICIA EN LIQUIDACION',
  'M Y M ASESORES INMOBILIARIOS SAS - EN LIQUIDACION',
  'MOLA DIGITAL SAS - EN LIQUIDACION',
  'ESCANHER ABOGADOS SAS',
];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log(`\n${'═'.repeat(58)}`);
  console.log(`  CLEANUP QA 16AK — modo: ${MODE.toUpperCase()}`);
  console.log(`  Rango: ${DATE_FROM} → ${DATE_TO}  |  País: ${COUNTRY_CODE}`);
  console.log(`${'═'.repeat(58)}\n`);

  // ── 1. Resolver batches ───────────────────────────────────
  const { data: batches, error: bErr } = await admin
    .from('prospect_batches')
    .select('id, name, source, status, created_at')
    .gte('created_at', DATE_FROM)
    .lt('created_at', DATE_TO)
    .eq('country_code', COUNTRY_CODE)
    .order('created_at', { ascending: false });

  if (bErr) throw new Error(`Error batches: ${bErr.message}`);
  const batchIds = (batches ?? []).map(b => b.id as string);

  console.log(`prospect_batches QA:  ${batchIds.length}`);

  // ── 2. Contar candidatos ──────────────────────────────────
  let candidateCount = 0;
  if (batchIds.length > 0) {
    const { count } = await admin
      .from('prospect_candidates')
      .select('id', { count: 'exact', head: true })
      .in('batch_id', batchIds);
    candidateCount = count ?? 0;
  }
  console.log(`prospect_candidates:  ${candidateCount}  (se borran por CASCADE desde batches)`);

  // ── 3. Contar audit ───────────────────────────────────────
  let auditCount = 0;
  if (batchIds.length > 0) {
    const { count } = await admin
      .from('prospect_candidate_audit')
      .select('id', { count: 'exact', head: true })
      .in('batch_id', batchIds);
    auditCount = count ?? 0;
  }
  console.log(`prospect_candidate_audit: ${auditCount}  (CASCADE)`);

  // ── 4. Resolver accounts ──────────────────────────────────
  const mergedAccounts = new Map<string, Record<string, unknown>>();
  const addRows = (rows: Record<string, unknown>[]) => {
    for (const r of rows) mergedAccounts.set(r.id as string, r);
  };

  if (batchIds.length > 0) {
    const { data: candidates } = await admin
      .from('prospect_candidates')
      .select('converted_account_id')
      .in('batch_id', batchIds)
      .not('converted_account_id', 'is', null);

    const convertedIds = (candidates ?? []).map(c => c.converted_account_id as string).filter(Boolean);
    if (convertedIds.length > 0) {
      const { data } = await admin
        .from('accounts')
        .select('id, name, source, pipeline_status, hubspot_company_id, created_at')
        .in('id', convertedIds);
      addRows((data ?? []) as Record<string, unknown>[]);
    }
  }

  const { data: byName } = await admin
    .from('accounts')
    .select('id, name, source, pipeline_status, hubspot_company_id, created_at')
    .in('name', KNOWN_QA_NAMES);
  addRows((byName ?? []) as Record<string, unknown>[]);

  const { data: byDate } = await admin
    .from('accounts')
    .select('id, name, source, pipeline_status, hubspot_company_id, created_at')
    .eq('country_code', COUNTRY_CODE)
    .gte('created_at', DATE_FROM)
    .lt('created_at', DATE_TO);
  addRows((byDate ?? []) as Record<string, unknown>[]);

  const accounts = Array.from(mergedAccounts.values());
  const accountIds = accounts.map(a => a.id as string);
  const withHubspot = accounts.filter(a => a.hubspot_company_id !== null);

  console.log(`accounts QA:          ${accounts.length}`);
  console.log(`  con hubspot_id:     ${withHubspot.length}`);
  for (const a of accounts) {
    const hs = a.hubspot_company_id ? ` ⚠️  hubspot_id=${a.hubspot_company_id}` : '';
    console.log(`  - [${(a.id as string).slice(0, 8)}] "${a.name}"${hs}`);
  }

  if (MODE === 'preview') {
    console.log('\n✓  PREVIEW completo. Sin cambios realizados.');
    if (withHubspot.length > 0) {
      console.log('\n⚠️  AVISO HUBSPOT:');
      for (const a of withHubspot) {
        console.log(`   Account "${a.name}" (hubspot_id=${a.hubspot_company_id}) será eliminada de`);
        console.log(`   SellUp pero NO de HubSpot. Limpiar HubSpot manualmente si es necesario.`);
      }
    }
    console.log('\n  Para ejecutar el cleanup: npx tsx scripts/run-qa-cleanup.ts execute\n');
    return;
  }

  // ── EXECUTE ───────────────────────────────────────────────
  console.log('\n⚡  Ejecutando cleanup físico...\n');

  // Paso 1: Eliminar accounts (cascadea → account_audit, SET NULL en candidates)
  if (accountIds.length > 0) {
    console.log(`  → Eliminando ${accountIds.length} accounts...`);
    const { error: delAccErr, count } = await admin
      .from('accounts')
      .delete({ count: 'exact' })
      .in('id', accountIds);

    if (delAccErr) throw new Error(`Error eliminando accounts: ${delAccErr.message}`);
    console.log(`  ✓ accounts eliminadas: ${count ?? accountIds.length}`);
    console.log(`  ✓ account_audit: eliminado por CASCADE`);
  } else {
    console.log('  ✓ Sin accounts QA que eliminar.');
  }

  // Paso 2: Eliminar prospect_batches (cascadea → prospect_candidates + prospect_candidate_audit)
  if (batchIds.length > 0) {
    console.log(`\n  → Eliminando ${batchIds.length} prospect_batches...`);
    const { error: delBatchErr, count } = await admin
      .from('prospect_batches')
      .delete({ count: 'exact' })
      .in('id', batchIds);

    if (delBatchErr) throw new Error(`Error eliminando batches: ${delBatchErr.message}`);
    console.log(`  ✓ prospect_batches eliminados: ${count ?? batchIds.length}`);
    console.log(`  ✓ prospect_candidates: ${candidateCount} eliminados por CASCADE`);
    console.log(`  ✓ prospect_candidate_audit: ${auditCount} eliminados por CASCADE`);
  } else {
    console.log('  ✓ Sin batches QA que eliminar.');
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  CLEANUP COMPLETADO');
  console.log(`  - accounts eliminadas:              ${accountIds.length}`);
  console.log(`  - prospect_batches eliminados:      ${batchIds.length}`);
  console.log(`  - prospect_candidates (cascade):    ${candidateCount}`);
  console.log(`  - prospect_candidate_audit (cascade): ${auditCount}`);
  console.log('  - HubSpot:                          NO TOCADO');
  console.log('  - Chile/México:                     NO TOCADO');

  if (withHubspot.length > 0) {
    console.log('\n  ⚠️  AVISO HUBSPOT:');
    for (const a of withHubspot) {
      console.log(`     Account "${a.name}" eliminada de SellUp.`);
      console.log(`     HubSpot Company ID ${a.hubspot_company_id} sigue existiendo en HubSpot.`);
      console.log(`     Limpiar manualmente desde HubSpot si es necesario.`);
    }
  }
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n❌  Error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
