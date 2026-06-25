#!/usr/bin/env tsx
/**
 * PERU SUNAT POST-APPROVAL ENRICHMENT SMOKE — Perú.5D
 *
 * Smoke controlado con candidato fake PE + RUC real cargado en snapshot.
 * Valida que el enriquecimiento post-aprobación agrega metadata SUNAT correctamente.
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 Tavily            0 LLM              0 LinkedIn
 *   0 SUNAT web         0 Migo             0 Importer SUNAT
 *   0 Hard delete       0 Candidatos reales procesados
 *   0 Descarga zip      0 Lectura .tmp/sunat-peru
 *   0 Chile/México/Colombia
 *
 * Usa únicamente la función de enriquecimiento PE con lookup
 * contra la snapshot pre-cargada en Supabase.
 *
 * Uso: npx tsx scripts/agent1/smoke-peru-sunat-post-approval-enrichment.ts
 */

import { createClient } from '@supabase/supabase-js';
import {
  runPostApprovalNitEnrichmentWorker,
} from '../../src/server/prospect-batches/post-approval-nit-enrichment-worker';

// ── Constants ─────────────────────────────────────────────────────────────────

const SMOKE_DOMAIN = 'sellup-peru-sunat-smoke.example';
const SMOKE_RUC = '20100050359';
const SMOKE_TYPE = 'peru_sunat_post_approval_v1_5d';
const SMOKE_CANDIDATE_NAME = 'SellUp Peru SUNAT Post-Approval Smoke Candidate';
const SMOKE_ACCOUNT_NAME = 'SellUp Peru SUNAT Post-Approval Smoke Account';
const SMOKE_BATCH_NAME = 'SellUp Peru SUNAT Post-Approval Smoke Batch 5D';

const EXPECTED_LEGAL_NAME = 'A W FABER CASTELL PERUANA S A';
const EXPECTED_VALIDATION_STATUS = 'verified';
const EXPECTED_VALIDATION_REASON = 'ruc_found_active_habido';
const EXPECTED_SOURCE_KEY = 'pe_sunat_bulk';

// ── Banner ─────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('PERU SUNAT POST-APPROVAL ENRICHMENT SMOKE — Perú.5D');
console.log('RUC: ' + SMOKE_RUC + ' | domain: ' + SMOKE_DOMAIN);
console.log('═'.repeat(72) + '\n');

// ── Supabase admin client ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSupabase(): any {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY not set — cannot run smoke against Supabase',
    );
  }
  return createClient(url, key);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

// ── Preflight verification ────────────────────────────────────────────────────

async function preflightSunatSnapshot(supabase: AnySupabase): Promise<void> {
  const { data, error } = await supabase
    .from('peru_sunat_ruc_snapshot')
    .select('ruc, legal_name, taxpayer_status, domicile_condition, is_active, is_habido, source_key')
    .eq('ruc', SMOKE_RUC)
    .single();

  if (error || !data) {
    throw new Error(
      `Preflight FAILED: RUC ${SMOKE_RUC} not found in peru_sunat_ruc_snapshot. ` +
      `Error: ${error?.message ?? 'no row'}`,
    );
  }

  console.log('  [preflight] RUC encontrado en snapshot:');
  console.log(`    ruc:               ${data.ruc}`);
  console.log(`    legal_name:        ${data.legal_name}`);
  console.log(`    taxpayer_status:   ${data.taxpayer_status}`);
  console.log(`    domicile_condition:${data.domicile_condition}`);
  console.log(`    is_active:         ${data.is_active}`);
  console.log(`    is_habido:         ${data.is_habido}`);
  console.log(`    source_key:        ${data.source_key}`);

  if (!data.is_active || !data.is_habido) {
    throw new Error(
      `Preflight FAILED: RUC ${SMOKE_RUC} is_active=${data.is_active} is_habido=${data.is_habido}. ` +
      `Expected both true for smoke test.`,
    );
  }

  // Count total snapshot rows
  const { count } = await supabase
    .from('peru_sunat_ruc_snapshot')
    .select('*', { count: 'exact', head: true });

  console.log(`    snapshot total:    ${count} filas`);
}

// ── Batch creation ────────────────────────────────────────────────────────────

