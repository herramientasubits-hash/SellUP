/**
 * US — ETL de las fuentes con EIN (SOURCES-US-EIN-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` una de las dos fuentes oficiales gratuitas
 * de Estados Unidos con EIN, con filas MÍNIMAS, para que el Agente 1 obtenga el EIN
 * por nombre dentro de la corrida:
 *
 *   --source=sec --dir=<carpeta>  JSON de submissions.zip de la SEC descomprimido
 *                                 (https://www.sec.gov/Archives/edgar/daily-index/
 *                                 bulkdata/submissions.zip, ~1,5 GB; sin los
 *                                 archivos «-submissions-» de paginación).
 *                                 Opcional --active-since=AAAA-MM-DD (por defecto,
 *                                 dos años antes de hoy).
 *   --source=irs --dir=<carpeta>  eo1.csv … eo4.csv del IRS Exempt Organizations
 *                                 Business Master File (https://www.irs.gov/pub/
 *                                 irs-soi/eoN.csv). Opcional --min-revenue=<USD>.
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-us-ein-registry-etl.ts --source=sec --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña, y DESPUÉS de aplicar
 * la migración 141, que permite el tipo 'EIN'; > 25 k filas ⇒ la valla exige
 * SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y SELLUP_CONFIRMED_SOURCE_KEY=<source_key>):
 *   npx tsx scripts/source-catalog/run-us-ein-registry-etl.ts --source=irs --dir=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO el source_key de la
 * fuente elegida; `assertLargeImportAllowed` antes de escribir; sólo lee archivos
 * locales; no toca accounts, prospect_candidates ni otras fuentes.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildUsIrsEoRegistryRow,
  buildUsSecRegistryRow,
  US_IRS_EO_MIN_REVENUE_USD,
  US_IRS_EO_REGISTRY_SOURCE_KEY,
  US_SEC_EDGAR_REGISTRY_SOURCE_KEY,
  type UsEinRegistryRow,
} from '../../src/server/source-catalog/connectors/us-ein/us-ein-registry-rows';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const IRS_FILES = ['eo1.csv', 'eo2.csv', 'eo3.csv', 'eo4.csv'];

type Config = {
  source: 'sec' | 'irs';
  dir: string;
  apply: boolean;
  year: number;
  activeSince: string;
  minRevenue: number;
};

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const source = value('source');
  if (source !== 'sec' && source !== 'irs') throw new Error('config_invalid: --source=sec|irs');
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir=<carpeta>');
  const now = new Date();
  const twoYearsAgo = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate()));
  const activeSince = value('active-since') ?? twoYearsAgo.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activeSince)) throw new Error('config_invalid: --active-since=AAAA-MM-DD');
  const minRevenue = Number(value('min-revenue') ?? US_IRS_EO_MIN_REVENUE_USD);
  const year = Number(value('year') ?? now.getUTCFullYear());
  if (!Number.isFinite(minRevenue) || minRevenue < 0 || !Number.isInteger(year)) {
    throw new Error('config_invalid: --min-revenue y --year deben ser números válidos');
  }
  return { source, dir, apply: argv.includes('--apply'), year, activeSince, minRevenue };
}

async function readRows(config: Config, importedAt: string): Promise<{ rows: UsEinRegistryRow[]; read: number }> {
  const byEin = new Map<string, UsEinRegistryRow>();
  let read = 0;
  const keep = (row: UsEinRegistryRow | null) => {
    if (row !== null && row.record_identity_key !== null && !byEin.has(row.normalized_tax_id)) {
      byEin.set(row.normalized_tax_id, row);
    }
  };

  if (config.source === 'sec') {
    for (const file of readdirSync(config.dir)) {
      if (!file.endsWith('.json') || file.includes('-submissions-')) continue;
      read++;
      let submission: Record<string, unknown>;
      try {
        submission = JSON.parse(readFileSync(join(config.dir, file), 'utf8')) as Record<string, unknown>;
      } catch {
        continue; // la SEC publica algún archivo vacío
      }
      keep(buildUsSecRegistryRow(submission, { sourceYear: config.year, importedAt, activeSince: config.activeSince }));
    }
  } else {
    const missing = IRS_FILES.filter((file) => !existsSync(join(config.dir, file)));
    if (missing.length > 0) throw new Error(`config_invalid: faltan ${missing.join(', ')}`);
    for (const file of IRS_FILES) {
      for await (const record of readCsvFile(join(config.dir, file))) {
        read++;
        keep(buildUsIrsEoRegistryRow(record, { sourceYear: config.year, importedAt, minRevenue: config.minRevenue }));
      }
    }
  }
  const rows = [...byEin.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  return { rows, read };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const sourceKey = config.source === 'sec' ? US_SEC_EDGAR_REGISTRY_SOURCE_KEY : US_IRS_EO_REGISTRY_SOURCE_KEY;
  console.log(`US EIN REGISTRY ETL (${sourceKey}) — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const { rows, read } = await readRows(config, new Date().toISOString());
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Registros leídos: ${read}`);
  console.log(`  Filas a cargar: ${rows.length}`);
  console.log(`  Con nombre único (EIN asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({ sourceKey, countryCode: 'US', estimatedRows: rows.length, isDryRun: false });

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
