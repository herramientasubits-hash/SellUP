/**
 * AGENT1-SUPPLIER-SEARCH-PUBLIC-1 — «Proveedores de una empresa», Fase 2 (Colombia):
 * a quién le compra una entidad pública, según SECOP II (contratos firmados).
 *
 * Fuente: datos.gov.co, dataset `jbjy-vk9h` («SECOP II - Contratos Electrónicos»),
 * pública, gratuita y sin llave. Tres consultas de sólo lectura por corrida:
 *  1. Proveedores con NIT de la entidad, agrupados y ordenados por monto, ya
 *     filtrados por los códigos UNSPSC de la industria pedida.
 *  2. El monto por código UNSPSC de esos proveedores CON ESA ENTIDAD: la industria de
 *     cada uno es la de lo que más le vende (tabla UNSPSC → macro aprobada por la
 *     dueña para Paraguay, `py-dncp-macro-table.ts`; misma regla del 50 %).
 *  3. La página del proceso con el contrato más grande de cada proveedor (evidencia).
 *
 * 🔴 Nunca se piden ni se guardan cuentas bancarias, banco ni representante legal: el
 * `$select` nombra sólo lo que se usa.
 *
 * Puro: sin env, sin I/O (la llamada HTTP se inyecta), sin reloj.
 */

import {
  PY_DNCP_FAMILY_MACRO,
  PY_DNCP_SEGMENT_MACRO,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscRubro,
  PY_DNCP_MACRO_TABLE_VERSION,
} from '@/server/prospect-batches/country-source-discovery/py-dncp-macro-table';
import { normalizeEntityNit } from '@/server/source-catalog/connectors/co-public-entities/co-public-entity-rows';
import type { PublicBuyerSupplier, PublicBuyerSuppliersResult } from './public-buyer-suppliers';

export const CO_SECOP_CONTRACTS_URL = 'https://www.datos.gov.co/resource/jbjy-vk9h.json';
/** `source_key` de las filas que entran por aquí (traza del candidato). */
export const CO_SECOP_SUPPLIERS_SOURCE_KEY = 'co_secop2_buyer_suppliers';
/** Proveedores que se leen de la consulta agregada (los de más monto). */
export const CO_SECOP_AGGREGATE_LIMIT = 60;
/** Años hacia atrás: el año en curso y los dos anteriores. */
export const CO_SECOP_LOOKBACK_YEARS = 2;

export type CoSecopFetchJson = (url: string) => Promise<unknown>;

/** Primer día del periodo que se mira. */
export function coSecopSinceDate(nowIso: string): string {
  const year = Number(nowIso.slice(0, 4));
  return `${year - CO_SECOP_LOOKBACK_YEARS}-01-01`;
}

/**
 * Prefijos UNSPSC (segmento de 2 dígitos o familia de 4) que pueden dar la macro.
 * Un segmento con familias de OTRA macro entra igual: la consulta 2 lo decide.
 * Vacío ⇒ la industria no tiene códigos (Gobierno, Educación…): no se consulta.
 */
export function unspscPrefixesForMacro(macroIndustryKey: string): string[] {
  const families = Object.entries(PY_DNCP_FAMILY_MACRO)
    .filter(([, macro]) => macro === macroIndustryKey)
    .map(([code]) => code);
  const segments = Object.entries(PY_DNCP_SEGMENT_MACRO)
    .filter(([, macro]) => macro === macroIndustryKey)
    .map(([code]) => code);
  return [...segments, ...families.filter((f) => !segments.includes(f.slice(0, 2)))].sort();
}

/** Comilla simple escapada para un literal SoQL; los NIT ya son sólo dígitos. */
function soqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildUrl(params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `${CO_SECOP_CONTRACTS_URL}?${search.toString()}`;
}

/**
 * Contratos firmados de la entidad en el periodo, sin los cancelados (`estado_contrato`
 * «Cancelado»: no hubo compra; la DGCP de RD se filtra igual). Sin estado ⇒ cuenta.
 */
function baseWhere(buyerTaxId: string, sinceDate: string): string {
  return (
    `nit_entidad=${soqlLiteral(buyerTaxId)} AND tipodocproveedor='NIT' AND fecha_de_firma >= ${soqlLiteral(sinceDate)}` +
    ` AND (estado_contrato IS NULL OR upper(estado_contrato) != 'CANCELADO')`
  );
}

