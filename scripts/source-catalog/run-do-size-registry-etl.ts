/**
 * DO — ETL de señal de tamaño y nombre comercial (SOURCES-DO-SIZE-SIGNAL-1)
 *
 * Carga en `source_company_snapshots` dos fuentes derivadas para República
 * Dominicana:
 *
 *   do_dgii_size_registry        base del buscador gratuito por industria
 *                                (empresas activas con actividad de la tabla
 *                                aprobada y señal de tamaño DGII o DGCP).
 *   do_dgii_trade_name_registry  RNC por nombre comercial (sólo pistas).
 *
 * Entradas:
 *   --gc-nacionales=<html>  página DGII «Grandes Contribuyentes Nacionales».
 *   --gc-locales=<html>     página DGII «Grandes Locales y Medianos» (VerLista?doc=GCL-…).
 *   El padrón DGII (rd_dgii_bulk) y las compras públicas (do_dgcp) se LEEN de la
 *   base, por RNC y en orden estable; nunca se modifican.
 *   --dgcp-proveedores=<csv>  OPCIONAL (SOURCES-DO-DGCP-DOMAIN-1): «Proveedores.csv» de
 *                           datosabiertos.dgcp.gob.do (api-dgcp/v1/tablas/proveedores?Type=csv).
 *                           Da el dominio corporativo de cada empresa a partir de sus
 *                           correos, sólo si se parece a su razón social. Sólo se guarda
 *                           el dominio: nunca correos, contactos ni teléfonos.
 *   --only=size | trade-name   (por defecto, las dos)
 *
 * Uso (DRY-RUN por defecto: lee, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-do-size-registry-etl.ts --gc-nacionales=… --gc-locales=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña): añadir --apply.
 *
 * Guardrails: dry-run por defecto; `--apply` REEMPLAZA sólo las dos source_key de
 * arriba (borra sus filas y sube las nuevas, para que no queden empresas que
 * pasaron a inactivas; reversible con DELETE … WHERE source_key = …);
 * `assertLargeImportAllowed` de las dos antes de escribir nada; nunca personas
 * físicas (sólo RNC de 9 dígitos).
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  mergeDgiiLargeTaxpayerLists,
  parseDgiiLargeTaxpayerListHtml,
} from '../../src/server/source-catalog/connectors/dgii-rd/do-large-taxpayer-list';
import {
  buildDoSizeRegistryRows,
  buildDoTradeNameRegistryRows,
  DO_DGII_SIZE_REGISTRY_SOURCE_KEY,
  DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY,
  type DoPadronRow,
  type DoProcurementSummary,
} from '../../src/server/source-catalog/connectors/dgii-rd/do-size-registry-rows';
import { buildDgcpDomainMap } from '../../src/server/source-catalog/connectors/dgcp-rd/do-dgcp-domain';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

type Plan = { sourceKey: string; rows: readonly { source_key: string }[] };

const PAGE = 1000;
const UPSERT_CHUNK = 1000;
const WRITABLE_SOURCE_KEYS: ReadonlySet<string> = new Set([
  DO_DGII_SIZE_REGISTRY_SOURCE_KEY,
  DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY,
]);

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Recorre el padrón DGII entero por RNC (índice source_key + normalized_tax_id),
 * sólo lectura. El padrón tiene UNA fila por RNC; si apareciera otra (otro
 * `source_year`), la página por clave podría saltársela, así que se aborta.
 */
