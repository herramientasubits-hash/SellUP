/**
 * Brasil — «Proveedores de una empresa» por compras públicas, EN VIVO por comprador
 * (consultas en `br.server.ts`). Aquí, lo puro: configuración, número fiscal, lectura de
 * las respuestas y agregado por proveedor.
 *
 *  - Órgão FEDERAL ⇒ Compras.gov.br dados abertos (`modulo-contratos/2_consultarContratosItem`,
 *    ~2 s por página de 500): cada ítem trae su código CATMAT/CATSER ⇒ industria por la
 *    tabla BORRADOR `br-catmat-macro-table.ts` (lo que le vende a ESA entidad, regla del 50 %).
 *  - Estados y municipios ⇒ PNCP `consulta/v1/contratos` filtrando `cnpjOrgao` (lento:
 *    10–30 s por página de 500; tope de páginas) y sin catálogo ⇒ industria por la actividad
 *    CNAE del proveedor en `br_receita_registry` (tabla aprobada `br-receita-macro-table.ts`).
 *
 * Proveedor = CNPJ de persona jurídica (14 caracteres con dígito verificador válido): fuera
 * personas físicas (CPF), extranjeros sin CNPJ y entidades públicas (natureza jurídica 1xxx
 * en la Receita, ver `br.server.ts`). Las filiales se juntan en su matriz: raíz de 8 dígitos
 * + «0001» + dígito verificador = el CNPJ completo con el que la Receita la tiene cargada.
 *
 * 🔴 Nunca se guardan personas, contactos ni el texto de los contratos.
 */

import { computeBrazilCnpjCheckDigits, normalizeBrazilCnpj } from '@/server/source-catalog/connectors/br-receita-cnpj/br-cnpj';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LiveCountrySource } from './types';

/** `source_key` de las filas que entran por aquí (y de su entrada del Catálogo de fuentes). */
export const BR_PUBLIC_PROCUREMENT_SOURCE_KEY = 'br_compras_pncp_buyer_suppliers';
/** Piso acumulado entidad × proveedor en la ventana (~US$10 mil). */
export const BR_MIN_PAIR_AMOUNT_BRL = 55_000;
/** Proveedores que se miran (los de más monto) para preseleccionar por su actividad. */
export const BR_SUPPLIER_SCAN_LIMIT = 400;
/** Proveedores que se clasifican por catálogo: los de más monto + los de actividad de la industria. */
export const BR_SUPPLIER_LIMIT = 60;
/** De esos, cuántos entran siempre por monto (aunque su actividad sea otra o no se conozca). */
export const BR_SUPPLIER_TOP_BY_AMOUNT = 20;

export const BR_COMPRAS_ITEMS_URL = 'https://dadosabertos.compras.gov.br/modulo-contratos/2_consultarContratosItem';
export const BR_COMPRAS_ORGAO_URL = 'https://dadosabertos.compras.gov.br/modulo-uasg/2_consultarOrgao';
export const BR_CATMAT_ITEM_URL = 'https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial';
export const BR_CATSER_ITEM_URL = 'https://dadosabertos.compras.gov.br/modulo-servico/6_consultarItemServico';
export const BR_PNCP_CONTRACTS_URL = 'https://pncp.gov.br/api/consulta/v1/contratos';

/**
 * Nombre del comprador como lo escribe la Receita («Ministério da Saúde» → «MINISTERIO DA
 * SAUDE»). La Receita llama «MUNICIPIO DE X» a la prefeitura: «Prefeitura (Municipal) de
 * Campinas» → «MUNICIPIO DE CAMPINAS».
 */
export function normalizeBrBuyerName(raw: string): string {
  return normalizePublicEntityName(raw).replace(/^PREFEITURA (?:MUNICIPAL )?(DE|DO|DA|DOS|DAS) /, 'MUNICIPIO $1 ');
}

export const BR_COUNTRY: LiveCountrySource = {
  kind: 'live',
  countryCode: 'BR',
  sourceKey: BR_PUBLIC_PROCUREMENT_SOURCE_KEY,
  taxIdentifierType: 'CNPJ',
  normalizeBuyerName: normalizeBrBuyerName,
};

/** CNPJ válido de 14 caracteres (sin puntuación), o `null` (CPF, extranjero, DV inválido). */
export function brSupplierCnpj(raw: unknown): string | null {
  const result = normalizeBrazilCnpj(typeof raw === 'string' ? raw : null);
  return result.status === 'valid' ? result.normalized : null;
}

/** CNPJ de la matriz de cualquier CNPJ (filial «…/0006-31» → «…/0001-DV»). */
export function brMatrizCnpj(cnpj: string): string {
  const root = cnpj.slice(0, 8);
  return `${root}0001${computeBrazilCnpjCheckDigits(`${root}0001`)}`;
}

/** Formas en que puede estar guardado el CNPJ en `source_company_snapshots` (con y sin puntuación). */
export function brCnpjForms(cnpj: string): string[] {
  return [cnpj, `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`];
}

