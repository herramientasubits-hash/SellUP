/**
 * AR RNS — ETL de snapshots (SOURCES-AR-RNS-1)
 *
 * Carga en `source_company_snapshots` (source_key='ar_rns') las sociedades
 * argentinas ACTIVAS que son proveedoras del Estado, cruzando tres archivos
 * públicos (CC-BY 4.0) que el operador descarga y descomprime antes:
 *
 *   --rns=<csv>      Registro Nacional de Sociedades (datos.jus.gob.ar), UNA foto
 *                    (p. ej. registro-nacional-sociedades-20260618.csv, ~890 MB)
 *   --sipro=<csv>    SiPRO.csv (datos.gob.ar, COMPR.AR — proveedores inscriptos)
 *   --awards=<csv>   Adjudicaciones.csv (datos.gob.ar, COMPR.AR)
 *
 * Uso (DRY-RUN por defecto: lee, cruza, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ar-rns-snapshot-etl.ts --rns=… --sipro=… --awards=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   npx tsx scripts/source-catalog/run-ar-rns-snapshot-etl.ts --rns=… --sipro=… --awards=… --apply
 *
 * Por defecto se cargan sólo las sociedades que HAN GANADO alguna adjudicación
 * (~6.000 filas, por debajo del umbral de la valla). `--include-sipro-only` añade
 * las inscriptas que nunca ganaron (~32.500 filas en total): la valla
 * anti-cargas masivas exige entonces además SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true
 * y SELLUP_CONFIRMED_SOURCE_KEY=ar_rns.
 *
 * Guardrails:
 *   - Dry-run por defecto; `--apply` escribe SÓLO source_key='ar_rns'.
 *   - Pasa por `assertLargeImportAllowed` antes de cualquier escritura.
 *   - No toca accounts, prospect_candidates, ni ninguna otra fuente.
 *   - No llama a ningún proveedor ni a ninguna API: sólo lee archivos locales.
 *   - No crea candidatos ni cuentas. No es validación fiscal.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import {
  AR_RNS_SOURCE_KEY,
  accumulateAward,
  buildArRnsSnapshotRow,
  isLegalEntityCuit,
  isSiproLegalEntity,
  normalizeCuit,
  percentileScores,
  readRnsPrincipalActivity,
  type ArRnsSnapshotRow,
  type ProcurementAccumulator,
  type RnsPrincipalActivity,
} from '../../src/server/source-catalog/connectors/rns-argentina/ar-rns-snapshot-builder';
import { resolveArActivityMacro } from '../../src/server/prospect-batches/country-source-discovery/ar-rns-macro-table';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 500;

type Config = {
  rns: string;
  sipro: string;
  awards: string;
  apply: boolean;
  year: number;
  /** Incluye a las inscriptas en SIPRO que nunca ganaron una adjudicación. */
  includeSiproOnly: boolean;
};

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const rns = value('rns');
  const sipro = value('sipro');
  const awards = value('awards');
  if (!rns || !sipro || !awards) {
    throw new Error('config_invalid: faltan --rns=<csv> --sipro=<csv> --awards=<csv>');
  }
  const year = Number(value('year') ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year)) throw new Error('config_invalid: --year debe ser un entero');
  return {
    rns,
    sipro,
    awards,
    apply: argv.includes('--apply'),
    year,
    includeSiproOnly: argv.includes('--include-sipro-only'),
  };
}

async function readSiproCuits(path: string): Promise<Set<string>> {
  const cuits = new Set<string>();
  for await (const row of readCsvFile(path)) {
    if (!isSiproLegalEntity(row['Tipo_de_Personeria'])) continue;
    const cuit = normalizeCuit(row['CUIT_NIT']);
    if (cuit !== null && isLegalEntityCuit(cuit)) cuits.add(cuit);
  }
  return cuits;
}

async function readAwards(path: string): Promise<Map<string, ProcurementAccumulator>> {
  const byCuit = new Map<string, ProcurementAccumulator>();
  for await (const row of readCsvFile(path)) {
    const cuit = normalizeCuit(row['CUIT']);
    if (cuit === null || !isLegalEntityCuit(cuit)) continue;
    const year = Number.parseInt((row['Ejercicio'] ?? '').trim(), 10);
    byCuit.set(
      cuit,
      accumulateAward(byCuit.get(cuit), {
        amount: Number((row['Monto'] ?? '').trim()),
        currency: row['Moneda'] ?? '',
        year: Number.isInteger(year) ? year : null,
      }),
    );
  }
  return byCuit;
}

async function readRnsActivities(
  path: string,
  suppliers: ReadonlySet<string>,
): Promise<{ activities: Map<string, RnsPrincipalActivity>; rowsRead: number }> {
  const activities = new Map<string, RnsPrincipalActivity>();
  let rowsRead = 0;
  for await (const row of readCsvFile(path)) {
    rowsRead++;
    const activity = readRnsPrincipalActivity(row);
    if (activity !== null && suppliers.has(activity.cuit)) activities.set(activity.cuit, activity);
  }
  return { activities, rowsRead };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`AR RNS ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const sipro = await readSiproCuits(config.sipro);
  const awards = await readAwards(config.awards);
  // Por defecto sólo las que HAN GANADO alguna adjudicación (igual que República
  // Dominicana, donde do_dgcp es de contratos). Las inscriptas en SIPRO que nunca
  // ganaron son ~80 % del total y una señal más débil de empresa operativa.
  const suppliers = new Set<string>(
    config.includeSiproOnly ? [...sipro, ...awards.keys()] : awards.keys(),
  );
  console.log(
    `  SIPRO personas jurídicas: ${sipro.size} · con adjudicaciones: ${awards.size} · ` +
      `a cargar (${config.includeSiproOnly ? 'unión' : 'sólo con adjudicaciones'}): ${suppliers.size}`,
  );

  const { activities, rowsRead } = await readRnsActivities(config.rns, suppliers);
  console.log(`  RNS filas leídas: ${rowsRead} · proveedoras con actividad principal activa: ${activities.size}`);

  const ordered = [...activities.values()].sort((a, b) => a.cuit.localeCompare(b.cuit));
  const totals = ordered.map((activity) => awards.get(activity.cuit)?.totalArs ?? 0);
  const scores = percentileScores(totals);
  const importedAt = new Date().toISOString();

  const rows: ArRnsSnapshotRow[] = ordered.map((activity, index) =>
    buildArRnsSnapshotRow({
      activity,
      procurement: awards.get(activity.cuit) ?? null,
      inSipro: sipro.has(activity.cuit),
      priorityScore: scores[index],
      sourceYear: config.year,
      importedAt,
    }),
  );

  const perMacro = new Map<string, number>();
  for (const activity of ordered) {
    const macro = resolveArActivityMacro(activity.activityCode) ?? '(sin macro)';
    perMacro.set(macro, (perMacro.get(macro) ?? 0) + 1);
  }
  console.log('  Por macro industria:');
  for (const [macro, count] of [...perMacro].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${macro.padEnd(46)} ${count}`);
  }
  console.log(`  Filas a escribir: ${rows.length} · con identidad de registro: ${rows.filter((r) => r.record_identity_key !== null).length}`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: AR_RNS_SOURCE_KEY,
    countryCode: 'AR',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  const client = createClient(url, key);

  const writable = rows.filter((row) => row.record_identity_key !== null);
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
