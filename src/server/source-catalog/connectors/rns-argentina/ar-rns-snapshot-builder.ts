/**
 * ar-rns-snapshot-builder.ts — arma filas de `source_company_snapshots` para
 * `ar_rns`: sociedades argentinas ACTIVAS que son proveedoras del Estado.
 *
 * SOURCES-AR-RNS-1. Puro: sin env, sin I/O, sin DB, sin reloj (la hora de
 * importación se inyecta).
 *
 * Tres fuentes públicas (CC-BY 4.0), cruzadas por CUIT:
 *   - Registro Nacional de Sociedades (Ministerio de Justicia, datos de ARCA):
 *     razón social, tipo societario, domicilio y actividad (CIIU Rev. 4, 6
 *     dígitos, estado AC/BD, orden 1 = principal).
 *   - SIPRO / COMPR.AR: proveedores inscriptos del Estado.
 *   - Adjudicaciones COMPR.AR: montos adjudicados por CUIT.
 *
 * Una empresa entra sólo si (1) su actividad PRINCIPAL está activa (AC) en el
 * RNS y (2) aparece en SIPRO o en adjudicaciones. El importe adjudicado no trae
 * ajuste por inflación: sirve para ORDENAR, no para comparar años.
 */

import { calculateArgentinaCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';
import { deriveTaxRecordIdentity } from '../../record-identity';
import { normalizeArCompanyCore } from './ar-company-name-core';
import type { RecordIdentityKey } from '../../record-identity';
import {
  AR_RNS_MACRO_TABLE_VERSION,
  normalizeArActivityCode,
  resolveArActivityMacro,
} from '@/server/prospect-batches/country-source-discovery/ar-rns-macro-table';

export const AR_RNS_SOURCE_KEY = 'ar_rns' as const;
export const AR_RNS_COUNTRY_CODE = 'AR' as const;

/** Formas societarias que el importador de SIPRO trata como persona física. */
const SIPRO_NATURAL_PERSON = /^persona fisica/i;

/** CUIT con o sin guiones → 11 dígitos con dígito verificador válido, o `null`. */
export function normalizeCuit(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s.-]/g, '');
  if (!/^\d{11}$/.test(digits)) return null;
  const expected = calculateArgentinaCheckDigit(digits.slice(0, 10));
  return expected !== null && expected === digits[10] ? digits : null;
}

/** ¿Es una CUIT de persona jurídica (prefijos 30, 33 y 34)? */
export function isLegalEntityCuit(cuit: string): boolean {
  return /^(30|33|34)/.test(cuit);
}

export type ProcurementAccumulator = {
  awardsCount: number;
  totalArs: number;
  totalUsd: number;
  lastAwardYear: number | null;
};

/** Acumula una adjudicación sobre el acumulador de su CUIT (devuelve uno nuevo). */
export function accumulateAward(
  previous: ProcurementAccumulator | undefined,
  award: { amount: number; currency: string; year: number | null },
): ProcurementAccumulator {
  const base = previous ?? { awardsCount: 0, totalArs: 0, totalUsd: 0, lastAwardYear: null };
  const amount = Number.isFinite(award.amount) && award.amount > 0 ? award.amount : 0;
  const currency = award.currency.trim().toLowerCase();
  return {
    awardsCount: base.awardsCount + 1,
    totalArs: base.totalArs + (currency === 'peso argentino' ? amount : 0),
    totalUsd: base.totalUsd + (currency === 'dolar estadounidense' ? amount : 0),
    lastAwardYear:
      award.year !== null && (base.lastAwardYear === null || award.year > base.lastAwardYear)
        ? award.year
        : base.lastAwardYear,
  };
}

/** ¿Esta fila de SIPRO es una persona jurídica? Las personas físicas no entran. */
export function isSiproLegalEntity(tipoDePersoneria: string | null | undefined): boolean {
  return typeof tipoDePersoneria === 'string' && !SIPRO_NATURAL_PERSON.test(tipoDePersoneria.trim());
}

export type RnsPrincipalActivity = {
  cuit: string;
  legalName: string;
  companyType: string;
  province: string;
  locality: string;
  activityCode: string;
  activityDescription: string;
};

/**
 * De UNA fila del RNS devuelve su actividad principal ACTIVA, o `null` si la fila
 * es otra cosa (actividad secundaria, dada de baja, sin código o CUIT inválido).
 */
export function readRnsPrincipalActivity(row: Record<string, string>): RnsPrincipalActivity | null {
  if ((row['actividad_estado'] ?? '').trim() !== 'AC') return null;
  if ((row['actividad_orden'] ?? '').trim() !== '1') return null;
  const cuit = normalizeCuit(row['cuit']);
  const code = normalizeArActivityCode(row['actividad_codigo']);
  const legalName = (row['razon_social'] ?? '').trim();
  if (cuit === null || code === null || legalName === '') return null;
  return {
    cuit,
    legalName,
    companyType: (row['tipo_societario'] ?? '').trim(),
    province: (row['dom_fiscal_provincia'] ?? '').trim(),
    locality: (row['dom_fiscal_localidad'] ?? '').trim(),
    activityCode: code,
    activityDescription: (row['actividad_descripcion'] ?? '').trim(),
  };
}

