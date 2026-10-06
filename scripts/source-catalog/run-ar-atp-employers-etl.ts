/**
 * AR ATP — ETL de empleadores (SOURCES-AR-E2E-1)
 *
 * Carga en `source_company_snapshots` (source_key='ar_atp_employers') las
 * sociedades argentinas ACTIVAS que en 2020 declararon al menos 100 trabajadores
 * en el programa ATP. Archivos públicos (datos.gob.ar, CC-BY 4.0) que el
 * operador descarga antes:
 *
 *   salarios-rondaatp-1a5.csv   https://infra.datos.gob.ar/catalog/jgm/dataset/17/distribution/17.4/download/salarios-rondaatp-1a5.csv
 *   salarios-rondaatp-6a9.csv   https://infra.datos.gob.ar/catalog/jgm/dataset/17/distribution/17.13/download/salarios-rondaatp-6a9.csv
 *
 * Opcional (SOURCES-AR-DOMAIN-ON-RELOAD-1):
 *   --sipro-legacy=<csv>  SIPRO histórico: escribe el dominio corporativo en el mismo
 *                         paso. SIN él, las filas quedan sin dominio.
 *
 * La razón social y la actividad se LEEN del registro ya cargado en Prod
 * (`ar_rns_registry`, sólo lectura): una sociedad que no esté activa allí no entra.
 *
 * Uso (DRY-RUN por defecto: lee, cruza, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ar-atp-employers-etl.ts --atp=a.csv,b.csv
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   … --apply
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='ar_atp_employers'.
 *   - Pasa por `assertLargeImportAllowed` antes de cualquier escritura.
 *   - Lee `ar_rns_registry`; no toca accounts, prospect_candidates ni otra fuente.
 *   - No llama a ningún proveedor.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { normalizeCuit, percentileScores } from '../../src/server/source-catalog/connectors/rns-argentina/ar-rns-snapshot-builder';
import {
  AR_ATP_EMPLOYERS_SOURCE_KEY,
  AR_ATP_MIN_WORKERS,
  buildArAtpEmployerRow,
  pickAtpEmployer,
  type ArAtpEmployer,
  type ArAtpEmployerRow,
  type ArRegistryCompany,
} from '../../src/server/source-catalog/connectors/rns-argentina/ar-atp-employers';
import { buildArSiproDomainMap } from '../../src/server/source-catalog/connectors/rns-argentina/ar-sipro-domain';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;
const REGISTRY_READ_CHUNK = 200;

type Config = { atp: string[]; apply: boolean; minWorkers: number; siproLegacy: string | null };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const atp = (value('atp') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (atp.length === 0) throw new Error('config_invalid: falta --atp=<csv>[,<csv>]');
  const minWorkers = Number(value('min-workers') ?? AR_ATP_MIN_WORKERS);
  if (!Number.isInteger(minWorkers) || minWorkers < 1) {
    throw new Error('config_invalid: --min-workers debe ser un entero positivo');
  }
  return { atp, apply: argv.includes('--apply'), minWorkers, siproLegacy: value('sipro-legacy') };
}

async function readEmployers(paths: readonly string[]): Promise<Map<string, ArAtpEmployer>> {
  const byCuit = new Map<string, ArAtpEmployer>();
  for (const path of paths) {
    for await (const row of readCsvFile(path)) {
      const cuit = normalizeCuit(row['cuit']);
      if (cuit === null) continue;
      const previous = byCuit.get(cuit) ?? null;
      const next = pickAtpEmployer(previous, row);
      if (next !== null && next !== previous) byCuit.set(cuit, next);
    }
  }
  return byCuit;
}

async function readRegistry(
  client: SupabaseClient,
  cuits: readonly string[],
): Promise<Map<string, ArRegistryCompany>> {
  const byCuit = new Map<string, ArRegistryCompany>();
  for (let i = 0; i < cuits.length; i += REGISTRY_READ_CHUNK) {
    const chunk = cuits.slice(i, i + REGISTRY_READ_CHUNK);
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('normalized_tax_id, legal_name, raw_data')
      .eq('source_key', 'ar_rns_registry')
      .eq('country_code', 'AR')
      .in('normalized_tax_id', chunk);
    if (error) throw new Error(`registry_read_failed_at_${i}: ${error.message}`);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const cuit = typeof row['normalized_tax_id'] === 'string' ? row['normalized_tax_id'] : null;
      const legalName = typeof row['legal_name'] === 'string' ? row['legal_name'] : null;
      const raw = (row['raw_data'] ?? {}) as Record<string, unknown>;
      const code = typeof raw['actividad_codigo'] === 'string' ? raw['actividad_codigo'] : null;
      if (cuit && legalName) byCuit.set(cuit, { cuit, legalName, activityCode: code });
    }
  }
  return byCuit;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`AR ATP ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const employers = await readEmployers(config.atp);
  const eligible = [...employers.values()]
    .filter((e) => e.workers >= config.minWorkers)
    .sort((a, b) => a.cuit.localeCompare(b.cuit));
  console.log(`  Sociedades en ATP: ${employers.size} · con ≥${config.minWorkers} trabajadores: ${eligible.length}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const registry = await readRegistry(client, eligible.map((e) => e.cuit));
  console.log(`  Activas en el registro: ${registry.size}`);

  let siproDomains: Map<string, string> | null = null;
  if (config.siproLegacy) {
    const siproRows: Record<string, string>[] = [];
    for await (const row of readCsvFile(config.siproLegacy)) siproRows.push(row);
    siproDomains = buildArSiproDomainMap(siproRows);
  } else {
    console.warn('  ⚠️ Sin --sipro-legacy: las filas quedan SIN dominio. Corre después run-ar-sipro-domain-etl.ts.');
  }

  const inRegistry = eligible.filter((e) => registry.has(e.cuit));
  const scores = percentileScores(inRegistry.map((e) => e.workers));
  const importedAt = new Date().toISOString();
  const rows: ArAtpEmployerRow[] = [];
  inRegistry.forEach((employer, index) => {
    const built = buildArAtpEmployerRow({
      employer,
      registry: registry.get(employer.cuit) as ArRegistryCompany,
      priorityScore: scores[index],
      importedAt,
      minWorkers: config.minWorkers,
      siproDomain: siproDomains?.get(employer.cuit) ?? null,
    });
    if (built !== null) rows.push(built);
  });

  const perMacro = new Map<string, { n: number; ge200: number }>();
  for (const row of rows) {
    const macro = String(row.raw_data['macro_industry_key']);
    const workers = Number(row.signals['atp_workers_floor']);
    const prev = perMacro.get(macro) ?? { n: 0, ge200: 0 };
    perMacro.set(macro, { n: prev.n + 1, ge200: prev.ge200 + (workers >= 200 ? 1 : 0) });
  }
  console.log('  Por macro industria (filas · con ≥200):');
  for (const [macro, c] of [...perMacro].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${macro.padEnd(46)} ${String(c.n).padStart(5)} · ${c.ge200}`);
  }
  const writable = rows.filter((row) => row.record_identity_key !== null);
  console.log(`  Con dominio (SIPRO histórico): ${rows.filter((r) => r.raw_data['website_domain']).length}`);
  console.log(`  Filas a escribir: ${writable.length} (sin macro o sin actividad: ${inRegistry.length - rows.length})`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: AR_ATP_EMPLOYERS_SOURCE_KEY,
    countryCode: 'AR',
    estimatedRows: writable.length,
    isDryRun: false,
  });

  let upserted = 0;
  for (let i = 0; i < writable.length; i += UPSERT_CHUNK) {
    const chunk = writable.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
