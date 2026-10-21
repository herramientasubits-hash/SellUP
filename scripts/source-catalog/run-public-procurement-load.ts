/**
 * Compras públicas — cargador GENÉRICO del resumen «entidad compradora × proveedor» en
 * `public_procurement_supplier_links` (migración 150), para cualquier país «loaded» del
 * registro `src/server/prospect-batches/supplier-search/countries/loaders.ts`.
 * AGENT1-SUPPLIER-SEARCH-ALL-1.
 *
 * Uso (DRY-RUN por defecto: descarga, resume, guarda un NDJSON local y NO escribe):
 *   npx tsx scripts/source-catalog/run-public-procurement-load.ts --country PE --end 2026-9 --months 12
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true SELLUP_CONFIRMED_SOURCE_KEY=<source_key del país> \
 *   npx tsx scripts/source-catalog/run-public-procurement-load.ts --country PE --end 2026-9 --apply [--env-dir <carpeta con .env.local>]
 *
 * Guardrails: dry-run por defecto; sólo GET a la fuente pública del país; `--apply`
 * escribe SÓLO country_code=<país> AND source_key=<su fuente>: primero upsert de la
 * ventana nueva y después borra lo que no se recargó (la tabla nunca queda vacía a mitad
 * de camino). No llama a ningún proveedor de pago. Reversible:
 *   DELETE FROM public_procurement_supplier_links WHERE country_code=<país> AND source_key=<fuente>;
 *
 * Los archivos se guardan en ~/Documents/SellUp-data/public-procurement/<país>/ (se reusan).
 */

import { loadEnvConfig } from '@next/env';
const envDirIndex = process.argv.indexOf('--env-dir');
loadEnvConfig(envDirIndex >= 0 && process.argv[envDirIndex + 1] ? process.argv[envDirIndex + 1] : process.cwd());

import { createWriteStream, existsSync, lstatSync, mkdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';
import { ProcurementLinksAggregator } from '../../src/server/prospect-batches/supplier-search/procurement-links';
import { PROCUREMENT_LOADERS } from '../../src/server/prospect-batches/supplier-search/countries/loaders';
import { monthsBack } from '../../src/server/prospect-batches/supplier-search/countries/loader-io';
import { PROCUREMENT_LINKS_TABLE } from '../../src/server/prospect-batches/supplier-search/countries/loaded-lookups.server';

const UPSERT_CHUNK = 500;
/** Intentos por archivo cuando la conexión se corta a mitad de la descarga. */
const DOWNLOAD_ATTEMPTS = 3;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function lastDay(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

async function download(url: string, file: string): Promise<void> {
  if (existsSync(file) && statSync(file).size > 1_000) return;
  // AGENT1-SUPPLIER-RELOAD-1 — un enlace roto (apuntaba a una carpeta que ya no está) se ve
  // como «no existe», pero escribir a través de él falla con ENOENT: se quita y se baja de nuevo.
  try {
    if (lstatSync(file).isSymbolicLink()) unlinkSync(file);
  } catch {
    // No existe: se baja.
  }
  // Fuentes que no se pueden bajar desde un script (México: el portal firma cada descarga):
  // la persona deja el archivo en la carpeta y el cargador sólo lo lee.
  if (url.startsWith('manual:')) throw new Error(`descarga_manual: falta ${file} — bájalo a mano desde ${url.slice('manual:'.length)}`);
  // AGENT1-SUPPLIER-RELOAD-1 — se baja a «.part» y sólo al terminar se renombra: una descarga
  // cortada (Paraguay 21-10, «terminated»: 81 MB a ~240 KB/s) dejaba un archivo a medias que
  // después se reusaba. Una conexión cortada se reintenta; un 4xx/5xx no.
  const partial = `${file}.part`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'SellUp/0.1 public-procurement-load' } });
    if (!response.ok || !response.body) throw new Error(`download_failed:${url}:${response.status}`);
    try {
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
      renameSync(partial, file);
      return;
    } catch (err) {
      rmSync(partial, { force: true });
      if (attempt >= DOWNLOAD_ATTEMPTS) throw err;
      console.log(`  descarga cortada (${err instanceof Error ? err.message : String(err)}); intento ${attempt + 1} de ${DOWNLOAD_ATTEMPTS}…`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 10_000));
    }
  }
}

