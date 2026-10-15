/**
 * Brasil — consultas en vivo de «Proveedores de una empresa» (sólo lectura, sin llave):
 *
 *  1. Entidad por nombre: `br_receita_registry` con natureza jurídica 1xxx (administración
 *     pública), igual que la Receita la escribe («MINISTERIO DA SAUDE»).
 *  2. ¿Es un órgão federal? `modulo-uasg/2_consultarOrgao` por su CNPJ.
 *     - Federal ⇒ ítems de contratos de Compras.gov.br de los últimos 12 meses (hasta
 *       `COMPRAS_MAX_PAGES` páginas de 500 repartidas en el año) y la clase CATMAT/CATSER
 *       de los ítems de más monto (tabla aprobada 15-10 `br-catmat-macro-table.ts`).
 *     - Si no ⇒ contratos del PNCP filtrando `cnpjOrgao` (hasta `PNCP_MAX_PAGES` páginas).
 *  3. Sin clase de catálogo ⇒ industria por la actividad CNAE del proveedor en la Receita
 *     (tabla aprobada `br-receita-macro-table.ts`).
 *  4. Fuera las entidades públicas (natureza 1xxx); web por CNPJ de la Receita.
 *
 * Todo con tiempo máximo por consulta y por paso: lo que no llega a tiempo no se lee.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BR_RECEITA_MACRO_TABLE_VERSION, resolveBrCnaeMacro } from '@/server/prospect-batches/country-source-discovery/br-receita-macro-table';
import { normalizeWebsiteHost } from '@/server/source-catalog/connectors/co-public-entities/co-domain';
import type { PublicBuyerSupplier, PublicBuyerSuppliersResult, PublicEntityRow } from '../public-buyer-suppliers';
import {
  aggregateBrSuppliers,
  brAmountByFamily,
  brItemsToLookup,
  brWindow,
  BR_CATMAT_ITEM_URL,
  BR_CATSER_ITEM_URL,
  BR_COMPRAS_ITEMS_URL,
  BR_COMPRAS_ORGAO_URL,
  BR_MIN_PAIR_AMOUNT_BRL,
  BR_PNCP_CONTRACTS_URL,
  BR_PUBLIC_PROCUREMENT_SOURCE_KEY,
  BR_COUNTRY,
  BR_SUPPLIER_LIMIT,
  BR_SUPPLIER_SCAN_LIMIT,
  BR_SUPPLIER_TOP_BY_AMOUNT,
  parseBrComprasItems,
  parseBrPncpContracts,
  pickBrCandidates,
  spreadPages,
  type BrProcurementLine,
  type BrSupplierAggregate,
} from './br';
import { BR_CATMAT_CLASSIFIER, BR_CATMAT_MACRO_TABLE_VERSION, brCatalogFamily } from './br-catmat-macro-table';
import type { CountryLookups } from './loaded-lookups.server';

const ENTITY_QUERY_LIMIT = 25;
const ORGAO_TIMEOUT_MS = 8_000;
const COMPRAS_PAGE_SIZE = 500;
const COMPRAS_MAX_PAGES = 24;
const COMPRAS_PAGE_TIMEOUT_MS = 15_000;
const COMPRAS_DEADLINE_MS = 30_000;
const PNCP_PAGE_SIZE = 500;
const PNCP_MAX_PAGES = 3;
const PNCP_PAGE_TIMEOUT_MS = 30_000;
const PNCP_DEADLINE_MS = 40_000;
const CATALOG_TIMEOUT_MS = 6_000;
const CATALOG_DEADLINE_MS = 12_000;
const CATALOG_LOOKUP_CAP = 120;
const PARALLEL_REQUESTS = 6;
/** CNPJ por consulta a la Receita (la lista va en la URL). */
const RECEITA_CHUNK = 100;
/** Fuentes con web por CNPJ, de la que manda a la que menos. */
const BR_DOMAIN_SOURCE_KEYS = ['br_receita_directory', 'br_receita_registry', 'br_receita_domain_key', 'br_receita_name_alias'] as const;

/** GET JSON con tiempo máximo; `null` si la fuente responde 404 (no existe). */
export type BrFetchJson = (url: string, timeoutMs: number) => Promise<unknown>;

/**
 * Clase de catálogo por ítem («Material:396174» → «M6550»). Se guarda entre corridas del
 * mismo proceso: el catálogo cambia muy poco.
 */
const CATALOG_FAMILY_CACHE = new Map<string, string | null>();

