/**
 * ES — web por nombre de las empresas de la capa gratuita (SOURCES-ES-WEBS-1)
 *
 * Lee las filas de `es_free_directory` que volcó el ETL (`run-es-sources-etl.ts
 * --dump-dir=…`, fichero `directory.jsonl`) y, por cada empresa SIN web (las primeras
 * de cada industria, `--per-macro=`, 200 por defecto), prueba las direcciones que salen de sus nombres
 * (`spainCompanyWebCandidates`). Una dirección sólo vale si su propia página nombra a
 * la empresa (`spainCompanyWebVerdict`). Escribe un JSONL local `{ nif, domain, check }`
 * que el ETL lee con `--web-map=`.
 *
 * NO escribe en la base de datos ni usa proveedores de pago: sólo descarga la página
 * de inicio de cada dirección candidata (sin seguir más enlaces), pocas a la vez.
 * Cada resultado se añade al momento a `--out` y a `<out>.done` (los NIF ya probados):
 * si se corta, se relanza igual y sigue donde iba.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/discover-es-company-webs.mts \
 *     --dump=<dump-dir>/directory.jsonl --in-dir=<salidas del extractor> --out=<webs.jsonl> [--per-macro=200]
 *   node --import tsx scripts/source-catalog/discover-es-company-webs.mts --recheck=<webs.jsonl> --in-dir=… --out=<webs2.jsonl>
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  spainCompanyWebCandidates,
  spainCompanyWebVerdict,
  type EsFetchedPage,
} from '../../src/server/source-catalog/connectors/placsp-spain/es-company-web';

const TIMEOUT_MS = 5_000;
const CONCURRENCY = 10;
/** Terminaciones probadas aquí (las más probables): `.eu` y `.net` casi nunca son la web. */
const TLDS_TRIED = new Set(['es', 'com']);
const MAX_HTML_BYTES = 400_000;
/** Nombres distintos por empresa que se prueban como mucho. */
const MAX_NAMES = 3;

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Nombres publicados por NIF en las entradas del extractor, del más publicado al menos. */
function namesByNif(inDir: string): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  const add = (nif: unknown, name: unknown, n: number): void => {
    if (typeof nif !== 'string' || typeof name !== 'string' || name.trim() === '') return;
    const m = counts.get(nif) ?? new Map<string, number>();
    m.set(name.trim(), (m.get(name.trim()) ?? 0) + n);
    counts.set(nif, m);
  };
  for (const file of ['es_awardees.jsonl', 'es_bdns.jsonl']) {
    for (const row of readJsonl(join(inDir, file))) {
      for (const [name, n] of Object.entries((row['names'] as Record<string, number>) ?? {})) add(row['nif'], name, n);
    }
  }
  for (const file of ['es_invente.jsonl', 'es_bde.jsonl']) {
    for (const row of readJsonl(join(inDir, file))) add(row['nif'], row['name'], 1_000);
  }
  return new Map([...counts].map(([nif, m]) => [nif, [...m].sort((a, b) => b[1] - a[1]).map(([name]) => name)]));
}

function pageText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20_000);
  return { title, text };
}

function isBotWall(status: number, title: string | null): boolean {
  const t = (title ?? '').toLowerCase();
  return t.includes('attention required') || t.includes('just a moment') || ((status === 403 || status === 503) && t.includes('cloudflare'));
}

async function fetchPage(host: string): Promise<EsFetchedPage> {
  for (const scheme of ['https', 'http']) {
    try {
      const response = await fetch(`${scheme}://${host}/`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (SellUp source verification)', Accept: 'text/html' },
      });
      const html = (await response.text()).slice(0, MAX_HTML_BYTES);
      const { title, text } = pageText(html);
      const blocked = isBotWall(response.status, title);
      return { host, finalHost: new URL(response.url).hostname, status: response.status, blocked, title, text: response.ok || blocked ? text : null };
    } catch (error: unknown) {
      // Dominio que no existe: no tiene sentido probar http.
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') break;
      // TLS o tiempo: se prueba http y si no, sin respuesta.
    }
  }
  return { host, finalHost: null, status: null, blocked: false, title: null, text: null };
}

/**
 * `--recheck=<webs.jsonl>`: vuelve a comprobar con las reglas de HOY sólo las webs ya
 * halladas (una visita a la portada cada una) y escribe las que siguen valiendo en `--out`.
 */
