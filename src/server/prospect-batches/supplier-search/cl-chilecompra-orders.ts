/**
 * AGENT1-SUPPLIER-SEARCH-CL-1 — órdenes de compra MENSUALES de ChileCompra (datos
 * abiertos, sin ticket) → resumen entidad compradora × proveedor para
 * `public_procurement_supplier_links` (migración 150).
 *
 * Archivo: https://transparenciachc.blob.core.windows.net/oc-da/AAAA-M.zip, un CSV
 * por mes (latin-1, «;»), una fila por ÍTEM de orden (~400 mil filas, ~700 MB).
 *
 * Reglas del resumen:
 *  - Sólo órdenes vigentes (aceptadas, recibidas, enviadas o en proceso).
 *  - Sólo proveedores EMPRESA: RUT ≥ 76.000.000 (personas naturales, servicios
 *    públicos 60/61, municipios 69 y asociaciones 70–75 quedan fuera).
 *  - Monto por familia UNSPSC (4 dígitos) para decidir la industria del proveedor
 *    con la tabla aprobada (`py-dncp-macro-table.ts`).
 *  - Se guarda la orden más grande como prueba (enlace https de Mercado Público).
 *  - Pares con menos del piso acumulado no se guardan (cola de compras chicas).
 *
 * 🔴 Nunca se guardan personas, contactos, cuentas ni el texto de las órdenes.
 *
 * Puro: sin I/O, sin reloj.
 */

import {
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyDncpSupplierMacro,
  resolvePyUnspscRubro,
} from '@/server/prospect-batches/country-source-discovery/py-dncp-macro-table';
import {
  normalizePublicEntityName,
  type PublicBuyerSupplier,
  type PublicBuyerSuppliersResult,
  type PublicEntityRow,
} from './public-buyer-suppliers';

export const CL_CHILECOMPRA_ORDERS_SOURCE_KEY = 'cl_chilecompra_orders';
export const CL_CHILECOMPRA_ORDERS_URL = (year: number, month: number) =>
  `https://transparenciachc.blob.core.windows.net/oc-da/${year}-${month}.zip`;
/** Piso acumulado por entidad × proveedor en la ventana (CLP neto). */
export const CL_CHILECOMPRA_MIN_PAIR_AMOUNT_CLP = 10_000_000;
/** RUT mínimo de una empresa (los menores son personas o entidades sin fines de lucro). */
export const CL_COMPANY_RUT_MIN = 76_000_000;

const VALID_STATES = new Set(['recepcion conforme', 'aceptada', 'enviada a proveedor', 'en proceso']);

/** «96.505.260-7» / «96505260-7» / «965052607» → «96505260-7»; otra cosa ⇒ `null`. */
export function parseClRut(raw: string | null | undefined): { rut: string; number: number } | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/[.\s]/g, '').toUpperCase();
  const match = /^(\d{1,9})-?([\dK])$/.exec(clean);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { rut: `${number}-${match[2]}`, number };
}

/** RUT de empresa (ver `CL_COMPANY_RUT_MIN`). */
export function isClCompanyRut(rut: { number: number } | null): boolean {
  return rut !== null && rut.number >= CL_COMPANY_RUT_MIN;
}

/**
 * Nombre del comprador como lo reconoce la búsqueda: «I MUNICIPALIDAD DE SANTIAGO» y
 * «Ilustre Municipalidad de Santiago» → «MUNICIPALIDAD DE SANTIAGO».
 */
export function normalizeClBuyerName(raw: string): string {
  return normalizePublicEntityName(raw).replace(/^(?:I|ILUSTRE)\s+(?=MUNICIPALIDAD\b)/, '');
}

