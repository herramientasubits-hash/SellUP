/**
 * EC SRI — ETL del catastro de RUC del SRI para el RUC por nombre (SOURCES-EC-CLOSE-1)
 *
 * Carga en `source_company_snapshots`:
 *   - `ec_sri_registry`: contribuyentes ACTIVOS con RUC de sociedad (privada o
 *     pública) que NO están en el registro de la Superintendencia (ésos ya los
 *     encuentra `ec_scvs_registry`): entidades públicas, bancos, cooperativas,
 *     fundaciones, colegios y universidades.
 *   - `ec_sri_trade_name_registry`: el nombre comercial del establecimiento
 *     principal de TODOS (también de las compañías de la Superintendencia:
 *     «SUPERMAXI» → Corporación Favorita).
 * Cuando el RUC está en la Superintendencia, sus empleados del ranking viajan con
 * la fila (tamaño oficial).
 *
 *   --sri=<a.csv,b.csv,…>  https://descargas.sri.gob.ec/download/datosAbiertos/SRI_RUC_<Provincia>.csv
 *   --directory=<ruta>     directorio de compañías de la Superintendencia (xlsx)
 *   --ranking=<ruta>       ranking empresarial de la Superintendencia (csv)
 *   --source-year=<n>      año del catastro (los archivos publicados en 2025: 2025)
 *
 * DRY-RUN por defecto. Escritura REAL sólo con autorización explícita (> 25.000 filas):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true SELLUP_CONFIRMED_SOURCE_KEY=ec_sri_registry \
 *     npx tsx scripts/source-catalog/run-ec-sri-registry-etl.ts --sri=… --directory=… --ranking=… --apply
 *
 * Guardrails: sólo lee archivos locales; escribe SÓLO las dos source_key de arriba;
 * personas naturales nunca; no guarda dirección, teléfono, correo ni representante.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { existsSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  accumulateEcSriEntry,
  admitEcSriRecord,
  buildEcSriRegistryRows,
  EC_SRI_REGISTRY_SOURCE_KEY,
  EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY,
  isCodeLikeTradeName,
  readEcSriLine,
  type EcSriEntry,
  type EcSriRegistryRow,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-sri-registry-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';
import { argValue, existingFiles, loadEcRegistryEntries, readSriCsv } from './ec-local-files';

const UPSERT_CHUNK = 500;

type Config = { sri: string[]; directory: string; ranking: string; sourceYear: number; apply: boolean };

function parseArgs(argv: readonly string[]): Config {
  const sri = existingFiles(argValue(argv, 'sri'), 'sri');
  const directory = argValue(argv, 'directory');
  const ranking = argValue(argv, 'ranking');
  if (sri.length === 0 || !directory || !ranking) {
    throw new Error('config_invalid: faltan --sri=<csv,…>, --directory=<xlsx> y --ranking=<csv>');
  }
  for (const path of [directory, ranking]) {
    if (!existsSync(path)) throw new Error(`config_invalid: falta ${path}`);
  }
  const year = Number(argValue(argv, 'source-year') ?? '');
  if (!Number.isInteger(year) || year < 2000) throw new Error('config_invalid: --source-year=<año del catastro>');
  return { sri, directory, ranking, sourceYear: year, apply: argv.includes('--apply') };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`EC SRI REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const scvs = await loadEcRegistryEntries(config.directory, config.ranking);
  console.log(`  Superintendencia: ${scvs.size} compañías activas`);

  const entries = new Map<string, EcSriEntry>();
  let read = 0;
  for (const path of config.sri) {
    for await (const line of readSriCsv(path)) {
      read += 1;
      const record = readEcSriLine(line);
      if (record === null || !admitEcSriRecord(record)) continue;
      entries.set(record.ruc, accumulateEcSriEntry(entries.get(record.ruc), record));
    }
  }
  console.log(`  SRI: ${read} establecimientos leídos · ${entries.size} RUC activos de sociedad`);

  const importedAt = new Date().toISOString();
  const rows: EcSriRegistryRow[] = [];
  for (const [ruc, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const inScvs = scvs.get(ruc);
    const built = buildEcSriRegistryRows({
      entry,
      metrics: inScvs?.metrics ?? null,
      sourceYear: config.sourceYear,
      importedAt,
    });
    // La razón social de una compañía de la Superintendencia ya la encuentra
    // ec_scvs_registry: aquí sólo su nombre comercial.
    rows.push(...built.filter((row) => !(inScvs && row.source_key === EC_SRI_REGISTRY_SOURCE_KEY)));
  }
  const writable = rows.filter((row) => row.record_identity_key !== null);

  const legal = writable.filter((row) => row.source_key === EC_SRI_REGISTRY_SOURCE_KEY);
  const trade = writable.filter((row) => row.source_key === EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY);
  console.log(`  ${EC_SRI_REGISTRY_SOURCE_KEY}: ${legal.length} (públicas: ${legal.filter((r) => r.raw_data.sector_type === 'public').length})`);
  console.log(`  ${EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY}: ${trade.length} (con empleados: ${trade.filter((r) => typeof r.raw_data.workers === 'number').length})`);
  const bytes = writable.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
  console.log(`  Tamaño JSON aproximado: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: EC_SRI_REGISTRY_SOURCE_KEY,
    countryCode: 'EC',
    estimatedRows: writable.length,
    isDryRun: false,
  });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  let upserted = 0;
  for (let i = 0; i < writable.length; i += UPSERT_CHUNK) {
    const chunk = writable.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
  console.log(`  Nombres comerciales viejos que son un código (borrados): ${await pruneStaleCodeLikeTradeNames(client, importedAt)}`);
}

/**
 * SOURCES-EC-NAME-MATCH-GAPS-1 — las marcas de cargas anteriores que esta carga ya
 * no produce se conservan (prefijos útiles como «KARAMBA»), salvo las que son un
 * código y no una marca (`isCodeLikeTradeName`: RUC, fecha, número de chasis).
 * Sólo filas de `ec_sri_trade_name_registry` anteriores a esta carga.
 */
const PRUNE_PAGE = 1000;

async function pruneStaleCodeLikeTradeNames(client: SupabaseClient, importedAt: string): Promise<number> {
  const stale: string[] = [];
  for (let from = 0; ; from += PRUNE_PAGE) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('id, normalized_legal_name')
      .eq('source_key', EC_SRI_TRADE_NAME_REGISTRY_SOURCE_KEY)
      .eq('country_code', 'EC')
      .lt('imported_at', importedAt)
      .order('id')
      .range(from, from + PRUNE_PAGE - 1);
    if (error) throw new Error(`prune_read_failed: ${error.message}`);
    for (const row of data ?? []) {
      if (isCodeLikeTradeName(String(row.normalized_legal_name ?? ''))) stale.push(String(row.id));
    }
    if ((data ?? []).length < PRUNE_PAGE) break;
  }
  for (let i = 0; i < stale.length; i += PRUNE_PAGE) {
    const { error } = await client.from('source_company_snapshots').delete().in('id', stale.slice(i, i + PRUNE_PAGE));
    if (error) throw new Error(`prune_delete_failed_at_${i}: ${error.message}`);
  }
  return stale.length;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
