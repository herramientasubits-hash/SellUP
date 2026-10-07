/**
 * BO — ETL de la lista de grandes contribuyentes (SOURCES-BO-CLOSE-1)
 *
 * Carga `source_company_snapshots` con `source_key = bo_large_taxpayers`: una fila
 * por NIT de sociedad que Impuestos Nacionales categoriza PRICO o GRACO (o que la
 * Aduana lista como PRIO u OEA), con su razón social, departamento y objeto social
 * leídos del SEPREC. Sirve a:
 *   - el NIT por nombre en TODAS las corridas (antes que el SEPREC en vivo);
 *   - la categoría de contribuyente en el filtro de tamaño (sólo informa: no decide);
 *   - el buscador gratuito de Bolivia por industria.
 *
 * Entrada: el archivo que deja `run-bo-seprec-nit-crawl.ts` (una línea JSON por NIT).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   node --import tsx scripts/source-catalog/run-bo-large-taxpayers-etl.ts --crawl=.tmp/bo/bo_seprec_by_nit.jsonl
 *
 * Escritura REAL (sólo con autorización explícita de la dueña): añadir --apply.
 * `--apply` REEMPLAZA sólo `bo_large_taxpayers` (borra sus filas y sube las nuevas;
 * reversible con DELETE … WHERE source_key = 'bo_large_taxpayers').
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  BO_LARGE_TAXPAYERS_SOURCE_KEY,
  buildBoLargeTaxpayerRows,
  type BoLargeTaxpayerSnapshotRow,
  type BoSeprecCrawlRecord,
} from '../../src/server/source-catalog/connectors/sin-bolivia/bo-large-taxpayer-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

async function replaceSource(client: SupabaseClient, rows: readonly (BoLargeTaxpayerSnapshotRow & { imported_at: string })[]): Promise<number> {
  if (rows.some((row) => row.source_key !== BO_LARGE_TAXPAYERS_SOURCE_KEY)) {
    throw new Error('refused: una fila no pertenece a bo_large_taxpayers');
  }
  const { error } = await client
    .from('source_company_snapshots')
    .delete()
    .eq('source_key', BO_LARGE_TAXPAYERS_SOURCE_KEY)
    .eq('country_code', 'BO');
  if (error) throw new Error(`clear_failed: ${error.message}`);
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error: upsertError } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (upsertError) throw new Error(`upsert_failed_at_offset_${i}: ${upsertError.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const crawlPath = value(argv, 'crawl');
  if (!crawlPath) throw new Error('config_invalid: indica --crawl=<jsonl>');
  console.log(`BO LARGE TAXPAYERS ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const records = readFileSync(crawlPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BoSeprecCrawlRecord);
  const importedAt = new Date().toISOString();
  const { rows: built, skipped } = buildBoLargeTaxpayerRows(records);
  const rows = built.map((row) => ({ ...row, imported_at: importedAt }));

  const offered = rows.filter((r) => r.raw_data.matricula_renewed && r.raw_data.macro_industry_key !== null);
  console.log(`  NIT consultados: ${records.length} · filas: ${rows.length} · descartes ${JSON.stringify(skipped)}`);
  console.log(`    por categoría ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.taxpayer_category)))}`);
  console.log(`    matrícula renovada ${rows.filter((r) => r.raw_data.matricula_renewed).length} · con objeto social ${rows.filter((r) => r.raw_data.social_purpose).length}`);
  console.log(`    por macro ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.macro_industry_key)))}`);
  console.log(`    clasificadas por ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.macro_basis)))}`);
  console.log(`  Buscador gratuito (renovadas y con macro): ${offered.length} · por macro ${JSON.stringify(countBy(offered, (r) => String(r.raw_data.macro_industry_key)))}`);

  if (apply) {
    assertLargeImportAllowed({ sourceKey: BO_LARGE_TAXPAYERS_SOURCE_KEY, countryCode: 'BO', estimatedRows: rows.length, isDryRun: false });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('supabase_service_role_not_configured');
    ensureNode20WebSocketShim();
    const client = createClient(url, key);
    console.log(`  rowsUpserted = ${await replaceSource(client, rows)}`);
  } else {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
