/**
 * do-size-registry-rows.ts — las dos fuentes derivadas del padrón DGII que se
 * cargan para República Dominicana.
 *
 * SOURCES-DO-SIZE-SIGNAL-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * 1. `do_dgii_size_registry` — base del buscador gratuito por industria. Una fila
 *    por empresa ACTIVA en la DGII, con actividad incluida en la tabla aprobada
 *    (`do-dgii-macro-table.ts`) y con señal de tamaño:
 *      nivel 1  Gran Contribuyente Nacional (DGII)
 *      nivel 2  Grande Local (DGII) o «Gran empresa» en compras públicas (DGCP)
 *      nivel 3  Mediana (DGII) o «Mediana empresa» (DGCP)
 *      nivel 4  proveedora del Estado sin clasificar (DGCP)
 *    Quedan FUERA las proveedoras que la DGCP marca como micro o pequeña (hasta 50
 *    empleados, ley MIPYME) y que la DGII no lista como mediana o grande, y las
 *    empresas sin ninguna señal. La clase de la DGII manda sobre la de la DGCP.
 *    Decisión de la dueña, 05-10-2026 («Lista DGII + DGCP»).
 *
 * 2. `do_dgii_trade_name_registry` — RNC por NOMBRE COMERCIAL. Una fila por
 *    empresa activa cuyo nombre comercial tiene un núcleo distinto del de su
 *    razón social («CODETEL» → COMPANIA DOMINICANA DE TELEFONOS S A). Sólo da
 *    pistas, nunca un RNC seguro (decisión de la dueña, 05-10-2026).
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeDominicanCompanyCore } from '@/server/agents/prospect-intake/resolvers/dominican-republic-official-source-resolver';
import {
  classifyDgiiActivityText,
  DO_DGII_MACRO_TABLE_VERSION,
} from '@/server/prospect-batches/country-source-discovery/do-dgii-macro-table';
import type { DgiiLargeTaxpayer } from './do-large-taxpayer-list';

export const DO_DGII_SIZE_REGISTRY_SOURCE_KEY = 'do_dgii_size_registry' as const;
export const DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY = 'do_dgii_trade_name_registry' as const;
export const DO_COUNTRY_CODE = 'DO' as const;

const BUSINESS_RNC = /^\d{9}$/;
/** Núcleo mínimo de un nombre comercial para buscarlo (siglas de 2 letras, no). */
const MIN_TRADE_NAME_CORE = 3;

/** Una fila del padrón DGII, reducida a lo que estas cargas usan. */
export type DoPadronRow = {
  rnc: string | null;
  legalName: string | null;
  tradeName: string | null;
  /** Texto de actividad tal como lo guarda la DGII (cortado a 30 caracteres). */
  sector: string | null;
  isActive: boolean;
};

/** Compras públicas de un RNC, sumadas en todos los años cargados. */
export type DoProcurementSummary = {
  awardedTotalDop: number;
  /** Clasificación MIPYME del proveedor en la DGCP, tal cual («Micro empresa», «No clasificada»…). */
  mipymeClass: string | null;
};

/** Clase de tamaño de la DGCP, reducida. */
export type DgcpSizeClass = 'gran' | 'mediana' | 'micro_pequena' | 'sin_clasificar';

export type DoSizeTier = 1 | 2 | 3 | 4;

type BaseRow = {
  country_code: typeof DO_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

export type DoSizeRegistryRow = BaseRow & {
  source_key: typeof DO_DGII_SIZE_REGISTRY_SOURCE_KEY;
  sector: string;
  priority_score: number;
  signals: Record<string, unknown>;
};

export type DoTradeNameRegistryRow = BaseRow & {
  source_key: typeof DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY;
};

function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
}

