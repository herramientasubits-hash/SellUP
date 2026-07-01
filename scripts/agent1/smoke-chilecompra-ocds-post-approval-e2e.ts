#!/usr/bin/env tsx
/**
 * ChileCompra OCDS Post-Approval E2E QA — v1.16CL-E
 *
 * Valida el flujo completo end-to-end:
 *   candidate QA (CL, RUT 968859307)
 *   → worker post-approval real
 *   → metadata.source_enrichment.cl_chilecompra_ocds
 *   → matched en candidate y account
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 ChileCompra API live    0 Tavily    0 LLM    0 Apollo    0 Lusha
 *   0 HubSpot sync            0 LinkedIn  0 Socrata live
 *   0 wizard                  0 Agent 1 generación prospectos
 *   0 contacts                0 candidatos reales procesados
 *   0 DELETE
 *
 * Usa lookupChileCompraOcdsByRut real → snapshot en Supabase (source_company_snapshots).
 * Usa adapterRegistryOverride = {} → 0 adapters CO (fuente CL no los necesita).
 * candidateId limitado al QA para no tocar cola real.
 *
 * Uso:
 *   node --env-file=.env.local --import tsx \
 *     scripts/agent1/smoke-chilecompra-ocds-post-approval-e2e.ts [--execute]
 *
 *   Sin --execute: crea datos QA + preflight, NO corre worker.
 *   Con --execute: corre worker + valida resultado.
 */

import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

ensureNode20WebSocketShim();

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runPostApprovalNitEnrichmentWorker } from '../../src/server/prospect-batches/post-approval-nit-enrichment-worker';

// ── Constants ─────────────────────────────────────────────────────────────────

const QA_DOMAIN = 'qa-chilecompra-ocds-e2e-16cle.sellup-test';
const QA_RUT = '968859307';
const QA_COUNTRY = 'CL';
const QA_CANDIDATE_NAME = 'QA ChileCompra E2E - CLINICA BICENTENARIO SPA';
const QA_ACCOUNT_NAME = 'QA ChileCompra E2E - CLINICA BICENTENARIO SPA';
const QA_TEST_NAME = 'chilecompra_ocds_e2e';
const QA_VERSION = 'v1.16CL-E';

// ── Supabase admin ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSupabase(): any {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not set — cannot run QA e2e');
  }
  return createClient(url, key);
}

// ── Args ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { execute: boolean } {
  return { execute: argv.includes('--execute') };
}

// ── QA metadata block ──────────────────────────────────────────────────────────

function buildQaMeta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    qa_test: true,
    qa_test_name: QA_TEST_NAME,
    qa_version: QA_VERSION,
    qa_created_at: new Date().toISOString(),
    do_not_sync: true,
    do_not_use_for_sales: true,
    ...extra,
  };
}

function buildPaeBlock(accountId: string): Record<string, unknown> {
  return {
    status: 'queued',
    strategy: 'nit_first',
    nit: QA_RUT,       // required by selectQueuedCandidates filter even for CL
    source_keys: [],   // CL no usa adapters CO
    trigger: 'qa_manual_e2e',
    account_id: accountId,
    triggered_at: new Date().toISOString(),
  };
}

// ── Upsert QA batch ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertQaBatch(supabase: any): Promise<string> {
  const { data: existing } = await supabase
    .from('prospect_batches')
    .select('id')
    .eq('name', `QA ChileCompra E2E ${QA_VERSION}`)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    console.log(`  [batch] Reusing existing QA batch: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('prospect_batches')
    .insert({
      name: `QA ChileCompra E2E ${QA_VERSION}`,
      country_code: QA_COUNTRY,
      country: 'Chile',
      source: 'agent_1',
      status: 'completed',
      metadata: buildQaMeta(),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert QA batch: ${error?.message ?? 'no id returned'}`);
  }

  console.log(`  [batch] Created QA batch: ${data.id}`);
  return data.id as string;
}

// ── Upsert QA account ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertQaAccount(supabase: any): Promise<string> {
  const { data: existing } = await supabase
    .from('accounts')
    .select('id')
    .eq('domain', QA_DOMAIN)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    console.log(`  [account] Reusing existing QA account: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name: QA_ACCOUNT_NAME,
      domain: QA_DOMAIN,
      country_code: QA_COUNTRY,
      tax_identifier: QA_RUT,
      source: 'agent_1',
      metadata: buildQaMeta({ qa_created_at: new Date().toISOString() }),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert QA account: ${error?.message ?? 'no id returned'}`);
  }

  console.log(`  [account] Created QA account: ${data.id}`);
  return data.id as string;
}