export type ArRnsSnapshotRow = {
  source_key: typeof AR_RNS_SOURCE_KEY;
  country_code: typeof AR_RNS_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  department: string | null;
  region: string | null;
  priority_score: number;
  signals: Record<string, unknown>;
  financials: Record<string, unknown>;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Nombre normalizado para búsquedas por nombre: mayúsculas, sin tildes, espacios simples. */
export function normalizeArLegalName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Construye la fila de una proveedora del Estado. `priorityScore` (0-100) es el
 * percentil de su importe adjudicado entre todas las cargadas: la fuente gratuita
 * ordena por él sin tener que ordenar por un campo JSON.
 */
export function buildArRnsSnapshotRow(params: {
  activity: RnsPrincipalActivity;
  procurement: ProcurementAccumulator | null;
  inSipro: boolean;
  priorityScore: number;
  sourceYear: number;
  importedAt: string;
}): ArRnsSnapshotRow {
  const { activity, procurement, inSipro, priorityScore, sourceYear, importedAt } = params;
  const identity = deriveTaxRecordIdentity(activity.cuit);
  const macro = resolveArActivityMacro(activity.activityCode);

  return {
    source_key: AR_RNS_SOURCE_KEY,
    country_code: AR_RNS_COUNTRY_CODE,
    source_year: sourceYear,
    tax_id: activity.cuit,
    normalized_tax_id: activity.cuit,
    legal_name: activity.legalName,
    normalized_legal_name: normalizeArLegalName(activity.legalName),
    sector: activity.activityDescription || null,
    city: activity.locality || null,
    department: null,
    region: activity.province || null,
    priority_score: Math.max(0, Math.min(100, Math.round(priorityScore * 100) / 100)),
    signals: {
      awards_count: procurement?.awardsCount ?? 0,
      total_awarded_ars: procurement?.totalArs ?? 0,
      total_awarded_usd: procurement?.totalUsd ?? 0,
      last_award_year: procurement?.lastAwardYear ?? null,
      in_sipro: inSipro,
    },
    financials: {},
    raw_data: {
      tax_identifier_type: 'CUIT',
      company_type: activity.companyType || null,
      actividad_codigo: activity.activityCode,
      actividad_descripcion: activity.activityDescription || null,
      macro_industry_key: macro,
      macro_table_version: AR_RNS_MACRO_TABLE_VERSION,
      source_type: 'company_registry_and_procurement',
      sector_source: 'arca_ciiu4_principal_activity',
      human_review_required: true,
    },
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Percentil 0-100 de cada importe dentro de la lista (los empates comparten valor). */
export function percentileScores(totals: readonly number[]): number[] {
  if (totals.length === 0) return [];
  const sorted = [...totals].sort((a, b) => a - b);
  const firstIndex = new Map<number, number>();
  sorted.forEach((value, index) => {
    if (!firstIndex.has(value)) firstIndex.set(value, index);
  });
  const denominator = Math.max(sorted.length - 1, 1);
  return totals.map((value) => ((firstIndex.get(value) ?? 0) / denominator) * 100);
}

// ─── SOURCES-AR-CUIT-BY-NAME-1 — registro completo para CUIT por nombre ──────

export const AR_RNS_REGISTRY_SOURCE_KEY = 'ar_rns_registry' as const;

/** Fila MÍNIMA del registro: sólo lo necesario para resolver nombre → CUIT. */
export type ArRnsRegistryRow = {
  source_key: typeof AR_RNS_REGISTRY_SOURCE_KEY;
  country_code: typeof AR_RNS_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/**
 * Fila del registro de sociedades ACTIVAS. `normalized_legal_name` guarda el
 * NÚCLEO del nombre (`normalizeArCompanyCore`), que es exactamente lo que el
 * resolvedor de la corrida calcula para comparar. `null` si el nombre no deja
 * núcleo utilizable.
 */
export function buildArRnsRegistryRow(params: {
  activity: RnsPrincipalActivity;
  sourceYear: number;
  importedAt: string;
}): ArRnsRegistryRow | null {
  const { activity, sourceYear, importedAt } = params;
  const core = normalizeArCompanyCore(activity.legalName);
  if (core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(activity.cuit);
  return {
    source_key: AR_RNS_REGISTRY_SOURCE_KEY,
    country_code: AR_RNS_COUNTRY_CODE,
    source_year: sourceYear,
    tax_id: activity.cuit,
    normalized_tax_id: activity.cuit,
    legal_name: activity.legalName,
    normalized_legal_name: core,
    raw_data: { actividad_codigo: activity.activityCode },
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