async function recheck(previousPath: string, inDir: string, outFile: string): Promise<void> {
  const previous = readJsonl(previousPath);
  const names = namesByNif(inDir);
  const tally = new Map<string, number>();
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const row = previous[next++];
      if (row === undefined) return;
      const nif = String(row['nif']);
      const legalName = String(row['legal_name']);
      const candidateNames = [...new Set([legalName, ...(names.get(nif) ?? [])])].slice(0, MAX_NAMES);
      const verdict = spainCompanyWebVerdict(await fetchPage(String(row['requested'])), candidateNames, { nif });
      const key = 'domain' in verdict ? verdict.check : `rejected:${verdict.rejected}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if ('domain' in verdict) {
        appendFileSync(outFile, `${JSON.stringify({ nif, legal_name: legalName, domain: verdict.domain, check: verdict.check, matched_key: verdict.matchedKey, requested: row['requested'] })}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Recomprobadas ${previous.length}: ${JSON.stringify(Object.fromEntries(tally))} → ${outFile}`);
}

async function main(): Promise<void> {
  const previous = arg('recheck');
  if (previous !== null) {
    const inDirArg = arg('in-dir');
    const outArg = arg('out');
    if (!inDirArg || !outArg) throw new Error('config_invalid: --recheck exige --in-dir= y --out=');
    await recheck(previous, inDirArg, outArg);
    return;
  }
  const dump = arg('dump');
  const inDir = arg('in-dir');
  const out = arg('out');
  if (!dump || !inDir || !out) throw new Error('config_invalid: faltan --dump=, --in-dir= y --out=');
  const outFile: string = out;
  // Las primeras de CADA industria: son las que lee una corrida (200 por consulta).
  const perMacro = Number(arg('per-macro') ?? 200);
  const byMacro = new Map<string, Record<string, unknown>[]>();
  for (const row of readJsonl(dump)) {
    const macro = String((row['raw_data'] as Record<string, unknown>)['macro_industry_key']);
    byMacro.set(macro, [...(byMacro.get(macro) ?? []), row]);
  }
  const rows = [...byMacro.values()].flatMap((list) =>
    list
      .sort((a, b) => Number(b['priority_score']) - Number(a['priority_score']) || String(a['record_identity_key']).localeCompare(String(b['record_identity_key'])))
      .slice(0, perMacro)
      .filter((row) => (row['raw_data'] as Record<string, unknown>)['website_domain'] === undefined),
  );
  const names = namesByNif(inDir);
  const donePath = `${outFile}.done`;
  const already = new Set(existsSync(donePath) ? readFileSync(donePath, 'utf8').split('\n').filter(Boolean) : []);
  const pending = rows.filter((row) => !already.has(String(row['tax_id'])));
  console.log(`Sin web: ${rows.length} (las ${perMacro} primeras de cada industria); ya probadas ${already.size}; quedan ${pending.length}`);

  const tally = new Map<string, number>();
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const row = pending[next++];
      if (row === undefined) return;
      const nif = String(row['tax_id']);
      const legalName = String(row['legal_name']);
      const candidateNames = [...new Set([legalName, ...(names.get(nif) ?? [])])].slice(0, MAX_NAMES);
      let found: { domain: string; check: string; matchedKey: string; host: string } | null = null;
      for (const host of spainCompanyWebCandidates(candidateNames).filter((h) => TLDS_TRIED.has(h.split('.').pop() ?? ''))) {
        const verdict = spainCompanyWebVerdict(await fetchPage(host), candidateNames, { nif });
        if ('domain' in verdict) {
          found = { ...verdict, host };
          break;
        }
      }
      const key = found ? found.check : 'not_found';
      tally.set(key, (tally.get(key) ?? 0) + 1);
      if (found) {
        appendFileSync(outFile, `${JSON.stringify({ nif, legal_name: legalName, domain: found.domain, check: found.check, matched_key: found.matchedKey, requested: found.host })}\n`);
      }
      appendFileSync(donePath, `${nif}\n`);
      if (++done % 100 === 0) console.log(`  … ${done}/${pending.length} ${JSON.stringify(Object.fromEntries(tally))}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Resultado: ${JSON.stringify(Object.fromEntries(tally))} → ${outFile}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
