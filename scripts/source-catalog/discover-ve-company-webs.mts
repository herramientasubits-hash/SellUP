/**
 * VE — web por nombre de las entidades de la capa gratuita (SOURCES-VE-CLOSE-1)
 *
 * Arma la capa gratuita igual que el ETL (`run-ve-sources-etl.ts`) y, por cada
 * entidad con RIF que llega SIN web (sobre todo las reguladas de la SUDEASEG y la
 * SUNAVAL), prueba las direcciones que salen de sus nombres (`veCompanyWebCandidates`).
 * Una dirección sólo vale si su propia página nombra a la entidad
 * (`veCompanyWebVerdict`). Escribe un JSONL local `{ rif, domain, check }` que el ETL
 * lee con `--web-map=`.
 *
 * NO escribe en la base de datos ni usa proveedores de pago: sólo descarga la página
 * de inicio de cada dirección candidata (sin seguir más enlaces), pocas a la vez.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/discover-ve-company-webs.mts --dir=<salidas del extractor> --out=<webs.jsonl>
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildVeFreeDirectoryRows,
  buildVeRegistryAndAliasRows,
  mergeVenezuelaRifSources,
  veAllNames,
  veWebListings,
} from '../../src/server/source-catalog/connectors/ve-sources/ve-sources-rows';
import {
  parseVeBvcIssuer,
  parseVeBvcMember,
  parseVeGleifEntity,
  parseVeSudeasegEntity,
  parseVeSunavalEntity,
} from '../../src/server/source-catalog/connectors/ve-sources/ve-sources-input';
import { VE_WEB_ENTITIES } from '../../src/server/source-catalog/connectors/ve-sources/ve-web-entities';
import { VE_PUBLIC_ENTITIES } from '../../src/server/source-catalog/connectors/ve-sources/ve-public-entities';
import {
  veCompanyWebCandidates,
  veCompanyWebVerdict,
  type VeFetchedPage,
} from '../../src/server/source-catalog/connectors/ve-sources/ve-company-web';

const TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;
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

const notNull = <T,>(value: T | null): value is T => value !== null;

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

async function fetchPage(host: string): Promise<VeFetchedPage> {
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
    } catch {
      // DNS, TLS o tiempo: se prueba http y si no, sin respuesta.
    }
  }
  return { host, finalHost: null, status: null, blocked: false, title: null, text: null };
}

async function main(): Promise<void> {
  const dir = arg('dir');
  const out = arg('out');
  if (!dir || !out) throw new Error('config_invalid: faltan --dir= y --out=');
  const bvcIssuers = readJsonl(join(dir, 've_bvc_issuers.jsonl')).map(parseVeBvcIssuer).filter(notNull);
  const bvcMembers = readJsonl(join(dir, 've_bvc_members.jsonl')).map(parseVeBvcMember).filter(notNull);
  const sudeaseg = readJsonl(join(dir, 've_sudeaseg.jsonl')).map(parseVeSudeasegEntity).filter(notNull);
  const sunaval = readJsonl(join(dir, 've_sunaval.jsonl')).map(parseVeSunavalEntity).filter(notNull);
  const gleif = readJsonl(join(dir, 've_gleif.jsonl')).map(parseVeGleifEntity).filter(notNull);
  const listings = veWebListings({ webEntities: VE_WEB_ENTITIES, publicEntities: VE_PUBLIC_ENTITIES });
  const entries = mergeVenezuelaRifSources({ bvcIssuers, bvcMembers, sudeaseg, sunaval, gleif, listings });
  const params = { sourceYear: 2026, importedAt: 'x' };
  const { registryRows, aliasRows } = buildVeRegistryAndAliasRows(entries, params);
  const { taxRows } = buildVeFreeDirectoryRows({ entries, registryRows, aliasRows, listings, ...params });
  const targets = taxRows.filter((row) => row.raw_data['website_domain'] === undefined);
  console.log(`Capa gratuita con RIF: ${taxRows.length}; sin web: ${targets.length}`);

  const lines: string[] = [];
  const tally = new Map<string, number>();
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const row = targets[next++];
      if (row === undefined) return;
      const names = veAllNames(entries.get(row.tax_id!)!);
      let found: { domain: string; check: string; matchedKey: string; host: string } | null = null;
      for (const host of veCompanyWebCandidates(names)) {
        const verdict = veCompanyWebVerdict(await fetchPage(host), names);
        if ('domain' in verdict) {
          found = { ...verdict, host };
          break;
        }
      }
      tally.set(found ? found.check : 'not_found', (tally.get(found ? found.check : 'not_found') ?? 0) + 1);
      if (found) {
        lines.push(JSON.stringify({ rif: row.tax_id, legal_name: row.legal_name, domain: found.domain, check: found.check, matched_key: found.matchedKey, requested: found.host }));
        console.log(`  ✔ ${row.legal_name} → ${found.domain} (${found.check}, «${found.matchedKey}»)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(`Resultado: ${JSON.stringify(Object.fromEntries(tally))} → ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
