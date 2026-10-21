/**
 * Agente 3 · Primera llamada — «le vende al Estado» (AGENT3-PUBLIC-SALES-1, auditoría de
 * «Proveedores» 21-10, bloque «Próximo»). Puro.
 *
 * Que una empresa le venda a entidades públicas es un motivo concreto y verificable para el
 * primer contacto («vi que trabajan con el IMSS y el ISSSTE…»), con el contrato como prueba.
 * Sale de dos lados, sin pasar por un modelo:
 *  1. Las compras públicas cargadas (`public_procurement_supplier_links`) por el número
 *     fiscal de la cuenta: a cuántas entidades le vende, cuáles y por cuánto.
 *  2. La relación «Proveedor de X» que dejó la búsqueda de proveedores del Agente 1 en la
 *     candidata de la que salió la cuenta (caso de éxito o contrato, con su enlace).
 */

/** Lo que dejó «Proveedores de una empresa» en la candidata de origen. */
export interface SupplierRelationshipEvidence {
  referenceName: string;
  evidence: string | null;
  evidenceUrl: string | null;
  /** `public_procurement` = contrato público; ausente = caso de éxito u otra prueba web. */
  source: 'public_procurement' | 'web';
}

/** Resumen de lo que la empresa le vende al Estado en la ventana cargada. */
export interface PublicSalesSummary {
  countryName: string;
  entityCount: number;
  /** Sus entidades de más monto (hasta 3), tal como vienen de la fuente. */
  topEntities: string[];
  totalAmount: number;
  currency: string;
  orderCount: number;
  firstOrderOn: string | null;
  lastOrderOn: string | null;
  /** La orden más grande, como prueba. */
  evidenceUrl: string | null;
  /** Nombre legible de la fuente («ChileCompra», «Compras MX»…). */
  sourceLabel: string;
}

