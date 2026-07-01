/**
 * DGCP RD — ETL Piloto de Snapshots
 *
 * Lee contratos de DGCP, resuelve RNC de proveedores, construye snapshots
 * y los upserta en source_company_snapshots con source_key='do_dgcp'.
 *
 * Dry-run por defecto. Requiere --apply para escribir.
 *
 * Uso:
 *   npx tsx scripts/source-catalog/run-dgcp-rd-snapshot-etl.ts --year=2026 --pages=1 --limit=20 --max-providers=10
 *   npx tsx scripts/source-catalog/run-dgcp-rd-snapshot-etl.ts --year=2026 --pages=1 --limit=5 --max-providers=3 --apply
 *
 * Guardrails de apply:
 *   - pages > 2 → bloqueado sin --confirm-large-apply
 *   - limit > 100 → bloqueado sin --confirm-large-apply
 *   - max-providers > 50 → bloqueado sin --confirm-large-apply
 *   (--confirm-large-apply NO está disponible en este hito piloto)
 *
 * No toca: accounts, prospect_candidates, rd_dgii_bulk, contact_enrichment_candidates.
 * No llama: Tavily, LLM, SUNAT, Migo, SAT, DGII.
 * No es validación fiscal — señal B2G comercial.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
import { fetchDgcpContractsPage, fetchDgcpProviderByRpe } from '../../src/server/source-catalog/connectors/dgcp-rd/dgcp-rd-client';
import { normalizeContrato, resolveProviderRnc } from '../../src/server/source-catalog/connectors/dgcp-rd/dgcp-rd-normalizer';
import {
  accumulateByRpeYear,
  buildDgcpSnapshotRow,
  DGCP_SOURCE_KEY,
  DGCP_COUNTRY_CODE,
} from '../../src/server/source-catalog/connectors/dgcp-rd/dgcp-rd-snapshot-builder';

// ─── Args ──────────────────────────────────────────────────────────────────────

type EtlArgs = {
  year: number;
  pages: number;
  limit: number;
  maxProviders: number;
  apply: boolean;
};

function parseArgs(): EtlArgs {
  const argv = process.argv.slice(2);
  let year = new Date().getFullYear();
  let pages = 1;
  let limit = 20;
  let maxProviders = 10;
  let apply = false;

  for (const arg of argv) {
    if (arg.startsWith('--year=')) year = parseInt(arg.slice('--year='.length), 10);
    else if (arg.startsWith('--pages=')) pages = parseInt(arg.slice('--pages='.length), 10);
    else if (arg.startsWith('--limit=')) limit = parseInt(arg.slice('--limit='.length), 10);
    else if (arg.startsWith('--max-providers=')) maxProviders = parseInt(arg.slice('--max-providers='.length), 10);
    else if (arg === '--apply') apply = true;
  }

  return { year, pages, limit, maxProviders, apply };
}

// ─── Guardrail apply ───────────────────────────────────────────────────────────

function assertApplyLimits(args: EtlArgs): void {
  // --confirm-large-apply no está disponible en este hito piloto
  if (args.pages > 2) {
    throw new Error(
      `[guardrail] --apply con pages=${args.pages} supera el límite de 2 páginas. ` +
      `Reduce --pages o ejecuta en dry-run.`,
    );
  }
  if (args.limit > 100) {
    throw new Error(
      `[guardrail] --apply con limit=${args.limit} supera el límite de 100. ` +
      `Reduce --limit o ejecuta en dry-run.`,
    );
  }
  if (args.maxProviders > 50) {
    throw new Error(
      `[guardrail] --apply con max-providers=${args.maxProviders} supera el límite de 50. ` +
      `Reduce --max-providers o ejecuta en dry-run.`,
    );
  }
}

// ─── Supabase ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdminSupabase(): any {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configurado. Necesario para --apply.');
  return createClient(url, serviceKey);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = !args.apply;

  console.log('');
  console.log('═'.repeat(62));
  console.log('  DGCP RD — ETL Piloto de Snapshots');
  console.log('═'.repeat(62));
  console.log(`  source_key:      ${DGCP_SOURCE_KEY}`);
  console.log(`  country_code:    ${DGCP_COUNTRY_CODE}`);
  console.log(`  year:            ${args.year}`);
  console.log(`  pages:           ${args.pages}`);
  console.log(`  limit/page:      ${args.limit}`);
  console.log(`  max-providers:   ${args.maxProviders}`);
  console.log(`  dry-run:         ${dryRun}`);
  if (!dryRun) {
    console.log('  ⚠  APPLY habilitado — se escribirá en Supabase');
  }
  console.log('─'.repeat(62));

  if (!dryRun) {
    assertApplyLimits(args);
  }

  // ── Contadores ────────────────────────────────────────────────────────────
  let contratosLeidos = 0;
  const rpeSet = new Set<string>();
  let proveedoresResueltos = 0;
  let rncValidos = 0;
  let skippedMissingRnc = 0;
  let skippedNonJuridical = 0;
  let skippedOtherRnc = 0;
  let snapshotsBuilt = 0;
  let writesRealized = 0;
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── Paso 1: Leer contratos ────────────────────────────────────────────────
  console.log('\n  [1/4] Leyendo contratos...');

  const allContratos = [];

  for (let page = 1; page <= args.pages; page++) {
    const result = await fetchDgcpContractsPage({
      page,
      limit: args.limit,
      year: args.year,
    });

    if (!result.ok) {
      const msg = `Error leyendo página ${page}: ${result.error}`;
      console.error(`       ✗ ${msg}`);
      errors.push(msg);
      break;
    }

    console.log(`       Página ${page}: ${result.contratos.length} contratos (total API: ${result.total ?? 'N/A'})`);
    allContratos.push(...result.contratos);
    contratosLeidos += result.contratos.length;

    if (result.contratos.length === 0) break;
  }

  console.log(`       → ${contratosLeidos} contratos leídos en total`);

  // ── Paso 2: Normalizar y acumular ────────────────────────────────────────
  console.log('\n  [2/4] Normalizando y acumulando por RPE/año...');

  const normalizedContratos = allContratos.map(normalizeContrato);

  for (const c of normalizedContratos) {
    if (c.rpe) rpeSet.add(c.rpe);
  }

  const accumulator = accumulateByRpeYear(normalizedContratos);
  console.log(`       → RPE únicos: ${rpeSet.size}`);
  console.log(`       → Combinaciones RPE/año acumuladas: ${accumulator.size}`);

  // ── Paso 3: Resolver proveedores por RPE ─────────────────────────────────
  console.log('\n  [3/4] Resolviendo proveedores por RPE...');

  // Agrupar accumulators por RPE para resolver cada RPE una sola vez
  const rpeList = [...new Set(
    [...accumulator.values()].map((acc) => acc.rpe),
  )].slice(0, args.maxProviders);

  console.log(`       RPE a resolver (limitado a --max-providers=${args.maxProviders}): ${rpeList.length}`);

  type ProveedorEntry = {
    rpe: string;
    normalizedRnc: string;
    proveedor: import('../../src/server/source-catalog/connectors/dgcp-rd/dgcp-rd-client').DgcpProveedor;
  };

  const resolvedProviders: ProveedorEntry[] = [];

  for (const rpe of rpeList) {
    const fetchResult = await fetchDgcpProviderByRpe(rpe);

    if (!fetchResult.ok) {
      const msg = `RPE ${rpe}: error al consultar /proveedores — ${fetchResult.error}`;
      warnings.push(msg);
      console.log(`       ⚠ ${msg}`);
      continue;
    }

    proveedoresResueltos++;

    if (!fetchResult.proveedor) {
      warnings.push(`RPE ${rpe}: proveedor no encontrado en /proveedores`);
      skippedMissingRnc++;
      continue;
    }

    const rncResult = resolveProviderRnc(fetchResult.proveedor);

    if (!rncResult.ok) {
      if (rncResult.reason === 'non_juridical_identifier') {
        skippedNonJuridical++;
        console.log(`       ↳ RPE ${rpe}: cédula/persona física — skipped (non_juridical_identifier)`);
      } else if (rncResult.reason === 'missing_rnc') {
        skippedMissingRnc++;
        console.log(`       ↳ RPE ${rpe}: RNC ausente — skipped (missing_rnc)`);
      } else {
        skippedOtherRnc++;
        console.log(`       ↳ RPE ${rpe}: ${rncResult.reason} — skipped`);
      }
      continue;
    }

    rncValidos++;
    resolvedProviders.push({
      rpe,
      normalizedRnc: rncResult.normalizedRnc,
      proveedor: fetchResult.proveedor,
    });
    console.log(`       ✓ RPE ${rpe} → RNC ${rncResult.normalizedRnc} (${fetchResult.proveedor.razon_social ?? 'sin razón social'})`);
  }

  // ── Paso 4: Construir snapshots ───────────────────────────────────────────
  console.log('\n  [4/4] Construyendo snapshots...');

  const rows = [];

  for (const { rpe, normalizedRnc, proveedor } of resolvedProviders) {
    // Buscar todos los acumuladores para este RPE
    for (const [_key, acc] of accumulator.entries()) {
      if (acc.rpe !== rpe) continue;

      const row = buildDgcpSnapshotRow({ acc, proveedor, normalizedRnc });
      rows.push(row);
      snapshotsBuilt++;
    }
  }

  console.log(`       → ${snapshotsBuilt} snapshots construidos`);

  // ── Apply ─────────────────────────────────────────────────────────────────
  if (!dryRun && rows.length > 0) {
    console.log('\n  [APPLY] Upsertando en source_company_snapshots...');
    const sb = getAdminSupabase();

    const { error: upsertErr } = await sb
      .from('source_company_snapshots')
      .upsert(rows, {
        onConflict: 'source_key,country_code,source_year,normalized_tax_id',
      });

    if (upsertErr) {
      const msg = `Upsert error: ${upsertErr.message}`;
      errors.push(msg);
      console.error(`       ✗ ${msg}`);
    } else {
      writesRealized += rows.length;
      console.log(`       ✓ ${writesRealized} filas upsertadas con source_key='${DGCP_SOURCE_KEY}'`);
    }
  } else if (!dryRun && rows.length === 0) {
    console.log('\n  [APPLY] Sin filas para upsert.');
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(62));
  console.log('  RESUMEN');
  console.log('─'.repeat(62));
  console.log(`  Contratos leídos:           ${contratosLeidos}`);
  console.log(`  RPE únicos:                 ${rpeSet.size}`);
  console.log(`  Proveedores resueltos:       ${proveedoresResueltos}`);
  console.log(`  RNC válidos (jurídicos):     ${rncValidos}`);
  console.log(`  Skipped missing_rnc:         ${skippedMissingRnc}`);
  console.log(`  Skipped non_juridical:       ${skippedNonJuridical}`);
  console.log(`  Skipped other:              ${skippedOtherRnc}`);
  console.log(`  Snapshots construidos:       ${snapshotsBuilt}`);
  console.log(`  Writes realizados:           ${writesRealized}`);
  if (dryRun) {
    console.log(`  Modo:                       DRY-RUN (sin escrituras)`);
  } else {
    console.log(`  Modo:                       APPLY (${writesRealized} filas en source_company_snapshots)`);
  }
  if (warnings.length > 0) {
    console.log(`\n  Warnings (${warnings.length}):`);
    for (const w of warnings) console.log(`    ⚠ ${w}`);
  }
  if (errors.length > 0) {
    console.log(`\n  Errores (${errors.length}):`);
    for (const e of errors) console.log(`    ✗ ${e}`);
    console.log('');
    process.exit(1);
  }
  console.log('');
  console.log('  ✓ ETL piloto DGCP RD completado.');
  console.log('═'.repeat(62));
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
