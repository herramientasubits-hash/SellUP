/**
 * Smoke test: enrich-candidates-with-validated-sources
 *
 * Read-only. No writes to Supabase. No HubSpot. No prospect creation.
 * Three scenarios:
 *   1. D1 S.A.S (NIT: 900276962) — empresa real con B2G
 *   2. ECOPETROL S.A (NIT: 899999068) — gran empresa, no esperado en SECOP
 *   3. ECOPTROL S.A (NIT: null) — sin NIT
 */

import { enrichCandidatesWithValidatedSources } from '../src/server/source-catalog/enrichment/enrich-candidates-with-validated-sources';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Smoke Test: enrichCandidatesWithValidatedSources');
  console.log('  Read-only — No writes, no HubSpot, no prospect creation');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Scenario 1: D1 S.A.S ──
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Scenario 1: D1 S.A.S (NIT: 900276962)');
  console.log('  Esperado: SIIS=matched, PERS_JURIDICAS=matched, SECOP2=matched');
  console.log('───────────────────────────────────────────────────────────────');
  try {
    const r1 = await enrichCandidatesWithValidatedSources({
      candidates: [
        {
          name: 'D1 S.A.S',
          taxId: '900276962',
          countryCode: 'CO',
          sector: 'retail',
        },
      ],
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
    });
    for (const result of r1.results) {
      console.log(`  Candidate[${result.candidateIndex}]: ${result.candidateName}`);
      for (const [sk, so] of Object.entries(result.sourceEnrichments)) {
        console.log(`    ${sk}: status=${so.status}, matchedBy=${so.matchedBy}, confidence=${so.confidence}, boost=${so.priorityBoost ?? 0}${so.reason ? ', reason=' + so.reason : ''}`);
        if (so.signals && Object.keys(so.signals).length > 0) {
          console.log(`      signals: ${JSON.stringify(so.signals)}`);
        }
      }
      console.log(`    priorityBoostTotal: ${result.priorityBoostTotal}`);
    }
    console.log(`  sourcesApplied: ${r1.sourcesApplied.join(', ')}`);
    console.log(`  sourcesSkipped: ${r1.sourcesSkipped.join(', ')}`);
    console.log(`  warnings: ${r1.warnings.length ? r1.warnings.join('; ') : '(none)'}`);
    console.log(`  errors: ${r1.errors.length ? r1.errors.join('; ') : '(none)'}`);
  } catch (err) {
    console.error('  SCENARIO 1 FAILED:', err);
  }

  // ── Scenario 2: ECOPETROL S.A ──
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('  Scenario 2: ECOPETROL S.A (NIT: 899999068)');
  console.log('  Esperado: SIIS=matched, PERS_JURIDICAS=matched, SECOP2=no_match');
  console.log('───────────────────────────────────────────────────────────────');
  try {
    const r2 = await enrichCandidatesWithValidatedSources({
      candidates: [
        {
          name: 'ECOPETROL S.A',
          taxId: '899999068',
          countryCode: 'CO',
          sector: 'energia',
        },
      ],
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
    });
    for (const result of r2.results) {
      console.log(`  Candidate[${result.candidateIndex}]: ${result.candidateName}`);
      for (const [sk, so] of Object.entries(result.sourceEnrichments)) {
        console.log(`    ${sk}: status=${so.status}, matchedBy=${so.matchedBy}, confidence=${so.confidence}, boost=${so.priorityBoost ?? 0}${so.reason ? ', reason=' + so.reason : ''}`);
      }
      console.log(`    priorityBoostTotal: ${result.priorityBoostTotal}`);
    }
    console.log(`  sourcesApplied: ${r2.sourcesApplied.join(', ')}`);
    console.log(`  sourcesSkipped: ${r2.sourcesSkipped.join(', ')}`);
  } catch (err) {
    console.error('  SCENARIO 2 FAILED:', err);
  }

  // ── Scenario 3: Sin NIT ──
  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('  Scenario 3: ECOPETROL S.A (sin NIT)');
  console.log('  Esperado: PERS_JURIDICAS=skipped, SECOP2=skipped, SIIS=matched(byName) o no_match');
  console.log('  El hook no debe romperse');
  console.log('───────────────────────────────────────────────────────────────');
  try {
    const r3 = await enrichCandidatesWithValidatedSources({
      candidates: [
        {
          name: 'ECOPETROL S.A',
          taxId: null,
          countryCode: 'CO',
          sector: 'energia',
        },
      ],
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
    });
    for (const result of r3.results) {
      console.log(`  Candidate[${result.candidateIndex}]: ${result.candidateName}`);
      for (const [sk, so] of Object.entries(result.sourceEnrichments)) {
        console.log(`    ${sk}: status=${so.status}, matchedBy=${so.matchedBy}, confidence=${so.confidence}, boost=${so.priorityBoost ?? 0}${so.reason ? ', reason=' + so.reason : ''}`);
      }
      console.log(`    priorityBoostTotal: ${result.priorityBoostTotal}`);
    }
    console.log(`  sourcesApplied: ${r3.sourcesApplied.join(', ')}`);
    console.log(`  sourcesSkipped: ${r3.sourcesSkipped.join(', ')}`);
  } catch (err) {
    console.error('  SCENARIO 3 FAILED:', err);
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  Smoke test complete — no writes performed, no HubSpot, no prospects');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:', err);
  process.exit(1);
});