/** Una fila de `public_procurement_supplier_links` (lo que hace falta para resumir). */
export interface PublicSalesRow {
  buyer_code: string;
  buyer_name: string;
  total_amount: number | string;
  currency: string;
  order_count: number;
  first_order_on: string | null;
  last_order_on: string | null;
  top_order_url: string | null;
  top_order_amount: number | string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function httpsUrl(value: unknown): string | null {
  const url = text(value);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** La relación «Proveedor de X» de la candidata de origen, si la hay. */
export function readSupplierRelationship(candidateMetadata: unknown): SupplierRelationshipEvidence | null {
  const relationship = asRecord(asRecord(candidateMetadata)?.['relationship']);
  if (!relationship || relationship['kind'] !== 'supplier_of') return null;
  const referenceName = text(relationship['reference_company_name']);
  if (!referenceName) return null;
  return {
    referenceName,
    evidence: text(relationship['evidence']),
    evidenceUrl: httpsUrl(relationship['evidence_url']),
    source: relationship['source'] === 'public_procurement' ? 'public_procurement' : 'web',
  };
}

/**
 * Las formas en que puede estar guardado el número fiscal de la cuenta en las compras
 * públicas: tal cual, sin separadores y, para un RUT chileno, con guion antes del dígito.
 */
export function publicSalesTaxIdForms(taxId: string, countryCode: string): string[] {
  const raw = taxId.trim().toUpperCase();
  const compact = raw.replace(/[^0-9A-Z]/g, '');
  const forms = new Set([raw, compact]);
  if (countryCode === 'CL' && compact.length >= 8) forms.add(`${compact.slice(0, -1)}-${compact.slice(-1)}`);
  return [...forms].filter((form) => form.length >= 6);
}

/** Suma las filas (una por entidad compradora). `null` si no hay ninguna. */
export function summarizePublicSales(
  rows: readonly PublicSalesRow[],
  context: { countryName: string; sourceLabel: string },
): PublicSalesSummary | null {
  if (rows.length === 0) return null;
  const byAmount = [...rows].sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
  const entities = new Set(rows.map((r) => r.buyer_code));
  const topNames: string[] = [];
  for (const row of byAmount) {
    const name = row.buyer_name.replace(/\s+/g, ' ').trim();
    if (name && !topNames.includes(name)) topNames.push(name);
    if (topNames.length === 3) break;
  }
  const dates = (key: 'first_order_on' | 'last_order_on') =>
    rows.map((r) => r[key]).filter((d): d is string => typeof d === 'string' && d.length >= 10).sort();
  const firsts = dates('first_order_on');
  const lasts = dates('last_order_on');
  const top = [...rows].sort((a, b) => Number(b.top_order_amount ?? 0) - Number(a.top_order_amount ?? 0)).find((r) => httpsUrl(r.top_order_url));
  return {
    countryName: context.countryName,
    entityCount: entities.size,
    topEntities: topNames,
    totalAmount: rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0),
    currency: rows[0].currency,
    orderCount: rows.reduce((sum, r) => sum + (Number(r.order_count) || 0), 0),
    firstOrderOn: firsts[0] ?? null,
    lastOrderOn: lasts[lasts.length - 1] ?? null,
    evidenceUrl: httpsUrl(top?.top_order_url),
    sourceLabel: context.sourceLabel,
  };
}

const AMOUNT = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** «CLP 1.234 millones» / «USD 85.000». */
export function formatPublicAmount(amount: number, currency: string): string {
  return amount >= 1_000_000
    ? `${currency} ${AMOUNT.format(Math.round(amount / 1_000_000))} millones`
    : `${currency} ${AMOUNT.format(Math.round(amount))}`;
}

/** El hecho, en una frase con cifras exactas (el redactor las repite tal cual). */
export function publicSalesStatement(summary: PublicSalesSummary): string {
  const entities = summary.entityCount === 1 ? '1 entidad pública' : `${summary.entityCount} entidades públicas`;
  const among = summary.topEntities.length > 0 ? ` (entre ellas ${summary.topEntities.join(', ')})` : '';
  const span =
    summary.firstOrderOn && summary.lastOrderOn
      ? ` entre ${summary.firstOrderOn.slice(0, 7)} y ${summary.lastOrderOn.slice(0, 7)}`
      : summary.lastOrderOn
        ? `, la última en ${summary.lastOrderOn.slice(0, 7)}`
        : '';
  const orders = summary.orderCount === 1 ? '1 contrato u orden' : `${summary.orderCount} contratos u órdenes`;
  return `Le vende al Estado de ${summary.countryName}: ${entities}${among}, ${orders} por ${formatPublicAmount(summary.totalAmount, summary.currency)}${span}, según las compras públicas.`;
}

/** «Proveedor de X» de la búsqueda del Agente 1, en una frase. */
export function supplierRelationshipStatement(relationship: SupplierRelationshipEvidence): string {
  const base = `Es proveedor de ${relationship.referenceName}`;
  return relationship.evidence ? `${base}: ${relationship.evidence.replace(/\s+/g, ' ').trim().replace(/\.$/, '')}.` : `${base}.`;
}

/** Nombre legible de cada fuente de compras públicas cargada (por `source_key`). */
export const PUBLIC_SALES_SOURCE_LABELS: Readonly<Record<string, string>> = {
  cl_chilecompra_orders: 'ChileCompra',
  pe_oece_contracts: 'OECE Perú',
  ec_sercop_ocds_awards: 'SERCOP',
  mx_comprasmx_contracts: 'Compras MX',
  gt_guatecompras_awards: 'Guatecompras',
  uy_arce_ocds_awards: 'ARCE',
  cr_sicop_awards: 'SICOP',
  ar_comprar_adjudications: 'COMPR.AR',
  pa_panamacompra_ocds_awards: 'PanamaCompra',
  py_dncp_awards: 'DNCP',
  hn_oncae_awards: 'HonduCompras',
  es_placsp_awards: 'Plataforma de Contratación del Sector Público',
};
