/**
 * BO — ETL del directorio de entidades públicas de gob.bo (SOURCES-BO-CLOSE-1)
 *
 * Carga `source_company_snapshots` con `source_key = bo_public_entities`: una fila
 * por entidad del portal único del Estado (www.gob.bo/entidades) con su web, su
 * departamento y el tipo de entidad. Sirve a:
 *   - la web oficial de las candidatas públicas;
 *   - el buscador gratuito de Gobierno (y de las empresas públicas nacionales).
 * No trae NIT: ninguna fuente oficial gratuita lo publica para las entidades.
 *
 * Entrada: la carpeta con el HTML de cada ficha (`<slug>.html`), descargada una vez
 * y despacio desde el sitemap de gob.bo (robots.txt: Allow /).
 *
 * Uso (DRY-RUN por defecto):
 *   node --import tsx scripts/source-catalog/run-bo-public-entities-etl.ts --pages=.tmp/bo/gobbo/html
 *
 * Escritura REAL (sólo con autorización explícita de la dueña): añadir --apply.
 * `--apply` REEMPLAZA sólo `bo_public_entities` (reversible con DELETE … WHERE
 * source_key = 'bo_public_entities'). Nunca se guardan correos ni personas.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  BO_PUBLIC_ENTITIES_SOURCE_KEY,
  buildBoPublicEntityRows,
  parseGobBoEntityPage,
  type BoPublicEntitySnapshotRow,
  type GobBoEntity,
} from '../../src/server/source-catalog/connectors/gob-bo/bo-public-entity-rows';
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

async function replaceSource(client: SupabaseClient, rows: readonly (BoPublicEntitySnapshotRow & { imported_at: string })[]): Promise<number> {
  if (rows.some((row) => row.source_key !== BO_PUBLIC_ENTITIES_SOURCE_KEY)) {
    throw new Error('refused: una fila no pertenece a bo_public_entities');
  }
  const { error } = await client
    .from('source_company_snapshots')
    .delete()
    .eq('source_key', BO_PUBLIC_ENTITIES_SOURCE_KEY)
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
  const pagesDir = value(argv, 'pages');
  if (!pagesDir) throw new Error('config_invalid: indica --pages=<carpeta con las fichas>');
  console.log(`BO PUBLIC ENTITIES ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const files = readdirSync(pagesDir).filter((file) => file.endsWith('.html'));
  const entities: GobBoEntity[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    const slug = file.slice(0, -'.html'.length);
    const entity = parseGobBoEntityPage(readFileSync(join(pagesDir, file), 'utf8'), slug);
    if (entity === null) unreadable.push(slug);
    else entities.push(entity);
  }
  const importedAt = new Date().toISOString();
  const rows = buildBoPublicEntityRows(entities).map((row) => ({ ...row, imported_at: importedAt }));
  const offered = rows.filter((row) => row.raw_data.macro_industry_key !== null);

  console.log(`  fichas: ${files.length} · leídas ${entities.length} · sin leer ${unreadable.length} ${unreadable.slice(0, 5).join(', ')}`);
  console.log(`  ${BO_PUBLIC_ENTITIES_SOURCE_KEY}: ${rows.length} entidades · con web ${rows.filter((r) => r.raw_data.website_domain).length}`);
  console.log(`    por tipo ${JSON.stringify(countBy(rows, (r) => r.raw_data.entity_kind))}`);
  console.log(`    origen de la web ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.website_domain_source)))}`);
  console.log(`  Buscador gratuito: ${offered.length} · por macro ${JSON.stringify(countBy(offered, (r) => String(r.raw_data.macro_industry_key)))} · con web ${offered.filter((r) => r.raw_data.website_domain).length}`);

  if (apply) {
    assertLargeImportAllowed({ sourceKey: BO_PUBLIC_ENTITIES_SOURCE_KEY, countryCode: 'BO', estimatedRows: rows.length, isDryRun: false });
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
