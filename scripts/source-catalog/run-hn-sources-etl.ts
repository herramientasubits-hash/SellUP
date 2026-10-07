/**
 * HN — ETL de las fuentes oficiales de Honduras (SOURCES-HN-CLOSE-1)
 *
 * Lee las partes OCDS de ONCAE / HonduCompras y SEFIN / SIAFI 2018-2026 (datos
 * abiertos, CC BY 4.0) y, opcionalmente, las instituciones de la CNBS, y escribe en
 * `source_company_snapshots`:
 *
 *   - hn_ocds_rtn_registry        RTN por nombre dentro de la corrida (un RTN, una fila)
 *   - hn_rtn_name_alias           otros nombres de cada RTN (siglas, nombre comercial…)
 *   - hn_honducompras_directory   capa gratuita de empresas por industria
 *   - hn_public_entities          capa gratuita de Gobierno (entidades con web)
 *
 * Entradas (ficheros locales; el script no sale a la red):
 *   --ocds-dir=<carpeta>  con hn_suppliers.jsonl y hn_buyers.jsonl
 *                         (`extract-hn-ocds-parties.py`).
 *   --cnbs=<fichero>      (opcional) CSV de instituciones de datos.cnbs.gob.hn.
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-hn-sources-etl.ts --ocds-dir=… [--cnbs=…]
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   … --apply --only=registry|alias|directory|public
 *   … --apply --only=registry --prune-stale   (además borra las filas del registro
 *     que la carga nueva ya no trae: la clave única incluye el año, así que una
 *     empresa cuyo último año cambió dejaría su fila vieja; exige autorización aparte)
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
  buildHnHonducomprasDirectoryRow,
  buildHnPublicEntityRow,
  buildHnRtnNameAliasRows,
  buildHnRtnRegistryRow,
  cnbsAcronymsByCore,
  hnOwnNameKeys,
  hnSupplierAliasKeys,
  hnSupplierDomain,
  HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY,
  HN_OCDS_RTN_SOURCE_KEY,
  HN_PUBLIC_ENTITIES_SOURCE_KEY,
  HN_RTN_NAME_ALIAS_SOURCE_KEY,
  parseCnbsInstitutionsCsv,
  parseHnOcdsBuyer,
  parseHnOcdsSupplier,
  type HnDirectoryExclusion,
  type HnOcdsSupplier,
  type HnPublicEntityExclusion,
  type HnSnapshotRow,
} from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-sources-rows';
import { hondurasPublicEntityDomain } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-domain';
import { dropAliasKeysOwnedByOthers } from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['registry', 'alias', 'directory', 'public'] as const;
type Only = (typeof ONLY_VALUES)[number];

type Config = { ocdsDir: string; cnbs: string | null; apply: boolean; only: Only | null; pruneStale: boolean };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const ocdsDir = value('ocds-dir');
  if (!ocdsDir) throw new Error('config_invalid: falta --ocds-dir');
  const only = value('only');
  if (only !== null && !(ONLY_VALUES as readonly string[]).includes(only)) {
    throw new Error(`config_invalid: --only debe ser ${ONLY_VALUES.join(' | ')}`);
  }
  const apply = argv.includes('--apply');
  if (apply && only === null) throw new Error('config_invalid: --apply exige --only= (una carga cada vez)');
  const pruneStale = argv.includes('--prune-stale');
  if (pruneStale && only !== 'registry') throw new Error('config_invalid: --prune-stale sólo vale con --only=registry');
  return { ocdsDir, cnbs: value('cnbs'), apply, only: only as Only | null, pruneStale };
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

async function upsertAll(client: SupabaseClient, rows: readonly HnSnapshotRow[]): Promise<number> {
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

/** Borra las filas del registro (misma clave) que la carga nueva no trae. */
async function pruneStaleRegistryRows(client: SupabaseClient, rows: readonly HnSnapshotRow[]): Promise<number> {
  const keep = new Set(rows.map((row) => `${row.record_identity_key}|${row.source_year}`));
  const stale: Array<{ id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('id, record_identity_key, source_year')
      .eq('source_key', HN_OCDS_RTN_SOURCE_KEY)
      .eq('country_code', 'HN')
      .range(from, from + 999);
    if (error) throw new Error(`prune_read_failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ id: string; record_identity_key: string; source_year: number }>) {
      if (!keep.has(`${row.record_identity_key}|${row.source_year}`)) stale.push({ id: row.id });
    }
    if (data.length < 1000) break;
  }
  for (let i = 0; i < stale.length; i += 500) {
    const ids = stale.slice(i, i + 500).map((row) => row.id);
    const { error } = await client.from('source_company_snapshots').delete().in('id', ids).eq('source_key', HN_OCDS_RTN_SOURCE_KEY);
    if (error) throw new Error(`prune_delete_failed_at_${i}: ${error.message}`);
  }
  return stale.length;
}

function countBy<T extends string>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`HN SOURCES ETL — ${config.apply ? `APPLY (${config.only}${config.pruneStale ? ' + prune-stale' : ''})` : 'DRY-RUN (no escribe)'}`);

  const suppliers = readJsonl(join(config.ocdsDir, 'hn_suppliers.jsonl'))
    .map(parseHnOcdsSupplier)
    .filter((row): row is HnOcdsSupplier => row !== null);
  const buyers = readJsonl(join(config.ocdsDir, 'hn_buyers.jsonl'))
    .map(parseHnOcdsBuyer)
    .filter((row) => row !== null);
  const cnbs = config.cnbs ? parseCnbsInstitutionsCsv(readFileSync(config.cnbs, 'utf8')) : [];
  console.log(`  Leídos: ${suppliers.length} proveedores jurídicos, ${buyers.length} entidades compradoras, ${cnbs.length} instituciones CNBS`);

  const importedAt = new Date().toISOString();

  // 1. Registro de RTN.
  const registryRows: HnSnapshotRow[] = [];
  const supplierByRtn = new Map<string, HnOcdsSupplier>();
  for (const supplier of suppliers) {
    const row = buildHnRtnRegistryRow(supplier, { importedAt });
    if (row !== null && row.record_identity_key !== null) {
      registryRows.push(row);
      supplierByRtn.set(supplier.rtn, supplier);
    }
  }
  registryRows.sort((a, b) => (a.normalized_tax_id ?? '').localeCompare(b.normalized_tax_id ?? ''));
  const cores = new Map<string, number>();
  for (const row of registryRows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = registryRows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;
  const mipyme = registryRows.filter((row) => row.raw_data['hn_mipyme_year'] !== undefined).length;
  console.log(`  ${HN_OCDS_RTN_SOURCE_KEY}: ${registryRows.length} RTN (${unique} con nombre único, ${mipyme} con marca MIPYME)`);

  // 2. Alias: nunca el nombre propio de otro RTN.
  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of hnOwnNameKeys(row)) owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id!));
  }
  const acronyms = cnbsAcronymsByCore(cnbs);
  const aliasRows = registryRows.flatMap((row) =>
    buildHnRtnNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(
        hnSupplierAliasKeys(supplierByRtn.get(row.tax_id!)!, row.normalized_legal_name, acronyms),
        row.tax_id!,
        owners,
      ),
    }),
  );
  console.log(`  ${HN_RTN_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length}`);

  // 3. Capa gratuita de empresas. Un dominio de correo compartido por dos o más RTN no se usa.
  const domainOwners = new Map<string, number>();
  for (const supplier of suppliers) {
    const domain = hnSupplierDomain(supplier);
    if (domain !== null) domainOwners.set(domain, (domainOwners.get(domain) ?? 0) + 1);
  }
  const sharedDomains = new Set([...domainOwners].filter(([, n]) => n > 1).map(([domain]) => domain));
  const directoryRows: HnSnapshotRow[] = [];
  const directoryExcluded = new Map<HnDirectoryExclusion, number>();
  for (const supplier of suppliers) {
    const result = buildHnHonducomprasDirectoryRow(supplier, { importedAt, sharedDomains });
    if ('excluded' in result) countBy(directoryExcluded, result.excluded);
    else if (result.row.record_identity_key !== null) directoryRows.push(result.row);
  }
  directoryRows.sort((a, b) => b.priority_score - a.priority_score || (a.normalized_tax_id ?? '').localeCompare(b.normalized_tax_id ?? ''));
  console.log(`  ${HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY}: ${directoryRows.length} (dominios compartidos descartados: ${sharedDomains.size})`);
  console.log(`  Fuera de la capa gratuita: ${JSON.stringify(Object.fromEntries(directoryExcluded))}`);
  const byMacro = new Map<string, { total: number; withDomain: number; siafi: number }>();
  for (const row of directoryRows) {
    const macro = String(row.raw_data['macro_industry_key']);
    const stat = byMacro.get(macro) ?? { total: 0, withDomain: 0, siafi: 0 };
    stat.total++;
    if (row.raw_data['website_domain']) stat.withDomain++;
    if (row.raw_data['directory_kind'] === 'siafi_supplier') stat.siafi++;
    byMacro.set(macro, stat);
  }
  for (const [macro, stat] of [...byMacro].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${macro}: ${stat.total} (con web ${stat.withDomain}, por objeto del gasto ${stat.siafi})`);
  }

  // 4. Gobierno: entidades compradoras con web; el RTN si la entidad también vende.
  const rtnByPublicKey = new Map<string, string>();
  const publicKeyOwners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of hnOwnNameKeys(row)) publicKeyOwners.set(key, (publicKeyOwners.get(key) ?? new Set<string>()).add(row.tax_id!));
  }
  for (const [key, rtns] of publicKeyOwners) if (rtns.size === 1) rtnByPublicKey.set(key, [...rtns][0]);
  const buyerDomainOwners = new Map<string, number>();
  for (const buyer of buyers) {
    const domain = hondurasPublicEntityDomain({ name: buyer.name, urls: buyer.urls, emails: buyer.emails });
    if (domain !== null) buyerDomainOwners.set(domain, (buyerDomainOwners.get(domain) ?? 0) + 1);
  }
  const sharedBuyerDomains = new Set([...buyerDomainOwners].filter(([, n]) => n > 1).map(([domain]) => domain));
  const publicRows: HnSnapshotRow[] = [];
  const publicExcluded = new Map<HnPublicEntityExclusion | 'duplicate_name', number>();
  const seenPublicCores = new Set<string>();
  for (const buyer of buyers) {
    const result = buildHnPublicEntityRow(buyer, { importedAt, sharedDomains: sharedBuyerDomains, rtnByPublicKey });
    if ('excluded' in result) countBy(publicExcluded, result.excluded);
    else if (seenPublicCores.has(result.row.normalized_legal_name)) countBy(publicExcluded, 'duplicate_name');
    else if (result.row.record_identity_key !== null) {
      seenPublicCores.add(result.row.normalized_legal_name);
      publicRows.push(result.row);
    }
  }
  const byKind = new Map<string, number>();
  for (const row of publicRows) countBy(byKind, String(row.raw_data['entity_kind']));
  console.log(
    `  ${HN_PUBLIC_ENTITIES_SOURCE_KEY}: ${publicRows.length} (con RTN ${publicRows.filter((r) => r.tax_id !== null).length}) — ${JSON.stringify(Object.fromEntries(byKind))}`,
  );
  console.log(`  Fuera de Gobierno: ${JSON.stringify(Object.fromEntries(publicExcluded))}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=… (con autorización) para persistir.');
    return;
  }

  const [sourceKey, rows] =
    config.only === 'registry'
      ? [HN_OCDS_RTN_SOURCE_KEY, registryRows]
      : config.only === 'alias'
        ? [HN_RTN_NAME_ALIAS_SOURCE_KEY, aliasRows]
        : config.only === 'directory'
          ? [HN_HONDUCOMPRAS_DIRECTORY_SOURCE_KEY, directoryRows]
          : [HN_PUBLIC_ENTITIES_SOURCE_KEY, publicRows];
  assertLargeImportAllowed({ sourceKey, countryCode: 'HN', estimatedRows: rows.length, isDryRun: false });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  console.log(`  rowsUpserted (${sourceKey}) = ${await upsertAll(client, rows)}`);
  if (config.pruneStale) console.log(`  rowsPruned (${sourceKey}) = ${await pruneStaleRegistryRows(client, rows)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
