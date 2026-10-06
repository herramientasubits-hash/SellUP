/**
 * EC SCVS — ETL del RUC por nombre con tamaño oficial (SOURCES-EC-CLOSE-1)
 *
 * Carga en `source_company_snapshots` TODAS las compañías ecuatorianas ACTIVAS con
 * RUC de sociedad (≈183.000) y, si el ranking las trae, sus empleados:
 *   - `ec_scvs_registry`: razón social limpia.
 *   - `ec_scvs_alias_registry`: la sigla o nombre corto que trae la razón social.
 *
 *   --directory=<ruta>  https://mercadodevalores.supercias.gob.ec/reportes/excel/directorio_companias.xlsx
 *   --ranking=<ruta>    https://appscvsmovil.supercias.gob.ec/ranking/recursos/bi_ranking.csv
 *   --source-year=<n>   año de las compañías que no están en el ranking (por defecto, el actual)
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ec-scvs-registry-etl.ts --directory=… --ranking=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; > 25.000 filas):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true SELLUP_CONFIRMED_SOURCE_KEY=ec_scvs_registry \
 *     npx tsx scripts/source-catalog/run-ec-scvs-registry-etl.ts --directory=… --ranking=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO las dos source_key de
 * arriba; `assertLargeImportAllowed` antes de escribir; sólo lee archivos locales;
 * no llama a ningún proveedor; no guarda representante, teléfono ni dirección.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildEcScvsRegistryRows,
  EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY,
  EC_SCVS_REGISTRY_SOURCE_KEY,
  type EcScvsRegistryRow,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-registry-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';
import { argValue, loadEcRegistryEntries } from './ec-local-files';

const UPSERT_CHUNK = 500;

type Config = { directory: string; ranking: string; sourceYear: number; apply: boolean };

function parseArgs(argv: readonly string[]): Config {
  const directory = argValue(argv, 'directory');
  const ranking = argValue(argv, 'ranking');
  if (!directory || !ranking) throw new Error('config_invalid: faltan --directory=<xlsx> y --ranking=<csv>');
  for (const path of [directory, ranking]) {
    if (!existsSync(path)) throw new Error(`config_invalid: falta ${path}`);
  }
  const year = Number(argValue(argv, 'source-year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 2000) throw new Error('config_invalid: --source-year');
  return { directory, ranking, sourceYear: year, apply: argv.includes('--apply') };
}

async function upsertAll(rows: readonly EcScvsRegistryRow[]): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`EC SCVS REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const entries = await loadEcRegistryEntries(config.directory, config.ranking);
  const importedAt = new Date().toISOString();
  const rows = [...entries]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([ruc, entry]) => buildEcScvsRegistryRows({ ruc, entry, sourceYear: config.sourceYear, importedAt }))
    .filter((row) => row.record_identity_key !== null);

  const registry = rows.filter((row) => row.source_key === EC_SCVS_REGISTRY_SOURCE_KEY);
  const aliases = rows.filter((row) => row.source_key === EC_SCVS_ALIAS_REGISTRY_SOURCE_KEY);
  const withWorkers = registry.filter((row) => typeof row.raw_data.workers === 'number');
  const small = withWorkers.filter((row) => (row.raw_data.workers as number) < 50).length;
  console.log(`  Compañías activas con RUC de sociedad: ${registry.length}`);
  const omitted = registry.filter((row) => row.raw_data.workers_omitted_reason !== undefined).length;
  console.log(`  Con empleados que deciden el tamaño: ${withWorkers.length} (menos de 50: ${small})`);
  console.log(`  Menos de 50 empleados pero ventas sobre el techo de la pequeña empresa (no deciden): ${omitted}`);
  console.log(`  Siglas / nombres cortos: ${aliases.length}`);
  const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
  console.log(`  Tamaño JSON aproximado: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: EC_SCVS_REGISTRY_SOURCE_KEY,
    countryCode: 'EC',
    estimatedRows: rows.length,
    isDryRun: false,
  });
  console.log(`  rowsUpserted = ${await upsertAll(rows)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
