/**
 * Employee Size Text Parser — v1.16K
 *
 * Extracts a canonical employee-size range from free-form text
 * (sourceTitle, sourceSnippet). Pure function — no external calls,
 * no LLM, no Tavily. Cost = 0.
 *
 * Returns one of the canonical ICP ranges, or null when no explicit
 * employee-count evidence is present.
 *
 * Canonical ranges:
 *   "1-10" | "11-50" | "51-200" | "201-500" | "501-1000"
 *   | "1001-5000" | "5001-10000" | "10001+"
 */

// ─── Constants ────────────────────────────────────────────────────────────────

// Keywords that must appear adjacent to the number to trigger parsing.
// Without one of these, bare numbers (prices, client counts, area…) are ignored.
const EMPLOYEE_KW =
  '(?:employees?|workers?|staff|team\\s+members?|people' +
  '|empleados?|colaboradores?|trabajadores?|personas|equipo)\\b';

// Number pattern: digits with optional thousand separators (`,` or `.`).
const NUM = '(\\d[\\d.,]*)';

// ─── Internals ────────────────────────────────────────────────────────────────

/**
 * Strip thousand separators and parse to integer.
 * Employee counts are always integers, so both `,` and `.` are treated as
 * thousand separators (handles "1,000" EN and "1.000" ES).
 */
function parseRawNumber(raw: string): number | null {
  const cleaned = raw.replace(/[.,]/g, '');
  const n = parseInt(cleaned, 10);
  if (isNaN(n) || n <= 0) return null;
  return n;
}

/**
 * Map a headcount to the nearest canonical ICP range bucket.
 */
function numberToRange(n: number): string {
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  if (n <= 500) return '201-500';
  if (n <= 1000) return '501-1000';
  if (n <= 5000) return '1001-5000';
  if (n <= 10000) return '5001-10000';
  return '10001+';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse employee size from free-form text.
 *
 * Returns a canonical range string when an employee-count signal is detected,
 * or null when no explicit evidence is present.
 *
 * Supported patterns (case-insensitive):
 *   - "entre 200 y 500 empleados" / "between 200 and 500 employees"  → upper bound
 *   - "más de 200 empleados" / "over 1000 employees"                 → number + 1
 *   - "500+ employees"                                               → number + 1
 *   - "201-500 employees" / "51-200 empleados"                       → lower bound
 *   - "500 empleados" / "1.000 empleados" / "1,000 employees"        → number
 *
 * False-positive guard: numbers without an adjacent employee/staff keyword
 * (prices, client counts, area, vacancies…) always return null.
 */
export function parseEmployeeSizeFromText(text: string | null | undefined): string | null {
  if (!text) return null;

  const t = text.toLowerCase();

  // 1. "entre 200 y 500 empleados" / "between 200 and 500 employees" → upper bound
  {
    const re = new RegExp(
      `(?:entre|between)\\s+${NUM}\\s+(?:y|and)\\s+${NUM}\\s*${EMPLOYEE_KW}`,
      'i',
    );
    const m = t.match(re);
    if (m) {
      const upper = parseRawNumber(m[2]);
      if (upper !== null) return numberToRange(upper);
    }
  }

  // 2. "más de 200 empleados" / "over 1000 employees" / "more than 10000 employees" → n + 1
  {
    const re = new RegExp(
      `(?:más de|over|more than)\\s+${NUM}\\s*${EMPLOYEE_KW}`,
      'i',
    );
    const m = t.match(re);
    if (m) {
      const n = parseRawNumber(m[1]);
      if (n !== null) return numberToRange(n + 1);
    }
  }

  // 3. "500+ employees" / "10000+ employees" → n + 1
  {
    const re = new RegExp(`${NUM}\\s*\\+\\s*${EMPLOYEE_KW}`, 'i');
    const m = t.match(re);
    if (m) {
      const n = parseRawNumber(m[1]);
      if (n !== null) return numberToRange(n + 1);
    }
  }

  // 4. "201-500 employees" / "51-200 empleados" (explicit range) → lower bound
  {
    const re = new RegExp(`${NUM}\\s*[-–]\\s*${NUM}\\s*${EMPLOYEE_KW}`, 'i');
    const m = t.match(re);
    if (m) {
      const lower = parseRawNumber(m[1]);
      if (lower !== null) return numberToRange(lower);
    }
  }

  // 5. "500 empleados" / "1.000 empleados" / "1,000 employees" (single number)
  {
    const re = new RegExp(`${NUM}\\s+${EMPLOYEE_KW}`, 'i');
    const m = t.match(re);
    if (m) {
      const n = parseRawNumber(m[1]);
      if (n !== null) return numberToRange(n);
    }
  }

  return null;
}
