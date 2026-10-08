/**
 * LATAM — ETL de la capa común de listas curadas (SOURCES-LATAM-CURATED-1)
 *
 * Carga `source_company_snapshots` con `source_key = latam_curated_directory`:
 * universidades, reguladores, bolsas, exportadores, multinacionales y rankings de
 * varios países, unidos en una fila por país + entidad.
 *
 * Entradas: uno o varios JSONL de los extractores de `scripts/source-catalog/latam-curated/`
 * (una `LatamCuratedEntry` por línea):
 *   --entries=<jsonl>[,<jsonl>…]
 *
 * Uso (DRY-RUN por defecto: lee, une, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-latam-curated-etl.ts --entries=a.jsonl,b.jsonl [--sample]
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   --apply [--env-dir=<carpeta con .env.local>]
 * `--apply` REEMPLAZA las filas de los PAÍSES presentes en las entradas (borra las
 * de esos países y sube las nuevas): correr siempre con TODAS las listas del país.
 * Reversible con DELETE … WHERE source_key = 'latam_curated_directory' AND country_code = …
 *
 * Guardrails: dry-run por defecto; `assertLargeImportAllowed`; sólo archivos locales;
 * nunca teléfonos, correos ni nombres de personas (los extractores no los escriben).
 */

import { readFileSync } from 'node:fs';
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildLatamCuratedRows,
  LATAM_CURATED_SOURCE_KEY,
  type LatamCuratedEntry,
  type LatamCuratedRow,
} from '../../src/server/source-catalog/connectors/latam-curated/latam-curated-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function readEntries(paths: readonly string[]): LatamCuratedEntry[] {
  const out: LatamCuratedEntry[] = [];
  for (const path of paths) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      out.push(JSON.parse(line) as LatamCuratedEntry);
    }
  }
  return out;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const entriesArg = value(argv, 'entries');
  if (entriesArg === null) throw new Error('config_invalid: --entries=<jsonl>[,<jsonl>…]');
  console.log(`LATAM curadas — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const entries = readEntries(entriesArg.split(',').filter((p) => p.trim().length > 0));
  const year = Number(value(argv, 'year') ?? new Date().getUTCFullYear());
  const { rows, excluded } = buildLatamCuratedRows(entries, { sourceYear: year, importedAt: new Date().toISOString() });
  const valid = rows.filter((row) => row.record_identity_key !== null);

  console.log(`  Entradas: ${entries.length} — por lista ${JSON.stringify(countBy(entries, (e) => e.list))}`);
  console.log(`  Filas: ${valid.length} — por país ${JSON.stringify(countBy(valid, (r) => r.country_code))} · exclusiones ${JSON.stringify(excluded)}`);
  console.log(`  Por macro: ${JSON.stringify(countBy(valid, (r) => String(r.raw_data.macro_industry_key)))}`);
  console.log(
    `  Con número fiscal: ${valid.filter((r) => r.tax_id).length} · con web: ${valid.filter((r) => r.raw_data.website_domain).length} · grandes por lista: ${valid.filter((r) => r.raw_data.official_size_band === 'large').length} · en 2+ listas: ${valid.filter((r) => (r.raw_data.origins as unknown[]).length > 1).length}`,
  );

  if (argv.includes('--sample')) {
    const byCountry = new Map<string, LatamCuratedRow[]>();
    for (const row of valid) byCountry.set(row.country_code, [...(byCountry.get(row.country_code) ?? []), row]);
    for (const [country, list] of [...byCountry.entries()].sort()) {
      const top = [...list].sort((a, b) => b.priority_score - a.priority_score).slice(0, 6);
      console.log(`  ${country}: ${top.map((r) => `${r.legal_name} [${r.raw_data.macro_industry_key}]`).join(' · ')}`);
    }
  }

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  loadEnvConfig(value(argv, 'env-dir') ?? process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  console.log(`  Proyecto: ${new URL(url).hostname.split('.')[0]}`);

  assertLargeImportAllowed({ sourceKey: LATAM_CURATED_SOURCE_KEY, countryCode: 'LATAM', estimatedRows: valid.length, isDryRun: false });
  const countries = [...new Set(valid.map((row) => row.country_code))].sort();
  const { error: deleteError } = await client
    .from('source_company_snapshots')
    .delete()
    .eq('source_key', LATAM_CURATED_SOURCE_KEY)
    .in('country_code', countries);
  if (deleteError) throw new Error(`delete_failed: ${deleteError.message}`);
  let upserted = 0;
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK) {
    const chunk = valid.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  ${LATAM_CURATED_SOURCE_KEY}: países reemplazados ${countries.join(',')} · rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
