/**
 * PY DNCP — ETL del directorio de descubrimiento gratuito (SOURCES-PY-CLOSE-1)
 *
 * Carga en `source_company_snapshots` (source_key='py_dncp_directory') las
 * sociedades paraguayas que el Estado contrató, para la capa gratuita del
 * Agente 1 (`py-dncp-directory-discovery-adapter.ts`).
 *
 *   --suppliers=<jsonl>  resumen de adjudicaciones por RUC
 *                        (`extract-py-dncp-suppliers.py summary`)
 *   --dncp-api=<jsonl>   fichas de la API pública de la DNCP
 *                        (`extract-py-dncp-suppliers.py profiles`)
 *   --dir=<carpeta>      padrón de RUC de la DNIT (ruc0.txt … ruc9.txt): la
 *                        sociedad tiene que estar ACTIVA y se guarda su razón social
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-py-dncp-directory-etl.ts --suppliers=… --dncp-api=… --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   … --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='py_dncp_directory'.
 *   - `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No toca accounts, prospect_candidates ni otras fuentes. No llama a la DNCP ni
 *     a proveedores: sólo lee ficheros locales.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { buildPySetRegistryRow } from '../../src/server/source-catalog/connectors/set-paraguay/py-set-registry-row';
import {
  buildPyDncpDirectoryRow,
  parsePyDncpAwardSummary,
  parsePyDncpSupplierProfile,
  pyDncpProfileRuc,
  PY_DNCP_DIRECTORY_SOURCE_KEY,
  type PyDncpDirectoryExclusion,
  type PyDncpDirectoryRow,
  type PyDncpSupplierProfile,
} from '../../src/server/source-catalog/connectors/set-paraguay/py-dncp-directory-row';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;
const FILES = Array.from({ length: 10 }, (_, digit) => `ruc${digit}.txt`);

type Config = { suppliers: string; dncpApi: string; dir: string; apply: boolean; year: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const suppliers = value('suppliers');
  const dncpApi = value('dncp-api');
  const dir = value('dir');
  if (!suppliers || !dncpApi || !dir) {
    throw new Error('config_invalid: faltan --suppliers=<jsonl>, --dncp-api=<jsonl> o --dir=<padrón>');
  }
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser entero');
  return { suppliers, dncpApi, dir, apply: argv.includes('--apply'), year };
}

function readJsonLines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

/** RUC con DV → razón social de las sociedades ACTIVAS del padrón. */
async function readActiveRegistry(dir: string, year: number): Promise<Map<string, string>> {
  const missing = FILES.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) throw new Error(`config_invalid: faltan ${missing.join(', ')}`);
  const names = new Map<string, string>();
  for (const file of FILES) {
    const lines = createInterface({ input: createReadStream(join(dir, file), { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) {
      const row = buildPySetRegistryRow(line, { sourceYear: year, importedAt: '' });
      if (row !== null && !names.has(row.tax_id)) names.set(row.tax_id, row.legal_name);
    }
  }
  return names;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`PY DNCP DIRECTORY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const registry = await readActiveRegistry(config.dir, config.year);
  const profiles = new Map<string, PyDncpSupplierProfile>();
  for (const raw of readJsonLines(config.dncpApi)) {
    const ruc = pyDncpProfileRuc(raw);
    const profile = parsePyDncpSupplierProfile(raw);
    if (ruc !== null && profile !== null) profiles.set(ruc, profile);
  }

  const importedAt = new Date().toISOString();
  const rows: PyDncpDirectoryRow[] = [];
  const excluded = new Map<PyDncpDirectoryExclusion, number>();
  let summaries = 0;
  let withoutProfile = 0;
  for (const raw of readJsonLines(config.suppliers)) {
    const summary = parsePyDncpAwardSummary(raw);
    if (summary === null) continue;
    summaries++;
    const profile = profiles.get(summary.ruc) ?? null;
    if (profile === null) withoutProfile++;
    const built = buildPyDncpDirectoryRow({
      summary,
      profile,
      registryLegalName: registry.get(summary.ruc) ?? null,
      sourceYear: config.year,
      importedAt,
    });
    if ('row' in built) rows.push(built.row);
    else excluded.set(built.excluded, (excluded.get(built.excluded) ?? 0) + 1);
  }

  console.log(`  Sociedades activas en el padrón: ${registry.size}`);
  console.log(`  Proveedores con adjudicaciones leídos: ${summaries} (sin ficha de la API: ${withoutProfile})`);
  for (const [reason, count] of [...excluded.entries()].sort()) console.log(`  Fuera — ${reason}: ${count}`);
  console.log(`  Filas ${PY_DNCP_DIRECTORY_SOURCE_KEY}: ${rows.length}`);
  const byMacro = new Map<string, { total: number; withDomain: number }>();
  for (const row of rows) {
    const macro = String(row.raw_data['macro_industry_key']);
    const entry = byMacro.get(macro) ?? { total: 0, withDomain: 0 };
    entry.total++;
    if (row.raw_data['website_domain']) entry.withDomain++;
    byMacro.set(macro, entry);
  }
  for (const [macro, entry] of [...byMacro.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${macro}: ${entry.total} (con web ${entry.withDomain})`);
  }

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: PY_DNCP_DIRECTORY_SOURCE_KEY,
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
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
