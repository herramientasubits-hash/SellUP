/**
 * CL SII — ETL de la Nómina de personas jurídicas del SII (SOURCES-CL-SII-REGISTRY-1)
 *
 * Carga en `source_company_snapshots` (source_key='cl_sii_registry') las personas
 * jurídicas chilenas SIN término de giro, con filas MÍNIMAS (RUT, razón social,
 * núcleo del nombre, subtipo) y, cuando el SII las publica, sus métricas del año
 * comercial (trabajadores dependientes informados, tramo según ventas, actividad).
 *
 *   --dir=<carpeta> con los archivos descomprimidos de
 *     https://www.sii.cl/sobre_el_sii/nominapersonasjuridicas.html:
 *       PUB_NOMBRES_PJ.txt, PUB_NOM_ACTECOS.txt y PUB_EMPRESAS_PJ_<año>.txt
 *   --metrics-year=<año> (por defecto 2024)
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-cl-sii-registry-etl.ts --dir=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña; ~1,7 M filas ⇒ la
 * valla anti-cargas masivas exige SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true y
 * SELLUP_CONFIRMED_SOURCE_KEY=cl_sii_registry):
 *   npx tsx scripts/source-catalog/run-cl-sii-registry-etl.ts --dir=… --apply
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'cl_sii_registry'; `assertLargeImportAllowed` antes de escribir; sólo lee
 * archivos locales. Reanudable con --offset.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildClSiiRegistryRow,
  CL_SII_REGISTRY_SOURCE_KEY,
  parseClSiiActivityLine,
  parseClSiiCompanyLine,
  parseClSiiNamesLine,
  type ClSiiMetrics,
  type ClSiiRegistryRow,
} from '../../src/server/source-catalog/connectors/sii-chile/cl-sii-registry-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const UPSERT_CHUNK = 1000;

type Config = { dir: string; apply: boolean; metricsYear: number; offset: number };

function parseArgs(argv: readonly string[]): Config {
  const value = (name: string): string | null => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const dir = value('dir');
  if (!dir) throw new Error('config_invalid: falta --dir=<carpeta con los archivos del SII>');
  const metricsYear = Number(value('metrics-year') ?? 2024);
  const offset = Number(value('offset') ?? 0);
  if (!Number.isInteger(metricsYear) || !Number.isInteger(offset) || offset < 0) {
    throw new Error('config_invalid: --metrics-year y --offset deben ser enteros (offset ≥ 0)');
  }
  return { dir, apply: argv.includes('--apply'), metricsYear, offset };
}

async function* lines(path: string): AsyncGenerator<string> {
  if (!existsSync(path)) throw new Error(`config_invalid: falta ${path}`);
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let first = true;
  for await (const line of reader) {
    if (first) {
      first = false; // cabecera
      continue;
    }
    yield line;
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  console.log(`CL SII REGISTRY ETL — ${config.apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);
  const importedAt = new Date().toISOString();

  const metrics = new Map<string, ClSiiMetrics>();
  for await (const line of lines(join(config.dir, `PUB_EMPRESAS_PJ_${config.metricsYear}.txt`))) {
    const parsed = parseClSiiCompanyLine(line);
    if (parsed !== null) metrics.set(parsed[0], parsed[1]);
  }

  // Código de actividad: el que coincide con la actividad del año de métricas; si no, el primero.
  const activityCodes = new Map<string, string>();
  const matchedActivity = new Set<string>();
  for await (const line of lines(join(config.dir, 'PUB_NOM_ACTECOS.txt'))) {
    const parsed = parseClSiiActivityLine(line);
    if (parsed === null) continue;
    const [rut, code] = parsed;
    if (matchedActivity.has(rut)) continue;
    const description = line.split('\t')[3]?.replace(/\s+/g, ' ').trim().toUpperCase() ?? '';
    const wanted = metrics.get(rut)?.activity?.toUpperCase() ?? null;
    if (wanted !== null && description === wanted) {
      activityCodes.set(rut, code);
      matchedActivity.add(rut);
    } else if (!activityCodes.has(rut)) {
      activityCodes.set(rut, code);
    }
  }

  const rows: ClSiiRegistryRow[] = [];
  let namesRead = 0;
  for await (const line of lines(join(config.dir, 'PUB_NOMBRES_PJ.txt'))) {
    namesRead++;
    const record = parseClSiiNamesLine(line);
    if (record === null) continue;
    const row = buildClSiiRegistryRow(record, metrics.get(record.rut) ?? null, activityCodes.get(record.rut) ?? null, {
      sourceYear: config.metricsYear,
      importedAt,
    });
    if (row !== null && row.record_identity_key !== null) rows.push(row);
  }

  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;
  const withWorkers = rows.filter((row) => typeof row.raw_data.workers === 'number').length;
  const big = rows.filter((row) => typeof row.raw_data.workers === 'number' && (row.raw_data.workers as number) >= 200).length;
  const bytes = rows.reduce((sum, row) => sum + JSON.stringify(row).length, 0);

  console.log(`  Nombres leídos: ${namesRead} · métricas ${config.metricsYear}: ${metrics.size} · actividades: ${activityCodes.size}`);
  console.log(`  Personas jurídicas activas cargables: ${rows.length}`);
  console.log(`  Con nombre único (RUT asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);
  console.log(`  Con trabajadores informados: ${withWorkers} · con 200 o más: ${big}`);
  console.log(`  Tamaño JSON aproximado: ${(bytes / 1024 / 1024).toFixed(0)} MB (${Math.round(bytes / Math.max(rows.length, 1))} B/fila)`);

  if (!config.apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: CL_SII_REGISTRY_SOURCE_KEY,
    countryCode: 'CL',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  let upserted = 0;
  for (let i = config.offset; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
    if ((i / UPSERT_CHUNK) % 100 === 0) console.log(`  … ${i + chunk.length}/${rows.length}`);
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
