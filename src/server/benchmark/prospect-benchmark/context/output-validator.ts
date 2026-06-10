/**
 * Context Assembler — Output Validator (Hotfix 16AB.24.5)
 *
 * Valida determinísticamente la respuesta compacta de verificación antes de
 * transformarla a las 12 columnas oficiales.
 *
 * No llama APIs externas. No modifica producción. Sin `any`.
 */

import type {
  CompactVerificationRecord,
  VerificationOutputValidationIssue,
  VerificationOutputValidationResult,
  VerificationStatus,
  SizeScope,
  AuditabilityStatus,
  EligibilityStatus,
  Confidence,
  LegalNameRecord,
} from './types';

// ─── Conjuntos de enums válidos ───────────────────────────────────────────────

const VERIFICATION_STATUSES = new Set<string>([
  'verified',
  'supported',
  'estimated',
  'conflicting',
  'not_found',
]);

const SIZE_SCOPES = new Set<string>([
  'colombia',
  'legal_entity',
  'global_group',
  'unknown',
]);

/** Valores válidos para `audit_status` (calidad de evidencia). */
const AUDITABILITY_STATUSES = new Set<string>([
  'auditable',
  'partially_auditable',
  'not_auditable',
]);

/**
 * Mapa seguro de valores de elegibilidad usados por error en `audit_status`.
 * Solo se reconocen los dos patrones documentados en 16AB.24.8.
 */
const AUDIT_STATUS_ELIGIBILITY_MAPPING: Record<string, AuditabilityStatus> = {
  eligible_auditable: 'auditable',
  eligible_partially_auditable: 'partially_auditable',
};

/** Valores válidos para `eligibility` (decisión operativa). */
const ELIGIBILITY_STATUSES = new Set<string>([
  'eligible_auditable',
  'eligible_partially_auditable',
  'requires_review',
  'rejected',
]);

const CONFIDENCE_VALUES = new Set<string>(['Alta', 'Media', 'Baja']);

const UBITS_FIT_STATUSES = new Set<string>(['present', 'not_found']);

const ELIGIBLE_STATUSES = new Set<string>([
  'eligible_auditable',
  'eligible_partially_auditable',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidHttpUrl(val: unknown): val is string {
  return typeof val === 'string' && /^https?:\/\/.+/.test(val.trim());
}

function sanitizeUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(isValidHttpUrl) as string[];
}

function isRealCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  const [y, m, day] = dateStr.split('-').map(Number) as [number, number, number];
  return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day;
}

function coerceStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter((x): x is string => typeof x === 'string');
}

function trimOrNull(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}

// ─── Detección de schema heredado ────────────────────────────────────────────

function isLegacySchema(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  // Detectar 16AB.24.2-v1: company_facts ausente o identity.legal_name como string
  if (typeof obj['company_facts'] === 'undefined') return true;
  const identity = obj['identity'];
  if (typeof identity === 'object' && identity !== null) {
    const id = identity as Record<string, unknown>;
    if (typeof id['legal_name'] === 'string') return true;
    if (typeof id['legal_name'] === 'undefined') return true;
  }
  return false;
}

// ─── Migración de schema heredado ────────────────────────────────────────────

type MigrateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

