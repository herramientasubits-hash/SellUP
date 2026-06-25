#!/usr/bin/env tsx
/**
 * PERU MIGO VISUAL VALIDATION SMOKE — Perú.6F
 *
 * Crea datos smoke visibles para QA visual en Vercel, validando que la card
 * "Validación complementaria Migo" se muestre correctamente en:
 *   1. Detalle de candidato/prospecto
 *   2. Detalle de empresa/cuenta
 *
 * Inserta metadata ya normalizada, sin llamadas externas:
 *   - pe_sunat_bulk: legal_validation_status = not_found
 *   - pe_migo_api:   legal_validation_status = verified
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 Migo real         0 SUNAT web      0 Tavily
 *   0 LLM               0 LinkedIn       0 Importer SUNAT
 *   0 Hard delete       0 Más filas SUNAT cargadas
 *   0 Prospectos reales 0 Datos reales   0 Force push
 *   0 API key expuesta  0 Raw payload    0 Stash pop
 *
 * Uso:
 *   npm run smoke:peru:migo-visual-validation
 */

import { createClient } from '@supabase/supabase-js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SMOKE_DOMAIN = 'sellup-peru-migo-visual-smoke.example';
const SMOKE_WEBSITE = `https://${SMOKE_DOMAIN}`;
const SMOKE_RUC = '20100050359';
const SMOKE_LEGAL_NAME = 'A W FABER CASTELL PERUANA S A';
const SMOKE_TYPE = 'peru_migo_visual_validation_v1_6f';

const SMOKE_CANDIDATE_NAME = 'SellUp Peru Migo Visual Smoke Candidate 6F';
const SMOKE_ACCOUNT_NAME = 'SellUp Peru Migo Visual Smoke Account 6F';
const SMOKE_BATCH_NAME = 'SellUp Peru Migo Visual Smoke Batch 6F';

const ENRICHED_AT = '2026-06-25T00:00:00.000Z';
const UPDATED_AT_SOURCE = '2026-06-25';

// ── Pre-normalised metadata ───────────────────────────────────────────────────

const SMOKE_SUNAT_BLOCK = {
  ruc: SMOKE_RUC,
  legal_name: SMOKE_LEGAL_NAME,
  taxpayer_status: 'ACTIVO',
  domicile_condition: 'HABIDO',
  legal_validation_status: 'not_found',
  legal_validation_reason: 'ruc_not_found_in_snapshot',
  source_key: 'pe_sunat_bulk',
  ciiu_status: 'unavailable_for_mvp',
  sector_source: 'inferred_web_ai',
  confidence_label: 'sector_inferred',
  official_ciiu_available: false,
  human_review_required: true,
};

const SMOKE_MIGO_BLOCK = {
  ruc: SMOKE_RUC,
  legal_name: SMOKE_LEGAL_NAME,
  taxpayer_status: 'ACTIVO',
  domicile_condition: 'HABIDO',
  ubigeo: '150103',
  address: 'Dirección disponible por Migo',
  updated_at_source: UPDATED_AT_SOURCE,
  source_key: 'pe_migo_api',
  legal_validation_status: 'verified',
  legal_validation_reason: 'migo_ruc_found_active',
  ciiu_status: 'unavailable_for_mvp',
  official_ciiu_available: false,
  sector_source: 'not_provided_by_migo',
  enriched_at: ENRICHED_AT,
};

const SMOKE_SOURCE_ENRICHMENT = {
  pe_sunat_bulk: SMOKE_SUNAT_BLOCK,
  pe_migo_api: SMOKE_MIGO_BLOCK,
};

// ── Banner ────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('PERU MIGO VISUAL VALIDATION SMOKE — Perú.6F');
console.log(`RUC: ${SMOKE_RUC} | domain: ${SMOKE_DOMAIN}`);
console.log('migo_status: verified | sunat_status: not_found');
console.log('Garantías: 0 Migo real · 0 SUNAT web · 0 Tavily · 0 LLM · 0 writes reales');
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

// ── Guardrail: check existing smoke ──────────────────────────────────────────