function logError(step: string, error: unknown): void {
  console.error(`[supplier-public-buyer:BR] ${step}:`, (error as { message?: string })?.message ?? String(error));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function defaultFetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'SellUp/0.1 supplier-search' },
    });
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Corre tareas con un máximo en paralelo y una hora límite; las que fallan se saltan. */
async function runWithin<T>(tasks: ReadonlyArray<(timeoutMs: number) => Promise<T>>, deadlineAt: number, perTaskMs: number, now: () => number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const remaining = deadlineAt - now();
      if (remaining <= 500) return;
      const task = tasks[next++];
      try {
        out.push(await task(Math.min(perTaskMs, remaining)));
      } catch {
        // Una página o un ítem que no llega no tumba el paso.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, tasks.length) }, worker));
  return out;
}

function withQuery(base: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return `${base}?${search.toString()}`;
}

function totalPagesOf(payload: unknown, key: 'totalPaginas'): number {
  const n = Number((payload as Record<string, unknown> | null)?.[key]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * ¿El CNPJ es de un órgão federal de Compras.gov.br? Devuelve su código, o `null`. Un
 * fallo de red se reintenta una vez: sin código, un ministerio iría al PNCP (lento).
 */
async function federalOrgaoCode(cnpj: string, fetchJson: BrFetchJson): Promise<string | null> {
  const url = withQuery(BR_COMPRAS_ORGAO_URL, { pagina: 1, cnpjCpfOrgao: cnpj, statusOrgao: 'true' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const payload = await fetchJson(url, ORGAO_TIMEOUT_MS);
      const rows = (payload as { resultado?: unknown } | null)?.resultado;
      const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
      const code = row?.codigoOrgao;
      return row?.esfera === 'F' && (typeof code === 'number' || typeof code === 'string') ? String(code) : null;
    } catch (error) {
      logError(`orgao attempt ${attempt + 1}`, error);
    }
  }
  return null;
}

/** Ítems de contratos federales de los últimos 12 meses (muestra repartida si son muchos). */
async function readComprasLines(
  input: { orgaoCode: string; window: { start: string; end: string } },
  fetchJson: BrFetchJson,
  now: () => number,
): Promise<BrProcurementLine[] | null> {
  const deadlineAt = now() + COMPRAS_DEADLINE_MS;
  const pageUrl = (pagina: number) =>
    withQuery(BR_COMPRAS_ITEMS_URL, {
      pagina,
      tamanhoPagina: COMPRAS_PAGE_SIZE,
      codigoOrgao: input.orgaoCode,
      dataVigenciaInicialMin: input.window.start,
      dataVigenciaInicialMax: input.window.end,
    });
  let first: unknown;
  try {
    first = await fetchJson(pageUrl(1), COMPRAS_PAGE_TIMEOUT_MS);
  } catch (error) {
    logError('compras page 1', error);
    return null;
  }
  const rest = spreadPages(totalPagesOf(first, 'totalPaginas'), COMPRAS_MAX_PAGES).filter((p) => p !== 1);
  const pages = await runWithin(
    rest.map((p) => (timeoutMs: number) => fetchJson(pageUrl(p), timeoutMs)),
    deadlineAt,
    COMPRAS_PAGE_TIMEOUT_MS,
    now,
  );
  return [first, ...pages].flatMap(parseBrComprasItems);
}

/** Contratos del PNCP de un comprador no federal (pocas páginas: el PNCP es lento). */
async function readPncpLines(
  input: { buyerCnpj: string; window: { start: string; end: string } },
  fetchJson: BrFetchJson,
  now: () => number,
): Promise<BrProcurementLine[] | null> {
  const deadlineAt = now() + PNCP_DEADLINE_MS;
  const compact = (iso: string) => iso.replace(/-/g, '');
  const pageUrl = (pagina: number) =>
    withQuery(BR_PNCP_CONTRACTS_URL, {
      dataInicial: compact(input.window.start),
      dataFinal: compact(input.window.end),
      cnpjOrgao: input.buyerCnpj,
      pagina,
      tamanhoPagina: PNCP_PAGE_SIZE,
    });
  let first: unknown;
  try {
    first = await fetchJson(pageUrl(1), PNCP_PAGE_TIMEOUT_MS);
  } catch (error) {
    logError('pncp page 1', error);
    return null;
  }
  if (first === null) return [];
  const rest = spreadPages(totalPagesOf(first, 'totalPaginas'), PNCP_MAX_PAGES).filter((p) => p !== 1);
  const pages = await runWithin(
    rest.map((p) => (timeoutMs: number) => fetchJson(pageUrl(p), timeoutMs)),
    deadlineAt,
    PNCP_PAGE_TIMEOUT_MS,
    now,
  );
  return [first, ...pages].flatMap(parseBrPncpContracts);
}

/** Clase CATMAT/CATSER de los ítems pedidos (con caché del proceso). */
async function lookupCatalogFamilies(itemKeys: readonly string[], fetchJson: BrFetchJson, now: () => number): Promise<Map<string, string>> {
  const missing = itemKeys.filter((key) => !CATALOG_FAMILY_CACHE.has(key));
  await runWithin(
    missing.map((key) => async (timeoutMs: number) => {
      const [tipo, code] = key.split(':');
      const url =
        tipo === 'Material'
          ? withQuery(BR_CATMAT_ITEM_URL, { pagina: 1, codigoItem: code })
          : withQuery(BR_CATSER_ITEM_URL, { pagina: 1, codigoServico: code });
      const payload = await fetchJson(url, timeoutMs);
      const row = ((payload as { resultado?: unknown[] } | null)?.resultado ?? [])[0] as Record<string, unknown> | undefined;
      CATALOG_FAMILY_CACHE.set(key, brCatalogFamily(tipo, row?.codigoClasse));
    }),
    now() + CATALOG_DEADLINE_MS,
    CATALOG_TIMEOUT_MS,
    now,
  );
  const out = new Map<string, string>();
  for (const key of itemKeys) {
    const family = CATALOG_FAMILY_CACHE.get(key);
    if (family) out.set(key, family);
  }
  return out;
}

type ReceitaFacts = { natureza: string | null; cnae: string | null };

/** Natureza jurídica y CNAE de la Receita por CNPJ (matriz). */
async function receitaFacts(serviceClient: SupabaseClient, taxIds: readonly string[]): Promise<Map<string, ReceitaFacts>> {
  const out = new Map<string, ReceitaFacts>();
  const chunks: string[][] = [];
  for (let i = 0; i < taxIds.length; i += RECEITA_CHUNK) chunks.push(taxIds.slice(i, i + RECEITA_CHUNK));
  await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await serviceClient
        .from('source_company_snapshots')
        .select('normalized_tax_id, natureza:raw_data->>natureza_juridica, cnae:raw_data->>cnae_principal')
        .eq('source_key', 'br_receita_registry')
        .in('normalized_tax_id', chunk);
      if (error) {
        logError('receita facts', error);
        return;
      }
      for (const row of (data ?? []) as Array<{ normalized_tax_id: string; natureza: string | null; cnae: string | null }>) {
        out.set(row.normalized_tax_id, { natureza: text(row.natureza), cnae: text(row.cnae) });
      }
    }),
  );
  return out;
}

