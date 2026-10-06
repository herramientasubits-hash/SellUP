/**
 * EC SCVS — ETL de la capa gratuita de Ecuador (SOURCES-EC-FREE-DISCOVERY-1)
 *
 * Carga en `source_company_snapshots` (source_key='ec_scvs_directory') las
 * compañías ecuatorianas ACTIVAS con 100 o más empleados, cruzando dos archivos
 * públicos de la Superintendencia de Compañías por `expediente`:
 *
 *   --directory=<ruta>  https://mercadodevalores.supercias.gob.ec/reportes/excel/directorio_companias.xlsx
 *   --ranking=<ruta>    https://appscvsmovil.supercias.gob.ec/ranking/recursos/bi_ranking.csv
 *   --sercop=<a,b>      (opcional, SOURCES-EC-CLOSE-1) entregas OCDS de SERCOP
 *                       (`<año>.jsonl.gz` de data.open-contracting.org/en/publication/110):
 *                       el dominio que la compañía declaró, si se parece a su nombre.
 *                       Sin él, las filas quedan sin web (y un aviso lo dice).
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
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  admitEcDirectoryCompany,
  buildEcScvsDirectoryRow,
  EC_SCVS_DIRECTORY_MIN_EMPLOYEES,
  EC_SCVS_DIRECTORY_SOURCE_KEY,
  type EcDirectoryRecord,
  type EcRankingMetrics,
  type EcScvsDirectoryRow,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-directory-rows';
import { buildEcSercopDomainMap } from '../../src/server/source-catalog/connectors/ec-scvs/ec-sercop-domain';
import { percentileScores } from '../../src/server/source-catalog/connectors/rns-argentina/ar-rns-snapshot-builder';
import { argValue, existingFiles, readEcDirectory, readEcRanking, readSercopParties } from './ec-local-files';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;

type Config = { directory: string; ranking: string; sercop: string[]; apply: boolean };

function parseArgs(argv: readonly string[]): Config {
  const directory = argValue(argv, 'directory');
  const ranking = argValue(argv, 'ranking');
  if (!directory || !ranking) throw new Error('config_invalid: faltan --directory=<xlsx> y --ranking=<csv>');
  for (const path of [directory, ranking]) {
    if (!existsSync(path)) throw new Error(`config_invalid: falta ${path}`);
  }
  return {
    directory,
    ranking,
    sercop: existingFiles(argValue(argv, 'sercop'), 'sercop'),
    apply: argv.includes('--apply'),
  };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`EC SCVS DIRECTORY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const directory = readEcDirectory(config.directory);
  const ranking = await readEcRanking(config.ranking);
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

  // SOURCES-EC-CLOSE-1 — dominio declarado en SERCOP, comparado con la razón social VIGENTE.
  let domains = new Map<string, string>();
  if (config.sercop.length > 0) {
    const parties = await readSercopParties(config.sercop);
    domains = buildEcSercopDomainMap(parties, (ruc) => admitted.get(ruc)?.record.legalName ?? null);
    console.log(`  SERCOP: ${parties.length} partes leídas · ${domains.size} dominios aceptados`);
  } else {
    console.log('  ⚠️ Sin --sercop: las filas quedan sin web (irían a Descartadas por falta de dominio).');
  }

  const rows: EcScvsDirectoryRow[] = ordered.map(([ruc, entry], index) =>
    buildEcScvsDirectoryRow({
      record: entry.record,
      ruc,
      metrics: entry.metrics,
      priorityScore: scores[index],
      importedAt,
      websiteDomain: domains.get(ruc) ?? null,
    }),
  );

  const perMacro = new Map<string, number>();
  for (const row of rows) {
    const macro = (row.raw_data.macro_industry_key as string | null) ?? '(sin macro)';
    perMacro.set(macro, (perMacro.get(macro) ?? 0) + 1);
  }
  console.log(`  Activas con ${EC_SCVS_DIRECTORY_MIN_EMPLOYEES} o más empleados: ${rows.length}`);
  console.log(`  Con dominio: ${rows.filter((row) => typeof row.raw_data.website_domain === 'string').length}`);
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