async function main(): Promise<void> {
  const countryCode = (arg('--country') ?? '').toUpperCase();
  const loader = PROCUREMENT_LOADERS[countryCode];
  if (!loader) throw new Error(`país sin lector: ${countryCode || '(falta --country)'} · disponibles: ${Object.keys(PROCUREMENT_LOADERS).join(', ')}`);
  const endArg = arg('--end');
  if (!endArg) throw new Error('falta --end AAAA-M (último mes publicado)');
  const [year, month] = endArg.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error(`--end inválido: ${endArg}`);
  const months = Number(arg('--months') ?? 12);
  const apply = process.argv.includes('--apply');
  const { country } = loader;
  const minPairAmount = Number(arg('--min') ?? country.minPairAmount);
  console.log(`${countryCode} COMPRAS PÚBLICAS — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'} · ${months} meses hasta ${endArg} · piso ${country.currency} ${minPairAmount}`);

  const dir = join(homedir(), 'Documents', 'SellUp-data', 'public-procurement', countryCode.toLowerCase());
  mkdirSync(dir, { recursive: true });
  const aggregator = new ProcurementLinksAggregator({
    countryCode,
    sourceKey: country.sourceKey,
    currency: country.currency,
    normalizeBuyerName: country.normalizeBuyerName,
  });
  const files = loader.files({ year, month }, months);
  for (const [index, f] of files.entries()) {
    const path = join(dir, f.name);
    await download(f.url, path);
    const before = aggregator.lines;
    await loader.readLines(path, (line) => aggregator.add(line));
    const emitted = aggregator.lines - before;
    // AGENT1-SUPPLIER-RELOAD-1 — los lectores OCDS por año (HN, GT, PY) juntan cada proceso en
    // todos los archivos y lo entregan al cerrar el último: el «0» de un archivo anterior no es
    // pérdida (21-10: 664 de 1.077 pares de Honduras empiezan en oct–dic 2025).
    const note = emitted === 0 && index < files.length - 1 ? ' (leído; sus líneas salen al cerrar el último archivo)' : '';
    console.log(`  ${f.name}: ${emitted} líneas de empresa${note}`);
  }
  console.log(`  Total: ${aggregator.lines} líneas de empresa en la ventana`);

  const first = monthsBack({ year, month }, months)[0];
  const windowStart = `${first.year}-${String(first.month).padStart(2, '0')}-01`;
  const rows = aggregator.rows({ windowStart, windowEnd: lastDay(year, month), minPairAmount });
  console.log(`  Pares entidad × proveedor guardables: ${rows.length}`);
  console.log(`  Entidades compradoras: ${new Set(rows.map((r) => r.buyer_code)).size} · proveedores: ${new Set(rows.map((r) => r.supplier_tax_id)).size}`);
  const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
  console.log(`  Tamaño JSON aproximado: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  const out = join(dir, `links-${endArg}-${months}m.ndjson`);
  const stream = createWriteStream(out);
  for (const row of rows) stream.write(`${JSON.stringify(row)}\n`);
  await new Promise((resolve) => stream.end(resolve));
  console.log(`  Archivo local para revisar: ${out}`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({ sourceKey: country.sourceKey, countryCode, estimatedRows: rows.length, isDryRun: false });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const loadedAt = new Date().toISOString();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((row) => ({ ...row, loaded_at: loadedAt }));
    const { error } = await client.from(PROCUREMENT_LINKS_TABLE).upsert(chunk, { onConflict: 'country_code,source_key,buyer_code,supplier_tax_id' });
    if (error) throw new Error(`upsert_failed_at_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  const { error: deleteError, count } = await client
    .from(PROCUREMENT_LINKS_TABLE)
    .delete({ count: 'exact' })
    .eq('country_code', countryCode)
    .eq('source_key', country.sourceKey)
    .lt('loaded_at', loadedAt);
  if (deleteError) throw new Error(`stale_delete_failed: ${deleteError.message}`);
  console.log(`  rowsUpserted = ${upserted} · staleDeleted = ${count ?? 0}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