/** Natureza jurídica 1xxx = administración pública (otra entidad, no un proveedor empresa). */
export function brIsPublicNatureza(natureza: string | null | undefined): boolean {
  return /^1\d{3}$/.test((natureza ?? '').replace(/\D/g, ''));
}

/** Industria y forma de los proveedores agregados (catálogo; si no, CNAE). */
export function classifyBrSuppliers(
  suppliers: readonly BrSupplierAggregate[],
  input: { macroIndustryKey: string; familyByItem: ReadonlyMap<string, string>; facts: ReadonlyMap<string, ReceitaFacts> },
): { suppliers: PublicBuyerSupplier[]; usedCnae: boolean } {
  const out: PublicBuyerSupplier[] = [];
  let usedCnae = false;
  for (const supplier of suppliers) {
    const byFamily = brAmountByFamily(supplier, input.familyByItem);
    const hasCatalog = Object.keys(byFamily).length > 0;
    const byCatalog = hasCatalog ? BR_CATMAT_CLASSIFIER.classify(byFamily) : null;
    const cnaeMacro = hasCatalog ? null : resolveBrCnaeMacro(input.facts.get(supplier.taxId)?.cnae ?? null);
    const macro = byCatalog ?? (cnaeMacro ? { macroIndustryKey: cnaeMacro, share: 1 } : null);
    if (!macro || macro.macroIndustryKey !== input.macroIndustryKey) continue;
    if (!byCatalog) usedCnae = true;
    const topFamily = Object.entries(byFamily).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    out.push({
      taxId: supplier.taxId,
      name: supplier.name,
      totalAmount: supplier.totalAmount,
      contractCount: supplier.contractCount,
      lastSignedAt: supplier.lastSignedAt,
      macroIndustryKey: macro.macroIndustryKey,
      macroShare: macro.share,
      rubro: byCatalog ? BR_CATMAT_CLASSIFIER.rubroOf(topFamily) : null,
      evidenceUrl: supplier.evidenceUrl,
    });
  }
  return { suppliers: out, usedCnae };
}

