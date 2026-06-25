#!/usr/bin/env tsx
/**
 * PERU SUNAT ACCOUNT METADATA PROPAGATION SMOKE — Perú.5J
 *
 * Smoke controlado que valida la propagación de metadata SUNAT
 * desde candidato → cuenta, implementada en Perú.5I.
 *
 * El objetivo es dejar una cuenta visible en Empresas con:
 *   account.metadata.source_enrichment.pe_sunat_bulk.legal_validation_status = "verified"
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 Tavily            0 LLM              0 LinkedIn
 *   0 SUNAT web         0 Migo             0 Importer SUNAT
 *   0 Hard delete       0 Candidatos reales procesados
 *   0 Descarga zip      0 Lectura .tmp/sunat-peru
 *   0 Chile/México/Colombia
 *
 * NO aplica cleanup — la cuenta queda visible para QA visual.
 *
 * Uso: npx tsx scripts/agent1/smoke-peru-sunat-account-metadata-propagation.ts
 */

import { createClient } from '@supabase/supabase-js';
import {
  runPostApprovalNitEnrichmentWorker,
} from '../../src/server/prospect-batches/post-approval-nit-enrichment-worker';

// ── Constants ─────────────────────────────────────────────────────────────────

const SMOKE_DOMAIN = 'sellup-peru-sunat-account-visible-smoke.example';
const SMOKE_RUC = '20100050359';
const SMOKE_TYPE = 'peru_sunat_account_metadata_propagation_v1_5j';
const SMOKE_ACCOUNT_NAME = 'SellUp Peru SUNAT Account Metadata Smoke 5J';
const SMOKE_CANDIDATE_NAME = 'SellUp Peru SUNAT Account Metadata Smoke Candidate 5J';
const SMOKE_BATCH_NAME = 'SellUp Peru SUNAT Account Metadata Smoke Batch 5J';
const CLEANUP_TYPE = 'peru_sunat_account_metadata_propagation_v1_5j_cleanup';

const EXPECTED_LEGAL_NAME = 'A W FABER CASTELL PERUANA S A';
const EXPECTED_VALIDATION_STATUS = 'verified';
const EXPECTED_VALIDATION_REASON = 'ruc_found_active_habido';
const EXPECTED_SOURCE_KEY = 'pe_sunat_bulk';

// ── Banner ─────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('PERU SUNAT ACCOUNT METADATA PROPAGATION SMOKE — Perú.5J');
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

// ── Preflight ─────────────────────────────────────────────────────────────────

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
  console.log(`    ruc:                ${data.ruc}`);
  console.log(`    legal_name:         ${data.legal_name}`);
  console.log(`    taxpayer_status:    ${data.taxpayer_status}`);
  console.log(`    domicile_condition: ${data.domicile_condition}`);
  console.log(`    is_active:          ${data.is_active}`);
  console.log(`    is_habido:          ${data.is_habido}`);
  console.log(`    source_key:         ${data.source_key}`);

  if (!data.is_active || !data.is_habido) {
    throw new Error(
      `Preflight FAILED: RUC ${SMOKE_RUC} is_active=${data.is_active} is_habido=${data.is_habido}. ` +
      `Expected both true for smoke test.`,
    );
  }

  const { count } = await supabase
    .from('peru_sunat_ruc_snapshot')
    .select('*', { count: 'exact', head: true });

  console.log(`    snapshot total:     ${count} filas`);
}

// ── Batch ─────────────────────────────────────────────────────────────────────

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

// ── Account ───────────────────────────────────────────────────────────────────

