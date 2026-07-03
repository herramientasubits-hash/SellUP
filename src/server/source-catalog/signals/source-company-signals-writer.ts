/**
 * source_company_signals — Writer controlado
 *
 * Expone upsert preparado con modo dry-run obligatorio.
 *
 * Guardrails:
 *   - dryRun=true: solo valida, NUNCA llama métodos de escritura Supabase.
 *   - dryRun=false: lógica preparada pero NO ejecutar en hito 7E.2A.
 *   - Rechaza señales con guardrails inválidos (ver reglas sv_comprasal).
 *   - Rechaza señales con campos fiscales en top-level.
 *   - Conflict target: (source_key, country_code, source_year, normalized_supplier_name).
 *
 * Hito: Centroamérica.7E.2A
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  validateSourceCompanySignal,
  buildSourceCompanySignalDedupeKey,
  type SourceCompanySignal,
} from './source-company-signals';

// -------------------------------------------------------
// Constantes de guardrails por fuente
// -------------------------------------------------------

const SV_COMPRASAL_GUARDRAILS = {
  source_key: 'sv_comprasal',
  signal_strength: 'weak_name_only',
  matching_mode: 'name_only_review_required',
  human_review_required: true,
} as const;

const PROHIBITED_FISCAL_FIELDS = [
  'tax_id',
  'normalized_tax_id',
  'taxIdentifier',
  'tax_identifier',
  'nit',
  'nrc',
  'ruc',
  'rut',
  'rnc',
] as const;

// -------------------------------------------------------
// Tipos de resultado
// -------------------------------------------------------

export type UpsertSourceCompanySignalsResult = {
  dryRun: boolean;
  attempted: number;
  valid: number;
  invalid: number;
  insertedOrUpdated: number;
  skipped: number;
  errors: Array<{ index: number; reason: string }>;
};

// -------------------------------------------------------
// Validación de guardrails sv_comprasal
// -------------------------------------------------------

function validateSvComprasalGuardrails(signal: SourceCompanySignal, index: number): string | null {
  if (signal.source_key === 'sv_comprasal') {
    if (signal.human_review_required !== SV_COMPRASAL_GUARDRAILS.human_review_required) {
      return `[${index}] sv_comprasal: human_review_required must be true`;
    }
    if (signal.matching_mode !== SV_COMPRASAL_GUARDRAILS.matching_mode) {
      return `[${index}] sv_comprasal: matching_mode must be name_only_review_required`;
    }
    if (signal.signal_strength !== SV_COMPRASAL_GUARDRAILS.signal_strength) {
      return `[${index}] sv_comprasal: signal_strength must be weak_name_only`;
    }
  }
  return null;
}

function checkProhibitedFiscalFields(
  signal: SourceCompanySignal,
  index: number,
): string | null {
  const signalAsRecord = signal as Record<string, unknown>;
  for (const field of PROHIBITED_FISCAL_FIELDS) {
    if (field in signalAsRecord && signalAsRecord[field] !== undefined) {
      return `[${index}] prohibited fiscal field found: ${field}`;
    }
  }
  return null;
}

// -------------------------------------------------------
// Upsert principal
// -------------------------------------------------------

export async function upsertSourceCompanySignals(input: {
  supabase: SupabaseClient;
  signals: SourceCompanySignal[];
  dryRun: boolean;
  batchId?: string;
}): Promise<UpsertSourceCompanySignalsResult> {
  const { supabase, signals, dryRun, batchId } = input;

  const errors: Array<{ index: number; reason: string }> = [];
  const validSignals: SourceCompanySignal[] = [];

  // Validar cada señal
  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i]!;

    const guardrailError = validateSvComprasalGuardrails(signal, i);
    if (guardrailError) {
      errors.push({ index: i, reason: guardrailError });
      continue;
    }

    const fiscalError = checkProhibitedFiscalFields(signal, i);
    if (fiscalError) {
      errors.push({ index: i, reason: fiscalError });
      continue;
    }

    const baseErrors = validateSourceCompanySignal(signal);
    if (baseErrors.length > 0) {
      errors.push({ index: i, reason: baseErrors.join('; ') });
      continue;
    }

    validSignals.push(signal);
  }

  if (dryRun) {
    // DRY-RUN: solo valida, NUNCA escribe
    return {
      dryRun: true,
      attempted: signals.length,
      valid: validSignals.length,
      invalid: errors.length,
      insertedOrUpdated: 0,
      skipped: 0,
      errors,
    };
  }

  // APPLY — preparado pero bloqueado hasta hito 7E.2B
  // Conflict target: (source_key, country_code, source_year, normalized_supplier_name)
  const seen = new Set<string>();
  const toUpsert: SourceCompanySignal[] = [];

  for (const signal of validSignals) {
    const key = buildSourceCompanySignalDedupeKey({
      sourceKey: signal.source_key,
      countryCode: signal.country_code,
      sourceYear: signal.source_year,
      normalizedSupplierName: signal.normalized_supplier_name,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    toUpsert.push(signal);
  }

  const skippedDups = validSignals.length - toUpsert.length;

  const rows = toUpsert.map((s) => ({
    source_key: s.source_key,
    country_code: s.country_code,
    source_year: s.source_year,
    signal_kind: s.signal_kind,
    signal_strength: s.signal_strength,
    matching_mode: s.matching_mode,
    human_review_required: s.human_review_required,
    supplier_name: s.supplier_name,
    normalized_supplier_name: s.normalized_supplier_name,
    supplier_commercial_name: s.supplier_commercial_name,
    normalized_supplier_commercial_name: s.normalized_supplier_commercial_name,
    supplier_platform_id: s.supplier_platform_id,
    source_record_id: s.source_record_id,
    source_url: s.source_url,
    signals: s.signals,
    raw_data: s.raw_data,
    metadata: batchId ? { ...s.metadata, batch_id: batchId } : s.metadata,
    first_seen_at: s.first_seen_at,
    last_seen_at: s.last_seen_at,
  }));

  const { error } = await supabase
    .from('source_company_signals')
    .upsert(rows, {
      onConflict: 'source_key,country_code,source_year,normalized_supplier_name',
      ignoreDuplicates: false,
    });

  if (error) {
    return {
      dryRun: false,
      attempted: signals.length,
      valid: validSignals.length,
      invalid: errors.length,
      insertedOrUpdated: 0,
      skipped: skippedDups,
      errors: [
        ...errors,
        { index: -1, reason: `supabase upsert error: ${error.message}` },
      ],
    };
  }

  return {
    dryRun: false,
    attempted: signals.length,
    valid: validSignals.length,
    invalid: errors.length,
    insertedOrUpdated: toUpsert.length,
    skipped: skippedDups,
    errors,
  };
}
