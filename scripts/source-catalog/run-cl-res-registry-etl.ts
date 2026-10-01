/**
 * CL RES — ETL del Registro de Empresas y Sociedades (SOURCES-CL-RUT-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='cl_res_registry') las
 * sociedades chilenas constituidas por el régimen simplificado (Ley 20.659), con
 * filas MÍNIMAS (RUT, razón social, núcleo del nombre, tipo, comuna, año), para
 * que el Agente 1 obtenga el RUT por nombre dentro de la corrida.
 *
 *   --dir=<carpeta>  con los CSV anuales «AAAA-sociedades-por-fecha-rut-
 *                    constitucion*.csv» (públicos, ~270 MB en total, conjunto
 *                    «registro-de-empresas-y-sociedades» de datos.gob.cl).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-cl-res-registry-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; ~1,27 M filas ⇒ la
 * valla anti-cargas masivas exige SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y
 * SELLUP_CONFIRMED_SOURCE_KEY=cl_res_registry):
 *   npx tsx scripts/source-catalog/run-cl-res-registry-etl.ts --dir=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'cl_res_registry'; `assertLargeImportAllowed` antes de escribir; sólo lee
 * archivos locales; nunca EIRL (empresas de una persona). Reanudable con --offset.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildClResRegistryRow,
  CL_RES_REGISTRY_SOURCE_KEY,
  type ClResRegistryRow,
} from '../../src/server/source-catalog/connectors/res-chile/cl-res-registry-row';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const FILE_PATTERN = /^\d{4,6}-sociedades-por-fecha-rut-constitucion.*\.csv$/;

type Config = { dir: string; apply: boolean; year: number; offset: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir=<carpeta con los CSV del RES>');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(year) || !Number.isInteger(offset) || offset < 0) {
    throw new Error('config_invalid: --year y --offset deben ser enteros (offset ≥ 0)');
  }
  return { dir, apply: argv.includes('--apply'), year, offset };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`CL RES REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const files = readdirSync(config.dir).filter((file) => FILE_PATTERN.test(file)).sort();
  if (files.length === 0) throw new Error('config_invalid: no hay CSV del RES en la carpeta');

  const importedAt = new Date().toISOString();
  const byRut = new Map<string, ClResRegistryRow>();
  let recordsRead = 0;
  for (const file of files) {
    for await (const record of readCsvFile(join(config.dir, file), { delimiter: ';' })) {
      recordsRead++;
      const row = buildClResRegistryRow(record, { sourceYear: config.year, importedAt });
      if (row !== null && row.record_identity_key !== null && !byRut.has(row.normalized_tax_id)) {
        byRut.set(row.normalized_tax_id, row);
      }
    }
  }

  const rows = [...byRut.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Archivos: ${files.length} · registros leídos: ${recordsRead}`);
  console.log(`  Sociedades (sin EIRL) con RUT válido: ${rows.length}`);
  console.log(`  Con nombre único (RUT asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: CL_RES_REGISTRY_SOURCE_KEY,
    countryCode: 'CL',
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
    if ((i / UPSERT_CHUNK) % 100 === 0) console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
