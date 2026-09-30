/**
 * PY SET — ETL del registro de sociedades (SOURCES-PY-RUC-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='py_set_registry') las
 * sociedades paraguayas (RUC 80…) ACTIVAS del padrón público de RUC de la SET/DNIT,
 * con filas MÍNIMAS (RUC con dígito verificador, razón social, núcleo del nombre),
 * para que el Agente 1 obtenga el RUC por nombre dentro de la corrida.
 *
 *   --dir=<carpeta>  con ruc0.txt … ruc9.txt descomprimidos (públicos, ~40 MB en
 *                    total, https://www.dnit.gov.py/web/portal-institucional/
 *                    listado-de-ruc-con-sus-equivalencias).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-py-set-registry-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; ~100 k filas ⇒ la
 * valla anti-cargas masivas exige SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y
 * SELLUP_CONFIRMED_SOURCE_KEY=py_set_registry):
 *   npx tsx scripts/source-catalog/run-py-set-registry-etl.ts --dir=… --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='py_set_registry'.
 *   - `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No toca accounts, prospect_candidates ni otras fuentes. No llama a la SET ni
 *     a proveedores: sólo lee archivos locales.
 *   - Reanudable: `--offset=<n>` salta las n primeras filas ya escritas.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildPySetRegistryRow,
  PY_SET_REGISTRY_SOURCE_KEY,
  type PySetRegistryRow,
} from '../../src/server/source-catalog/connectors/set-paraguay/py-set-registry-row';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const FILES = Array.from({ length: 10 }, (_, digit) => `ruc${digit}.txt`);

type Config = { dir: string; apply: boolean; year: number; offset: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir=<carpeta con ruc0.txt … ruc9.txt>');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(year) || !Number.isInteger(offset) || offset < 0) {
    throw new Error('config_invalid: --year y --offset deben ser enteros (offset ≥ 0)');
  }
  return { dir, apply: argv.includes('--apply'), year, offset };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`PY SET REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const missing = FILES.filter((file) => !existsSync(join(config.dir, file)));
  if (missing.length > 0) throw new Error(`config_invalid: faltan ${missing.join(', ')}`);

  const importedAt = new Date().toISOString();
  const byRuc = new Map<string, PySetRegistryRow>();
  let linesRead = 0;
  for (const file of FILES) {
    const lines = createInterface({
      input: createReadStream(join(config.dir, file), { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      linesRead++;
      const row = buildPySetRegistryRow(line, { sourceYear: config.year, importedAt });
      if (row !== null && row.record_identity_key !== null && !byRuc.has(row.normalized_tax_id)) {
        byRuc.set(row.normalized_tax_id, row);
      }
    }
  }

  const rows = [...byRuc.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Líneas leídas: ${linesRead}`);
  console.log(`  Sociedades (RUC 80…) activas: ${rows.length}`);
  console.log(`  Con nombre único (RUC asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: PY_SET_REGISTRY_SOURCE_KEY,
    countryCode: 'PY',
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
    if ((i / UPSERT_CHUNK) % 20 === 0) console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
