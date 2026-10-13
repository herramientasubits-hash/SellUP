/**
 * UY — ETL de las fuentes de Uruguay (SOURCES-UY-CLOSE-1)
 *
 * Carga en `source_company_snapshots`, una fuente cada vez (`--only=`):
 *   - registry  → `uy_rupe_registry`   organizaciones vigentes del RUPE (≈30.500; > 25 k:
 *                 SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true + SELLUP_CONFIRMED_SOURCE_KEY=uy_rupe_registry).
 *                 Con `--prune-stale` borra las filas viejas que la carga nueva ya no trae.
 *   - alias     → `uy_rupe_name_alias` siglas, partes y siglas oficiales de los entes.
 *   - directory → `uy_arce_directory`  capa gratuita de empresas (ARCE 2022-2025). Se niega
 *                 mientras la dueña no apruebe la tabla (`UY_ARCE_MACRO_TABLE_APPROVED`).
 *   - public    → `uy_public_entities` entidades de la UAIP + intendencias (Gobierno).
 *
 * Entradas (archivos públicos, ya descargados; el ETL no llama a ningún servicio):
 *   --rupe=<rupe-AAAA.csv>              RUPE mensual de ARCE (catalogodatos.gub.uy).
 *   --suppliers=<suppliers.jsonl>       salida de `extract-uy-ocds-suppliers.py`.
 *   --catalog=<dir con CLASE.sql>       catálogo SICE (imp_catalogo.tgz), rubro en palabras.
 *   --referentes=<referentes.csv>       referentes de transparencia de la UAIP.
 *   --web-map=<webs.jsonl>              salida de `discover-uy-company-webs.mts`.
 *   --dei=<empresasdei.csv>             Directorio de Empresas Industriales del MIEM (web/correo).
 *   --msp=<estructura_basica_atuservicio.csv>  prestadores de salud del MSP (web).
 *   --onsc=<evolucin-de-vnculos-con-el-estado-.csv>  funcionarios por inciso (ONSC):
 *                                       tamaño oficial de las entidades públicas.
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   node --import tsx scripts/source-catalog/run-uy-sources-etl.ts --rupe=… --suppliers=… …
 * Escritura REAL (sólo con autorización explícita de la dueña, una carga cada vez):
 *   … --apply --confirm --only=registry|alias|directory|public [--prune-stale]
 *
 * Guardrails: dry-run por defecto; `--apply` exige `--confirm` y `--only=`; escribe SÓLO
 * el source_key de esa carga; `assertLargeImportAllowed` antes de escribir; nunca guarda
 * personas físicas, domicilios ni los datos personales de los referentes de la UAIP.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import {
  parseUyArceSupplierLine,
  UY_ARCE_DIRECTORY_SOURCE_KEY,
  type UyArceDirectoryWeb,
} from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-arce-directory-row';
import {
  buildUyArceDirectory,
  buildUyPublicEntityRows,
  buildUyRegistry,
} from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-sources-build';
import {
  parseUyOnscHeadcount,
  parseUyTransparencyReferent,
  UY_PUBLIC_ENTITIES_SOURCE_KEY,
} from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-public-entities';
import {
  UY_RUPE_NAME_ALIAS_SOURCE_KEY,
  UY_RUPE_REGISTRY_SOURCE_KEY,
} from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-rupe-registry-row';
import { uruguayNameCore } from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-name-keys';
import {
  uruguayCompanyEmailDomain,
  uruguayDeclaredWebsiteDomain,
} from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-domain';
import { UY_ARCE_MACRO_TABLE_APPROVED } from '../../src/server/prospect-batches/country-source-discovery/uy-arce-macro-table';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const ONLY_VALUES = ['registry', 'alias', 'directory', 'public'] as const;
type Only = (typeof ONLY_VALUES)[number];

const SOURCE_KEY_BY_ONLY: Readonly<Record<Only, string>> = {
  registry: UY_RUPE_REGISTRY_SOURCE_KEY,
  alias: UY_RUPE_NAME_ALIAS_SOURCE_KEY,
  directory: UY_ARCE_DIRECTORY_SOURCE_KEY,
  public: UY_PUBLIC_ENTITIES_SOURCE_KEY,
};

type Config = {
  rupe: string;
  suppliers: string | null;
  catalog: string | null;
  referentes: string | null;
  webMap: string | null;
  dei: string | null;
  msp: string | null;
  onsc: string | null;
  year: number;
  apply: boolean;
  only: Only | null;
  pruneStale: boolean;
};

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const rupe = value('rupe');
  if (!rupe) throw new Error('config_invalid: falta --rupe=<CSV del RUPE>');
  const only = value('only');
  if (only !== null && !(ONLY_VALUES as readonly string[]).includes(only)) {
    throw new Error(`config_invalid: --only debe ser ${ONLY_VALUES.join(' | ')}`);
  }
  const apply = argv.includes('--apply');
  if (apply && (only === null || !argv.includes('--confirm'))) {
    throw new Error('config_invalid: --apply exige --only= (una carga cada vez) y --confirm (autorización de la dueña)');
  }
  const pruneStale = argv.includes('--prune-stale');
  if (pruneStale && !apply) throw new Error('config_invalid: --prune-stale sólo vale con --apply');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser entero');
  return {
    rupe,
    suppliers: value('suppliers'),
    catalog: value('catalog'),
    referentes: value('referentes'),
    webMap: value('web-map'),
    dei: value('dei'),
    msp: value('msp'),
    onsc: value('onsc'),
    year,
    apply,
    only: only as Only | null,
    pruneStale,
  };
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

async function readCsv(path: string, delimiter: string): Promise<Record<string, string>[]> {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  const records: Record<string, string>[] = [];
  for await (const record of readCsvFile(path, { delimiter })) records.push(record);
  return records;
}

/** Rubro en palabras de cada clase «f-s-k» del catálogo SICE (CLASE.sql, latin-1). */
function readClassLabels(dir: string | null): Record<string, string> {
  if (dir === null) return {};
  const labels: Record<string, string> = {};
  const text = readFileSync(join(dir, 'CLASE.sql'), 'latin1');
  for (const match of text.matchAll(/values \((\d+),(\d+),(\d+),'((?:[^']|'')*)'/g)) {
    const label = match[4].replace(/''/g, "'").trim();
    labels[`${match[1]}-${match[2]}-${match[3]}`] = label.charAt(0) + label.slice(1).toLowerCase();
  }
  return labels;
}