export function buildCoSecopAggregateUrl(input: {
  buyerTaxId: string;
  sinceDate: string;
  prefixes: readonly string[];
}): string {
  const codes = input.prefixes.map((p) => `starts_with(codigo_de_categoria_principal, ${soqlLiteral(`V1.${p}`)})`);
  return buildUrl({
    $select:
      'documento_proveedor,max(proveedor_adjudicado) as proveedor,sum(valor_del_contrato) as total,count(*) as n,max(fecha_de_firma) as ultima',
    $where: `${baseWhere(input.buyerTaxId, input.sinceDate)} AND (${codes.join(' OR ')})`,
    $group: 'documento_proveedor',
    $order: 'total DESC',
    $limit: String(CO_SECOP_AGGREGATE_LIMIT),
  });
}

/**
 * `supplierTaxIds` = los valores CRUDOS de `documento_proveedor` tal como los devolvió la
 * consulta agregada («900123456», «900.123.456-7», «9001234567»): el `in(...)` compara
 * texto exacto, con el NIT normalizado no coincidirían.
 */
export function buildCoSecopFamiliesUrl(input: { buyerTaxId: string; sinceDate: string; supplierTaxIds: readonly string[] }): string {
  return buildUrl({
    $select: 'documento_proveedor,codigo_de_categoria_principal,sum(valor_del_contrato) as total',
    $where: `${baseWhere(input.buyerTaxId, input.sinceDate)} AND documento_proveedor in(${input.supplierTaxIds.map(soqlLiteral).join(',')})`,
    $group: 'documento_proveedor,codigo_de_categoria_principal',
    $limit: '2000',
  });
}