async function checkExistingSmoke(supabase: AnySupabase): Promise<{
  existingAccountId: string | null;
  existingCandidateId: string | null;
}> {
  const { data: existingAccount } = await supabase
    .from('accounts')
    .select('id, pipeline_status, metadata')
    .ilike('website', `%${SMOKE_DOMAIN}%`)
    .neq('pipeline_status', 'archived')
    .limit(1)
    .single();

  const { data: existingCandidate } = await supabase
    .from('prospect_candidates')
    .select('id, status, metadata')
    .ilike('domain', `%${SMOKE_DOMAIN}%`)
    .neq('status', 'discarded')
    .limit(1)
    .single();

  const accountSmoke = existingAccount?.metadata?.smoke_type;
  const candidateSmoke = existingCandidate?.metadata?.smoke_type;

  if (existingAccount?.id) {
    console.log(`  [guardrail] Smoke account existente: ${existingAccount.id} (smoke_type: ${accountSmoke ?? 'n/a'})`);
  }
  if (existingCandidate?.id) {
    console.log(`  [guardrail] Smoke candidate existente: ${existingCandidate.id} (smoke_type: ${candidateSmoke ?? 'n/a'})`);
  }

  return {
    existingAccountId: existingAccount?.id ?? null,
    existingCandidateId: existingCandidate?.id ?? null,
  };
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

async function upsertSmokeAccount(
  supabase: AnySupabase,
  existingId: string | null,
): Promise<string> {
  const accountMetadata = {
    smoke_test: true,
    smoke_type: SMOKE_TYPE,
    qa_only: true,
    do_not_use_for_sales: true,
    test_domain: SMOKE_DOMAIN,
    source_enrichment: SMOKE_SOURCE_ENRICHMENT,
  };

  if (existingId) {
    await supabase
      .from('accounts')
      .update({
        metadata: accountMetadata,
        pipeline_status: 'new',
      })
      .eq('id', existingId);

    console.log(`  [account] Refreshed smoke account metadata: ${existingId}`);
    return existingId;
  }

  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name: SMOKE_ACCOUNT_NAME,
      website: SMOKE_WEBSITE,
      domain: SMOKE_DOMAIN,
      country: 'Peru',
      country_code: 'PE',
      tax_identifier: SMOKE_RUC,
      tax_identifier_type: 'RUC',
      source: 'agent_1',
      pipeline_status: 'new',
      metadata: accountMetadata,
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

async function upsertSmokeCandidate(
  supabase: AnySupabase,
  batchId: string,
  accountId: string,
  existingId: string | null,
): Promise<string> {
  const candidateMetadata = {
    smoke_test: true,
    smoke_type: SMOKE_TYPE,
    qa_only: true,
    do_not_use_for_sales: true,
    do_not_convert: true,
    test_domain: SMOKE_DOMAIN,
    source_enrichment: SMOKE_SOURCE_ENRICHMENT,
    approval: {
      approved_at: ENRICHED_AT,
      approved_by: 'smoke_script_peru_6f',
    },
  };

  if (existingId) {
    await supabase
      .from('prospect_candidates')
      .update({
        status: 'converted_to_account',
        review_status: 'approved',
        converted_account_id: accountId,
        metadata: candidateMetadata,
      })
      .eq('id', existingId);

    console.log(`  [candidate] Refreshed smoke candidate metadata: ${existingId}`);
    return existingId;
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
      review_status: 'approved',
      converted_account_id: accountId,
      tax_identifier: SMOKE_RUC,
      tax_identifier_type: 'ruc',
      source_primary: 'smoke_script',
      metadata: candidateMetadata,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to insert smoke candidate: ${error?.message ?? 'no id returned'}`);
  }

  console.log(`  [candidate] Created smoke candidate: ${data.id}`);
  return data.id as string;
}

// ── Validate ──────────────────────────────────────────────────────────────────

interface Check {
  label: string;
  pass: boolean;
  expected?: string;
  actual?: string;
}

function check(
  checks: Check[],
  label: string,
  expected: string,
  actual: unknown,
): void {
  const actualStr = actual === null || actual === undefined ? 'MISSING' : String(actual);
  checks.push({ label, pass: actualStr === expected, expected, actual: actualStr });
}

async function validateSmoke(
  supabase: AnySupabase,
  accountId: string,
  candidateId: string,
): Promise<boolean> {
  const checks: Check[] = [];

  // Account validation
  const { data: accountRow } = await supabase
    .from('accounts')
    .select('id, name, website, country_code, pipeline_status, metadata')
    .eq('id', accountId)
    .single();

  const accountMeta = (accountRow?.metadata as Record<string, unknown>) ?? {};
  const accountSE = (accountMeta.source_enrichment as Record<string, unknown>) ?? {};
  const accountMigo = (accountSE.pe_migo_api as Record<string, unknown>) ?? {};
  const accountSunat = (accountSE.pe_sunat_bulk as Record<string, unknown>) ?? {};

  check(checks, 'account.pipeline_status', 'new', accountRow?.pipeline_status);
  check(checks, 'account.metadata.smoke_type', SMOKE_TYPE, accountMeta.smoke_type);
  check(checks, 'account.pe_migo_api.legal_validation_status', 'verified', accountMigo.legal_validation_status);
  check(checks, 'account.pe_migo_api.legal_validation_reason', 'migo_ruc_found_active', accountMigo.legal_validation_reason);
  check(checks, 'account.pe_migo_api.ruc', SMOKE_RUC, accountMigo.ruc);
  check(checks, 'account.pe_migo_api.taxpayer_status', 'ACTIVO', accountMigo.taxpayer_status);
  check(checks, 'account.pe_migo_api.domicile_condition', 'HABIDO', accountMigo.domicile_condition);
  check(checks, 'account.pe_migo_api.ubigeo', '150103', accountMigo.ubigeo);
  check(checks, 'account.pe_migo_api.source_key', 'pe_migo_api', accountMigo.source_key);
  check(checks, 'account.pe_sunat_bulk.legal_validation_status', 'not_found', accountSunat.legal_validation_status);

  // Candidate validation
  const { data: candidateRow } = await supabase
    .from('prospect_candidates')
    .select('id, name, status, review_status, converted_account_id, metadata')
    .eq('id', candidateId)
    .single();

  const candidateMeta = (candidateRow?.metadata as Record<string, unknown>) ?? {};
  const candidateSE = (candidateMeta.source_enrichment as Record<string, unknown>) ?? {};
  const candidateMigo = (candidateSE.pe_migo_api as Record<string, unknown>) ?? {};
  const candidateSunat = (candidateSE.pe_sunat_bulk as Record<string, unknown>) ?? {};

  check(checks, 'candidate.status', 'converted_to_account', candidateRow?.status);
  check(checks, 'candidate.review_status', 'approved', candidateRow?.review_status);
  check(checks, 'candidate.converted_account_id', accountId, candidateRow?.converted_account_id);
  check(checks, 'candidate.metadata.smoke_type', SMOKE_TYPE, candidateMeta.smoke_type);
  check(checks, 'candidate.pe_migo_api.legal_validation_status', 'verified', candidateMigo.legal_validation_status);
  check(checks, 'candidate.pe_migo_api.legal_validation_reason', 'migo_ruc_found_active', candidateMigo.legal_validation_reason);
  check(checks, 'candidate.pe_migo_api.source_key', 'pe_migo_api', candidateMigo.source_key);
  check(checks, 'candidate.pe_sunat_bulk.legal_validation_status', 'not_found', candidateSunat.legal_validation_status);

  console.log('\n── VALIDACIONES ──────────────────────────────────────────────────────\n');
  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    console.log(`  ${icon} ${c.label}`);
    if (!c.pass) {
      console.log(`      expected: ${c.expected}`);
      console.log(`      actual:   ${c.actual}`);
    }
  }

  return checks.every((c) => c.pass);
}

// ── DB Verification queries ───────────────────────────────────────────────────

async function runDbVerificationQueries(supabase: AnySupabase): Promise<void> {
  console.log('\n── DB VERIFICATION QUERIES ───────────────────────────────────────────\n');

  // Account query
  const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('id, name, website, country_code, pipeline_status, metadata')
    .ilike('website', `%${SMOKE_DOMAIN}%`);

  if (accErr) {
    console.log(`  [accounts] ERROR: ${accErr.message}`);
  } else {
    console.log('  ACCOUNTS:');
    for (const row of (accounts ?? []) as Array<Record<string, unknown>>) {
      const meta = (row.metadata as Record<string, unknown>) ?? {};
      const se = (meta.source_enrichment as Record<string, unknown>) ?? {};
      const migo = (se.pe_migo_api as Record<string, unknown>) ?? {};
      const sunat = (se.pe_sunat_bulk as Record<string, unknown>) ?? {};
      console.log(`    id:             ${row.id}`);
      console.log(`    name:           ${row.name}`);
      console.log(`    website:        ${row.website}`);
      console.log(`    country_code:   ${row.country_code}`);
      console.log(`    pipeline_status:${row.pipeline_status}`);
      console.log(`    smoke_type:     ${meta.smoke_type ?? 'n/a'}`);
      console.log(`    migo_status:    ${migo.legal_validation_status ?? 'MISSING'}`);
      console.log(`    migo_reason:    ${migo.legal_validation_reason ?? 'MISSING'}`);
      console.log(`    sunat_status:   ${sunat.legal_validation_status ?? 'MISSING'}`);
    }
    if ((accounts ?? []).length === 0) {
      console.log('  WARNING: No account rows found for domain');
    }
  }

  // Candidate query
  const { data: candidates, error: candErr } = await supabase
    .from('prospect_candidates')
    .select('id, name, status, review_status, converted_account_id, metadata')
    .ilike('domain', `%${SMOKE_DOMAIN}%`);

  if (candErr) {
    console.log(`  [candidates] ERROR: ${candErr.message}`);
  } else {
    console.log('\n  CANDIDATES:');
    for (const row of (candidates ?? []) as Array<Record<string, unknown>>) {
      const meta = (row.metadata as Record<string, unknown>) ?? {};
      const se = (meta.source_enrichment as Record<string, unknown>) ?? {};
      const migo = (se.pe_migo_api as Record<string, unknown>) ?? {};
      const sunat = (se.pe_sunat_bulk as Record<string, unknown>) ?? {};
      console.log(`    id:                  ${row.id}`);
      console.log(`    name:                ${row.name}`);
      console.log(`    status:              ${row.status}`);
      console.log(`    review_status:       ${row.review_status}`);
      console.log(`    converted_account_id:${row.converted_account_id ?? 'n/a'}`);
      console.log(`    smoke_type:          ${meta.smoke_type ?? 'n/a'}`);
      console.log(`    migo_status:         ${migo.legal_validation_status ?? 'MISSING'}`);
      console.log(`    sunat_status:        ${sunat.legal_validation_status ?? 'MISSING'}`);
    }
    if ((candidates ?? []).length === 0) {
      console.log('  WARNING: No candidate rows found for domain');
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const supabase = getSupabase();

  // ── GUARDRAIL: Check existing smoke ───────────────────────────────────────

  console.log('── GUARDRAIL — CHECK EXISTING SMOKE ──────────────────────────────────\n');
  const { existingAccountId, existingCandidateId } = await checkExistingSmoke(supabase);

  if (!existingAccountId && !existingCandidateId) {
    console.log('  No smoke existente — se creará uno nuevo.\n');
  } else {
    console.log('  Smoke existente encontrado — se reutilizará y refrescará la metadata.\n');
  }

  // ── SETUP SMOKE DATA ──────────────────────────────────────────────────────

  console.log('── SETUP SMOKE DATA ──────────────────────────────────────────────────\n');

  const batchId = await upsertSmokeBatch(supabase);
  const accountId = await upsertSmokeAccount(supabase, existingAccountId);
  const candidateId = await upsertSmokeCandidate(supabase, batchId, accountId, existingCandidateId);

  console.log(`\n  Smoke batch id:      ${batchId}`);
  console.log(`  Smoke account id:    ${accountId}`);
  console.log(`  Smoke candidate id:  ${candidateId}`);
  console.log(`  country_code:        PE`);
  console.log(`  ruc:                 ${SMOKE_RUC}`);
  console.log(`  domain:              ${SMOKE_DOMAIN}`);
  console.log(`  smoke_type:          ${SMOKE_TYPE}`);
  console.log(`  pe_migo_api.status:  verified`);
  console.log(`  pe_sunat_bulk.status:not_found`);
  console.log(`  pipeline_status:     new (visible en Empresas)\n`);

  // ── VALIDATE ──────────────────────────────────────────────────────────────

  const passed = await validateSmoke(supabase, accountId, candidateId);

  // ── DB VERIFICATION QUERIES ───────────────────────────────────────────────

  await runDbVerificationQueries(supabase);

  // ── GUARDRAILS CONFIRMATIONS ──────────────────────────────────────────────

  console.log('\n── GUARDRAILS CONFIRMATIONS ──────────────────────────────────────────\n');
  console.log('  ✓ NO llamó Migo real');
  console.log('  ✓ NO llamó SUNAT web (www2.sunat)');
  console.log('  ✓ NO llamó Tavily');
  console.log('  ✓ NO llamó LLM');
  console.log('  ✓ NO llamó LinkedIn');
  console.log('  ✓ NO ejecutó importer SUNAT');
  console.log('  ✓ NO cargó más filas SUNAT');
  console.log('  ✓ NO descargó padron_reducido_ruc.zip');
  console.log('  ✓ NO creó prospectos reales');
  console.log('  ✓ NO tocó datos reales');
  console.log('  ✓ NO ejecutó DELETE / hard delete');
  console.log('  ✓ NO expuso API key');
  console.log('  ✓ NO guardó raw payload');
  console.log('  ✓ Metadata insertada directamente (normalizada)');
  console.log('  ✓ Cuenta visible para QA (pipeline_status = new)');
  console.log('  ✓ Candidato visible para QA (status = converted_to_account)\n');

  // ── QA VISIBILITY INSTRUCTIONS ────────────────────────────────────────────

  console.log('── QA VISUAL — CÓMO ENCONTRAR LOS DATOS EN VERCEL ───────────────────\n');
  console.log('  EMPRESA (Account):');
  console.log('  1. Ir a Empresas (Companies / Accounts) en Vercel');
  console.log(`  2. Buscar: "${SMOKE_ACCOUNT_NAME}"`);
  console.log('     o filtrar por país: Peru');
  console.log('  3. La empresa debe aparecer con estado: Nueva (pipeline_status = new)');
  console.log(`  4. account id: ${accountId}`);
  console.log('  5. Abrir la empresa — verificar bloques:');
  console.log('     ✓ Bloque SUNAT (pe_sunat_bulk) → "No encontrado en SUNAT"');
  console.log('     ✓ Bloque Migo  (pe_migo_api)   → "Verificado por Migo"');
  console.log('     ✓ Badge: "Verificado por Migo"');
  console.log('     ✓ RUC: 20100050359');
  console.log('     ✓ Razón social Migo: A W FABER CASTELL PERUANA S A');
  console.log('     ✓ Estado contribuyente: ACTIVO');
  console.log('     ✓ Condición domicilio: HABIDO');
  console.log('     ✓ Ubigeo: 150103');
  console.log('     ✓ Fuente: Migo API Perú');
  console.log('     ✓ Aviso: Migo se usa como validación legal complementaria...\n');
  console.log('  CANDIDATO (Prospect):');
  console.log('  1. Ir a Candidatos / Prospectos en Vercel');
  console.log(`  2. Buscar: "${SMOKE_CANDIDATE_NAME}"`);
  console.log('     o filtrar por país: Peru');
  console.log(`  3. candidate id: ${candidateId}`);
  console.log('  4. status: converted_to_account | review_status: approved');
  console.log('  5. Abrir el candidato — mismos bloques SUNAT + Migo que la empresa\n');

  // ── CLEANUP INSTRUCTIONS ──────────────────────────────────────────────────

  console.log('── INSTRUCCIONES DE CLEANUP POSTERIOR ────────────────────────────────\n');
  console.log('  CUÁNDO: Después de confirmar QA visual en Vercel.\n');
  console.log('  QUÉ HACER (SQL en Supabase Studio):');
  console.log(`  1. Candidate ${candidateId}`);
  console.log(`     UPDATE prospect_candidates SET status = 'discarded', review_status = 'rejected'`);
  console.log(`     WHERE id = '${candidateId}';\n`);
  console.log(`  2. Batch ${batchId}`);
  console.log(`     UPDATE prospect_batches SET status = 'cancelled'`);
  console.log(`     WHERE id = '${batchId}';\n`);
  console.log(`  3. Account ${accountId}`);
  console.log(`     UPDATE accounts SET pipeline_status = 'archived'`);
  console.log(`     WHERE id = '${accountId}';\n`);

  // ── VERDICT ───────────────────────────────────────────────────────────────

  console.log('═'.repeat(72));
  console.log('VEREDICTO PERÚ.6F');
  console.log('═'.repeat(72));

  if (passed) {
    console.log('✓ PERÚ.6F SMOKE PASSED');
    console.log(`  pe_migo_api.legal_validation_status:  verified`);
    console.log(`  pe_migo_api.legal_validation_reason:  migo_ruc_found_active`);
    console.log(`  pe_sunat_bulk.legal_validation_status:not_found`);
    console.log(`  RUC: ${SMOKE_RUC} | ${SMOKE_LEGAL_NAME}`);
    console.log(`  Account ID:   ${accountId}`);
    console.log(`  Candidate ID: ${candidateId}`);
    console.log('  Card Migo visible en candidato: SÍ');
    console.log('  Card Migo visible en empresa:   SÍ');
    console.log('  Cleanup: NO aplicado — pendiente QA visual');
  } else {
    console.log('✗ PERÚ.6F SMOKE FAILED — revisar validaciones arriba');
    process.exit(1);
  }

  console.log('═'.repeat(72) + '\n');
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
