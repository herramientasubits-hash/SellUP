/**
 * COMPRASAL El Salvador — Adaptador → source_company_signals
 *
 * Convierte ComprasalProcurementSignal al contrato SourceCompanySignal.
 * Puro: sin Supabase, sin efectos secundarios, sin tax_id.
 *
 * Guardrails:
 *   - source_key fijo: sv_comprasal
 *   - country_code fijo: SV
 *   - signal_kind fijo: procurement
 *   - signal_strength fijo: weak_name_only
 *   - matching_mode fijo: name_only_review_required
 *   - human_review_required fijo: true
 *   - supplier_platform_id es ID interno COMPRASAL, NO identificador fiscal
 *   - Ningún campo fiscal (tax_id, nit, nrc, ruc, rut, rnc...) en el output
 *   - Descarta señales sin supplier_name o normalized_supplier_name
 *
 * Hito: Centroamérica.7E.2A
 */

import type { ComprasalProcurementSignal } from './comprasal-sv-signal-builder';
import {
  validateSourceCompanySignal,
  type SourceCompanySignal,
} from '../../signals/source-company-signals';

// -------------------------------------------------------
// Tipo de resultado del adaptador
// -------------------------------------------------------

export type AdapterResult =
  | { ok: true; signal: SourceCompanySignal }
  | { ok: false; reason: string; input: ComprasalProcurementSignal };

// -------------------------------------------------------
// Adaptador principal
// -------------------------------------------------------

/**
 * Adapta una señal COMPRASAL al contrato SourceCompanySignal.
 * Si falta supplier_name o normalized_supplier_name, devuelve ok=false.
 */
export function adaptComprasalSignal(
  signal: ComprasalProcurementSignal,
  sourceYear: number,
): AdapterResult {
  const supplierName = signal.supplier_name?.trim();
  const normalizedSupplierName = signal.normalized_supplier_name?.trim();

  if (!supplierName) {
    return { ok: false, reason: 'missing supplier_name', input: signal };
  }
  if (!normalizedSupplierName) {
    return { ok: false, reason: 'missing normalized_supplier_name', input: signal };
  }

  const output: SourceCompanySignal = {
    source_key: 'sv_comprasal',
    country_code: 'SV',
    source_year: sourceYear,

    signal_kind: 'procurement',
    signal_strength: 'weak_name_only',
    matching_mode: 'name_only_review_required',
    human_review_required: true,

    supplier_name: supplierName,
    normalized_supplier_name: normalizedSupplierName,
    supplier_commercial_name: signal.supplier_commercial_name ?? null,
    normalized_supplier_commercial_name: signal.supplier_commercial_name
      ? signal.supplier_commercial_name.trim().toLowerCase() || null
      : null,

    // ID interno de COMPRASAL. NO es identificador fiscal ni tax_id.
    supplier_platform_id: signal.supplier_platform_id ?? null,

    source_record_id: null,
    source_url: null,

    signals: {
      total_awarded_amount: signal.total_awarded_amount,
      awards_count: signal.awards_count,
      latest_award_date: signal.latest_award_date,
      sample_awards: signal.sample_awards,
      limitations: signal.limitations,
    },

    raw_data: {
      source_type: signal.source_type,
    },

    metadata: {
      adapter_version: '7E.2A',
      source: 'sv_comprasal',
    },

    first_seen_at: signal.latest_award_date ?? null,
    last_seen_at: signal.latest_award_date ?? null,
  };

  const errors = validateSourceCompanySignal(output);
  if (errors.length > 0) {
    return { ok: false, reason: errors.join('; '), input: signal };
  }

  return { ok: true, signal: output };
}

// -------------------------------------------------------
// Adaptador en batch
// -------------------------------------------------------

export type BatchAdapterResult = {
  adapted: SourceCompanySignal[];
  skipped: Array<{ reason: string; input: ComprasalProcurementSignal }>;
};

export function adaptComprasalSignals(
  signals: ComprasalProcurementSignal[],
  sourceYear: number,
): BatchAdapterResult {
  const adapted: SourceCompanySignal[] = [];
  const skipped: Array<{ reason: string; input: ComprasalProcurementSignal }> = [];

  for (const signal of signals) {
    const result = adaptComprasalSignal(signal, sourceYear);
    if (result.ok) {
      adapted.push(result.signal);
    } else {
      skipped.push({ reason: result.reason, input: result.input });
    }
  }

  return { adapted, skipped };
}