function migrateLegacySchema(input: Record<string, unknown>): MigrateResult {
  try {
    const candidateName =
      typeof input['candidate_name'] === 'string' ? input['candidate_name'] : '';

    const identity = (
      typeof input['identity'] === 'object' && input['identity'] !== null
        ? input['identity']
        : {}
    ) as Record<string, unknown>;

    let migratedLegalName: LegalNameRecord;
    if (typeof identity['legal_name'] === 'string') {
      const lnVal = (identity['legal_name'] as string).trim();
      migratedLegalName = {
        value: lnVal === '' ? null : lnVal,
        status: 'not_found' as VerificationStatus,
        evidence_urls: [],
      };
    } else {
      migratedLegalName = { value: null, status: 'not_found', evidence_urls: [] };
    }

    const migratedIdentity: Record<string, unknown> = {
      status: identity['status'] ?? 'not_found',
      commercial_name:
        typeof identity['commercial_name'] === 'string' && identity['commercial_name'].trim()
          ? identity['commercial_name']
          : candidateName,
      legal_name: migratedLegalName,
      official_website: identity['official_website'] ?? null,
      linkedin_company_url: identity['linkedin_company_url'] ?? null,
      evidence_urls: Array.isArray(identity['evidence_urls']) ? identity['evidence_urls'] : [],
    };

    const colombiaOp = (
      typeof input['colombia_operation'] === 'object' && input['colombia_operation'] !== null
        ? input['colombia_operation']
        : {}
    ) as Record<string, unknown>;

    const migratedColombiaOp: Record<string, unknown> = {
      status: colombiaOp['status'] ?? 'not_found',
      primary_city: colombiaOp['primary_city'] ?? null,
      other_cities: Array.isArray(colombiaOp['other_cities']) ? colombiaOp['other_cities'] : [],
      evidence_urls: Array.isArray(colombiaOp['evidence_urls']) ? colombiaOp['evidence_urls'] : [],
    };

    const companyFacts: Record<string, unknown> =
      typeof input['company_facts'] === 'undefined'
        ? { incorporation_date: null, incorporation_year: null, evidence_urls: [] }
        : (input['company_facts'] as Record<string, unknown>);

    return {
      ok: true,
      value: {
        ...input,
        identity: migratedIdentity,
        colombia_operation: migratedColombiaOp,
        company_facts: companyFacts,
      },
    };
  } catch {
    return { ok: false, error: 'Failed to migrate legacy schema: unexpected structure' };
  }
}

// ─── Constructor de resultado ─────────────────────────────────────────────────

function buildResult(
  sanitizedOutput: CompactVerificationRecord | null,
  issues: VerificationOutputValidationIssue[],
  auditStatusSanitization?: { originalValue: string; mappedTo: AuditabilityStatus },
): VerificationOutputValidationResult {
  const blockingIssues = issues.filter((i) => i.severity === 'blocking');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const result: VerificationOutputValidationResult = {
    valid: blockingIssues.length === 0,
    sanitizedOutput,
    issues,
    blockingIssues,
    warnings,
  };
  if (auditStatusSanitization) {
    result.auditStatusSanitization = auditStatusSanitization;
  }
  return result;
}

// ─── Validación del bloque company_facts ──────────────────────────────────────

function validateCompanyFacts(
  raw: unknown,
  currentYear: number,
  issues: VerificationOutputValidationIssue[],
): CompactVerificationRecord['company_facts'] {
  const obj =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  let incorporation_date: string | null = null;
  let incorporation_year: number | null = null;

  // Fecha de constitución
  const rawDate = obj['incorporation_date'];
  if (rawDate !== null && rawDate !== undefined) {
    if (typeof rawDate === 'string') {
      if (isRealCalendarDate(rawDate)) {
        incorporation_date = rawDate;
      } else if (/^\d{4}$/.test(rawDate.trim())) {
        // Año puro como string — no convertir a fecha
        issues.push({
          path: 'company_facts.incorporation_date',
          code: 'date_is_year_only',
          severity: 'warning',
          message: `Valor '${rawDate}' es un año aislado, no una fecha ISO. Saneado a null; usar incorporation_year.`,
        });
      } else {
        issues.push({
          path: 'company_facts.incorporation_date',
          code: 'date_format_invalid',
          severity: 'warning',
          message: `Formato de fecha inválido: '${rawDate}'. Solo se acepta YYYY-MM-DD. Saneado a null.`,
        });
      }
    } else {
      issues.push({
        path: 'company_facts.incorporation_date',
        code: 'date_not_string',
        severity: 'warning',
        message: `incorporation_date debe ser string YYYY-MM-DD o null. Saneado a null.`,
      });
    }
  }

  // Año de constitución
  const rawYear = obj['incorporation_year'];
  if (rawYear !== null && rawYear !== undefined) {
    if (typeof rawYear === 'number' && Number.isInteger(rawYear)) {
      if (rawYear >= 1800 && rawYear <= currentYear) {
        incorporation_year = rawYear;
      } else {
        issues.push({
          path: 'company_facts.incorporation_year',
          code: rawYear > currentYear ? 'year_in_future' : 'year_out_of_range',
          severity: 'warning',
          message: `Año ${rawYear} fuera del rango válido [1800, ${currentYear}]. Saneado a null.`,
        });
      }
    } else {
      issues.push({
        path: 'company_facts.incorporation_year',
        code: 'year_not_integer',
        severity: 'warning',
        message: `incorporation_year debe ser entero o null. Saneado a null.`,
      });
    }
  }

  // Consistencia fecha/año
  if (incorporation_date !== null && incorporation_year !== null) {
    const yearFromDate = parseInt(incorporation_date.substring(0, 4), 10);
    if (yearFromDate !== incorporation_year) {
      issues.push({
        path: 'company_facts',
        code: 'date_year_inconsistent',
        severity: 'warning',
        message: `Año de la fecha (${yearFromDate}) no coincide con incorporation_year (${incorporation_year}).`,
      });
    }
  }

  return {
    incorporation_date,
    incorporation_year,
    evidence_urls: sanitizeUrls(obj['evidence_urls']),
  };
}

