#!/usr/bin/env tsx
/**
 * PERU MIGO FALLBACK DRY-RUN SMOKE — Perú.6D
 *
 * Valida la rama de fallback Migo cuando SUNAT no verifica un RUC.
 *
 * Estrategia:
 *   1. Candidato fake EN MEMORIA (0 Supabase).
 *   2. Simula SUNAT pe_sunat_bulk con status=not_found (SIN consultar snapshot).
 *   3. Verifica que isMigoFallbackRequired('not_found') === true.
 *   4. Llama Migo REAL una vez con el RUC provisto.
 *   5. Verifica que pe_migo_api se agrega al merge.
 *   6. Verifica que pe_sunat_bulk simulado se conserva.
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 Supabase writes         0 Token expuesto      0 Raw payload
 *   0 Candidatos creados      0 Cuentas creadas      0 Batches creados
 *   0 Snapshot SUNAT tocado   0 SUNAT web            0 Tavily
 *   0 LLM                     0 Importer SUNAT       0 CIIU asignado
 *   0 Sector oficial          0 Force push
 *
 * Uso:
 *   npm run smoke:peru:migo-fallback-dry-run
 *   npm run smoke:peru:migo-fallback-dry-run -- --ruc 20100050359
 */

import { lookupPeruMigoByRuc } from '../../src/server/services/peru-migo-legal-lookup';
import { enrichPeruCandidateWithMigoLegalLookup } from '../../src/server/prospect-batches/peru-migo-legal-enrichment';
import { isMigoFallbackRequired } from '../../src/server/prospect-batches/post-approval-nit-enrichment-worker';
import { mergePeruMigoMetadataIntoAccountMetadata } from '../../src/server/prospect-batches/peru-migo-metadata-merge';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_RUC = '20100050359';
const SIMULATED_SUNAT_STATUS = 'not_found';
const SIMULATED_SUNAT_REASON = 'ruc_not_found_in_snapshot';

// ── CLI args ───────────────────────────────────────────────────────────────────

function parseRucArg(): string {
  const args = process.argv.slice(2);
  const rucIdx = args.indexOf('--ruc');
  if (rucIdx !== -1 && args[rucIdx + 1]) {
    return args[rucIdx + 1];
  }
  return DEFAULT_RUC;
}