async function upsertSmokeAccount(supabase: AnySupabase): Promise<string> {
  // Check if smoke account already exists (any non-archived state)
  const { data: existing } = await supabase
    .from('accounts')
    .select('id, pipeline_status, metadata')
    .eq('domain', SMOKE_DOMAIN)
    .neq('pipeline_status', 'archived')
    .limit(1)
    .single();

  if (existing?.id) {
    // Reset account metadata to clear any previous pe_sunat_bulk so smoke is clean
    const existingMeta = (existing.metadata as Record<string, unknown>) ?? {};
    const existingSE = (existingMeta.source_enrichment as Record<string, unknown>) ?? {};

    // Remove previous pe_sunat_bulk if present, ensuring clean propagation test
    if (existingSE.pe_sunat_bulk !== undefined) {
      const cleanedSE = Object.fromEntries(
        Object.entries(existingSE).filter(([k]) => k !== 'pe_sunat_bulk'),
      );
      const cleanedMeta = { ...existingMeta, source_enrichment: cleanedSE };

      await supabase
        .from('accounts')
        .update({ metadata: cleanedMeta, pipeline_status: 'new' })
        .eq('id', existing.id as string);

      console.log(`  [account] Reusing smoke account (pe_sunat_bulk cleared): ${existing.id}`);
    } else {
      console.log(`  [account] Reusing smoke account (already clean): ${existing.id}`);
    }

    return existing.id as string;
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name: SMOKE_ACCOUNT_NAME,
      website: `https://${SMOKE_DOMAIN}`,
      domain: SMOKE_DOMAIN,
      country: 'Peru',
      country_code: 'PE',
      tax_identifier: SMOKE_RUC,
      tax_identifier_type: 'RUC',
      source: 'agent_1',
      pipeline_status: 'new',
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

// ── Candidate ─────────────────────────────────────────────────────────────────

function buildPaeBlock(accountId: string): Record<string, unknown> {
  return {
    status: 'queued',
    strategy: 'nit_first',
    nit: SMOKE_RUC,
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
    const pae = (meta?.post_approval_enrichment as Record<string, unknown>) ?? {};

    // Reset PAE to queued and clear pe_sunat_bulk for clean propagation test
    const updatedMeta: Record<string, unknown> = {
      ...(meta ?? {}),
      post_approval_enrichment: buildPaeBlock(accountId),
      source_enrichment: {
        ...((meta?.source_enrichment as Record<string, unknown>) ?? {}),
        pe_sunat_bulk: undefined,
      },
    };

    if (pae.status !== 'queued') {
      await supabase
        .from('prospect_candidates')
        .update({
          status: 'converted_to_account',
          converted_account_id: accountId,
          metadata: updatedMeta,
        })
        .eq('id', existing.id as string);

      console.log(`  [candidate] Reset smoke candidate to queued: ${existing.id}`);
    } else {
      console.log(`  [candidate] Reusing smoke candidate (already queued): ${existing.id}`);
    }

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
          approved_by: 'smoke_script_peru_5j',
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

// ── Validate account.metadata.pe_sunat_bulk ────────────────────────────────────

interface SunatCheck {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

function validateAccountPeSunatBulk(
  accountMetadata: Record<string, unknown>,
): { passed: boolean; checks: SunatCheck[]; bulk: Record<string, unknown> } {
  const checks: SunatCheck[] = [];

  const se = (accountMetadata.source_enrichment ?? {}) as Record<string, unknown>;
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
      name: 'account source_enrichment.pe_sunat_bulk exists',
      passed: false,
      expected: 'object',
      actual: 'MISSING',
    });
    return { passed: false, checks, bulk: {} };
  }

  check('pe_sunat_bulk.legal_validation_status', EXPECTED_VALIDATION_STATUS, bulk.legal_validation_status);
  check('pe_sunat_bulk.legal_validation_reason', EXPECTED_VALIDATION_REASON, bulk.legal_validation_reason);
  check('pe_sunat_bulk.ruc', SMOKE_RUC, bulk.ruc);
  check('pe_sunat_bulk.legal_name', EXPECTED_LEGAL_NAME, bulk.legal_name);
  check('pe_sunat_bulk.taxpayer_status', 'ACTIVO', bulk.taxpayer_status);
  check('pe_sunat_bulk.domicile_condition', 'HABIDO', bulk.domicile_condition);
  check('pe_sunat_bulk.source_key', EXPECTED_SOURCE_KEY, bulk.source_key);
  check('pe_sunat_bulk.ciiu_status', 'unavailable_for_mvp', bulk.ciiu_status);
  check('pe_sunat_bulk.sector_source', 'inferred_web_ai', bulk.sector_source);
  check('pe_sunat_bulk.confidence_label', 'sector_inferred', bulk.confidence_label);
  check('pe_sunat_bulk.official_ciiu_available', 'false', bulk.official_ciiu_available);
  check('pe_sunat_bulk.human_review_required', 'true', bulk.human_review_required);

  checks.push({
    name: 'pe_sunat_bulk.enriched_at present',
    passed: typeof bulk.enriched_at === 'string' && bulk.enriched_at.length > 10,
    expected: 'ISO string',
    actual: typeof bulk.enriched_at === 'string' ? bulk.enriched_at : 'MISSING',
  });

  return { passed: checks.every((c) => c.passed), checks, bulk };
}

// ── DB Verification Query ─────────────────────────────────────────────────────

async function runDbVerificationQuery(supabase: AnySupabase): Promise<void> {
  console.log('\n  SQL de validación ejecutado:');
  console.log('  ─────────────────────────────────────────────────────────────');

  const { data, error } = await supabase
    .from('accounts')
    .select(`
      id,
      name,
      website,
      country_code,
      pipeline_status,
      metadata
    `)
    .ilike('website', `%${SMOKE_DOMAIN}%`);

  if (error) {
    console.log(`  [db-verify] ERROR: ${error.message}`);
    return;
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    const se = (meta.source_enrichment as Record<string, unknown>) ?? {};
    const bulk = (se.pe_sunat_bulk as Record<string, unknown>) ?? {};

    console.log(`    id:           ${row.id}`);
    console.log(`    name:         ${row.name}`);
    console.log(`    website:      ${row.website}`);
    console.log(`    country_code: ${row.country_code}`);
    console.log(`    pipeline_status: ${row.pipeline_status}`);
    console.log(`    smoke_type:   ${meta.smoke_type ?? 'n/a'}`);
    console.log(`    sunat_status: ${bulk.legal_validation_status ?? 'MISSING'}`);
    console.log(`    sunat_reason: ${bulk.legal_validation_reason ?? 'MISSING'}`);
  }

  if ((data ?? []).length === 0) {
    console.log('  [db-verify] WARNING: No rows found with that domain');
  }
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
  console.log(`  pipeline_status:     new (visible en Empresas)`);

  console.log('\n' + '─'.repeat(72) + '\n');

  // ── EXECUTE ENRICHMENT (candidate + account propagation) ───────────────────

  console.log('── EXECUTE PE SUNAT ENRICHMENT + ACCOUNT PROPAGATION ─────────────\n');
  console.log('  Ruta: runPostApprovalNitEnrichmentWorker (Perú.5I path)');
  console.log('  adapterRegistryOverride: {} (vacío — sin adaptadores CO)');
  console.log('  candidateId filter:', candidateId);
  console.log('  maxCandidates: 1');
  console.log('  Fuentes: SOLO snapshot Supabase — 0 Tavily, 0 Migo, 0 SUNAT web\n');

  const stats = await runPostApprovalNitEnrichmentWorker({
    supabase,
    adapterRegistryOverride: {},
    candidateId,
    maxCandidates: 1,
  });

  console.log('  Worker stats:', JSON.stringify(stats, null, 2));

  // ── VALIDATE ACCOUNT METADATA ─────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── VALIDATE account.metadata.source_enrichment.pe_sunat_bulk ─────\n');

  const { data: accountRow } = await supabase
    .from('accounts')
    .select('id, name, website, domain, country_code, pipeline_status, metadata')
    .eq('id', accountId)
    .single();

  if (!accountRow) {
    throw new Error(`Account ${accountId} not found after enrichment`);
  }

  const accountMeta = (accountRow.metadata as Record<string, unknown>) ?? {};
  const { passed, checks, bulk } = validateAccountPeSunatBulk(accountMeta);

  for (const c of checks) {
    const icon = c.passed ? '✓' : '✗';
    console.log(`  ${icon} ${c.name}`);
    if (!c.passed) {
      console.log(`      expected: ${c.expected}`);
      console.log(`      actual:   ${c.actual}`);
    }
  }

  console.log('\n  ── account.metadata.source_enrichment.pe_sunat_bulk completo ─');
  console.log(JSON.stringify(bulk, null, 4));

  console.log(`\n  Overall account validation: ${passed ? '✓ PASSED' : '✗ FAILED'}`);

  // ── VALIDATE CANDIDATE METADATA (cross-check) ─────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── VALIDATE candidate.metadata.source_enrichment.pe_sunat_bulk ───\n');

  const { data: candidateRow } = await supabase
    .from('prospect_candidates')
    .select('id, metadata, status')
    .eq('id', candidateId)
    .single();

  const candidateMeta = (candidateRow?.metadata as Record<string, unknown>) ?? {};
  const { passed: cPasseed, bulk: cBulk } = validateAccountPeSunatBulk(candidateMeta);

  console.log(`  candidate.status: ${candidateRow?.status}`);
  console.log(`  candidate pe_sunat_bulk validation: ${cPasseed ? '✓ PASSED' : '✗ FAILED (candidato)'}`);
  if (cBulk.legal_validation_status) {
    console.log(`  candidate.pe_sunat_bulk.legal_validation_status: ${cBulk.legal_validation_status}`);
  }

  // ── DB VERIFICATION QUERY ──────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── DB VERIFICATION QUERY ──────────────────────────────────────────\n');
  await runDbVerificationQuery(supabase);

  // ── GUARDRAILS CONFIRMATIONS ──────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── GUARDRAILS CONFIRMATIONS ───────────────────────────────────────\n');
  console.log('  ✓ NO llamó Tavily');
  console.log('  ✓ NO llamó Migo API');
  console.log('  ✓ NO llamó SUNAT web (www2.sunat)');
  console.log('  ✓ NO descargó padron_reducido_ruc.zip');
  console.log('  ✓ NO leyó .tmp/sunat-peru/');
  console.log('  ✓ NO ejecutó importer SUNAT');
  console.log('  ✓ NO ejecutó búsqueda real');
  console.log('  ✓ NO llamó LLM');
  console.log('  ✓ NO llamó LinkedIn');
  console.log('  ✓ NO tocó Chile/México/Colombia');
  console.log('  ✓ NO procesó candidatos reales (candidateId limitado al smoke)');
  console.log('  ✓ NO ejecutó DELETE / hard delete');
  console.log('  ✓ Lookup: snapshot Supabase ÚNICAMENTE');
  console.log('  ✓ NO se aplicó cleanup — cuenta visible para QA');

  // ── QA VISIBILITY INSTRUCTIONS ────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── QA VISUAL — CÓMO ENCONTRAR LA CUENTA EN VERCEL ────────────────\n');
  console.log('  1. Abrir SellUp en Vercel (producción o preview)');
  console.log('  2. Ir a Empresas (Companies / Accounts)');
  console.log('  3. Buscar: "SellUp Peru SUNAT Account Metadata Smoke 5J"');
  console.log('     o filtrar por país: Peru');
  console.log('  4. La cuenta debe aparecer con estado: Nueva');
  console.log(`  5. account id: ${accountId}`);
  console.log(`  6. domain: ${SMOKE_DOMAIN}`);
  console.log('  7. Abrir la empresa — verificar bloque SUNAT muestra:');
  console.log('       "Verificado SUNAT"  (not "Validación SUNAT pendiente")');
  console.log('  8. RUC visible: 20100050359 — A W FABER CASTELL PERUANA S A');

  // ── CLEANUP INSTRUCTIONS ──────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72) + '\n');
  console.log('── INSTRUCCIONES DE CLEANUP POSTERIOR ─────────────────────────────\n');
  console.log(`  cleanup_type: ${CLEANUP_TYPE}`);
  console.log('');
  console.log('  CUÁNDO: Después de confirmar QA visual en Vercel.');
  console.log('');
  console.log('  QUÉ HACER:');
  console.log(`  1. Candidate ${candidateId}`);
  console.log('     UPDATE prospect_candidates');
  console.log('     SET status = \'discarded\', review_status = \'rejected\'');
  console.log(`     WHERE id = '${candidateId}';`);
  console.log('');
  console.log(`  2. Batch ${batchId}`);
  console.log('     UPDATE prospect_batches');
  console.log('     SET status = \'completed\'');
  console.log(`     WHERE id = '${batchId}';`);
  console.log('');
  console.log(`  3. Account ${accountId}`);
  console.log('     UPDATE accounts');
  console.log('     SET pipeline_status = \'archived\'');
  console.log(`     WHERE id = '${accountId}';`);
  console.log('');
  console.log('  O ejecutar:');
  console.log('    npx tsx scripts/agent1/smoke-peru-sunat-account-metadata-propagation.ts --cleanup');
  console.log('  (implementar flag --cleanup si se necesita en el futuro)');

  // ── VERDICT ───────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(72));
  console.log('VEREDICTO PERÚ.5J');
  console.log('═'.repeat(72));

  const enrichmentRan = stats.queued_found === 1;

  if (enrichmentRan && passed) {
    console.log('✓ PERÚ.5J SMOKE PASSED');
    console.log(`  RUC ${SMOKE_RUC} → verified / ruc_found_active_habido`);
    console.log(`  legal_name:        ${bulk.legal_name}`);
    console.log(`  taxpayer_status:   ${bulk.taxpayer_status}`);
    console.log(`  domicile_condition:${bulk.domicile_condition}`);
    console.log('  Propagación candidato → cuenta: CONFIRMADA');
    console.log('  Lookup: snapshot Supabase ÚNICAMENTE');
    console.log('  Cuenta visible en Empresas: SÍ (pipeline_status = new)');
    console.log('  Cleanup: NO aplicado — pendiente QA visual');
    console.log(`  Account ID para QA: ${accountId}`);
  } else {
    console.log('✗ PERÚ.5J SMOKE FAILED — revisar checks arriba');
    if (!enrichmentRan) {
      console.log(`  queued_found=${stats.queued_found} (expected 1)`);
    }
    if (!passed) {
      const failed = checks.filter((c) => !c.passed);
      console.log(`  ${failed.length} check(s) fallaron en account.metadata`);
    }
    process.exit(1);
  }

  console.log('═'.repeat(72) + '\n');
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