// ─── Validación de identity ───────────────────────────────────────────────────

function validateIdentity(
  raw: unknown,
  candidateName: string,
  issues: VerificationOutputValidationIssue[],
): CompactVerificationRecord['identity'] {
  if (typeof raw !== 'object' || raw === null) {
    issues.push({
      path: 'identity',
      code: 'missing_block',
      severity: 'blocking',
      message: 'El bloque identity es obligatorio.',
    });
    return {
      status: 'not_found',
      commercial_name: candidateName,
      legal_name: { value: null, status: 'not_found', evidence_urls: [] },
      official_website: null,
      linkedin_company_url: null,
      evidence_urls: [],
    };
  }

  const obj = raw as Record<string, unknown>;

  // status
  const rawStatus = obj['status'];
  if (typeof rawStatus !== 'string' || !VERIFICATION_STATUSES.has(rawStatus)) {
    issues.push({
      path: 'identity.status',
      code: 'invalid_enum',
      severity: 'blocking',
      message: `Valor de enum inválido en identity.status: '${String(rawStatus)}'.`,
    });
  }
  const status = (
    typeof rawStatus === 'string' && VERIFICATION_STATUSES.has(rawStatus)
      ? rawStatus
      : 'not_found'
  ) as VerificationStatus;

  // commercial_name: fallback desde candidate_name, nunca reemplazar por razón social
  let commercial_name: string;
  if (typeof obj['commercial_name'] === 'string' && obj['commercial_name'].trim() !== '') {
    commercial_name = obj['commercial_name'].trim();
  } else {
    commercial_name = candidateName;
    if (typeof obj['commercial_name'] !== 'string' || obj['commercial_name'].trim() === '') {
      issues.push({
        path: 'identity.commercial_name',
        code: 'commercial_name_fallback',
        severity: 'warning',
        message: `commercial_name vacío o ausente. Usando candidate_name como fallback: '${candidateName}'.`,
      });
    }
  }

  // legal_name
  let legal_name: LegalNameRecord;
  const rawLn = obj['legal_name'];
  if (typeof rawLn === 'object' && rawLn !== null) {
    const ln = rawLn as Record<string, unknown>;
    const lnValue = trimOrNull(ln['value']);
    const rawLnStatus = ln['status'];
    const lnStatus = (
      typeof rawLnStatus === 'string' && VERIFICATION_STATUSES.has(rawLnStatus)
        ? rawLnStatus
        : 'not_found'
    ) as VerificationStatus;
    legal_name = {
      value: lnValue,
      status: lnStatus,
      evidence_urls: sanitizeUrls(ln['evidence_urls']),
    };
  } else {
    legal_name = { value: null, status: 'not_found', evidence_urls: [] };
  }

  return {
    status,
    commercial_name,
    legal_name,
    official_website:
      isValidHttpUrl(obj['official_website']) ? (obj['official_website'] as string) : null,
    linkedin_company_url:
      isValidHttpUrl(obj['linkedin_company_url'])
        ? (obj['linkedin_company_url'] as string)
        : null,
    evidence_urls: sanitizeUrls(obj['evidence_urls']),
  };
}

