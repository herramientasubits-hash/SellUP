/**
 * CO — ETL del directorio de entidades públicas (SOURCES-CO-CLOSE-1)
 *
 * Carga `source_company_snapshots` con `source_key = co_public_entities`: una fila
 * por NIT con la web de la entidad (CHIP de la Contaduría) y sus servidores
 * (SIGEP II). Sirve a:
 *   - el NIT por WEB en todas las corridas (alcaldías, gobernaciones, ministerios…);
 *   - el tamaño oficial (servidores) en el filtro ICP;
 *   - el buscador gratuito de Gobierno (entidades con 200 servidores o más).
 *
 * Entradas (descargas públicas de datos.gov.co, en JSON tal como las da la API):
 *   --chip=<json>    5c7g-ptic «Entidades públicas registradas en el sistema CHIP»
 *   --sigep=<json>   h8rs-jxum «Caracterización del Empleo Público» (SIGEP II)
 *
 * Uso (DRY-RUN por defecto: lee los archivos, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-co-public-entities-etl.ts --chip=… --sigep=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña): añadir --apply.
 * `--apply` REEMPLAZA sólo `co_public_entities` (borra sus filas y sube las
 * nuevas; reversible con DELETE … WHERE source_key = 'co_public_entities').
 * Nunca se guardan correos ni personas: sólo el dominio y el número de servidores.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildCoPublicEntityRows,
  CO_PUBLIC_ENTITIES_SOURCE_KEY,
  type ChipEntityRow,
  type CoPublicEntitySnapshotRow,
  type SigepEntityRow,
} from '../../src/server/source-catalog/connectors/co-public-entities/co-public-entity-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function readJsonArray<T>(path: string, label: string): T[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`${label}_vacio_o_invalido: ${path}`);
  return parsed as T[];
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

async function replaceSource(client: SupabaseClient, rows: readonly (CoPublicEntitySnapshotRow & { imported_at: string })[]): Promise<number> {
  if (rows.some((row) => row.source_key !== CO_PUBLIC_ENTITIES_SOURCE_KEY)) {
    throw new Error('refused: una fila no pertenece a co_public_entities');
  }
  const { error } = await client
    .from('source_company_snapshots')
    .delete()
    .eq('source_key', CO_PUBLIC_ENTITIES_SOURCE_KEY)
    .eq('country_code', 'CO');
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
  const chipPath = value(argv, 'chip');
  const sigepPath = value(argv, 'sigep');
  if (!chipPath || !sigepPath) throw new Error('config_invalid: indica --chip=<json> y --sigep=<json>');
  console.log(`CO PUBLIC ENTITIES ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const chip = readJsonArray<ChipEntityRow>(chipPath, 'chip');
  const sigep = readJsonArray<SigepEntityRow>(sigepPath, 'sigep');
  const importedAt = new Date().toISOString();
  const rows = buildCoPublicEntityRows(chip, sigep).map((row) => ({ ...row, imported_at: importedAt }));

  const withDomain = rows.filter((r) => r.raw_data.website_domain !== null).length;
  const withWorkers = rows.filter((r) => r.raw_data.workers !== null).length;
  const offered = rows.filter((r) => r.raw_data.macro_industry_key === 'government' && (r.raw_data.workers ?? 0) >= 200);
  console.log(`  CHIP: ${chip.length} filas · SIGEP: ${sigep.length} filas`);
  console.log(`  ${CO_PUBLIC_ENTITIES_SOURCE_KEY}: ${rows.length} entidades · con web ${withDomain} · con servidores ${withWorkers}`);
  console.log(`    por macro ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.macro_industry_key)))}`);
  console.log(`    origen de la web ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.website_domain_source)))}`);
  console.log(`  Gobierno con 200+ servidores (buscador gratuito): ${offered.length} · con web ${offered.filter((r) => r.raw_data.website_domain).length}`);
  for (const row of [...offered].sort((a, b) => b.priority_score - a.priority_score).slice(0, 8)) {
    console.log(`    ${row.tax_id} ${row.legal_name} · ${row.priority_score} servidores · ${row.raw_data.website_domain ?? 'sin web'}`);
  }

  if (apply) {
    assertLargeImportAllowed({ sourceKey: CO_PUBLIC_ENTITIES_SOURCE_KEY, countryCode: 'CO', estimatedRows: rows.length, isDryRun: false });
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
