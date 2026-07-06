/**
 * Lusha Company Prospecting V3 — Billing & Size Guardrail Utilities (Q3F-5S)
 *
 * ESTADO: EXPERIMENTAL · SIN PRODUCCIÓN
 *
 * Helpers puros para:
 *   1. Convertir billing.creditsCharged real a usage/cost normalizado.
 *   2. Evaluar coincidencia de tamaño de empresa (size guardrail).
 *   3. Construir el shape esperado de provider_usage_logs.
 *
 * Garantías:
 *   ✅ No hace llamadas reales a Lusha
 *   ✅ No hace llamadas a ningún otro proveedor
 *   ✅ No escribe en DB (logging shape solo para referencia/tests)
 *   ✅ No modifica source-catalog
 *   ✅ No activa discovery productivo
 *
 * Observaciones Q3F-5R (microbenchmark real 2026-07):
 *   - 3 de 3 requests retornaron billing.creditsCharged=1 con pagination.size=10.
 *   - Esto NO garantiza que "1 crédito/request" sea una regla contractual universal.
 *   - El cálculo runtime SIEMPRE usa el valor real de billing.creditsCharged.
 *   - Si creditsCharged es null → no se inventa costo.
 *
 * El filtro de tamaños (sizes en Lusha V3) NO es un hard filter confiable.
 * Ejemplos reales Q3F-5R: request 51–200 → empleadosExactos=3134.
 * El campo employeeCountExact debe usarse para post-filtrado SellUp.
 */

// ============================================================
// Tipos de pricing
// ============================================================

/** Config de pricing leída de provider_pricing_config para Lusha company_prospecting_v3. */
export type LushaCompanyProspectingPricingConfig = {
  provider_key: 'lusha';
  operation_key: 'company_prospecting_v3';
  unit: 'per_credit';
  unit_cost_usd: number;
};

// ============================================================
// Billing normalizado — helper puro (Tarea 4)
// ============================================================

export type LushaCompanyProspectingBillingInput = {
  /** billing.creditsCharged directo de la respuesta de Lusha V3. null/undefined si ausente. */
  creditsCharged: number | null | undefined;
  /** Config de pricing. null si no está disponible. */
  pricingConfig: LushaCompanyProspectingPricingConfig | null;
};

export type LushaCompanyProspectingBillingOutput = {
  /** Créditos usados: igual al valor real de creditsCharged. null si creditsCharged es null/undefined. */
  creditsUsed: number | null;
  /** Costo estimado en USD. null si creditsCharged es null o pricing no disponible. */
  estimatedCostUsd: number | null;
  /** true si creditsCharged vino como número >= 0 del response real. */
  billingConfirmed: boolean;
  /** Mensaje de advertencia si pricing no está disponible. null si hay pricing. */
  pricingMissingWarning: string | null;
};

/**
 * Convierte billing.creditsCharged real de Lusha V3 a usage/cost normalizado.
 *
 * Reglas:
 * - creditsCharged numérico >= 0 → usar valor real.
 * - null/undefined → no inventar costo.
 * - pricing ausente → estimatedCostUsd null + warning.
 * - No expone billing bruto.
 */
export function normalizeLushaCompanyProspectingBilling(
  input: LushaCompanyProspectingBillingInput
): LushaCompanyProspectingBillingOutput {
  const { creditsCharged, pricingConfig } = input;

  const isConfirmed = typeof creditsCharged === 'number' && creditsCharged >= 0;
  const creditsUsed = isConfirmed ? creditsCharged : null;

  const hasPricing = pricingConfig !== null && typeof pricingConfig?.unit_cost_usd === 'number';
  const pricingMissingWarning = hasPricing
    ? null
    : 'Lusha company_prospecting_v3 pricing config not found. estimatedCostUsd cannot be computed.';

  let estimatedCostUsd: number | null = null;
  if (creditsUsed !== null && hasPricing) {
    estimatedCostUsd = creditsUsed * (pricingConfig!.unit_cost_usd);
  }

  return {
    creditsUsed,
    estimatedCostUsd,
    billingConfirmed: isConfirmed,
    pricingMissingWarning,
  };
}

// ============================================================
// Size guardrail — helper puro (Tarea 6)
// ============================================================

/** Rango de tamaño solicitado, en número de empleados. */
export type SizeRange = {
  min?: number;
  max?: number;
};

/** Resultado de evaluación de coincidencia de tamaño para una empresa. */
export type SizeMatchResult =
  | 'size_match_confirmed'
  | 'size_mismatch_confirmed'
  | 'size_unverifiable';

/**
 * Evalúa si el tamaño exacto de empleados cae dentro de alguno de los rangos solicitados.
 *
 * Reglas:
 * - employeeCountExact presente → comparar contra rangos.
 *   - Cae en al menos uno → size_match_confirmed.
 *   - No cae en ninguno → size_mismatch_confirmed.
 * - employeeCountExact null/undefined → size_unverifiable.
 *
 * No descarta automáticamente. Solo reporta el resultado para que el caller decida.
 */
export function evaluateSizeMatch(
  employeeCountExact: number | null | undefined,
  requestedRanges: SizeRange[]
): SizeMatchResult {
  if (employeeCountExact === null || employeeCountExact === undefined) {
    return 'size_unverifiable';
  }
  if (requestedRanges.length === 0) {
    return 'size_unverifiable';
  }

  for (const range of requestedRanges) {
    const aboveMin = range.min === undefined || employeeCountExact >= range.min;
    const belowMax = range.max === undefined || employeeCountExact <= range.max;
    if (aboveMin && belowMax) {
      return 'size_match_confirmed';
    }
  }

  return 'size_mismatch_confirmed';
}

