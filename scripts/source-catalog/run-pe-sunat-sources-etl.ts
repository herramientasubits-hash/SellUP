/**
 * PE SUNAT — ETL de las fuentes de Perú (SOURCES-PE-CLOSE-1)
 *
 * Cruza tres archivos públicos y arma tres fuentes de `source_company_snapshots`:
 *
 *   registry   `pe_sunat_registry` (RECARGA, misma identidad por RUC): la misma
 *              fila de siempre (núcleo del nombre SIN cambios) + tipo de
 *              contribuyente, clase CIIU Rev. 4 y trabajadores del Padrón RUC
 *              abierto, para el filtro de tamaño. ~867 k filas.
 *   alias      `pe_sunat_name_alias` (NUEVA): claves de nombre extra para el RUC
 *              por nombre (alias tras « - », entidades públicas sin «de/del»,
 *              nombres del listado de entidades contratantes del OECE).
 *   directory  `pe_sunat_directory` (NUEVA): la capa gratuita por industria,
 *              sociedades y entidades activas y habidas de 200+ trabajadores con
 *              actividad clasificada. ~3,3 k filas.
 *
 * Archivos (descargar a mano; el portal de datos abiertos bloquea las descargas
 * por terminal, se bajan con el navegador):
 *   --padron=<txt>       padron_reducido_ruc.txt (https://www2.sunat.gob.pe/padron_reducido_ruc.zip)
 *   --open-padron=<csv>  PadronRUC_AAAAMM.csv (datosabiertos.gob.pe, Padrón RUC SUNAT)
 *   --oece=<csv>         entidades_contratantes.csv (conosce.osce.gob.pe, «|», UTF-8 o Latin-1)
 *   --only=registry,alias,directory   (por defecto, las tres)
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-pe-sunat-sources-etl.ts --padron=… --open-padron=… --oece=…
 *
 * Escritura REAL sólo con autorización explícita de la dueña PARA ESA CARGA:
 *   --apply --only=<una fuente>. Más de 25 k filas ⇒ además
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y SELLUP_CONFIRMED_SOURCE_KEY=<source_key>.
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` exige `--only` con UNA fuente.
 *   - `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No toca accounts, prospect_candidates ni otras fuentes. No llama a SUNAT,
 *     Migo ni proveedores: sólo lee archivos locales.
 *   - Reanudable: `--offset=<n>` salta las n primeras filas ya escritas.
 *   - Reversible: las fuentes nuevas se borran por `source_key`; la recarga del
 *     registro sólo AÑADE campos a `raw_data` (el nombre comparable no cambia).
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import {
  isPeSunatOpenPadronHeader,
  parsePeSunatOpenPadronRow,
  PE_SUNAT_OPEN_PADRON_HEADER,
  type PeSunatOpenPadronRecord,
} from '../../src/server/source-catalog/connectors/sunat-peru/pe-sunat-open-padron';
import {
  buildPeSunatRegistryRow,
  PE_SUNAT_REGISTRY_SOURCE_KEY,
  type PeSunatRegistryRow,
} from '../../src/server/source-catalog/connectors/sunat-peru/pe-sunat-registry-row';
import {
  dropAliasKeysOwnedByOthers,
  peruOwnNameKeys,
  peruPublicEntityNameKeys,
  peruRegistryAliasKeys,
} from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import {
  buildPeSunatDirectoryRow,
  buildPeSunatNameAliasRows,
  PE_SUNAT_DIRECTORY_SOURCE_KEY,
  PE_SUNAT_NAME_ALIAS_SOURCE_KEY,
  type PeSunatDirectoryRow,
  type PeSunatNameAliasRow,
} from '../../src/server/source-catalog/connectors/sunat-peru/pe-sunat-source-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const TARGETS = ['registry', 'alias', 'directory'] as const;
type Target = (typeof TARGETS)[number];

type Config = {
  padron: string;
  openPadron: string;
  oece: string | null;
  only: Target[];
  apply: boolean;
  year: number;
  offset: number;
};

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const padron = value('padron');
  const openPadron = value('open-padron');
  if (!padron || !openPadron) throw new Error('config_invalid: faltan --padron=<txt> y --open-padron=<csv>');
  const onlyRaw = value('only');
  const only = (onlyRaw ? onlyRaw.split(',').map((t) => t.trim()) : [...TARGETS]) as Target[];
  if (only.some((t) => !TARGETS.includes(t))) throw new Error(`config_invalid: --only admite ${TARGETS.join(', ')}`);
  const apply = argv.includes('--apply');
  if (apply && only.length !== 1) throw new Error('config_invalid: --apply exige --only con UNA fuente');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(year) || !Number.isInteger(offset) || offset < 0) {
    throw new Error('config_invalid: --year y --offset deben ser enteros (offset ≥ 0)');
  }
  return { padron, openPadron, oece: value('oece'), only, apply, year, offset };
}

async function readOpenPadron(path: string): Promise<Map<string, PeSunatOpenPadronRecord>> {
  const byRuc = new Map<string, PeSunatOpenPadronRecord>();
  let headerChecked = false;
  for await (const record of readCsvFile(path)) {
    if (!headerChecked) {
      headerChecked = true;
      if (!isPeSunatOpenPadronHeader(Object.keys(record))) {
        throw new Error('open_padron_header_unexpected: el archivo no tiene las columnas del Padrón RUC abierto');
      }
    }
    const parsed = parsePeSunatOpenPadronRow(PE_SUNAT_OPEN_PADRON_HEADER.map((name) => record[name] ?? ''));
    if (parsed !== null && !byRuc.has(parsed.ruc)) byRuc.set(parsed.ruc, parsed);
  }
  return byRuc;
}

/** Entidades contratantes activas del OECE: RUC → nombre. */
function readOeceEntities(path: string): Map<string, string> {
  const raw = readFileSync(path);
  const textUtf8 = raw.toString('utf8');
  const text = textUtf8.includes('�') ? raw.toString('latin1') : textUtf8;
  const entities = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|');
    if (cells.length < 8 || cells[0] === 'RUC') continue;
    const ruc = cells[0].trim();
    if (!/^20\d{9}$/.test(ruc) || cells[7].trim() !== 'Activo') continue;
    if (!entities.has(ruc)) entities.set(ruc, cells[1].trim());
  }
  return entities;
}

