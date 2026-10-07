/**
 * PA — ETL de las fuentes oficiales de Panamá (SOURCES-PA-CLOSE-1)
 *
 * Junta por RUC PanamaCompraEnCifras (proveedoras y entidades compradoras,
 * adjudicaciones 2022-2026 y UNSPSC de los datos OCDS) y la lista de Grandes
 * Contribuyentes de la DGI, y escribe en `source_company_snapshots`:
 *
 *   - pa_ruc_registry     RUC por nombre dentro de la corrida (un RUC, una fila)
 *   - pa_ruc_name_alias   otros nombres de cada RUC (siglas, nombre comercial…)
 *   - pa_free_directory   capa gratuita por industria
 *
 * Entradas (ficheros locales; el script no sale a la red):
 *   --dir=<carpeta>  con pa_suppliers.jsonl y pa_buyers.jsonl
 *                    (`extract-pa-panamacompra.py`) y pa_large_taxpayers.jsonl
 *                    (`extract-pa-dgi-large-taxpayers.py`).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-pa-sources-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   … --apply --only=registry|alias|directory
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` exige `--only=` y escribe sólo esa clave.
 *   - `assertLargeImportAllowed` antes de escribir (más de 25 k filas exige
 *     SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y SELLUP_CONFIRMED_SOURCE_KEY=<clave>).
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
  buildPaFreeDirectoryRow,
  buildPaRucNameAliasRows,
  buildPaRucRegistryRow,
  mergePanamaRucSources,
  paEntryAliasKeys,
  paOwnNameKeys,
  parsePaBuyer,
  parsePaLargeTaxpayer,
  parsePaSupplier,
  PA_FREE_DIRECTORY_SOURCE_KEY,
  PA_RUC_NAME_ALIAS_SOURCE_KEY,
  PA_RUC_REGISTRY_SOURCE_KEY,
  type PaDirectoryExclusion,
  type PaSnapshotRow,
} from '../../src/server/source-catalog/connectors/panamacompra-pa/pa-sources-rows';
import { panamaCompanyDomainFromEmailDomain } from '../../src/server/source-catalog/connectors/panamacompra-pa/pa-domain';
import { dropAliasKeysOwnedByOthers } from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['registry', 'alias', 'directory'] as const;
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

async function upsertAll(client: SupabaseClient, rows: readonly PaSnapshotRow[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
    console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  return upserted;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`PA SOURCES ETL — ${config.apply ? `APPLY (${config.only})` : 'DRY-RUN (no escribe)'}`);

  const suppliers = readJsonl(join(config.dir, 'pa_suppliers.jsonl')).map(parsePaSupplier).filter((row) => row !== null);
  const buyers = readJsonl(join(config.dir, 'pa_buyers.jsonl')).map(parsePaBuyer).filter((row) => row !== null);
  const largeTaxpayers = readJsonl(join(config.dir, 'pa_large_taxpayers.jsonl'))
    .map(parsePaLargeTaxpayer)
    .filter((row) => row !== null);
  console.log(`  Leídos: ${suppliers.length} proveedores, ${buyers.length} entidades, ${largeTaxpayers.length} Grandes Contribuyentes`);

  const { entries, excluded } = mergePanamaRucSources({ suppliers, buyers, largeTaxpayers });
  console.log(`  Excluidos por fuente: ${JSON.stringify(excluded)}`);

  const importedAt = new Date().toISOString();
  const params = { sourceYear: config.year, importedAt };

  // 1. Registro de RUC.
  const registryRows: PaSnapshotRow[] = [];
  for (const entry of entries.values()) {
    const row = buildPaRucRegistryRow(entry, params);
    if (row !== null && row.record_identity_key !== null) registryRows.push(row);
  }
  registryRows.sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of registryRows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = registryRows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;
  const byOrigin = new Map<string, number>();
  for (const row of registryRows) {
    for (const origin of row.raw_data['origins'] as string[]) byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
  }
  console.log(`  ${PA_RUC_REGISTRY_SOURCE_KEY}: ${registryRows.length} RUC (${unique} con nombre único) — ${JSON.stringify(Object.fromEntries(byOrigin))}`);

  // 2. Alias: nunca el nombre propio de otro RUC.
  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of paOwnNameKeys(row)) owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id));
  }
  const aliasRows = registryRows.flatMap((row) =>
    buildPaRucNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(paEntryAliasKeys(entries.get(row.tax_id)!, row.normalized_legal_name), row.tax_id, owners),
    }),
  );
  console.log(`  ${PA_RUC_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length}`);

  // 3. Capa gratuita. Un dominio de correo compartido por dos o más RUC no se usa.
  const domainOwners = new Map<string, number>();
  for (const entry of entries.values()) {
    const domain = panamaCompanyDomainFromEmailDomain(entry.supplier?.emailDomain);
    if (domain !== null) domainOwners.set(domain, (domainOwners.get(domain) ?? 0) + 1);
  }
  const sharedDomains = new Set([...domainOwners].filter(([, n]) => n > 1).map(([domain]) => domain));
  const directoryRows: PaSnapshotRow[] = [];
  const directoryExcluded = new Map<PaDirectoryExclusion, number>();
  for (const entry of entries.values()) {
    const result = buildPaFreeDirectoryRow(entry, { ...params, sharedDomains });
    if ('excluded' in result) directoryExcluded.set(result.excluded, (directoryExcluded.get(result.excluded) ?? 0) + 1);
    else if (result.row.record_identity_key !== null) directoryRows.push(result.row);
  }
  directoryRows.sort((a, b) => b.priority_score - a.priority_score || a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  console.log(`  ${PA_FREE_DIRECTORY_SOURCE_KEY}: ${directoryRows.length} (dominios compartidos descartados: ${sharedDomains.size})`);
  console.log(`  Fuera de la capa gratuita: ${JSON.stringify(Object.fromEntries(directoryExcluded))}`);
  const byMacro = new Map<string, { total: number; large: number; withDomain: number; byKind: Record<string, number> }>();
  for (const row of directoryRows) {
    const macro = String(row.raw_data['macro_industry_key']);
    const stat = byMacro.get(macro) ?? { total: 0, large: 0, withDomain: 0, byKind: {} };
    stat.total++;
    if (row.raw_data['dgi_large_taxpayer'] === true) stat.large++;
    if (row.raw_data['website_domain']) stat.withDomain++;
    const kind = String(row.raw_data['directory_kind']);
    stat.byKind[kind] = (stat.byKind[kind] ?? 0) + 1;
    byMacro.set(macro, stat);
  }
  for (const [macro, stat] of [...byMacro].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${macro}: ${stat.total} (Grandes Contribuyentes ${stat.large}, con web ${stat.withDomain}) ${JSON.stringify(stat.byKind)}`);
  }

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=… (con autorización) para persistir.');
    return;
  }

  const [sourceKey, rows] =
    config.only === 'registry'
      ? [PA_RUC_REGISTRY_SOURCE_KEY, registryRows]
      : config.only === 'alias'
        ? [PA_RUC_NAME_ALIAS_SOURCE_KEY, aliasRows]
        : [PA_FREE_DIRECTORY_SOURCE_KEY, directoryRows];
  assertLargeImportAllowed({ sourceKey, countryCode: 'PA', estimatedRows: rows.length, isDryRun: false });

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
