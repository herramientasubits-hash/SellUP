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
 *   4. registro oficial (trabajadores)     — sólo aprueba, estimado (ver abajo)
 *   5. unknown                             — sin datos, no inventa
 *
 * Principios:
 *   - Sin llamadas externas, sin LLM, sin Supabase, sin efectos secundarios.
 *   - No inventa estimated_range.
 *   - No bloquea por omisión: unknown → needs_validation.
 */

import { ICP_SIZE_GATE_DEFAULT_THRESHOLD } from './icp-size-gate';
import type { IcpSizeGateInput } from './icp-size-gate';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type EmployeeSizeSource =
  | 'rich_profile_size'
  | 'candidate_company_size'
  | 'hubspot_number_of_employees'
  | 'official_registry_workers'
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
  /** Trabajadores informados por el registro oficial (p. ej. SII de Chile). */
  officialRegistryWorkforce?: OfficialRegistryWorkforce | null;
  /** Año de referencia para la antigüedad del dato del registro (por defecto, el actual). */
  referenceYear?: number;
  threshold?: number;
};

/**
 * AGENT1-SIZE-OFFICIAL-REGISTRY-WORKERS-1 — trabajadores dependientes que la
 * empresa informó al registro oficial. Misma forma que `OfficialWorkforce` de
 * `prospect-intake` (sin acoplar este módulo puro a ese paquete).
 */
export type OfficialRegistryWorkforce = {
  workers: number;
  year: number;
  source: string;
};

/**
 * Un dato del registro más viejo que esto no describe a la empresa de hoy.
 * La carga vigente del SII es la de 2024.
 */
export const OFFICIAL_REGISTRY_WORKERS_MAX_AGE_YEARS = 3;

/**
 * AGENT1-SIZE-OFFICIAL-REGISTRY-SMALL-1 — por debajo de esto el registro DESCARTA.
 * Prod 05-10 (CL×Salud a5227f3f): el SII informó 9 trabajadores (Clinical Plus) y
 * la empresa quedó «para revisar» con tamaño desconocido. Los trabajadores
 * informados son un piso (sin honorarios), así que el corte va muy por debajo del
 * umbral ICP de 200: con menos de 50 informados, la empresa es pequeña.
 */
export const OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF = 50;

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

// ─── Extractor defensivo de company size desde candidato ─────────────────────

/**
 * Extrae el tamaño de empresa de un candidato con forma desconocida.
 * Busca en múltiples paths defensivamente; retorna null si nada es usable.
 * No lanza errores ni muta la entrada.
 *
 * Prioridad interna de paths:
 *   company_size → companySize → employee_count → employeeCount
 *   → company.size / company.employee_count
 *   → metadata.company_size / metadata.employee_count
 *   → scoring.metadata.company_size / scoring.metadata.employee_count
 *   → rich_profile.size.estimated_range
 */
export function extractCandidateCompanySize(candidate: unknown): string | number | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const c = candidate as Record<string, unknown>;

  // Direct top-level fields
  const directValues = [
    c['company_size'],
    c['companySize'],
    c['employee_count'],
    c['employeeCount'],
  ];
  for (const val of directValues) {
    const n = normalizeCompanySize(val as string | number | null | undefined);
    if (n !== null) return n;
  }

  // company sub-object
  const company = c['company'];
  if (company && typeof company === 'object') {
    const co = company as Record<string, unknown>;
    for (const val of [co['size'], co['employee_count'], co['employeeCount']]) {
      const n = normalizeCompanySize(val as string | number | null | undefined);
      if (n !== null) return n;
    }
  }

  // metadata sub-object
  const metadata = c['metadata'];
  if (metadata && typeof metadata === 'object') {
    const m = metadata as Record<string, unknown>;
    for (const val of [m['company_size'], m['employee_count'], m['employeeCount']]) {
      const n = normalizeCompanySize(val as string | number | null | undefined);
      if (n !== null) return n;
    }
  }

  // scoring.metadata sub-object
  const scoring = c['scoring'];
  if (scoring && typeof scoring === 'object') {
    const s = scoring as Record<string, unknown>;
    const sm = s['metadata'];
    if (sm && typeof sm === 'object') {
      const smObj = sm as Record<string, unknown>;
      for (const val of [smObj['company_size'], smObj['employee_count']]) {
        const n = normalizeCompanySize(val as string | number | null | undefined);
        if (n !== null) return n;
      }
    }
  }

  // rich_profile.size.estimated_range (last resort within candidate fields)
  const rp = c['rich_profile'];
  if (rp && typeof rp === 'object') {
    const rpObj = rp as Record<string, unknown>;
    const sz = rpObj['size'];
    if (sz && typeof sz === 'object') {
      const szObj = sz as Record<string, unknown>;
      const n = normalizeCompanySize(szObj['estimated_range'] as string | null | undefined);
      if (n !== null) return n;
    }
  }

  return null;
}

