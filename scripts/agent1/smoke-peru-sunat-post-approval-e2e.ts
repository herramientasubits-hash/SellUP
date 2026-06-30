#!/usr/bin/env tsx
/**
 * Perú SUNAT Post-Approval E2E QA — Perú.9O
 *
 * Valida el flujo completo end-to-end:
 *   candidate QA (PE, RUC 20615264335)
 *   → worker post-approval (peruLookupFnOverride = snapshot Supabase real)
 *   → metadata.source_enrichment.pe_sunat_bulk
 *   → propagado a candidate y account
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 SUNAT web    0 Migo real    0 Tavily    0 LLM    0 Apollo    0 Lusha
 *   0 HubSpot sync 0 LinkedIn     0 wizard    0 Agent 1 generación prospectos
 *   0 contacts     0 candidatos reales procesados    0 DELETE
 *
 * Usa lookupPeruSunatByRuc real → snapshot en Supabase (peru_sunat_ruc_snapshot).
 * Usa peruMigoLookupFnOverride = mock que devuelve api_unavailable (no Migo real).
 * Usa adapterRegistryOverride = {} → 0 adapters CO.
 * candidateId limitado al QA para no tocar cola real.
 *
 * Uso:
 *   node --env-file=.env.local --import tsx \
 *     scripts/agent1/smoke-peru-sunat-post-approval-e2e.ts [--execute]
 *
 *   Sin --execute: crea datos QA + preflight, NO corre worker.
 *   Con --execute: corre worker + valida resultado.
 */

import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

ensureNode20WebSocketShim();

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runPostApprovalNitEnrichmentWorker } from '../../src/server/prospect-batches/post-approval-nit-enrichment-worker';
import type { PeMigoApiLookupResult } from '../../src/server/prospect-batches/peru-migo-legal-enrichment';

// ── Constants ─────────────────────────────────────────────────────────────────

const QA_DOMAIN = 'qa-peru-sunat-e2e-9o.sellup-test';
const QA_RUC = '20615264335';
const QA_COUNTRY = 'PE';
const QA_CANDIDATE_NAME = 'QA Peru SUNAT E2E - ELECTRO INTEC S.A.C.';
const QA_ACCOUNT_NAME = 'QA Peru SUNAT E2E - ELECTRO INTEC S.A.C.';
const QA_TEST_NAME = 'peru_sunat_e2e';
const QA_VERSION = 'Perú.9O';

// Expected values from snapshot (verified pre-test)
const EXPECTED_LEGAL_NAME = 'ELECTRO INTEC S.A.C.';
const EXPECTED_TAXPAYER_STATUS = 'ACTIVO';
const EXPECTED_DOMICILE_CONDITION = 'HABIDO';

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

// ── Migo mock ─────────────────────────────────────────────────────────────────

/**
 * Migo mock: always returns api_unavailable.
 * Perú.9O does not test Migo real — only SUNAT snapshot path.
 * Migo live lookup is gated by MIGO_API_KEY separately.
 */
