/**
 * AR RNS — ETL del registro completo (SOURCES-AR-CUIT-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='ar_rns_registry') TODAS las
 * sociedades argentinas con actividad PRINCIPAL activa en ARCA, con filas
 * MÍNIMAS (CUIT, razón social, núcleo del nombre, código de actividad), para que
 * el Agente 1 obtenga la CUIT por nombre dentro de la corrida.
 *
 *   --rns=<csv>   Registro Nacional de Sociedades (datos.jus.gob.ar, CC-BY 4.0),
 *                 UNA foto descomprimida (~890 MB).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ar-rns-registry-etl.ts --rns=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; ~1,19 M filas ⇒
 * la valla anti-cargas masivas exige también
 * SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y SELLUP_CONFIRMED_SOURCE_KEY=ar_rns_registry):
 *   npx tsx scripts/source-catalog/run-ar-rns-registry-etl.ts --rns=… --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='ar_rns_registry'.
 *   - `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No toca accounts, prospect_candidates, `ar_rns` ni ninguna otra fuente.
 *   - No llama a ningún proveedor ni API: sólo lee un archivo local.
 *   - Reanudable: `--offset=<n>` salta las n primeras filas ya escritas.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import {
  AR_RNS_REGISTRY_SOURCE_KEY,
  buildArRnsRegistryRow,
  readRnsPrincipalActivity,
  type ArRnsRegistryRow,
} from '../../src/server/source-catalog/connectors/rns-argentina/ar-rns-snapshot-builder';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

type Config = { rns: string; apply: boolean; year: number; offset: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const rns = value('rns');
  if (!rns) throw new Error('config_invalid: falta --rns=<csv>');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(year) || !Number.isInteger(offset) || offset < 0) {
    throw new Error('config_invalid: --year y --offset deben ser enteros (offset ≥ 0)');
  }
  return { rns, apply: argv.includes('--apply'), year, offset };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`AR RNS REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const importedAt = new Date().toISOString();
  const byCuit = new Map<string, ArRnsRegistryRow>();
  let rowsRead = 0;
  let withoutCore = 0;
  for await (const raw of readCsvFile(config.rns)) {
    rowsRead++;
    const activity = readRnsPrincipalActivity(raw);
    if (activity === null || byCuit.has(activity.cuit)) continue;
    const row = buildArRnsRegistryRow({ activity, sourceYear: config.year, importedAt });
    if (row === null) {
      withoutCore++;
      continue;
    }
    byCuit.set(activity.cuit, row);
  }

  const rows = [...byCuit.values()]
    .filter((row) => row.record_identity_key !== null)
    .sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  RNS filas leídas: ${rowsRead}`);
  console.log(`  Sociedades con actividad principal activa: ${rows.length} (sin núcleo de nombre: ${withoutCore})`);
  console.log(`  Con nombre único (CUIT asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: AR_RNS_REGISTRY_SOURCE_KEY,
    countryCode: 'AR',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  let upserted = 0;
  for (let i = config.offset; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
    if ((i / UPSERT_CHUNK) % 50 === 0) console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