/** «00394544000185-2-009670/2026» → página pública del contrato en el PNCP. */
export function brPncpContractUrl(numeroControle: unknown): string | null {
  const match = /^(\d{14})-\d+-0*(\d+)\/(\d{4})$/.exec(typeof numeroControle === 'string' ? numeroControle.trim() : '');
  return match ? `https://pncp.gov.br/app/contratos/${match[1]}/${match[3]}/${match[2]}` : null;
}

/** Fecha «AAAA-MM-DD» de una fecha de la fuente («2026-09-10T00:00:00»). */
function isoDay(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Una línea de compra de Brasil (un ítem de Compras.gov.br o un contrato del PNCP). */
export type BrProcurementLine = {
  /** CNPJ de la matriz del proveedor. */
  supplierTaxId: string;
  supplierName: string;
  contractKey: string;
  amount: number;
  date: string | null;
  evidenceUrl: string | null;
  /** Ítem del catálogo (sólo Compras.gov.br): «Material»/«Serviço» + código del ítem. */
  catalogItem?: { tipo: 'Material' | 'Serviço'; code: number } | null;
};

/** Ítems de contratos de Compras.gov.br → líneas de proveedores EMPRESA. */
export function parseBrComprasItems(payload: unknown): BrProcurementLine[] {
  const rows = asRecord(payload)?.resultado;
  if (!Array.isArray(rows)) return [];
  const out: BrProcurementLine[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row || row.contratoExcluido === true || row.contratoItemExcluido === true) continue;
    const cnpj = brSupplierCnpj(row.niFornecedor);
    const name = asText(row.nomeRazaoSocialFornecedor);
    if (!cnpj || !name) continue;
    const contractKey = asText(row.numeroControlePncpContrato) ?? `${asText(row.codigoUnidadeGestora) ?? ''}|${asText(row.numeroContrato) ?? ''}`;
    const amount = asAmount(row.valorTotalItem) || asAmount(row.quantidadeItem) * asAmount(row.valorUnitarioItem);
    const tipo = asText(row.tipoItem)?.toUpperCase() ?? '';
    const code = Number(row.codigoItem);
    out.push({
      supplierTaxId: brMatrizCnpj(cnpj),
      supplierName: name,
      contractKey,
      amount,
      date: isoDay(row.dataVigenciaInicial),
      evidenceUrl: brPncpContractUrl(row.numeroControlePncpContrato),
      catalogItem:
        Number.isInteger(code) && code > 0 && (tipo.startsWith('MATERIAL') || tipo.startsWith('SERVI'))
          ? { tipo: tipo.startsWith('MATERIAL') ? 'Material' : 'Serviço', code }
          : null,
    });
  }
  return out;
}

/** Contratos del PNCP → líneas de proveedores EMPRESA (`tipoPessoa` PJ con CNPJ válido). */
export function parseBrPncpContracts(payload: unknown): BrProcurementLine[] {
  const rows = asRecord(payload)?.data;
  if (!Array.isArray(rows)) return [];
  const out: BrProcurementLine[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row || row.tipoPessoa !== 'PJ') continue;
    const cnpj = brSupplierCnpj(row.niFornecedor);
    const name = asText(row.nomeRazaoSocialFornecedor);
    const buyerCnpj = asText(asRecord(row.orgaoEntidade)?.cnpj);
    const year = Number(row.anoContrato);
    const seq = Number(row.sequencialContrato);
    if (!cnpj || !name) continue;
    const contractKey = asText(row.numeroControlePNCP) ?? `${buyerCnpj ?? ''}|${year}|${seq}`;
    out.push({
      supplierTaxId: brMatrizCnpj(cnpj),
      supplierName: name,
      contractKey,
      amount: asAmount(row.valorGlobal),
      date: isoDay(row.dataAssinatura) ?? isoDay(row.dataVigenciaInicio),
      evidenceUrl:
        buyerCnpj && /^\d{14}$/.test(buyerCnpj) && Number.isInteger(year) && Number.isInteger(seq) && seq > 0
          ? `https://pncp.gov.br/app/contratos/${buyerCnpj}/${year}/${seq}`
          : null,
    });
  }
  return out;
}

/** Un proveedor agregado con la entidad. */
export type BrSupplierAggregate = {
  taxId: string;
  name: string;
  totalAmount: number;
  contractCount: number;
  lastSignedAt: string | null;
  evidenceUrl: string | null;
  /** «Material:396174» → monto, para buscar su clase en el catálogo. */
  amountByItem: Map<string, number>;
};

/** Clave de un ítem del catálogo («Material:396174»). */
export function brItemKey(item: { tipo: 'Material' | 'Serviço'; code: number }): string {
  return `${item.tipo}:${item.code}`;
}

/**
 * Suma por proveedor (matriz), con el piso aplicado y de más a menos monto. La entidad
 * misma (o una filial suya) nunca sale.
 */