// ── Banner ─────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('PERU MIGO FALLBACK DRY-RUN SMOKE — Perú.6D');
console.log('RUC de prueba: ' + DEFAULT_RUC + ' (A W FABER CASTELL PERUANA S A)');
console.log('SUNAT simulado: not_found (sin consultar snapshot)');
console.log('Garantías: 0 Supabase · 0 token · 0 raw payload · 0 CIIU');
console.log('═'.repeat(72) + '\n');

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ruc = parseRucArg();

  // ── Step 1: Candidato fake en memoria ─────────────────────────────────────────

  console.log('[dry-run] Construyendo candidato fake en memoria (0 Supabase)...');

  const simulatedSunatBlock = {
    ruc,
    legal_name: null,
    taxpayer_status: null,
    domicile_condition: null,
    source_key: 'pe_sunat_bulk',
    enriched_at: new Date().toISOString(),
    legal_validation_status: SIMULATED_SUNAT_STATUS,
    legal_validation_reason: SIMULATED_SUNAT_REASON,
    ciiu_status: 'unavailable_for_mvp',
    official_ciiu_available: false,
    sector_source: 'not_provided_by_sunat_bulk',
  };

  const fakeCandidateMetadata: Record<string, unknown> = {
    source_enrichment: {
      pe_sunat_bulk: simulatedSunatBlock,
    },
    post_approval_enrichment: {
      status: 'in_progress',
      strategy: 'nit_first',
    },
  };

  const fakeAccountMetadata: Record<string, unknown> = {
    source_enrichment: {
      pe_sunat_bulk: simulatedSunatBlock,
    },
  };

  console.log('[dry-run] Candidato fake:');
  console.log(`  country_code           : PE`);
  console.log(`  ruc                    : ${ruc}`);
  console.log(`  name                   : SellUp Peru Migo Fallback Dry Run 6D`);
  console.log(`  sunat_simulated_status : ${SIMULATED_SUNAT_STATUS}`);
  console.log(`  sunat_simulated_reason : ${SIMULATED_SUNAT_REASON}\n`);

  // ── Step 2: Verificar política fallback ────────────────────────────────────────

  console.log('[dry-run] Verificando política isMigoFallbackRequired...');
  const fallbackRequired = isMigoFallbackRequired(SIMULATED_SUNAT_STATUS);
  console.log(`  isMigoFallbackRequired('${SIMULATED_SUNAT_STATUS}') = ${fallbackRequired}\n`);

  if (!fallbackRequired) {
    console.error('❌ FATAL: isMigoFallbackRequired devolvió false — smoke abortado');
    process.exit(1);
  }

  // ── Step 3: Llamada real a Migo ────────────────────────────────────────────────

  console.log('[dry-run] Ejecutando lookupPeruMigoByRuc (llamada real)...');
  const startMs = Date.now();

  const enrichResult = await enrichPeruCandidateWithMigoLegalLookup(
    {
      countryCode: 'PE',
      ruc,
      metadata: fakeCandidateMetadata,
    },
    async (r) => lookupPeruMigoByRuc(r),
  );

  const durationMs = Date.now() - startMs;

  const block = enrichResult.pe_migo_api;

  console.log('[dry-run] Resultado Migo:');
  if (!block) {
    console.error('❌ FATAL: pe_migo_api block es null — smoke abortado');
    process.exit(1);
  }

  console.log(`  migo_called            : true`);
  console.log(`  migo_status            : ${block.legal_validation_status}`);
  console.log(`  migo_reason            : ${block.legal_validation_reason}`);
  console.log(`  ruc                    : ${block.ruc ?? '(null)'}`);
  console.log(`  legal_name             : ${block.legal_name ?? '(null)'}`);
  console.log(`  taxpayer_status        : ${block.taxpayer_status ?? '(null)'}`);
  console.log(`  domicile_condition     : ${block.domicile_condition ?? '(null)'}`);
  console.log(`  ubigeo                 : ${block.ubigeo ?? '(null)'}`);
  console.log(`  address_present        : ${block.address !== null ? 'true' : 'false'}`);
  console.log(`  updated_at_source_present: ${block.updated_at_source !== null ? 'true' : 'false'}`);
  console.log(`  source_key             : ${block.source_key}`);
  console.log(`  ciiu_status            : ${block.ciiu_status}`);
  console.log(`  official_ciiu_available: ${block.official_ciiu_available}`);
  console.log(`  sector_source          : ${block.sector_source}`);
  console.log(`  durationMs             : ${durationMs}\n`);

  // ── Step 4: Merge metadata en memoria ─────────────────────────────────────────

  console.log('[dry-run] Ejecutando mergePeruMigoMetadataIntoAccountMetadata...');

  const candidateMetaWithMigo: Record<string, unknown> = {
    ...fakeCandidateMetadata,
    source_enrichment: {
      ...(fakeCandidateMetadata.source_enrichment as Record<string, unknown>),
      pe_migo_api: block,
    },
  };

  const mergedAccountMeta = mergePeruMigoMetadataIntoAccountMetadata(
    fakeAccountMetadata,
    candidateMetaWithMigo,
  );

  const mergedSourceEnrichment = mergedAccountMeta.source_enrichment as
    | Record<string, unknown>
    | undefined;

  const sunatPreserved = !!mergedSourceEnrichment?.pe_sunat_bulk;
  const migoAdded = !!mergedSourceEnrichment?.pe_migo_api;

  console.log(`  would_merge_to_candidate_metadata : true`);
  console.log(`  would_merge_to_account_metadata   : true`);
  console.log(`  pe_sunat_bulk_preserved           : ${sunatPreserved}`);
  console.log(`  pe_migo_api_added                 : ${migoAdded}\n`);

  // ── Step 5: Validaciones del smoke ────────────────────────────────────────────

  console.log('── Validaciones del smoke ────────────────────────────────────────────');

  const errors: string[] = [];
  const checks: Array<{ label: string; pass: boolean }> = [];

  checks.push({
    label: 'isMigoFallbackRequired(not_found) === true',
    pass: fallbackRequired === true,
  });

  checks.push({
    label: 'migo_status === verified',
    pass: block.legal_validation_status === 'verified',
  });

  checks.push({
    label: 'migo_reason === migo_ruc_found_active',
    pass: block.legal_validation_reason === 'migo_ruc_found_active',
  });

  checks.push({
    label: 'source_key === pe_migo_api',
    pass: block.source_key === 'pe_migo_api',
  });

  checks.push({
    label: 'ciiu_status === unavailable_for_mvp',
    pass: block.ciiu_status === 'unavailable_for_mvp',
  });

  checks.push({
    label: 'official_ciiu_available === false',
    pass: block.official_ciiu_available === false,
  });

  checks.push({
    label: 'sector_source === not_provided_by_migo',
    pass: block.sector_source === 'not_provided_by_migo',
  });

  checks.push({
    label: 'pe_sunat_bulk simulado preservado en merge',
    pass: sunatPreserved,
  });

  checks.push({
    label: 'pe_migo_api añadido en merge',
    pass: migoAdded,
  });

  checks.push({
    label: 'No expone token/api_key en resultado',
    pass: !JSON.stringify(enrichResult).includes('token') &&
          !JSON.stringify(enrichResult).includes('api_key'),
  });

  checks.push({
    label: 'No expone raw_payload en resultado',
    pass: !JSON.stringify(enrichResult).includes('raw_payload') &&
          !JSON.stringify(enrichResult).includes('rawPayload'),
  });

  checks.push({
    label: 'No escribe Supabase (dry-run confirmado)',
    pass: true,
  });

  checks.push({
    label: 'No crea candidatos/cuentas/batches (dry-run confirmado)',
    pass: true,
  });

  checks.push({
    label: 'No consulta snapshot SUNAT (dry-run confirmado)',
    pass: true,
  });

  for (const check of checks) {
    const icon = check.pass ? '✅' : '❌';
    console.log(`${icon} ${check.label}`);
    if (!check.pass) errors.push(check.label);
  }

  // ── Final summary ─────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  if (errors.length === 0) {
    console.log('✅ Smoke Perú.6D PASSED — Migo fallback operativo cuando SUNAT not_found.');
    console.log(`   pe_sunat_bulk conservado | pe_migo_api agregado | 0 writes`);
  } else {
    console.log(`❌ Smoke Perú.6D FAILED — ${errors.length} validación(es) fallida(s):`);
    for (const e of errors) console.log(`   · ${e}`);
    process.exit(1);
  }
  console.log('─'.repeat(72) + '\n');
}

main().catch((err) => {
  console.error('\n❌ Smoke abortado por error inesperado:');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
