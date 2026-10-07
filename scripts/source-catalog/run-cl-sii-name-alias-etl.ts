/**
 * CL SII — ETL de alias de nombre para el RUT por nombre (SOURCES-CL-NAME-ALIAS-1)
 *
 * Arma en `source_company_snapshots` (source_key='cl_sii_name_alias') el nombre
 * comercial que cierra la razón social de una sociedad del SII («EMPRESA DE
 * TRANSMISION ELECTRICA TRANSEMEL» → «TRANSEMEL»), a partir de `cl_sii_registry`
 * (ya cargado en la misma base). No descarga nada.
 *
 * Lee el registro ENTERO (≈1,7 M filas) porque una palabra sólo se guarda si sale
 * en UNA sola sociedad de todo el registro, en cualquier posición.
 *
 * Uso (DRY-RUN por defecto: lee cl_sii_registry, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-cl-sii-name-alias-etl.ts
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true SELLUP_CONFIRMED_SOURCE_KEY=cl_sii_name_alias \
 *     npx tsx scripts/source-catalog/run-cl-sii-name-alias-etl.ts --apply
 *
 * Guardrails: dry-run por defecto; sólo LEE cl_sii_registry; `--apply` escribe
 * SÓLO source_key='cl_sii_name_alias'; `assertLargeImportAllowed` antes de
 * escribir; no llama a ningún proveedor. Reversible:
 *   DELETE FROM source_company_snapshots WHERE source_key = 'cl_sii_name_alias';
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { CL_BRAND_ALIAS_MIN_WORKERS, chileCoreWords } from '../../src/server/source-catalog/connectors/sii-chile/cl-name-keys';
import {
  buildClSiiNameAliasRow,
  CL_SII_NAME_ALIAS_SOURCE_KEY,
  type ClSiiAliasSourceRow,
  type ClSiiNameAliasRow,
} from '../../src/server/source-catalog/connectors/sii-chile/cl-sii-name-alias-rows';
import { CL_SII_REGISTRY_SOURCE_KEY } from '../../src/server/source-catalog/connectors/sii-chile/cl-sii-registry-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 500;
const PROGRESS_EVERY = 100_000;

type RegistryPageRow = {
  normalized_tax_id: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  workers: string | number | null;
  metrics_year: string | number | null;
};

function toInteger(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
}

/**
 * Recorre cl_sii_registry por páginas ordenadas por RUT. Cuenta en cuántas
 * sociedades distintas sale cada palabra y guarda sólo las de 10+ trabajadores.
 */
async function scanRegistry(
  client: SupabaseClient,
): Promise<{ companiesWithWord: Map<string, number>; large: ClSiiAliasSourceRow[]; scanned: number }> {
  const companiesWithWord = new Map<string, number>();
  const large: ClSiiAliasSourceRow[] = [];
  let scanned = 0;
  let after: string | null = null;
  for (;;) {
    let query = client
      .from('source_company_snapshots')
      .select('normalized_tax_id, legal_name, normalized_legal_name, workers:raw_data->>workers, metrics_year:raw_data->>metrics_year')
      .eq('source_key', CL_SII_REGISTRY_SOURCE_KEY)
      .eq('country_code', 'CL')
      .order('normalized_tax_id', { ascending: true })
      .limit(PAGE_SIZE);
    if (after !== null) query = query.gt('normalized_tax_id', after);
    const { data, error } = await query;
    if (error) throw new Error(`read_failed_after_${after ?? 'start'}: ${error.message}`);
    const page = (data ?? []) as unknown as RegistryPageRow[];
    for (const row of page) {
      const core = row.normalized_legal_name?.trim() ?? '';
      for (const word of chileCoreWords(core)) companiesWithWord.set(word, (companiesWithWord.get(word) ?? 0) + 1);
      const workers = toInteger(row.workers);
      if (workers !== null && workers >= CL_BRAND_ALIAS_MIN_WORKERS) {
        large.push({
          rut: row.normalized_tax_id,
          legalName: row.legal_name,
          core,
          workers,
          metricsYear: toInteger(row.metrics_year),
        });
      }
      scanned += 1;
      if (scanned % PROGRESS_EVERY === 0) console.log(`  … ${scanned} filas leídas`);
    }
    if (page.length < PAGE_SIZE) return { companiesWithWord, large, scanned };
    after = page[page.length - 1].normalized_tax_id;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`CL SII NAME ALIAS ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const { companiesWithWord, large, scanned } = await scanRegistry(client);
  console.log(`  cl_sii_registry leídas: ${scanned}`);
  console.log(`  con ${CL_BRAND_ALIAS_MIN_WORKERS}+ trabajadores: ${large.length}`);

  const sourceYear = new Date().getUTCFullYear();
  const importedAt = new Date().toISOString();
  const rows: ClSiiNameAliasRow[] = [];
  for (const company of large) {
    const row = buildClSiiNameAliasRow(company, companiesWithWord, { sourceYear, importedAt });
    if (row !== null) rows.push(row);
  }
  console.log(`  Alias admitidos: ${rows.length}`);
  for (const row of rows.slice(0, 15)) {
    console.log(`    ${row.normalized_legal_name.padEnd(22)} → ${row.normalized_tax_id}  ${row.legal_name}`);
  }

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: CL_SII_NAME_ALIAS_SOURCE_KEY,
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
  process.exit(1);
});
