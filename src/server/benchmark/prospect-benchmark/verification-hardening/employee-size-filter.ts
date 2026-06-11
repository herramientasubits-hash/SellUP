/**
 * Verification Hardening — Employee Size Pre-filter (16AB.25.5)
 *
 * Evaluates whether a discovery candidate meets the minimum employee count
 * requirement BEFORE making an expensive provider call.
 *
 * Default criterion: employee_count > 200 (strictly exclusive).
 * Any candidate with confirmed max(range) <= 200 is excluded without a provider call.
 *
 * Scope rules:
 *   - `colombia` scope is authoritative when the request targets Colombia.
 *   - `global_group` is NOT automatically treated as the Colombian entity headcount.
 *   - `unknown` scope → ambiguous → not excluded automatically.
 *
 * No candidate-specific conditionals. No names in this module.
 */

// ─── Criteria contract ────────────────────────────────────────────────────────

export type EmployeeSizeCriteria = {
  /** The threshold is exclusive: employee_count must be STRICTLY GREATER THAN this value. */
  minEmployeeCountExclusive: number;
  /** hard_filter: candidates that don't meet criteria are excluded before provider call.
   *  preference: criteria is advisory only; candidates proceed to verification regardless. */
  enforcement: 'hard_filter' | 'preference';
};

export const DEFAULT_EMPLOYEE_SIZE_CRITERIA: EmployeeSizeCriteria = {
  minEmployeeCountExclusive: 200,
  enforcement: 'hard_filter',
};

// ─── Filter result ────────────────────────────────────────────────────────────

export type SizeFilterStatus =
  | 'excluded_by_search_criteria'   // confirmed max(range) <= threshold — skip provider call
  | 'passes_size_filter'            // confirmed min(range) > threshold — proceed
  | 'size_unknown_not_excluded'     // no size evidence — proceed (fail open)
  | 'ambiguous_not_excluded';       // range crosses threshold or scope unclear — proceed

export type SizeFilterResult = {
  excluded: boolean;
  status: SizeFilterStatus;
  reason: 'employee_count_not_above_minimum' | null;
  parsedMin: number | null;
  parsedMax: number | null;
  scopeUsed: string | null;
};

// ─── Size string parser ───────────────────────────────────────────────────────

type ParsedRange = {
  min: number | null;
  max: number | null;
};

const UNBOUNDED_MAX = Infinity;

/**
 * Parse a human-readable employee size string into a numeric range.
 * Handles Spanish and English formats used in Colombian tech data.
 *
 * Examples:
 *   "51-200"            → { min: 51, max: 200 }
 *   "51-200 empleados"  → { min: 51, max: 200 }
 *   "201-500"           → { min: 201, max: 500 }
 *   "200-500 empleados" → { min: 200, max: 500 }
 *   "200"               → { min: 200, max: 200 }
 *   "500-1.000"         → { min: 500, max: 1000 }
 *   "más de 1.000"      → { min: 1001, max: Infinity }
 *   "more than 200"     → { min: 201, max: Infinity }
 *   "+1000"             → { min: 1001, max: Infinity }
 *   null / ""           → { min: null, max: null }
 */
export function parseEmployeeRange(raw: string | null): ParsedRange {
  if (!raw) return { min: null, max: null };

  const s = raw
    .replace(/\./g, '')     // remove thousands separator (1.000 → 1000)
    .replace(/,/g, '')      // remove commas
    .toLowerCase()
    .trim();

  // "más de N" / "more than N" / "+N"
  const moreMatch = s.match(/(?:m[aá]s\s+de|more\s+than|>\s*|^\+\s*)(\d+)/);
  if (moreMatch) {
    const n = parseInt(moreMatch[1], 10);
    return { min: n + 1, max: UNBOUNDED_MAX };
  }

  // "N-M" range (with optional "empleados" / "employees" suffix)
  const rangeMatch = s.match(/^(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    return { min: lo, max: hi };
  }

  // Single number
  const singleMatch = s.match(/^(\d+)/);
  if (singleMatch) {
    const n = parseInt(singleMatch[1], 10);
    return { min: n, max: n };
  }

  return { min: null, max: null };
}

// ─── Core evaluation ──────────────────────────────────────────────────────────

/**
 * Determine whether a candidate's size evidence meets the specified criteria.
 *
 * @param estimatedSize  Raw size string from discovery or verification data.
 * @param sizeScope      Scope qualifier: "colombia" | "legal_entity" | "global_group" | "unknown" | null.
 * @param criteria       Size criteria. Defaults to DEFAULT_EMPLOYEE_SIZE_CRITERIA.
 * @param requestScope   The scope the request cares about (default: "colombia").
 *
 * Rules:
 *   1. If scope is "global_group" and requestScope is "colombia", do NOT auto-exclude
 *      (global headcount ≠ Colombia headcount without an explicit mapping rule).
 *   2. If size is unknown → not excluded (fail open).
 *   3. If range max <= minEmployeeCountExclusive → excluded (hard evidence below threshold).
 *   4. If range min > minEmployeeCountExclusive → passes (confirmed above threshold).
 *   5. Otherwise (crosses threshold, unknown scope) → ambiguous, not excluded.
 */
export function evaluateEmployeeSizeEligibility(
  estimatedSize: string | null,
  sizeScope: string | null,
  criteria: EmployeeSizeCriteria = DEFAULT_EMPLOYEE_SIZE_CRITERIA,
  requestScope = 'colombia'
): SizeFilterResult {
  const threshold = criteria.minEmployeeCountExclusive;

  // When enforcement is 'preference', criteria are advisory — never exclude
  if (criteria.enforcement === 'preference') {
    const { min, max } = parseEmployeeRange(estimatedSize);
    return {
      excluded: false,
      status: 'passes_size_filter',
      reason: null,
      parsedMin: min,
      parsedMax: max,
      scopeUsed: sizeScope,
    };
  }

  // Global group scope without a Colombia mapping → ambiguous
  if (
    sizeScope === 'global_group' &&
    requestScope === 'colombia' &&
    estimatedSize !== null
  ) {
    const { min, max } = parseEmployeeRange(estimatedSize);
    return {
      excluded: false,
      status: 'ambiguous_not_excluded',
      reason: null,
      parsedMin: min,
      parsedMax: max,
      scopeUsed: sizeScope,
    };
  }

  const { min, max } = parseEmployeeRange(estimatedSize);

  // No parseable size evidence
  if (min === null && max === null) {
    return {
      excluded: false,
      status: 'size_unknown_not_excluded',
      reason: null,
      parsedMin: null,
      parsedMax: null,
      scopeUsed: sizeScope,
    };
  }

  // max <= threshold: entire range is at or below the threshold — exclude
  // (strict: employee_count > threshold means max must be > threshold)
  if (max !== null && max <= threshold) {
    return {
      excluded: true,
      status: 'excluded_by_search_criteria',
      reason: 'employee_count_not_above_minimum',
      parsedMin: min,
      parsedMax: max,
      scopeUsed: sizeScope,
    };
  }

  // min > threshold: entire range is above the threshold — clear pass
  if (min !== null && min > threshold) {
    return {
      excluded: false,
      status: 'passes_size_filter',
      reason: null,
      parsedMin: min,
      parsedMax: max,
      scopeUsed: sizeScope,
    };
  }

  // Range crosses the threshold (e.g., "200-500" with threshold=200: min=200 ≤ 200, max=500 > 200)
  return {
    excluded: false,
    status: 'ambiguous_not_excluded',
    reason: null,
    parsedMin: min,
    parsedMax: max,
    scopeUsed: sizeScope,
  };
}
