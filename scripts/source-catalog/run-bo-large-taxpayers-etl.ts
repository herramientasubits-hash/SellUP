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
 * Entrada: el archivo que deja `run-bo-seprec-nit-crawl.ts` (una línea JSON por NIT)
 * y, opcional, la carpeta de fichas de gob.bo (`--gobbo=`) para las siglas oficiales
 * de las empresas públicas.
 *
 * También carga `bo_name_alias` (siglas oficiales por NIT: TELECEL, DMC, ENTEL…) que
 * usa el rescate para encontrar la web (SOURCES-BO-CLOSE-1, corrida 07-10).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   node --import tsx scripts/source-catalog/run-bo-large-taxpayers-etl.ts --crawl=.tmp/bo/bo_seprec_by_nit.jsonl
 *
 * Escritura REAL (sólo con autorización explícita de la dueña): añadir --apply.
 * `--apply` REEMPLAZA sólo `bo_large_taxpayers` y `bo_name_alias` (borra sus filas y
 * sube las nuevas; reversible con DELETE … WHERE source_key IN ('bo_large_taxpayers',
 * 'bo_name_alias')).
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  BO_LARGE_TAXPAYERS_SOURCE_KEY,
  buildBoLargeTaxpayerRows,
  type BoSeprecCrawlRecord,
} from '../../src/server/source-catalog/connectors/sin-bolivia/bo-large-taxpayer-rows';
import { buildBoNameAliasRows, BO_NAME_ALIAS_SOURCE_KEY } from '../../src/server/source-catalog/connectors/sin-bolivia/bo-name-alias-rows';
import { normalizeBoliviaPublicEntityCore, parseGobBoEntityPage } from '../../src/server/source-catalog/connectors/gob-bo/bo-public-entity-rows';
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

async function replaceSource(
  client: SupabaseClient,
  sourceKey: string,
  rows: readonly ({ source_key: string } & Record<string, unknown>)[],
): Promise<number> {
  if (rows.some((row) => row.source_key !== sourceKey)) {
    throw new Error(`refused: una fila no pertenece a ${sourceKey}`);
  }
  const { error } = await client
    .from('source_company_snapshots')
    .delete()
    .eq('source_key', sourceKey)
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

/** Siglas de gob.bo por núcleo de nombre (vacío si no se indica la carpeta). */
function readGobBoAcronyms(pagesDir: string | null): { normalizedLegalName: string; acronym: string | null }[] {
  if (pagesDir === null) return [];
  const out: { normalizedLegalName: string; acronym: string | null }[] = [];
  for (const file of readdirSync(pagesDir).filter((name) => name.endsWith('.html'))) {
    const entity = parseGobBoEntityPage(readFileSync(join(pagesDir, file), 'utf8'), file.slice(0, -'.html'.length));
    if (entity) out.push({ normalizedLegalName: normalizeBoliviaPublicEntityCore(entity.name), acronym: entity.acronym });
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const crawlPath = value(argv, 'crawl');
  const gobboDir = value(argv, 'gobbo');
  if (!crawlPath) throw new Error('config_invalid: indica --crawl=<jsonl>');
  console.log(`BO LARGE TAXPAYERS ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const records = readFileSync(crawlPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BoSeprecCrawlRecord);
  const importedAt = new Date().toISOString();
  const { rows: built, skipped } = buildBoLargeTaxpayerRows(records);
  const rows = built.map((row) => ({ ...row, imported_at: importedAt }));
  const aliasRows = buildBoNameAliasRows(built, readGobBoAcronyms(gobboDir)).map((row) => ({ ...row, imported_at: importedAt }));

  const offered = rows.filter((r) => r.raw_data.matricula_renewed && r.raw_data.macro_industry_key !== null);
  console.log(`  NIT consultados: ${records.length} · filas: ${rows.length} · descartes ${JSON.stringify(skipped)}`);
  console.log(`    por categoría ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.taxpayer_category)))}`);
  console.log(`    matrícula renovada ${rows.filter((r) => r.raw_data.matricula_renewed).length} · con objeto social ${rows.filter((r) => r.raw_data.social_purpose).length}`);
  console.log(`    por macro ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.macro_industry_key)))}`);
  console.log(`    clasificadas por ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.macro_basis)))}`);
  console.log(`  ${BO_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length} siglas (${aliasRows.filter((r) => r.raw_data.alias_source === 'gobbo_acronym').length} de gob.bo) · ej. ${aliasRows.slice(0, 6).map((r) => r.normalized_legal_name).join(', ')}`);
  console.log(`  Buscador gratuito (renovadas y con macro): ${offered.length} · por macro ${JSON.stringify(countBy(offered, (r) => String(r.raw_data.macro_industry_key)))}`);

  if (apply) {
    assertLargeImportAllowed({ sourceKey: BO_LARGE_TAXPAYERS_SOURCE_KEY, countryCode: 'BO', estimatedRows: rows.length, isDryRun: false });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('supabase_service_role_not_configured');
    ensureNode20WebSocketShim();
    const client = createClient(url, key);
    console.log(`  rowsUpserted = ${await replaceSource(client, BO_LARGE_TAXPAYERS_SOURCE_KEY, rows)}`);
    console.log(`  aliasRowsUpserted = ${await replaceSource(client, BO_NAME_ALIAS_SOURCE_KEY, aliasRows)}`);
  } else {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
