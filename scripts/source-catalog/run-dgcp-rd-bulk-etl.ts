/**
 * DGCP RD — ETL Bulk de Snapshots (RepúblicaDominicana.2G)
 *
 * Descarga /tablas/proveedores y /tablas/contratos en bulk (XLSX),
 * los parsea localmente y upserta en source_company_snapshots (source_key='do_dgcp').
 *
 * Ventaja sobre el paginado: evita N+1 de /proveedores?rpe=X y cubre el
 * universo completo de proveedores DGCP (135k+) en una sola operación.
 *
 * Uso (dry-run por defecto):
 *   npx tsx scripts/source-catalog/run-dgcp-rd-bulk-etl.ts --year-from=2020 --year-to=2026
 *   npx tsx scripts/source-catalog/run-dgcp-rd-bulk-etl.ts --year-from=2020 --year-to=2026 --apply --confirm-large-apply
 *   npx tsx scripts/source-catalog/run-dgcp-rd-bulk-etl.ts --providers-file=/tmp/Proveedores.xlsx --contracts-file=/tmp/Contratos.xlsx --year-from=2020 --apply --confirm-large-apply
 *
 * Guardrails:
 *   - Dry-run por defecto (requiere --apply para escribir)
 *   - --apply con >5.000 snapshots requiere --confirm-large-apply
 *   - Solo escribe en source_company_snapshots con source_key='do_dgcp'
 *   - No toca: accounts, prospect_candidates, rd_dgii_bulk, source_catalog
 *   - No llama: Tavily, LLM, SUNAT, DGII, Migo, SAT
 *   - No crea candidates ni cuentas
 *   - No es validación fiscal — señal B2G comercial
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import {
  parseDgcpProveedoresXlsx,
  parseDgcpContratosXlsx,
  downloadDgcpXlsx,
} from '../../src/server/source-catalog/connectors/dgcp-rd/dgcp-rd-bulk-parser';
import {
  normalizeContrato,
  resolveProviderRnc,
} from '../../src/server/source-catalog/connectors/dgcp-rd/dgcp-rd-normalizer';
import {
  accumulateByRpeYear,
  buildDgcpSnapshotRow,
  DGCP_SOURCE_KEY,
  DGCP_COUNTRY_CODE,
  type DgcpSnapshotRow,
} from '../../src/server/source-catalog/connectors/dgcp-rd/dgcp-rd-snapshot-builder';

// ─── DGCP bulk URLs ────────────────────────────────────────────────────────────

const DGCP_BULK_PROVIDERS_URL =
  'https://datosabiertos.dgcp.gob.do/api-dgcp/v1/tablas/proveedores';
const DGCP_BULK_CONTRACTS_URL =
  'https://datosabiertos.dgcp.gob.do/api-dgcp/v1/tablas/contratos';

// ─── Args ──────────────────────────────────────────────────────────────────────

type BulkEtlArgs = {
  yearFrom: number | undefined;
  yearTo: number | undefined;
  apply: boolean;
  confirmLargeApply: boolean;
  providersFile: string | undefined;
  contractsFile: string | undefined;
  batchSize: number;
};

function parseArgs(): BulkEtlArgs {
  const argv = process.argv.slice(2);
  let yearFrom: number | undefined;
  let yearTo: number | undefined;
  let apply = false;
  let confirmLargeApply = false;
  let providersFile: string | undefined;
  let contractsFile: string | undefined;
  let batchSize = 500;

  for (const arg of argv) {
    if (arg.startsWith('--year-from=')) yearFrom = parseInt(arg.slice('--year-from='.length), 10);
    else if (arg.startsWith('--year-to=')) yearTo = parseInt(arg.slice('--year-to='.length), 10);
    else if (arg === '--apply') apply = true;
    else if (arg === '--confirm-large-apply') confirmLargeApply = true;
    else if (arg.startsWith('--providers-file=')) providersFile = arg.slice('--providers-file='.length);
    else if (arg.startsWith('--contracts-file=')) contractsFile = arg.slice('--contracts-file='.length);
    else if (arg.startsWith('--batch-size=')) batchSize = parseInt(arg.slice('--batch-size='.length), 10);
  }

  return { yearFrom, yearTo, apply, confirmLargeApply, providersFile, contractsFile, batchSize };
}

// ─── Supabase ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdminSupabase(): any {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurado. Necesario para --apply.');
  }
  return createClient(url, serviceKey);
}

// ─── Upsert in batches ─────────────────────────────────────────────────────────

async function upsertInBatches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  rows: DgcpSnapshotRow[],
  batchSize: number,
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await sb
      .from('source_company_snapshots')
      .upsert(batch, {
        onConflict: 'source_key,country_code,source_year,normalized_tax_id',
      });

    if (error) {
      const msg = `Batch ${Math.floor(i / batchSize) + 1} error: ${error.message}`;
      errors.push(msg);
      console.error(`       ✗ ${msg}`);
    } else {
      upserted += batch.length;
      const pct = Math.round(((i + batch.length) / rows.length) * 100);
      console.log(
        `       ✓ Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} filas (${pct}% completado)`,
      );
    }
  }

  return { upserted, errors };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = !args.apply;
  const importedAt = new Date().toISOString();

  console.log('');
  console.log('═'.repeat(66));
  console.log('  DGCP RD — ETL Bulk de Snapshots (RD.2G)');
  console.log('═'.repeat(66));
  console.log(`  source_key:           ${DGCP_SOURCE_KEY}`);
  console.log(`  country_code:         ${DGCP_COUNTRY_CODE}`);
  console.log(`  year-from:            ${args.yearFrom ?? '(todos)'}`);
  console.log(`  year-to:              ${args.yearTo ?? '(todos)'}`);
  console.log(`  batch-size:           ${args.batchSize}`);
  console.log(`  dry-run:              ${dryRun}`);
  if (!dryRun) {
    console.log('  ⚠  APPLY habilitado — se escribirá en Supabase');
  }
  console.log('─'.repeat(66));

  // ── Paso 0: Resolver archivos XLSX ────────────────────────────────────────
  let providersFile = args.providersFile;
  let contractsFile = args.contractsFile;
  const tmpDir = os.tmpdir();

  if (!providersFile) {
    providersFile = path.join(tmpDir, `dgcp-proveedores-${Date.now()}.xlsx`);
    console.log('\n  [0/5] Descargando Proveedores.xlsx...');
    console.log(`        URL: ${DGCP_BULK_PROVIDERS_URL}`);
    const dlResult = await downloadDgcpXlsx(
      DGCP_BULK_PROVIDERS_URL,
      providersFile,
      90_000,
    );
    if (!dlResult.ok) {
      console.error(`\n  [FATAL] No se pudo descargar Proveedores.xlsx: ${dlResult.error}`);
      process.exit(1);
    }
    const sizeMb = (dlResult.byteSize / 1_048_576).toFixed(1);
    console.log(`        ✓ Descargado: ${sizeMb} MB → ${providersFile}`);
  } else {
    if (!fs.existsSync(providersFile)) {
      console.error(`\n  [FATAL] --providers-file no existe: ${providersFile}`);
      process.exit(1);
    }
    const sizeMb = (fs.statSync(providersFile).size / 1_048_576).toFixed(1);
    console.log(`\n  [0/5] Usando Proveedores.xlsx local: ${providersFile} (${sizeMb} MB)`);
  }

  if (!contractsFile) {
    contractsFile = path.join(tmpDir, `dgcp-contratos-${Date.now()}.xlsx`);
    console.log('\n  [0b] Descargando Contratos.xlsx...');
    console.log(`       URL: ${DGCP_BULK_CONTRACTS_URL}`);
    const dlResult = await downloadDgcpXlsx(
      DGCP_BULK_CONTRACTS_URL,
      contractsFile,
      120_000,
    );
    if (!dlResult.ok) {
      console.error(`\n  [FATAL] No se pudo descargar Contratos.xlsx: ${dlResult.error}`);
      process.exit(1);
    }
    const sizeMb = (dlResult.byteSize / 1_048_576).toFixed(1);
    console.log(`       ✓ Descargado: ${sizeMb} MB → ${contractsFile}`);
  } else {
    if (!fs.existsSync(contractsFile)) {
      console.error(`\n  [FATAL] --contracts-file no existe: ${contractsFile}`);
      process.exit(1);
    }
    const sizeMb = (fs.statSync(contractsFile).size / 1_048_576).toFixed(1);
    console.log(`\n  [0b] Usando Contratos.xlsx local: ${contractsFile} (${sizeMb} MB)`);
  }

  // ── Paso 1: Parsear Proveedores.xlsx ─────────────────────────────────────
  console.log('\n  [1/5] Parseando Proveedores.xlsx...');
  const { map: proveedoresMap, stats: pStats } = parseDgcpProveedoresXlsx(providersFile);
  console.log(`       → Filas leídas:   ${pStats.totalRowsRead}`);
  console.log(`       → Proveedores OK: ${pStats.validRows} (con RPE válido)`);
  console.log(`       → Skipped:        ${pStats.skippedRows}`);
  console.log(`       → RPE únicos en mapa: ${proveedoresMap.size}`);

  // ── Paso 2: Parsear Contratos.xlsx ────────────────────────────────────────
  console.log('\n  [2/5] Parseando Contratos.xlsx...');
  const yearFilter =
    args.yearFrom != null || args.yearTo != null
      ? { from: args.yearFrom, to: args.yearTo }
      : undefined;

  if (yearFilter) {
    console.log(
      `       Filtro de año: ${yearFilter.from ?? '∞'} – ${yearFilter.to ?? '∞'}`,
    );
  }

  const { contratos: rawContratos, stats: cStats } = parseDgcpContratosXlsx(
    contractsFile,
    yearFilter,
  );
  console.log(`       → Filas leídas:     ${cStats.totalRowsRead}`);
  console.log(`       → Contratos en rango: ${cStats.validRows}`);
  console.log(`       → Skipped (fuera de rango): ${cStats.skippedRows}`);

  // ── Paso 3: Normalizar y acumular por RPE/año ─────────────────────────────
  console.log('\n  [3/5] Normalizando contratos y acumulando por RPE/año...');
  const normalizedContratos = rawContratos.map(normalizeContrato);
  const accumulator = accumulateByRpeYear(normalizedContratos);

  const rpeUnicos = new Set([...accumulator.values()].map((a) => a.rpe)).size;
  const yearsInAccumulator = new Set([...accumulator.values()].map((a) => a.sourceYear));
  console.log(`       → Combinaciones RPE/año: ${accumulator.size}`);
  console.log(`       → RPE únicos en contratos: ${rpeUnicos}`);
  console.log(`       → Años: ${[...yearsInAccumulator].sort().join(', ')}`);

  // ── Paso 4: Construir snapshots ───────────────────────────────────────────
  console.log('\n  [4/5] Construyendo snapshots (join proveedor + contratos)...');

  const rows: DgcpSnapshotRow[] = [];
  let rncValidos = 0;
  let skippedMissingProveedor = 0;
  let skippedNonJuridical = 0;
  let skippedBadRnc = 0;
  const seenKey = new Set<string>();
  let dedupSkipped = 0;

  for (const acc of accumulator.values()) {
    const proveedor = proveedoresMap.get(acc.rpe);

    if (!proveedor) {
      skippedMissingProveedor++;
      continue;
    }

    const rncResult = resolveProviderRnc(proveedor);

    if (!rncResult.ok) {
      if (rncResult.reason === 'non_juridical_identifier') {
        skippedNonJuridical++;
      } else {
        skippedBadRnc++;
      }
      continue;
    }

    // Dedup by (source_key, country_code, source_year, normalized_tax_id)
    const dedupeKey = `${DGCP_SOURCE_KEY}|DO|${acc.sourceYear}|${rncResult.normalizedRnc}`;
    if (seenKey.has(dedupeKey)) {
      dedupSkipped++;
      continue;
    }
    seenKey.add(dedupeKey);

    rncValidos++;
    const row = buildDgcpSnapshotRow({
      acc,
      proveedor,
      normalizedRnc: rncResult.normalizedRnc,
      importedAt,
    });
    rows.push(row);
  }

  const yearsLoaded = [...new Set(rows.map((r) => r.source_year))].sort();

  console.log(`       → Snapshots construidos:           ${rows.length}`);
  console.log(`       → RNC válidos (jurídicos):          ${rncValidos}`);
  console.log(`       → Skipped (sin proveedor en xlsx):  ${skippedMissingProveedor}`);
  console.log(`       → Skipped (persona física/11 dígitos): ${skippedNonJuridical}`);
  console.log(`       → Skipped (RNC inválido/formato):   ${skippedBadRnc}`);
  console.log(`       → Skipped (dedup intra-run):        ${dedupSkipped}`);
  console.log(`       → Años cubiertos:                   ${yearsLoaded.join(', ')}`);

  // ── Guardrail apply ────────────────────────────────────────────────────────
  if (!dryRun) {
    const LARGE_APPLY_THRESHOLD = 5_000;
    if (rows.length > LARGE_APPLY_THRESHOLD && !args.confirmLargeApply) {
      console.error(
        `\n  [GUARDRAIL] --apply con ${rows.length} snapshots supera el umbral de ${LARGE_APPLY_THRESHOLD}.` +
          `\n              Agrega --confirm-large-apply para confirmar la carga operativa.`,
      );
      process.exit(1);
    }
  }

  // ── Paso 5: Upsert ────────────────────────────────────────────────────────
  let writesRealized = 0;
  const upsertErrors: string[] = [];

  if (!dryRun && rows.length > 0) {
    console.log(
      `\n  [5/5] Upsertando ${rows.length} snapshots en source_company_snapshots...`,
    );
    console.log(`        source_key='${DGCP_SOURCE_KEY}' únicamente`);
    const sb = getAdminSupabase();
    const { upserted, errors } = await upsertInBatches(sb, rows, args.batchSize);
    writesRealized = upserted;
    upsertErrors.push(...errors);
  } else if (!dryRun && rows.length === 0) {
    console.log('\n  [5/5] Sin snapshots para upsert (0 filas).');
  } else {
    console.log('\n  [5/5] Dry-run: no se escribió en Supabase.');
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(66));
  console.log('  RESUMEN');
  console.log('─'.repeat(66));
  console.log(`  Proveedores en XLSX:           ${pStats.validRows}`);
  console.log(`  Contratos en rango:            ${cStats.validRows}`);
  console.log(`  Combinaciones RPE/año:         ${accumulator.size}`);
  console.log(`  Snapshots construidos:         ${rows.length}`);
  console.log(`  RNC válidos (jurídicos):       ${rncValidos}`);
  console.log(`  Skipped sin proveedor:         ${skippedMissingProveedor}`);
  console.log(`  Skipped persona física:        ${skippedNonJuridical}`);
  console.log(`  Skipped RNC inválido:          ${skippedBadRnc}`);
  console.log(`  Años cargados:                 ${yearsLoaded.join(', ') || '(ninguno)'}`);

  if (dryRun) {
    console.log(`  Modo:                         DRY-RUN (sin escrituras)`);
  } else {
    console.log(`  Writes realizados:            ${writesRealized}`);
    console.log(`  Modo:                         APPLY → source_company_snapshots (do_dgcp)`);
    console.log('');
    console.log('  ⚠ Siguiente paso: actualizar source_coverage_summaries.');
    console.log(
      '  Ejecutar: npx tsx scripts/rd/refresh-rd-dgcp-source-coverage-summary.ts --from-db-count',
    );
  }

  if (upsertErrors.length > 0) {
    console.log(`\n  Errores de upsert (${upsertErrors.length}):`);
    for (const e of upsertErrors) console.log(`    ✗ ${e}`);
    console.log('');
    process.exit(1);
  }

  console.log('');
  console.log('  ✓ ETL Bulk DGCP RD completado.');
  console.log('═'.repeat(66));
}

main().catch((err) => {
  console.error('\n[FATAL]', err instanceof Error ? err.message : err);
  process.exit(1);
});