/** Monto chileno del archivo: «18218023,5294118» → 18218023.53. */
export function parseClAmount(raw: string | null | undefined): number {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.trim() === 'NA') return 0;
  const n = Number(raw.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseDate(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** Enlace de la orden en Mercado Público, siempre https y sólo de ese dominio. */
export function clOrderUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  const match = /^https?:\/\/(www\.)?mercadopublico\.cl\/(.+)$/i.exec(text);
  return match ? `https://www.mercadopublico.cl/${match[2]}` : null;
}

/** Una fila del CSV (columnas por nombre). */
export type ClOrderLine = Record<string, string>;

export type ClSupplierLinkRow = {
  country_code: 'CL';
  source_key: string;
  buyer_code: string;
  buyer_tax_id: string | null;
  buyer_name: string;
  buyer_name_normalized: string;
  buyer_sector: string | null;
  supplier_tax_id: string;
  supplier_name: string;
  total_amount: number;
  currency: 'CLP';
  order_count: number;
  amount_by_family: Record<string, number>;
  first_order_on: string | null;
  last_order_on: string | null;
  top_order_code: string | null;
  top_order_url: string | null;
  top_order_amount: number | null;
  window_start: string;
  window_end: string;
};

type PairState = {
  buyerCode: string;
  supplierRut: string;
  supplierName: string;
  total: number;
  orders: Map<string, { amount: number; url: string | null }>;
  byFamily: Map<string, number>;
  first: string | null;
  last: string | null;
};

type BuyerState = { name: string; sector: string | null; unitRuts: Map<string, number> };

export type ClOrdersAggregateStats = {
  lines: number;
  skippedState: number;
  skippedNotCompany: number;
  skippedMalformed: number;
};

/** Acumula las filas de varios meses y entrega el resumen con el piso aplicado. */
export class ClOrdersAggregator {
  private readonly pairs = new Map<string, PairState>();
  private readonly buyers = new Map<string, BuyerState>();
  readonly stats: ClOrdersAggregateStats = { lines: 0, skippedState: 0, skippedNotCompany: 0, skippedMalformed: 0 };

  add(line: ClOrderLine): void {
    this.stats.lines += 1;
    const state = (line['Estado'] ?? '').trim().toLowerCase();
    if (!VALID_STATES.has(state)) {
      this.stats.skippedState += 1;
      return;
    }
    const buyerCode = (line['CodigoOrganismoPublico'] ?? '').trim();
    const buyerName = (line['OrganismoPublico'] ?? '').trim();
    const orderCode = (line['Codigo'] ?? '').trim();
    if (!buyerCode || !buyerName || !orderCode) {
      this.stats.skippedMalformed += 1;
      return;
    }
    const supplier = parseClRut(line['RutSucursal']);
    if (!isClCompanyRut(supplier) || supplier === null) {
      this.stats.skippedNotCompany += 1;
      return;
    }
    const amount = parseClAmount(line['totalLineaNeto']);
    const family = (line['codigoProductoONU'] ?? '').trim().slice(0, 4);
    const date = parseDate(line['FechaEnvio']) ?? parseDate(line['FechaCreacion']);

    const buyer = this.buyers.get(buyerCode) ?? { name: buyerName, sector: (line['sector'] ?? '').trim() || null, unitRuts: new Map() };
    const unitRut = parseClRut(line['RutUnidadCompra']);
    if (unitRut) buyer.unitRuts.set(unitRut.rut, (buyer.unitRuts.get(unitRut.rut) ?? 0) + 1);
    this.buyers.set(buyerCode, buyer);

    const key = `${buyerCode}|${supplier.rut}`;
    const pair = this.pairs.get(key) ?? {
      buyerCode,
      supplierRut: supplier.rut,
      supplierName: (line['NombreProveedor'] ?? '').trim() || supplier.rut,
      total: 0,
      orders: new Map(),
      byFamily: new Map(),
      first: null,
      last: null,
    };
    pair.total += amount;
    const order = pair.orders.get(orderCode) ?? { amount: 0, url: clOrderUrl(line['Link']) };
    order.amount += amount;
    pair.orders.set(orderCode, order);
    if (/^\d{4}$/.test(family) && amount > 0) pair.byFamily.set(family, (pair.byFamily.get(family) ?? 0) + amount);
    if (date) {
      if (pair.first === null || date < pair.first) pair.first = date;
      if (pair.last === null || date > pair.last) pair.last = date;
    }
    this.pairs.set(key, pair);
  }

  rows(input: { windowStart: string; windowEnd: string; minPairAmount?: number }): ClSupplierLinkRow[] {
    const min = input.minPairAmount ?? CL_CHILECOMPRA_MIN_PAIR_AMOUNT_CLP;
    const out: ClSupplierLinkRow[] = [];
    for (const pair of this.pairs.values()) {
      if (pair.total < min) continue;
      const buyer = this.buyers.get(pair.buyerCode);
      if (!buyer) continue;
      const top = [...pair.orders.entries()].sort((a, b) => b[1].amount - a[1].amount)[0];
      const buyerRut = [...buyer.unitRuts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      out.push({
        country_code: 'CL',
        source_key: CL_CHILECOMPRA_ORDERS_SOURCE_KEY,
        buyer_code: pair.buyerCode,
        buyer_tax_id: buyerRut,
        buyer_name: buyer.name,
        buyer_name_normalized: normalizeClBuyerName(buyer.name),
        buyer_sector: buyer.sector,
        supplier_tax_id: pair.supplierRut,
        supplier_name: pair.supplierName,
        total_amount: Math.round(pair.total),
        currency: 'CLP',
        order_count: pair.orders.size,
        amount_by_family: Object.fromEntries([...pair.byFamily.entries()].map(([k, v]) => [k, Math.round(v)])),
        first_order_on: pair.first,
        last_order_on: pair.last,
        top_order_code: top?.[0] ?? null,
        top_order_url: top?.[1].url ?? null,
        top_order_amount: top ? Math.round(top[1].amount) : null,
        window_start: input.windowStart,
        window_end: input.windowEnd,
      });
    }
    return out.sort((a, b) => b.total_amount - a.total_amount);
  }
}

/** Fila leída de `public_procurement_supplier_links` (lo que usa la búsqueda). */
export type ClStoredLink = {
  buyer_code: string;
  buyer_name_normalized: string;
  supplier_tax_id: string;
  supplier_name: string;
  total_amount: number | string;
  order_count: number;
  amount_by_family: Record<string, number | string> | null;
  last_order_on: string | null;
  top_order_url: string | null;
  window_start: string;
};

/** Entidades compradoras distintas (una por código) a partir de sus filas. */
export function clBuyersFromLinks(rows: readonly Pick<ClStoredLink, 'buyer_code' | 'buyer_name_normalized'>[]): PublicEntityRow[] {
  const byCode = new Map<string, PublicEntityRow>();
  for (const row of rows) {
    if (!byCode.has(row.buyer_code)) {
      byCode.set(row.buyer_code, { taxId: row.buyer_code, normalizedLegalName: row.buyer_name_normalized, shortName: null, isHead: false });
    }
  }
  return [...byCode.values()];
}

/**
 * Proveedores de la entidad en la industria pedida (ya ordenados por monto): la
 * industria de cada uno es la de lo que más le vende a ESA entidad, con la misma
 * tabla y regla del 50 % que Colombia y Paraguay.
 */
export function clSuppliersFromLinks(rows: readonly ClStoredLink[], macroIndustryKey: string): PublicBuyerSuppliersResult {
  const suppliers: PublicBuyerSupplier[] = [];
  for (const row of rows) {
    const byFamily: Record<string, number> = {};
    for (const [family, amount] of Object.entries(row.amount_by_family ?? {})) byFamily[family] = Number(amount);
    const macro = resolvePyDncpSupplierMacro(byFamily);
    if (!macro || macro.macroIndustryKey !== macroIndustryKey) continue;
    const topFamily = Object.entries(byFamily).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    suppliers.push({
      taxId: row.supplier_tax_id,
      name: row.supplier_name,
      totalAmount: Number(row.total_amount),
      contractCount: row.order_count,
      lastSignedAt: row.last_order_on,
      macroIndustryKey: macro.macroIndustryKey,
      macroShare: macro.share,
      rubro: resolvePyUnspscRubro(topFamily),
      evidenceUrl: clOrderUrl(row.top_order_url),
    });
  }
  return {
    ok: true,
    suppliers,
    read: rows.length,
    outsideIndustry: rows.length - suppliers.length,
    tableVersion: PY_DNCP_MACRO_TABLE_VERSION,
    ...(rows[0]?.window_start ? { sinceYear: rows[0].window_start.slice(0, 4) } : {}),
  };
}
