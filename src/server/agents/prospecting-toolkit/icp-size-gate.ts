/**
 * ICP Size Gate — Agent 1 v1.16I
 *
 * Evaluación determinística de tamaño de empresa para criterio ICP UBITS.
 * Umbral default: > 200 colaboradores.
 *
 * Principios:
 *   - UNKNOWN !== menor de 200: tamaño desconocido produce needs_validation, nunca block.
 *   - No inventa tamaño: sin datos, sin decisión de pass/block.
 *   - Puro: sin llamadas externas, sin LLM, sin Supabase, sin efectos secundarios.
 */

export type IcpSizeGateDecision = 'pass' | 'block' | 'needs_validation';

export type IcpSizeStatus =
  | 'confirmed_above_threshold'
  | 'estimated_above_threshold'
  | 'confirmed_below_threshold'
  | 'estimated_below_threshold'
  | 'unknown';

export type IcpSizeGateResult = {
  decision: IcpSizeGateDecision;
  size_status: IcpSizeStatus;
  threshold: number;
  normalized_min_employees: number | null;
  normalized_max_employees: number | null;
  reason: string;
  requires_human_review: boolean;
};

export type IcpSizeGateInput = {
  employeeCount?: number | null;
  sizeRange?: string | null;
  sizeStatus?: string | null;
  source?: string | null;
  threshold?: number;
};

export type IcpSizeGateBatchSummary = {
  threshold: number;
  pass_count: number;
  needs_validation_count: number;
  blocked_count: number;
  blocked_reasons: string[];
};

const DEFAULT_THRESHOLD = 200;

// ─── Parser de rangos ────────────────────────────────────────────────────────

type ParsedRange = {
  min: number | null;
  max: number | null;
};

const UNKNOWN_STRINGS = new Set([
  'unknown', 'n/a', '-', 'desconocido', 'not found', 'sin datos',
  'nd', 'n.a.', 'na', '', 'indefinido', 'desconocida',
]);

function parseSizeRange(raw: string | null | undefined): ParsedRange | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (UNKNOWN_STRINGS.has(s)) return null;

  // "10001+" o "10,001+"
  const plusMatch = s.match(/^([\d,]+)\s*\+$/);
  if (plusMatch) {
    const min = parseInt(plusMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(min)) return { min, max: null };
  }

  // "1000-5000" o "1,000-5,000"
  const rangeMatch = s.match(/^([\d,]+)\s*[-–]\s*([\d,]+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1].replace(/,/g, ''), 10);
    const max = parseInt(rangeMatch[2].replace(/,/g, ''), 10);
    if (!isNaN(min) && !isNaN(max)) return { min, max };
  }

  // "<=200" (menor o igual) → max = N
  const lteMatch = s.match(/^<=\s*([\d,]+)$/);
  if (lteMatch) {
    const n = parseInt(lteMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) return { min: null, max: n };
  }

  // "<200" (estrictamente menor) → max = N - 1
  const ltMatch = s.match(/^<\s*([\d,]+)$/);
  if (ltMatch) {
    const n = parseInt(ltMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) return { min: null, max: n - 1 };
  }

  // ">=200" (mayor o igual) → min = N
  const gteMatch = s.match(/^>=\s*([\d,]+)$/);
  if (gteMatch) {
    const n = parseInt(gteMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) return { min: n, max: null };
  }

  // ">200" (estrictamente mayor) → min = N + 1
  const gtMatch = s.match(/^>\s*([\d,]+)$/);
  if (gtMatch) {
    const n = parseInt(gtMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) return { min: n + 1, max: null };
  }

  // Número solo: "200" o "201"
  const singleMatch = s.match(/^([\d,]+)$/);
  if (singleMatch) {
    const n = parseInt(singleMatch[1].replace(/,/g, ''), 10);
    if (!isNaN(n)) return { min: n, max: n };
  }

  return null;
}

// ─── Evaluador principal ─────────────────────────────────────────────────────

/**
 * Evalúa si una empresa cumple el umbral de tamaño ICP.
 *
 * Prioridad:
 *   1. employeeCount (conteo exacto confirmado)
 *   2. sizeRange (rango estimado o conocido)
 *   3. Sin datos → needs_validation
 *
 * Regla de negocio: threshold default = 200.
 *   - employeeCount > threshold  → pass
 *   - employeeCount <= threshold → block
 *   - UNKNOWN ≠ menor de threshold → needs_validation (nunca block por omisión)
 */