/**
 * RUT → web: la declarada al MIEM (o el dominio de su correo corporativo), luego la
 * comprobada por su nombre, luego la del MSP (prestadores de salud, por nombre).
 */
async function readWebs(config: Config, legalCoreByRut: ReadonlyMap<string, string>): Promise<Map<string, UyArceDirectoryWeb>> {
  const webs = new Map<string, UyArceDirectoryWeb>();
  if (config.dei !== null) {
    for (const record of await readCsv(config.dei, ',')) {
      const rut = (record['RUT'] ?? '').replace(/\D/g, '');
      const domain = uruguayDeclaredWebsiteDomain(record['Sitio web']) ?? uruguayCompanyEmailDomain(record['Email público']);
      if (/^\d{12}$/.test(rut) && domain !== null) webs.set(rut, { domain, origin: 'mie_industrial_directory' });
    }
  }
  if (config.webMap !== null) {
    for (const line of readJsonl(config.webMap) as Array<Record<string, unknown>>) {
      const rut = typeof line['rut'] === 'string' ? line['rut'] : '';
      const domain = typeof line['domain'] === 'string' ? line['domain'] : null;
      if (domain !== null && !webs.has(rut)) {
        webs.set(rut, { domain, origin: 'name_domain_verified', check: typeof line['check'] === 'string' ? line['check'] : null });
      }
    }
  }
  if (config.msp !== null) {
    const rutByCore = new Map<string, string>();
    for (const [rut, core] of legalCoreByRut) rutByCore.set(core, rut);
    for (const record of await readCsv(config.msp, ',')) {
      const domain = uruguayDeclaredWebsiteDomain(record['Web']);
      const rut = rutByCore.get(uruguayNameCore(record['Nombre completo'])) ?? rutByCore.get(uruguayNameCore(record['Nombre abreviado ']));
      if (domain !== null && rut !== undefined && !webs.has(rut)) webs.set(rut, { domain, origin: 'name_domain_verified', check: 'msp_declared' });
    }
  }
  return webs;
}

