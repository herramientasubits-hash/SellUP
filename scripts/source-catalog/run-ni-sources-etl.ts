/**
 * NI — ETL de las fuentes oficiales de Nicaragua (SOURCES-NI-CLOSE-2)
 *
 * Junta por RUC la lista de Grandes Contribuyentes de la DGI (copias 2019-2020 del
 * Internet Archive) y las licencias sanitarias del MINSA, más el Directorio
 * Industrial de la CNZF, el registro de microfinancieras de la CONAMI y las
 * entidades públicas con web, y escribe en `source_company_snapshots`:
 *
 *   - ni_ruc_registry         RUC por nombre dentro de la corrida (un RUC, una fila)
 *   - ni_ruc_name_alias       otros nombres de cada RUC (nombre comercial, sigla…)
 *   - ni_free_directory       capa gratuita por industria, con RUC
 *   - ni_free_directory_web   capa gratuita por industria, sólo con web
 *
 * Entradas (ficheros locales; el script no sale a la red):
 *   --dir=<carpeta> con ni_large_taxpayers.jsonl (`extract-ni-dgi-large-taxpayers.py`),
 *   ni_minsa_licenses.jsonl (`extract-ni-minsa-licenses.py`), ni_cnzf_directory.jsonl
 *   (`extract-ni-cnzf-directory.py`) y ni_conami_imf.jsonl (`extract-ni-conami-imf.py`).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ni-sources-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   … --apply --only=registry|alias|directory|directory_web
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` exige `--only=` y escribe sólo esa clave.
 *   - `assertLargeImportAllowed` antes de escribir.
 *   - No toca accounts, prospect_candidates ni otras fuentes.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildNiFreeDirectoryRows,
  buildNiRucNameAliasRows,
  buildNiRucRegistryRow,
  mergeNicaraguaRucSources,
  niEntryAliasKeys,
  niOwnNameKeys,
  niWebListings,
  parseNiCnzfCompany,
  parseNiConamiImf,
  parseNiLargeTaxpayer,
  parseNiMinsaLicense,
  NI_FREE_DIRECTORY_SOURCE_KEY,
  NI_FREE_DIRECTORY_WEB_SOURCE_KEY,
  NI_RUC_NAME_ALIAS_SOURCE_KEY,
  NI_RUC_REGISTRY_SOURCE_KEY,
  type NiSnapshotRow,
} from '../../src/server/source-catalog/connectors/ni-sources/ni-sources-rows';
import { NI_PUBLIC_ENTITIES } from '../../src/server/source-catalog/connectors/ni-sources/ni-public-entities';
import { dropAliasKeysOwnedByOthers } from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['registry', 'alias', 'directory', 'directory_web'] as const;
type Only = (typeof ONLY_VALUES)[number];

type Config = { dir: string; apply: boolean; only: Only | null; year: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir');
  const only = value('only');
  if (only !== null && !(ONLY_VALUES as readonly string[]).includes(only)) {
    throw new Error(`config_invalid: --only debe ser ${ONLY_VALUES.join(' | ')}`);
  }
  const apply = argv.includes('--apply');
  if (apply && only === null) throw new Error('config_invalid: --apply exige --only= (una carga cada vez)');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser entero');
  return { dir, apply, only: only as Only | null, year };
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

async function upsertAll(client: SupabaseClient, rows: readonly NiSnapshotRow[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
    console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  return upserted;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`NI SOURCES ETL — ${config.apply ? `APPLY (${config.only})` : 'DRY-RUN (no escribe)'}`);

  const largeTaxpayers = readJsonl(join(config.dir, 'ni_large_taxpayers.jsonl')).map(parseNiLargeTaxpayer).filter((r) => r !== null);
  const licenses = readJsonl(join(config.dir, 'ni_minsa_licenses.jsonl')).map(parseNiMinsaLicense).filter((r) => r !== null);
  const cnzf = readJsonl(join(config.dir, 'ni_cnzf_directory.jsonl')).map(parseNiCnzfCompany).filter((r) => r !== null);
  const conami = readJsonl(join(config.dir, 'ni_conami_imf.jsonl')).map(parseNiConamiImf).filter((r) => r !== null);
  console.log(
    `  Leídos: ${largeTaxpayers.length} Grandes Contribuyentes, ${licenses.length} licencias MINSA, ${cnzf.length} fichas CNZF, ${conami.length} IMF CONAMI, ${NI_PUBLIC_ENTITIES.length} entidades públicas`,
  );

  const entries = mergeNicaraguaRucSources({ largeTaxpayers, licenses });
  const importedAt = new Date().toISOString();
  const params = { sourceYear: config.year, importedAt };

  // 1. Registro de RUC.
  const registryRows: NiSnapshotRow[] = [];
  for (const entry of entries.values()) {
    const row = buildNiRucRegistryRow(entry, params);
    if (row !== null && row.record_identity_key !== null) registryRows.push(row);
  }
  registryRows.sort((a, b) => a.normalized_tax_id!.localeCompare(b.normalized_tax_id!));
  const cores = countBy(registryRows, (row) => row.normalized_legal_name);
  const unique = registryRows.filter((row) => cores[row.normalized_legal_name] === 1).length;
  console.log(
    `  ${NI_RUC_REGISTRY_SOURCE_KEY}: ${registryRows.length} RUC (${unique} con nombre único) — ${JSON.stringify(countBy(registryRows, (row) => (row.raw_data['origins'] as string[]).join('+')))}`,
  );

  // 2. Alias: nunca el nombre propio de otro RUC.
  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of niOwnNameKeys(row)) owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id!));
  }
  const aliasRows = registryRows.flatMap((row) =>
    buildNiRucNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(niEntryAliasKeys(entries.get(row.tax_id!)!, row.normalized_legal_name), row.tax_id!, owners),
    }),
  );
  console.log(`  ${NI_RUC_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length}`);

  // 3. Capa gratuita.
  const listings = niWebListings({ cnzf, conami, publicEntities: NI_PUBLIC_ENTITIES });
  const { taxRows, webRows, excluded } = buildNiFreeDirectoryRows({ entries, registryRows, aliasRows, listings, ...params });
  taxRows.sort((a, b) => b.priority_score - a.priority_score || a.normalized_tax_id!.localeCompare(b.normalized_tax_id!));
  webRows.sort((a, b) => b.priority_score - a.priority_score || String(a.record_identity_key).localeCompare(String(b.record_identity_key)));
  console.log(`  ${NI_FREE_DIRECTORY_SOURCE_KEY}: ${taxRows.length} · ${NI_FREE_DIRECTORY_WEB_SOURCE_KEY}: ${webRows.length}`);
  console.log(`  Fuera de la capa gratuita: ${JSON.stringify(excluded)}`);
  const byMacro = new Map<string, { total: number; large: number; withDomain: number; withRuc: number; byKind: Record<string, number> }>();
  for (const row of [...taxRows, ...webRows]) {
    const macro = String(row.raw_data['macro_industry_key']);
    const stat = byMacro.get(macro) ?? { total: 0, large: 0, withDomain: 0, withRuc: 0, byKind: {} };
    stat.total++;
    if (row.raw_data['dgi_large_taxpayer'] === true) stat.large++;
    if (row.raw_data['website_domain']) stat.withDomain++;
    if (row.normalized_tax_id) stat.withRuc++;
    const kind = String(row.raw_data['directory_kind']);
    stat.byKind[kind] = (stat.byKind[kind] ?? 0) + 1;
    byMacro.set(macro, stat);
  }
  for (const [macro, stat] of [...byMacro].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `    ${macro}: ${stat.total} (con RUC ${stat.withRuc}, Grandes Contribuyentes ${stat.large}, con web ${stat.withDomain}) ${JSON.stringify(stat.byKind)}`,
    );
  }

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=… (con autorización) para persistir.');
    return;
  }

  const [sourceKey, rows] =
    config.only === 'registry'
      ? [NI_RUC_REGISTRY_SOURCE_KEY, registryRows]
      : config.only === 'alias'
        ? [NI_RUC_NAME_ALIAS_SOURCE_KEY, aliasRows]
        : config.only === 'directory'
          ? [NI_FREE_DIRECTORY_SOURCE_KEY, taxRows]
          : [NI_FREE_DIRECTORY_WEB_SOURCE_KEY, webRows.filter((row) => row.record_identity_key !== null)];
  assertLargeImportAllowed({ sourceKey, countryCode: 'NI', estimatedRows: rows.length, isDryRun: false });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  console.log(`  rowsUpserted (${sourceKey}) = ${await upsertAll(client, rows)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
