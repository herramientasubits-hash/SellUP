/**
 * Structured Candidate Helpers — Hito 16AB.4
 *
 * Funciones puras de clasificación para candidatos de fuentes
 * masivas estructuradas. Sin side effects. Sin I/O. Sin LLM.
 * Sin writes a Supabase. Sin llamadas HubSpot.
 */

import type {
  CommercialFitStatus,
  CommercialTrace,
  EmployeeCountStatus,
  HubspotMatchStatus,
  HubspotTrace,
  ReviewFlag,
} from './structured-candidate-types';

// ── classifyEmployeeCount ─────────────────────────────────────

type EmployeeCountSource =
  | 'hubspot'
  | 'apollo'
  | 'linkedin'
  | 'lusha'
  | 'manual'
  | 'unknown';

type ClassifyEmployeeCountParams = {
  employeeCount: number | null;
  source: EmployeeCountSource;
  confirmed?: boolean;
};

type ClassifyEmployeeCountResult = {
  employeeCountStatus: EmployeeCountStatus;
  commercialFitStatus: CommercialFitStatus;
  reviewFlags: ReviewFlag[];
};

/**
 * Clasifica el tamaño de empresa y determina fit comercial inicial.
 *
 * Regla crítica: employeeCount null NO descarta al candidato.
 * Queda como unknown_requires_manual_validation para revisión manual.
 */
export function classifyEmployeeCount(
  params: ClassifyEmployeeCountParams
): ClassifyEmployeeCountResult {
  const { employeeCount, confirmed = false } = params;

  if (employeeCount === null) {
    return {
      employeeCountStatus: 'unknown_requires_manual_validation',
      commercialFitStatus: 'needs_manual_review',
      reviewFlags: ['size_unknown'],
    };
  }

  if (confirmed && employeeCount >= 100) {
    return {
      employeeCountStatus: 'confirmed_100_plus',
      commercialFitStatus: 'likely_fit',
      reviewFlags: ['size_confirmed'],
    };
  }

  if (confirmed && employeeCount < 100) {
    return {
      employeeCountStatus: 'confirmed_under_100',
      commercialFitStatus: 'likely_not_fit',
      reviewFlags: ['size_below_threshold'],
    };
  }

  if (!confirmed && employeeCount >= 100) {
    return {
      employeeCountStatus: 'estimated_100_plus',
      commercialFitStatus: 'likely_fit',
      reviewFlags: ['size_estimated'],
    };
  }

  // !confirmed && employeeCount < 100
  return {
    employeeCountStatus: 'estimated_under_100',
    commercialFitStatus: 'risky_fit',
    reviewFlags: ['size_estimated_below_threshold'],
  };
}

// ── buildInitialReviewFlags ───────────────────────────────────

type BuildInitialReviewFlagsParams = {
  taxId: string | null;
  website: string | null;
  linkedinUrl: string | null;
  decisionMakerName: string | null;
  sectorCode: string | null;
  legalStatus: string | null;
  source: string;
  email: string | null;
  phone: string | null;
};

const INACTIVE_LEGAL_STATUS_PATTERNS = [
  'inactiva', 'cancelada', 'liquidada', 'disuelta',
  'cancelled', 'inactive', 'dissolved', 'liquidated',
];

/**
 * Genera flags de revisión iniciales a partir de campos disponibles.
 * Función pura — no llama APIs externas.
 */
export function buildInitialReviewFlags(
  params: BuildInitialReviewFlagsParams
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  if (!params.taxId) flags.push('no_tax_id');
  if (!params.website) flags.push('missing_website');
  if (!params.linkedinUrl) flags.push('missing_linkedin');
  if (!params.decisionMakerName) flags.push('missing_decision_maker');

  if (!params.sectorCode) {
    flags.push('sector_unknown');
  } else {
    flags.push('sector_match');
  }

  if (params.legalStatus) {
    const normalized = params.legalStatus.toLowerCase();
    const isInactive = INACTIVE_LEGAL_STATUS_PATTERNS.some((p) =>
      normalized.includes(p)
    );
    if (isInactive) flags.push('inactive_company');
  }

  if (params.source === 'reps') {
    if (params.email) flags.push('pii_email_risk');
    if (params.phone) flags.push('pii_phone_risk');
  }

  if (params.source === 'secop2' && !params.website && !params.sectorCode) {
    flags.push('source_low_confidence');
  }

  return flags;
}

// ── buildDefaultHubspotTrace ──────────────────────────────────

/**
 * Construye un HubspotTrace inicial con estado not_attempted.
 */
export function buildDefaultHubspotTrace(): HubspotTrace {
  return {
    lookupAttempted: false,
    lookupAt: null,
    matchStatus: 'not_attempted' as HubspotMatchStatus,
    matchedCompanyId: null,
    matchedBy: null,
    possibleMatches: [],
    syncAttempted: false,
    syncAt: null,
    syncStatus: null,
    syncError: null,
    syncedByUserId: null,
  };
}

// ── buildDefaultCommercialTrace ───────────────────────────────

/**
 * Construye un CommercialTrace inicial para candidatos sin datos de empleados.
 */
export function buildDefaultCommercialTrace(params: {
  employeeCountStatus: EmployeeCountStatus;
  reviewFlags: ReviewFlag[];
}): CommercialTrace {
  return {
    employeeCountStatus: params.employeeCountStatus,
    employeeCountSource: null,
    employeeCountConfidence: null,
    fitReasons: [],
    reviewFlags: params.reviewFlags,
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    approvedBy: null,
    approvedAt: null,
  };
}
