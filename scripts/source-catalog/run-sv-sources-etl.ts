/**
 * SV — ETL de las fuentes oficiales de El Salvador (SOURCES-SV-CLOSE-1)
 *
 * Lee las salidas de `extract-sv-official-sources.py` (listados de Hacienda con NIT,
 * Portal de Transparencia y adjudicaciones públicas de COMPRASAL) y escribe en
 * `source_company_snapshots`:
 *
 *   - sv_nit_registry         NIT por nombre dentro de la corrida (un NIT, una fila;
 *                             nunca personas naturales)
 *   - sv_nit_name_alias       otros nombres de cada NIT (otro listado, siglas, clave pública)
 *   - sv_public_entities      capa gratuita de Gobierno (instituciones vigentes con web o NIT)
 *   - sv_comprasal_directory  capa gratuita de empresas por industria (proveedoras de
 *                             COMPRASAL empatadas a UN NIT del registro)
 *
 * Entradas (ficheros locales; el script no sale a la red):
 *   --in-dir=<carpeta>  con sv_tax_lists.jsonl, sv_transparencia.jsonl y
 *                       sv_comprasal_awards.jsonl.
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-sv-sources-etl.ts --in-dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   … --apply --only=registry|alias|public|directory --confirm
 *   … --apply --only=<clave> --confirm --prune-stale   (además borra las filas de ESA
 *     clave que la carga nueva ya no trae: un nombre corregido cambia la identidad)
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` exige `--only=` (una clave cada vez) y `--confirm`.
 *   - `--only=directory` se niega mientras la tabla de palabras de COMPRASAL no esté
 *     aprobada por la dueña (`SV_COMPRASAL_MACRO_TABLE_APPROVED`).
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
  aggregateSvComprasalSuppliers,
  buildSvComprasalDirectoryRow,
  buildSvPublicEntityRow,
  buildSvRegistryAndAliasRows,
  parseSvComprasalAward,
  parseSvTaxListEntry,
  parseSvTransparenciaInstitution,
  svComprasalBuyers,
  svPublicEntityNits,
  svTransparenciaCandidate,
  svUniqueNitByKey,
  SV_COMPRASAL_DIRECTORY_SOURCE_KEY,
  SV_NIT_NAME_ALIAS_SOURCE_KEY,
  SV_NIT_REGISTRY_SOURCE_KEY,
  SV_PUBLIC_ENTITIES_SOURCE_KEY,
  type SvComprasalAward,
  type SvDirectoryExclusion,
  type SvPublicEntityExclusion,
  type SvSnapshotRow,
  type SvTransparenciaInstitution,
} from '../../src/server/source-catalog/connectors/sv-official-sources/sv-sources-rows';
import { salvadorNameCore } from '../../src/server/source-catalog/connectors/sv-official-sources/sv-name-keys';
import { salvadorPublicEntityDomain } from '../../src/server/source-catalog/connectors/sv-official-sources/sv-domain';
import { SV_COMPRASAL_MACRO_TABLE_APPROVED } from '../../src/server/prospect-batches/country-source-discovery/sv-comprasal-macro-table';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['registry', 'alias', 'public', 'directory'] as const;
type Only = (typeof ONLY_VALUES)[number];

type Config = { inDir: string; apply: boolean; only: Only | null; pruneStale: boolean };

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
  if (apply && !argv.includes('--confirm')) throw new Error('config_invalid: --apply exige --confirm (autorización explícita de la dueña)');
  if (apply && only === 'directory' && !SV_COMPRASAL_MACRO_TABLE_APPROVED) {
    throw new Error('config_invalid: la tabla de palabras de COMPRASAL no está aprobada por la dueña');
  }
  const pruneStale = argv.includes('--prune-stale');
  if (pruneStale && !apply) throw new Error('config_invalid: --prune-stale sólo vale con --apply');
  return { inDir, apply, only: only as Only | null, pruneStale };
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

async function upsertAll(client: SupabaseClient, rows: readonly SvSnapshotRow[]): Promise<number> {
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

/** Borra las filas de la clave que la carga nueva no trae (identidad + año). */
async function pruneStaleRows(client: SupabaseClient, sourceKey: string, rows: readonly SvSnapshotRow[]): Promise<number> {
  const keep = new Set(rows.map((row) => `${row.record_identity_key}|${row.source_year}`));
  const stale: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('id, record_identity_key, source_year')
      .eq('source_key', sourceKey)
      .eq('country_code', 'SV')
      .range(from, from + 999);
    if (error) throw new Error(`prune_read_failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ id: string; record_identity_key: string; source_year: number }>) {
      if (!keep.has(`${row.record_identity_key}|${row.source_year}`)) stale.push(row.id);
    }
    if (data.length < 1000) break;
  }
  for (let i = 0; i < stale.length; i += 500) {
    const { error } = await client.from('source_company_snapshots').delete().in('id', stale.slice(i, i + 500)).eq('source_key', sourceKey).eq('country_code', 'SV');
    if (error) throw new Error(`prune_delete_failed_at_${i}: ${error.message}`);
  }
  return stale.length;
}

function countBy<T extends string>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Gobierno: instituciones vigentes (Transparencia + compradoras de COMPRASAL). */
function buildPublic(
  institutions: readonly SvTransparenciaInstitution[],
  awards: readonly SvComprasalAward[],
  nitByKey: ReadonlyMap<string, string>,
  publicNits: ReadonlySet<string>,
  importedAt: string,
) {
  const candidates = [...institutions.map(svTransparenciaCandidate), ...svComprasalBuyers(awards)];
  const domainOwners = new Map<string, number>();
  for (const c of candidates) {
    if (c.origin !== 'transparencia') continue;
    const domain = salvadorPublicEntityDomain({ name: c.name, acronym: c.acronym, siteUrl: c.siteUrl, emailDomain: c.emailDomain });
    if (domain !== null) domainOwners.set(domain, (domainOwners.get(domain) ?? 0) + 1);
  }
  const sharedDomains = new Set([...domainOwners].filter(([, n]) => n > 1).map(([domain]) => domain));
  const rows = new Map<string, SvSnapshotRow>();
  const keyByNit = new Map<string, string>();
  const excluded = new Map<SvPublicEntityExclusion | 'duplicate', number>();
  for (const candidate of candidates) {
    const result = buildSvPublicEntityRow(candidate, { importedAt, sharedDomains, nitByKey, publicNits });
    if ('excluded' in result) {
      countBy(excluded, result.excluded);
      continue;
    }
    // Una institución, una fila: por su clave pública y, si la tiene, por su NIT.
    const nit = result.row.tax_id;
    const key = (nit !== null ? keyByNit.get(nit) : undefined) ?? result.row.record_identity_key;
    if (key === null) continue;
    if (nit !== null && !keyByNit.has(nit)) keyByNit.set(nit, key);
    const current = rows.get(key);
    // Transparencia (con web) va primero; la compradora de COMPRASAL sólo añade su año.
    if (current === undefined) rows.set(key, result.row);
    else {
      countBy(excluded, 'duplicate');
      if (result.row.source_year > current.source_year) rows.set(key, { ...current, source_year: result.row.source_year });
    }
  }
  return { rows: [...rows.values()].sort((a, b) => b.priority_score - a.priority_score || a.normalized_legal_name.localeCompare(b.normalized_legal_name)), excluded, sharedDomains };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`SV SOURCES ETL — ${config.apply ? `APPLY (${config.only}${config.pruneStale ? ' + prune-stale' : ''})` : 'DRY-RUN (no escribe)'}`);

  const entries = readJsonl(join(config.inDir, 'sv_tax_lists.jsonl'))
    .map(parseSvTaxListEntry)
    .filter((e) => e !== null);
  const institutions = readJsonl(join(config.inDir, 'sv_transparencia.jsonl'))
    .map(parseSvTransparenciaInstitution)
    .filter((i): i is SvTransparenciaInstitution => i !== null);
  const awards = readJsonl(join(config.inDir, 'sv_comprasal_awards.jsonl'))
    .map(parseSvComprasalAward)
    .filter((a): a is SvComprasalAward => a !== null);
  const byList = new Map<string, number>();
  for (const e of entries) countBy(byList, e.list);
  console.log(`  Leídos: ${entries.length} filas de listados ${JSON.stringify(Object.fromEntries(byList))}, ${institutions.length} instituciones, ${awards.length} adjudicaciones`);

  const importedAt = new Date().toISOString();

  // 1-2. Registro y alias.
  const { registryRows, aliasRows, excluded: registryExcluded } = buildSvRegistryAndAliasRows(entries, { importedAt });
  const cores = new Map<string, number>();
  for (const row of registryRows) countBy(cores, row.normalized_legal_name);
  const unique = registryRows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;
  const categories = new Map<string, number>();
  for (const row of registryRows) countBy(categories, String(row.raw_data['taxpayer_category'] ?? 'sin_categoria'));
  const years = new Map<string, number>();
  for (const row of registryRows) countBy(years, String(row.source_year));
  console.log(`  ${SV_NIT_REGISTRY_SOURCE_KEY}: ${registryRows.length} NIT (${unique} con nombre único) — ${JSON.stringify(Object.fromEntries(categories))} — años ${JSON.stringify(Object.fromEntries(years))}`);
  console.log(`  Fuera del registro: ${JSON.stringify(Object.fromEntries(registryExcluded))}`);
  console.log(`  ${SV_NIT_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length}`);

  // 3. Gobierno.
  const nitByKey = svUniqueNitByKey(registryRows, aliasRows);
  const { rows: publicRows, excluded: publicExcluded, sharedDomains } = buildPublic(
    institutions,
    awards,
    nitByKey,
    svPublicEntityNits(registryRows),
    importedAt,
  );
  const byKind = new Map<string, number>();
  for (const row of publicRows) countBy(byKind, String(row.raw_data['entity_kind']));
  const withWeb = publicRows.filter((r) => r.raw_data['website_domain'] !== undefined).length;
  const withNit = publicRows.filter((r) => r.tax_id !== null).length;
  console.log(`  ${SV_PUBLIC_ENTITIES_SOURCE_KEY}: ${publicRows.length} (con web ${withWeb}, con NIT ${withNit}) — ${JSON.stringify(Object.fromEntries(byKind))} — dominios compartidos ${[...sharedDomains].join(', ')}`);
  console.log(`  Fuera de Gobierno: ${JSON.stringify(Object.fromEntries(publicExcluded))}`);

  // 4. Capa gratuita de empresas.
  const registryByNit = new Map(registryRows.map((row) => [row.tax_id!, row]));
  const ambiguousKeys = new Set([...cores].filter(([, n]) => n > 1).map(([core]) => core));
  const suppliers = aggregateSvComprasalSuppliers(awards);
  const directoryRows: SvSnapshotRow[] = [];
  const directoryExcluded = new Map<SvDirectoryExclusion, number>();
  const seenNit = new Set<string>();
  for (const supplier of suppliers) {
    const result = buildSvComprasalDirectoryRow(supplier, { importedAt, nitByKey, registryByNit, ambiguousKeys });
    if ('excluded' in result) countBy(directoryExcluded, result.excluded);
    else if (result.row.record_identity_key !== null && !seenNit.has(result.row.tax_id!)) {
      seenNit.add(result.row.tax_id!);
      directoryRows.push(result.row);
    }
  }
  directoryRows.sort((a, b) => b.priority_score - a.priority_score || (a.tax_id ?? '').localeCompare(b.tax_id ?? ''));
  console.log(`  ${SV_COMPRASAL_DIRECTORY_SOURCE_KEY}: ${directoryRows.length} de ${suppliers.length} proveedoras (tabla aprobada: ${SV_COMPRASAL_MACRO_TABLE_APPROVED ? 'sí' : 'NO — propuesta'})`);
  console.log(`  Fuera de la capa gratuita: ${JSON.stringify(Object.fromEntries(directoryExcluded))}`);
  const byMacro = new Map<string, number>();
  for (const row of directoryRows) countBy(byMacro, String(row.raw_data['macro_industry_key']));
  for (const [macro, n] of [...byMacro].sort((a, b) => b[1] - a[1])) console.log(`    ${macro}: ${n}`);
  const matchedEntities = suppliers.filter((s) => Object.keys(s.names).some((n) => nitByKey.has(salvadorNameCore(n)))).length;
  console.log(`  Proveedoras con algún nombre que ya da un NIT único: ${matchedEntities}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=… --confirm (con autorización) para persistir.');
    return;
  }

  const [sourceKey, rows] =
    config.only === 'registry'
      ? [SV_NIT_REGISTRY_SOURCE_KEY, registryRows]
      : config.only === 'alias'
        ? [SV_NIT_NAME_ALIAS_SOURCE_KEY, aliasRows]
        : config.only === 'public'
          ? [SV_PUBLIC_ENTITIES_SOURCE_KEY, publicRows]
          : [SV_COMPRASAL_DIRECTORY_SOURCE_KEY, directoryRows];
  assertLargeImportAllowed({ sourceKey, countryCode: 'SV', estimatedRows: rows.length, isDryRun: false });

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
