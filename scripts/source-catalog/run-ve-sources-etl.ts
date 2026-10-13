/**
 * VE — ETL de las fuentes de Venezuela (SOURCES-VE-CLOSE-1)
 *
 * Junta por RIF las emisoras y casas de bolsa de la Bolsa de Caracas, los sujetos
 * regulados de la SUDEASEG, los registros archivados de la SUNAVAL (2022), las
 * personas jurídicas de GLEIF y las webs comprobadas (empresas, universidades y
 * entes públicos), y escribe en `source_company_snapshots`:
 *
 *   - ve_rif_registry         RIF por nombre dentro de la corrida (un RIF, una fila)
 *   - ve_rif_name_alias       otros nombres de cada RIF (sigla, nombre en otra fuente…)
 *   - ve_free_directory       capa gratuita por industria, con RIF
 *   - ve_free_directory_web   capa gratuita por industria, sólo con web
 *
 * Entradas (ficheros locales; el script no sale a la red):
 *   --dir=<carpeta> con ve_bvc_issuers.jsonl, ve_bvc_members.jsonl, ve_sudeaseg.jsonl,
 *   ve_sunaval.jsonl y ve_gleif.jsonl (`extract-ve-official-sources.py`). Las webs
 *   comprobadas son tablas del código (`ve-web-entities.ts`, `ve-public-entities.ts`).
 *   --web-map=<webs.jsonl> (opcional): webs por nombre comprobadas (`discover-ve-company-webs.mts`).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ve-sources-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   … --apply --only=registry|alias|directory|directory_web
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` exige `--only=` y escribe sólo esa clave.
 *   - La capa gratuita (`directory`, `directory_web`) se niega mientras la dueña no
 *     apruebe las tablas de industria (`VE_FREE_DIRECTORY_MACRO_TABLES_APPROVED`).
 *   - La migración 146 (tipo 'RIF') tiene que estar aplicada antes de cargar.
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
  buildVeFreeDirectoryRows,
  buildVeRegistryAndAliasRows,
  mergeVenezuelaRifSources,
  parseVeCompanyWebLine,
  veWebListings,
  VE_FREE_DIRECTORY_SOURCE_KEY,
  VE_FREE_DIRECTORY_WEB_SOURCE_KEY,
  VE_RIF_NAME_ALIAS_SOURCE_KEY,
  VE_RIF_REGISTRY_SOURCE_KEY,
  type VeSnapshotRow,
} from '../../src/server/source-catalog/connectors/ve-sources/ve-sources-rows';
import {
  parseVeBvcIssuer,
  parseVeBvcMember,
  parseVeGleifEntity,
  parseVeSudeasegEntity,
  parseVeSunavalEntity,
} from '../../src/server/source-catalog/connectors/ve-sources/ve-sources-input';
import { VE_WEB_ENTITIES } from '../../src/server/source-catalog/connectors/ve-sources/ve-web-entities';
import { VE_PUBLIC_ENTITIES } from '../../src/server/source-catalog/connectors/ve-sources/ve-public-entities';
import { VE_FREE_DIRECTORY_MACRO_TABLES_APPROVED } from '../../src/server/prospect-batches/country-source-discovery/ve-free-directory-macro-table';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['registry', 'alias', 'directory', 'directory_web'] as const;
type Only = (typeof ONLY_VALUES)[number];

type Config = { dir: string; apply: boolean; only: Only | null; year: number; webMap: string | null };

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
  return { dir, apply, only: only as Only | null, year, webMap: value('web-map') };
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

const notNull = <T>(value: T | null): value is T => value !== null;

async function upsertAll(client: SupabaseClient, rows: readonly VeSnapshotRow[]): Promise<number> {
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

function printDirectorySummary(rows: readonly VeSnapshotRow[]): void {
  const byMacro = new Map<string, { total: number; withDomain: number; withRif: number; byKind: Record<string, number> }>();
  for (const row of rows) {
    const macro = String(row.raw_data['macro_industry_key']);
    const stat = byMacro.get(macro) ?? { total: 0, withDomain: 0, withRif: 0, byKind: {} };
    stat.total++;
    if (row.raw_data['website_domain']) stat.withDomain++;
    if (row.normalized_tax_id) stat.withRif++;
    const kind = String(row.raw_data['directory_kind']);
    stat.byKind[kind] = (stat.byKind[kind] ?? 0) + 1;
    byMacro.set(macro, stat);
  }
  for (const [macro, stat] of [...byMacro].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${macro}: ${stat.total} (con RIF ${stat.withRif}, con web ${stat.withDomain}) ${JSON.stringify(stat.byKind)}`);
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`VE SOURCES ETL — ${config.apply ? `APPLY (${config.only})` : 'DRY-RUN (no escribe)'}`);

  const bvcIssuers = readJsonl(join(config.dir, 've_bvc_issuers.jsonl')).map(parseVeBvcIssuer).filter(notNull);
  const bvcMembers = readJsonl(join(config.dir, 've_bvc_members.jsonl')).map(parseVeBvcMember).filter(notNull);
  const sudeaseg = readJsonl(join(config.dir, 've_sudeaseg.jsonl')).map(parseVeSudeasegEntity).filter(notNull);
  const sunaval = readJsonl(join(config.dir, 've_sunaval.jsonl')).map(parseVeSunavalEntity).filter(notNull);
  const gleif = readJsonl(join(config.dir, 've_gleif.jsonl')).map(parseVeGleifEntity).filter(notNull);
  const listings = veWebListings({ webEntities: VE_WEB_ENTITIES, publicEntities: VE_PUBLIC_ENTITIES });
  console.log(
    `  Leídos (con RIF válido): ${bvcIssuers.length} emisoras, ${bvcMembers.length} casas de bolsa, ${sudeaseg.length} SUDEASEG, ${sunaval.length} SUNAVAL, ${gleif.length} GLEIF; webs comprobadas ${listings.length} (${listings.filter((l) => l.rif !== null).length} con RIF en la portada)`,
  );

  const entries = mergeVenezuelaRifSources({ bvcIssuers, bvcMembers, sudeaseg, sunaval, gleif, listings });
  const params = { sourceYear: config.year, importedAt: new Date().toISOString() };

  // 1-2. Registro de RIF y alias (nunca el nombre propio de otro RIF).
  const { registryRows: allRegistry, aliasRows: allAlias } = buildVeRegistryAndAliasRows(entries, params);
  const registryRows = allRegistry.filter((row) => row.record_identity_key !== null);
  const aliasRows = allAlias.filter((row) => row.record_identity_key !== null);
  registryRows.sort((a, b) => a.normalized_tax_id!.localeCompare(b.normalized_tax_id!));
  const cores = countBy(registryRows, (row) => row.normalized_legal_name);
  const unique = registryRows.filter((row) => cores[row.normalized_legal_name] === 1).length;
  console.log(
    `  ${VE_RIF_REGISTRY_SOURCE_KEY}: ${registryRows.length} RIF (${unique} con nombre único) — ${JSON.stringify(countBy(registryRows, (row) => (row.raw_data['origins'] as string[]).join('+')))}`,
  );
  console.log(`  ${VE_RIF_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length}`);

  // 3. Capa gratuita.
  const webByRif = new Map(
    (config.webMap ? readJsonl(config.webMap) : []).map(parseVeCompanyWebLine).filter(notNull).map((line) => [line.rif, line.web] as const),
  );
  if (config.webMap) console.log(`  Webs por nombre comprobadas (--web-map): ${webByRif.size}`);
  const { taxRows, webRows, excluded } = buildVeFreeDirectoryRows({ entries, registryRows, aliasRows, listings, webByRif, ...params });
  taxRows.sort((a, b) => b.priority_score - a.priority_score || a.normalized_tax_id!.localeCompare(b.normalized_tax_id!));
  webRows.sort((a, b) => b.priority_score - a.priority_score || String(a.record_identity_key).localeCompare(String(b.record_identity_key)));
  console.log(`  ${VE_FREE_DIRECTORY_SOURCE_KEY}: ${taxRows.length} · ${VE_FREE_DIRECTORY_WEB_SOURCE_KEY}: ${webRows.length}`);
  console.log(`  Fuera de la capa gratuita: ${JSON.stringify(excluded)}`);
  printDirectorySummary([...taxRows, ...webRows]);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=… (con autorización) para persistir.');
    return;
  }
  if ((config.only === 'directory' || config.only === 'directory_web') && !VE_FREE_DIRECTORY_MACRO_TABLES_APPROVED) {
    throw new Error('macro_tables_not_approved: la dueña aún no aprobó las tablas de industria de Venezuela');
  }

  const [sourceKey, rows] =
    config.only === 'registry'
      ? [VE_RIF_REGISTRY_SOURCE_KEY, registryRows]
      : config.only === 'alias'
        ? [VE_RIF_NAME_ALIAS_SOURCE_KEY, aliasRows]
        : config.only === 'directory'
          ? [VE_FREE_DIRECTORY_SOURCE_KEY, taxRows]
          : [VE_FREE_DIRECTORY_WEB_SOURCE_KEY, webRows.filter((row) => row.record_identity_key !== null)];
  assertLargeImportAllowed({ sourceKey, countryCode: 'VE', estimatedRows: rows.length, isDryRun: false });

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
