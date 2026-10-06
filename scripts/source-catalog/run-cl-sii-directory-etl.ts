/**
 * CL SII — ETL de la capa gratuita de Chile (SOURCES-CL-SII-FREE-DISCOVERY-1)
 *
 * Arma en `source_company_snapshots` (source_key='cl_sii_directory') las personas
 * jurídicas chilenas con 100 o más trabajadores, a partir de `cl_sii_registry`
 * (ya cargado en la misma base). No descarga nada.
 *
 * Uso (DRY-RUN por defecto: lee cl_sii_registry, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-cl-sii-directory-etl.ts
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   npx tsx scripts/source-catalog/run-cl-sii-directory-etl.ts --apply
 *
 * Guardrails: dry-run por defecto; sólo LEE cl_sii_registry; `--apply` escribe
 * SÓLO source_key='cl_sii_directory'; `assertLargeImportAllowed` antes de
 * escribir; no llama a ningún proveedor. Reversible:
 *   DELETE FROM source_company_snapshots WHERE source_key = 'cl_sii_directory';
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  admitClSiiDirectoryCompany,
  buildClSiiDirectoryRow,
  CL_SII_DIRECTORY_MIN_WORKERS,
  CL_SII_DIRECTORY_SOURCE_KEY,
  type ClSiiDirectoryCandidate,
  type ClSiiDirectoryRejection,
  type ClSiiDirectoryRow,
  type ClSiiRegistryReadRow,
} from '../../src/server/source-catalog/connectors/sii-chile/cl-sii-directory-rows';
import { CL_SII_REGISTRY_SOURCE_KEY } from '../../src/server/source-catalog/connectors/sii-chile/cl-sii-registry-rows';
import { percentileScores } from '../../src/server/source-catalog/connectors/rns-argentina/ar-rns-snapshot-builder';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 500;

/**
 * Lee de cl_sii_registry las filas con 100+ trabajadores, por páginas ordenadas
 * por RUT. El filtro de la base es un primer corte; la admisión vuelve a
 * comprobar el tamaño.
 */
async function readRegistry(client: SupabaseClient): Promise<ClSiiRegistryReadRow[]> {
  const rows: ClSiiRegistryReadRow[] = [];
  let after: string | null = null;
  for (;;) {
    let query = client
      .from('source_company_snapshots')
      .select('tax_id, normalized_tax_id, legal_name, normalized_legal_name, raw_data')
      .eq('source_key', CL_SII_REGISTRY_SOURCE_KEY)
      .eq('country_code', 'CL')
      .gte('raw_data->workers', CL_SII_DIRECTORY_MIN_WORKERS)
      .order('normalized_tax_id', { ascending: true })
      .limit(PAGE_SIZE);
    if (after !== null) query = query.gt('normalized_tax_id', after);
    const { data, error } = await query;
    if (error) throw new Error(`read_failed_after_${after ?? 'start'}: ${error.message}`);
    const page = (data ?? []) as Array<ClSiiRegistryReadRow & { normalized_tax_id: string }>;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    after = page[page.length - 1].normalized_tax_id;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`CL SII DIRECTORY ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const registry = await readRegistry(client);
  console.log(`  cl_sii_registry con ${CL_SII_DIRECTORY_MIN_WORKERS}+ trabajadores (primer corte): ${registry.length}`);

  const rejected = new Map<ClSiiDirectoryRejection, number>();
  const admitted = new Map<string, ClSiiDirectoryCandidate>();
  for (const row of registry) {
    const result = admitClSiiDirectoryCompany(row);
    if (!result.ok) {
      rejected.set(result.reason, (rejected.get(result.reason) ?? 0) + 1);
      continue;
    }
    admitted.set(result.company.rut, result.company);
  }
  for (const [reason, count] of rejected) console.log(`  Descartadas (${reason}): ${count}`);

  const ordered = [...admitted.values()].sort((a, b) => a.rut.localeCompare(b.rut));
  const scores = percentileScores(ordered.map((company) => company.workers));
  const importedAt = new Date().toISOString();
  const rows: ClSiiDirectoryRow[] = ordered.map((company, index) =>
    buildClSiiDirectoryRow({ company, priorityScore: scores[index], importedAt }),
  );

  const perMacro = new Map<string, number>();
  for (const row of rows) {
    const macro = (row.raw_data.macro_industry_key as string | null) ?? '(sin macro)';
    perMacro.set(macro, (perMacro.get(macro) ?? 0) + 1);
  }
  console.log(`  Admitidas: ${rows.length}`);
  console.log('  Por macro industria:');
  for (const [macro, count] of [...perMacro].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${macro.padEnd(46)} ${count}`);
  }
  const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);
  console.log(`  Tamaño JSON aproximado: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: CL_SII_DIRECTORY_SOURCE_KEY,
    countryCode: 'CL',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const writable = rows.filter((row) => row.record_identity_key !== null);
  let upserted = 0;
  for (let i = 0; i < writable.length; i += UPSERT_CHUNK) {
    const chunk = writable.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