export function evaluateIcpSizeGate(input: IcpSizeGateInput): IcpSizeGateResult {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;

  // ── 1. Conteo exacto de empleados (máxima confianza) ──────────────────────
  if (input.employeeCount != null) {
    const count = input.employeeCount;
    if (count > threshold) {
      return {
        decision: 'pass',
        size_status: 'confirmed_above_threshold',
        threshold,
        normalized_min_employees: count,
        normalized_max_employees: count,
        reason: `Employee count ${count} exceeds ICP threshold of ${threshold}`,
        requires_human_review: false,
      };
    }
    return {
      decision: 'block',
      size_status: 'confirmed_below_threshold',
      threshold,
      normalized_min_employees: count,
      normalized_max_employees: count,
      reason: `Employee count ${count} does not exceed ICP threshold of ${threshold}`,
      requires_human_review: false,
    };
  }

  // ── 2. Rango de tamaño (estimado desde perfil o fuente) ───────────────────
  const parsed = parseSizeRange(input.sizeRange);
  if (parsed !== null) {
    const isConfirmed = input.sizeStatus === 'confirmed';
    const aboveSuffix = isConfirmed ? 'confirmed_above_threshold' : 'estimated_above_threshold';
    const belowSuffix = isConfirmed ? 'confirmed_below_threshold' : 'estimated_below_threshold';

    // min del rango supera el umbral → pass (aunque max no esté)
    if (parsed.min !== null && parsed.min > threshold) {
      return {
        decision: 'pass',
        size_status: aboveSuffix,
        threshold,
        normalized_min_employees: parsed.min,
        normalized_max_employees: parsed.max,
        reason: `Size range minimum (${parsed.min}) exceeds ICP threshold of ${threshold}`,
        requires_human_review: false,
      };
    }

    // max del rango no supera el umbral → block
    if (parsed.max !== null && parsed.max <= threshold) {
      return {
        decision: 'block',
        size_status: belowSuffix,
        threshold,
        normalized_min_employees: parsed.min,
        normalized_max_employees: parsed.max,
        reason: `Size range maximum (${parsed.max}) does not exceed ICP threshold of ${threshold}`,
        requires_human_review: false,
      };
    }

    // Ambiguo: min <= threshold y max > threshold (o max null con min <= threshold)
    return {
      decision: 'needs_validation',
      size_status: 'unknown',
      threshold,
      normalized_min_employees: parsed.min,
      normalized_max_employees: parsed.max,
      reason: `Size range is ambiguous relative to ICP threshold of ${threshold}`,
      requires_human_review: true,
    };
  }

  // ── 3. Sin datos de tamaño → needs_validation (nunca block) ──────────────
  return {
    decision: 'needs_validation',
    size_status: 'unknown',
    threshold,
    normalized_min_employees: null,
    normalized_max_employees: null,
    reason: 'Company size unknown; cannot evaluate ICP size threshold without data',
    requires_human_review: true,
  };
}

// ─── Helpers de integración ───────────────────────────────────────────────────

/**
 * Extrae datos de tamaño de un rich profile y evalúa el gate ICP.
 * Función pura — no muta el profile.
 */
export function evaluateIcpSizeGateFromRichProfile(
  size: {
    estimated_range?: string | null;
    status?: 'confirmed' | 'estimated' | 'unknown';
    source?: string | null;
  },
  threshold?: number,
): IcpSizeGateResult {
  return evaluateIcpSizeGate({
    sizeRange: size.estimated_range ?? null,
    sizeStatus: size.status ?? null,
    source: size.source ?? null,
    threshold,
  });
}

export type IcpSizeGateWriterAction = {
  action: 'skip' | 'needs_review' | 'pass';
  skipReason?: string;
};

/**
 * Determina la acción del writer dado un resultado del gate ICP.
 * - block → skip con reason icp_size_below_threshold
 * - needs_validation → persistir como needs_review con marca
 * - pass → flujo normal
 */
export function resolveIcpSizeGateWriterAction(
  gateResult: IcpSizeGateResult,
): IcpSizeGateWriterAction {
  switch (gateResult.decision) {
    case 'block':
      return { action: 'skip', skipReason: 'icp_size_below_threshold' };
    case 'needs_validation':
      return { action: 'needs_review' };
    case 'pass':
      return { action: 'pass' };
  }
}
