/**
 * GT — ETL de las fuentes oficiales de Guatemala (SOURCES-GT-CLOSE-1)
 *
 * Junta por NIT Guatecompras (proveedores y entidades compradoras, datos abiertos
 * OCDS 2023-2026), el listado de agentes de retención del IVA de la SAT y el RGAE
 * ya cargado, y escribe en `source_company_snapshots`:
 *
 *   - gt_nit_registry            NIT por nombre dentro de la corrida (un NIT, una fila)
 *   - gt_nit_name_alias          otros nombres de cada NIT (siglas, nombre comercial…)
 *   - gt_guatecompras_directory  capa gratuita por industria (sociedades relevantes)
 *
 * Entradas (ficheros locales; el script no sale a la red):
 *   --ocds-dir=<carpeta>  con gt_suppliers.jsonl y gt_buyers.jsonl
 *                         (`extract-gt-guatecompras-parties.py`).
 *   --sat=<fichero>       gt_sat_iva_agents.jsonl (`extract-gt-sat-iva-agents.py`).
 *   --rgae=<fichero>      JSON con las filas del RGAE en Prod, exportadas con
 *                         select json_agg(json_build_array(normalized_tax_id, legal_name,
 *                           raw_data->'economic_capacity'->>'kind',
 *                           raw_data->'economic_capacity'->>'amount',
 *                           raw_data->>'resolution_date'))
 *                         from source_company_snapshots where source_key='gt_rgae_proveedores'
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-gt-sources-etl.ts --ocds-dir=… --sat=… --rgae=…
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
  buildGtGuatecomprasDirectoryRow,
  buildGtNitNameAliasRows,
  buildGtNitRegistryRow,
  gtEntryAliasKeys,
  gtGuatecomprasSupplierDomain,
  gtOwnNameKeys,
  GT_GUATECOMPRAS_DIRECTORY_SOURCE_KEY,
  GT_NIT_NAME_ALIAS_SOURCE_KEY,
  GT_NIT_REGISTRY_SOURCE_KEY,
  mergeGuatemalaNitSources,
  parseGtGuatecomprasBuyer,
  parseGtGuatecomprasSupplier,
  parseGtSatIvaAgent,
  type GtDirectoryExclusion,
  type GtRgaeSupplier,
  type GtSnapshotRow,
} from '../../src/server/source-catalog/connectors/gt-guatecompras/gt-sources-rows';
import { dropAliasKeysOwnedByOthers } from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['registry', 'alias', 'directory'] as const;
type Only = (typeof ONLY_VALUES)[number];

type Config = { ocdsDir: string; sat: string; rgae: string; apply: boolean; only: Only | null; year: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const ocdsDir = value('ocds-dir');
  const sat = value('sat');
  const rgae = value('rgae');
  if (!ocdsDir || !sat || !rgae) throw new Error('config_invalid: faltan --ocds-dir, --sat y --rgae');
  const only = value('only');
  if (only !== null && !(ONLY_VALUES as readonly string[]).includes(only)) {
    throw new Error(`config_invalid: --only debe ser ${ONLY_VALUES.join(' | ')}`);
  }
  const apply = argv.includes('--apply');
  if (apply && only === null) throw new Error('config_invalid: --apply exige --only= (una carga cada vez)');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser entero');
  return { ocdsDir, sat, rgae, apply, only: only as Only | null, year };
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

function readRgae(path: string): GtRgaeSupplier[] {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('config_invalid: --rgae debe ser un arreglo JSON');
  return raw.flatMap((item): GtRgaeSupplier[] => {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string') return [];
    const amount = item[3] === null || item[3] === undefined ? null : Number(item[3]);
    return [{
      nit: item[0],
      name: item[1],
      economicCapacityKind: typeof item[2] === 'string' ? item[2] : null,
      economicCapacityGtq: amount !== null && Number.isFinite(amount) ? amount : null,
      resolutionDate: typeof item[4] === 'string' ? item[4] : null,
    }];
  });
}

async function upsertAll(client: SupabaseClient, rows: readonly GtSnapshotRow[]): Promise<number> {
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
  console.log(`GT SOURCES ETL — ${config.apply ? `APPLY (${config.only})` : 'DRY-RUN (no escribe)'}`);

  const suppliers = readJsonl(join(config.ocdsDir, 'gt_suppliers.jsonl'))
    .map(parseGtGuatecomprasSupplier)
    .filter((row) => row !== null);
  const buyers = readJsonl(join(config.ocdsDir, 'gt_buyers.jsonl'))
    .map(parseGtGuatecomprasBuyer)
    .filter((row) => row !== null);
  const satAgents = readJsonl(config.sat).map(parseGtSatIvaAgent).filter((row) => row !== null);
  const rgae = readRgae(config.rgae);
  console.log(`  Leídos: ${suppliers.length} proveedores, ${buyers.length} compradores, ${satAgents.length} SAT, ${rgae.length} RGAE`);

  const { entries, excluded } = mergeGuatemalaNitSources({ suppliers, buyers, satAgents, rgae });
  console.log(`  Excluidos por fuente: ${JSON.stringify(excluded)}`);

  const importedAt = new Date().toISOString();
  const params = { sourceYear: config.year, importedAt };

  // 1. Registro de NIT.
  const registryRows: GtSnapshotRow[] = [];
  for (const entry of entries.values()) {
    const row = buildGtNitRegistryRow(entry, params);
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
  console.log(`  ${GT_NIT_REGISTRY_SOURCE_KEY}: ${registryRows.length} NIT (${unique} con nombre único) — ${JSON.stringify(Object.fromEntries(byOrigin))}`);

  // 2. Alias: nunca el nombre propio de otro NIT.
  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of gtOwnNameKeys(row)) owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id));
  }
  const aliasRows = registryRows.flatMap((row) =>
    buildGtNitNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(gtEntryAliasKeys(entries.get(row.tax_id)!, row.normalized_legal_name), row.tax_id, owners),
    }),
  );
  console.log(`  ${GT_NIT_NAME_ALIAS_SOURCE_KEY}: ${aliasRows.length}`);

  // 3. Capa gratuita. Un dominio de correo compartido por dos o más NIT no se usa.
  const domainOwners = new Map<string, number>();
  for (const entry of entries.values()) {
    const domain = entry.supplier ? gtGuatecomprasSupplierDomain(entry.supplier) : null;
    if (domain !== null) domainOwners.set(domain, (domainOwners.get(domain) ?? 0) + 1);
  }
  const sharedDomains = new Set([...domainOwners].filter(([, n]) => n > 1).map(([domain]) => domain));
  const directoryRows: GtSnapshotRow[] = [];
  const directoryExcluded = new Map<GtDirectoryExclusion, number>();
  for (const entry of entries.values()) {
    const result = buildGtGuatecomprasDirectoryRow(entry, { ...params, sharedDomains });
    if ('excluded' in result) directoryExcluded.set(result.excluded, (directoryExcluded.get(result.excluded) ?? 0) + 1);
    else if (result.row.record_identity_key !== null) directoryRows.push(result.row);
  }
  directoryRows.sort((a, b) => b.priority_score - a.priority_score || a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  console.log(`  ${GT_GUATECOMPRAS_DIRECTORY_SOURCE_KEY}: ${directoryRows.length} (dominios compartidos descartados: ${sharedDomains.size})`);
  console.log(`  Fuera de la capa gratuita: ${JSON.stringify(Object.fromEntries(directoryExcluded))}`);
  const byMacro = new Map<string, { total: number; sat: number; withDomain: number }>();
  for (const row of directoryRows) {
    const macro = String(row.raw_data['macro_industry_key']);
    const stat = byMacro.get(macro) ?? { total: 0, sat: 0, withDomain: 0 };
    stat.total++;
    if (row.raw_data['sat_iva_agent'] === true) stat.sat++;
    if (row.raw_data['website_domain']) stat.withDomain++;
    byMacro.set(macro, stat);
  }
  for (const [macro, stat] of [...byMacro].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${macro}: ${stat.total} (agentes IVA ${stat.sat}, con web ${stat.withDomain})`);
  }

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=… (con autorización) para persistir.');
    return;
  }

  const [sourceKey, rows] =
    config.only === 'registry'
      ? [GT_NIT_REGISTRY_SOURCE_KEY, registryRows]
      : config.only === 'alias'
        ? [GT_NIT_NAME_ALIAS_SOURCE_KEY, aliasRows]
        : [GT_GUATECOMPRAS_DIRECTORY_SOURCE_KEY, directoryRows];
  assertLargeImportAllowed({ sourceKey, countryCode: 'GT', estimatedRows: rows.length, isDryRun: false });

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