async function upsertAll(
  sourceKey: string,
  rows: readonly (PeSunatRegistryRow | PeSunatNameAliasRow | PeSunatDirectoryRow)[],
  offset: number,
): Promise<void> {
  assertLargeImportAllowed({ sourceKey, countryCode: 'PE', estimatedRows: rows.length, isDryRun: false });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  let upserted = 0;
  for (let i = offset; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
    if ((i / UPSERT_CHUNK) % 50 === 0) console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  console.log(`  ${sourceKey}: rowsUpserted = ${upserted}`);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`PE SUNAT SOURCES ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'} — ${config.only.join(', ')}`);
  const importedAt = new Date().toISOString();

  const open = await readOpenPadron(config.openPadron);
  const withWorkers = [...open.values()].filter((r) => r.workers !== null).length;
  const withCode = [...open.values()].filter((r) => r.ciiu4Code !== null).length;
  console.log(`  Padrón abierto: ${open.size} sociedades activas y habidas · ${withWorkers} con trabajadores · ${withCode} con clase CIIU`);

  const registry = new Map<string, PeSunatRegistryRow>();
  const lines = createInterface({ input: createReadStream(config.padron, { encoding: 'latin1' }), crlfDelay: Infinity });
  for await (const line of lines) {
    const ruc = line.slice(0, 11);
    const row = buildPeSunatRegistryRow(line, { sourceYear: config.year, importedAt }, open.get(ruc) ?? null);
    if (row !== null && row.record_identity_key !== null && !registry.has(row.normalized_tax_id)) {
      registry.set(row.normalized_tax_id, row);
    }
  }
  const registryRows = [...registry.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const registryWithWorkers = registryRows.filter((r) => typeof r.raw_data['workers'] === 'number').length;
  console.log(`  pe_sunat_registry: ${registryRows.length} filas · ${registryWithWorkers} con trabajadores`);

  const aliasRows: PeSunatNameAliasRow[] = [];
  const aliasSeen = new Set<string>();
  const pushAliases = (rows: PeSunatNameAliasRow[]): void => {
    for (const row of rows) {
      const k = `${row.normalized_tax_id}:${row.normalized_legal_name}`;
      if (aliasSeen.has(k)) continue;
      aliasSeen.add(k);
      aliasRows.push(row);
    }
  };
  // Un alias nunca usa el nombre PROPIO de otra sociedad (SOURCES-PE-ALIAS-OWNERSHIP-1).
  const owners = new Map<string, Set<string>>();
  for (const row of registryRows) {
    for (const key of peruOwnNameKeys(row.normalized_legal_name)) {
      owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.normalized_tax_id));
    }
  }
  let droppedOwned = 0;
  const ownedFilter = (keys: string[], ruc: string): string[] => {
    const kept = dropAliasKeysOwnedByOthers(keys, ruc, owners);
    droppedOwned += keys.length - kept.length;
    return kept;
  };
  for (const row of registryRows) {
    const info = open.get(row.normalized_tax_id) ?? null;
    const keys = ownedFilter(
      peruRegistryAliasKeys(row.legal_name, { taxpayerType: info?.taxpayerType ?? null, workers: info?.workers ?? null }),
      row.normalized_tax_id,
    );
    pushAliases(buildPeSunatNameAliasRows({ ruc: row.normalized_tax_id, legalName: row.legal_name, keys, origin: 'sunat_legal_name', open: info, sourceYear: config.year, importedAt }));
  }
  let oeceMatched = 0;
  if (config.oece) {
    const entities = readOeceEntities(config.oece);
    for (const [ruc, name] of entities) {
      const main = registry.get(ruc);
      if (!main) continue; // sólo entidades activas y habidas del padrón
      oeceMatched++;
      const keys = ownedFilter(peruPublicEntityNameKeys(name).filter((k) => k !== main.normalized_legal_name), ruc);
      pushAliases(buildPeSunatNameAliasRows({ ruc, legalName: main.legal_name, keys, origin: 'oece_entity', open: open.get(ruc) ?? null, sourceYear: config.year, importedAt }));
    }
    console.log(`  OECE: ${entities.size} entidades activas · ${oeceMatched} en el padrón`);
  }
  console.log(`  pe_sunat_name_alias: ${aliasRows.length} filas (${new Set(aliasRows.map((r) => r.normalized_tax_id)).size} RUC) · ${droppedOwned} claves descartadas por ser el nombre propio de otra sociedad`);

  const directoryRows: PeSunatDirectoryRow[] = [];
  for (const info of open.values()) {
    const main = registry.get(info.ruc);
    if (!main) continue;
    const row = buildPeSunatDirectoryRow({ open: info, legalName: main.legal_name, importedAt });
    if (row !== null) directoryRows.push(row);
  }
  directoryRows.sort((a, b) => b.priority_score - a.priority_score || a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const byMacro = new Map<string, number>();
  for (const row of directoryRows) {
    const macro = String(row.raw_data['macro_industry_key']);
    byMacro.set(macro, (byMacro.get(macro) ?? 0) + 1);
  }
  console.log(`  pe_sunat_directory: ${directoryRows.length} filas`);
  for (const [macro, n] of [...byMacro.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${macro}: ${n}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply --only=<fuente> (con autorización) para persistir.');
    return;
  }
  const target = config.only[0];
  if (target === 'registry') await upsertAll(PE_SUNAT_REGISTRY_SOURCE_KEY, registryRows, config.offset);
  if (target === 'alias') await upsertAll(PE_SUNAT_NAME_ALIAS_SOURCE_KEY, aliasRows, config.offset);
  if (target === 'directory') await upsertAll(PE_SUNAT_DIRECTORY_SOURCE_KEY, directoryRows, config.offset);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
