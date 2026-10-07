/**
 * PY SET — ETL del registro de sociedades (SOURCES-PY-RUC-BY-NAME-1)
 *
 * Carga en `source_company_snapshots` (source_key='py_set_registry') las
 * sociedades paraguayas (RUC 80…) ACTIVAS del padrón público de RUC de la SET/DNIT,
 * con filas MÍNIMAS (RUC con dígito verificador, razón social, núcleo del nombre),
 * para que el Agente 1 obtenga el RUC por nombre dentro de la corrida.
 *
 *   --dir=<carpeta>  con ruc0.txt … ruc9.txt descomprimidos (públicos, ~40 MB en
 *                    total, https://www.dnit.gov.py/web/portal-institucional/
 *                    listado-de-ruc-con-sus-equivalencias).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-py-set-registry-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; ~100 k filas ⇒ la
 * valla anti-cargas masivas exige SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y
 * SELLUP_CONFIRMED_SOURCE_KEY=py_set_registry):
 *   npx tsx scripts/source-catalog/run-py-set-registry-etl.ts --dir=… --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='py_set_registry'.
 *   - `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No toca accounts, prospect_candidates ni otras fuentes. No llama a la SET ni
 *     a proveedores: sólo lee archivos locales.
 *   - Reanudable: `--offset=<n>` salta las n primeras filas ya escritas.
 *
 * SOURCES-PY-CLOSE-1:
 *   - El núcleo reconoce la forma societaria por su estructura (E.A.S., SAECA…) y
 *     quita el paréntesis final: recargar actualiza `normalized_legal_name`.
 *   - Escribe también `py_set_name_alias` (sigla, partes del nombre, clave de
 *     entidad pública), sin claves que sean el nombre propio de otra sociedad.
 *   - `--dncp-api=<fichero.jsonl>` (fichas de la API pública de la DNCP, de
 *     `extract-py-dncp-suppliers.py`): el tamaño MIPYME declarado va a `raw_data`.
 *   Escritura real: además SELLUP_CONFIRMED_SOURCE_KEY=py_set_registry; los alias
 *   (< 25 k filas) no necesitan la valla de cargas masivas.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { readFileSync } from 'node:fs';
import {
  buildPySetNameAliasRows,
  buildPySetRegistryRow,
  PY_SET_NAME_ALIAS_SOURCE_KEY,
  PY_SET_REGISTRY_SOURCE_KEY,
  type ParaguayDeclaredSize,
  type PySetNameAliasRow,
  type PySetRegistryRow,
} from '../../src/server/source-catalog/connectors/set-paraguay/py-set-registry-row';
import {
  paraguayOwnNameKeys,
  paraguayRegistryAliasKeys,
} from '../../src/server/source-catalog/connectors/set-paraguay/py-name-keys';
import {
  parsePyDncpSupplierProfile,
  pyDncpDeclaredMipymeSize,
  pyDncpProfileRuc,
} from '../../src/server/source-catalog/connectors/set-paraguay/py-dncp-directory-row';
import { dropAliasKeysOwnedByOthers } from '../../src/server/source-catalog/connectors/sunat-peru/pe-name-keys';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
const FILES = Array.from({ length: 10 }, (_, digit) => `ruc${digit}.txt`);

type Config = { dir: string; apply: boolean; year: number; offset: number; dncpApi: string | null };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir=<carpeta con ruc0.txt … ruc9.txt>');
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(year) || !Number.isInteger(offset) || offset < 0) {
    throw new Error('config_invalid: --year y --offset deben ser enteros (offset ≥ 0)');
  }
  return { dir, apply: argv.includes('--apply'), year, offset, dncpApi: value('dncp-api') };
}

/** RUC → tamaño MIPYME declarado a la DNCP (sólo micro, pequeña o mediana). */
function readDeclaredSizes(path: string | null, year: number): Map<string, ParaguayDeclaredSize> {
  const sizes = new Map<string, ParaguayDeclaredSize>();
  if (path === null) return sizes;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const raw: unknown = JSON.parse(line);
    const ruc = pyDncpProfileRuc(raw);
    const size = pyDncpDeclaredMipymeSize(parsePyDncpSupplierProfile(raw));
    if (ruc !== null && size !== null) sizes.set(ruc, { size, year });
  }
  return sizes;
}