// ─── Validación de colombia_operation ────────────────────────────────────────

function validateColombiaOperation(
  raw: unknown,
  issues: VerificationOutputValidationIssue[],
): CompactVerificationRecord['colombia_operation'] {
  if (typeof raw !== 'object' || raw === null) {
    issues.push({
      path: 'colombia_operation',
      code: 'missing_block',
      severity: 'blocking',
      message: 'El bloque colombia_operation es obligatorio.',
    });
    return { status: 'not_found', primary_city: null, other_cities: [], evidence_urls: [] };
  }

  const obj = raw as Record<string, unknown>;

  const rawStatus = obj['status'];
  if (typeof rawStatus !== 'string' || !VERIFICATION_STATUSES.has(rawStatus)) {
    issues.push({
      path: 'colombia_operation.status',
      code: 'invalid_enum',
      severity: 'blocking',
      message: `Valor de enum inválido en colombia_operation.status: '${String(rawStatus)}'.`,
    });
  }
  const status = (
    typeof rawStatus === 'string' && VERIFICATION_STATUSES.has(rawStatus)
      ? rawStatus
      : 'not_found'
  ) as VerificationStatus;

  // primary_city: null permitido; ausencia es warning no bloqueo
  const rawCity = obj['primary_city'];
  let primary_city: string | null = null;
  if (typeof rawCity === 'string') {
    const trimmed = rawCity.trim();
    primary_city = trimmed === '' ? null : trimmed;
  } else if (rawCity !== null && rawCity !== undefined) {
    issues.push({
      path: 'colombia_operation.primary_city',
      code: 'city_invalid_type',
      severity: 'warning',
      message: `primary_city debe ser string o null. Saneado a null.`,
    });
  }

  if (primary_city === null) {
    issues.push({
      path: 'colombia_operation.primary_city',
      code: 'city_missing',
      severity: 'warning',
      message: 'Ciudad principal no confirmada. La columna Ciudad quedará vacía.',
    });
  }

  // other_cities: deduplicar, eliminar vacíos, no mover a primary_city
  const rawOther = obj['other_cities'];
  const otherCities: string[] = [];
  if (Array.isArray(rawOther)) {
    const seen = new Set<string>();
    for (const c of rawOther as unknown[]) {
      if (typeof c === 'string') {
        const trimmed = c.trim();
        if (trimmed !== '' && !seen.has(trimmed)) {
          seen.add(trimmed);
          otherCities.push(trimmed);
        }
      }
    }
  }

  return {
    status,
    primary_city,
    other_cities: otherCities,
    evidence_urls: sanitizeUrls(obj['evidence_urls']),
  };
}

// ─── Validación de size ───────────────────────────────────────────────────────

