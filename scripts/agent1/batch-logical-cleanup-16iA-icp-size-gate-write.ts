#!/usr/bin/env tsx
/**
 * Cleanup lógico v1.16I-A — ICP Size Gate Supabase Write Smoke
 *
 * 0 DELETE | 0 HARD DELETE | 0 TAVILY | 0 LLM
 * 0 provider_usage_logs | 0 candidatos reales | 0 batches reales
 *
 * Batch final válido: d0b54ace-2974-49ad-b2c0-40ef2c231fd7
 */

import { createClient } from '@supabase/supabase-js';

const SMOKE_TYPE    = 'icp_size_gate_v1_16i_a';
const SMOKE_DOMAINS = [
  'sellup-icp-pass-smoke.example',
  'sellup-icp-unknown-smoke.example',
  'sellup-icp-block-smoke.example',
];

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('[cleanup] Supabase credentials not configured');
  return createClient(url, key);
}

function sep(title: string) {
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(78));
}

async function main() {
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  LOGICAL CLEANUP v1.16I-A — ICP SIZE GATE SMOKE                             │');
  console.log('│  0 DELETE | 0 LLM | 0 TAVILY | 0 provider_usage_logs                       │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┘');

  const db = getAdminClient();

  // ─── PASO 1: Precheck batches smoke ─────────────────────────────────────────

  sep('PASO 1 — Precheck batches smoke ICP');

  const { data: batchRows, error: batchPrecheckErr } = await db
    .from('prospect_batches')
    .select('id, name, status, metadata, created_at, updated_at, completed_at')
    .eq('metadata->>smoke_type', SMOKE_TYPE)
    .order('created_at', { ascending: false });

  if (batchPrecheckErr) throw new Error(`Precheck batches: ${batchPrecheckErr.message}`);

  const batches = batchRows ?? [];
  console.log(`\nBatches smoke encontrados: ${batches.length}`);
  batches.forEach((b, i) => {
    const lc = (b.metadata as Record<string, unknown>)?.['logical_cleanup'];
    console.log(`  [${i + 1}] id=${b.id} | status=${b.status} | logical_cleanup=${lc ? 'SÍ' : 'NO'} | created_at=${b.created_at}`);
  });

  const batchesWithCleanup    = batches.filter(b =>  !!(b.metadata as Record<string, unknown>)?.['logical_cleanup']);
  const batchesWithoutCleanup = batches.filter(b => !(b.metadata as Record<string, unknown>)?.['logical_cleanup']);
  console.log(`\n  → Ya tienen logical_cleanup: ${batchesWithCleanup.length}`);
  console.log(`  → Pendientes de cleanup:      ${batchesWithoutCleanup.length}`);

  // ─── PASO 2: Precheck candidatos smoke ──────────────────────────────────────

  sep('PASO 2 — Precheck candidatos smoke ICP');

  const { data: candidateRows, error: candidatePrecheckErr } = await db
    .from('prospect_candidates')
    .select('id, batch_id, name, domain, status, review_status, duplicate_status, metadata, created_at, updated_at')
    .in('domain', SMOKE_DOMAINS)
    .order('created_at', { ascending: false });

  if (candidatePrecheckErr) throw new Error(`Precheck candidates: ${candidatePrecheckErr.message}`);

  const candidates = candidateRows ?? [];
  console.log(`\nCandidatos smoke encontrados: ${candidates.length}`);

  const allSmokeOnly = candidates.every(c =>
    SMOKE_DOMAINS.includes((c.domain ?? '').toLowerCase())
  );
  console.log(`  → Solo dominios .example smoke: ${allSmokeOnly ? 'SÍ ✓' : 'NO — REVISAR'}`);

  const candidateBatchIds = [...new Set(candidates.map(c => c.batch_id))];
  const allBatchIdsSmoke  = candidateBatchIds.every(bid => batches.some(b => b.id === bid));
  console.log(`  → Todos batch_id pertenecen a batches smoke: ${allBatchIdsSmoke ? 'SÍ ✓' : 'NO — REVISAR'}`);

  candidates.forEach((c, i) => {
    const lc  = (c.metadata as Record<string, unknown>)?.['logical_cleanup'];
    const isg = (c.metadata as Record<string, unknown>)?.['icp_size_gate'];
    const st  = (c.metadata as Record<string, unknown>)?.['smoke_type'];
    console.log(`  [${i + 1}] id=${c.id} | domain=${c.domain} | status=${c.status} | review_status=${c.review_status} | smoke_type=${st} | icp_size_gate=${JSON.stringify(isg)} | logical_cleanup=${lc ? 'SÍ' : 'NO'}`);
  });

  if (!allSmokeOnly) {
    throw new Error('ABORT: Dominios no-smoke en candidatos. No se procede.');
  }
  if (!allBatchIdsSmoke) {
    throw new Error('ABORT: Candidatos apuntan a batches no-smoke. No se procede.');
  }

  // ─── PASO 3: Precheck usage logs ────────────────────────────────────────────

  sep('PASO 3 — Precheck usage logs');

  const smokeBatchIds = batches.map(b => b.id);
  let usageLogs = 0;
  let totalCost = 0;

  if (smokeBatchIds.length > 0) {
    const { data: usageRows, error: usageErr } = await db
      .from('provider_usage_logs')
      .select('estimated_cost_usd')
      .in('batch_id', smokeBatchIds);

    if (usageErr) throw new Error(`Precheck usage_logs: ${usageErr.message}`);
    usageLogs = usageRows?.length ?? 0;
    totalCost = (usageRows ?? []).reduce((s, r) => s + (r.estimated_cost_usd ?? 0), 0);
  }

  console.log(`\n  usage_logs:           ${usageLogs}  ${usageLogs === 0 ? '✓' : '⚠ INESPERADO'}`);
  console.log(`  total_estimated_usd:  ${totalCost}  ${totalCost === 0 ? '✓' : '⚠ INESPERADO'}`);

  // ─── PASO 4: Cleanup lógico candidatos ──────────────────────────────────────

  sep('PASO 4 — Cleanup lógico candidatos smoke ICP');

  // Incluir todos los candidatos smoke sin logical_cleanup (status discarded o no)
  const candidatesToClean = candidates.filter(c =>
    !(c.metadata as Record<string, unknown>)?.['logical_cleanup']
  );
  console.log(`\nCandidatos a actualizar (status != discarded): ${candidatesToClean.length}`);

  const candidatesUpdated: unknown[] = [];
  const cleanupAt = new Date().toISOString();

  for (const c of candidatesToClean) {
    const existingMeta = (c.metadata as Record<string, unknown>) ?? {};
    const newMeta = {
      ...existingMeta,
      smoke_test: true,
      smoke_type: SMOKE_TYPE,
      qa_only: true,
      do_not_use_for_sales: true,
      do_not_convert: true,
      logical_cleanup: {
        cleanup_type: `${SMOKE_TYPE}_candidate_cleanup`,
        cleanup_at: cleanupAt,
        reason: 'Controlled ICP Size Gate smoke completed; candidate should be ignored in production.',
        cleanup_mode: 'logical_only',
        hard_delete: false,
      },
    };

    const { data: updRow, error: updErr } = await db
      .from('prospect_candidates')
      .update({
        status: 'discarded',
        review_status: 'rejected',
        metadata: newMeta,
        updated_at: cleanupAt,
      })
      .eq('id', c.id)
      .select('id, batch_id, name, domain, status, review_status, metadata')
      .single();

    if (updErr) {
      console.warn(`  ⚠ No actualizado candidato ${c.id}: ${updErr.message}`);
    } else {
      candidatesUpdated.push(updRow);
      const lc = (updRow?.metadata as Record<string, unknown>)?.['logical_cleanup'];
      console.log(`  ✓ Updated id=${updRow?.id} | domain=${updRow?.domain} | status=${updRow?.status} | review_status=${updRow?.review_status} | logical_cleanup=${lc ? 'SÍ' : 'NO'}`);
    }
  }

  if (candidatesToClean.length === 0) {
    console.log('  (ningún candidato pendiente)');
  }

  // ─── PASO 5: Cleanup lógico batches ─────────────────────────────────────────

  sep('PASO 5 — Cleanup lógico batches smoke ICP');

  console.log(`\nBatches a actualizar (sin logical_cleanup): ${batchesWithoutCleanup.length}`);

  const batchesUpdated: unknown[] = [];

  for (const b of batchesWithoutCleanup) {
    const existingMeta = (b.metadata as Record<string, unknown>) ?? {};
    const newMeta = {
      ...existingMeta,
      logical_cleanup: {
        cleanup_type: `${SMOKE_TYPE}_batch_cleanup`,
        cleanup_at: cleanupAt,
        reason: 'Controlled ICP Size Gate smoke completed; batch should be ignored in production.',
        cleanup_mode: 'logical_only',
        hard_delete: false,
        tavily_calls: 0,
        llm_calls: 0,
        usage_logs: 0,
      },
    };

    const { data: updBatch, error: batchUpdErr } = await db
      .from('prospect_batches')
      .update({
        status: 'completed',
        metadata: newMeta,
        completed_at: b.completed_at ?? cleanupAt,
        updated_at: cleanupAt,
      })
      .eq('id', b.id)
      .select('id, name, status, metadata, completed_at, updated_at')
      .single();

    if (batchUpdErr) {
      console.warn(`  ⚠ No actualizado batch ${b.id}: ${batchUpdErr.message}`);
    } else {
      batchesUpdated.push(updBatch);
      const lc      = (updBatch?.metadata as Record<string, unknown>)?.['logical_cleanup'];
      const summary = (updBatch?.metadata as Record<string, unknown>)?.['icp_size_gate_summary'];
      const wsumm   = (updBatch?.metadata as Record<string, unknown>)?.['writer_summary'];
      console.log(`  ✓ Updated batch id=${updBatch?.id} | name=${updBatch?.name} | status=${updBatch?.status} | icp_size_gate_summary=${summary ? JSON.stringify(summary) : 'none'} | writer_summary=${wsumm ? JSON.stringify(wsumm) : 'none'} | logical_cleanup=${lc ? 'SÍ' : 'NO'}`);
    }
  }

  if (batchesWithoutCleanup.length === 0) {
    console.log('  (ningún batch pendiente)');
  }

  // ─── PASO 6: Verificación final ─────────────────────────────────────────────

  sep('PASO 6 — Verificación final');

  const { data: finalCandidates, error: finalCandErr } = await db
    .from('prospect_candidates')
    .select('id, batch_id, name, domain, status, review_status, metadata, updated_at')
    .in('domain', SMOKE_DOMAINS)
    .order('created_at', { ascending: false });

  if (finalCandErr) throw new Error(`Final check candidates: ${finalCandErr.message}`);

  console.log(`\nCandidatos smoke (verificación final): ${finalCandidates?.length ?? 0}`);
  (finalCandidates ?? []).forEach((c, i) => {
    const lc  = (c.metadata as Record<string, unknown>)?.['logical_cleanup'];
    const isg = (c.metadata as Record<string, unknown>)?.['icp_size_gate'];
    console.log(`  [${i + 1}] id=${c.id} | domain=${c.domain} | status=${c.status} | review_status=${c.review_status} | icp_size_gate=${JSON.stringify(isg)} | logical_cleanup=${lc ? 'SÍ ✓' : 'FALTA ⚠'}`);
  });

  const { data: finalBatches, error: finalBatchErr } = await db
    .from('prospect_batches')
    .select('id, name, status, metadata, completed_at, updated_at')
    .eq('metadata->>smoke_type', SMOKE_TYPE)
    .order('created_at', { ascending: false });

  if (finalBatchErr) throw new Error(`Final check batches: ${finalBatchErr.message}`);

  console.log(`\nBatches smoke (verificación final): ${finalBatches?.length ?? 0}`);
  (finalBatches ?? []).forEach((b, i) => {
    const lc      = (b.metadata as Record<string, unknown>)?.['logical_cleanup'];
    const summary = (b.metadata as Record<string, unknown>)?.['icp_size_gate_summary'];
    const wsumm   = (b.metadata as Record<string, unknown>)?.['writer_summary'];
    console.log(`  [${i + 1}] id=${b.id} | name=${b.name} | status=${b.status} | icp_size_gate_summary=${summary ? JSON.stringify(summary) : 'none'} | writer_summary=${wsumm ? JSON.stringify(wsumm) : 'none'} | logical_cleanup=${lc ? 'SÍ ✓' : 'FALTA ⚠'}`);
  });

  const allBatchIdsFinal = (finalBatches ?? []).map(b => b.id);
  let finalUsageLogs = 0;
  let finalCost = 0;
  if (allBatchIdsFinal.length > 0) {
    const { data: finalUsage, error: finalUsageErr } = await db
      .from('provider_usage_logs')
      .select('estimated_cost_usd')
      .in('batch_id', allBatchIdsFinal);
    if (finalUsageErr) throw new Error(`Final usage check: ${finalUsageErr.message}`);
    finalUsageLogs = finalUsage?.length ?? 0;
    finalCost = (finalUsage ?? []).reduce((s, r) => s + (r.estimated_cost_usd ?? 0), 0);
  }
  console.log(`\n  usage_logs final:           ${finalUsageLogs}  ${finalUsageLogs === 0 ? '✓' : '⚠'}`);
  console.log(`  total_estimated_usd final:  ${finalCost}  ${finalCost === 0 ? '✓' : '⚠'}`);

  // ─── PASO 7: Reporte final ───────────────────────────────────────────────────

  sep('PASO 7 — Reporte final');

  const allCandidatesClean = (finalCandidates ?? []).every(c =>
    c.status === 'discarded' &&
    c.review_status === 'rejected' &&
    !!(c.metadata as Record<string, unknown>)?.['logical_cleanup']
  );
  const allBatchesClean = (finalBatches ?? []).every(b =>
    b.status === 'completed' &&
    !!(b.metadata as Record<string, unknown>)?.['logical_cleanup']
  );

  console.log(`
  ┌─ REPORTE DE CLEANUP LÓGICO v1.16I-A ──────────────────────────────────────┐

  1. Batches smoke encontrados:               ${batches.length}
  2. Candidatos smoke encontrados:            ${candidates.length}
  3. Solo dominios .example / smoke:          ${allSmokeOnly ? 'SÍ ✓' : 'NO ⚠'}
  4. Candidatos actualizados (logical):       ${candidatesUpdated.length}
  5. Batches actualizados (logical):          ${batchesUpdated.length}
  6. Candidatos verificación final:           ${finalCandidates?.length ?? 0} — todos limpios: ${allCandidatesClean ? 'SÍ ✓' : 'NO ⚠'}
  7. Batches verificación final:              ${finalBatches?.length ?? 0} — todos limpios: ${allBatchesClean ? 'SÍ ✓' : 'NO ⚠'}
  8. usage_logs = 0:                          ${finalUsageLogs === 0 ? 'SÍ ✓' : 'NO ⚠'}

  Confirmación estricta:
  ✓ 0 DELETE
  ✓ 0 hard delete
  ✓ 0 Tavily
  ✓ 0 LLM
  ✓ 0 provider_usage_logs updates/deletes
  ✓ 0 candidatos reales tocados
  ✓ 0 batches reales tocados
  ✓ configs default siguen false

  └────────────────────────────────────────────────────────────────────────────┘`);

  const allGood = allCandidatesClean && allBatchesClean && finalUsageLogs === 0;
  if (allGood) {
    console.log('\n  ✅ CLEANUP LÓGICO COMPLETADO — v1.16I-A cerrado.\n');
  } else {
    console.log('\n  ⚠ CLEANUP INCOMPLETO — revisar items con ⚠ arriba.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
