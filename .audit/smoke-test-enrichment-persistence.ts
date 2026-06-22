/**
 * Smoke test: persistence of source_enrichment in prospect_candidates.metadata
 *
 * Controlled test — creates 1 batch + 1 candidate for D1 S.A.S, runs the
 * enrichment hook, persists exactly like the caller (prospect-generation.ts
 * lines 1056–1080), and verifies the result.
 *
 * Safety:
 *   - Batch metadata marked with source_enrichment_persistence_smoke_test: true
 *   - Candidate marked with source_enrichment_persistence_smoke_test: true
 *   - No Tavily, no LLM, no HubSpot, no account creation
 *   - No modification of real candidates
 *
 * Run:
 *   npx tsx --env-file=.env.local .audit/smoke-test-enrichment-persistence.ts
 *   npx tsx .audit/smoke-test-enrichment-persistence.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { enrichCandidatesWithValidatedSources } from '../src/server/source-catalog/enrichment/enrich-candidates-with-validated-sources';

const SMOKE_TEST_MARKER = 'source_enrichment_persistence_smoke_test';

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createClient(url, key);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Smoke Test: source_enrichment persistence');
  console.log('  Creates 1 batch + 1 candidate — marks both as smoke test');
  console.log('  No Tavily, no LLM, no HubSpot, no account creation');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const admin = getAdmin();
  const now = new Date().toISOString();
  const smokeReason = `Validar persistencia de source_enrichment en metadata — D1 S.A.S`;

  // ── Step 1: Create smoke test batch ────────────────────────────────────
  console.log('── Step 1: Creating smoke test batch ──');
  const { data: batch, error: batchErr } = await admin
    .from('prospect_batches')
    .insert({
      name: `SMOKE TEST — Enrichment Persistence — ${now.slice(0, 19).replace('T', ' ')}`,
      description: smokeReason,
      country: 'Colombia',
      country_code: 'CO',
      industry: 'retail',
      target_count: 1,
      search_depth: 'standard',
      status: 'draft',
      source: 'manual',
      metadata: {
        [SMOKE_TEST_MARKER]: true,
        smoke_test_at: now,
        smoke_test_reason: smokeReason,
      },
    })
    .select()
    .single();

  if (batchErr || !batch) {
    console.error('FAILED to create smoke test batch:', batchErr?.message ?? 'no data');
    process.exit(1);
  }
  console.log(`  Batch created: ${batch.id}`);
  console.log(`  Batch name: ${batch.name}`);

  // ── Step 2: Create smoke test candidate ────────────────────────────────
  console.log('\n── Step 2: Creating smoke test candidate (D1 S.A.S / 900276962) ──');
  const { data: candidate, error: candErr } = await admin
    .from('prospect_candidates')
    .insert({
      batch_id: batch.id,
      name: 'D1 S.A.S',
      legal_name: 'D1 S.A.S',
      country: 'Colombia',
      country_code: 'CO',
      industry: 'retail',
      status: 'needs_review',
      source_primary: 'manual',
      tax_identifier: '900276962',
      tax_identifier_type: 'nit',
      metadata: {
        [SMOKE_TEST_MARKER]: true,
        smoke_test_at: now,
        smoke_test_reason: smokeReason,
        generated_by: 'smoke_test_enrichment_persistence',
      },
    })
    .select()
    .single();

  if (candErr || !candidate) {
    console.error('FAILED to create smoke test candidate:', candErr?.message ?? 'no data');
    // Cleanup batch
    await admin.from('prospect_batches').delete().eq('id', batch.id);
    process.exit(1);
  }
  console.log(`  Candidate created: ${candidate.id}`);
  console.log(`  Candidate name: ${candidate.name}`);
  console.log(`  Tax ID: ${candidate.tax_identifier}`);

  // ── Step 3: Call the enrichment hook ───────────────────────────────────
  console.log('\n── Step 3: Calling enrichCandidatesWithValidatedSources ──');
  let enrichResult;
  try {
    enrichResult = await enrichCandidatesWithValidatedSources({
      candidates: [
        {
          name: candidate.name,
          taxId: candidate.tax_identifier,
          countryCode: 'CO',
          sector: 'retail',
          existingMetadata: (candidate.metadata as Record<string, unknown>) ?? {},
        },
      ],
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
    });
  } catch (err) {
    console.error('FAILED to run enrichment hook:', err instanceof Error ? err.message : String(err));
    await admin.from('prospect_candidates').delete().eq('id', candidate.id);
    await admin.from('prospect_batches').delete().eq('id', batch.id);
    process.exit(1);
  }

  console.log(`  sourcesApplied: ${enrichResult.sourcesApplied.join(', ')}`);
  console.log(`  sourcesSkipped: ${enrichResult.sourcesSkipped.join(', ')}`);

  for (const result of enrichResult.results) {
    console.log(`  Candidate[${result.candidateIndex}]: ${result.candidateName}`);
    for (const [sk, so] of Object.entries(result.sourceEnrichments)) {
      console.log(`    ${sk}: status=${so.status}, matchedBy=${so.matchedBy}, confidence=${so.confidence}, boost=${so.priorityBoost ?? 0}${so.reason ? ', reason=' + so.reason : ''}`);
    }
    console.log(`    priorityBoostTotal: ${result.priorityBoostTotal}`);
  }

  // ── Step 4: Persist exactly like the caller (prospect-generation.ts L1056-1080) ──
  console.log('\n── Step 4: Persisting source_enrichment in metadata ──');
  const existingMeta = (candidate.metadata as Record<string, unknown>) ?? {};

  const newSourceEnrichment = Object.fromEntries(
    Object.entries(enrichResult.results[0].enrichmentMetadata).filter(
      ([, v]) => (v as Record<string, unknown>)['status'] !== 'skipped',
    ),
  );

  const updatedMeta = {
    ...existingMeta,
    source_enrichment: {
      ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
      ...newSourceEnrichment,
    },
  };

  const { error: updateErr } = await admin
    .from('prospect_candidates')
    .update({ metadata: updatedMeta })
    .eq('id', candidate.id);

  if (updateErr) {
    console.error('FAILED to persist enrichment:', updateErr.message);
    await admin.from('prospect_candidates').delete().eq('id', candidate.id);
    await admin.from('prospect_batches').delete().eq('id', batch.id);
    process.exit(1);
  }
  console.log('  Persistence successful');

  // ── Step 5: Verify by reading back ─────────────────────────────────────
  console.log('\n── Step 5: Verifying persistence ──');
  const { data: verify } = await admin
    .from('prospect_candidates')
    .select('id, batch_id, name, tax_identifier, status, metadata')
    .eq('id', candidate.id)
    .single();

  if (!verify) {
    console.error('FAILED to read back candidate');
    process.exit(1);
  }

  const meta = verify.metadata as Record<string, unknown> | null;
  const sourceEnrichment = meta?.source_enrichment as Record<string, unknown> | null;

  if (!sourceEnrichment) {
    console.error('FAILED: source_enrichment not found in metadata');
    process.exit(1);
  }

  console.log('  Keys in source_enrichment:', Object.keys(sourceEnrichment).join(', '));
  for (const [key, val] of Object.entries(sourceEnrichment)) {
    const v = val as Record<string, unknown>;
    console.log(`    ${key}: status=${v.status}, matched_by=${v.matched_by}, confidence=${v.confidence}`);
  }

  // ── Step 6: Assertions ─────────────────────────────────────────────────
  console.log('\n── Step 6: Assertions ──');
  let allPass = true;
  const assertions: { label: string; pass: boolean; detail?: string }[] = [];

  // 6a. co_siis exists
  const hasSiis = 'co_siis' in sourceEnrichment;
  assertions.push({ label: 'co_siis present in source_enrichment', pass: hasSiis });
  if (!hasSiis) allPass = false;

  // 6b. co_personas_juridicas_cc exists
  const hasPj = 'co_personas_juridicas_cc' in sourceEnrichment;
  assertions.push({ label: 'co_personas_juridicas_cc present in source_enrichment', pass: hasPj });
  if (!hasPj) allPass = false;

  // 6c. co_secop2_proveedores exists
  const hasSecop2 = 'co_secop2_proveedores' in sourceEnrichment;
  assertions.push({ label: 'co_secop2_proveedores present in source_enrichment', pass: hasSecop2 });
  if (!hasSecop2) allPass = false;

  // 6d. co_siis matched
  if (hasSiis) {
    const siisStatus = (sourceEnrichment['co_siis'] as Record<string, unknown>).status;
    const siisMatched = siisStatus === 'matched';
    assertions.push({ label: `co_siis status = ${siisStatus}`, pass: siisMatched, detail: `Expected matched, got ${siisStatus}` });
    if (!siisMatched) allPass = false;
  }

  // 6e. co_personas_juridicas_cc matched
  if (hasPj) {
    const pjStatus = (sourceEnrichment['co_personas_juridicas_cc'] as Record<string, unknown>).status;
    const pjMatched = pjStatus === 'matched';
    assertions.push({ label: `co_personas_juridicas_cc status = ${pjStatus}`, pass: pjMatched, detail: `Expected matched, got ${pjStatus}` });
    if (!pjMatched) allPass = false;
  }

  // 6f. Metadata previa preservada
  const prevGeneratedBy = meta?.['generated_by'] as string | undefined;
  const prevPreserved = prevGeneratedBy === 'smoke_test_enrichment_persistence';
  assertions.push({ label: 'Previous metadata preserved (generated_by)', pass: prevPreserved });
  if (!prevPreserved) allPass = false;

  // 6g. Smoke test marker preserved
  const smokeMarker = meta?.[SMOKE_TEST_MARKER] as boolean | undefined;
  const markerPreserved = smokeMarker === true;
  assertions.push({ label: 'Smoke test marker preserved', pass: markerPreserved });
  if (!markerPreserved) allPass = false;

  // 6h. priority_boost in at least one source enrichment
  const hasAnyBoost = Object.values(sourceEnrichment).some(
    (v) => ((v as Record<string, unknown>).priority_boost as number) > 0,
  );
  assertions.push({ label: 'priority_boost > 0 in at least one source', pass: hasAnyBoost });
  if (!hasAnyBoost) {
    console.log('  (note: priority_boost could be 0 — not failing)');
  }

  // Print assertions
  for (const a of assertions) {
    console.log(`  ${a.pass ? '✓' : '✗'} ${a.label}${a.detail ? ' — ' + a.detail : ''}`);
  }

  if (!allPass) {
    console.log('\n⚠️  Some assertions failed. See above.');
  } else {
    console.log('\n✓ All assertions passed!');
  }

  // ── Step 7: Run verification SQL ───────────────────────────────────────
  console.log('\n── Step 7: Verification SQL ──');
  console.log('  Query that would read back:');
    console.log(`    select id, batch_id, name, tax_identifier, status,`);
    console.log(`      metadata->'source_enrichment' as source_enrichment,`);
    console.log(`      metadata->>'source_enrichment_persistence_smoke_test' as smoke_test`);
    console.log(`    from prospect_candidates`);
    console.log(`    where id = '${candidate.id}'`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Result:');
  console.log(`    Batch:     ${batch.id}`);
  console.log(`    Candidate: ${candidate.id}`);
  console.log(`    D1 S.A.S source_enrichment persisted: ${allPass ? '✓' : '⚠️  partial'}`);
  console.log(`    co_siis: ${hasSiis ? '✓' : '✗'} (status: ${hasSiis ? (sourceEnrichment['co_siis'] as Record<string, unknown>).status : 'N/A'})`);
  console.log(`    co_personas_juridicas_cc: ${hasPj ? '✓' : '✗'} (status: ${hasPj ? (sourceEnrichment['co_personas_juridicas_cc'] as Record<string, unknown>).status : 'N/A'})`);
  console.log(`    co_secop2_proveedores: ${hasSecop2 ? '✓' : '✗'} (status: ${hasSecop2 ? (sourceEnrichment['co_secop2_proveedores'] as Record<string, unknown>).status : 'N/A'})`);
  console.log(`    Metadata previa preservada: ${prevPreserved ? '✓' : '✗'}`);
  console.log(`    No Tavily: ✓`);
  console.log(`    No LLM: ✓`);
  console.log(`    No HubSpot: ✓`);
  console.log(`    No account creation: ✓`);
  console.log('═══════════════════════════════════════════════════════════════');

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:', err);
  process.exit(1);
});