function validateSize(
  raw: unknown,
  issues: VerificationOutputValidationIssue[],
): CompactVerificationRecord['size'] {
  if (typeof raw !== 'object' || raw === null) {
    issues.push({
      path: 'size',
      code: 'missing_block',
      severity: 'blocking',
      message: 'El bloque size es obligatorio.',
    });
    return { value: null, status: 'not_found', scope: null, evidence_urls: [] };
  }

  const obj = raw as Record<string, unknown>;

  const rawStatus = obj['status'];
  if (typeof rawStatus !== 'string' || !VERIFICATION_STATUSES.has(rawStatus)) {
    issues.push({
      path: 'size.status',
      code: 'invalid_enum',
      severity: 'blocking',
      message: `Valor de enum inválido en size.status: '${String(rawStatus)}'.`,
    });
  }
  const status = (
    typeof rawStatus === 'string' && VERIFICATION_STATUSES.has(rawStatus)
      ? rawStatus
      : 'not_found'
  ) as VerificationStatus;

  // value: preservar rangos tal cual (ej: "501-1.000"), no convertir
  const value =
    typeof obj['value'] === 'string' && obj['value'].trim() !== ''
      ? obj['value'].trim()
      : null;

  // scope: null permitido; 'unknown' es valor válido explícito
  let scope: SizeScope | null = null;
  const rawScope = obj['scope'];
  if (rawScope !== null && rawScope !== undefined) {
    if (typeof rawScope === 'string' && SIZE_SCOPES.has(rawScope)) {
      scope = rawScope as SizeScope;
    } else if (typeof rawScope === 'string') {
      issues.push({
        path: 'size.scope',
        code: 'invalid_enum',
        severity: 'blocking',
        message: `Valor de enum inválido en size.scope: '${rawScope}'.`,
      });
    }
  }

  return {
    value,
    status,
    scope,
    evidence_urls: sanitizeUrls(obj['evidence_urls']),
  };
}

// ─── Validación de technology_b2b_fit ────────────────────────────────────────

function validateTechB2bFit(
  raw: unknown,
  issues: VerificationOutputValidationIssue[],
): CompactVerificationRecord['technology_b2b_fit'] {
  if (typeof raw !== 'object' || raw === null) {
    issues.push({
      path: 'technology_b2b_fit',
      code: 'missing_block',
      severity: 'blocking',
      message: 'El bloque technology_b2b_fit es obligatorio.',
    });
    return { status: 'not_found', subsegment: null, reason: '', evidence_urls: [] };
  }

  const obj = raw as Record<string, unknown>;

  const rawStatus = obj['status'];
  if (typeof rawStatus !== 'string' || !VERIFICATION_STATUSES.has(rawStatus)) {
    issues.push({
      path: 'technology_b2b_fit.status',
      code: 'invalid_enum',
      severity: 'blocking',
      message: `Valor de enum inválido en technology_b2b_fit.status: '${String(rawStatus)}'.`,
    });
  }
  const status = (
    typeof rawStatus === 'string' && VERIFICATION_STATUSES.has(rawStatus)
      ? rawStatus
      : 'not_found'
  ) as VerificationStatus;

  return {
    status,
    subsegment: trimOrNull(obj['subsegment']),
    reason: typeof obj['reason'] === 'string' ? obj['reason'] : '',
    evidence_urls: sanitizeUrls(obj['evidence_urls']),
  };
}

// ─── Núcleo de validación ─────────────────────────────────────────────────────