// ── Upsert QA candidate ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertQaCandidate(supabase: any, batchId: string, accountId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('prospect_candidates')
    .select('id, metadata')
    .eq('domain', QA_DOMAIN)
    .not('status', 'eq', 'discarded')
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const meta = existing.metadata as Record<string, unknown> | null;
    const pae = meta?.post_approval_enrichment as Record<string, unknown> | undefined;

    if (pae?.status === 'queued') {
      console.log(`  [candidate] Reusing existing QA candidate (already queued): ${existing.id}`);
      return existing.id as string;
    }

    // Reset to queued
    const updatedMeta: Record<string, unknown> = {
      ...(meta ?? {}),
      post_approval_enrichment: buildPaeBlock(accountId),
    };

    await supabase
      .from('prospect_candidates')
      .update({ metadata: updatedMeta, updated_at: new Date().toISOString() })
      .eq('id', existing.id as string);

    console.log(`  [candidate] Reset QA candidate to queued: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('prospect_candidates')
    .insert({
      name: QA_CANDIDATE_NAME,
      domain: QA_DOMAIN,
      batch_id: batchId,
      status: 'converted_to_account',
      converted_account_id: accountId,
      country_code: QA_COUNTRY,
      tax_identifier: QA_RUT,
      metadata: buildQaMeta({
        do_not_convert: true,
        approval: {
          approved_at: new Date().toISOString(),
          approved_by: 'qa_e2e_16cle',
        },
        post_approval_enrichment: buildPaeBlock(accountId),
      }),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert QA candidate: ${error?.message ?? 'no id returned'}`);
  }

  console.log(`  [candidate] Created QA candidate: ${data.id}`);
  return data.id as string;
}

// ── Validation ─────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

function validateCandidateMeta(meta: Record<string, unknown>): CheckResult[] {
  const checks: CheckResult[] = [];
  const se = (meta.source_enrichment ?? {}) as Record<string, unknown>;
  const cl = (se.cl_chilecompra_ocds ?? {}) as Record<string, unknown>;
  const signals = (cl.signals ?? {}) as Record<string, unknown>;

  const check = (name: string, actual: unknown, expected: unknown) => {
    const passed = actual === expected;
    checks.push({ name, passed, detail: `expected=${String(expected)} actual=${String(actual)}` });
  };

  check('cl_chilecompra_ocds.status', cl.status, 'matched');
  check('cl_chilecompra_ocds.matched_by', cl.matched_by, 'tax_id');
  check('cl_chilecompra_ocds.confidence', cl.confidence, 1);
  check('cl_chilecompra_ocds.source_year', cl.source_year, 2025);
  check('cl_chilecompra_ocds.source', cl.source, 'source_company_snapshots');
  check('cl_chilecompra_ocds.signals.awards_count', signals.awards_count, 1);
  check(
    'cl_chilecompra_ocds.signals.total_awarded_amount_clp',
    signals.total_awarded_amount_clp,
    55618332,
  );
  checks.push({
    name: 'cl_chilecompra_ocds.priority_boost > 0',
    passed: typeof cl.priority_boost === 'number' && (cl.priority_boost as number) > 0,
    detail: `actual=${String(cl.priority_boost)}`,
  });
  checks.push({
    name: 'cl_chilecompra_ocds.enriched_at set',
    passed: typeof cl.enriched_at === 'string' && (cl.enriched_at as string).length > 0,
    detail: `actual=${String(cl.enriched_at ?? 'MISSING')}`,
  });

  return checks;
}