// ─── Extractor defensivo del registro oficial ────────────────────────────────

/**
 * Lee `officialSourceIdentity.officialSourceMetadata.workforce`, que Apollo y
 * Tavily ya llenan antes del writer. Sólo con identidad fuerte (mismo número
 * fiscal): el metadata ya lo exige, y aquí se vuelve a exigir por si cambia.
 * Devuelve `null` ante cualquier forma inesperada; nunca lanza.
 */
export function extractOfficialRegistryWorkforce(candidate: unknown): OfficialRegistryWorkforce | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const identity = (candidate as Record<string, unknown>)['officialSourceIdentity'];
  if (!identity || typeof identity !== 'object') return null;
  const id = identity as Record<string, unknown>;
  if (id['strongIdentityAvailable'] !== true) return null;
  const metadata = id['officialSourceMetadata'];
  if (!metadata || typeof metadata !== 'object') return null;
  const workforce = (metadata as Record<string, unknown>)['workforce'];
  if (!workforce || typeof workforce !== 'object') return null;
  const w = workforce as Record<string, unknown>;
  const { workers, year, source } = w;
  if (typeof workers !== 'number' || !Number.isInteger(workers) || workers < 0) return null;
  if (typeof year !== 'number' || !Number.isInteger(year)) return null;
  if (typeof source !== 'string' || source.trim().length === 0) return null;
  return { workers, year, source };
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

  // ── Fuente 4: trabajadores del registro oficial ───────────────────────────
  // «Trabajadores dependientes informados» es un PISO del tamaño real (no cuenta
  // honorarios ni contratistas). Con el piso en el umbral o encima, el rango `N+`
  // pasa como ESTIMADO; muy por debajo (< SMALL_CUTOFF) la empresa es pequeña y el
  // gate la bloquea; en medio no dice nada sobre el tamaño total ⇒ unknown.
  const registry = input.officialRegistryWorkforce ?? null;
  if (registry !== null) {
    const floor = threshold ?? ICP_SIZE_GATE_DEFAULT_THRESHOLD;
    const referenceYear = input.referenceYear ?? new Date().getUTCFullYear();
    const isRecent = referenceYear - registry.year <= OFFICIAL_REGISTRY_WORKERS_MAX_AGE_YEARS;
    if (isRecent && registry.workers >= floor) {
      const range = `${registry.workers}+`;
      attemptedSources.push({
        source: 'official_registry_workers',
        value: registry.workers,
        usable: true,
        reason: `${registry.source} informó ${registry.workers} trabajadores en ${registry.year}`,
      });
      return {
        icpInput: {
          sizeRange: range,
          sizeStatus: 'estimated',
          source: `${registry.source}:${registry.year}`,
          threshold,
        },
        selectedSource: 'official_registry_workers',
        selectedValue: range,
        confidence: 'medium',
        reason: `Used ${registry.source} workers=${registry.workers} (year ${registry.year}) as a lower bound`,
        attemptedSources,
      };
    }
    // 0 informados no es «pequeña»: en grupos grandes la planilla suele estar en otra razón social.
    if (isRecent && registry.workers >= 1 && registry.workers < OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF) {
      // Rango estimado bajo el umbral ⇒ el gate bloquea (como un tamaño pequeño de Apollo).
      const range = `${registry.workers}-${OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF - 1}`;
      attemptedSources.push({
        source: 'official_registry_workers',
        value: registry.workers,
        usable: true,
        reason: `${registry.source} informó ${registry.workers} trabajadores en ${registry.year}: empresa pequeña`,
      });
      return {
        icpInput: {
          sizeRange: range,
          sizeStatus: 'estimated',
          source: `${registry.source}:${registry.year}`,
          threshold,
        },
        selectedSource: 'official_registry_workers',
        selectedValue: range,
        confidence: 'medium',
        reason: `Used ${registry.source} workers=${registry.workers} (year ${registry.year}): below small cutoff ${OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF}`,
        attemptedSources,
      };
    }
    attemptedSources.push({
      source: 'official_registry_workers',
      value: registry.workers,
      usable: false,
      reason: isRecent
        ? `${registry.workers} trabajadores informados (${registry.year}) es un piso bajo el umbral: no decide`
        : `dato de ${registry.year} demasiado antiguo`,
    });
  }

  // ── Fuente 5: unknown ─────────────────────────────────────────────────────
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
