/**
 * Receita CNPJ — ETL del subconjunto LIVIANO de Brasil (SOURCES-BR-LIGHT-1)
 *
 * Carga en `source_company_snapshots` las cuatro claves de Brasil
 * (`br-receita-rows.ts`): br_receita_registry, br_receita_name_alias,
 * br_receita_domain_key y br_receita_directory.
 *
 *   --subset=<tsv>   salida de scripts/source-catalog/extract-br-receita-light.py
 *   --cvm=<csv>      cad_cia_aberta.csv de la CVM (latin-1), para alias y desempate
 *   --period=AAAA-MM periodo de la Receita (por ejemplo 2026-09)
 *   --only=registry,alias,domain,directory   claves a escribir (por defecto, todas)
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-br-receita-light-etl.ts --subset=… --cvm=… --period=2026-09
 *
 * Escritura REAL (sólo con autorización explícita de la dueña, UNA clave a la vez):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true SELLUP_CONFIRMED_SOURCE_KEY=br_receita_registry \
 *     npx tsx scripts/source-catalog/run-br-receita-light-etl.ts … --only=registry --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO las claves de `--only`.
 *   - `assertLargeImportAllowed` por cada clave antes de escribir nada.
 *   - No toca br_receita_snapshots, br_receita_cnpj_dados_abertos, accounts ni
 *     prospect_candidates. No sale a la red: sólo lee ficheros locales.
 *   - Dos pasadas por el TSV: la primera cuenta y arma los nombres propios (un
 *     alias nunca es el nombre propio de otra empresa); la segunda escribe.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  BR_RECEITA_DIRECTORY_SOURCE_KEY,
  BR_RECEITA_DOMAIN_KEY_SOURCE_KEY,
  BR_RECEITA_NAME_ALIAS_SOURCE_KEY,
  BR_RECEITA_REGISTRY_SOURCE_KEY,
  brReceitaDirectoryExclusion,
  buildBrReceitaDirectoryRow,
  buildBrReceitaDomainKeyRow,
  buildBrReceitaNameAliasRows,
  buildBrReceitaRegistryRow,
  type BrCvmListing,
  type BrReceitaCompanyRecord,
  type BrReceitaSnapshotRow,
} from '../../src/server/source-catalog/connectors/receita-brasil/br-receita-rows';
import { parseBrReceitaLightLine, parseCvmCadastro } from '../../src/server/source-catalog/connectors/receita-brasil/br-receita-input';
import { brazilRegistryAliasKeys } from '../../src/server/source-catalog/connectors/receita-brasil/br-name-keys';
import { dropAliasKeysOwnedByOthers } from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const TARGETS = {
  registry: BR_RECEITA_REGISTRY_SOURCE_KEY,
  alias: BR_RECEITA_NAME_ALIAS_SOURCE_KEY,
  domain: BR_RECEITA_DOMAIN_KEY_SOURCE_KEY,
  directory: BR_RECEITA_DIRECTORY_SOURCE_KEY,
} as const;
type Target = keyof typeof TARGETS;

type Config = { subset: string; cvm: string | null; period: string; only: Target[]; apply: boolean };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const subset = value('subset');
  const period = value('period');
  if (!subset || !period || !/^\d{4}-\d{2}$/.test(period)) {
    throw new Error('config_invalid: faltan --subset=<tsv> o --period=AAAA-MM');
  }
  const only = (value('only') ?? 'registry,alias,domain,directory').split(',').map((s) => s.trim());
  for (const target of only) {
    if (!(target in TARGETS)) throw new Error(`config_invalid: --only desconocido «${target}»`);
  }
  return { subset, cvm: value('cvm'), period, only: only as Target[], apply: argv.includes('--apply') };
}

async function* records(path: string): AsyncGenerator<BrReceitaCompanyRecord> {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    const record = parseBrReceitaLightLine(line);
    if (record !== null) yield record;
  }
}

/** Todas las filas de una matriz (registro, alias, dominio, directorio). */
function rowsFor(
  record: BrReceitaCompanyRecord,
  params: { sourceYear: number; sourcePeriod: string; importedAt: string },
  cvm: Map<string, BrCvmListing>,
  owners: ReadonlyMap<string, ReadonlySet<string>> | null,
): { registry: BrReceitaSnapshotRow; alias: BrReceitaSnapshotRow[]; domain: BrReceitaSnapshotRow | null; directory: BrReceitaSnapshotRow | null } | null {
  const listing = cvm.get(record.cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase()) ?? null;
  const registry = buildBrReceitaRegistryRow(record, params, listing);
  if (registry === null) return null;
  const keys = brazilRegistryAliasKeys({ legalName: record.legalName, tradeName: record.tradeName, cvmTradeName: listing?.tradeName ?? null });
  const ownedKeys = owners === null ? keys : dropAliasKeysOwnedByOthers(keys, registry.normalized_tax_id, owners);
  return {
    registry,
    alias: buildBrReceitaNameAliasRows(registry, ownedKeys),
    domain: buildBrReceitaDomainKeyRow(registry),
    directory: buildBrReceitaDirectoryRow(record, registry),
  };
}