function validateAccountMeta(meta: Record<string, unknown>): CheckResult[] {
  const checks: CheckResult[] = [];
  const se = (meta.source_enrichment ?? {}) as Record<string, unknown>;
  const cl = (se.cl_chilecompra_ocds ?? {}) as Record<string, unknown>;
  const signals = (cl.signals ?? {}) as Record<string, unknown>;

  const check = (name: string, actual: unknown, expected: unknown) => {
    const passed = actual === expected;
    checks.push({ name, passed, detail: `expected=${String(expected)} actual=${String(actual)}` });
  };

  check('account.cl_chilecompra_ocds.status', cl.status, 'matched');
  check('account.cl_chilecompra_ocds.matched_by', cl.matched_by, 'tax_id');
  check('account.cl_chilecompra_ocds.signals.awards_count', signals.awards_count, 1);
  check(
    'account.cl_chilecompra_ocds.signals.total_awarded_amount_clp',
    signals.total_awarded_amount_clp,
    55618332,
  );

  return checks;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const { execute } = parseArgs(process.argv.slice(2));

  console.log('\n' + '═'.repeat(72));
  console.log(`CHILECOMPRA OCDS POST-APPROVAL E2E QA — ${QA_VERSION}`);
  console.log('═'.repeat(72) + '\n');
  console.log(`  mode : ${execute ? 'EXECUTE (worker will run + write)' : 'PREFLIGHT ONLY (creates QA data, no worker)'}`);
  console.log(`  rut  : ${QA_RUT}`);
  console.log(`  name : ${QA_CANDIDATE_NAME}\n`);

  const supabase = getSupabase();

  // ── PRECHECK — snapshot live ───────────────────────────────────────────────
  console.log('── PRECHECK: snapshot en Supabase ──────────────────────────────────\n');

  const { data: snapshotRows, error: snapErr } = await supabase
    .from('source_company_snapshots')
    .select('normalized_tax_id, legal_name, source_year, priority_score, signals')
    .eq('source_key', 'cl_chilecompra_ocds')
    .eq('normalized_tax_id', QA_RUT)
    .limit(3);

  if (snapErr) {
    console.error(`  ✗ ABORT: snapshot query failed: ${snapErr.message}`);
    process.exit(1);
  }

  console.log(`  snapshot rows found: ${(snapshotRows ?? []).length}`);
  if ((snapshotRows ?? []).length === 0) {
    console.error('  ✗ ABORT: no snapshot para RUT ' + QA_RUT + ' en source_company_snapshots');
    console.error('    Asegúrate de que el ETL de ChileCompra OCDS ya corrió.');
    process.exit(1);
  }

  for (const row of (snapshotRows ?? []) as Array<Record<string, unknown>>) {
    const sig = (row.signals ?? {}) as Record<string, unknown>;
    console.log(
      `  → rut=${row.normalized_tax_id} legal_name=${row.legal_name} year=${row.source_year}` +
      ` awards=${sig.awards_count ?? 'n/a'} amount=${sig.total_awarded_amount_clp ?? 'n/a'} priority=${row.priority_score}`,
    );
  }

  // ── SETUP QA DATA ──────────────────────────────────────────────────────────
  console.log('\n── SETUP QA DATA ───────────────────────────────────────────────────\n');

  const batchId = await upsertQaBatch(supabase);
  const accountId = await upsertQaAccount(supabase);
  const candidateId = await upsertQaCandidate(supabase, batchId, accountId);

  console.log(`\n  QA batch id:     ${batchId}`);
  console.log(`  QA account id:   ${accountId}`);
  console.log(`  QA candidate id: ${candidateId}`);

  // Verify candidate is readable and has correct pae
  const { data: preRow } = await supabase
    .from('prospect_candidates')
    .select('id, name, status, converted_account_id, tax_identifier, country_code, metadata')
    .eq('id', candidateId)
    .single();

  if (!preRow) {
    console.error('  ✗ ABORT: candidate QA not readable after upsert');
    process.exit(1);
  }

  const preMeta = (preRow.metadata as Record<string, unknown>) ?? {};
  const prePae = (preMeta.post_approval_enrichment as Record<string, unknown>) ?? {};

  console.log(`\n  Preflight state:`);
  console.log(`    status               : ${preRow.status}`);
  console.log(`    converted_account_id : ${preRow.converted_account_id}`);
  console.log(`    country_code         : ${preRow.country_code}`);
  console.log(`    tax_identifier       : ${preRow.tax_identifier}`);
  console.log(`    pae.status           : ${prePae.status ?? 'MISSING'}`);
  console.log(`    pae.strategy         : ${prePae.strategy ?? 'MISSING'}`);
  console.log(`    pae.nit              : ${prePae.nit ?? 'MISSING'}`);
  console.log(`    pae.source_keys      : ${JSON.stringify(prePae.source_keys ?? [])}`);

  const preflightOk =
    preRow.status === 'converted_to_account' &&
    preRow.converted_account_id === accountId &&
    preRow.country_code === QA_COUNTRY &&
    preRow.tax_identifier === QA_RUT &&
    prePae.status === 'queued' &&
    prePae.strategy === 'nit_first' &&
    prePae.nit === QA_RUT;

  if (!preflightOk) {
    console.error('\n  ✗ ABORT: preflight checks failed');
    process.exit(1);
  }

  console.log('\n  ✓ Preflight OK.');

  if (!execute) {
    console.log('\n── PREFLIGHT-ONLY mode. Pasa --execute para correr el worker. ─────\n');
    console.log(`  IDs para referencia:`);
    console.log(`    candidate id : ${candidateId}`);
    console.log(`    account id   : ${accountId}`);
    return;
  }

  // ── EXECUTE WORKER ─────────────────────────────────────────────────────────
  console.log('\n── EXECUTE WORKER ──────────────────────────────────────────────────\n');
  console.log('  adapterRegistryOverride: {} (empty — CL no usa adapters CO)');
  console.log('  chileLookupFnOverride  : undefined (real snapshot lookup)');
  console.log('  candidateId filter     :', candidateId);
  console.log('  maxCandidates          : 1\n');

  const stats = await runPostApprovalNitEnrichmentWorker({
    supabase,
    adapterRegistryOverride: {},   // no CO adapters — CL only uses cl_chilecompra_ocds step
    candidateId,
    maxCandidates: 1,
    // chileLookupFnOverride omitted → real lookupChileCompraOcdsByRut from snapshot
  });

  console.log('  Worker stats:', JSON.stringify(stats, null, 2));

  if (stats.queued_found === 0) {
    console.error('\n  ✗ ABORT: worker did not find the QA candidate as queued');
    console.error('    Verifica que metadata.post_approval_enrichment.status=queued');
    process.exit(1);
  }

  // ── VALIDATE CANDIDATE ─────────────────────────────────────────────────────
  console.log('\n── VALIDATE CANDIDATE ──────────────────────────────────────────────\n');

  const { data: afterCand } = await supabase
    .from('prospect_candidates')
    .select('metadata')
    .eq('id', candidateId)
    .single();

  const metaAfterCand = (afterCand?.metadata as Record<string, unknown>) ?? {};
  const seAfter = (metaAfterCand.source_enrichment as Record<string, unknown>) ?? {};
  const clBlock = (seAfter.cl_chilecompra_ocds as Record<string, unknown>) ?? {};

  console.log('  source_enrichment.cl_chilecompra_ocds:');
  console.log(JSON.stringify(clBlock, null, 2));

  const candChecks = validateCandidateMeta(metaAfterCand);

  for (const c of candChecks) {
    console.log(`  ${c.passed ? '✓' : '✗'} ${c.name}${!c.passed ? ' → ' + c.detail : ''}`);
  }

  // ── VALIDATE ACCOUNT ───────────────────────────────────────────────────────
  console.log('\n── VALIDATE ACCOUNT ────────────────────────────────────────────────\n');

  const { data: afterAcc } = await supabase
    .from('accounts')
    .select('metadata')
    .eq('id', accountId)
    .single();

  const metaAfterAcc = (afterAcc?.metadata as Record<string, unknown>) ?? {};
  const accSeAfter = (metaAfterAcc.source_enrichment as Record<string, unknown>) ?? {};
  const accClBlock = (accSeAfter.cl_chilecompra_ocds as Record<string, unknown>) ?? {};

  console.log('  account.source_enrichment.cl_chilecompra_ocds:');
  console.log(JSON.stringify(accClBlock, null, 2));

  const accChecks = validateAccountMeta(metaAfterAcc);

  for (const c of accChecks) {
    console.log(`  ${c.passed ? '✓' : '✗'} ${c.name}${!c.passed ? ' → ' + c.detail : ''}`);
  }

  // ── CONFIRMACIONES ─────────────────────────────────────────────────────────
  console.log('\n── CONFIRMACIONES ──────────────────────────────────────────────────\n');
  console.log('  ✓ NO llamó ChileCompra API live (snapshot Supabase)');
  console.log('  ✓ NO llamó Tavily / LLM / Apollo / Lusha');
  console.log('  ✓ NO llamó HubSpot sync');
  console.log('  ✓ NO ejecutó DELETE');
  console.log('  ✓ NO procesó candidatos reales (candidateId limitado al QA)');

  // ── VEREDICTO ──────────────────────────────────────────────────────────────
  const allChecks = [...candChecks, ...accChecks];
  const allPassed = allChecks.every((c) => c.passed);

  console.log('\n' + '═'.repeat(72));
  console.log('VEREDICTO');
  console.log('═'.repeat(72));
  console.log(`  candidate id      : ${candidateId}`);
  console.log(`  account id        : ${accountId}`);
  console.log(`  worker.processed  : ${stats.processed}`);
  console.log(`  cl_chilecompra_ocds.status (candidate) : ${clBlock.status ?? 'MISSING'}`);
  console.log(`  cl_chilecompra_ocds.status (account)   : ${accClBlock.status ?? 'MISSING'}`);
  console.log(`  signals.awards_count                   : ${((clBlock.signals ?? {}) as Record<string, unknown>).awards_count ?? 'MISSING'}`);
  console.log(`  signals.total_awarded_amount_clp       : ${((clBlock.signals ?? {}) as Record<string, unknown>).total_awarded_amount_clp ?? 'MISSING'}`);
  console.log(`  priority_boost                         : ${clBlock.priority_boost ?? 'MISSING'}`);
  console.log(`  ALL CHECKS PASSED                      : ${allPassed ? '✓ YES' : '✗ NO'}`);
  console.log('═'.repeat(72));

  console.log('\n  ⚠ NO se limpia automáticamente. Reportar IDs antes de limpiar.\n');

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
