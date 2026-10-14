/**
 * US — ETL de las entidades públicas (SOURCES-US-CLOSE-1)
 *
 * Carga en `source_company_snapshots` la fuente `us_public_entities` (una fila por
 * entidad, identidad `us-public-entity:<dominio>`) desde:
 *
 *   --dotgov-file=<csv>  current-full.csv de CISA
 *                        (https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv)
 *   --census-file=<csv>  sub-est2024.csv del Censo (estimaciones de población de
 *                        condados y lugares incorporados,
 *                        https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv)
 *
 *   --usaspending-file=<json> (opcional) respuesta de
 *                        https://api.usaspending.gov/api/v2/references/toptier_agencies/
 *                        (presupuesto de las agencias federales, para ordenarlas).
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-us-public-entities-etl.ts --dotgov-file=… --census-file=…
 *
 * Escritura REAL sólo con autorización explícita de la dueña: … --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO `us_public_entities`;
 * `assertLargeImportAllowed` antes de escribir; sólo lee archivos locales; nunca
 * guarda el correo de contacto de la lista de CISA.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildUsPublicEntityRows,
  federalAgencyKey,
  placeNameKey,
  US_PUBLIC_ENTITIES_SOURCE_KEY,
  type DotGovDomainRecord,
  type UsFederalBudgetLookup,
  type UsPopulationLookup,
} from '../../src/server/source-catalog/connectors/us-ein/us-public-entities';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

function arg(argv: readonly string[], name: string): string | null {
  const hit = argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Censo: SUMLEV 050 = condado, 162 = lugar incorporado. Si un nombre se repite en el estado, manda el mayor. */
async function readPopulation(file: string): Promise<UsPopulationLookup> {
  const counties = new Map<string, number>();
  const cities = new Map<string, number>();
  const states = new Map<string, number>();
  for await (const record of readCsvFile(file)) {
    const level = record['SUMLEV']?.trim();
    if (level === '040') {
      const statePopulation = Number(record['POPESTIMATE2024']);
      if (Number.isFinite(statePopulation)) states.set(record['STNAME']?.trim() ?? '', statePopulation);
      continue;
    }
    const target = level === '050' ? counties : level === '162' ? cities : null;
    if (target === null) continue;
    const population = Number(record['POPESTIMATE2024']);
    if (!Number.isFinite(population)) continue;
    const key = `${placeNameKey(record['NAME'] ?? '')}|${record['STNAME']?.trim()}`;
    target.set(key, Math.max(target.get(key) ?? 0, population));
  }
  return {
    county: (name, stateName) => counties.get(`${name}|${stateName}`) ?? null,
    city: (name, stateName) => cities.get(`${name}|${stateName}`) ?? null,
    state: (stateName) => states.get(stateName) ?? null,
  };
}

/** USAspending: presupuesto (budget authority) de cada agencia de primer nivel, por núcleo de nombre. */
function readFederalBudgets(file: string | null): UsFederalBudgetLookup {
  if (!file) return () => null;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { results?: { agency_name?: string; budget_authority_amount?: number }[] };
  const budgets = new Map<string, number>();
  for (const agency of parsed.results ?? []) {
    const amount = Number(agency.budget_authority_amount);
    if (typeof agency.agency_name === 'string' && Number.isFinite(amount)) budgets.set(federalAgencyKey(agency.agency_name), amount);
  }
  return (organization) => budgets.get(federalAgencyKey(organization)) ?? null;
}

async function readDotGov(file: string): Promise<DotGovDomainRecord[]> {
  const records: DotGovDomainRecord[] = [];
  for await (const record of readCsvFile(file)) {
    records.push({
      domain: record['Domain name'] ?? '',
      domainType: record['Domain type'] ?? '',
      organization: record['Organization name'] ?? '',
      suborganization: record['Suborganization name'] || null,
      city: record['City'] || null,
      state: record['State'] || null,
    });
  }
  return records;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dotgovFile = arg(argv, 'dotgov-file');
  const censusFile = arg(argv, 'census-file');
  if (!dotgovFile || !censusFile) throw new Error('config_invalid: faltan --dotgov-file=<csv> y --census-file=<csv>');
  const apply = argv.includes('--apply');
  console.log(`US PUBLIC ENTITIES ETL (${US_PUBLIC_ENTITIES_SOURCE_KEY}) — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const [records, population] = await Promise.all([readDotGov(dotgovFile), readPopulation(censusFile)]);
  const rows = buildUsPublicEntityRows(
    records,
    population,
    { sourceYear: new Date().getUTCFullYear(), importedAt: new Date().toISOString() },
    readFederalBudgets(arg(argv, 'usaspending-file')),
  );
  const byLevel = new Map<string, number>();
  for (const row of rows) {
    const level = String(row.raw_data['government_level']);
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
  }
  console.log(`  Dominios leídos: ${records.length}`);
  console.log(`  Entidades a cargar: ${rows.length}`);
  for (const [level, n] of [...byLevel.entries()].sort()) console.log(`    ${level}: ${n}`);
  const byTier = new Map<string, number>();
  for (const row of rows) {
    const tier = `${String(row.raw_data['government_tier'])} · ${String(row.raw_data['government_level'])}`;
    byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
  }
  for (const [tier, n] of [...byTier.entries()].sort()) console.log(`    nivel ${tier}: ${n}`);
  console.log(`  Primeras 15: ${rows.slice(0, 15).map((row) => row.legal_name).join(' · ')}`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }
  const missingIdentity = rows.filter((row) => row.record_identity_key === null).length;
  if (missingIdentity > 0) throw new Error(`identity_missing: ${missingIdentity} filas sin identidad`);

  assertLargeImportAllowed({
    sourceKey: US_PUBLIC_ENTITIES_SOURCE_KEY,
    countryCode: 'US',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
