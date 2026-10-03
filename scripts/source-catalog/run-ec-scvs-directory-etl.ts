/**
 * EC SCVS — ETL de la capa gratuita de Ecuador (SOURCES-EC-FREE-DISCOVERY-1)
 *
 * Carga en `source_company_snapshots` (source_key='ec_scvs_directory') las
 * compañías ecuatorianas ACTIVAS con 200 o más empleados, cruzando dos archivos
 * públicos de la Superintendencia de Compañías por `expediente`:
 *
 *   --directory=<ruta>  https://mercadodevalores.supercias.gob.ec/reportes/excel/directorio_companias.xlsx
 *   --ranking=<ruta>    https://appscvsmovil.supercias.gob.ec/ranking/recursos/bi_ranking.csv
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ec-scvs-directory-etl.ts --directory=… --ranking=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   npx tsx scripts/source-catalog/run-ec-scvs-directory-etl.ts --directory=… --ranking=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'ec_scvs_directory'; `assertLargeImportAllowed` antes de escribir; sólo lee
 * archivos locales; no llama a ningún proveedor; no guarda representante legal,
 * teléfono ni dirección.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  admitEcDirectoryCompany,
  buildEcScvsDirectoryRow,
  EC_SCVS_DIRECTORY_SOURCE_KEY,
  latestRanking,
  readEcDirectoryRecord,
  readEcRankingLine,
  type EcDirectoryRecord,
  type EcRankingMetrics,
  type EcScvsDirectoryRow,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-directory-rows';
import { percentileScores } from '../../src/server/source-catalog/connectors/rns-argentina/ar-rns-snapshot-builder';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;

type Config = { directory: string; ranking: string; apply: boolean };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const directory = value('directory');
  const ranking = value('ranking');
  if (!directory || !ranking) throw new Error('config_invalid: faltan --directory=<xlsx> y --ranking=<csv>');
  for (const path of [directory, ranking]) {
    if (!existsSync(path)) throw new Error(`config_invalid: falta ${path}`);
  }
  return { directory, ranking, apply: argv.includes('--apply') };
}

/** El directorio trae filas de título antes de la cabecera: se busca la fila con «RUC». */
function readDirectory(path: string): EcDirectoryRecord[] {
  const workbook = XLSX.readFile(path, { dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  const headerIndex = matrix.findIndex((cells) => Array.isArray(cells) && cells.includes('RUC'));
  if (headerIndex < 0) throw new Error('config_invalid: el directorio no tiene la cabecera con «RUC»');
  const header = (matrix[headerIndex] as unknown[]).map((cell) => String(cell).trim());

  const records: EcDirectoryRecord[] = [];
  for (const cells of matrix.slice(headerIndex + 1)) {
    const row: Record<string, unknown> = {};
    header.forEach((name, i) => {
      row[name] = (cells as unknown[])[i];
    });
    const record = readEcDirectoryRecord(row);
    if (record !== null) records.push(record);
  }
  return records;
}

async function readRanking(path: string): Promise<Map<string, EcRankingMetrics>> {
  const latest = new Map<string, EcRankingMetrics>();
  for await (const row of readCsvFile(path)) {
    const parsed = readEcRankingLine(row);
    if (parsed === null) continue;
    const [expediente, metrics] = parsed;
    latest.set(expediente, latestRanking(latest.get(expediente), metrics));
  }
  return latest;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`EC SCVS DIRECTORY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const directory = readDirectory(config.directory);
  const ranking = await readRanking(config.ranking);
  console.log(`  Directorio: ${directory.length} compañías · ranking: ${ranking.size} expedientes`);

  // Un RUC, una fila: si dos expedientes comparten RUC gana el de más empleados.
  const admitted = new Map<string, { record: EcDirectoryRecord; metrics: EcRankingMetrics }>();
  for (const record of directory) {
    const metrics = ranking.get(record.expediente) ?? null;
    const ruc = admitEcDirectoryCompany(record, metrics);
    if (ruc === null || metrics === null) continue;
    const previous = admitted.get(ruc);
    if (previous === undefined || (metrics.employees ?? 0) > (previous.metrics.employees ?? 0)) {
      admitted.set(ruc, { record, metrics });
    }
  }

  const ordered = [...admitted].sort(([a], [b]) => a.localeCompare(b));
  const scores = percentileScores(ordered.map(([, entry]) => entry.metrics.employees ?? 0));
  const importedAt = new Date().toISOString();
  const rows: EcScvsDirectoryRow[] = ordered.map(([ruc, entry], index) =>
    buildEcScvsDirectoryRow({ record: entry.record, ruc, metrics: entry.metrics, priorityScore: scores[index], importedAt }),
  );

  const perMacro = new Map<string, number>();
  for (const row of rows) {
    const macro = (row.raw_data.macro_industry_key as string | null) ?? '(sin macro)';
    perMacro.set(macro, (perMacro.get(macro) ?? 0) + 1);
  }
  console.log(`  Activas con 200 o más empleados: ${rows.length}`);
  console.log('  Por macro industria:');
  for (const [macro, count] of [...perMacro].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${macro.padEnd(46)} ${count}`);
  }
  const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
  console.log(`  Tamaño JSON aproximado: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: EC_SCVS_DIRECTORY_SOURCE_KEY,
    countryCode: 'EC',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const writable = rows.filter((row) => row.record_identity_key !== null);
  let upserted = 0;
  for (let i = 0; i < writable.length; i += UPSERT_CHUNK) {
    const chunk = writable.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
