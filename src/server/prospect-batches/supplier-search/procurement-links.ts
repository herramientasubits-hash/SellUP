/**
 * AGENT1-SUPPLIER-SEARCH-ALL-1 — base común de «Proveedores de una empresa» por compras
 * públicas para cualquier país (puro: sin I/O, sin reloj).
 *
 *  - `ProcurementLine`: una línea «quién le compra a quién» en un formato común, que
 *    produce el lector de cada país (OCDS, CSV propio…).
 *  - `ProcurementLinksAggregator`: resume las líneas por entidad compradora × proveedor
 *    empresa en filas de `public_procurement_supplier_links` (migración 150), con piso de
 *    monto acumulado en la ventana. Es el de Chile generalizado.
 *  - `buyersFromLinks` / `suppliersFromLinks`: la búsqueda sobre lo cargado. La industria
 *    del proveedor la decide el país: por su tabla de clasificación (lo que más le vende a
 *    ESA entidad, regla del 50 %) o por la actividad oficial del proveedor (CIIU de su ficha).
 *
 * 🔴 Nunca se guardan personas, contactos, cuentas ni el texto de las órdenes: el lector
 * sólo entrega líneas de proveedores EMPRESA y el resumen guarda montos y la prueba.
 */

import type { PublicBuyerSupplier, PublicBuyerSuppliersResult, PublicEntityRow } from './public-buyer-suppliers';

/** Una línea de compra en formato común (lo que entrega el lector de cada país). */
export type ProcurementLine = {
  /** Código estable de la entidad compradora en la fuente (o su número fiscal). */
  buyerCode: string;
  buyerName: string;
  buyerTaxId?: string | null;
  buyerSector?: string | null;
  /** Número fiscal del proveedor EMPRESA, ya normalizado por el país. */
  supplierTaxId: string;
  supplierName: string;
  /** Monto de la línea en la moneda del país (≥ 0). */
  amount: number;
  /** Orden, contrato o adjudicación a la que pertenece (para contar y elegir la prueba). */
  orderCode: string;
  /** Página pública de esa orden/contrato (https), si la hay. */
  orderUrl?: string | null;
  /** Fecha AAAA-MM-DD de firma/adjudicación/envío. */
  date?: string | null;
  /** Familia de clasificación ya reducida por el país (UNSPSC 4 dígitos, NAICS 4, CPV 2…). */
  classificationKey?: string | null;
};

/** Fila de `public_procurement_supplier_links`. */
export type ProcurementLinkRow = {
  country_code: string;
  source_key: string;
  buyer_code: string;
  buyer_tax_id: string | null;
  buyer_name: string;
  buyer_name_normalized: string;
  buyer_sector: string | null;
  supplier_tax_id: string;
  supplier_name: string;
  total_amount: number;
  currency: string;
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
  supplierTaxId: string;
  supplierName: string;
  total: number;
  orders: Map<string, { amount: number; url: string | null }>;
  byFamily: Map<string, number>;
  first: string | null;
  last: string | null;
};

