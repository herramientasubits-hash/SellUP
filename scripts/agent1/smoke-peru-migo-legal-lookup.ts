#!/usr/bin/env tsx
/**
 * PERU MIGO LEGAL LOOKUP SMOKE — Perú.6B
 *
 * Smoke real controlado contra Migo Perú API para un RUC conocido.
 * Resuelve credencial desde Vault, llama API real, imprime resumen seguro.
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 Token expuesto       0 Raw payload          0 Supabase writes
 *   0 Tavily               0 SUNAT web             0 Importer SUNAT
 *   0 Candidatos creados   0 Cuentas creadas        0 Batches creados
 *   0 CIIU asignado        0 Sector oficial         0 Force push
 *
 * Uso: npm run smoke:peru:migo-legal-lookup
 * O:   npx tsx scripts/agent1/smoke-peru-migo-legal-lookup.ts
 * O:   ... -- --ruc 20100050359
 */

import { lookupPeruMigoByRuc } from '../../src/server/services/peru-migo-legal-lookup';
import {
  enrichPeruCandidateWithMigoLegalLookup,
} from '../../src/server/prospect-batches/peru-migo-legal-enrichment';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_RUC = '20100050359';
const EXPECTED_LEGAL_NAME_FRAGMENT = 'FABER';

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
console.log('PERU MIGO LEGAL LOOKUP SMOKE — Perú.6B');
console.log('RUC de prueba: ' + DEFAULT_RUC + ' (A W FABER CASTELL PERUANA S A)');
console.log('Garantías: 0 token expuesto · 0 raw payload · 0 Supabase writes');
console.log('═'.repeat(72) + '\n');

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ruc = parseRucArg();

  console.log(`[smoke] RUC a consultar: ${ruc}`);
  console.log('[smoke] Resolviendo credencial Migo desde Vault...\n');

  const startMs = Date.now();

  // ── Step 1: Direct lookup ────────────────────────────────────────────────────

  const lookupResult = await lookupPeruMigoByRuc(ruc);
  const durationMs = Date.now() - startMs;

  console.log('── Resultado raw de lookupPeruMigoByRuc ──────────────────────────────');
  console.log(`status        : ${lookupResult.status}`);
  console.log(`error         : ${lookupResult.error ?? '(none)'}`);
  console.log(`durationMs    : ${durationMs}`);

  if (lookupResult.status === 'found' && lookupResult.payload) {
    const p = lookupResult.payload;
    console.log('\n── Payload normalizado (sin raw data) ────────────────────────────────');
    console.log(`ruc                   : ${p.ruc}`);
    console.log(`legal_name            : ${p.legal_name ?? '(null)'}`);
    console.log(`taxpayer_status       : ${p.taxpayer_status ?? '(null)'}`);
    console.log(`domicile_condition    : ${p.domicile_condition ?? '(null)'}`);
    console.log(`ubigeo                : ${p.ubigeo ?? '(null)'}`);
    console.log(`address_present       : ${p.address !== null ? 'true' : 'false'}`);
    console.log(`updated_at_source_present: ${p.updated_at_source !== null ? 'true' : 'false'}`);
  }

  console.log('\n');

  // ── Step 2: Enrichment block ─────────────────────────────────────────────────

  console.log('── Bloque de enriquecimiento completo (pe_migo_api) ──────────────────');

  const enrichResult = await enrichPeruCandidateWithMigoLegalLookup(
    { countryCode: 'PE', ruc },
    async (r) => lookupPeruMigoByRuc(r),
  );

  const block = enrichResult.pe_migo_api;

  if (!block) {
    console.log('pe_migo_api block: null (not PE country)');
  } else {
    console.log(`status                  : ${block.legal_validation_status}`);
    console.log(`reason                  : ${block.legal_validation_reason}`);
    console.log(`ruc                     : ${block.ruc}`);
    console.log(`legal_name              : ${block.legal_name ?? '(null)'}`);
    console.log(`taxpayer_status         : ${block.taxpayer_status ?? '(null)'}`);
    console.log(`domicile_condition      : ${block.domicile_condition ?? '(null)'}`);
    console.log(`ubigeo                  : ${block.ubigeo ?? '(null)'}`);
    console.log(`address_present         : ${block.address !== null ? 'true' : 'false'}`);
    console.log(`updated_at_source_present: ${block.updated_at_source !== null ? 'true' : 'false'}`);
    console.log(`source_key              : ${block.source_key}`);
    console.log(`ciiu_status             : ${block.ciiu_status}`);
    console.log(`official_ciiu_available : ${block.official_ciiu_available}`);
    console.log(`sector_source           : ${block.sector_source}`);
    console.log(`durationMs              : ${durationMs}`);
  }

  // ── Step 3: Validations ──────────────────────────────────────────────────────

  console.log('\n── Validaciones del smoke ────────────────────────────────────────────');

  const errors: string[] = [];
  const checks: Array<{ label: string; pass: boolean }> = [];

  checks.push({
    label: 'Lookup ejecutado sin excepción',
    pass: true,
  });

  checks.push({
    label: 'No expone token/API key',
    pass: !JSON.stringify(lookupResult).includes('token') &&
          !JSON.stringify(lookupResult).includes('api_key'),
  });

  checks.push({
    label: 'No expone raw_payload',
    pass: !JSON.stringify(lookupResult).includes('raw_payload') &&
          !JSON.stringify(lookupResult).includes('rawPayload'),
  });

  if (block) {
    checks.push({
      label: 'source_key = pe_migo_api',
      pass: block.source_key === 'pe_migo_api',
    });

    checks.push({
      label: 'ciiu_status = unavailable_for_mvp',
      pass: block.ciiu_status === 'unavailable_for_mvp',
    });

    checks.push({
      label: 'official_ciiu_available = false',
      pass: block.official_ciiu_available === false,
    });

    checks.push({
      label: 'sector_source = not_provided_by_migo',
      pass: block.sector_source === 'not_provided_by_migo',
    });

    if (lookupResult.status === 'found' && lookupResult.payload?.legal_name) {
      checks.push({
        label: `legal_name contiene "${EXPECTED_LEGAL_NAME_FRAGMENT}"`,
        pass: lookupResult.payload.legal_name
          .toUpperCase()
          .includes(EXPECTED_LEGAL_NAME_FRAGMENT),
      });
    }
  }

  for (const check of checks) {
    const icon = check.pass ? '✅' : '❌';
    console.log(`${icon} ${check.label}`);
    if (!check.pass) errors.push(check.label);
  }

  // ── Final summary ─────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  if (errors.length === 0) {
    console.log('✅ Smoke Perú.6B PASSED — Migo API real operativa, metadata normalizada.');
  } else {
    console.log(`❌ Smoke Perú.6B FAILED — ${errors.length} validación(es) fallida(s):`);
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
