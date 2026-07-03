/**
 * source_company_signals — Tipos, constantes y helpers puros
 *
 * Contrato TypeScript para señales débiles de empresa provenientes de fuentes
 * externas sin identificador fiscal verificable (procurement name-only,
 * directorios, eventos, cámaras de comercio débiles).
 *
 * Guardrail:
 *   - Ningún tipo ni helper aquí maneja tax_id, normalized_tax_id, NIT, NRC.
 *   - Las señales weak_name_only requieren human_review_required = true.
 *   - name_only_review_required requiere human_review_required = true.
 *   - supplier_platform_id NO es identificador fiscal.
 *
 * Hito: Centroamérica.7E.1
 */

// -------------------------------------------------------
// Constantes de valores permitidos (espejo de CHECK constraints SQL)
// -------------------------------------------------------

export const SOURCE_COMPANY_SIGNAL_KINDS = [
  'procurement',
  'industry_directory',
  'event',
  'partner',
  'manual_signal',
  'other',
] as const;

export const SOURCE_COMPANY_SIGNAL_STRENGTHS = [
  'weak_name_only',
  'medium_name_domain',
  'strong_identifier',
  'unknown',
] as const;

export const SOURCE_COMPANY_SIGNAL_MATCHING_MODES = [
  'name_only_review_required',
  'name_domain_review_required',
  'identifier_match_allowed',
  'manual_only',
] as const;

// -------------------------------------------------------
// Tipos derivados
// -------------------------------------------------------

export type SourceCompanySignalKind = (typeof SOURCE_COMPANY_SIGNAL_KINDS)[number];
export type SourceCompanySignalStrength = (typeof SOURCE_COMPANY_SIGNAL_STRENGTHS)[number];
export type SourceCompanySignalMatchingMode = (typeof SOURCE_COMPANY_SIGNAL_MATCHING_MODES)[number];

// -------------------------------------------------------
// Tipo de señal (sin campos fiscales)
// -------------------------------------------------------

export type SourceCompanySignal = {
  source_key: string;
  country_code: string;
  source_year: number;

  signal_kind: SourceCompanySignalKind;
  signal_strength: SourceCompanySignalStrength;
  matching_mode: SourceCompanySignalMatchingMode;
  human_review_required: boolean;

  supplier_name: string;
  normalized_supplier_name: string;
  supplier_commercial_name: string | null;
  normalized_supplier_commercial_name: string | null;

  /** ID interno de la plataforma fuente. NO es tax_id ni identificador fiscal. */
  supplier_platform_id: string | null;

  source_record_id: string | null;
  source_url: string | null;

  signals: Record<string, unknown>;
  raw_data: Record<string, unknown>;
  metadata: Record<string, unknown>;

  first_seen_at: string | null;
  last_seen_at: string | null;
};

// -------------------------------------------------------
// Guardrail de integridad
// -------------------------------------------------------

/**
 * Valida las invariantes de una señal antes de cualquier persistencia.
 * Devuelve lista de violaciones (vacía si es válida).
 */
export function validateSourceCompanySignal(signal: SourceCompanySignal): string[] {
  const errors: string[] = [];

  if (!signal.normalized_supplier_name || signal.normalized_supplier_name.trim().length === 0) {
    errors.push('normalized_supplier_name must not be empty');
  }

  if (signal.matching_mode === 'name_only_review_required' && !signal.human_review_required) {
    errors.push('human_review_required must be true when matching_mode is name_only_review_required');
  }

  if (signal.signal_strength === 'weak_name_only' && !signal.human_review_required) {
    errors.push('human_review_required must be true when signal_strength is weak_name_only');
  }

  if (!SOURCE_COMPANY_SIGNAL_KINDS.includes(signal.signal_kind)) {
    errors.push(`invalid signal_kind: ${signal.signal_kind}`);
  }

  if (!SOURCE_COMPANY_SIGNAL_STRENGTHS.includes(signal.signal_strength)) {
    errors.push(`invalid signal_strength: ${signal.signal_strength}`);
  }

  if (!SOURCE_COMPANY_SIGNAL_MATCHING_MODES.includes(signal.matching_mode)) {
    errors.push(`invalid matching_mode: ${signal.matching_mode}`);
  }

  return errors;
}

// -------------------------------------------------------
// Helper de dedupe key (puro, sin DB)
// -------------------------------------------------------

/**
 * Construye la clave de dedupe que corresponde al UNIQUE constraint SQL:
 *   (source_key, country_code, source_year, normalized_supplier_name)
 *
 * No usa tax_id ni ningún identificador fiscal.
 */
export function buildSourceCompanySignalDedupeKey(input: {
  sourceKey: string;
  countryCode: string;
  sourceYear: number;
  normalizedSupplierName: string;
}): string {
  const { sourceKey, countryCode, sourceYear, normalizedSupplierName } = input;

  if (!normalizedSupplierName || normalizedSupplierName.trim().length === 0) {
    throw new Error('normalizedSupplierName must not be empty');
  }
  if (!sourceKey || !countryCode) {
    throw new Error('sourceKey and countryCode must not be empty');
  }

  return `${sourceKey}::${countryCode}::${sourceYear}::${normalizedSupplierName.trim()}`;
}