/** Alias de todas las sociedades, sin claves que sean el nombre propio de otra. */
function buildAliasRows(rows: readonly PySetRegistryRow[]): PySetNameAliasRow[] {
  const owners = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const key of paraguayOwnNameKeys(row.normalized_legal_name)) {
      owners.set(key, (owners.get(key) ?? new Set<string>()).add(row.tax_id));
    }
  }
  return rows.flatMap((row) =>
    buildPySetNameAliasRows({
      registryRow: row,
      keys: dropAliasKeysOwnedByOthers(paraguayRegistryAliasKeys(row.legal_name), row.tax_id, owners),
    }),
  );
}

async function upsertAll(
  client: SupabaseClient,
  rows: readonly (PySetRegistryRow | PySetNameAliasRow)[],
  offset: number,
): Promise<number> {
  let upserted = 0;
  for (let i = offset; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
    if ((i / UPSERT_CHUNK) % 20 === 0) console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  return upserted;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`PY SET REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const missing = FILES.filter((file) => !existsSync(join(config.dir, file)));
  if (missing.length > 0) throw new Error(`config_invalid: faltan ${missing.join(', ')}`);

  const importedAt = new Date().toISOString();
  const declaredSizes = readDeclaredSizes(config.dncpApi, config.year);
  const byRuc = new Map<string, PySetRegistryRow>();
  let linesRead = 0;
  for (const file of FILES) {
    const lines = createInterface({
      input: createReadStream(join(config.dir, file), { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      linesRead++;
      const ruc = line.split('|')[0]?.trim() ?? '';
      const declaredSize = declaredSizes.size > 0 ? lookupDeclaredSize(declaredSizes, ruc) : null;
      const row = buildPySetRegistryRow(line, { sourceYear: config.year, importedAt, declaredSize });
      if (row !== null && row.record_identity_key !== null && !byRuc.has(row.normalized_tax_id)) {
        byRuc.set(row.normalized_tax_id, row);
      }
    }
  }

  const rows = [...byRuc.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Líneas leídas: ${linesRead}`);
  console.log(`  Sociedades (RUC 80…) activas: ${rows.length}`);
  console.log(`  Con nombre único (RUC asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);
  const aliasRows = buildAliasRows(rows);
  console.log(`  Alias (${PY_SET_NAME_ALIAS_SOURCE_KEY}): ${aliasRows.length}`);
  console.log(`  Con tamaño MIPYME declarado a la DNCP: ${rows.filter((row) => row.raw_data['py_mipyme_size']).length}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: PY_SET_REGISTRY_SOURCE_KEY,
    countryCode: 'PY',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  assertLargeImportAllowed({
    sourceKey: PY_SET_NAME_ALIAS_SOURCE_KEY,
    countryCode: 'PY',
    estimatedRows: aliasRows.length,
    isDryRun: false,
  });
  console.log(`  rowsUpserted (${PY_SET_REGISTRY_SOURCE_KEY}) = ${await upsertAll(client, rows, config.offset)}`);
  console.log(`  rowsUpserted (${PY_SET_NAME_ALIAS_SOURCE_KEY}) = ${await upsertAll(client, aliasRows, 0)}`);
}

/** El padrón trae el RUC sin dígito verificador; la ficha de la DNCP, con él. */
function lookupDeclaredSize(sizes: Map<string, ParaguayDeclaredSize>, rucBody: string): ParaguayDeclaredSize | null {
  for (let dv = 0; dv <= 9; dv++) {
    const hit = sizes.get(`${rucBody}-${dv}`);
    if (hit) return hit;
  }
  return null;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