async function upsertAll(client: SupabaseClient, rows: BrReceitaSnapshotRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`BR RECEITA LIGHT ETL — ${config.apply ? `APPLY (${config.only.join(', ')})` : 'DRY-RUN (no escribe)'}`);
  const cvm = config.cvm ? parseCvmCadastro(new TextDecoder('latin1').decode(readFileSync(config.cvm))) : new Map();
  const params = { sourceYear: Number(config.period.slice(0, 4)), sourcePeriod: config.period, importedAt: new Date().toISOString() };

  // Pasada 1: nombres propios (núcleo → CNPJ) y conteos.
  const owners = new Map<string, Set<string>>();
  let read = 0;
  let rejected = 0;
  for await (const record of records(config.subset)) {
    read++;
    const built = rowsFor(record, params, cvm, null);
    if (built === null) {
      rejected++;
      continue;
    }
    const core = built.registry.normalized_legal_name;
    owners.set(core, (owners.get(core) ?? new Set()).add(built.registry.normalized_tax_id));
  }

  const counts: Record<Target, number> = { registry: 0, alias: 0, domain: 0, directory: 0 };
  const exclusions = new Map<string, number>();
  const byMacro = new Map<string, { total: number; withDomain: number }>();
  let cvmMatched = 0;
  for await (const record of records(config.subset)) {
    const built = rowsFor(record, params, cvm, owners);
    if (built === null) continue;
    counts.registry++;
    counts.alias += built.alias.length;
    if (built.domain) counts.domain++;
    if (built.registry.raw_data['cvm_listed'] === true) cvmMatched++;
    if (built.directory) {
      counts.directory++;
      const macro = String(built.directory.raw_data['macro_industry_key']);
      const entry = byMacro.get(macro) ?? { total: 0, withDomain: 0 };
      entry.total++;
      if (built.directory.raw_data['website_domain']) entry.withDomain++;
      byMacro.set(macro, entry);
    } else {
      const reason = brReceitaDirectoryExclusion(record, built.registry) ?? 'unknown';
      exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1);
    }
  }

  console.log(`  Matrices leídas: ${read} (rechazadas por forma, CNPJ o elegibilidad: ${rejected})`);
  console.log(`  Cotizadas de la CVM cruzadas: ${cvmMatched} de ${cvm.size}`);
  for (const target of Object.keys(TARGETS) as Target[]) console.log(`  Filas ${TARGETS[target]}: ${counts[target]}`);
  for (const [reason, count] of [...exclusions.entries()].sort()) console.log(`  Fuera del buscador — ${reason}: ${count}`);
  for (const [macro, entry] of [...byMacro.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`    ${macro}: ${entry.total} (con web ${entry.withDomain})`);
  }

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  for (const target of config.only) {
    assertLargeImportAllowed({ sourceKey: TARGETS[target], countryCode: 'BR', estimatedRows: counts[target], isDryRun: false });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const written: Record<Target, number> = { registry: 0, alias: 0, domain: 0, directory: 0 };
  let buffer: BrReceitaSnapshotRow[] = [];
  const flush = async (): Promise<void> => {
    for (const target of config.only) {
      const rows = buffer.filter((row) => row.source_key === TARGETS[target]);
      written[target] += await upsertAll(client, rows);
    }
    buffer = [];
  };
  for await (const record of records(config.subset)) {
    const built = rowsFor(record, params, cvm, owners);
    if (built === null) continue;
    buffer.push(built.registry, ...built.alias);
    if (built.domain) buffer.push(built.domain);
    if (built.directory) buffer.push(built.directory);
    if (buffer.length >= UPSERT_CHUNK * 5) await flush();
  }
  await flush();
  for (const target of config.only) console.log(`  rowsUpserted ${TARGETS[target]} = ${written[target]}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