async function readPadron(client: SupabaseClient): Promise<DoPadronRow[]> {
  const out: DoPadronRow[] = [];
  const seen = new Set<string>();
  let last = '';
  for (;;) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('normalized_tax_id, legal_name, sector, trade_name:raw_data->>trade_name, active:raw_data->>is_active_taxpayer')
      .eq('source_key', 'rd_dgii_bulk')
      .eq('country_code', 'DO')
      .gt('normalized_tax_id', last)
      .order('normalized_tax_id', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`read_failed_rd_dgii_bulk: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of rows) {
      const rnc = text(row['normalized_tax_id']);
      if (rnc !== null && seen.has(rnc)) throw new Error(`padron_rnc_repetido: ${rnc} (¿dos años cargados?)`);
      if (rnc !== null) seen.add(rnc);
      out.push({
        rnc,
        legalName: text(row['legal_name']),
        tradeName: text(row['trade_name']),
        sector: text(row['sector']),
        isActive: row['active'] === 'true' || row['active'] === true,
      });
    }
    if (rows.length < PAGE) return out;
    last = String(rows[rows.length - 1]['normalized_tax_id']);
  }
}

/**
 * Compras públicas por RNC: importe sumado en todos los años y la clase MIPYME
 * más reciente que NO esté vacía (desempate por año). `do_dgcp` tiene una fila
 * por RNC y año, así que se pagina por posición con un orden total
 * (RNC, año, id): nunca se salta ni se repite una fila.
 */
async function readProcurement(client: SupabaseClient): Promise<Map<string, DoProcurementSummary>> {
  type Acc = { total: number; mipymeClass: string | null; classKey: string };
  const acc = new Map<string, Acc>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select(
        'normalized_tax_id, source_year, awarded:signals->>total_awarded_amount_dop, last:signals->>last_award_date, mipyme:raw_data->provider->>clasificacion',
      )
      .eq('source_key', 'do_dgcp')
      .eq('country_code', 'DO')
      .order('normalized_tax_id', { ascending: true })
      .order('source_year', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read_failed_do_dgcp: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const row of rows) {
      const rnc = text(row['normalized_tax_id']);
      if (rnc === null) continue;
      const amount = Number(row['awarded']);
      const previous = acc.get(rnc) ?? { total: 0, mipymeClass: null, classKey: '' };
      const total = previous.total + (Number.isFinite(amount) && amount > 0 ? amount : 0);
      const mipyme = text(row['mipyme']);
      // Clave de recencia: fecha de la última adjudicación y, si empata, el año.
      const classKey = `${text(row['last']) ?? ''}|${String(row['source_year'] ?? '').padStart(4, '0')}`;
      const newer = mipyme !== null && (previous.mipymeClass === null || classKey > previous.classKey);
      acc.set(rnc, {
        total,
        mipymeClass: newer ? mipyme : previous.mipymeClass,
        classKey: newer ? classKey : previous.classKey,
      });
    }
    if (rows.length < PAGE) break;
  }
  return new Map([...acc].map(([rnc, { total, mipymeClass }]) => [rnc, { awardedTotalDop: total, mipymeClass }]));
}

/**
 * Reemplaza la carga de UNA de las dos fuentes: borra sus filas y sube las
 * nuevas, para que una empresa que pasó a inactiva o salió de las listas deje de
 * ofrecerse. Nunca toca otra `source_key`.
 */
async function replaceSource(
  client: SupabaseClient,
  sourceKey: string,
  rows: readonly { source_key: string }[],
): Promise<number> {
  if (!WRITABLE_SOURCE_KEYS.has(sourceKey) || rows.some((row) => row.source_key !== sourceKey)) {
    throw new Error('refused: una fila no pertenece a la fuente que se reemplaza');
  }
  const { error } = await client.from('source_company_snapshots').delete().eq('source_key', sourceKey).eq('country_code', 'DO');
  if (error) throw new Error(`clear_failed_${sourceKey}: ${error.message}`);
  return upsertAll(client, rows);
}

async function upsertAll(client: SupabaseClient, rows: readonly { source_key: string }[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    if (chunk.some((row) => !WRITABLE_SOURCE_KEYS.has(row.source_key))) {
      throw new Error('refused: una fila no pertenece a las fuentes de este cargador');
    }
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

/** RNC → dominio corporativo desde el archivo de proveedores de la DGCP (local). */
async function readDgcpDomains(path: string): Promise<Map<string, string>> {
  const rows: Record<string, string>[] = [];
  for await (const row of readCsvFile(path)) rows.push(row);
  if (rows.length === 0 || !('CORREO_COMERCIAL' in rows[0])) {
    throw new Error('dgcp_csv_invalido: el archivo no trae la columna CORREO_COMERCIAL');
  }
  return buildDgcpDomainMap(rows);
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const only = value(argv, 'only');
  if (only !== null && only !== 'size' && only !== 'trade-name') {
    throw new Error('config_invalid: --only debe ser size o trade-name');
  }
  const wantSize = only !== 'trade-name';
  const wantTrade = only !== 'size';
  const nacionalesPath = value(argv, 'gc-nacionales');
  const localesPath = value(argv, 'gc-locales');
  const dgcpProveedoresPath = value(argv, 'dgcp-proveedores');
  if (wantSize && (!nacionalesPath || !localesPath)) {
    throw new Error('config_invalid: indica --gc-nacionales y --gc-locales (páginas HTML de la DGII)');
  }
  console.log(`DO SIZE + TRADE NAME ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const importedAt = new Date().toISOString();
  const sourceYear = Number(value(argv, 'year') ?? new Date().getUTCFullYear());
  const padron = await readPadron(client);
  console.log(`  Padrón DGII leído: ${padron.length} RNC (${padron.filter((r) => r.isActive).length} activos)`);
  const plans: Plan[] = [];

  if (wantSize) {
    const nacionales = parseDgiiLargeTaxpayerListHtml(readFileSync(nacionalesPath as string, 'utf8'), 'nacionales');
    const locales = parseDgiiLargeTaxpayerListHtml(readFileSync(localesPath as string, 'utf8'), 'locales_medianos');
    if (nacionales.length === 0 || locales.length === 0) {
      throw new Error('lista_vacia: una de las páginas de la DGII no trajo filas (¿cambió el formato?)');
    }
    const largeTaxpayers = mergeDgiiLargeTaxpayerLists(nacionales, locales);
    const procurement = await readProcurement(client);
    const domains = dgcpProveedoresPath ? await readDgcpDomains(dgcpProveedoresPath) : undefined;
    const rows = buildDoSizeRegistryRows({
      padron,
      largeTaxpayers,
      procurement,
      domains,
      sourceYear,
      importedAt,
    }).filter((row) => row.record_identity_key !== null);
    if (domains) {
      const withDomain = rows.filter((r) => r.raw_data.website_domain !== null).length;
      console.log(`  Dominios desde correos DGCP: ${domains.size} RNC · en esta fuente ${withDomain} de ${rows.length}`);
    }
    console.log(`  Listas DGII: nacionales ${nacionales.length} · locales y medianos ${locales.length} · únicas ${largeTaxpayers.size}`);
    console.log(`  Proveedores DGCP: ${procurement.size}`);
    console.log(`  ${DO_DGII_SIZE_REGISTRY_SOURCE_KEY}: ${rows.length} filas`);
    console.log(`    por nivel ${JSON.stringify(countBy(rows, (r) => String(r.signals.size_tier)))}`);
    console.log(`    por macro ${JSON.stringify(countBy(rows, (r) => String(r.raw_data.macro_industry_key)))}`);
    plans.push({ sourceKey: DO_DGII_SIZE_REGISTRY_SOURCE_KEY, rows });
  }

  if (wantTrade) {
    const rows = buildDoTradeNameRegistryRows({ padron, sourceYear, importedAt }).filter(
      (row) => row.record_identity_key !== null,
    );
    const cores = countBy(rows, (r) => r.normalized_legal_name);
    const unique = rows.filter((r) => cores[r.normalized_legal_name] === 1).length;
    console.log(`  ${DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY}: ${rows.length} filas · nombre comercial único ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);
    plans.push({ sourceKey: DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY, rows });
  }

  if (apply) {
    // Los topes se comprueban TODOS antes de escribir nada: nunca media carga.
    for (const plan of plans) {
      assertLargeImportAllowed({ sourceKey: plan.sourceKey, countryCode: 'DO', estimatedRows: plan.rows.length, isDryRun: false });
    }
    for (const plan of plans) {
      console.log(`  ${plan.sourceKey}: rowsUpserted = ${await replaceSource(client, plan.sourceKey, plan.rows)}`);
    }
  }

  if (!apply) console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
