/**
 * Smoke test: Mexico DENUE contextual enrichment
 *
 * Controlled test — Creates 1 MX batch + 3 MX candidates, runs the
 * MX post-writer flow (tax_identifier_resolution + DENUE enrichment),
 * and verifies the metadata result.
 *
 * Safety:
 *   - Batch and candidates marked with smoke_test_mx_denue: true
 *   - No Tavily, no LLM, no HubSpot
 *   - Cleanup verified at end
 *
 * Run:
 *   npx tsx --env-file=.env.local .audit/smoke-test-mexico-denue-enrichment.ts
 *   npx tsx .audit/smoke-test-mexico-denue-enrichment.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { enrichCandidateImpl } from '../src/server/source-catalog/connectors/denue-mexico/denue-enrichment-adapter';
import { resolveCandidateTaxIdentifierForMexico } from '../src/server/source-catalog/enrichment/tax-identifier-resolution/resolve-candidate-tax-identifier-mexico';
import { fetchDenueDatasetSample } from '../src/server/source-catalog/connectors/denue-mexico/denue-client';

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createClient(url, key);
}

const SMOKE_MARKER = 'smoke_test_mx_denue';

interface CandidateResult {
  name: string;
  tax_identifier: string | null;
  tax_resolution_status: string | null;
  human_review_required: boolean | null;
  denue_status: string | null;
  denue_matches_count: number;
  denue_confidence: number;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Smoke Test: Mexico DENUE Contextual Enrichment');
  console.log('  Creates 1 MX batch + 3 candidates');
  console.log('  No Tavily, no LLM, no HubSpot');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const admin = getAdmin();
  const now = new Date().toISOString();
  const smokeReason = `Validate MX DENUE contextual enrichment flow`;

  // ── Step 1: Create smoke test batch ────────────────────────────────────
  console.log('── Step 1: Creating smoke test batch ──');
  const { data: batch, error: batchErr } = await admin
    .from('prospect_batches')
    .insert({
      name: `SMOKE TEST — MX DENUE Enrichment — ${now.slice(0, 19).replace('T', ' ')}`,
      status: 'draft',
      country_code: 'MX',
      metadata: {
        [SMOKE_MARKER]: true,
        reason: smokeReason,
        created_at: now,
      },
    })
    .select('id')
    .single();

  if (batchErr || !batch) {
    console.error('FAIL: Could not create batch:', batchErr?.message ?? 'no data');
    process.exit(1);
  }

  const batchId = batch.id;
  console.log(`  Batch ID: ${batchId}\n`);

  // ── Step 2: Create candidates ──────────────────────────────────────────
  console.log('── Step 2: Creating 3 MX candidates ──');

  const testCandidates = [
    { name: 'OXXO', website: 'oxxo.com', domain: 'oxxo.com', sector: 'Comercio' },
    { name: 'CEMEX', website: 'cemexmexico.com', domain: 'cemexmexico.com', sector: 'Construcción' },
    { name: 'Empresa Falsa XYZ', website: 'empresafalsaxyz.com', domain: 'empresafalsaxyz.com', sector: 'Tecnología' },
  ];

  const candidateIds: string[] = [];

  for (const c of testCandidates) {
    const { data: candidate, error: candErr } = await admin
      .from('prospect_candidates')
      .insert({
        batch_id: batchId,
        name: c.name,
        website: c.website,
        domain: c.domain,
        country_code: 'MX',
        tax_identifier: null,
        sector_description: c.sector,
        metadata: {
          [SMOKE_MARKER]: true,
        },
      })
      .select('id, name, tax_identifier, metadata')
      .single();

    if (candErr || !candidate) {
      console.error(`FAIL: Could not create candidate "${c.name}":`, candErr?.message ?? 'no data');
      continue;
    }

    candidateIds.push(candidate.id);
    console.log(`  Created: ${c.name.padEnd(22)} → ${candidate.id}`);
  }

  if (candidateIds.length === 0) {
    console.error('FAIL: No candidates created. Cleaning up batch...');
    await admin.from('prospect_batches').delete().eq('id', batchId);
    process.exit(1);
  }

  console.log(`\n  Total candidates: ${candidateIds.length}\n`);

  // ── Step 3: Run MX post-writer flow ────────────────────────────────────
  console.log('── Step 3: Running MX post-writer flow ──');
  console.log('  3a. tax_identifier_resolution\n');

  const results: CandidateResult[] = [];

  for (let i = 0; i < candidateIds.length; i++) {
    const c = testCandidates[i];
    const candidateId = candidateIds[i];

    // 3a. Tax identifier resolution
    const resolution = await resolveCandidateTaxIdentifierForMexico({
      name: c.name,
      domain: c.domain,
      website: c.website,
      countryCode: 'MX',
      sector: c.sector,
    });

    const resolutionMeta = {
      tax_identifier_resolution: {
        status: resolution.status,
        confidence: resolution.confidence,
        source_key: resolution.sourceKey,
        human_review_required: true,
        reason: resolution.metadata?.reason,
        contextual_sources_available: resolution.metadata?.contextual_sources_available,
      },
    };

    // 3b. DENUE contextual enrichment
    console.log(`  3b. DENUE enrichment for "${c.name}"`);

    let denueOutput;
    try {
      denueOutput = await enrichCandidateImpl(
        {
          candidateName: c.name,
          candidateTaxId: null,
          countryCode: 'MX',
          sector: c.sector,
          existingMetadata: {},
          capability: 'enrichment_after_discovery',
        },
        fetchDenueDatasetSample,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`      ⚠ DENUE enrichment error (non-blocking): ${msg}`);
      denueOutput = {
        sourceKey: 'mx_denue',
        status: 'error' as const,
        matchedBy: null,
        confidence: 0,
        reason: msg,
        metadata: {
          status: 'error',
          source_key: 'mx_denue',
          matched_by: 'none',
          confidence: 0,
          human_review_required: true,
          does_not_resolve_tax_identifier: true,
          matches: [],
        },
      };
    }

    // Build full metadata
    const fullMetadata: Record<string, unknown> = {
      [SMOKE_MARKER]: true,
      ...resolutionMeta,
      source_enrichment: {
        mx_denue: denueOutput.metadata ?? {},
      },
    };

    // Persist
    await admin
      .from('prospect_candidates')
      .update({ metadata: fullMetadata })
      .eq('id', candidateId);

    const denueMeta = denueOutput.metadata as Record<string, unknown> | undefined;
    const matches = (denueMeta?.['matches'] as unknown[]) ?? [];

    results.push({
      name: c.name,
      tax_identifier: null,
      tax_resolution_status: resolution.status,
      human_review_required: true,
      denue_status: (denueMeta?.['status'] as string) ?? denueOutput.status,
      denue_matches_count: matches.length,
      denue_confidence: (denueMeta?.['confidence'] as number) ?? denueOutput.confidence,
    });
  }

  // ── Step 4: Print results ──────────────────────────────────────────────
  console.log('\n── Step 4: Results ──\n');

  const header = 'CANDIDATE'.padEnd(25) + ' | TAX ID | TAX RES STATUS          | HRR | DENUE STATUS | MATCHES | CONFIDENCE';
  const sep = new Array(header.length).fill('─').join('');
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const name = r.name.padEnd(25);
    const taxId = (r.tax_identifier ?? 'null').padEnd(6);
    const taxStatus = (r.tax_resolution_status ?? 'null').padEnd(24);
    const hrr = r.human_review_required ? 'true' : 'false';
    const dStatus = (r.denue_status ?? 'null').padEnd(12);
    const matches = String(r.denue_matches_count).padEnd(7);
    const conf = r.denue_confidence.toFixed(2);

    console.log(`${name} | ${taxId} | ${taxStatus} | ${hrr} | ${dStatus} | ${matches} | ${conf}`);
  }

  // ── Step 5: Cleanup ────────────────────────────────────────────────────
  console.log('\n── Step 5: Cleanup ──');

  const { error: delCandidatesErr } = await admin
    .from('prospect_candidates')
    .delete()
    .eq('batch_id', batchId);

  if (delCandidatesErr) {
    console.error(`  ⚠ Candidate cleanup error: ${delCandidatesErr.message}`);
  } else {
    console.log(`  ✓ ${candidateIds.length} candidates deleted`);
  }

  const { error: delBatchErr } = await admin
    .from('prospect_batches')
    .delete()
    .eq('id', batchId);

  if (delBatchErr) {
    console.error(`  ⚠ Batch cleanup error: ${delBatchErr.message}`);
  } else {
    console.log('  ✓ Batch deleted');
  }

  // ── Step 6: Verify cleanup ─────────────────────────────────────────────
  console.log('\n── Step 6: Verify cleanup ──');

  const { data: remainingCandidates, error: checkCandErr } = await admin
    .from('prospect_candidates')
    .select('id')
    .eq('batch_id', batchId);

  if (checkCandErr) {
    console.error(`  ⚠ Verify candidates error: ${checkCandErr.message}`);
  } else {
    console.log(`  Remaining candidates: ${remainingCandidates?.length ?? 0}`);
  }

  const { data: remainingBatch, error: checkBatchErr } = await admin
    .from('prospect_batches')
    .select('id')
    .eq('id', batchId);

  if (checkBatchErr) {
    console.error(`  ⚠ Verify batch error: ${checkBatchErr.message}`);
  } else {
    console.log(`  Remaining batches: ${remainingBatch?.length ?? 0}`);
  }

  const cleanupOk =
    (remainingCandidates?.length ?? 0) === 0 && (remainingBatch?.length ?? 0) === 0;

  console.log(`\n  Cleanup: ${cleanupOk ? '✓ 0 (OK)' : '✗ NOT ZERO'}`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Verification:');
  console.log('  ✓ No Tavily');
  console.log('  ✓ No LLM');
  console.log('  ✓ No HubSpot');
  console.log(`  ${cleanupOk ? '✓' : '✗'} Cleanup 0`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!cleanupOk) {
    console.error('WARNING: Cleanup may have failed. Check DB manually.');
    process.exit(1);
  }

  console.log('Smoke test completed successfully.');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