function validateCore(
  obj: Record<string, unknown>,
  currentYear: number,
  issues: VerificationOutputValidationIssue[],
): VerificationOutputValidationResult {
  // candidate_name
  const candidateName =
    typeof obj['candidate_name'] === 'string' ? obj['candidate_name'].trim() : '';
  if (candidateName === '') {
    issues.push({
      path: 'candidate_name',
      code: 'missing_required',
      severity: 'blocking',
      message: 'candidate_name es obligatorio y no puede estar vacío.',
    });
  }

  // Bloques principales
  const identity = validateIdentity(obj['identity'], candidateName, issues);
  const colombia_operation = validateColombiaOperation(obj['colombia_operation'], issues);
  const technology_b2b_fit = validateTechB2bFit(obj['technology_b2b_fit'], issues);
  const size = validateSize(obj['size'], issues);
  const company_facts = validateCompanyFacts(obj['company_facts'], currentYear, issues);

  // ubits_fit
  const rawUbits = obj['ubits_fit'];
  let ubits_fit: CompactVerificationRecord['ubits_fit'] = { signals: [], status: 'not_found' };
  if (typeof rawUbits === 'object' && rawUbits !== null) {
    const u = rawUbits as Record<string, unknown>;
    const rawUStatus = u['status'];
    if (typeof rawUStatus !== 'string' || !UBITS_FIT_STATUSES.has(rawUStatus)) {
      issues.push({
        path: 'ubits_fit.status',
        code: 'invalid_enum',
        severity: 'blocking',
        message: `Valor de enum inválido en ubits_fit.status: '${String(rawUStatus)}'.`,
      });
    }
    ubits_fit = {
      signals: coerceStringArray(u['signals']),
      status: (
        typeof rawUStatus === 'string' && UBITS_FIT_STATUSES.has(rawUStatus)
          ? rawUStatus
          : 'not_found'
      ) as 'present' | 'not_found',
    };
  } else {
    issues.push({
      path: 'ubits_fit',
      code: 'missing_block',
      severity: 'blocking',
      message: 'El bloque ubits_fit es obligatorio.',
    });
  }

  // conflicts y missing_information
  const conflicts = coerceStringArray(obj['conflicts']);
  const missing_information = coerceStringArray(obj['missing_information']);

  // audit_status — acepta valores de auditabilidad o mapea desde enum de elegibilidad
  const rawAuditStatus = obj['audit_status'];
  let audit_status: AuditabilityStatus;
  let auditStatusSanitization: { originalValue: string; mappedTo: AuditabilityStatus } | undefined;

  if (typeof rawAuditStatus === 'string' && AUDITABILITY_STATUSES.has(rawAuditStatus)) {
    audit_status = rawAuditStatus as AuditabilityStatus;
  } else if (typeof rawAuditStatus === 'string' && rawAuditStatus in AUDIT_STATUS_ELIGIBILITY_MAPPING) {
    const mapped = AUDIT_STATUS_ELIGIBILITY_MAPPING[rawAuditStatus]!;
    audit_status = mapped;
    auditStatusSanitization = { originalValue: rawAuditStatus, mappedTo: mapped };
    issues.push({
      path: 'audit_status',
      code: 'audit_status_mapped_from_eligibility_enum',
      severity: 'warning',
      message: `audit_status '${rawAuditStatus}' es un valor de elegibilidad; mapeado automáticamente a '${mapped}'. Dato original preservado en auditStatusSanitization.`,
    });
  } else {
    issues.push({
      path: 'audit_status',
      code: 'invalid_enum',
      severity: 'blocking',
      message: `Valor de enum inválido en audit_status: '${String(rawAuditStatus)}'. Valores permitidos: auditable, partially_auditable, not_auditable.`,
    });
    audit_status = 'not_auditable';
  }

  // confidence
  const rawConfidence = obj['confidence'];
  if (typeof rawConfidence !== 'string' || !CONFIDENCE_VALUES.has(rawConfidence)) {
    issues.push({
      path: 'confidence',
      code: 'invalid_enum',
      severity: 'blocking',
      message: `Valor de enum inválido en confidence: '${String(rawConfidence)}'.`,
    });
  }
  const confidence = (
    typeof rawConfidence === 'string' && CONFIDENCE_VALUES.has(rawConfidence)
      ? rawConfidence
      : 'Baja'
  ) as Confidence;

  // eligibility
  const rawEligibility = obj['eligibility'];
  if (typeof rawEligibility !== 'string' || !ELIGIBILITY_STATUSES.has(rawEligibility)) {
    issues.push({
      path: 'eligibility',
      code: 'invalid_enum',
      severity: 'blocking',
      message: `Valor de enum inválido en eligibility: '${String(rawEligibility)}'. Valores permitidos: eligible_auditable, eligible_partially_auditable, requires_review, rejected.`,
    });
  }
  let eligibility = (
    typeof rawEligibility === 'string' && ELIGIBILITY_STATUSES.has(rawEligibility)
      ? rawEligibility
      : 'requires_review'
  ) as EligibilityStatus;

  // primary_evidence_url
  const rawEvidenceUrl = obj['primary_evidence_url'];
  let primary_evidence_url: string | null = null;
  if (rawEvidenceUrl !== null && rawEvidenceUrl !== undefined) {
    if (isValidHttpUrl(rawEvidenceUrl)) {
      primary_evidence_url = rawEvidenceUrl as string;
    } else {
      issues.push({
        path: 'primary_evidence_url',
        code: 'invalid_url',
        severity: 'blocking',
        message: `primary_evidence_url no es una URL HTTP/HTTPS válida: '${String(rawEvidenceUrl)}'.`,
      });
    }
  }

  // notes
  const notes = typeof obj['notes'] === 'string' ? obj['notes'] : '';

  // ── Gates de elegibilidad ────────────────────────────────────────────────────

  // Gate 1: eligibilidad final requiere primary_evidence_url
  if (ELIGIBLE_STATUSES.has(eligibility) && primary_evidence_url === null) {
    issues.push({
      path: 'eligibility',
      code: 'eligible_without_evidence',
      severity: 'blocking',
      message: 'Elegibilidad no permitida sin primary_evidence_url válida.',
    });
    eligibility = 'requires_review';
  }

  // Gate 2: confianza Baja no puede ser elegible
  if (confidence === 'Baja' && ELIGIBLE_STATUSES.has(eligibility)) {
    issues.push({
      path: 'eligibility',
      code: 'eligible_with_low_confidence',
      severity: 'blocking',
      message: 'Confianza Baja es incompatible con elegibilidad. Degradado a requires_review.',
    });
    eligibility = 'requires_review';
  }

  // Gate 3: audit_status not_auditable es incompatible con elegibilidad directa
  if (audit_status === 'not_auditable' && ELIGIBLE_STATUSES.has(eligibility)) {
    issues.push({
      path: 'eligibility',
      code: 'eligible_with_not_auditable',
      severity: 'blocking',
      message: 'audit_status not_auditable es incompatible con elegibilidad. Degradado a requires_review.',
    });
    eligibility = 'requires_review';
  }

  // Gate 4 eliminado en 16AB.24.8: el patrón regex sobre texto libre de conflicts[]
  // era demasiado amplio — detectaba menciones de "duplicados" en contextos de alias de
  // identidad (ej: perfiles LinkedIn del mismo ente), no solo duplicados comerciales
  // confirmados. La resolución de duplicidad es ahora competencia de computeFinalEligibility()
  // que recibe un DuplicateResolutionDetail estructurado.

  const sanitizedOutput: CompactVerificationRecord = {
    candidate_name: candidateName || (typeof obj['candidate_name'] === 'string' ? obj['candidate_name'] : ''),
    identity,
    colombia_operation,
    technology_b2b_fit,
    size,
    company_facts,
    ubits_fit,
    conflicts,
    missing_information,
    audit_status,
    confidence,
    eligibility,
    primary_evidence_url,
    notes,
  };

  return buildResult(sanitizedOutput, issues, auditStatusSanitization);
}

