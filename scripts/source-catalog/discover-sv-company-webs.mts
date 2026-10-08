/**
 * SV — web de las empresas de la capa gratuita por su nombre (SOURCES-SV-COMPANY-WEB-1)
 *
 * Arma la capa gratuita de empresas igual que el ETL (`run-sv-sources-etl.ts`) y, por
 * cada empresa, prueba las direcciones que salen de su razón social y de su nombre
 * comercial de COMPRASAL (`svCompanyWebCandidates`). Una dirección sólo vale si su
 * propia página nombra a la empresa (`svCompanyWebVerdict`). Escribe un JSONL local
 * `{ nit, domain, check, tried }` que el ETL lee con `--web-map=`.
 *
 * NO escribe en la base de datos ni usa proveedores de pago: sólo descarga la página
 * de inicio de cada dirección candidata (sin seguir más enlaces).
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/discover-sv-company-webs.mts --in-dir=<salidas del extractor> --out=<webs.jsonl>
 *   … --from-prod --out=<webs.jsonl>        (lee las filas ya cargadas de sv_comprasal_directory; SÓLO LECTURA)
 *   … --from-prod --apply --confirm --web-map=<webs.jsonl>
 *       (sólo con autorización de la dueña: añade website_domain / website_origin /
 *        website_check al raw_data de ESAS filas, por id; no toca nada más)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  aggregateSvComprasalSuppliers,
  buildSvComprasalDirectoryRows,
  buildSvRegistryAndAliasRows,
  parseSvComprasalAward,
  parseSvCompanyWebLine,
  parseSvTaxListEntry,
  SV_COMPRASAL_DIRECTORY_SOURCE_KEY,
  type SvComprasalAward,
} from '../../src/server/source-catalog/connectors/sv-official-sources/sv-sources-rows';
import {
  svCompanyWebCandidates,
  svCompanyWebVerdict,
  svExtractPageText,
  svIsBotWall,
  type SvCompanyNames,
  type SvFetchedPage,
} from '../../src/server/source-catalog/connectors/sv-official-sources/sv-company-web';

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

async function fetchPage(host: string): Promise<SvFetchedPage> {
  for (const scheme of ['https', 'http']) {
    try {
      const response = await fetch(`${scheme}://${host}/`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (SellUp source verification)', Accept: 'text/html' },
      });
      const html = (await response.text()).slice(0, MAX_HTML_BYTES);
      const { title, text } = svExtractPageText(html);
      return {
        host,
        finalHost: new URL(response.url).hostname,
        status: response.status,
        blocked: svIsBotWall(response.status, title),
        title,
        text: response.ok || svIsBotWall(response.status, title) ? text : null,
      };
    } catch {
      // DNS, TLS o tiempo: se prueba http y si no, sin respuesta.
    }
  }
  return { host, finalHost: null, status: null, blocked: false, title: null, text: null };
}

/** Una empresa a buscar: su NIT y los nombres de los que salen las direcciones. */
type Target = { id: string | null; nit: string; legalName: string; names: SvCompanyNames; rawData: Record<string, unknown> | null };

function prodClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  return createClient(url, key);
}

