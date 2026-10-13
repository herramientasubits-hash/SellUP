/**
 * UY — web de las organizaciones de la capa gratuita por su nombre (SOURCES-UY-CLOSE-1)
 *
 * Arma la capa gratuita de empresas igual que el ETL (`run-uy-sources-etl.ts`) y,
 * por cada organización sin web conocida, prueba las direcciones que salen de su
 * razón social y de sus alias del RUPE (`uyCompanyWebCandidates`). Una dirección
 * sólo vale si su propia página nombra a la organización (`uyCompanyWebVerdict`).
 * Escribe un JSONL local `{ rut, domain, check, … }` que el ETL lee con `--web-map=`.
 *
 * NO escribe en la base de datos ni usa proveedores de pago: sólo descarga la
 * página de inicio de cada dirección candidata (sin seguir más enlaces), a ritmo
 * lento y sin saltarse muros de bots. Reanudable: lo ya probado (`--out` existente)
 * no se vuelve a pedir.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/discover-uy-company-webs.mts \
 *     --rupe=<rupe-AAAA.csv> --suppliers=<suppliers.jsonl> --out=<webs.jsonl> \
 *     [--macros=technology,health_pharma]
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { parseUyArceSupplierLine } from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-arce-directory-row';
import { buildUyArceDirectory, buildUyRegistry } from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-sources-build';
import {
  uyCompanyWebCandidates,
  uyCompanyWebVerdict,
  uyExtractPageText,
  uyIsBotWall,
  type UyFetchedPage,
} from '../../src/server/source-catalog/connectors/rupe-uruguay/uy-company-web';

const TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;
const MAX_HTML_BYTES = 400_000;

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) throw new Error(`config_invalid: no existe ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}

async function fetchPage(host: string): Promise<UyFetchedPage> {
  for (const scheme of ['https', 'http']) {
    try {
      const response = await fetch(`${scheme}://${host}/`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (SellUp source verification)', Accept: 'text/html' },
      });
      const html = (await response.text()).slice(0, MAX_HTML_BYTES);
      const { title, text } = uyExtractPageText(html);
      return {
        host,
        finalHost: new URL(response.url).hostname,
        status: response.status,
        blocked: uyIsBotWall(response.status, title),
        title,
        text: response.ok || uyIsBotWall(response.status, title) ? text : null,
      };
    } catch {
      // DNS, TLS o tiempo: se prueba http y si no, sin respuesta.
    }
  }
  return { host, finalHost: null, status: null, blocked: false, title: null, text: null };
}

async function main(): Promise<void> {
  const rupe = arg('rupe');
  const suppliersPath = arg('suppliers');
  const out = arg('out');
  if (!rupe || !suppliersPath || !out) throw new Error('config_invalid: faltan --rupe=, --suppliers= u --out=');
  const macros = arg('macros')?.split(',').filter((m) => m.length > 0) ?? null;

  const records: Record<string, string>[] = [];
  for await (const record of readCsvFile(rupe, { delimiter: ';' })) records.push(record);
  const registry = buildUyRegistry(records, { sourceYear: 2026, importedAt: 'x' });
  const suppliers = readJsonl(suppliersPath).map(parseUyArceSupplierLine).filter((s) => s !== null);
  const { rows } = buildUyArceDirectory({ suppliers, registry, sourceYear: 2026, importedAt: 'x' });

  const done = new Set(existsSync(out) ? readJsonl(out).map((line) => String((line as { rut?: string }).rut)) : []);
  const aliasesByRut = new Map<string, string[]>();
  for (const alias of registry.aliasRows) {
    aliasesByRut.set(alias.tax_id, [...(aliasesByRut.get(alias.tax_id) ?? []), alias.normalized_legal_name]);
  }
  const targets = rows.filter(
    (row) => !done.has(row.tax_id) && (macros === null || macros.includes(String(row.raw_data['macro_industry_key']))),
  );
  console.log(`Capa gratuita: ${rows.length}; por probar: ${targets.length} (ya probadas: ${done.size})`);

  const tally = new Map<string, number>();
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const row = targets[next++];
      if (row === undefined) return;
      const names = [row.legal_name, ...(aliasesByRut.get(row.tax_id) ?? [])];
      let found: { domain: string; check: string; matchedKey: string; host: string } | null = null;
      let tried = 0;
      for (const host of uyCompanyWebCandidates(names)) {
        tried++;
        const verdict = uyCompanyWebVerdict(await fetchPage(host), names);
        if ('domain' in verdict) {
          found = { ...verdict, host };
          break;
        }
      }
      const outcome = found ? found.check : 'not_found';
      tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
      appendFileSync(
        out!,
        `${JSON.stringify({
          rut: row.tax_id,
          legal_name: row.legal_name,
          macro: row.raw_data['macro_industry_key'],
          domain: found?.domain ?? null,
          check: found?.check ?? null,
          matched_key: found?.matchedKey ?? null,
          requested: found?.host ?? null,
          tried,
        })}\n`,
      );
      if (found) console.log(`  ✔ ${row.legal_name} → ${found.domain} («${found.matchedKey}», pedida ${found.host})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Resultado: ${JSON.stringify(Object.fromEntries(tally))} → ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
