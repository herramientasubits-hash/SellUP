/**
 * CL ChileCompra — carga del resumen «entidad compradora × proveedor» de las órdenes
 * de compra MENSUALES (datos abiertos, sin ticket) en
 * `public_procurement_supplier_links` (migración 150). AGENT1-SUPPLIER-SEARCH-CL-1.
 *
 * Uso (DRY-RUN por defecto: descarga, resume, guarda un NDJSON local y NO escribe):
 *   npx tsx scripts/source-catalog/run-cl-chilecompra-orders-load.ts --months 12 --end 2026-9
 *
 * Escritura REAL (sólo con autorización explícita de la dueña y con la 150 aplicada):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true SELLUP_CONFIRMED_SOURCE_KEY=cl_chilecompra_orders \
 *   npx tsx scripts/source-catalog/run-cl-chilecompra-orders-load.ts --months 12 --end 2026-9 --apply
 *
 * Guardrails: dry-run por defecto; sólo GET a transparenciachc.blob.core.windows.net;
 * `--apply` escribe SÓLO country_code='CL' AND source_key='cl_chilecompra_orders':
 * primero upsert de la ventana nueva y después borra lo que no se recargó (nunca
 * queda la tabla vacía a mitad de camino). No llama a ningún proveedor de pago.
 * Reversible:
 *   DELETE FROM public_procurement_supplier_links WHERE country_code='CL' AND source_key='cl_chilecompra_orders';
 *
 * Los zip se guardan en ~/Documents/SellUp-data/cl-chilecompra (≈100 MB por mes).
 */

import { loadEnvConfig } from '@next/env';
// `--env-dir <carpeta>`: lee el .env.local de otra carpeta (p. ej. el checkout principal
// cuando se corre desde un worktree sin credenciales). Por defecto, la carpeta actual.
const envDirIndex = process.argv.indexOf('--env-dir');
loadEnvConfig(envDirIndex >= 0 && process.argv[envDirIndex + 1] ? process.argv[envDirIndex + 1] : process.cwd());

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { CsvRowParser } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';
import {
  CL_CHILECOMPRA_MIN_PAIR_AMOUNT_CLP,
  CL_CHILECOMPRA_ORDERS_SOURCE_KEY,
  CL_CHILECOMPRA_ORDERS_URL,
  ClOrdersAggregator,
  type ClSupplierLinkRow,
} from '../../src/server/prospect-batches/supplier-search/cl-chilecompra-orders';

const TABLE = 'public_procurement_supplier_links';
const UPSERT_CHUNK = 500;
const DATA_DIR = join(homedir(), 'Documents', 'SellUp-data', 'cl-chilecompra');

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** Meses de la ventana, del más viejo al más nuevo, terminando en `end` («2026-9»). */
export function windowMonths(end: string, months: number): Array<{ year: number; month: number }> {
  const [y, m] = end.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) throw new Error(`bad_end:${end}`);
  const out: Array<{ year: number; month: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const index = y * 12 + (m - 1) - i;
    out.push({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  }
  return out;
}

async function download(year: number, month: number): Promise<string> {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = join(DATA_DIR, `${year}-${month}.zip`);
  if (existsSync(file) && statSync(file).size > 1_000_000) return file;
  const response = await fetch(CL_CHILECOMPRA_ORDERS_URL(year, month));
  if (!response.ok || !response.body) throw new Error(`download_failed:${year}-${month}:${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(file));
  return file;
}

/** Lee el CSV del zip (latin-1, «;») fila a fila y lo pasa al agregador. */
async function readMonth(file: string, aggregator: ClOrdersAggregator): Promise<void> {
  const unzip = spawn('unzip', ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  const decoder = new TextDecoder('latin1');
  const parser = new CsvRowParser(';');
  let header: string[] | null = null;
  const feed = (rows: string[][]) => {
    for (const cells of rows) {
      if (cells.length === 1 && cells[0] === '') continue;
      if (header === null) {
        header = cells.map((c) => c.trim());
        continue;
      }
      const record: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) record[header[i]] = cells[i] ?? '';
      aggregator.add(record);
    }
  };
  for await (const chunk of unzip.stdout) feed(parser.push(decoder.decode(chunk as Buffer, { stream: true })));
  feed(parser.push(decoder.decode()));
  feed(parser.end());
  const code: number = await new Promise((resolve) => unzip.on('close', resolve));
  if (code !== 0) throw new Error(`unzip_failed:${file}:${code}`);
}

function lastDay(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const months = Number(arg('--months') ?? 12);
  const end = arg('--end');
  const minPairAmount = Number(arg('--min') ?? CL_CHILECOMPRA_MIN_PAIR_AMOUNT_CLP);
  if (!end) throw new Error('falta --end AAAA-M (último mes publicado)');
  console.log(`CL CHILECOMPRA ÓRDENES — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'} · ${months} meses hasta ${end} · piso CLP ${minPairAmount}`);

  const window = windowMonths(end, months);
  const aggregator = new ClOrdersAggregator();
  for (const { year, month } of window) {
    const file = await download(year, month);
    const before = aggregator.stats.lines;
    await readMonth(file, aggregator);
    console.log(`  ${year}-${month}: ${aggregator.stats.lines - before} líneas`);
  }
  const windowStart = `${window[0].year}-${String(window[0].month).padStart(2, '0')}-01`;
  const lastMonth = window[window.length - 1];
  const rows: ClSupplierLinkRow[] = aggregator.rows({ windowStart, windowEnd: lastDay(lastMonth.year, lastMonth.month), minPairAmount });

  console.log('  Estadísticas:', aggregator.stats);
  console.log(`  Pares entidad × proveedor guardables: ${rows.length}`);
  console.log(`  Entidades compradoras: ${new Set(rows.map((r) => r.buyer_code)).size} · proveedores: ${new Set(rows.map((r) => r.supplier_tax_id)).size}`);
  const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
  console.log(`  Tamaño JSON aproximado: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  const out = join(DATA_DIR, `links-${end}-${months}m.ndjson`);
  const stream = createWriteStream(out);
  for (const row of rows) stream.write(`${JSON.stringify(row)}\n`);
  await new Promise((resolve) => stream.end(resolve));
  console.log(`  Archivo local para revisar: ${out}`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización y la 150 aplicada) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: CL_CHILECOMPRA_ORDERS_SOURCE_KEY,
    countryCode: 'CL',
    estimatedRows: rows.length,
    isDryRun: false,
  });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const loadedAt = new Date().toISOString();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((row) => ({ ...row, loaded_at: loadedAt }));
    const { error } = await client.from(TABLE).upsert(chunk, { onConflict: 'country_code,source_key,buyer_code,supplier_tax_id' });
    if (error) throw new Error(`upsert_failed_at_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  // Lo que no vino en esta ventana (pares que bajaron del piso o salieron de la ventana).
  const { error: deleteError, count } = await client
    .from(TABLE)
    .delete({ count: 'exact' })
    .eq('country_code', 'CL')
    .eq('source_key', CL_CHILECOMPRA_ORDERS_SOURCE_KEY)
    .lt('loaded_at', loadedAt);
  if (deleteError) throw new Error(`stale_delete_failed: ${deleteError.message}`);
  console.log(`  rowsUpserted = ${upserted} · staleDeleted = ${count ?? 0}`);
}

if (process.argv[1]?.endsWith('run-cl-chilecompra-orders-load.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