/** Brasil: Compras.gov.br (federal) o PNCP en vivo; entidades, públicas y webs de la Receita. */
export function buildBrLookups(
  serviceClient: SupabaseClient,
  options: { fetchJson?: BrFetchJson; now?: () => number } = {},
): CountryLookups {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const now = options.now ?? Date.now;
  const snapshots = () => serviceClient.from('source_company_snapshots');
  // Lo que `listSuppliers` ya leyó de la Receita sirve para sacar a las públicas.
  const factsSeen = new Map<string, ReceitaFacts>();

  return {
    sourceKey: BR_PUBLIC_PROCUREMENT_SOURCE_KEY,
    taxIdentifierType: 'CNPJ',
    normalizeName: BR_COUNTRY.normalizeBuyerName,

    findPublicEntities: async (normalizedName) => {
      const { data, error } = await snapshots()
        .select('normalized_tax_id, normalized_legal_name')
        .eq('source_key', 'br_receita_registry')
        .like('normalized_legal_name', `${normalizedName.replace(/[%_]/g, '')}%`)
        .like('raw_data->>natureza_juridica', '1%')
        .limit(ENTITY_QUERY_LIMIT);
      if (error) {
        logError('find entities', error);
        return [];
      }
      return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row): PublicEntityRow[] => {
        const taxId = text(row.normalized_tax_id);
        const name = text(row.normalized_legal_name);
        return taxId && name ? [{ taxId, normalizedLegalName: name, shortName: null, isHead: false }] : [];
      });
    },

    listSuppliers: async ({ buyerTaxId, macroIndustryKey, nowIso }): Promise<PublicBuyerSuppliersResult> => {
      const window = brWindow(nowIso);
      const orgaoCode = await federalOrgaoCode(buyerTaxId, fetchJson);
      const lines = orgaoCode
        ? await readComprasLines({ orgaoCode, window }, fetchJson, now)
        : await readPncpLines({ buyerCnpj: buyerTaxId, window }, fetchJson, now);
      if (lines === null) return { ok: false, reason: 'source_unavailable' };
      const scanned = aggregateBrSuppliers(lines, { buyerCnpj: buyerTaxId, minAmount: BR_MIN_PAIR_AMOUNT_BRL, limit: BR_SUPPLIER_SCAN_LIMIT });
      const sinceYear = window.start.slice(0, 4);
      if (scanned.length === 0) {
        return { ok: true, suppliers: [], read: 0, outsideIndustry: 0, tableVersion: BR_CATMAT_MACRO_TABLE_VERSION, sinceYear };
      }
      const facts = await receitaFacts(serviceClient, scanned.map((s) => s.taxId));
      for (const [taxId, fact] of facts) factsSeen.set(taxId, fact);
      const aggregated = pickBrCandidates(scanned, {
        macroOfTaxId: (taxId) => resolveBrCnaeMacro(facts.get(taxId)?.cnae ?? null),
        macroIndustryKey,
        top: BR_SUPPLIER_TOP_BY_AMOUNT,
        limit: BR_SUPPLIER_LIMIT,
      });
      const itemKeys = brItemsToLookup(aggregated, { perSupplier: 3, coverage: 0.7, cap: CATALOG_LOOKUP_CAP });
      const familyByItem = itemKeys.length > 0 ? await lookupCatalogFamilies(itemKeys, fetchJson, now) : new Map<string, string>();
      const { suppliers, usedCnae } = classifyBrSuppliers(aggregated, { macroIndustryKey, familyByItem, facts });
      return {
        ok: true,
        suppliers,
        read: aggregated.length,
        outsideIndustry: aggregated.length - suppliers.length,
        tableVersion: usedCnae ? `${BR_CATMAT_MACRO_TABLE_VERSION}+${BR_RECEITA_MACRO_TABLE_VERSION}` : BR_CATMAT_MACRO_TABLE_VERSION,
        sinceYear,
      };
    },

    listPublicOnlyTaxIds: async (taxIds) => {
      const unknown = taxIds.filter((t) => !factsSeen.has(t));
      if (unknown.length > 0) for (const [taxId, fact] of await receitaFacts(serviceClient, unknown)) factsSeen.set(taxId, fact);
      return new Set(taxIds.filter((t) => brIsPublicNatureza(factsSeen.get(t)?.natureza)));
    },

    findDomainsByTaxId: async (taxIds) => {
      const domains = new Map<string, string>();
      if (taxIds.length === 0) return domains;
      const { data, error } = await snapshots()
        .select('source_key, normalized_tax_id, website:raw_data->>website_domain')
        .in('source_key', [...BR_DOMAIN_SOURCE_KEYS])
        .in('normalized_tax_id', [...taxIds]);
      if (error) {
        logError('domains', error);
        return domains;
      }
      const rows = (data ?? []) as Array<{ source_key: string; normalized_tax_id: string; website: string | null }>;
      for (const sourceKey of BR_DOMAIN_SOURCE_KEYS) {
        for (const row of rows.filter((r) => r.source_key === sourceKey)) {
          const host = normalizeWebsiteHost(text(row.website));
          if (host && !domains.has(row.normalized_tax_id)) domains.set(row.normalized_tax_id, host);
        }
      }
      return domains;
    },
  };
}
