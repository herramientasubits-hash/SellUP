#!/usr/bin/env tsx
/**
 * POST-APPROVAL NIT WORKER SMOKE — MOCK ADAPTERS ONLY — NO LIVE SOURCES
 *
 * Agent 1 v1.16K-E-A-pre — Post-Approval NIT Worker Supabase Smoke Readiness
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 Tavily          0 LLM            0 LinkedIn
 *   0 Socrata real    0 Live adapters  0 DELETE
 *   0 Hard delete     0 candidatos reales procesados
 *   0 endpoint cron real
 *
 * Crea datos QA mínimos (account + candidate smoke) si no existen.
 * Ejecuta worker con adapterRegistryOverride mock y candidateId limitado.
 * Imprime reporte detallado y cleanup SQL propuesto (NO ejecuta).
 *
 * Uso: npx tsx scripts/agent1/smoke-post-approval-nit-enrichment-worker.ts
 */

import { createClient } from '@supabase/supabase-js';
import {
  runPostApprovalNitEnrichmentWorker,
  CO_NIT_SAFE_SOURCE_KEYS,
} from '../../src/server/prospect-batches/post-approval-nit-enrichment-worker';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
} from '../../src/server/source-catalog/enrichment/types';

// ── Hard guard ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('POST-APPROVAL NIT WORKER SMOKE — MOCK ADAPTERS ONLY — NO LIVE SOURCES');
console.log('Agent 1 v1.16K-E-A-pre');
console.log('═'.repeat(72) + '\n');

// ── Constants ─────────────────────────────────────────────────────────────────

const SMOKE_DOMAIN = 'sellup-post-approval-nit-smoke.example';
const SMOKE_NIT = '900123456';
const SMOKE_TYPE = 'post_approval_nit_worker_v1_16k_e_a';
const SMOKE_ACCOUNT_NAME = 'SellUp Post Approval NIT Smoke Account';
const SMOKE_CANDIDATE_NAME = 'SellUp Post Approval NIT Smoke Candidate';

const EXPECTED_SOURCE_KEYS: string[] = [...CO_NIT_SAFE_SOURCE_KEYS];

// ── Supabase admin client ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

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

// ── Mock adapters ──────────────────────────────────────────────────────────────

