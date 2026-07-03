/**
 * COMPRASAL El Salvador — Signal Builder
 *
 * Agrupa adjudicaciones normalizadas por proveedor y construye señales
 * procurement en memoria. NO escribe en base de datos.
 *
 * Guardrail:
 *   - signal_strength = 'weak_name_only' siempre.
 *   - matching_mode = 'name_only_review_required' siempre.
 *   - tax_id = null siempre.
 *   - normalized_tax_id = null siempre.
 *
 * Hito: Centroamérica.7C
 */

import type { NormalizedAdjudicacion } from './comprasal-sv-normalizer';

export type ComprasalSampleAward = {
  award_id: string;
  process_code: string;
  process_name: string;
  institution_name: string;
  amount: number;
  award_date: string | null;
};

export type ComprasalProcurementSignal = {
  source_key: 'sv_comprasal';
  country_code: 'SV';
  source_type: 'procurement_signal';
  signal_strength: 'weak_name_only';
  matching_mode: 'name_only_review_required';
  supplier_name: string;
  supplier_commercial_name: string | null;
  supplier_platform_id: string;
  normalized_supplier_name: string;
  tax_id: null;
  normalized_tax_id: null;
  awards_count: number;
  total_awarded_amount: number;
  latest_award_date: string | null;
  sample_awards: ComprasalSampleAward[];
  limitations: string[];
};

const SIGNAL_LIMITATIONS = [
  'No fiscal identifier exposed publicly',
  'Name-only signal requires human review',
  'No NIT/NRC available in COMPRASAL public endpoints',
  'Not a legal or tax registry — does not replace Ministerio de Hacienda or CNR',
];

export function buildProcurementSignals(
  adjudicaciones: NormalizedAdjudicacion[],
): ComprasalProcurementSignal[] {
  const bySupplier = new Map<string, NormalizedAdjudicacion[]>();

  for (const adj of adjudicaciones) {
    const key = adj.normalized_supplier_name;
    if (!key) continue;
    const group = bySupplier.get(key) ?? [];
    group.push(adj);
    bySupplier.set(key, group);
  }

  const signals: ComprasalProcurementSignal[] = [];

  for (const [normalizedName, group] of bySupplier) {
    const first = group[0];
    const totalAmount = group.reduce((sum, a) => sum + a.monto, 0);
    const dates = group.map((a) => a.award_date).filter(Boolean) as string[];
    const latestDate = dates.length > 0 ? (dates.sort().at(-1) ?? null) : null;

    const sampleAwards: ComprasalSampleAward[] = group.slice(0, 3).map((a) => ({
      award_id: a.award_id,
      process_code: a.process_code,
      process_name: a.process_name,
      institution_name: a.institution_name,
      amount: a.monto,
      award_date: a.award_date,
    }));

    signals.push({
      source_key: 'sv_comprasal',
      country_code: 'SV',
      source_type: 'procurement_signal',
      signal_strength: 'weak_name_only',
      matching_mode: 'name_only_review_required',
      supplier_name: first.supplier_name,
      supplier_commercial_name: first.supplier_commercial_name,
      supplier_platform_id: first.supplier_platform_id,
      normalized_supplier_name: normalizedName,
      tax_id: null,
      normalized_tax_id: null,
      awards_count: group.length,
      total_awarded_amount: totalAmount,
      latest_award_date: latestDate,
      sample_awards: sampleAwards,
      limitations: SIGNAL_LIMITATIONS,
    });
  }

  return signals;
}

export type DryRunSummary = {
  pages_read: number;
  adjudicaciones_read: number;
  unique_suppliers: number;
  suppliers_with_commercial_name: number;
  total_awarded_amount: number;
  latest_award_date: string | null;
  signals_built: number;
  db_writes: 0;
  errors: string[];
};

export function buildDryRunSummary(
  signals: ComprasalProcurementSignal[],
  pagesRead: number,
  adjudicacionesRead: number,
  errors: string[],
): DryRunSummary {
  const totalAmount = signals.reduce((s, sig) => s + sig.total_awarded_amount, 0);
  const dates = signals.map((s) => s.latest_award_date).filter(Boolean) as string[];
  const latestDate = dates.length > 0 ? (dates.sort().at(-1) ?? null) : null;
  const withCommercialName = signals.filter((s) => s.supplier_commercial_name !== null).length;

  return {
    pages_read: pagesRead,
    adjudicaciones_read: adjudicacionesRead,
    unique_suppliers: signals.length,
    suppliers_with_commercial_name: withCommercialName,
    total_awarded_amount: totalAmount,
    latest_award_date: latestDate,
    signals_built: signals.length,
    db_writes: 0,
    errors,
  };
}
