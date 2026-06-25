/**
 * Logical cleanup — batch v1.16K-A Source Snippet Employee Size Supabase Write Smoke
 *
 * Condiciones estrictas:
 *   - NO DELETE / hard delete
 *   - NO Tavily / LLM
 *   - NO provider_usage_logs updates/deletes
 *   - NO tocar candidatos reales (solo dominios .example smoke)
 *   - Candidatos smoke → status='discarded', review_status='rejected'
 *   - Batch smoke → status='completed'
 *   - metadata.logical_cleanup con hard_delete=false
 *
 * Uso:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/agent1/batch-logical-cleanup-16kA-source-snippet-size-write.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const BATCH_ID   = 'cc3843f7-a246-4ec5-b5fa-66cbfca07a19';
const SMOKE_TYPE = 'source_snippet_size_v1_16k_a';

const CANDIDATE_DOMAINS_INSERTED = [
  'sellup-snippet-pass-smoke.example',
  'sellup-snippet-false-positive-smoke.example',
  'sellup-snippet-no-size-smoke.example',
] as const;

const CANDIDATE_DOMAIN_BLOCKED = 'sellup-snippet-block-smoke.example';

const ALL_SMOKE_DOMAINS = [
  ...CANDIDATE_DOMAINS_INSERTED,
  CANDIDATE_DOMAIN_BLOCKED,
];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function sep(char = '═', n = 62) { return char.repeat(n); }

async function main() {
  console.log(`\n${sep()}`);
  console.log('  BATCH LOGICAL CLEANUP — v1.16K-A Source Snippet Employee Size');
  console.log(`  Batch ID: ${BATCH_ID}`);
  console.log(`${sep()}\n`);

  // ── PASO 1: Precheck candidatos smoke ──────────────────────────────────────
  console.log('PASO 1 — Precheck candidatos smoke\n');

  const { data: candidates, error: cErr } = await admin
    .from('prospect_candidates')
    .select('id, batch_id, name, domain, status, review_status, duplicate_status, metadata, created_at, updated_at')
    .in('domain', ALL_SMOKE_DOMAINS)
    .order('created_at', { ascending: false });

  if (cErr) throw new Error(`Error leyendo candidatos: ${cErr.message}`);

  console.log(`  Candidatos smoke encontrados: ${candidates?.length ?? 0}`);
  for (const c of candidates ?? []) {
    const m = (c.metadata ?? {}) as Record<string, unknown>;
    console.log(`\n  ─── ${c.domain}`);
    console.log(`    id             : ${c.id}`);
    console.log(`    batch_id       : ${c.batch_id}`);
    console.log(`    status         : ${c.status}`);
    console.log(`    review_status  : ${c.review_status}`);
    console.log(`    smoke_test     : ${m['smoke_test']}`);
    console.log(`    smoke_type     : ${m['smoke_type']}`);
    console.log(`    smoke_scenario : ${m['smoke_scenario']}`);
    console.log(`    rich_profile.size : ${JSON.stringify((m['rich_profile'] as Record<string,unknown>)?.['size'] ?? null)}`);
    console.log(`    employee_size_resolution : ${JSON.stringify(m['employee_size_resolution'] ?? null)}`);
    console.log(`    icp_size_gate  : ${JSON.stringify(m['icp_size_gate'] ?? null)}`);
    console.log(`    logical_cleanup: ${JSON.stringify(m['logical_cleanup'] ?? null)}`);
  }

  // Validaciones
  const insertedInBatch = (candidates ?? []).filter(c => c.batch_id === BATCH_ID);
  const blockedExists   = (candidates ?? []).some(c => c.domain === CANDIDATE_DOMAIN_BLOCKED && c.batch_id === BATCH_ID);
  const alreadyCleaned  = insertedInBatch.some(c => (c.metadata as Record<string,unknown>)?.['logical_cleanup']);

  const checks = [
    { ok: insertedInBatch.length === 3,  label: `3 candidatos insertados en batch (actual: ${insertedInBatch.length})` },
    { ok: !blockedExists,               label: `candidato 'block' NO insertado en batch (correcto: ausente)` },
    { ok: !alreadyCleaned,              label: 'sin logical_cleanup previo en candidatos' },
  ];

  let allOk = true;
  for (const c of checks) {
    console.log(`\n  ${c.ok ? '✓' : '✗'}  ${c.label}`);
    if (!c.ok) allOk = false;
  }

  if (!allOk) {
    console.error('\n❌  Precheck candidatos FALLIDO. Abortando sin cambios.\n');
    process.exit(1);
  }

  console.log('\n✓  PASO 1 completado.\n');

  // ── PASO 2: Precheck batch smoke ───────────────────────────────────────────
  console.log(`${sep('-')}`);
  console.log('PASO 2 — Precheck batch smoke\n');

  const { data: batch, error: bErr } = await admin
    .from('prospect_batches')
    .select('id, name, status, metadata, completed_at, created_at, updated_at')
    .eq('id', BATCH_ID)
    .maybeSingle();

  if (bErr) throw new Error(`Error leyendo batch: ${bErr.message}`);
  if (!batch) throw new Error(`Batch ${BATCH_ID} NO ENCONTRADO.`);

  const meta = (batch.metadata ?? {}) as Record<string, unknown>;
  const icpSummary    = meta['icp_size_gate_summary']  as Record<string,unknown> | undefined;
  const writerSummary = meta['writer_summary']          as Record<string,unknown> | undefined;

  console.log('  id           :', batch.id);
  console.log('  name         :', batch.name);
  console.log('  status       :', batch.status);
  console.log('  smoke_test   :', meta['smoke_test']);
  console.log('  smoke_type   :', meta['smoke_type']);
  console.log('  completed_at :', batch.completed_at);
  console.log('\n  icp_size_gate_summary:');
  console.log('  ', JSON.stringify(icpSummary ?? null, null, 2).replace(/\n/g, '\n  '));
  console.log('\n  writer_summary:');
  console.log('  ', JSON.stringify(writerSummary ?? null, null, 2).replace(/\n/g, '\n  '));
  console.log('\n  logical_cleanup (previo):', JSON.stringify(meta['logical_cleanup'] ?? null));

  const smokeTestOk = meta['smoke_test'] === true || meta['smoke_test'] === 'true';
  const batchChecks = [
    { ok: smokeTestOk,                                           label: `smoke_test === true|"true"` },
    { ok: meta['smoke_type'] === SMOKE_TYPE,                     label: `smoke_type === "${SMOKE_TYPE}"` },
    { ok: batch.status === 'ready_for_review',                   label: `status === 'ready_for_review' (actual: ${batch.status})` },
    { ok: !meta['logical_cleanup'],                              label: 'sin logical_cleanup previo' },
    { ok: icpSummary?.['pass_count'] === 1,                     label: `icp_size_gate_summary.pass_count === 1 (actual: ${icpSummary?.['pass_count']})` },
    { ok: icpSummary?.['needs_validation_count'] === 2,         label: `icp_size_gate_summary.needs_validation_count === 2 (actual: ${icpSummary?.['needs_validation_count']})` },
    { ok: icpSummary?.['blocked_count'] === 1,                  label: `icp_size_gate_summary.blocked_count === 1 (actual: ${icpSummary?.['blocked_count']})` },
    { ok: writerSummary?.['actual_persisted_count'] === 3,       label: `writer_summary.actual_persisted_count === 3 (actual: ${writerSummary?.['actual_persisted_count']})` },
    { ok: writerSummary?.['actual_skipped_count'] === 1,        label: `writer_summary.actual_skipped_count === 1 (actual: ${writerSummary?.['actual_skipped_count']})` },
  ];

  let batchOk = true;
  for (const c of batchChecks) {
    console.log(`\n  ${c.ok ? '✓' : '✗'}  ${c.label}`);
    if (!c.ok) batchOk = false;
  }

  if (!batchOk) {
    console.error('\n❌  Precheck batch FALLIDO. Abortando sin cambios.\n');
    process.exit(1);
  }

  console.log('\n✓  PASO 2 completado.\n');

  // ── PASO 3: Confirmar usage_logs en cero ───────────────────────────────────
  console.log(`${sep('-')}`);
  console.log('PASO 3 — Confirmar usage_logs en cero\n');

  const { data: usageLogs, error: uLErr } = await admin
    .from('provider_usage_logs')
    .select('id, estimated_cost_usd')
    .eq('batch_id', BATCH_ID);

  if (uLErr) throw new Error(`Error leyendo provider_usage_logs: ${uLErr.message}`);

  const usageCount = usageLogs?.length ?? 0;
  const totalCost  = (usageLogs ?? []).reduce((s, r) => s + (Number(r.estimated_cost_usd) || 0), 0);

  console.log(`  usage_logs            : ${usageCount}`);
  console.log(`  total_estimated_usd   : ${totalCost}`);

  if (usageCount !== 0) {
    console.error('\n❌  Se encontraron usage_logs. Abortando por condición estricta.\n');
    process.exit(1);
  }

  console.log('\n✓  PASO 3 completado. usage_logs=0.\n');

  // ── PASO 4: Cleanup lógico candidatos smoke ────────────────────────────────
  console.log(`${sep('-')}`);
  console.log('PASO 4 — Cleanup lógico candidatos smoke\n');

  const cleanupAt = new Date().toISOString();

  let candidatesUpdated = 0;
  const candidateResults = [];

  for (const c of insertedInBatch) {
    const cMeta = (c.metadata ?? {}) as Record<string,unknown>;
    const updatedCMeta = {
      ...cMeta,
      smoke_test: true,
      smoke_type: SMOKE_TYPE,
      qa_only: true,
      do_not_use_for_sales: true,
      do_not_convert: true,
      logical_cleanup: {
        cleanup_type: 'source_snippet_size_v1_16k_a_candidate_cleanup',
        cleanup_at: cleanupAt,
        reason: 'Controlled Source Snippet Employee Size smoke completed; candidate should be ignored in production.',
        cleanup_mode: 'logical_only',
        hard_delete: false,
      },
    };

    const { data: upd, error: updErr } = await admin
      .from('prospect_candidates')
      .update({
        status: 'discarded',
        review_status: 'rejected',
        metadata: updatedCMeta,
        updated_at: cleanupAt,
      })
      .eq('id', c.id)
      .eq('batch_id', BATCH_ID)
      .neq('status', 'discarded')
      .select('id, batch_id, name, domain, status, review_status, metadata')
      .single();

    if (updErr) throw new Error(`Error actualizando candidato ${c.domain}: ${updErr.message}`);
    if (!upd) throw new Error(`UPDATE candidato ${c.domain} retornó 0 filas.`);

    candidatesUpdated++;
    candidateResults.push(upd);
    const uMeta = upd.metadata as Record<string,unknown>;
    console.log(`  ✓ ${upd.domain} → status=${upd.status}, review_status=${upd.review_status}`);
    console.log(`    logical_cleanup: ${JSON.stringify(uMeta['logical_cleanup'])}`);
  }

  if (candidatesUpdated !== 3) {
    throw new Error(`Se esperaban 3 actualizaciones de candidatos, se obtuvieron ${candidatesUpdated}.`);
  }

  console.log(`\n✓  PASO 4 completado. Candidatos actualizados: ${candidatesUpdated}.\n`);

  // ── PASO 5: Cleanup lógico batch smoke ─────────────────────────────────────
  console.log(`${sep('-')}`);
  console.log('PASO 5 — Cleanup lógico batch smoke\n');

  const logicalCleanup = {
    cleanup_type: 'source_snippet_size_v1_16k_a_batch_cleanup',
    cleanup_at: cleanupAt,
    reason: 'Controlled Source Snippet Employee Size smoke completed; batch should be ignored in production.',
    cleanup_mode: 'logical_only',
    hard_delete: false,
    candidate_inserts: 3,
    skipped_candidates: 1,
    tavily_calls: 0,
    llm_calls: 0,
    usage_logs: 0,
  };

  const updatedBatchMeta = {
    ...meta,
    logical_cleanup: logicalCleanup,
  };

  const now = new Date().toISOString();

  const { data: batchUpd, error: bUpdErr } = await admin
    .from('prospect_batches')
    .update({
      status: 'completed',
      metadata: updatedBatchMeta,
      completed_at: batch.completed_at ?? now,
      updated_at: now,
    })
    .eq('id', BATCH_ID)
    .eq('metadata->>smoke_test', 'true')
    .eq('metadata->>smoke_type', SMOKE_TYPE)
    .select('id, name, status, metadata, completed_at, updated_at')
    .single();

  if (bUpdErr) throw new Error(`Error actualizando batch: ${bUpdErr.message}`);
  if (!batchUpd) throw new Error('UPDATE batch retornó 0 filas.');

  const bUpdMeta = batchUpd.metadata as Record<string,unknown>;
  console.log('  ✓ Batch actualizado (1 fila)');
  console.log('  id           :', batchUpd.id);
  console.log('  status       :', batchUpd.status);
  console.log('  completed_at :', batchUpd.completed_at);
  console.log('  updated_at   :', batchUpd.updated_at);
  console.log('\n  logical_cleanup escrito:');
  console.log('  ', JSON.stringify(bUpdMeta['logical_cleanup'], null, 2).replace(/\n/g, '\n  '));

  console.log('\n✓  PASO 5 completado.\n');

  // ── PASO 6: Verificación final ─────────────────────────────────────────────
  console.log(`${sep('-')}`);
  console.log('PASO 6 — Verificación final\n');

  const { data: finalCandidates, error: fcErr } = await admin
    .from('prospect_candidates')
    .select('id, batch_id, name, domain, status, review_status, metadata, updated_at')
    .eq('batch_id', BATCH_ID)
    .order('created_at', { ascending: false });

  if (fcErr) throw new Error(`Error en verificación final de candidatos: ${fcErr.message}`);

  console.log('  Candidatos finales en batch:\n');
  for (const c of finalCandidates ?? []) {
    const m = (c.metadata ?? {}) as Record<string,unknown>;
    console.log(`  ─── ${c.domain}`);
    console.log(`    status          : ${c.status}`);
    console.log(`    review_status   : ${c.review_status}`);
    console.log(`    smoke_scenario  : ${m['smoke_scenario']}`);
    console.log(`    icp_size_gate   : ${JSON.stringify(m['icp_size_gate'] ?? null)}`);
    console.log(`    logical_cleanup : ${JSON.stringify(m['logical_cleanup'] ?? null)}`);
  }

  const { data: finalBatch, error: fbErr } = await admin
    .from('prospect_batches')
    .select('id, name, status, metadata, completed_at, updated_at')
    .eq('id', BATCH_ID)
    .single();

  if (fbErr) throw new Error(`Error en verificación final de batch: ${fbErr.message}`);

  const fbMeta = finalBatch.metadata as Record<string,unknown>;
  console.log('\n  Batch final:');
  console.log('  id           :', finalBatch.id);
  console.log('  status       :', finalBatch.status);
  console.log('  smoke_test   :', fbMeta['smoke_test']);
  console.log('  smoke_type   :', fbMeta['smoke_type']);
  console.log('  icp_size_gate_summary :', JSON.stringify(fbMeta['icp_size_gate_summary'] ?? null));
  console.log('  writer_summary        :', JSON.stringify(fbMeta['writer_summary'] ?? null));
  console.log('  logical_cleanup       :', JSON.stringify(fbMeta['logical_cleanup'] ?? null));
  console.log('  completed_at :', finalBatch.completed_at);
  console.log('  updated_at   :', finalBatch.updated_at);

  const { data: finalUsage, error: fuErr } = await admin
    .from('provider_usage_logs')
    .select('id')
    .eq('batch_id', BATCH_ID);

  if (fuErr) throw new Error(`Error en verificación final de usage_logs: ${fuErr.message}`);
  console.log(`\n  usage_logs (final): ${finalUsage?.length ?? 0}`);

  // Validaciones finales
  const allDiscarded = (finalCandidates ?? []).every(c => c.status === 'discarded' && c.review_status === 'rejected');
  const allHaveCleanup = (finalCandidates ?? []).every(c => (c.metadata as Record<string,unknown>)?.['logical_cleanup']);

  if (!allDiscarded) throw new Error('VERIFICACIÓN FALLIDA: no todos los candidatos están discarded/rejected.');
  if (!allHaveCleanup) throw new Error('VERIFICACIÓN FALLIDA: algún candidato sin logical_cleanup.');
  if (finalBatch.status !== 'completed') throw new Error(`VERIFICACIÓN FALLIDA: batch status=${finalBatch.status}`);
  if (!fbMeta['logical_cleanup']) throw new Error('VERIFICACIÓN FALLIDA: batch sin logical_cleanup.');

  // ── Reporte final ──────────────────────────────────────────────────────────
  console.log(`\n${sep()}`);
  console.log('  REPORTE FINAL');
  console.log(sep());
  console.log(`  ✓ Candidatos actualizados       : ${candidatesUpdated}`);
  console.log(`  ✓ Batch actualizado             : 1 fila`);
  console.log(`  ✓ DELETE ejecutados             : 0`);
  console.log(`  ✓ Hard delete                   : 0`);
  console.log(`  ✓ Tavily calls                  : 0`);
  console.log(`  ✓ LLM calls                     : 0`);
  console.log(`  ✓ provider_usage_logs tocados   : 0`);
  console.log(`  ✓ usage_logs en batch           : ${finalUsage?.length ?? 0}`);
  console.log(`  ✓ Candidatos reales tocados     : 0`);
  console.log(`  ✓ Batches reales tocados        : 0`);
  console.log(`  ✓ configs default cambiadas     : 0`);
  console.log(`  ✓ logical_cleanup.hard_delete   : false`);
  console.log(`  ✓ logical_cleanup.cleanup_mode  : logical_only`);
  console.log(`  ✓ candidate status final        : discarded`);
  console.log(`  ✓ candidate review_status final : rejected`);
  console.log(`  ✓ batch status final            : completed`);
  console.log(sep());
}

main().catch(e => {
  console.error('\n❌  Error fatal:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
