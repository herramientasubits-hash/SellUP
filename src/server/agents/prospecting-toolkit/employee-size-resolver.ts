/**
 * Employee Size Resolver — Agent 1 v1.16J
 *
 * Resolver central y puro que determina el mejor dato disponible de tamaño
 * de empresa antes de ejecutar el ICP Size Gate.
 *
 * Prioridad de fuentes (conservadora):
 *   1. rich_profile.size.estimated_range   — ya normalizado y enriquecido
 *   2. candidate.company_size              — campo plano disponible
 *   3. HubSpot numberofemployees           — conteo exacto del CRM
 *   4. unknown                             — sin datos, no inventa
 *
 * Principios:
 *   - Sin llamadas externas, sin LLM, sin Supabase, sin efectos secundarios.
 *   - No inventa estimated_range.
 *   - No bloquea por omisión: unknown → needs_validation.
 */

import type { IcpSizeGateInput } from './icp-size-gate';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type EmployeeSizeSource =
  | 'rich_profile_size'
  | 'candidate_company_size'
  | 'hubspot_number_of_employees'
  | 'unknown';

export type EmployeeSizeConfidence = 'high' | 'medium' | 'low' | 'unknown';

export type EmployeeSizeAttemptedSource = {
  source: string;
  value: string | number | null;
  usable: boolean;
  reason: string;
};

export type EmployeeSizeResolverInput = {
  richProfileSize?: {
    estimated_range?: string | null;
    status?: 'confirmed' | 'estimated' | 'unknown' | null;
    source?: string | null;
  } | null;
  candidateCompanySize?: string | number | null;
  matchedHubspotEmployees?: number | string | null;
  threshold?: number;
};

export type EmployeeSizeResolverOutput = {
  /** Input listo para pasar a evaluateIcpSizeGate() */
  icpInput: IcpSizeGateInput;
  selectedSource: EmployeeSizeSource;
  selectedValue: string | number | null;
  confidence: EmployeeSizeConfidence;
  reason: string;
  attemptedSources: EmployeeSizeAttemptedSource[];
};

// ─── Strings que no representan datos de tamaño ──────────────────────────────

const UNKNOWN_SIZE_STRINGS = new Set([
  'unknown', 'n/a', '-', '', 'desconocido', 'not found', 'sin datos',
  'nd', 'n.a.', 'na', 'indefinido', 'desconocida',
]);

// ─── Helpers internos ─────────────────────────────────────────────────────────

function isUsableSizeString(val: string | null | undefined): val is string {
  if (!val) return false;
  return !UNKNOWN_SIZE_STRINGS.has(val.trim().toLowerCase());
}

function normalizeCompanySize(val: string | number | null | undefined): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s || UNKNOWN_SIZE_STRINGS.has(s.toLowerCase())) return null;
  return s;
}

function parseHubSpotEmployeeCount(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = parseInt(trimmed, 10);
    return isNaN(n) || n < 0 ? null : n;
  }
  return null;
}

// ─── Extractor defensivo de HubSpot employees desde raw ──────────────────────

/**
 * Extrae numberofemployees del campo `raw` de un DuplicateMatch de HubSpot.
 * El campo `raw` es `unknown` en el tipo, por lo que se accede defensivamente.
 */
export function extractHubSpotMatchedEmployees(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const candidates = [
    obj['numberofemployees'],
    obj['numberOfEmployees'],
    obj['number_of_employees'],
    obj['matched_number_of_employees'],
  ];
  for (const val of candidates) {
    const n = parseHubSpotEmployeeCount(val);
    if (n !== null) return n;
  }
  return null;
}

// ─── Resolver principal ───────────────────────────────────────────────────────

/**
 * Determina el mejor dato de tamaño disponible para el ICP Size Gate.
 * Función pura — no muta entrada, no llama APIs externas.
 */
export function resolveEmployeeSizeForIcpGate(
  input: EmployeeSizeResolverInput,
): EmployeeSizeResolverOutput {
  const threshold = input.threshold;
  const attemptedSources: EmployeeSizeAttemptedSource[] = [];

  // ── Fuente 1: rich_profile.size.estimated_range ───────────────────────────
  const richRange = input.richProfileSize?.estimated_range ?? null;
  const richStatus = input.richProfileSize?.status ?? null;
  const richSource = input.richProfileSize?.source ?? null;

  if (isUsableSizeString(richRange)) {
    attemptedSources.push({
      source: 'rich_profile_size',
      value: richRange,
      usable: true,
      reason: 'estimated_range present and non-empty',
    });
    return {
      icpInput: {
        sizeRange: richRange,
        sizeStatus: richStatus ?? undefined,
        source: richSource ?? undefined,
        threshold,
      },
      selectedSource: 'rich_profile_size',
      selectedValue: richRange,
      confidence: richStatus === 'confirmed' ? 'high' : 'medium',
      reason: `Used rich_profile.size.estimated_range="${richRange}" (status=${richStatus ?? 'unknown'})`,
      attemptedSources,
    };
  }

  attemptedSources.push({
    source: 'rich_profile_size',
    value: richRange,
    usable: false,
    reason: richRange == null
      ? 'estimated_range is null'
      : `estimated_range "${richRange}" is an unknown/empty value`,
  });

  // ── Fuente 2: candidate.company_size ──────────────────────────────────────
  const companySizeRaw = normalizeCompanySize(input.candidateCompanySize);

  if (companySizeRaw !== null) {
    attemptedSources.push({
      source: 'candidate_company_size',
      value: companySizeRaw,
      usable: true,
      reason: 'company_size present and parseable',
    });
    return {
      icpInput: {
        sizeRange: companySizeRaw,
        threshold,
      },
      selectedSource: 'candidate_company_size',
      selectedValue: companySizeRaw,
      confidence: 'medium',
      reason: `Used candidate.company_size="${companySizeRaw}"`,
      attemptedSources,
    };
  }

  attemptedSources.push({
    source: 'candidate_company_size',
    value: input.candidateCompanySize != null ? String(input.candidateCompanySize) : null,
    usable: false,
    reason: input.candidateCompanySize == null
      ? 'company_size is null'
      : `company_size "${input.candidateCompanySize}" is not usable`,
  });

  // ── Fuente 3: HubSpot numberofemployees ───────────────────────────────────
  const hubspotEmployees = parseHubSpotEmployeeCount(input.matchedHubspotEmployees);

  if (hubspotEmployees !== null) {
    attemptedSources.push({
      source: 'hubspot_number_of_employees',
      value: hubspotEmployees,
      usable: true,
      reason: 'HubSpot numberofemployees present and parseable',
    });
    return {
      icpInput: {
        employeeCount: hubspotEmployees,
        threshold,
      },
      selectedSource: 'hubspot_number_of_employees',
      selectedValue: hubspotEmployees,
      confidence: 'high',
      reason: `Used HubSpot numberofemployees=${hubspotEmployees}`,
      attemptedSources,
    };
  }

  attemptedSources.push({
    source: 'hubspot_number_of_employees',
    value: input.matchedHubspotEmployees != null ? String(input.matchedHubspotEmployees) : null,
    usable: false,
    reason: input.matchedHubspotEmployees == null
      ? 'HubSpot match not found or numberofemployees is null'
      : `HubSpot numberofemployees "${input.matchedHubspotEmployees}" is not parseable`,
  });

  // ── Fuente 4: unknown ─────────────────────────────────────────────────────
  return {
    icpInput: {
      threshold,
    },
    selectedSource: 'unknown',
    selectedValue: null,
    confidence: 'unknown',
    reason: 'No usable size data found in any source',
    attemptedSources,
  };
}