export function buildCoSecopEvidenceUrl(input: { buyerTaxId: string; sinceDate: string; supplierTaxIds: readonly string[] }): string {
  return buildUrl({
    $select: 'documento_proveedor,urlproceso,valor_del_contrato',
    $where: `${baseWhere(input.buyerTaxId, input.sinceDate)} AND documento_proveedor in(${input.supplierTaxIds.map(soqlLiteral).join(',')})`,
    $order: 'valor_del_contrato DESC',
    $limit: '500',
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** «V1.43211500» → «43211500»; otra cosa ⇒ `null`. */
export function parseUnspscCode(raw: unknown): string | null {
  const text = asText(raw);
  if (!text) return null;
  const code = text.replace(/^V1\./i, '');
  return /^\d{2,8}$/.test(code) ? code : null;
}

type AggregateRow = {
  taxId: string;
  name: string;
  totalAmount: number;
  contractCount: number;
  lastSignedAt: string | null;
  /** Formas crudas de `documento_proveedor` vistas para este NIT (para las consultas siguientes). */
  rawTaxIds: string[];
};

/**
 * Filas agregadas por `documento_proveedor` CRUDO ⇒ una por NIT normalizado (sin dígito de
 * verificación). El mismo proveedor puede venir escrito de varias formas («900123456»,
 * «900.123.456-7», «9001234567»): se suman montos y contratos, se toma la última firma y el
 * nombre de la forma con más monto, y se guardan todas las formas crudas. Orden: monto.
 */
export function parseCoSecopAggregate(rows: unknown): AggregateRow[] {
  if (!Array.isArray(rows)) return [];
  const byTaxId = new Map<string, AggregateRow>();
  for (const raw of rows) {
    const row = asRecord(raw);
    const rawTaxId = asText(row?.documento_proveedor);
    const taxId = normalizeEntityNit(rawTaxId);
    const name = asText(row?.proveedor);
    if (!row || !rawTaxId || !taxId || !name) continue;
    const totalAmount = asAmount(row.total);
    const contractCount = Math.max(0, Math.trunc(asAmount(row.n)));
    const lastSignedAt = asText(row.ultima)?.slice(0, 10) ?? null;
    const seen = byTaxId.get(taxId);
    if (!seen) {
      byTaxId.set(taxId, { taxId, name, totalAmount, contractCount, lastSignedAt, rawTaxIds: [rawTaxId] });
      continue;
    }
    byTaxId.set(taxId, {
      taxId,
      name: totalAmount > seen.totalAmount ? name : seen.name,
      totalAmount: seen.totalAmount + totalAmount,
      contractCount: seen.contractCount + contractCount,
      lastSignedAt: seen.lastSignedAt === null || (lastSignedAt !== null && lastSignedAt > seen.lastSignedAt) ? lastSignedAt : seen.lastSignedAt,
      rawTaxIds: seen.rawTaxIds.includes(rawTaxId) ? seen.rawTaxIds : [...seen.rawTaxIds, rawTaxId],
    });
  }
  // `sort` es estable: a igual monto se queda el orden de la fuente.
  return [...byTaxId.values()].sort((a, b) => b.totalAmount - a.totalAmount);
}

/** NIT → { familia UNSPSC (4 dígitos) → monto }. */
export function parseCoSecopFamilies(rows: unknown): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = asRecord(raw);
    const taxId = normalizeEntityNit(asText(row?.documento_proveedor));
    const code = parseUnspscCode(row?.codigo_de_categoria_principal);
    const amount = asAmount(row?.total);
    if (!taxId || !code || amount <= 0) continue;
    const family = code.slice(0, 4);
    const byFamily = out.get(taxId) ?? {};
    out.set(taxId, { ...byFamily, [family]: (byFamily[family] ?? 0) + amount });
  }
  return out;
}

/** NIT → página del proceso de su contrato más grande (filas ya ordenadas por monto). */
export function parseCoSecopEvidence(rows: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = asRecord(raw);
    const taxId = normalizeEntityNit(asText(row?.documento_proveedor));
    if (!taxId || out.has(taxId)) continue;
    const urlField = row?.urlproceso;
    const url = asText(asRecord(urlField)?.url) ?? asText(urlField);
    if (url && /^https:\/\//i.test(url)) out.set(taxId, url);
  }
  return out;
}

/**
 * Proveedores de la entidad en la industria pedida, de más a menos monto. La entidad
 * misma nunca sale (contratos consigo misma no existen, pero se cubre).
 */
export async function fetchCoSecopSuppliers(
  input: { buyerTaxId: string; macroIndustryKey: string; nowIso: string },
  fetchJson: CoSecopFetchJson,
): Promise<PublicBuyerSuppliersResult> {
  const prefixes = unspscPrefixesForMacro(input.macroIndustryKey);
  if (prefixes.length === 0) return { ok: false, reason: 'industry_without_unspsc' };
  const sinceDate = coSecopSinceDate(input.nowIso);
  let aggregate: AggregateRow[];
  try {
    aggregate = parseCoSecopAggregate(
      await fetchJson(buildCoSecopAggregateUrl({ buyerTaxId: input.buyerTaxId, sinceDate, prefixes })),
    ).filter((row) => row.taxId !== input.buyerTaxId);
  } catch {
    return { ok: false, reason: 'source_unavailable' };
  }
  if (aggregate.length === 0) {
    return { ok: true, suppliers: [], read: 0, outsideIndustry: 0, tableVersion: PY_DNCP_MACRO_TABLE_VERSION };
  }
  // Las formas crudas (con puntos o dígito de verificación) para que el `in(...)` las encuentre;
  // las respuestas se juntan por NIT normalizado al leerlas.
  const supplierTaxIds = aggregate.flatMap((row) => row.rawTaxIds);
  const query = { buyerTaxId: input.buyerTaxId, sinceDate, supplierTaxIds };
  // La evidencia es un extra: si falla, el proveedor sale igual sin enlace.
  const [familiesRaw, evidenceRaw] = await Promise.all([
    fetchJson(buildCoSecopFamiliesUrl(query)).catch(() => null),
    fetchJson(buildCoSecopEvidenceUrl(query)).catch(() => null),
  ]);
  if (familiesRaw === null) return { ok: false, reason: 'source_unavailable' };
  const families = parseCoSecopFamilies(familiesRaw);
  const evidence = parseCoSecopEvidence(evidenceRaw);

  const suppliers: PublicBuyerSupplier[] = [];
  for (const row of aggregate) {
    const byFamily = families.get(row.taxId) ?? {};
    const macro = resolvePyDncpSupplierMacro(byFamily);
    if (!macro || macro.macroIndustryKey !== input.macroIndustryKey) continue;
    const topFamily = Object.entries(byFamily).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    suppliers.push({
      taxId: row.taxId,
      name: row.name,
      totalAmount: row.totalAmount,
      contractCount: row.contractCount,
      lastSignedAt: row.lastSignedAt,
      macroIndustryKey: macro.macroIndustryKey,
      macroShare: macro.share,
      rubro: resolvePyUnspscRubro(topFamily),
      evidenceUrl: evidence.get(row.taxId) ?? null,
    });
  }
  return {
    ok: true,
    suppliers,
    read: aggregate.length,
    outsideIndustry: aggregate.length - suppliers.length,
    tableVersion: PY_DNCP_MACRO_TABLE_VERSION,
  };
}