/** Empresa con campo de tamaño exacto para evaluación batch. */
export type CompanyWithEmployeeCount = {
  employeeCountExact?: number | null;
  [key: string]: unknown;
};

/** Resumen de evaluación de coincidencia de tamaño para un lote de empresas. */
export type SizeFilterSummary = {
  sizeMatchCount: number;
  sizeMismatchCount: number;
  sizeUnverifiableCount: number;
  /** Proporción de mismatches confirmados sobre total de evaluaciones confirmadas. null si no hay evaluaciones confirmadas. */
  sizeFilterMismatchRate: number | null;
  results: SizeMatchResult[];
};

/**
 * Evalúa coincidencia de tamaño para un lote de empresas y calcula métricas agregadas.
 *
 * sizeFilterMismatchRate = sizeMismatchCount / (sizeMatchCount + sizeMismatchCount)
 * Permite medir formalmente el problema observado en Q3F-5R:
 *   "size filter strictness unconfirmed; real responses showed exact employee counts outside requested ranges."
 */
export function evaluateSizeFilterBatch(
  companies: CompanyWithEmployeeCount[],
  requestedRanges: SizeRange[]
): SizeFilterSummary {
  const results = companies.map((c) =>
    evaluateSizeMatch(c.employeeCountExact, requestedRanges)
  );

  const sizeMatchCount = results.filter((r) => r === 'size_match_confirmed').length;
  const sizeMismatchCount = results.filter((r) => r === 'size_mismatch_confirmed').length;
  const sizeUnverifiableCount = results.filter((r) => r === 'size_unverifiable').length;

  const confirmed = sizeMatchCount + sizeMismatchCount;
  const sizeFilterMismatchRate = confirmed > 0
    ? sizeMismatchCount / confirmed
    : null;

  return {
    sizeMatchCount,
    sizeMismatchCount,
    sizeUnverifiableCount,
    sizeFilterMismatchRate,
    results,
  };
}

// ============================================================
// provider_usage_logs shape (Tarea 5) — solo para referencia/tests
// ============================================================

/**
 * Shape esperado para un row de provider_usage_logs cuando se registra
 * una llamada de Lusha V3 Company Prospecting.
 *
 * Este tipo NO inserta en DB. Es una referencia para preparar el INSERT
 * cuando se active el logging productivo.
 *
 * Campos que NUNCA deben incluirse:
 *   - API key
 *   - billing bruto
 *   - headers sensibles
 *   - contacts/person data
 */
export type LushaCompanyProspectingUsageLogShape = {
  provider_key: 'lusha';
  operation_key: 'company_prospecting_v3';
  credits_used: number | null;
  results_returned: number;
  estimated_cost_usd: number | null;
  status: 'success' | 'failed';
  metadata: LushaCompanyProspectingUsageLogMetadata;
};

export type LushaCompanyProspectingUsageLogMetadata = {
  /** true si este log proviene de un run de benchmark/experimental */
  benchmark: boolean;
  provider_role: 'lusha_company_discovery_experimental';
  country: string;
  requested_page_size: number;
  requested_size_ranges: SizeRange[];
  /** Cuántas empresas del response tienen employeeCountExact presente */
  response_employee_count_exact_present_count: number;
  /**
   * SIEMPRE true. El filtro sizes de Lusha V3 no garantiza un hard filter.
   * Confirmado en Q3F-5R: requests 51–200 retornaron empresas con 3134, 1107 empleados.
   * "size filter strictness unconfirmed; real responses showed exact employee counts outside requested ranges."
   */
  size_filter_requires_post_validation: true;
  /** true si creditsCharged vino confirmado en el response */
  billing_confirmed: boolean;
  /** Mensaje de warning si pricing no disponible. null si hay pricing. */
  pricing_missing_warning: string | null;
};

/**
 * Construye el shape de provider_usage_logs para una llamada de Lusha V3 Company Prospecting.
 * No inserta en DB. Solo prepara el objeto para cuando se active el logging.
 */
export function buildLushaCompanyProspectingUsageLog(input: {
  billingOutput: LushaCompanyProspectingBillingOutput;
  resultsReturned: number;
  country: string;
  requestedPageSize: number;
  requestedSizeRanges: SizeRange[];
  responseEmployeeCountExactPresentCount: number;
  isBenchmark: boolean;
}): LushaCompanyProspectingUsageLogShape {
  const status: 'success' | 'failed' =
    input.billingOutput.billingConfirmed ? 'success' : 'failed';

  return {
    provider_key: 'lusha',
    operation_key: 'company_prospecting_v3',
    credits_used: input.billingOutput.creditsUsed,
    results_returned: input.resultsReturned,
    estimated_cost_usd: input.billingOutput.estimatedCostUsd,
    status,
    metadata: {
      benchmark: input.isBenchmark,
      provider_role: 'lusha_company_discovery_experimental',
      country: input.country,
      requested_page_size: input.requestedPageSize,
      requested_size_ranges: input.requestedSizeRanges,
      response_employee_count_exact_present_count: input.responseEmployeeCountExactPresentCount,
      size_filter_requires_post_validation: true,
      billing_confirmed: input.billingOutput.billingConfirmed,
      pricing_missing_warning: input.billingOutput.pricingMissingWarning,
    },
  };
}
