/**
 * CR — ETL de empresas y entidades con cédula jurídica + directorio gratuito
 * (SOURCES-CR-CEDULA-BY-NAME-1 + SOURCES-CR-CLOSE-1)
 *
 * Carga en `source_company_snapshots`, con fuentes oficiales y gratuitas:
 *   - `cr_company_registry`   una fila por cédula (nombre, tramo PYME del MEIC);
 *   - `cr_company_name_alias` claves extra de nombre (nombre anterior, siglas
 *                             oficiales, otros nombres de la misma cédula);
 *   - `cr_free_directory`     el directorio del descubrimiento gratuito por
 *                             industria (proveedoras de SICOP, Zona Franca,
 *                             entidades públicas).
 *
 * Entradas (todas locales; ninguna obligatoria salvo al menos una):
 *   --pymes=<xlsx>            MEIC «Lista de Pymes activas» (datos.go.cr).
 *   --recursos=<xlsx>         Hacienda SICOP «recursos» 2022-2024.
 *   --aclaraciones=<xlsx>     Hacienda SICOP «aclaraciones» 2022-2024.
 *   --zona-franca=<xlsx>      PROCOMER «Empresas en Régimen de Zona Franca».
 *   --sugef=<txt>             SUGEF «Entidades supervisadas» (pdftotext -layout).
 *   --grandes=<txt>           Hacienda «Grandes Contribuyentes Nacionales» (texto del PDF; la
 *                             descarga está bloqueada fuera de Costa Rica).
 *   --sicop-suppliers=<jsonl> y --sicop-institutions=<jsonl>
 *                             salida de `extract-cr-sicop-suppliers.py`.
 *   --mideplan=<jsonl>        fichas de MIDEPLAN ({name, web}) para siglas y web.
 *   --cicr=<jsonl>            socios de la Cámara de Industrias (`extract-cr-cicr-members.py`):
 *                             su web pasa a alias `web:<dominio>` de la cédula que el
 *                             registro conoce por nombre (SOURCES-CR-CICR-1).
 * (datos.go.cr exige un User-Agent de navegador para descargar y a veces da 522.)
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-cr-company-registry-etl.ts --pymes=… --zona-franca=… …
 *
 * Escritura REAL (sólo con autorización explícita de la dueña para ESA carga):
 *   --apply=registry,alias,directory   (una o varias)
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO los source_key pedidos;
 * `assertLargeImportAllowed` antes de escribir cada uno; sólo lee archivos
 * locales; nunca personas físicas (sólo cédulas 2…, 3…, 4… de 10 dígitos; la
 * columna SOLICITANTE de aclaraciones no se lee). No toca `cr_sicop`.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildCrCompanyRegistry,
  CR_COMPANY_NAME_ALIAS_SOURCE_KEY,
  CR_COMPANY_REGISTRY_SOURCE_KEY,
  type CrNamedCedula,
  type CrSourceRecords,
} from '../../src/server/source-catalog/connectors/cr-registry/cr-company-registry-rows';
import { matchCrCicrMembers, type CrCicrMember } from '../../src/server/source-catalog/connectors/cr-registry/cr-cicr-members';
import {
  matchCrMideplanInstitutions,
  parseCrLargeTaxpayersListText,
  parseCrNamedCedulaListText,
  type CrMideplanInstitution,
} from '../../src/server/source-catalog/connectors/cr-registry/cr-official-lists';
import {
  buildCrCicrMemberRow,
  buildCrPublicEntityRow,
  buildCrSicopSupplierRow,
  buildCrZonaFrancaRow,
  CR_FREE_DIRECTORY_SOURCE_KEY,
  mergeCrFreeDirectoryRows,
  type CrFreeDirectoryRow,
  type CrSicopSupplierSummary,
} from '../../src/server/source-catalog/connectors/cr-registry/cr-free-directory-row';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;
type Target = 'registry' | 'alias' | 'directory';

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Primera hoja del XLSX como registros columna → valor. */
function readFirstSheet(path: string): Record<string, unknown>[] {
  const workbook = XLSX.read(readFileSync(path), { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

function readJsonl<T>(path: string | null): T[] {
  if (!path) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/** Ficha de MIDEPLAN guardada por el lector: el nombre real va justo antes de «Sitio web». */
function mideplanFicha(raw: { name?: string | null; web?: string | null }): CrMideplanInstitution {
  const name = typeof raw.name === 'string' ? raw.name.split('getTime();').pop()?.trim() ?? null : null;
  const web = typeof raw.web === 'string' && /^https?:\/\//i.test(raw.web) ? raw.web : null;
  return { name: name && name.length < 200 ? name : null, web };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const applyArg = value(argv, 'apply');
  const targets = new Set<Target>(
    (applyArg ?? '').split(',').filter((t): t is Target => t === 'registry' || t === 'alias' || t === 'directory'),
  );
  if (applyArg !== null && targets.size === 0) throw new Error('config_invalid: --apply=registry,alias,directory');
  console.log(`CR ETL — ${targets.size > 0 ? `APPLY ${[...targets].join(',')}` : 'DRY-RUN (no escribe)'}`);

  const path = (name: string) => value(argv, name);
  const institutionsRaw = readJsonl<{ cedula: string; name: string; requests: number }>(path('sicop-institutions'));
  const institutions: CrNamedCedula[] = institutionsRaw.map((i) => ({ cedula: i.cedula, name: i.name }));
  const fichas = readJsonl<{ name?: string; web?: string }>(path('mideplan')).map(mideplanFicha);
  const mideplan = matchCrMideplanInstitutions(institutions, fichas);
  const acronymsByCedula = new Map<string, string[]>();
  const websitesByCedula = new Map<string, string>();
  for (const [cedula, info] of mideplan) {
    if (info.acronym) acronymsByCedula.set(cedula, [info.acronym]);
    if (info.web) websitesByCedula.set(cedula, info.web);
  }

  const records: CrSourceRecords = {
    pymes: path('pymes') ? readFirstSheet(path('pymes')!) : [],
    recursos: path('recursos') ? readFirstSheet(path('recursos')!) : [],
    aclaraciones: path('aclaraciones') ? readFirstSheet(path('aclaraciones')!) : [],
    zonaFranca: path('zona-franca') ? readFirstSheet(path('zona-franca')!) : [],
    sugef: path('sugef') ? parseCrNamedCedulaListText(readFileSync(path('sugef')!, 'utf8')) : [],
    grandesContribuyentes: path('grandes') ? parseCrLargeTaxpayersListText(readFileSync(path('grandes')!, 'utf8')) : [],
    institutions,
    acronymsByCedula,
    websitesByCedula,
  };
  const year = Number(value(argv, 'year') ?? new Date().getUTCFullYear());
  const importedAt = new Date().toISOString();
  const cicrMembers = readJsonl<CrCicrMember>(path('cicr'));
  let built = buildCrCompanyRegistry(records, { sourceYear: year, importedAt });
  let cicrReport: ReturnType<typeof matchCrCicrMembers>['report'] | null = null;
  let cicrMatches: ReturnType<typeof matchCrCicrMembers>['matches'] = [];
  if (cicrMembers.length > 0) {
    // Las webs de MIDEPLAN mandan; CICR sólo completa las cédulas que no tienen web.
    const cicr = matchCrCicrMembers(cicrMembers, built.registry);
    cicrReport = cicr.report;
    cicrMatches = cicr.matches;
    const merged = new Map<string, string>(cicr.websitesByCedula);
    for (const [cedula, web] of websitesByCedula) merged.set(cedula, web);
    built = buildCrCompanyRegistry({ ...records, websitesByCedula: merged }, { sourceYear: year, importedAt });
  }
  const { registry: allRegistry, aliases: allAliases } = built;
  const registry = allRegistry.filter((row) => row.record_identity_key !== null);
  const aliases = allAliases.filter((row) => row.record_identity_key !== null);

  // Directorio gratuito.
  const byCedula = new Map(registry.map((row) => [row.tax_id, row]));
  const lookup = (cedula: string) => {
    const row = byCedula.get(cedula);
    if (!row) return null;
    const size = row.raw_data['cr_meic_size'];
    const origins = row.raw_data['origins'];
    return {
      legalName: row.legal_name,
      meicSize: typeof size === 'string' ? size : null,
      largeTaxpayer: Array.isArray(origins) && origins.includes('hacienda_grandes_contribuyentes'),
    };
  };
  const suppliers = readJsonl<{ cedula: string; fam: Record<string, number>; buyers: number; offers: number; last_year: number | null }>(
    path('sicop-suppliers'),
  ).map((s): CrSicopSupplierSummary => ({
    cedula: s.cedula,
    amountByFamily: s.fam,
    buyers: s.buyers,
    offers: s.offers,
    lastOfferYear: s.last_year,
  }));
  const supplierByCedula = new Map(suppliers.map((s) => [s.cedula, s]));
  const directoryCandidates: CrFreeDirectoryRow[] = [];
  const exclusions: Record<string, number> = {};
  const take = (result: { row: CrFreeDirectoryRow } | { excluded: string }, label: string) => {
    if ('row' in result) directoryCandidates.push(result.row);
    else exclusions[`${label}:${result.excluded}`] = (exclusions[`${label}:${result.excluded}`] ?? 0) + 1;
  };
  for (const summary of suppliers) take(buildCrSicopSupplierRow({ summary, registry: lookup, sourceYear: year, importedAt }), 'sicop');
  for (const company of records.zonaFranca ?? []) {
    const cedula = String(company['CED. JURID.'] ?? '').replace(/\D/g, '').slice(0, 10);
    take(
      buildCrZonaFrancaRow({
        company: {
          cedula: company['CED. JURID.'],
          name: company['Empresa'],
          activity: company['ACTIVIDAD'],
          companyType: company['TIPO DE EMPRESA'],
          canton: company['CANTÓN'],
          province: company['PROVINCIA'],
        },
        registry: lookup,
        sicop: supplierByCedula.get(cedula) ?? null,
        sourceYear: year,
        importedAt,
      }),
      'zona_franca',
    );
  }
  for (const inst of institutionsRaw) {
    const info = mideplan.get(inst.cedula);
    take(
      buildCrPublicEntityRow({
        entity: {
          cedula: inst.cedula,
          name: inst.name,
          purchaseRequests: inst.requests,
          website: info?.web ?? null,
          acronym: info?.acronym ?? null,
          largeTaxpayer: lookup(inst.cedula)?.largeTaxpayer === true,
        },
        sourceYear: year,
        importedAt,
      }),
      'public',
    );
  }
  for (const { cedula, member } of cicrMatches) {
    take(
      buildCrCicrMemberRow({ member: { cedula, activity: member.activity, domain: member.domain }, registry: lookup, sourceYear: year, importedAt }),
      'cicr',
    );
  }
  const directory = mergeCrFreeDirectoryRows(directoryCandidates).filter((row) => row.record_identity_key !== null);

  // Informe.
  const cores = new Map<string, number>();
  for (const row of registry) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = registry.filter((row) => cores.get(row.normalized_legal_name) === 1).length;
  console.log(
    `  Leídos: pymes ${records.pymes?.length ?? 0} · recursos ${records.recursos?.length ?? 0} · aclaraciones ${records.aclaraciones?.length ?? 0} · zona franca ${records.zonaFranca?.length ?? 0} · sugef ${records.sugef?.length ?? 0} · grandes ${records.grandesContribuyentes?.length ?? 0} · instituciones ${institutions.length} · fichas MIDEPLAN cruzadas ${mideplan.size} (siglas ${acronymsByCedula.size}, webs ${websitesByCedula.size})`,
  );
  console.log(`  Registro: ${registry.length} cédulas — por origen ${JSON.stringify(countBy(registry, (r) => String(r.raw_data.origin)))}`);
  console.log(`  Registro: por prefijo ${JSON.stringify(countBy(registry, (r) => r.tax_id.slice(0, 1)))} · tramo MEIC ${JSON.stringify(countBy(registry, (r) => String(r.raw_data['cr_meic_size'] ?? '-')))}`);
  if (cicrReport !== null) {
    const webAliases = aliases.filter((a) => a.normalized_legal_name.startsWith('web:')).length;
    console.log(`  CICR: ${cicrReport.matched}/${cicrReport.total} socios con cédula única · alias web en total ${webAliases} · exclusiones ${JSON.stringify(cicrReport.excluded)}`);
  }
  console.log(`  Con nombre único: ${unique} (${((100 * unique) / Math.max(registry.length, 1)).toFixed(1)} %) · alias ${aliases.length}`);
  console.log(`  Directorio: ${directory.length} — por fuente ${JSON.stringify(countBy(directory, (r) => String(r.raw_data.directory_kind)))}`);
  console.log(`  Directorio por macro: ${JSON.stringify(countBy(directory, (r) => String(r.raw_data.macro_industry_key)))}`);
  console.log(`  Directorio con web: ${directory.filter((r) => r.raw_data.website_domain).length} · grandes contribuyentes ${directory.filter((r) => r.raw_data.official_size_band === 'large').length} · exclusiones ${JSON.stringify(exclusions)}`);

  if (argv.includes('--sample')) {
    const byMacro = new Map<string, CrFreeDirectoryRow[]>();
    for (const row of directory) {
      const macro = String(row.raw_data.macro_industry_key);
      byMacro.set(macro, [...(byMacro.get(macro) ?? []), row]);
    }
    for (const [macro, rows] of [...byMacro.entries()].sort()) {
      const top = rows.sort((a, b) => b.priority_score - a.priority_score || a.tax_id.localeCompare(b.tax_id)).slice(0, 8);
      console.log(`  ${macro}: ${top.map((r) => `${r.legal_name} [${r.raw_data.directory_kind}]`).join(' · ')}`);
    }
  }

  if (targets.size === 0) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply=… (con autorización) para persistir.');
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const write = async (sourceKey: string, rows: readonly object[]) => {
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
  if (targets.has('registry')) await write(CR_COMPANY_REGISTRY_SOURCE_KEY, registry);
  if (targets.has('alias')) await write(CR_COMPANY_NAME_ALIAS_SOURCE_KEY, aliases);
  if (targets.has('directory')) await write(CR_FREE_DIRECTORY_SOURCE_KEY, directory);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
