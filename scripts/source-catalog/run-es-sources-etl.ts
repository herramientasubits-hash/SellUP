/**
 * run-es-sources-etl.ts — SOURCES-ES-CLOSE-1. Carga las fuentes oficiales de España
 * en `source_company_snapshots` (cinco claves, una por `--only`).
 *
 * Entradas: la carpeta de salida de `scripts/source-catalog/extract-es-sources.py`
 * (es_awardees.jsonl, es_bodies.jsonl, es_bdns.jsonl, es_invente.jsonl, es_bde.jsonl)
 * y, opcional, un volcado de LECTURA del registro que ya está en Prod
 * (`--existing=<tsv>`: «fuente<TAB>NIF<TAB>razón social» por línea) para no perder
 * las adjudicatarias de meses que no se vuelven a descargar.
 *
 * Uso:
 *   npx tsx scripts/source-catalog/run-es-sources-etl.ts --in-dir=… [--existing=…] [--year=2026]
 *   npx tsx scripts/source-catalog/run-es-sources-etl.ts --in-dir=… --apply --only=placsp-registry [--prune-stale]
 *     (--only = placsp-registry | official-registry | alias | directory | public)
 *
 * Garantías:
 *   - DRY-RUN por defecto: imprime los conteos y no escribe.
 *   - `--apply` exige `--only` (una clave cada vez) y la autorización explícita de la
 *     dueña para ESA carga; más de 25 000 filas exigen además
 *     SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y SELLUP_CONFIRMED_SOURCE_KEY=<clave>.
 *   - `--prune-stale` (sólo registros) borra las filas de esa clave que la carga no trae.
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
  buildEsFreeDirectoryRow,
  buildEsNifNameAliasRows,
  buildEsOfficialNifRegistryRow,
  buildEsPlacspNifRegistryRow,
  buildEsPublicEntityRow,
  esAliasKeysForNames,
  esOwnNameKeys,
  ES_FREE_DIRECTORY_SOURCE_KEY,
  ES_NIF_NAME_ALIAS_SOURCE_KEY,
  ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY,
  ES_PLACSP_REGISTRY_SOURCE_KEY,
  ES_PUBLIC_ENTITIES_SOURCE_KEY,
  isEsInventePublicBody,
  parseEsAwardee,
  parseEsBdeEntity,
  parseEsBdnsBeneficiary,
  parseEsContractingBody,
  parseEsInventeEntity,
  type EsAwardee,
  type EsBdeEntity,
  type EsBdnsBeneficiary,
  type EsContractingBody,
  type EsDirectoryExclusion,
  type EsInventeEntity,
  type EsPublicEntityExclusion,
  type EsSnapshotRow,
} from '../../src/server/source-catalog/connectors/placsp-spain/es-sources-rows';
import { normalizeSpainCompanyNif } from '../../src/server/source-catalog/connectors/placsp-spain/es-placsp-registry-rows';
import { spainCompanyDomain, spainPublicEntityDomain } from '../../src/server/source-catalog/connectors/placsp-spain/es-domain';
import { dropAliasKeysOwnedByOthers } from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['placsp-registry', 'official-registry', 'alias', 'directory', 'public'] as const;
type Only = (typeof ONLY_VALUES)[number];
const REGISTRY_ONLY: ReadonlySet<Only> = new Set(['placsp-registry', 'official-registry']);

type Config = { inDir: string; existing: string | null; year: number; apply: boolean; only: Only | null; pruneStale: boolean };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const inDir = value('in-dir');
  if (!inDir) throw new Error('config_invalid: falta --in-dir');
  const only = value('only');
  if (only !== null && !(ONLY_VALUES as readonly string[]).includes(only)) {
    throw new Error(`config_invalid: --only debe ser ${ONLY_VALUES.join(' | ')}`);
  }
  const apply = argv.includes('--apply');
  if (apply && only === null) throw new Error('config_invalid: --apply exige --only= (una carga cada vez)');
  const pruneStale = argv.includes('--prune-stale');
  if (pruneStale && (only === null || !REGISTRY_ONLY.has(only as Only))) {
    throw new Error('config_invalid: --prune-stale sólo vale con --only=placsp-registry | official-registry');
  }
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser entero');
  return { inDir, existing: value('existing'), year, apply, only: only as Only | null, pruneStale };
}

function readJsonl<T>(path: string, parse: (raw: unknown) => T | null): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parse(JSON.parse(line) as unknown))
    .filter((row): row is T => row !== null);
}

/** Volcado de lectura del registro en Prod → adjudicatarias sólo con nombre. */
function readExisting(path: string | null): EsAwardee[] {
  if (path === null) return [];
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  const out: EsAwardee[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const [, rawNif, name] = line.split('\t');
    const nif = normalizeSpainCompanyNif(rawNif);
    if (nif !== null && name?.trim()) out.push({ nif, names: { [name.trim()]: 1 }, cpv: {}, eur: 0, contracts: 0, last: null, postal: null });
  }
  return out;
}

