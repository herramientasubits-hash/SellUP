/**
 * MX — ETL del RFC de personas morales de listas públicas (SOURCES-MX-RFC-PUBLIC-LISTS-1)
 *
 * Carga en `source_company_snapshots` (source_key='mx_rfc_public_lists_registry')
 * una fila por RFC de PERSONA MORAL de: SAT Padrón de Importadores (+ sectoriales),
 * SAT Donatarias Autorizadas (sólo activas) y padrón de proveedores de Nuevo León.
 *
 *   --csv=<archivo> que produce `extract-mx-rfc-public-lists.py` (rfc,name,list,extra)
 *   --year=<año de corte de las listas> (por defecto, el año actual)
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-mx-rfc-public-lists-etl.ts --csv=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; >25k filas):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true SELLUP_CONFIRMED_SOURCE_KEY=mx_rfc_public_lists_registry \
 *     npx tsx scripts/source-catalog/run-mx-rfc-public-lists-etl.ts --csv=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'mx_rfc_public_lists_registry'; `assertLargeImportAllowed` antes de escribir;
 * sólo lee archivos locales. Reanudable con --offset.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildMxRfcPublicListsRows,
  MX_RFC_PUBLIC_LISTS_SOURCE_KEY,
  type MxRfcPublicListEntry,
} from '../../src/server/source-catalog/connectors/mx-rfc-public-lists/mx-rfc-public-lists-rows';
import { CsvRowParser } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

type Config = { csv: string; year: number; apply: boolean; offset: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const csv = value('csv');
  if (!csv) throw new Error('config_invalid: falta --csv=<salida de extract-mx-rfc-public-lists.py>');
  const year = Number(value('year') ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000) throw new Error('config_invalid: --year inválido');
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('config_invalid: --offset debe ser un entero ≥ 0');
  return { csv, year, apply: argv.includes('--apply'), offset };
}

async function readEntries(path: string): Promise<MxRfcPublicListEntry[]> {
  const parser = new CsvRowParser(',');
  const entries: MxRfcPublicListEntry[] = [];
  let header: string[] | null = null;
  const take = (rows: string[][]) => {
    for (const cells of rows) {
      if (header === null) {
        header = cells.map((cell) => cell.trim().toLowerCase());
        if (!['rfc', 'name', 'list'].every((col) => header!.includes(col))) {
          throw new Error('config_invalid: el CSV debe tener columnas rfc,name,list,extra');
        }
        continue;
      }
      const at = (col: string) => cells[header!.indexOf(col)] ?? null;
      entries.push({ rfc: at('rfc'), name: at('name'), list: at('list') ?? '', extra: at('extra') });
    }
  };
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    take(parser.push(chunk as string));
  }
  take(parser.end());
  return entries;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`MX RFC LISTAS PÚBLICAS ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const entries = await readEntries(config.csv);
  const perList = new Map<string, number>();
  for (const entry of entries) perList.set(entry.list, (perList.get(entry.list) ?? 0) + 1);
  for (const [list, count] of perList) console.log(`  ${list}: ${count} filas leídas`);

  const rows = buildMxRfcPublicListsRows(entries, {
    importedAt: new Date().toISOString(),
    sourceYear: config.year,
  }).filter((row) => row.record_identity_key !== null);
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Personas morales con RFC: ${rows.length}`);
  console.log(`  Con nombre único (RFC asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);
  console.log(`  Donatarias: ${rows.filter((row) => row.raw_data.lists.includes('sat_donatarias')).length}`);
  console.log(`  Con estratificación (Nuevo León): ${rows.filter((row) => row.raw_data.stratification).length}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: MX_RFC_PUBLIC_LISTS_SOURCE_KEY,
    countryCode: 'MX',
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
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
