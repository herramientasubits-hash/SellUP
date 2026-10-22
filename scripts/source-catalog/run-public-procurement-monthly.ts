/**
 * Compras públicas — RECARGA MENSUAL de todos los países cargados (AGENT1-SUPPLIER-RELOAD-1).
 *
 * Recorre los países del registro y, para cada uno, corre el cargador genérico
 * (`run-public-procurement-load.ts`) con el mes final que toca según su cadencia
 * (`countries/reload-plan.ts`). Si ese mes aún no está publicado, prueba uno o dos antes. Un
 * país que falla no detiene a los demás: los datos de ese país quedan como estaban.
 *
 * Uso:
 *   # Ver qué tan viejos están los datos en Prod (SÓLO LECTURA):
 *   npx tsx scripts/source-catalog/run-public-procurement-monthly.ts --check --env-dir <carpeta con .env.local>
 *
 *   # Ensayo (DRY-RUN por defecto: baja, resume y deja NDJSON local; NO escribe):
 *   npx tsx scripts/source-catalog/run-public-procurement-monthly.ts [--countries CL,PE] [--env-dir …]
 *
 *   # Escritura REAL (sólo con autorización explícita de la dueña):
 *   SELLUP_ALLOW_LARGE_SOURCE_IMPORT=true \
 *   npx tsx scripts/source-catalog/run-public-procurement-monthly.ts --apply --env-dir <carpeta con .env.local>
 *
 * Con `--apply`, cada país se escribe con su propio `SELLUP_CONFIRMED_SOURCE_KEY` (la misma
 * compuerta del cargador de un país). México: si el CSV del año en curso no está o tiene más
 * de 35 días, se avisa dónde bajarlo y se salta. Deja un informe en
 * ~/Documents/SellUp-data/public-procurement/recarga-<fecha>.json.
 */

import { loadEnvConfig } from '@next/env';
const envDirIndex = process.argv.indexOf('--env-dir');
const envDir = envDirIndex >= 0 && process.argv[envDirIndex + 1] ? process.argv[envDirIndex + 1] : process.cwd();
loadEnvConfig(envDir);

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { PROCUREMENT_LOADERS } from '../../src/server/prospect-batches/supplier-search/countries/loaders';
import { PROCUREMENT_LINKS_TABLE } from '../../src/server/prospect-batches/supplier-search/countries/loaded-lookups.server';
import {
  formatYearMonth,
  isManualFileStale,
  isNotYetPublished,
  isProcurementDataStale,
  planCountryReload,
} from '../../src/server/prospect-batches/supplier-search/countries/reload-plan';

type CountryResult = { country: string; status: 'reloaded' | 'dry_run' | 'skipped' | 'failed'; end: string | null; detail: string };

const DATA_DIR = join(homedir(), 'Documents', 'SellUp-data', 'public-procurement');
const LOADER_SCRIPT = join(__dirname, 'run-public-procurement-load.ts');

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured (usa --env-dir)');
  ensureNode20WebSocketShim();
  return createClient(url, key);
}

/** `--check`: ventana y fecha de carga por país, y cuáles están viejos. Sólo lectura. */
async function check(countries: string[], today: Date): Promise<void> {
  const client = serviceClient();
  // AGENT1-SUPPLIER-RELOAD-1 — la frescura se mide por la ÚLTIMA ORDEN cargada, no por el fin
  // de la ventana: Argentina (21-10) recargó con ventana hasta 2026-09-30, pero su fuente sólo
  // tenía órdenes hasta el 2026-07-09 (publica por semestre).
  console.log('País · última orden · fin de la ventana · cargado · estado');
  for (const country of countries) {
    const sourceKey = PROCUREMENT_LOADERS[country].country.sourceKey;
    const rows = (columns: string) =>
      client.from(PROCUREMENT_LINKS_TABLE).select(columns).eq('country_code', country).eq('source_key', sourceKey);
    const [lastOrder, window] = await Promise.all([
      rows('last_order_on').not('last_order_on', 'is', null).order('last_order_on', { ascending: false }).limit(1),
      rows('window_end, loaded_at').order('window_end', { ascending: false }).limit(1),
    ]);
    const error = lastOrder.error ?? window.error;
    if (error) {
      console.log(`${country} · error: ${error.message}`);
      continue;
    }
    const row = (window.data ?? [])[0] as unknown as { window_end: string; loaded_at: string } | undefined;
    if (!row) {
      console.log(`${country} · sin carga`);
      continue;
    }
    const last = ((lastOrder.data ?? [])[0] as unknown as { last_order_on: string } | undefined)?.last_order_on ?? null;
    const stale = isProcurementDataStale(country, last ?? row.window_end, today);
    const status = !stale ? 'al día' : last && last < row.window_end ? 'VIEJO: la fuente no publicó meses nuevos' : 'VIEJO: recargar';
    console.log(`${country} · ${last ?? '—'} · ${row.window_end} · ${row.loaded_at.slice(0, 10)} · ${status}`);
  }
}