// ─── API pública ──────────────────────────────────────────────────────────────

export type ValidateOptions = {
  currentYear?: number;
};

export function validateVerificationOutput(
  input: unknown,
  options?: ValidateOptions,
): VerificationOutputValidationResult {
  const currentYear = options?.currentYear ?? new Date().getFullYear();
  const issues: VerificationOutputValidationIssue[] = [];

  if (typeof input !== 'object' || input === null) {
    issues.push({
      path: '$',
      code: 'invalid_structure',
      severity: 'blocking',
      message: 'El input debe ser un objeto no nulo.',
    });
    return buildResult(null, issues);
  }

  const obj = input as Record<string, unknown>;

  // Migración de schema heredado
  if (isLegacySchema(input)) {
    const migrated = migrateLegacySchema(obj);
    if (!migrated.ok) {
      issues.push({
        path: '$',
        code: 'legacy_migration_failed',
        severity: 'blocking',
        message: migrated.error,
      });
      return buildResult(null, issues);
    }
    issues.push({
      path: '$',
      code: 'legacy_schema_migrated',
      severity: 'warning',
      message: 'Input migrado desde schema 16AB.24.2-v1.',
    });
    return validateCore(migrated.value, currentYear, issues);
  }

  return validateCore(obj, currentYear, issues);
}
