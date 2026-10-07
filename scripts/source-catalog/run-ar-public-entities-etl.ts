/**
 * AR entidades públicas — ETL (SOURCES-AR-PUBLIC-ENTITIES-1)
 *
 * Carga en `source_company_snapshots` (source_key='ar_public_entities') el
 * directorio de entidades públicas de Argentina que arma
 * `scripts/source-catalog/extract-ar-public-entities.py` (municipios ≥ 20.000
 * habitantes, organismos nacionales ≥ 200 empleados y universidades nacionales,
 * cada una con CUIT de ARCA y, si la hay, su web oficial).
 *
 * Uso (DRY-RUN por defecto: lee, valida, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ar-public-entities-etl.ts --csv=ar-public-entities.csv
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   … --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='ar_public_entities'.
 *   - Pasa por `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No lee ni toca accounts, prospect_candidates ni otra fuente.
 *   - No llama a ningún proveedor.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import {
  AR_PUBLIC_ENTITIES_SOURCE_KEY,
  buildArPublicEntityRows,
  type ArPublicEntityCsvRow,
} from '../../src/server/source-catalog/connectors/rns-argentina/ar-public-entities';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;

function parseArgs(argv: readonly string[]): { csv: string; apply: boolean } {
  const hit = argv.find((arg) => arg.startsWith('--csv='));
  const csv = hit ? hit.slice('--csv='.length).trim() : '';
  if (!csv) throw new Error('config_invalid: falta --csv=<archivo>');
  return { csv, apply: argv.includes('--apply') };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`AR entidades públicas ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const input: ArPublicEntityCsvRow[] = [];
  for await (const row of readCsvFile(config.csv)) input.push(row);
  const rows = buildArPublicEntityRows(input, new Date().toISOString());
  const writable = rows.filter((row) => row.record_identity_key !== null);

  const perType = new Map<string, { n: number; web: number }>();
  for (const row of writable) {
    const type = String(row.raw_data['entity_type']);
    const prev = perType.get(type) ?? { n: 0, web: 0 };
    perType.set(type, { n: prev.n + 1, web: prev.web + (row.raw_data['website_domain'] ? 1 : 0) });
  }
  console.log(`  Filas leídas: ${input.length} · válidas: ${writable.length} (descartadas: ${input.length - writable.length})`);
  console.log('  Por tipo (filas · con web):');
  for (const [type, c] of [...perType].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${type.padEnd(18)} ${String(c.n).padStart(4)} · ${c.web}`);
  }

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: AR_PUBLIC_ENTITIES_SOURCE_KEY,
    countryCode: 'AR',
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
