/**
 * CR — carga de los socios de CICR contra el registro REAL (SOURCES-CR-CICR-1).
 *
 * A diferencia de `--cicr` del ETL de CR (que reconstruye el registro desde archivos
 * locales), este cargador lee `cr_company_registry` tal como está en la base, cruza
 * los socios por nombre y escribe SÓLO lo que agrega:
 *   - alias `web:<dominio>` de las cédulas cruzadas (nunca una web que ya es de otra
 *     cédula ni una compartida por dos);
 *   - filas nuevas de `cr_free_directory` (`directory_kind = cicr_member`) para las
 *     cédulas que el directorio todavía no tiene;
 *   - a las filas del directorio que ya existen y no traen web, SÓLO se les agrega
 *     `website_domain` (su industria y su fuente no se tocan).
 *
 * Entrada: `--cicr=<jsonl>` (salida de `extract-cr-cicr-members.py`).
 *
 * Uso (DRY-RUN por defecto: lee la base, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-cr-cicr-load.ts --cicr=… [--env-dir=<carpeta con .env.local>]
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   --apply
 *
 * Guardrails: dry-run por defecto; `assertLargeImportAllowed` antes de cada escritura;
 * nunca borra; no toca otras fuentes ni otras cédulas.
 */

import { readFileSync } from 'node:fs';
import { loadEnvConfig } from '@next/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildCrCicrWebAliasRows,
  matchCrCicrMembers,
  type CrCicrMember,
} from '../../src/server/source-catalog/connectors/cr-registry/cr-cicr-members';
import {
  CR_COMPANY_NAME_ALIAS_SOURCE_KEY,
  CR_COMPANY_REGISTRY_SOURCE_KEY,
  type CrCompanyRegistryRow,
} from '../../src/server/source-catalog/connectors/cr-registry/cr-company-registry-rows';
import {
  buildCrCicrMemberRow,
  CR_FREE_DIRECTORY_SOURCE_KEY,
  type CrFreeDirectoryRow,
} from '../../src/server/source-catalog/connectors/cr-registry/cr-free-directory-row';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const PAGE = 1000;
const UPSERT_CHUNK = 500;

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Todas las filas de una fuente de Costa Rica, por páginas (sólo lectura). */
async function readAll<T>(client: SupabaseClient, sourceKey: string, columns: string, prefix?: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = client
      .from('source_company_snapshots')
      .select(columns)
      .eq('source_key', sourceKey)
      .eq('country_code', 'CR')
      .order('normalized_tax_id', { ascending: true })
      .order('normalized_legal_name', { ascending: true })
      .range(from, from + PAGE - 1);
    if (prefix !== undefined) query = query.like('normalized_legal_name', `${prefix}%`);
    const { data, error } = await query;
    if (error) throw new Error(`read_failed_${sourceKey}: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const REGISTRY_COLUMNS =
  'source_key, country_code, source_year, tax_id, normalized_tax_id, legal_name, normalized_legal_name, raw_data, imported_at, record_identity_key';
const DIRECTORY_COLUMNS =
  'source_key, country_code, source_year, tax_id, normalized_tax_id, legal_name, normalized_legal_name, city, region, priority_score, raw_data, imported_at, record_identity_key';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const cicrPath = value(argv, 'cicr');
  if (cicrPath === null) throw new Error('config_invalid: --cicr=<jsonl>');
  loadEnvConfig(value(argv, 'env-dir') ?? process.cwd());
  console.log(`CR CICR — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);
  console.log(`  Proyecto: ${new URL(url).hostname.split('.')[0]}`);

  const members = readFileSync(cicrPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CrCicrMember);

  const registry = await readAll<CrCompanyRegistryRow>(client, CR_COMPANY_REGISTRY_SOURCE_KEY, REGISTRY_COLUMNS);
  const webAliases = await readAll<{ tax_id: string; normalized_legal_name: string }>(
    client,
    CR_COMPANY_NAME_ALIAS_SOURCE_KEY,
    'tax_id, normalized_legal_name',
    'web:',
  );
  const directory = await readAll<CrFreeDirectoryRow>(client, CR_FREE_DIRECTORY_SOURCE_KEY, DIRECTORY_COLUMNS);
  console.log(`  Leído de la base: registro ${registry.length} · alias web ${webAliases.length} · directorio ${directory.length}`);

  const { websitesByCedula, matches, report } = matchCrCicrMembers(members, registry);
  console.log(`  Cruce: ${report.matched}/${report.total} socios con cédula única · exclusiones ${JSON.stringify(report.excluded)}`);

  // 1. Alias de web (no pisa la web de otra cédula).
  const takenWebKeys = new Map(webAliases.map((a) => [a.normalized_legal_name, a.tax_id]));
  const aliasRows = buildCrCicrWebAliasRows({ registry, websitesByCedula, takenWebKeys });
  const aliasesAlreadyThere = aliasRows.filter((a) => takenWebKeys.get(a.normalized_legal_name) === a.tax_id).length;

  // 2. Directorio: filas nuevas y webs que faltan en las existentes.
  const registryByCedula = new Map(registry.map((row) => [row.tax_id, row]));
  const lookup = (cedula: string) => {
    const row = registryByCedula.get(cedula);
    if (!row) return null;
    const size = row.raw_data['cr_meic_size'];
    const origins = row.raw_data['origins'];
    return {
      legalName: row.legal_name,
      meicSize: typeof size === 'string' ? size : null,
      largeTaxpayer: Array.isArray(origins) && origins.includes('hacienda_grandes_contribuyentes'),
    };
  };
  const existing = new Map(directory.map((row) => [row.tax_id, row]));
  const year = new Date().getUTCFullYear();
  const importedAt = new Date().toISOString();
  const newRows: CrFreeDirectoryRow[] = [];
  const patchedRows: CrFreeDirectoryRow[] = [];
  const exclusions: Record<string, number> = {};
  let existingWithWeb = 0;
  for (const { cedula, member } of matches) {
    const built = buildCrCicrMemberRow({
      member: { cedula, activity: member.activity, domain: member.domain },
      registry: lookup,
      sourceYear: year,
      importedAt,
    });
    const web = 'row' in built ? (built.row.raw_data.website_domain as string | undefined) : undefined;
    const current = existing.get(cedula);
    if (current !== undefined) {
      // Ya está en el directorio: sólo se le suma la web si no tiene (nada más cambia).
      if (current.raw_data['website_domain']) existingWithWeb += 1;
      else if (web) patchedRows.push({ ...current, raw_data: { ...current.raw_data, website_domain: web } });
      continue;
    }
    if ('row' in built) newRows.push(built.row);
    else exclusions[built.excluded] = (exclusions[built.excluded] ?? 0) + 1;
  }
  const byMacro: Record<string, number> = {};
  for (const row of newRows) byMacro[String(row.raw_data.macro_industry_key)] = (byMacro[String(row.raw_data.macro_industry_key)] ?? 0) + 1;
  console.log(`  Alias de web: ${aliasRows.length} a escribir (${aliasesAlreadyThere} ya existían)`);
  console.log(`  Directorio: ${newRows.length} filas nuevas · ${patchedRows.length} existentes a las que se suma la web · ${existingWithWeb} ya con web`);
  console.log(`  Directorio nuevas por macro: ${JSON.stringify(byMacro)} · exclusiones ${JSON.stringify(exclusions)}`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  const write = async (sourceKey: string, rows: readonly object[]) => {
    if (rows.length === 0) return;
    assertLargeImportAllowed({ sourceKey, countryCode: 'CR', estimatedRows: rows.length, isDryRun: false });
    let upserted = 0;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await client.from('source_company_snapshots').upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
      if (error) throw new Error(`upsert_failed_${sourceKey}_at_offset_${i}: ${error.message}`);
      upserted += chunk.length;
    }
    console.log(`  ${sourceKey}: rowsUpserted = ${upserted}`);
  };
  await write(CR_COMPANY_NAME_ALIAS_SOURCE_KEY, aliasRows.filter((a) => takenWebKeys.get(a.normalized_legal_name) !== a.tax_id));
  await write(CR_FREE_DIRECTORY_SOURCE_KEY, [...newRows, ...patchedRows]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