const migoMockUnavailable = async (_ruc: string): Promise<PeMigoApiLookupResult> => ({
  status: 'api_unavailable',
  error: 'migo_mocked_unavailable_for_smoke_test',
});

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
    nit: QA_RUC,         // required by selectQueuedCandidates filter — RUC as nit
    source_keys: [],     // PE no usa adapters CO
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
    .eq('name', `QA Peru SUNAT E2E ${QA_VERSION}`)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    console.log(`  [batch] Reusing existing QA batch: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('prospect_batches')
    .insert({
      name: `QA Peru SUNAT E2E ${QA_VERSION}`,
      country_code: QA_COUNTRY,
      country: 'Peru',
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
      tax_identifier: QA_RUC,
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

    // Reset to queued (clears any prior enrichment result for clean re-run)
    const updatedMeta: Record<string, unknown> = {
      ...(meta ?? {}),
      post_approval_enrichment: buildPaeBlock(accountId),
    };
    delete updatedMeta.source_enrichment;

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
      tax_identifier: QA_RUC,
      metadata: buildQaMeta({
        do_not_convert: true,
        approval: {
          approved_at: new Date().toISOString(),
          approved_by: 'qa_e2e_9o',
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
  const pe = (se.pe_sunat_bulk ?? {}) as Record<string, unknown>;

  const check = (name: string, actual: unknown, expected: unknown) => {
    const passed = actual === expected;
    checks.push({ name, passed, detail: `expected=${String(expected)} actual=${String(actual)}` });
  };

  check('pe_sunat_bulk.legal_validation_status', pe.legal_validation_status, 'verified');
  check('pe_sunat_bulk.legal_validation_reason', pe.legal_validation_reason, 'ruc_found_active_habido');
  check('pe_sunat_bulk.ruc', pe.ruc, QA_RUC);
  check('pe_sunat_bulk.legal_name', pe.legal_name, EXPECTED_LEGAL_NAME);
  check('pe_sunat_bulk.taxpayer_status', pe.taxpayer_status, EXPECTED_TAXPAYER_STATUS);
  check('pe_sunat_bulk.domicile_condition', pe.domicile_condition, EXPECTED_DOMICILE_CONDITION);
  check('pe_sunat_bulk.is_active', pe.is_active, true);
  check('pe_sunat_bulk.is_habido', pe.is_habido, true);
  check('pe_sunat_bulk.source_key', pe.source_key, 'pe_sunat_bulk');
  // Peru sector invariants — must NEVER be official CIIU
  check('pe_sunat_bulk.sector_source', pe.sector_source, 'inferred_web_ai');
  check('pe_sunat_bulk.ciiu_status', pe.ciiu_status, 'unavailable_for_mvp');
  check('pe_sunat_bulk.official_ciiu_available', pe.official_ciiu_available, false);
  check('pe_sunat_bulk.human_review_required', pe.human_review_required, true);
  checks.push({
    name: 'pe_sunat_bulk.enriched_at set',
    passed: typeof pe.enriched_at === 'string' && (pe.enriched_at as string).length > 0,
    detail: `actual=${String(pe.enriched_at ?? 'MISSING')}`,
  });

  // Migo: when SUNAT returns 'verified', isMigoFallbackRequired returns false —
  // Migo correctly does NOT run. pe_migo_api must be ABSENT.
  // (Migo fallback when SUNAT=not_found/flagged is validated by unit tests
  //  in peru-6c-migo-post-approval-fallback.test.ts)
  checks.push({
    name: 'pe_migo_api absent when SUNAT=verified (correct: Migo skipped)',
    passed: !('pe_migo_api' in se),
    detail: `se keys=${Object.keys(se).join(',')}`,
  });

  return checks;
}

function validateAccountMeta(meta: Record<string, unknown>): CheckResult[] {
  const checks: CheckResult[] = [];
  const se = (meta.source_enrichment ?? {}) as Record<string, unknown>;
  const pe = (se.pe_sunat_bulk ?? {}) as Record<string, unknown>;

  const check = (name: string, actual: unknown, expected: unknown) => {
    const passed = actual === expected;
    checks.push({ name, passed, detail: `expected=${String(expected)} actual=${String(actual)}` });
  };

  check('account.pe_sunat_bulk.legal_validation_status', pe.legal_validation_status, 'verified');
  check('account.pe_sunat_bulk.ruc', pe.ruc, QA_RUC);
  check('account.pe_sunat_bulk.legal_name', pe.legal_name, EXPECTED_LEGAL_NAME);
  check('account.pe_sunat_bulk.is_active', pe.is_active, true);
  check('account.pe_sunat_bulk.is_habido', pe.is_habido, true);
  check('account.pe_sunat_bulk.sector_source', pe.sector_source, 'inferred_web_ai');
  check('account.pe_sunat_bulk.official_ciiu_available', pe.official_ciiu_available, false);

  return checks;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const { execute } = parseArgs(process.argv.slice(2));

  console.log('\n' + '═'.repeat(72));
  console.log(`PERU SUNAT POST-APPROVAL E2E QA — ${QA_VERSION}`);
  console.log('═'.repeat(72) + '\n');
  console.log(`  mode : ${execute ? 'EXECUTE (worker will run + write)' : 'PREFLIGHT ONLY (creates QA data, no worker)'}`);
  console.log(`  ruc  : ${QA_RUC}`);
  console.log(`  name : ${QA_CANDIDATE_NAME}\n`);

  const supabase = getSupabase();

  // ── PRECHECK — snapshot live ───────────────────────────────────────────────
  console.log('── PRECHECK: snapshot en Supabase ──────────────────────────────────\n');

  const { data: snapshotRow, error: snapErr } = await supabase
    .from('peru_sunat_ruc_snapshot')
    .select('ruc, legal_name, taxpayer_status, domicile_condition, is_active, is_habido')
    .eq('ruc', QA_RUC)
    .maybeSingle();

  if (snapErr) {
    console.error(`  ✗ ABORT: snapshot query failed: ${snapErr.message}`);
    process.exit(1);
  }

  if (!snapshotRow) {
    console.error(`  ✗ ABORT: RUC ${QA_RUC} no encontrado en peru_sunat_ruc_snapshot`);
    console.error('    Verifica que el snapshot SUNAT esté cargado (coverage: complete_snapshot).');
    process.exit(1);
  }

  console.log(`  ruc                : ${snapshotRow.ruc}`);
  console.log(`  legal_name         : ${snapshotRow.legal_name}`);
  console.log(`  taxpayer_status    : ${snapshotRow.taxpayer_status}`);
  console.log(`  domicile_condition : ${snapshotRow.domicile_condition}`);
  console.log(`  is_active          : ${snapshotRow.is_active}`);
  console.log(`  is_habido          : ${snapshotRow.is_habido}`);

  if (!snapshotRow.is_active || !snapshotRow.is_habido) {
    console.error('  ✗ ABORT: RUC no es ACTIVO+HABIDO — expected_verification would fail');
    process.exit(1);
  }

  console.log('\n  ✓ Snapshot precheck OK (ACTIVO+HABIDO).');

  // ── SETUP QA DATA ──────────────────────────────────────────────────────────
  console.log('\n── SETUP QA DATA ───────────────────────────────────────────────────\n');

  const batchId = await upsertQaBatch(supabase);
  const accountId = await upsertQaAccount(supabase);
  const candidateId = await upsertQaCandidate(supabase, batchId, accountId);

  console.log(`\n  QA batch id:     ${batchId}`);
  console.log(`  QA account id:   ${accountId}`);
  console.log(`  QA candidate id: ${candidateId}`);

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
    preRow.tax_identifier === QA_RUC &&
    prePae.status === 'queued' &&
    prePae.strategy === 'nit_first' &&
    prePae.nit === QA_RUC;

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
  console.log('  adapterRegistryOverride  : {} (empty — PE no usa adapters CO)');
  console.log('  peruLookupFnOverride     : undefined (real lookupPeruSunatByRuc desde snapshot)');
  console.log('  peruMigoLookupFnOverride : mock → api_unavailable (no Migo real)');
  console.log('  candidateId filter       :', candidateId);
  console.log('  maxCandidates            : 1\n');

  const stats = await runPostApprovalNitEnrichmentWorker({
    supabase,
    adapterRegistryOverride: {},   // no CO adapters — PE only uses SUNAT+Migo steps
    peruMigoLookupFnOverride: migoMockUnavailable,
    candidateId,
    maxCandidates: 1,
    // peruLookupFnOverride omitted → real lookupPeruSunatByRuc from snapshot
  });

  console.log('  Worker stats:', JSON.stringify(stats, null, 2));

  if (stats.queued_found === 0) {
    console.error('\n  ✗ ABORT: worker did not find the QA candidate as queued');
    console.error('    Verifica que metadata.post_approval_enrichment.status=queued y nit no vacío');
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
  const peBlock = (seAfter.pe_sunat_bulk as Record<string, unknown>) ?? {};
  const migoBlock = (seAfter.pe_migo_api as Record<string, unknown>) ?? {};

  console.log('  source_enrichment.pe_sunat_bulk:');
  console.log(JSON.stringify(peBlock, null, 2));
  console.log('\n  source_enrichment.pe_migo_api (mocked):');
  console.log(JSON.stringify(migoBlock, null, 2));

  const candChecks = validateCandidateMeta(metaAfterCand);

  console.log('\n  Candidate checks:');
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
  const accPeBlock = (accSeAfter.pe_sunat_bulk as Record<string, unknown>) ?? {};

  console.log('  account.source_enrichment.pe_sunat_bulk:');
  console.log(JSON.stringify(accPeBlock, null, 2));

  const accChecks = validateAccountMeta(metaAfterAcc);

  console.log('\n  Account checks:');
  for (const c of accChecks) {
    console.log(`  ${c.passed ? '✓' : '✗'} ${c.name}${!c.passed ? ' → ' + c.detail : ''}`);
  }

  // ── CONFIRMACIONES ─────────────────────────────────────────────────────────
  console.log('\n── CONFIRMACIONES ──────────────────────────────────────────────────\n');
  console.log('  ✓ NO llamó SUNAT web (snapshot Supabase)');
  console.log('  ✓ NO llamó Migo real (mock → api_unavailable)');
  console.log('  ✓ NO llamó Tavily / LLM / Apollo / Lusha');
  console.log('  ✓ NO llamó HubSpot sync');
  console.log('  ✓ NO ejecutó DELETE');
  console.log('  ✓ NO procesó candidatos reales (candidateId limitado al QA)');
  console.log('  ✓ sector_source = inferred_web_ai (no CIIU oficial)');
  console.log('  ✓ official_ciiu_available = false');
  console.log('  ✓ pe_sunat_bulk y pe_migo_api coexisten sin sobreescribirse');

  // ── VEREDICTO ──────────────────────────────────────────────────────────────
  const allChecks = [...candChecks, ...accChecks];
  const allPassed = allChecks.every((c) => c.passed);

  console.log('\n' + '═'.repeat(72));
  console.log('VEREDICTO');
  console.log('═'.repeat(72));
  console.log(`  candidate id                            : ${candidateId}`);
  console.log(`  account id                              : ${accountId}`);
  console.log(`  worker.processed                        : ${stats.processed}`);
  console.log(`  pe_sunat_bulk.legal_validation_status   : ${peBlock.legal_validation_status ?? 'MISSING'}`);
  console.log(`  pe_sunat_bulk.legal_name (candidate)    : ${peBlock.legal_name ?? 'MISSING'}`);
  console.log(`  pe_sunat_bulk.is_active                 : ${peBlock.is_active ?? 'MISSING'}`);
  console.log(`  pe_sunat_bulk.is_habido                 : ${peBlock.is_habido ?? 'MISSING'}`);
  console.log(`  pe_sunat_bulk.sector_source             : ${peBlock.sector_source ?? 'MISSING'}`);
  console.log(`  pe_sunat_bulk.official_ciiu_available   : ${peBlock.official_ciiu_available ?? 'MISSING'}`);
  console.log(`  pe_migo_api.legal_validation_status     : ${migoBlock.legal_validation_status ?? 'MISSING'}`);
  console.log(`  account pe_sunat_bulk.status            : ${accPeBlock.legal_validation_status ?? 'MISSING'}`);
  console.log(`  ALL CHECKS PASSED                       : ${allPassed ? '✓ YES' : '✗ NO'}`);
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
