/**
 * US — ETL del buscador gratuito (SOURCES-US-CLOSE-1)
 *
 * Carga en `source_company_snapshots` la fuente `us_free_directory` (un EIN, una
 * fila) desde los mismos archivos oficiales que el EIN por nombre:
 *
 *   --irs-dir=<carpeta>  eo1.csv … eo4.csv del IRS EO BMF (ingresos ≥ US$ 25 M y
 *                        NTEE con macro en la tabla aprobada).
 *   --sec-dir=<carpeta>  JSON de submissions.zip de la SEC (operativas con EIN,
 *                        «Large accelerated» o «Accelerated», SIC con macro).
 *                        Opcional --active-since=AAAA-MM-DD (por defecto, dos años).
 *
 * Si un EIN está en las dos, manda la SEC (empresa cotizada con su SIC).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-us-free-directory-etl.ts --irs-dir=… --sec-dir=…
 *
 * Escritura REAL sólo con autorización explícita de la dueña (> 25 k filas ⇒ la
 * valla exige SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y
 * SELLUP_CONFIRMED_SOURCE_KEY=us_free_directory):
 *   … --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO `us_free_directory`;
 * `assertLargeImportAllowed` antes de escribir; sólo lee archivos locales; no toca
 * accounts, prospect_candidates ni otras fuentes.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildUsIrsDirectoryRow,
  buildUsSecDirectoryRow,
  US_FREE_DIRECTORY_SOURCE_KEY,
  type UsFreeDirectoryRow,
} from '../../src/server/source-catalog/connectors/us-ein/us-free-directory-rows';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const IRS_FILES = ['eo1.csv', 'eo2.csv', 'eo3.csv', 'eo4.csv'];

type Config = {
  irsDir: string | null;
  secDir: string | null;
  apply: boolean;
  year: number;
  activeSince: string;
};

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const irsDir = value('irs-dir');
  const secDir = value('sec-dir');
  if (!irsDir && !secDir) throw new Error('config_invalid: falta --irs-dir=<carpeta> y/o --sec-dir=<carpeta>');
  const now = new Date();
  const twoYearsAgo = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate()));
  const activeSince = value('active-since') ?? twoYearsAgo.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activeSince)) throw new Error('config_invalid: --active-since=AAAA-MM-DD');
  const year = Number(value('year') ?? now.getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year');
  return { irsDir, secDir, apply: argv.includes('--apply'), year, activeSince };
}

async function readRows(config: Config, importedAt: string): Promise<{ rows: UsFreeDirectoryRow[]; read: number }> {
  const byEin = new Map<string, UsFreeDirectoryRow>();
  let read = 0;
  const params = { sourceYear: config.year, importedAt };

  if (config.secDir) {
    for (const file of readdirSync(config.secDir)) {
      if (!file.endsWith('.json') || file.includes('-submissions-')) continue;
      read++;
      let submission: Record<string, unknown>;
      try {
        submission = JSON.parse(readFileSync(join(config.secDir, file), 'utf8')) as Record<string, unknown>;
      } catch {
        continue; // la SEC publica algún archivo vacío
      }
      const row = buildUsSecDirectoryRow(submission, { ...params, activeSince: config.activeSince });
      if (row !== null && row.record_identity_key !== null && !byEin.has(row.normalized_tax_id)) {
        byEin.set(row.normalized_tax_id, row);
      }
    }
  }
  if (config.irsDir) {
    const missing = IRS_FILES.filter((file) => !existsSync(join(config.irsDir!, file)));
    if (missing.length > 0) throw new Error(`config_invalid: faltan ${missing.join(', ')}`);
    for (const file of IRS_FILES) {
      for await (const record of readCsvFile(join(config.irsDir, file))) {
        read++;
        const row = buildUsIrsDirectoryRow(record, params);
        // La SEC ya cargada manda sobre el IRS para el mismo EIN.
        if (row !== null && row.record_identity_key !== null && !byEin.has(row.normalized_tax_id)) {
          byEin.set(row.normalized_tax_id, row);
        }
      }
    }
  }
  const rows = [...byEin.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  return { rows, read };
}

function summarize(rows: readonly UsFreeDirectoryRow[]): void {
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const key = `${String(row.raw_data['directory_kind'])} · ${String(row.raw_data['macro_industry_key'])}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...byKey.entries()].sort()) console.log(`    ${key}: ${n}`);
  const large = rows.filter((row) => row.raw_data['size_band'] === 'large').length;
  console.log(`  Marcadas como grandes: ${large}`);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`US FREE DIRECTORY ETL (${US_FREE_DIRECTORY_SOURCE_KEY}) — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const { rows, read } = await readRows(config, new Date().toISOString());
  console.log(`  Registros leídos: ${read}`);
  console.log(`  Filas a cargar: ${rows.length}`);
  summarize(rows);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: US_FREE_DIRECTORY_SOURCE_KEY,
    countryCode: 'US',
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