function byNif<T extends { nif: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.nif, item]));
}

async function upsertAll(client: SupabaseClient, rows: readonly EsSnapshotRow[]): Promise<number> {
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

/** Borra las filas de un registro (misma clave) que la carga nueva no trae. */
async function pruneStaleRows(client: SupabaseClient, sourceKey: string, rows: readonly EsSnapshotRow[]): Promise<number> {
  const keep = new Set(rows.map((row) => `${row.record_identity_key}|${row.source_year}`));
  const stale: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('id, record_identity_key, source_year')
      .eq('source_key', sourceKey)
      .eq('country_code', 'ES')
      .range(from, from + 999);
    if (error) throw new Error(`prune_read_failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ id: string; record_identity_key: string; source_year: number }>) {
      if (!keep.has(`${row.record_identity_key}|${row.source_year}`)) stale.push(row.id);
    }
    if (data.length < 1000) break;
  }
  for (let i = 0; i < stale.length; i += 500) {
    const { error } = await client.from('source_company_snapshots').delete().in('id', stale.slice(i, i + 500)).eq('source_key', sourceKey);
    if (error) throw new Error(`prune_delete_failed_at_${i}: ${error.message}`);
  }
  return stale.length;
}

function countBy<T extends string>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sharedOf(domains: Iterable<string | null>): Set<string> {
  const owners = new Map<string, number>();
  for (const domain of domains) if (domain !== null) owners.set(domain, (owners.get(domain) ?? 0) + 1);
  return new Set([...owners].filter(([, n]) => n > 1).map(([domain]) => domain));
}

function mergeAwardees(fresh: readonly EsAwardee[], existing: readonly EsAwardee[]): EsAwardee[] {
  const merged = new Map(fresh.map((a) => [a.nif, a]));
  for (const old of existing) {
    const current = merged.get(old.nif);
    if (current === undefined) merged.set(old.nif, old);
    else merged.set(old.nif, { ...current, names: { ...old.names, ...current.names } });
  }
  return [...merged.values()];
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`ES SOURCES ETL — ${config.apply ? `APPLY (${config.only}${config.pruneStale ? ' + prune-stale' : ''})` : 'DRY-RUN (no escribe)'}`);
  const params = { importedAt: new Date().toISOString(), sourceYear: config.year };

  const awardees = mergeAwardees(readJsonl(join(config.inDir, 'es_awardees.jsonl'), parseEsAwardee), readExisting(config.existing));
  const bodies = readJsonl(join(config.inDir, 'es_bodies.jsonl'), parseEsContractingBody);
  const bdns = readJsonl(join(config.inDir, 'es_bdns.jsonl'), parseEsBdnsBeneficiary);
  const invente = readJsonl(join(config.inDir, 'es_invente.jsonl'), parseEsInventeEntity);
  const bde = readJsonl(join(config.inDir, 'es_bde.jsonl'), parseEsBdeEntity);
  console.log(
    `  Leídos: ${awardees.length} adjudicatarias, ${bodies.length} órganos, ${bdns.length} beneficiarias BDNS, ${invente.length} entes INVENTE, ${bde.length} entidades Banco de España`,
  );
  const awardeeByNif = byNif(awardees);
  const bdnsByNif = byNif<EsBdnsBeneficiary>(bdns);
  const inventeByNif = byNif<EsInventeEntity>(invente);
  const bdeByNif = byNif<EsBdeEntity>(bde);
  const bodyByNif = byNif<EsContractingBody>(bodies);

  // 1. Registros de NIF por nombre.
  const placspRows = awardees
    .map((a) => buildEsPlacspNifRegistryRow(a, params))
    .filter((row): row is EsSnapshotRow => row !== null && row.record_identity_key !== null)
    .sort((a, b) => (a.normalized_tax_id ?? '').localeCompare(b.normalized_tax_id ?? ''));
  const officialNifs = new Set([...bdnsByNif.keys(), ...inventeByNif.keys(), ...bdeByNif.keys()]);
  const officialRows = [...officialNifs]
    .map((nif) =>
      buildEsOfficialNifRegistryRow(
        { nif, bdns: bdnsByNif.get(nif) ?? null, invente: inventeByNif.get(nif) ?? null, bde: bdeByNif.get(nif) ?? null },
        params,
      ),
    )
    .filter((row): row is EsSnapshotRow => row !== null && row.record_identity_key !== null)
    .sort((a, b) => (a.normalized_tax_id ?? '').localeCompare(b.normalized_tax_id ?? ''));
  for (const [key, rows] of [
    [ES_PLACSP_REGISTRY_SOURCE_KEY, placspRows],
    [ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY, officialRows],
  ] as const) {
    const cores = new Map<string, number>();
    for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
    const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;
    const workers = rows.filter((row) => row.raw_data['workers'] !== undefined).length;
    const large = rows.filter((row) => row.raw_data['taxpayer_category'] !== undefined).length;
    console.log(`  ${key}: ${rows.length} NIF (${unique} con nombre único; plantilla ${workers}; «gran empresa» ${large})`);
  }

  // 2. Alias: todos los nombres publicados de cada NIF, nunca el nombre propio de otro NIF.
  const registryByNif = new Map<string, EsSnapshotRow>();
  for (const row of [...officialRows, ...placspRows]) registryByNif.set(row.tax_id!, row);
  const owners = new Map<string, Set<string>>();
  for (const row of [...placspRows, ...officialRows]) {
    for (const key of esOwnNameKeys(row)) owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id!));
  }
  const aliasRows = [...registryByNif.values()].flatMap((row) => {
    const nif = row.tax_id!;
    const names = [
      ...Object.keys(awardeeByNif.get(nif)?.names ?? {}),
      ...Object.keys(bdnsByNif.get(nif)?.names ?? {}),
      inventeByNif.get(nif)?.name,
      bdeByNif.get(nif)?.name,
    ].filter((n): n is string => typeof n === 'string');
    return buildEsNifNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(esAliasKeysForNames(names, row.normalized_legal_name), nif, owners),
    });
  });
  console.log(`  ${ES_NIF_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length}`);

  // 3. Capa gratuita de empresas. Un dominio publicado por dos o más NIF no se usa.
  const sharedDomains = sharedOf(
    [...officialNifs].map((nif) =>
      spainCompanyDomain({
        urls: [inventeByNif.get(nif)?.web, bdeByNif.get(nif)?.web].filter((u): u is string => typeof u === 'string'),
        emails: [inventeByNif.get(nif)?.email].filter((e): e is string => typeof e === 'string'),
      }),
    ),
  );
  const directoryRows: EsSnapshotRow[] = [];
  const directoryExcluded = new Map<EsDirectoryExclusion, number>();
  for (const nif of new Set([...awardeeByNif.keys(), ...officialNifs])) {
    const result = buildEsFreeDirectoryRow(
      {
        nif,
        awardee: awardeeByNif.get(nif) ?? null,
        bdns: bdnsByNif.get(nif) ?? null,
        invente: inventeByNif.get(nif) ?? null,
        bde: bdeByNif.get(nif) ?? null,
      },
      { ...params, sharedDomains },
    );
    if ('excluded' in result) countBy(directoryExcluded, result.excluded);
    else if (result.row.record_identity_key !== null) directoryRows.push(result.row);
  }
  directoryRows.sort((a, b) => b.priority_score - a.priority_score || (a.normalized_tax_id ?? '').localeCompare(b.normalized_tax_id ?? ''));
  console.log(`  ${ES_FREE_DIRECTORY_SOURCE_KEY}: ${directoryRows.length} (dominios compartidos descartados: ${sharedDomains.size})`);
  console.log(`  Fuera de la capa gratuita: ${JSON.stringify(Object.fromEntries(directoryExcluded))}`);
  const byMacro = new Map<string, { total: number; withDomain: number; large: number; workers: number; kinds: Map<string, number> }>();
  for (const row of directoryRows) {
    const macro = String(row.raw_data['macro_industry_key']);
    const stat = byMacro.get(macro) ?? { total: 0, withDomain: 0, large: 0, workers: 0, kinds: new Map<string, number>() };
    stat.total++;
    if (row.raw_data['website_domain']) stat.withDomain++;
    if (row.raw_data['bdns_large_year'] !== undefined) stat.large++;
    if (row.raw_data['workers'] !== undefined) stat.workers++;
    countBy(stat.kinds, String(row.raw_data['directory_kind']));
    byMacro.set(macro, stat);
  }
  for (const [macro, stat] of [...byMacro].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `    ${macro}: ${stat.total} (con web ${stat.withDomain}, «gran empresa» ${stat.large}, con plantilla ${stat.workers}) ${JSON.stringify(Object.fromEntries(stat.kinds))}`,
    );
  }

  // 4. Gobierno: órganos de contratación (NIF P, Q, S) y entes públicos de INVENTE, con web que los nombra.
  const publicNifs = new Set([...bodyByNif.keys(), ...invente.filter(isEsInventePublicBody).map((e) => e.nif)]);
  const sharedPublicDomains = sharedOf(
    [...publicNifs].map((nif) => {
      const body = bodyByNif.get(nif);
      const ente = inventeByNif.get(nif);
      const name = ente?.name ?? Object.keys(body?.names ?? {})[0];
      if (name === undefined) return null;
      return spainPublicEntityDomain({
        name,
        urls: [ente?.web, ...(body?.urls ?? [])].filter((u): u is string => typeof u === 'string'),
        emails: [ente?.email, ...(body?.emails ?? [])].filter((e): e is string => typeof e === 'string'),
      });
    }),
  );
  const publicRows: EsSnapshotRow[] = [];
  const publicExcluded = new Map<EsPublicEntityExclusion | 'duplicate_name', number>();
  const seenPublicCores = new Set<string>();
  for (const nif of publicNifs) {
    const result = buildEsPublicEntityRow(
      { nif, body: bodyByNif.get(nif) ?? null, invente: inventeByNif.get(nif) ?? null },
      { ...params, sharedDomains: sharedPublicDomains },
    );
    if ('excluded' in result) countBy(publicExcluded, result.excluded);
    else if (seenPublicCores.has(result.row.normalized_legal_name)) countBy(publicExcluded, 'duplicate_name');
    else if (result.row.record_identity_key !== null) {
      seenPublicCores.add(result.row.normalized_legal_name);
      publicRows.push(result.row);
    }
  }
  publicRows.sort((a, b) => b.priority_score - a.priority_score || (a.normalized_tax_id ?? '').localeCompare(b.normalized_tax_id ?? ''));
  const byKind = new Map<string, number>();
  for (const row of publicRows) countBy(byKind, String(row.raw_data['entity_kind']));
  console.log(`  ${ES_PUBLIC_ENTITIES_SOURCE_KEY}: ${publicRows.length} — ${JSON.stringify(Object.fromEntries(byKind))}`);
  console.log(`  Fuera de Gobierno: ${JSON.stringify(Object.fromEntries(publicExcluded))}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=… (con autorización) para persistir.');
    return;
  }

  const target: Record<Only, [string, EsSnapshotRow[]]> = {
    'placsp-registry': [ES_PLACSP_REGISTRY_SOURCE_KEY, placspRows],
    'official-registry': [ES_OFFICIAL_NIF_REGISTRY_SOURCE_KEY, officialRows],
    alias: [ES_NIF_NAME_ALIAS_SOURCE_KEY, aliasRows],
    directory: [ES_FREE_DIRECTORY_SOURCE_KEY, directoryRows],
    public: [ES_PUBLIC_ENTITIES_SOURCE_KEY, publicRows],
  };
  const [sourceKey, rows] = target[config.only!];
  assertLargeImportAllowed({ sourceKey, countryCode: 'ES', estimatedRows: rows.length, isDryRun: false });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  console.log(`  rowsUpserted (${sourceKey}) = ${await upsertAll(client, rows)}`);
  if (config.pruneStale) console.log(`  rowsPruned (${sourceKey}) = ${await pruneStaleRows(client, sourceKey, rows)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