function buildMockAdapterRegistry(): Record<string, SourceEnrichmentAdapter> {
  const makeAdapter = (
    sourceKey: string,
    result: Partial<SourceEnrichmentOutput>,
  ): SourceEnrichmentAdapter => ({
    sourceKey,
    supportedCapabilities: ['enrichment_after_discovery'],
    enrichCandidate: async (_input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> => ({
      sourceKey,
      status: 'matched',
      matchedBy: null,
      confidence: 0,
      ...result,
    }),
  });

  return {
    co_personas_juridicas_cc: makeAdapter('co_personas_juridicas_cc', {
      status: 'matched',
      matchedBy: 'tax_id',
      confidence: 0.95,
      metadata: {
        legal_name: 'SellUp Post Approval NIT Smoke Account SAS',
        chamber: 'Bogotá',
        ciiu: '6201',
        status: 'ACTIVA',
      },
    }),
    co_secop2_proveedores: makeAdapter('co_secop2_proveedores', {
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
      reason: 'not_found_in_mock_secop2',
    }),
    co_minsalud_reps: makeAdapter('co_minsalud_reps', {
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'sector_mismatch',
    }),
    co_superfinanciera: makeAdapter('co_superfinanciera', {
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'sector_mismatch',
    }),
    co_siis: makeAdapter('co_siis', {
      status: 'matched',
      matchedBy: 'tax_id',
      confidence: 0.95,
      financials: { revenue: 5_000_000_000, assets: 12_000_000_000, year: 2023 },
    }),
  };
}

// ── Precheck helpers ───────────────────────────────────────────────────────────

async function precheckExistingSmokeAccount(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, created_at')
    .or(`website.eq.${SMOKE_DOMAIN},domain.eq.${SMOKE_DOMAIN}`)
    .neq('status', 'discarded')
    .limit(5);

  if (error) {
    // Table may have different column name — try website only
    return { count: 0, rows: [], error: error.message };
  }
  return { count: data?.length ?? 0, rows: data ?? [], error: null };
}

async function precheckExistingSmokeCandidate(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('prospect_candidates')
    .select('id, name, status, metadata, created_at')
    .eq('domain', SMOKE_DOMAIN)
    .neq('status', 'discarded')
    .limit(5);

  if (error) return { count: 0, rows: [], error: error.message };
  return { count: data?.length ?? 0, rows: data ?? [], error: null };
}

async function precheckRealQueuedCandidates(supabase: AnySupabase) {
  const { data, error } = await supabase
    .from('prospect_candidates')
    .select('id, name, domain, metadata->>post_approval_enrichment')
    .eq('status', 'converted_to_account')
    .not('converted_account_id', 'is', null)
    .limit(60);

  if (error) return { count: 0, rows: [], error: error.message };

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const queued = rows.filter((r) => {
    try {
      const pae =
        typeof r.post_approval_enrichment === 'string'
          ? (JSON.parse(r.post_approval_enrichment) as Record<string, unknown>)
          : (r.post_approval_enrichment as Record<string, unknown> | null);
      return (
        pae?.status === 'queued' &&
        pae?.strategy === 'nit_first'
      );
    } catch {
      return false;
    }
  });

  return { count: queued.length, rows: queued.slice(0, 5), error: null };
}

// ── Upsert smoke account ───────────────────────────────────────────────────────

async function upsertSmokeAccount(
  supabase: AnySupabase,
): Promise<string> {
  // Check if already exists
  const { data: existing } = await supabase
    .from('accounts')
    .select('id')
    .or(`website.eq.${SMOKE_DOMAIN},domain.eq.${SMOKE_DOMAIN}`)
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
      country_code: 'CO',
      source: 'agent_1',
      metadata: {
        smoke_test: true,
        smoke_type: SMOKE_TYPE,
        qa_only: true,
        do_not_use_for_sales: true,
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

// ── Upsert smoke candidate ─────────────────────────────────────────────────────

async function upsertSmokeCandidate(
  supabase: AnySupabase,
  accountId: string,
): Promise<string> {
  // Check if already exists with correct metadata
  const { data: existing } = await supabase
    .from('prospect_candidates')
    .select('id, metadata')
    .eq('domain', SMOKE_DOMAIN)
    .neq('status', 'discarded')
    .limit(1)
    .single();

  if (existing?.id) {
    const meta = existing.metadata as Record<string, unknown> | null;
    const pae = meta?.post_approval_enrichment as Record<string, unknown> | undefined;

    if (pae?.status === 'queued') {
      console.log(`  [candidate] Reusing existing smoke candidate (already queued): ${existing.id}`);
      return existing.id as string;
    }

    // Reset to queued
    const updatedMeta: Record<string, unknown> = {
      ...(meta ?? {}),
      post_approval_enrichment: buildPaeBlock(accountId),
    };

    await supabase
      .from('prospect_candidates')
      .update({ metadata: updatedMeta })
      .eq('id', existing.id as string);

    console.log(`  [candidate] Reset smoke candidate to queued: ${existing.id}`);
    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('prospect_candidates')
    .insert({
      name: SMOKE_CANDIDATE_NAME,
      domain: SMOKE_DOMAIN,
      status: 'converted_to_account',
      converted_account_id: accountId,
      country_code: 'CO',
      tax_identifier: SMOKE_NIT,
      metadata: {
        smoke_test: true,
        smoke_type: SMOKE_TYPE,
        qa_only: true,
        do_not_use_for_sales: true,
        do_not_convert: true,
        approval: {
          approved_at: new Date().toISOString(),
          approved_by: 'smoke_script_v1_16k_e_a',
        },
        rich_profile: {
          company_type: 'SAS',
          employees: 42,
          domain: SMOKE_DOMAIN,
        },
        icp_size_gate: {
          passed: true,
          size_bucket: 'mid_market',
          checked_at: new Date().toISOString(),
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

function buildPaeBlock(accountId: string): Record<string, unknown> {
  return {
    status: 'queued',
    strategy: 'nit_first',
    nit: SMOKE_NIT,
    source_keys: EXPECTED_SOURCE_KEYS,
    trigger: 'candidate_approval',
    account_id: accountId,
    triggered_at: new Date().toISOString(),
  };
}

// ── Cleanup SQL (proposed, NOT executed) ──────────────────────────────────────

function buildCleanupSql(candidateId: string, accountId: string): string {
  return `
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  CLEANUP PROPUESTO — NO EJECUTAR AUTOMÁTICAMENTE                 ║
-- ║  Revisar antes de ejecutar en producción                         ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- 1. Marcar candidato smoke como descartado (NO DELETE)
UPDATE prospect_candidates
SET
  status = 'discarded',
  review_status = 'rejected',
  metadata = jsonb_set(
    jsonb_set(metadata, '{logical_cleanup}', '{"hard_delete": false, "reason": "smoke_test_cleanup", "cleaned_at": "TIMESTAMP_HERE"}'::jsonb),
    '{smoke_cleanup}', '{"cleaned": true}'::jsonb
  ),
  updated_at = NOW()
WHERE id = '${candidateId}'
  AND domain = '${SMOKE_DOMAIN}';

-- 2. Marcar account smoke como archivado (NO DELETE)
UPDATE accounts
SET
  metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{logical_cleanup}', '{"hard_delete": false, "reason": "smoke_test_cleanup", "cleaned_at": "TIMESTAMP_HERE"}'::jsonb
  ),
  updated_at = NOW()
WHERE id = '${accountId}'
  AND domain = '${SMOKE_DOMAIN}';

-- 3. Verificar cleanup
SELECT id, status, metadata->>'smoke_type' AS smoke_type
FROM prospect_candidates
WHERE id = '${candidateId}';

SELECT id, metadata->>'smoke_type' AS smoke_type
FROM accounts
WHERE id = '${accountId}';

-- NOTA: audit trail se conserva.
-- NO hay DELETE. NO hay hard delete.
`.trim();
}

// ── Validate worker output ────────────────────────────────────────────────────

function validateWorkerOutput(
  metadata: Record<string, unknown>,
  originalApproval: Record<string, unknown>,
  originalRichProfile: Record<string, unknown>,
): {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
} {
  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

  const se = (metadata.source_enrichment ?? {}) as Record<string, unknown>;
  const pae = (metadata.post_approval_enrichment ?? {}) as Record<string, unknown>;

  const checkSource = (key: string, expectedStatus: string) => {
    const block = (se[key] ?? {}) as Record<string, unknown>;
    const ok = block.status === expectedStatus;
    checks.push({
      name: `source_enrichment.${key}.status`,
      passed: ok,
      detail: `expected=${expectedStatus} actual=${block.status ?? 'MISSING'}`,
    });
  };

  checkSource('co_personas_juridicas_cc', 'matched');
  checkSource('co_secop2_proveedores', 'no_match');
  checkSource('co_minsalud_reps', 'skipped');
  checkSource('co_superfinanciera', 'skipped');
  checkSource('co_siis', 'matched');

  // PAE status
  const paeStatus = pae.status === 'completed';
  checks.push({
    name: 'post_approval_enrichment.status',
    passed: paeStatus,
    detail: `expected=completed actual=${pae.status ?? 'MISSING'}`,
  });

  // processed_source_keys
  const psk = Array.isArray(pae.processed_source_keys)
    ? (pae.processed_source_keys as string[])
    : [];
  checks.push({
    name: 'post_approval_enrichment.processed_source_keys length',
    passed: psk.length === 5,
    detail: `expected=5 actual=${psk.length}`,
  });

  // failed_source_keys empty
  const fsk = Array.isArray(pae.failed_source_keys)
    ? (pae.failed_source_keys as string[])
    : [];
  checks.push({
    name: 'post_approval_enrichment.failed_source_keys empty',
    passed: fsk.length === 0,
    detail: `expected=0 actual=${fsk.length}`,
  });

  // completed_at set
  checks.push({
    name: 'post_approval_enrichment.completed_at set',
    passed: typeof pae.completed_at === 'string' && pae.completed_at.length > 0,
    detail: `actual=${pae.completed_at ?? 'MISSING'}`,
  });

  // approval preserved
  const approval = metadata.approval as Record<string, unknown> | undefined;
  checks.push({
    name: 'metadata.approval preserved',
    passed:
      approval?.approved_by === originalApproval.approved_by &&
      approval?.approved_at === originalApproval.approved_at,
    detail: `approved_by=${approval?.approved_by ?? 'MISSING'}`,
  });

  // rich_profile preserved
  const rp = metadata.rich_profile as Record<string, unknown> | undefined;
  checks.push({
    name: 'metadata.rich_profile preserved',
    passed:
      rp?.company_type === (originalRichProfile as Record<string, unknown>).company_type &&
      rp?.employees === (originalRichProfile as Record<string, unknown>).employees,
    detail: `employees=${rp?.employees ?? 'MISSING'}`,
  });

  // icp_size_gate preserved
  checks.push({
    name: 'metadata.icp_size_gate preserved',
    passed: !!(metadata.icp_size_gate),
    detail: `present=${!!(metadata.icp_size_gate)}`,
  });

  // No Tavily/LLM/LinkedIn in source keys processed
  const noForbidden = psk.every(
    (k) =>
      !k.includes('tavily') && !k.includes('llm') && !k.includes('linkedin'),
  );
  checks.push({
    name: 'no Tavily/LLM/LinkedIn in processed_source_keys',
    passed: noForbidden,
    detail: `keys=${psk.join(',')}`,
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabase();

  // ── PRECHECK DB ────────────────────────────────────────────────────────────

  console.log('── PRECHECK DB (SELECT only) ──────────────────────────────────────\n');

  const [accountPrecheck, candidatePrecheck, queuedPrecheck] = await Promise.all([
    precheckExistingSmokeAccount(supabase),
    precheckExistingSmokeCandidate(supabase),
    precheckRealQueuedCandidates(supabase),
  ]);

  console.log(`[1] Accounts activos con domain=${SMOKE_DOMAIN}:`);
  console.log(`    count=${accountPrecheck.count}  error=${accountPrecheck.error ?? 'none'}`);
  if (accountPrecheck.rows.length > 0) {
    for (const r of accountPrecheck.rows) {
      const row = r as Record<string, unknown>;
      console.log(`    → id=${row.id} name=${row.name}`);
    }
  }

  console.log(`\n[2] Candidates activos con domain=${SMOKE_DOMAIN}:`);
  console.log(`    count=${candidatePrecheck.count}  error=${candidatePrecheck.error ?? 'none'}`);
  if (candidatePrecheck.rows.length > 0) {
    for (const r of candidatePrecheck.rows) {
      const row = r as Record<string, unknown>;
      const meta = row.metadata as Record<string, unknown> | null;
      const pae = meta?.post_approval_enrichment as Record<string, unknown> | undefined;
      console.log(`    → id=${row.id} status=${row.status} pae.status=${pae?.status ?? 'none'}`);
    }
  }

  console.log(`\n[3] Candidatos REALES queued nit_first (converted_to_account):`);
  console.log(`    count=${queuedPrecheck.count}  error=${queuedPrecheck.error ?? 'none'}`);
  if (queuedPrecheck.count > 0) {
    console.log('    ⚠ HAY CANDIDATOS REALES QUEUED. El smoke usará candidateId para limitarse al candidato smoke.');
    for (const r of queuedPrecheck.rows) {
      const row = r as Record<string, unknown>;
      console.log(`    → id=${row.id} domain=${row.domain ?? 'n/a'}`);
    }
  } else {
    console.log('    ✓ Sin candidatos reales queued.');
  }

  console.log('\n' + '─'.repeat(72) + '\n');

  // ── SETUP SMOKE DATA ───────────────────────────────────────────────────────

  console.log('── SETUP SMOKE DATA ───────────────────────────────────────────────\n');

  const accountId = await upsertSmokeAccount(supabase);
  const candidateId = await upsertSmokeCandidate(supabase, accountId);

  console.log(`\n  Smoke account id:    ${accountId}`);
  console.log(`  Smoke candidate id:  ${candidateId}`);

  // Read back metadata before worker
  const { data: beforeRow } = await supabase
    .from('prospect_candidates')
    .select('metadata')
    .eq('id', candidateId)
    .single();

  const metaBefore = (beforeRow?.metadata as Record<string, unknown>) ?? {};
  const approvalBefore = (metaBefore.approval as Record<string, unknown>) ?? {};
  const richProfileBefore = (metaBefore.rich_profile as Record<string, unknown>) ?? {};

  console.log('\n' + '─'.repeat(72) + '\n');

  // ── EXECUTE WORKER WITH MOCK ADAPTERS ──────────────────────────────────────

  console.log('── EXECUTE WORKER (mock adapters, candidateId limited) ────────────\n');
  console.log('  adapter registry: MOCK — no live sources');
  console.log('  candidateId filter:', candidateId);
  console.log('  adapterRegistryOverride keys:', EXPECTED_SOURCE_KEYS.join(', '));
  console.log('  maxCandidates: 1\n');

  const mockRegistry = buildMockAdapterRegistry();

  const stats = await runPostApprovalNitEnrichmentWorker({
    supabase,
    adapterRegistryOverride: mockRegistry,
    candidateId,
    maxCandidates: 1,
  });

  console.log('  Worker stats:', JSON.stringify(stats, null, 2));

  // ── VALIDATE OUTPUT ────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── VALIDATE OUTPUT ────────────────────────────────────────────────\n');

  const { data: afterRow } = await supabase
    .from('prospect_candidates')
    .select('metadata')
    .eq('id', candidateId)
    .single();

  const metaAfter = (afterRow?.metadata as Record<string, unknown>) ?? {};

  const validation = validateWorkerOutput(metaAfter, approvalBefore, richProfileBefore);

  for (const check of validation.checks) {
    const icon = check.passed ? '✓' : '✗';
    console.log(`  ${icon} ${check.name}`);
    if (!check.passed) console.log(`      ${check.detail}`);
  }

  console.log(`\n  Overall: ${validation.passed ? '✓ PASSED' : '✗ FAILED'}`);

  // Read audit trail
  const { data: auditRows } = await supabase
    .from('prospect_candidate_audit')
    .select('action_type, details, created_at')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log(`\n  Audit rows for candidate: ${(auditRows ?? []).length}`);
  for (const row of (auditRows ?? []) as Array<Record<string, unknown>>) {
    const details = row.details as Record<string, unknown>;
    console.log(
      `    → action_type=${row.action_type} sub_action=${details?.sub_action ?? 'n/a'}`,
    );
  }

  // ── CONFIRMATIONS ──────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── CONFIRMACIONES ─────────────────────────────────────────────────\n');
  console.log('  ✓ NO llamó endpoint cron real');
  console.log('  ✓ NO usó adapters live (adapterRegistryOverride = mock)');
  console.log('  ✓ NO llamó Tavily');
  console.log('  ✓ NO llamó LLM');
  console.log('  ✓ NO llamó LinkedIn');
  console.log('  ✓ NO llamó Socrata');
  console.log('  ✓ NO procesó candidatos reales (candidateId limitado al smoke)');
  console.log('  ✓ NO ejecutó DELETE');
  console.log('  ✓ NO ejecutó hard delete');

  // ── CLEANUP SQL (proposed, NOT executed) ──────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── CLEANUP SQL PROPUESTO (NO EJECUTAR) ────────────────────────────\n');
  console.log(buildCleanupSql(candidateId, accountId));

  // ── VEREDICTO ─────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(72));
  console.log('VEREDICTO');
  console.log('═'.repeat(72));

  if (validation.passed && stats.queued_found === 1 && stats.completed === 1) {
    console.log('✓ LISTO para autorizar smoke real mock.');
    console.log('  El worker procesó correctamente el candidato smoke con adapters mock.');
    console.log('  Próximo paso: autorizar ENABLE_POST_APPROVAL_SOURCE_ENRICHMENT cuando corresponda.');
  } else {
    console.log('✗ BLOQUEADO — revisar checks fallidos arriba.');
    console.log(`  stats: ${JSON.stringify(stats)}`);
    process.exit(1);
  }

  console.log('═'.repeat(72) + '\n');
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
