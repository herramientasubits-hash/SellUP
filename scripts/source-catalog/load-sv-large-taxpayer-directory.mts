/**
 * SV — Grandes Contribuyentes en la capa gratuita (SOURCES-SV-LARGE-TAXPAYERS-1)
 *
 * Lee de `source_company_snapshots` (SÓLO LECTURA) el registro de NIT de El Salvador
 * (`sv_nit_registry`) y la capa de COMPRASAL (`sv_comprasal_directory`), y arma una
 * fila de `sv_large_taxpayer_directory` por cada Gran Contribuyente de la DGII (2019)
 * que NO está en COMPRASAL y que la tabla por NIT clasifica
 * (`sv-large-taxpayer-macro-table.ts`, revisada por la dueña).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   node --env-file=<.env.local> --import tsx scripts/source-catalog/load-sv-large-taxpayer-directory.mts
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   … --apply --confirm   (se niega si la tabla no está aprobada)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  buildSvLargeTaxpayerDirectoryRow,
  SV_COMPRASAL_DIRECTORY_SOURCE_KEY,
  SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY,
  SV_NIT_REGISTRY_SOURCE_KEY,
  type SvSnapshotRow,
} from '../../src/server/source-catalog/connectors/sv-official-sources/sv-sources-rows';
import { SV_LARGE_TAXPAYER_MACRO_TABLE_APPROVED } from '../../src/server/prospect-batches/country-source-discovery/sv-large-taxpayer-macro-table';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity/record-identity-conflict-targets';

const PAGE = 1000;

async function readAll(client: SupabaseClient, sourceKey: string): Promise<SvSnapshotRow[]> {
  const out: SvSnapshotRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('source_key, country_code, source_year, tax_id, normalized_tax_id, legal_name, normalized_legal_name, city, region, priority_score, raw_data, imported_at, record_identity_key')
      .eq('source_key', sourceKey)
      .eq('country_code', 'SV')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read_failed_${sourceKey}: ${error.message}`);
    out.push(...((data ?? []) as unknown as SvSnapshotRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--confirm')) throw new Error('config_invalid: --apply exige --confirm (autorización explícita de la dueña)');
  if (apply && !SV_LARGE_TAXPAYER_MACRO_TABLE_APPROVED) throw new Error('config_invalid: la tabla de Grandes Contribuyentes no está aprobada por la dueña');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  const client = createClient(url, key);
  console.log(`SV GRANDES CONTRIBUYENTES — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const registry = await readAll(client, SV_NIT_REGISTRY_SOURCE_KEY);
  const comprasal = new Set((await readAll(client, SV_COMPRASAL_DIRECTORY_SOURCE_KEY)).map((row) => row.tax_id));
  const large = registry.filter((row) => {
    const origins = Array.isArray(row.raw_data['origins']) ? (row.raw_data['origins'] as unknown[]) : [];
    return origins.includes('dgii_large_2019') && row.raw_data['taxpayer_category'] === 'SV_GRAN_CONTRIBUYENTE' && !comprasal.has(row.tax_id);
  });
  const importedAt = new Date().toISOString();
  const rows: SvSnapshotRow[] = [];
  const excluded = new Map<string, number>();
  for (const row of large) {
    const result = buildSvLargeTaxpayerDirectoryRow(row, { importedAt });
    if ('excluded' in result) excluded.set(result.excluded, (excluded.get(result.excluded) ?? 0) + 1);
    else rows.push(result.row);
  }
  const byMacro = new Map<string, number>();
  for (const row of rows) byMacro.set(String(row.raw_data['macro_industry_key']), (byMacro.get(String(row.raw_data['macro_industry_key'])) ?? 0) + 1);
  console.log(`  Grandes 2019 fuera de COMPRASAL: ${large.length} → ${SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY}: ${rows.length} (con web ${rows.filter((r) => r.raw_data['website_domain'] !== undefined).length}); fuera ${JSON.stringify(Object.fromEntries(excluded))}`);
  for (const [macro, n] of [...byMacro].sort((a, b) => b[1] - a[1])) console.log(`    ${macro}: ${n}`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada.');
    return;
  }
  for (let i = 0; i < rows.length; i += PAGE) {
    const { error } = await client.from('source_company_snapshots').upsert(rows.slice(i, i + PAGE), { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
  }
  console.log(`  rowsUpserted (${SV_LARGE_TAXPAYER_DIRECTORY_SOURCE_KEY}) = ${rows.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