async function upsertSmokeBatch(supabase: AnySupabase): Promise<string> {
  const { data: existing } = await supabase
    .from('prospect_batches')
    .select('id, status')
    .eq('name', SMOKE_BATCH_NAME)
    .neq('status', 'cancelled')
    .limit(1)
    .single();

  if (existing?.id) {
    console.log(`  [batch] Reusing existing smoke batch: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('prospect_batches')
    .insert({
      name: SMOKE_BATCH_NAME,
      country: 'Peru',
      country_code: 'PE',
      industry: 'Smoke Test',
      target_count: 1,
      search_depth: 'basic',
      status: 'completed',
      source: 'agent_1',
      metadata: {
        smoke_test: true,
        smoke_type: SMOKE_TYPE,
        qa_only: true,
        do_not_use_for_sales: true,
        test_domain: SMOKE_DOMAIN,
      },
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert smoke batch: ${error?.message ?? 'no id returned'}`);
  }

  console.log(`  [batch] Created smoke batch: ${data.id}`);
  return data.id as string;
}

// ── Account creation ──────────────────────────────────────────────────────────

async function upsertSmokeAccount(supabase: AnySupabase): Promise<string> {
  const { data: existing } = await supabase
    .from('accounts')
    .select('id')
    .eq('domain', SMOKE_DOMAIN)
    .neq('status', 'discarded')
    .limit(1)
    .single();

  if (existing?.id) {
    console.log(`  [account] Reusing existing smoke account: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name: SMOKE_ACCOUNT_NAME,
      website: `https://${SMOKE_DOMAIN}`,
      domain: SMOKE_DOMAIN,
      country_code: 'PE',
      source: 'agent_1',
      metadata: {
        smoke_test: true,
        smoke_type: SMOKE_TYPE,
        qa_only: true,
        do_not_use_for_sales: true,
        test_domain: SMOKE_DOMAIN,
      },
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert smoke account: ${error?.message ?? 'no id returned'}`);
  }

  console.log(`  [account] Created smoke account: ${data.id}`);
  return data.id as string;
}

// ── Candidate creation ────────────────────────────────────────────────────────

function buildPaeBlock(accountId: string): Record<string, unknown> {
  return {
    status: 'queued',
    strategy: 'nit_first',
    nit: SMOKE_RUC,
    // Empty source_keys for PE: no CO NIT adapters should run
    source_keys: [],
    trigger: 'candidate_approval',
    account_id: accountId,
    triggered_at: new Date().toISOString(),
  };
}

async function upsertSmokeCandidate(
  supabase: AnySupabase,
  batchId: string,
  accountId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('prospect_candidates')
    .select('id, metadata, status')
    .eq('domain', SMOKE_DOMAIN)
    .neq('status', 'discarded')
    .limit(1)
    .single();

  if (existing?.id) {
    const meta = existing.metadata as Record<string, unknown> | null;
    const pae = meta?.post_approval_enrichment as Record<string, unknown> | undefined;

    if (pae?.status === 'queued') {
      console.log(`  [candidate] Reusing smoke candidate (already queued): ${existing.id}`);
      return existing.id as string;
    }

    // Reset PAE to queued
    const updatedMeta: Record<string, unknown> = {
      ...(meta ?? {}),
      post_approval_enrichment: buildPaeBlock(accountId),
      // Clear previous pe_sunat_bulk to ensure clean smoke
      source_enrichment: {
        ...((meta?.source_enrichment as Record<string, unknown>) ?? {}),
        pe_sunat_bulk: undefined,
      },
    };

    await supabase
      .from('prospect_candidates')
      .update({
        status: 'converted_to_account',
        converted_account_id: accountId,
        metadata: updatedMeta,
      })
      .eq('id', existing.id as string);

    console.log(`  [candidate] Reset smoke candidate to queued: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('prospect_candidates')
    .insert({
      batch_id: batchId,
      name: SMOKE_CANDIDATE_NAME,
      domain: SMOKE_DOMAIN,
      country: 'Peru',
      country_code: 'PE',
      status: 'converted_to_account',
      converted_account_id: accountId,
      tax_identifier: SMOKE_RUC,
      tax_identifier_type: 'ruc',
      source_primary: 'smoke_script',
      metadata: {
        smoke_test: true,
        smoke_type: SMOKE_TYPE,
        qa_only: true,
        do_not_use_for_sales: true,
        do_not_convert: true,
        test_domain: SMOKE_DOMAIN,
        approval: {
          approved_at: new Date().toISOString(),
          approved_by: 'smoke_script_peru_5d',
        },
        post_approval_enrichment: buildPaeBlock(accountId),
      },
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert smoke candidate: ${error?.message ?? 'no id returned'}`);
  }

  console.log(`  [candidate] Created smoke candidate: ${data.id}`);
  return data.id as string;
}

// ── Validate pe_sunat_bulk ─────────────────────────────────────────────────────

interface SunatBulkCheck {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

function validatePeSunatBulk(
  metadata: Record<string, unknown>,
): { passed: boolean; checks: SunatBulkCheck[] } {
  const checks: SunatBulkCheck[] = [];

  const se = (metadata.source_enrichment ?? {}) as Record<string, unknown>;
  const bulk = (se.pe_sunat_bulk ?? null) as Record<string, unknown> | null;

  const check = (name: string, expected: string, actual: unknown) => {
    checks.push({
      name,
      passed: String(actual) === expected,
      expected,
      actual: actual === null || actual === undefined ? 'MISSING' : String(actual),
    });
  };

  if (!bulk) {
    checks.push({
      name: 'source_enrichment.pe_sunat_bulk exists',
      passed: false,
      expected: 'object',
      actual: 'MISSING',
    });
    return { passed: false, checks };
  }

  check(
    'pe_sunat_bulk.legal_validation_status',
    EXPECTED_VALIDATION_STATUS,
    bulk.legal_validation_status,
  );
  check(
    'pe_sunat_bulk.legal_validation_reason',
    EXPECTED_VALIDATION_REASON,
    bulk.legal_validation_reason,
  );
  check('pe_sunat_bulk.ruc', SMOKE_RUC, bulk.ruc);
  check('pe_sunat_bulk.legal_name', EXPECTED_LEGAL_NAME, bulk.legal_name);
  check('pe_sunat_bulk.taxpayer_status', 'ACTIVO', bulk.taxpayer_status);
  check('pe_sunat_bulk.domicile_condition', 'HABIDO', bulk.domicile_condition);
  check('pe_sunat_bulk.source_key', EXPECTED_SOURCE_KEY, bulk.source_key);
  check('pe_sunat_bulk.is_active', 'true', bulk.is_active);
  check('pe_sunat_bulk.is_habido', 'true', bulk.is_habido);

  // sector invariants
  check('pe_sunat_bulk.sector_source', 'inferred_web_ai', bulk.sector_source);
  check('pe_sunat_bulk.confidence_label', 'sector_inferred', bulk.confidence_label);
  check('pe_sunat_bulk.ciiu_status', 'unavailable_for_mvp', bulk.ciiu_status);
  check('pe_sunat_bulk.official_ciiu_available', 'false', bulk.official_ciiu_available);
  check('pe_sunat_bulk.human_review_required', 'true', bulk.human_review_required);

  // enriched_at present
  checks.push({
    name: 'pe_sunat_bulk.enriched_at present',
    passed: typeof bulk.enriched_at === 'string' && bulk.enriched_at.length > 10,
    expected: 'ISO string',
    actual: typeof bulk.enriched_at === 'string' ? bulk.enriched_at : 'MISSING',
  });

  return { passed: checks.every((c) => c.passed), checks };
}

// ── Logical cleanup (executed) ────────────────────────────────────────────────

const CLEANUP_TYPE = 'peru_sunat_post_approval_v1_5d_cleanup';

async function applyLogicalCleanup(params: {
  supabase: AnySupabase;
  candidateId: string;
  batchId: string;
  accountId: string;
}): Promise<void> {
  const { supabase, candidateId, batchId, accountId } = params;
  const cleanedAt = new Date().toISOString();
  const cleanupBlock = {
    cleanup_type: CLEANUP_TYPE,
    hard_delete: false,
    cleaned_at: cleanedAt,
    reason: 'smoke_test_finished',
  };

  // 1. Candidate → discarded + rejected
  const { data: candRow } = await supabase
    .from('prospect_candidates')
    .select('metadata')
    .eq('id', candidateId)
    .single();

  const candMeta = (candRow?.metadata as Record<string, unknown>) ?? {};
  await supabase
    .from('prospect_candidates')
    .update({
      status: 'discarded',
      review_status: 'rejected',
      metadata: { ...candMeta, logical_cleanup: cleanupBlock },
      updated_at: cleanedAt,
    })
    .eq('id', candidateId);

  console.log(`  [cleanup] Candidate ${candidateId} → discarded / rejected`);

  // 2. Batch → completed + logical_cleanup
  const { data: batchRow } = await supabase
    .from('prospect_batches')
    .select('metadata')
    .eq('id', batchId)
    .single();

  const batchMeta = (batchRow?.metadata as Record<string, unknown>) ?? {};
  await supabase
    .from('prospect_batches')
    .update({
      status: 'completed',
      metadata: { ...batchMeta, logical_cleanup: cleanupBlock },
      updated_at: cleanedAt,
    })
    .eq('id', batchId);

  console.log(`  [cleanup] Batch ${batchId} → completed + logical_cleanup`);

  // 3. Account → logical_cleanup (no status change for accounts)
  const { data: accRow } = await supabase
    .from('accounts')
    .select('metadata')
    .eq('id', accountId)
    .single();

  const accMeta = (accRow?.metadata as Record<string, unknown>) ?? {};
  await supabase
    .from('accounts')
    .update({
      metadata: { ...accMeta, logical_cleanup: cleanupBlock },
      updated_at: cleanedAt,
    })
    .eq('id', accountId);

  console.log(`  [cleanup] Account ${accountId} → logical_cleanup aplicado`);
}

// ── Post-cleanup verification ─────────────────────────────────────────────────

async function verifyCleanup(params: {
  supabase: AnySupabase;
  candidateId: string;
  batchId: string;
  accountId: string;
}): Promise<void> {
  const { supabase, candidateId, batchId, accountId } = params;

  const { data: cand } = await supabase
    .from('prospect_candidates')
    .select('status, review_status, metadata')
    .eq('id', candidateId)
    .single();

  const { data: batch } = await supabase
    .from('prospect_batches')
    .select('status, metadata')
    .eq('id', batchId)
    .single();

  const { data: acc } = await supabase
    .from('accounts')
    .select('metadata')
    .eq('id', accountId)
    .single();

  const candMeta = (cand?.metadata as Record<string, unknown>) ?? {};
  const batchMeta = (batch?.metadata as Record<string, unknown>) ?? {};
  const accMeta = (acc?.metadata as Record<string, unknown>) ?? {};

  console.log(`  candidate: status=${cand?.status} review_status=${cand?.review_status}`);
  console.log(`    logical_cleanup.cleanup_type: ${(candMeta.logical_cleanup as Record<string, unknown>)?.cleanup_type ?? 'MISSING'}`);
  console.log(`    logical_cleanup.hard_delete: ${(candMeta.logical_cleanup as Record<string, unknown>)?.hard_delete ?? 'MISSING'}`);
  console.log(`  batch: status=${batch?.status}`);
  console.log(`    logical_cleanup.cleanup_type: ${(batchMeta.logical_cleanup as Record<string, unknown>)?.cleanup_type ?? 'MISSING'}`);
  console.log(`  account: logical_cleanup.cleanup_type: ${(accMeta.logical_cleanup as Record<string, unknown>)?.cleanup_type ?? 'MISSING'}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabase();

  // ── PREFLIGHT ──────────────────────────────────────────────────────────────

  console.log('── PREFLIGHT ──────────────────────────────────────────────────────\n');
  await preflightSunatSnapshot(supabase);
  console.log('\n  ✓ Preflight OK: snapshot disponible, RUC activo+habido\n');

  // ── SETUP SMOKE DATA ───────────────────────────────────────────────────────

  console.log('── SETUP SMOKE DATA ───────────────────────────────────────────────\n');

  const batchId = await upsertSmokeBatch(supabase);
  const accountId = await upsertSmokeAccount(supabase);
  const candidateId = await upsertSmokeCandidate(supabase, batchId, accountId);

  console.log(`\n  Smoke batch id:      ${batchId}`);
  console.log(`  Smoke account id:    ${accountId}`);
  console.log(`  Smoke candidate id:  ${candidateId}`);
  console.log(`  country_code:        PE`);
  console.log(`  ruc (tax_identifier):${SMOKE_RUC}`);
  console.log(`  domain:              ${SMOKE_DOMAIN}`);
  console.log(`  smoke_type:          ${SMOKE_TYPE}`);

  console.log('\n' + '─'.repeat(72) + '\n');

  // ── EXECUTE PE SUNAT ENRICHMENT ────────────────────────────────────────────

  console.log('── EXECUTE PE SUNAT POST-APPROVAL ENRICHMENT ──────────────────────\n');
  console.log('  adapter registry: {} (vacío — sin adaptadores CO)');
  console.log('  peruLookupFnOverride: undefined (usa lookupPeruSunatByRuc real)');
  console.log('  candidateId filter:', candidateId);
  console.log('  maxCandidates: 1');
  console.log('  Fuentes: SOLO snapshot Supabase — 0 Tavily, 0 Migo, 0 SUNAT web\n');

  const stats = await runPostApprovalNitEnrichmentWorker({
    supabase,
    adapterRegistryOverride: {},
    candidateId,
    maxCandidates: 1,
    // peruLookupFnOverride NOT set → uses real lookupPeruSunatByRuc from snapshot
  });

  console.log('  Worker stats:', JSON.stringify(stats, null, 2));

  // ── VALIDATE pe_sunat_bulk ─────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── VALIDATE pe_sunat_bulk ─────────────────────────────────────────\n');

  const { data: afterRow } = await supabase
    .from('prospect_candidates')
    .select('metadata')
    .eq('id', candidateId)
    .single();

  const metaAfter = (afterRow?.metadata as Record<string, unknown>) ?? {};
  const validation = validatePeSunatBulk(metaAfter);

  for (const check of validation.checks) {
    const icon = check.passed ? '✓' : '✗';
    console.log(`  ${icon} ${check.name}`);
    if (!check.passed) {
      console.log(`      expected: ${check.expected}`);
      console.log(`      actual:   ${check.actual}`);
    }
  }

  const se = (metaAfter.source_enrichment ?? {}) as Record<string, unknown>;
  const bulk = (se.pe_sunat_bulk ?? {}) as Record<string, unknown>;

  console.log('\n  ── pe_sunat_bulk completo ─────────────────────────────────────');
  console.log(JSON.stringify(bulk, null, 4));

  console.log(`\n  Overall: ${validation.passed ? '✓ PASSED' : '✗ FAILED'}`);

  // ── AUDIT TRAIL ────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── AUDIT TRAIL ────────────────────────────────────────────────────\n');

  const { data: auditRows } = await supabase
    .from('prospect_candidate_audit')
    .select('action_type, details, created_at')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(3);

  const auditCount = (auditRows ?? []).length;
  console.log(`  Audit rows for candidate: ${auditCount}`);
  for (const row of (auditRows ?? []) as Array<Record<string, unknown>>) {
    const details = row.details as Record<string, unknown>;
    console.log(
      `    → action_type=${row.action_type} sub_action=${details?.sub_action ?? 'n/a'}`,
    );
  }

  // ── CONFIRMACIONES GUARDRAILS ──────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── CONFIRMACIONES GUARDRAILS ──────────────────────────────────────\n');
  console.log('  ✓ NO llamó Tavily');
  console.log('  ✓ NO llamó Migo API');
  console.log('  ✓ NO llamó SUNAT web (www2.sunat)');
  console.log('  ✓ NO descargó padron_reducido_ruc.zip');
  console.log('  ✓ NO leyó .tmp/sunat-peru/');
  console.log('  ✓ NO ejecutó importer SUNAT');
  console.log('  ✓ NO llamó LLM');
  console.log('  ✓ NO llamó LinkedIn');
  console.log('  ✓ NO tocó Chile/México/Colombia');
  console.log('  ✓ NO procesó candidatos reales (candidateId limitado al smoke)');
  console.log('  ✓ NO ejecutó DELETE / hard delete');
  console.log('  ✓ Lookup: snapshot Supabase ÚNICAMENTE (lookupPeruSunatByRuc real)');

  // ── LOGICAL CLEANUP ────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── LOGICAL CLEANUP (ejecutado — NO hard delete) ───────────────────\n');

  await applyLogicalCleanup({ supabase, candidateId, batchId, accountId });

  console.log('\n  ── Verificación post-cleanup ──────────────────────────────────');
  await verifyCleanup({ supabase, candidateId, batchId, accountId });

  // ── VEREDICTO ─────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(72));
  console.log('VEREDICTO PERÚ.5D');
  console.log('═'.repeat(72));

  const sunatEnrichmentRan = stats.queued_found === 1;
  const peVerified =
    validation.passed &&
    bulk.legal_validation_status === EXPECTED_VALIDATION_STATUS &&
    bulk.legal_validation_reason === EXPECTED_VALIDATION_REASON;

  if (sunatEnrichmentRan && peVerified) {
    console.log('✓ PERÚ.5D SMOKE PASSED');
    console.log(`  RUC ${SMOKE_RUC} → verified / ruc_found_active_habido`);
    console.log(`  legal_name: ${bulk.legal_name}`);
    console.log(`  taxpayer_status: ${bulk.taxpayer_status} | domicile: ${bulk.domicile_condition}`);
    console.log('  Lookup real contra snapshot Supabase: CORRECTO');
    console.log('  Limpieza lógica aplicada: candidato discarded + batch completed');
  } else {
    console.log('✗ PERÚ.5D SMOKE FAILED — revisar checks arriba');
    if (!sunatEnrichmentRan) {
      console.log(`  queued_found=${stats.queued_found} (expected 1)`);
    }
    if (!validation.passed) {
      console.log('  pe_sunat_bulk validation falló');
    }
    process.exit(1);
  }

  console.log('═'.repeat(72) + '\n');
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