/** «Micro empresa», «MIPYME Mujer - Pequeña empresa», «Gran empresa»… → clase reducida. */
export function classifyDgcpMipyme(label: string | null | undefined): DgcpSizeClass {
  const text = (label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  if (text.includes('MICRO') || text.includes('PEQUENA')) return 'micro_pequena';
  if (text.includes('MEDIANA')) return 'mediana';
  if (text.includes('GRAN')) return 'gran';
  return 'sin_clasificar';
}

/**
 * Nivel de tamaño de una empresa, o `null` si no entra. La DGII manda: si la
 * lista una empresa, su clase decide aunque la DGCP diga otra cosa.
 */
export function resolveDoSizeTier(
  dgii: DgiiLargeTaxpayer | undefined,
  procurement: DoProcurementSummary | undefined,
): DoSizeTier | null {
  if (dgii?.dgiiClass === 'gran_nacional') return 1;
  if (dgii?.dgiiClass === 'gran_local') return 2;
  if (dgii?.dgiiClass === 'mediana') return 3;
  if (procurement === undefined) return null;
  switch (classifyDgcpMipyme(procurement.mipymeClass)) {
    case 'gran':
      return 2;
    case 'mediana':
      return 3;
    case 'sin_clasificar':
      return 4;
    default:
      return null;
  }
}

/**
 * Puntuación para ordenar sin leer JSON: el nivel manda (400/300/200/100) y,
 * dentro del nivel, el importe adjudicado (0-99, escala logarítmica).
 */
export function doSizePriorityScore(tier: DoSizeTier, awardedTotalDop: number): number {
  const amount = Number.isFinite(awardedTotalDop) && awardedTotalDop > 0 ? awardedTotalDop : 0;
  const amountScore = Math.min(99, Math.round(Math.log10(1 + amount) * 9 * 100) / 100);
  return (5 - tier) * 100 + amountScore;
}

function identityOf(rnc: string): RecordIdentityKey | null {
  const identity = deriveTaxRecordIdentity(rnc);
  return identity.status === 'resolved' ? identity.recordIdentityKey : null;
}

/** Filas de `do_dgii_size_registry`, ordenadas por RNC. */
export function buildDoSizeRegistryRows(params: {
  padron: Iterable<DoPadronRow>;
  largeTaxpayers: ReadonlyMap<string, DgiiLargeTaxpayer>;
  procurement: ReadonlyMap<string, DoProcurementSummary>;
  sourceYear: number;
  importedAt: string;
}): DoSizeRegistryRow[] {
  const byRnc = new Map<string, DoSizeRegistryRow>();
  for (const row of params.padron) {
    const rnc = row.rnc?.trim() ?? '';
    const legalName = clean(row.legalName);
    if (!row.isActive || !BUSINESS_RNC.test(rnc) || legalName === null || byRnc.has(rnc)) continue;

    const classification = classifyDgiiActivityText(row.sector);
    if (classification === null || row.sector === null) continue;

    const dgii = params.largeTaxpayers.get(rnc);
    const procurement = params.procurement.get(rnc);
    const tier = resolveDoSizeTier(dgii, procurement);
    if (tier === null) continue;

    const awarded = procurement?.awardedTotalDop ?? 0;
    byRnc.set(rnc, {
      source_key: DO_DGII_SIZE_REGISTRY_SOURCE_KEY,
      country_code: DO_COUNTRY_CODE,
      source_year: params.sourceYear,
      tax_id: rnc,
      normalized_tax_id: rnc,
      legal_name: legalName,
      // Igual que el padrón (mayúsculas, con forma societaria): el candidato llega
      // al detector de duplicados con el mismo nombre que antes de esta carga.
      normalized_legal_name: legalName.toUpperCase(),
      sector: row.sector,
      priority_score: doSizePriorityScore(tier, awarded),
      signals: { size_tier: tier, awarded_total_dop: awarded },
      raw_data: {
        tax_identifier_type: 'RNC',
        trade_name: clean(row.tradeName),
        macro_industry_key: classification.macroIndustryKey,
        macro_table_version: DO_DGII_MACRO_TABLE_VERSION,
        size_tier: tier,
        dgii_size_class: dgii?.dgiiClass ?? null,
        dgcp_mipyme_class: procurement?.mipymeClass ?? null,
        is_state_supplier: procurement !== undefined,
        awarded_total_dop: awarded,
        source_type: 'dgii_registry_with_size_signal',
      },
      imported_at: params.importedAt,
      record_identity_key: identityOf(rnc),
    });
  }
  return [...byRnc.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
}

/** Filas de `do_dgii_trade_name_registry`, ordenadas por RNC. */
export function buildDoTradeNameRegistryRows(params: {
  padron: Iterable<DoPadronRow>;
  sourceYear: number;
  importedAt: string;
}): DoTradeNameRegistryRow[] {
  const byRnc = new Map<string, DoTradeNameRegistryRow>();
  for (const row of params.padron) {
    const rnc = row.rnc?.trim() ?? '';
    const legalName = clean(row.legalName);
    const tradeName = clean(row.tradeName);
    if (!row.isActive || !BUSINESS_RNC.test(rnc) || legalName === null || tradeName === null) continue;
    if (byRnc.has(rnc)) continue;

    const tradeCore = normalizeDominicanCompanyCore(tradeName);
    if (tradeCore.length < MIN_TRADE_NAME_CORE) continue;
    // Si el nombre comercial es la misma razón social, ya lo encuentra el padrón.
    if (tradeCore === normalizeDominicanCompanyCore(legalName)) continue;

    byRnc.set(rnc, {
      source_key: DO_DGII_TRADE_NAME_REGISTRY_SOURCE_KEY,
      country_code: DO_COUNTRY_CODE,
      source_year: params.sourceYear,
      tax_id: rnc,
      normalized_tax_id: rnc,
      legal_name: legalName,
      normalized_legal_name: tradeCore,
      raw_data: { tax_identifier_type: 'RNC', trade_name: tradeName, source_type: 'dgii_trade_name' },
      imported_at: params.importedAt,
      record_identity_key: identityOf(rnc),
    });
  }
  return [...byRnc.values()].sort((a, b) => a.normalized_tax_id.localeCompare(b.normalized_tax_id));
}
