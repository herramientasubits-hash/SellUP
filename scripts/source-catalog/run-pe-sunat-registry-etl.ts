/**
 * PE SUNAT — ETL del registro de sociedades (SOURCES-PE-RUC-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='pe_sunat_registry') las
 * sociedades peruanas (RUC 20) ACTIVAS y HABIDAS del padrón reducido de SUNAT, con
 * filas MÍNIMAS (RUC, razón social, núcleo del nombre, ubigeo), para que el
 * Agente 1 obtenga el RUC por nombre dentro de la corrida.
 *
 *   --padron=<txt>  padron_reducido_ruc.txt descomprimido (público, ~1,5 GB,
 *                   https://www2.sunat.gob.pe/padron_reducido_ruc.zip).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-pe-sunat-registry-etl.ts --padron=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; ~870 k filas ⇒ la
 * valla anti-cargas masivas exige SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y
 * SELLUP_CONFIRMED_SOURCE_KEY=pe_sunat_registry):
 *   npx tsx scripts/source-catalog/run-pe-sunat-registry-etl.ts --padron=… --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='pe_sunat_registry'.
 *   - `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No toca `peru_sunat_ruc_snapshot`, accounts, prospect_candidates ni otras
 *     fuentes. No llama a SUNAT, Migo ni proveedores: sólo lee un archivo local.
 *   - Reanudable: `--offset=<n>` salta las n primeras filas ya escritas.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildPeSunatRegistryRow,
  PE_SUNAT_REGISTRY_SOURCE_KEY,
  type PeSunatRegistryRow,
} from '../../src/server/source-catalog/connectors/sunat-peru/pe-sunat-registry-row';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

type Config = { padron: string; apply: boolean; year: number; offset: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const padron = value('padron');
  if (!padron) throw new Error('config_invalid: falta --padron=<txt>');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(year) || !Number.isInteger(offset) || offset < 0) {
    throw new Error('config_invalid: --year y --offset deben ser enteros (offset ≥ 0)');
  }
  return { padron, apply: argv.includes('--apply'), year, offset };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`PE SUNAT REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const importedAt = new Date().toISOString();
  const byRuc = new Map<string, PeSunatRegistryRow>();
  let linesRead = 0;
  const lines = createInterface({
    input: createReadStream(config.padron, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    linesRead++;
    const row = buildPeSunatRegistryRow(line, { sourceYear: config.year, importedAt });
    if (row !== null && row.record_identity_key !== null && !byRuc.has(row.normalized_tax_id)) {
      byRuc.set(row.normalized_tax_id, row);
    }
  }

  const rows = [...byRuc.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Líneas leídas: ${linesRead}`);
  console.log(`  Sociedades (RUC 20) activas y habidas: ${rows.length}`);
  console.log(`  Con nombre único (RUC asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: PE_SUNAT_REGISTRY_SOURCE_KEY,
    countryCode: 'PE',
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