type BuyerState = { name: string; sector: string | null; taxIds: Map<string, number> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Sólo enlaces https (un http se sube a https; cualquier otro esquema se descarta). */
export function httpsUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (/^https:\/\//i.test(text)) return text;
  if (/^http:\/\//i.test(text)) return `https://${text.slice(7)}`;
  return null;
}

/** Acumula líneas de varios meses y entrega las filas con el piso aplicado. */
export class ProcurementLinksAggregator {
  private readonly pairs = new Map<string, PairState>();
  private readonly buyers = new Map<string, BuyerState>();
  lines = 0;

  constructor(
    private readonly config: {
      countryCode: string;
      sourceKey: string;
      currency: string;
      normalizeBuyerName: (raw: string) => string;
    },
  ) {}

  add(line: ProcurementLine): void {
    const buyerCode = line.buyerCode.trim();
    const supplierTaxId = line.supplierTaxId.trim();
    const orderCode = line.orderCode.trim();
    if (!buyerCode || !supplierTaxId || !orderCode || !line.buyerName.trim()) return;
    this.lines += 1;
    const amount = Number.isFinite(line.amount) && line.amount > 0 ? line.amount : 0;
    const date = line.date && ISO_DATE.test(line.date) ? line.date : null;

    const buyer = this.buyers.get(buyerCode) ?? { name: line.buyerName.trim(), sector: line.buyerSector?.trim() || null, taxIds: new Map() };
    if (line.buyerTaxId) buyer.taxIds.set(line.buyerTaxId, (buyer.taxIds.get(line.buyerTaxId) ?? 0) + 1);
    this.buyers.set(buyerCode, buyer);

    const key = `${buyerCode}|${supplierTaxId}`;
    const pair = this.pairs.get(key) ?? {
      buyerCode,
      supplierTaxId,
      supplierName: line.supplierName.trim() || supplierTaxId,
      total: 0,
      orders: new Map(),
      byFamily: new Map(),
      first: null,
      last: null,
    };
    pair.total += amount;
    const order = pair.orders.get(orderCode) ?? { amount: 0, url: httpsUrl(line.orderUrl) };
    order.amount += amount;
    pair.orders.set(orderCode, order);
    const family = line.classificationKey?.trim();
    if (family && amount > 0) pair.byFamily.set(family, (pair.byFamily.get(family) ?? 0) + amount);
    if (date) {
      if (pair.first === null || date < pair.first) pair.first = date;
      if (pair.last === null || date > pair.last) pair.last = date;
    }
    this.pairs.set(key, pair);
  }

  rows(input: { windowStart: string; windowEnd: string; minPairAmount: number }): ProcurementLinkRow[] {
    const out: ProcurementLinkRow[] = [];
    for (const pair of this.pairs.values()) {
      if (pair.total < input.minPairAmount) continue;
      const buyer = this.buyers.get(pair.buyerCode);
      if (!buyer) continue;
      const top = [...pair.orders.entries()].sort((a, b) => b[1].amount - a[1].amount)[0];
      const buyerTaxId = [...buyer.taxIds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      out.push({
        country_code: this.config.countryCode,
        source_key: this.config.sourceKey,
        buyer_code: pair.buyerCode,
        buyer_tax_id: buyerTaxId,
        buyer_name: buyer.name,
        buyer_name_normalized: this.config.normalizeBuyerName(buyer.name),
        buyer_sector: buyer.sector,
        supplier_tax_id: pair.supplierTaxId,
        supplier_name: pair.supplierName,
        total_amount: Math.round(pair.total),
        currency: this.config.currency,
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

/** Lo que la búsqueda lee de `public_procurement_supplier_links`. */
export type StoredProcurementLink = {
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

/** Entidades compradoras distintas (una por código). */
export function buyersFromLinks(rows: readonly Pick<StoredProcurementLink, 'buyer_code' | 'buyer_name_normalized'>[]): PublicEntityRow[] {
  const byCode = new Map<string, PublicEntityRow>();
  for (const row of rows) {
    if (!byCode.has(row.buyer_code)) {
      byCode.set(row.buyer_code, { taxId: row.buyer_code, normalizedLegalName: row.buyer_name_normalized, shortName: null, isHead: false });
    }
  }
  return [...byCode.values()];
}

/** Industria del proveedor por su clasificación de compras (regla del 50 %). */
export type ProcurementClassifier = {
  tableVersion: string;
  /** Macro dominante por monto (`null` si no hay una con al menos la mitad). */
  classify: (amountByFamily: Readonly<Record<string, number>>) => { macroIndustryKey: string; share: number } | null;
  /** Rubro en palabras de una familia, para la frase de la prueba. */
  rubroOf: (family: string | null) => string | null;
};

/**
 * Proveedores de la entidad en la industria pedida (filas ya ordenadas por monto).
 * `macroByTaxId` (opcional) = industria por la actividad oficial del proveedor (Ecuador,
 * Costa Rica): manda sobre la clasificación de compras cuando está.
 */
export function suppliersFromLinks(
  rows: readonly StoredProcurementLink[],
  macroIndustryKey: string,
  classifier: ProcurementClassifier,
  macroByTaxId?: ReadonlyMap<string, string>,
): PublicBuyerSuppliersResult {
  const suppliers: PublicBuyerSupplier[] = [];
  for (const row of rows) {
    const byFamily: Record<string, number> = {};
    for (const [family, amount] of Object.entries(row.amount_by_family ?? {})) byFamily[family] = Number(amount);
    const byActivity = macroByTaxId?.get(row.supplier_tax_id);
    const macro = byActivity ? { macroIndustryKey: byActivity, share: 1 } : classifier.classify(byFamily);
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
      rubro: classifier.rubroOf(topFamily),
      evidenceUrl: httpsUrl(row.top_order_url),
    });
  }
  return {
    ok: true,
    suppliers,
    read: rows.length,
    outsideIndustry: rows.length - suppliers.length,
    tableVersion: classifier.tableVersion,
    ...(rows[0]?.window_start ? { sinceYear: rows[0].window_start.slice(0, 4) } : {}),
  };
}

/** Clasificador UNSPSC con la tabla aprobada (Colombia, Chile, Paraguay, Perú…). */
export { UNSPSC_CLASSIFIER } from './unspsc-classifier';