export function aggregateBrSuppliers(
  lines: readonly BrProcurementLine[],
  input: { buyerCnpj: string; minAmount: number; limit: number },
): BrSupplierAggregate[] {
  const buyerRoot = input.buyerCnpj.slice(0, 8);
  const bySupplier = new Map<
    string,
    { name: string; total: number; contracts: Map<string, { amount: number; url: string | null }>; last: string | null; items: Map<string, number> }
  >();
  for (const line of lines) {
    if (line.supplierTaxId.slice(0, 8) === buyerRoot) continue;
    const state = bySupplier.get(line.supplierTaxId) ?? { name: line.supplierName, total: 0, contracts: new Map(), last: null, items: new Map() };
    state.total += line.amount;
    const contract = state.contracts.get(line.contractKey) ?? { amount: 0, url: line.evidenceUrl };
    contract.amount += line.amount;
    state.contracts.set(line.contractKey, contract);
    if (line.date && (state.last === null || line.date > state.last)) state.last = line.date;
    if (line.catalogItem && line.amount > 0) {
      const key = brItemKey(line.catalogItem);
      state.items.set(key, (state.items.get(key) ?? 0) + line.amount);
    }
    bySupplier.set(line.supplierTaxId, state);
  }
  const out: BrSupplierAggregate[] = [];
  for (const [taxId, state] of bySupplier) {
    if (state.total < input.minAmount) continue;
    const top = [...state.contracts.values()].sort((a, b) => b.amount - a.amount)[0];
    out.push({
      taxId,
      name: state.name,
      totalAmount: Math.round(state.total),
      contractCount: state.contracts.size,
      lastSignedAt: state.last,
      evidenceUrl: top?.url ?? null,
      amountByItem: state.items,
    });
  }
  return out.sort((a, b) => b.totalAmount - a.totalAmount).slice(0, input.limit);
}

/**
 * Ítems a buscar en el catálogo: de cada proveedor, los de más monto hasta cubrir
 * `coverage` de lo suyo (máximo `perSupplier`), sin pasar de `cap` en total.
 */
export function brItemsToLookup(
  suppliers: readonly BrSupplierAggregate[],
  options: { perSupplier: number; coverage: number; cap: number },
): string[] {
  const picked = new Set<string>();
  for (const supplier of suppliers) {
    const items = [...supplier.amountByItem.entries()].sort((a, b) => b[1] - a[1]);
    const total = items.reduce((sum, [, amount]) => sum + amount, 0);
    let covered = 0;
    for (const [key, amount] of items.slice(0, options.perSupplier)) {
      if (picked.size >= options.cap) return [...picked];
      picked.add(key);
      covered += amount;
      if (covered >= total * options.coverage) break;
    }
  }
  return [...picked];
}

/** Monto por familia del catálogo de un proveedor (sólo los ítems cuya clase se conoce). */
export function brAmountByFamily(supplier: BrSupplierAggregate, familyByItem: ReadonlyMap<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, amount] of supplier.amountByItem) {
    const family = familyByItem.get(key);
    if (family) out[family] = (out[family] ?? 0) + amount;
  }
  return out;
}

/**
 * Páginas a leer cuando no se pueden leer todas: la 1 y el resto repartidas en la
 * ventana (las páginas vienen por fecha: así la muestra cubre todo el año, no sólo el
 * primer mes).
 */
export function spreadPages(totalPages: number, maxPages: number): number[] {
  if (totalPages <= maxPages) return Array.from({ length: Math.max(0, totalPages) }, (_, i) => i + 1);
  const pages = new Set<number>([1]);
  for (let i = 1; i < maxPages; i += 1) pages.add(1 + Math.round((i * (totalPages - 1)) / (maxPages - 1)));
  return [...pages].sort((a, b) => a - b);
}

/** Ventana de 12 meses que termina hoy: «2025-10-15» … «2026-10-15». */
export function brWindow(nowIso: string): { start: string; end: string } {
  const end = nowIso.slice(0, 10);
  const year = Number(end.slice(0, 4));
  const monthDay = end.slice(4) === '-02-29' ? '-02-28' : end.slice(4);
  return { start: `${year - 1}${monthDay}`, end };
}

/**
 * Proveedores a clasificar por catálogo: los `top` de más monto siempre y, después, los
 * que la Receita pone en la industria pedida (CNAE), hasta `limit`, de más a menos monto.
 * Así una entidad que compra sobre todo medicamentos también deja ver a sus proveedores de
 * tecnología.
 */
export function pickBrCandidates(
  suppliers: readonly BrSupplierAggregate[],
  input: { macroOfTaxId: (taxId: string) => string | null; macroIndustryKey: string; top: number; limit: number },
): BrSupplierAggregate[] {
  const picked = suppliers.slice(0, input.top);
  for (const supplier of suppliers.slice(input.top)) {
    if (picked.length >= input.limit) break;
    if (input.macroOfTaxId(supplier.taxId) === input.macroIndustryKey) picked.push(supplier);
  }
  return picked;
}