async function targetsFromProd(client: SupabaseClient): Promise<Target[]> {
  const { data, error } = await client
    .from('source_company_snapshots')
    .select('id, normalized_tax_id, legal_name, raw_data, priority_score')
    .eq('source_key', SV_COMPRASAL_DIRECTORY_SOURCE_KEY)
    .eq('country_code', 'SV')
    .order('priority_score', { ascending: false })
    .limit(1000);
  if (error) throw new Error(`read_failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const raw = (row.raw_data ?? {}) as Record<string, unknown>;
    const trade = typeof raw['trade_name'] === 'string' ? [raw['trade_name']] : [];
    return { id: row.id as string, nit: row.normalized_tax_id as string, legalName: row.legal_name as string, names: { legal: [row.legal_name as string], trade }, rawData: raw };
  });
}

function targetsFromFiles(inDir: string): Target[] {
  if (!inDir) throw new Error('config_invalid: falta --in-dir= (o usa --from-prod)');
  const entries = readJsonl(join(inDir, 'sv_tax_lists.jsonl')).map(parseSvTaxListEntry).filter((e) => e !== null);
  const awards = readJsonl(join(inDir, 'sv_comprasal_awards.jsonl'))
    .map(parseSvComprasalAward)
    .filter((a): a is SvComprasalAward => a !== null);
  const { registryRows, aliasRows } = buildSvRegistryAndAliasRows(entries, { importedAt: 'x' });
  const { rows, supplierByNit } = buildSvComprasalDirectoryRows({
    suppliers: aggregateSvComprasalSuppliers(awards),
    registryRows,
    aliasRows,
    importedAt: 'x',
  });
  return rows.map((row) => {
    const supplier = supplierByNit.get(row.tax_id!)!;
    return {
      id: null,
      nit: row.tax_id!,
      legalName: row.legal_name,
      names: { legal: [row.legal_name, ...Object.keys(supplier.names)], trade: Object.keys(supplier.tradeNames) },
      rawData: null,
    };
  });
}

/** Añade la web comprobada al raw_data de las filas ya cargadas (por id). */
async function applyWebs(client: SupabaseClient, targets: readonly Target[], webMap: string): Promise<void> {
  const webs = new Map(readJsonl(webMap).map(parseSvCompanyWebLine).filter((l) => l !== null).map((l) => [l.nit, l.web] as const));
  let updated = 0;
  for (const target of targets) {
    const web = webs.get(target.nit);
    if (!web || target.id === null || target.rawData === null || target.rawData['website_domain'] !== undefined) continue;
    const rawData = { ...target.rawData, website_domain: web.domain, website_origin: 'name_domain_verified', website_check: web.check };
    const { error } = await client
      .from('source_company_snapshots')
      .update({ raw_data: rawData })
      .eq('id', target.id)
      .eq('source_key', SV_COMPRASAL_DIRECTORY_SOURCE_KEY);
    if (error) throw new Error(`update_failed_${target.nit}: ${error.message}`);
    updated++;
  }
  console.log(`  rowsUpdated (${SV_COMPRASAL_DIRECTORY_SOURCE_KEY}, web) = ${updated}`);
}

async function main(): Promise<void> {
  const fromProd = process.argv.includes('--from-prod');
  const inDir = arg('in-dir');
  const out = arg('out');
  const apply = process.argv.includes('--apply');
  if (apply && (!process.argv.includes('--confirm') || !fromProd || !arg('web-map'))) {
    throw new Error('config_invalid: --apply exige --from-prod, --web-map= y --confirm (autorización de la dueña)');
  }
  const client = fromProd ? prodClient() : null;
  const targets = client !== null ? await targetsFromProd(client) : targetsFromFiles(inDir ?? '');
  console.log(`Empresas de la capa gratuita: ${targets.length}`);
  if (apply) {
    await applyWebs(client!, targets, arg('web-map')!);
    return;
  }
  if (!out) throw new Error('config_invalid: falta --out=');

  const lines: string[] = [];
  const tally = new Map<string, number>();
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const row = targets[next++];
      if (row === undefined) return;
      const names = row.names;
      let found: { domain: string; check: string; matchedKey: string; host: string } | null = null;
      const tried: string[] = [];
      for (const host of svCompanyWebCandidates([...names.legal, ...names.trade])) {
        tried.push(host);
        const verdict = svCompanyWebVerdict(await fetchPage(host), names);
        if ('domain' in verdict) {
          found = { ...verdict, host };
          break;
        }
      }
      tally.set(found ? found.check : 'not_found', (tally.get(found ? found.check : 'not_found') ?? 0) + 1);
      if (found) {
        lines.push(JSON.stringify({ nit: row.nit, legal_name: row.legalName, domain: found.domain, check: found.check, matched_key: found.matchedKey, requested: found.host, tried: tried.length }));
        console.log(`  ✔ ${row.legalName} → ${found.domain} (${found.check}, «${found.matchedKey}», pedida ${found.host})`);
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