async function upsertAll(client: SupabaseClient, rows: readonly object[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
    if ((i / UPSERT_CHUNK) % 5 === 0) console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  return upserted;
}

/** Borra las filas de ESTA fuente (misma clave y año) que la carga nueva no trae. */
async function pruneStaleRows(
  client: SupabaseClient,
  sourceKey: string,
  rows: readonly { record_identity_key: string | null; source_year: number }[],
): Promise<number> {
  const keep = new Set(rows.map((row) => `${row.record_identity_key}|${row.source_year}`));
  const stale: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('id, record_identity_key, source_year')
      .eq('source_key', sourceKey)
      .eq('country_code', 'UY')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`prune_read_failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ id: string; record_identity_key: string; source_year: number }>) {
      if (!keep.has(`${row.record_identity_key}|${row.source_year}`)) stale.push(row.id);
    }
    if (data.length < 1000) break;
  }
  for (let i = 0; i < stale.length; i += 500) {
    const { error } = await client
      .from('source_company_snapshots')
      .delete()
      .in('id', stale.slice(i, i + 500))
      .eq('source_key', sourceKey)
      .eq('country_code', 'UY');
    if (error) throw new Error(`prune_delete_failed_at_${i}: ${error.message}`);
  }
  return stale.length;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(
    `UY SOURCES ETL — ${config.apply ? `APPLY (${config.only}${config.pruneStale ? ' + prune-stale' : ''})` : 'DRY-RUN (no escribe)'}`,
  );
  const importedAt = new Date().toISOString();
  const params = { sourceYear: config.year, importedAt };

  const registry = buildUyRegistry(await readCsv(config.rupe, ';'), params);
  const states = new Map<string, number>();
  for (const row of registry.registryRows) {
    const state = String(row.raw_data['rupe_state']);
    states.set(state, (states.get(state) ?? 0) + 1);
  }
  console.log(`  RUPE: ${registry.registryRows.length} organizaciones (${JSON.stringify(Object.fromEntries(states))})`);
  console.log(`  Alias: ${registry.aliasRows.length}`);

  const rowsByOnly: Partial<Record<Only, readonly { record_identity_key: string | null; source_year: number }[]>> = {
    registry: registry.registryRows,
    alias: registry.aliasRows,
  };

  if (config.suppliers !== null) {
    const suppliers = readJsonl(config.suppliers).map(parseUyArceSupplierLine).filter((s) => s !== null);
    const legalCoreByRut = new Map(registry.registryRows.map((row) => [row.tax_id, row.normalized_legal_name] as const));
    const webs = await readWebs(config, legalCoreByRut);
    const { rows, excluded } = buildUyArceDirectory({
      suppliers,
      registry,
      classLabels: readClassLabels(config.catalog),
      webs,
      ...params,
    });
    const byMacro = new Map<string, { total: number; web: number }>();
    for (const row of rows) {
      const macro = String(row.raw_data['macro_industry_key']);
      const entry = byMacro.get(macro) ?? { total: 0, web: 0 };
      entry.total++;
      if (row.raw_data['website_domain']) entry.web++;
      byMacro.set(macro, entry);
    }
    console.log(`  Capa gratuita (${UY_ARCE_DIRECTORY_SOURCE_KEY}): ${rows.length} (con web ${rows.filter((r) => r.raw_data['website_domain']).length})`);
    for (const [macro, { total, web }] of [...byMacro.entries()].sort((a, b) => b[1].total - a[1].total)) {
      console.log(`    ${macro}: ${total} (web ${web})`);
    }
    console.log(`  Fuera: ${JSON.stringify(excluded)}`);
    rowsByOnly.directory = rows;
  }

  if (config.referentes !== null) {
    const referents = (await readCsv(config.referentes, ','))
      .map(parseUyTransparencyReferent)
      .filter((r) => r !== null);
    const onsc = config.onsc !== null ? parseUyOnscHeadcount(await readCsv(config.onsc, ',')) : undefined;
    const rows = buildUyPublicEntityRows({ referents, registry, onsc, ...params });
    console.log(
      `  Gobierno (${UY_PUBLIC_ENTITIES_SOURCE_KEY}): ${rows.length} (con web ${rows.filter((r) => r.raw_data['website_domain']).length}, con RUT ${rows.filter((r) => r.tax_id).length}, con funcionarios ONSC ${rows.filter((r) => r.raw_data['official_workers']).length})`,
    );
    rowsByOnly.public = rows;
  }

  if (!config.apply || config.only === null) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --confirm --only=… (con autorización) para persistir.');
    return;
  }

  const rows = rowsByOnly[config.only];
  if (rows === undefined) throw new Error(`config_invalid: faltan las entradas de --only=${config.only}`);
  if (config.only === 'directory' && !UY_ARCE_MACRO_TABLE_APPROVED) {
    throw new Error('blocked: la dueña aún no aprobó la tabla del catálogo SICE (UY_ARCE_MACRO_TABLE_APPROVED = false)');
  }
  const sourceKey = SOURCE_KEY_BY_ONLY[config.only];
  assertLargeImportAllowed({ sourceKey, countryCode: 'UY', estimatedRows: rows.length, isDryRun: false });

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