function runLoader(country: string, end: string, months: number, apply: boolean): { ok: boolean; output: string } {
  const args = ['tsx', LOADER_SCRIPT, '--country', country, '--end', end, '--months', String(months)];
  if (apply) args.push('--apply');
  if (envDirIndex >= 0) args.push('--env-dir', envDir);
  const sourceKey = PROCUREMENT_LOADERS[country].country.sourceKey;
  const result = spawnSync('npx', args, {
    encoding: 'utf8',
    // Cada país pasa por SU compuerta: la confirmación es de su fuente y de nadie más.
    env: apply ? { ...process.env, SELLUP_CONFIRMED_SOURCE_KEY: sourceKey } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { ok: result.status === 0, output };
}

async function main(): Promise<void> {
  const today = new Date();
  const apply = process.argv.includes('--apply');
  const requested = (arg('--countries') ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const countries = (requested.length > 0 ? requested : Object.keys(PROCUREMENT_LOADERS)).filter((c) => {
    if (PROCUREMENT_LOADERS[c]) return true;
    console.log(`${c}: no es un país cargado; se salta.`);
    return false;
  });

  if (process.argv.includes('--check')) {
    await check(countries, today);
    return;
  }

  console.log(`RECARGA MENSUAL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'} · ${countries.join(', ')}`);
  const results: CountryResult[] = [];
  for (const country of countries) {
    const plan = planCountryReload(country, today);
    if (!plan) {
      results.push({ country, status: 'skipped', end: null, detail: 'sin cadencia definida' });
      continue;
    }
    if (plan.manual) {
      const file = join(DATA_DIR, country.toLowerCase(), plan.manual.fileName);
      if (!existsSync(file) || isManualFileStale(statSync(file).mtime, today, plan.manual.maxFileAgeDays)) {
        results.push({
          country,
          status: 'skipped',
          end: null,
          detail: `falta un ${plan.manual.fileName} reciente: bájalo a mano desde ${plan.manual.downloadPage} y déjalo en ${file}`,
        });
        continue;
      }
    }
    let done: CountryResult | null = null;
    for (const end of plan.ends) {
      const label = formatYearMonth(end);
      console.log(`\n── ${country} hasta ${label}`);
      const run = runLoader(country, label, plan.months, apply);
      if (run.ok) {
        done = { country, status: apply ? 'reloaded' : 'dry_run', end: label, detail: 'ok' };
        break;
      }
      if (!isNotYetPublished(run.output)) {
        done = { country, status: 'failed', end: label, detail: run.output.trim().split('\n').slice(-1)[0] ?? 'error' };
        break;
      }
      console.log(`   ${label} aún no está publicado; se prueba un mes antes.`);
    }
    results.push(done ?? { country, status: 'skipped', end: null, detail: 'ningún mes publicado en la ventana de prueba' });
  }

  console.log('\nResumen');
  for (const r of results) console.log(`  ${r.country} · ${r.status} · ${r.end ?? '—'} · ${r.detail}`);
  mkdirSync(DATA_DIR, { recursive: true });
  const report = join(DATA_DIR, `recarga-${today.toISOString().slice(0, 10)}${apply ? '' : '-dry-run'}.json`);
  writeFileSync(report, `${JSON.stringify({ at: today.toISOString(), apply, results }, null, 2)}\n`);
  console.log(`Informe: ${report}`);
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
