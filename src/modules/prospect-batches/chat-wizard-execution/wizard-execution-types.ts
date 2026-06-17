import type { GenerateAIBatchInput } from '@/modules/prospect-batches/actions';

// ── Error codes ───────────────────────────────────────────────────────────────

export type WizardExecutionErrorCode =
  | 'UNAUTHENTICATED'
  | 'INACTIVE_USER'
  | 'INVALID_REQUEST'
  | 'CATALOG_VERSION_NOT_FOUND'
  | 'CATALOG_VERSION_NOT_PUBLISHED'
  | 'CATALOG_VERSION_CHANGED'
  | 'INDUSTRY_NOT_FOUND'
  | 'INDUSTRY_VERSION_MISMATCH'
  | 'SUBINDUSTRY_NOT_FOUND'
  | 'SUBINDUSTRY_INDUSTRY_MISMATCH'
  | 'SUBINDUSTRY_COUNTRY_MISMATCH'
  | 'TOO_MANY_SUBINDUSTRIES'
  | 'INVALID_CRITERIA';

export class WizardExecutionError extends Error {
  constructor(
    public readonly code: WizardExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WizardExecutionError';
  }
}

// ── Request contract (client → server boundary) ───────────────────────────────
// Fields the browser may safely send.
// Absent: userId, targetCount, requestedCount, employeeThreshold, industry/country names.
// Server derives all labels and controls from the authenticated session and catalog.

export type WizardExecutionRequest = {
  countryCode: string;
  industryId: string;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
  catalogVersion: string;
  clientRequestId: string;
};

// ── Resolved catalog entities ─────────────────────────────────────────────────

export type ResolvedCountry = {
  code: string;
  name: string;
};

export type ResolvedIndustry = {
  id: string;
  slug: string;
  name: string;
};

export type ResolvedSubindustry = {
  id: string;
  slug: string;
  name: string;
  applicableCountries: string[] | null;
};

export type ResolvedCatalog = {
  version: string;
};

export type SystemControls = {
  targetCount: number;
  minimumEmployees: number;
  employeeThresholdMode: 'hard_filter';
};

// ── Resolved execution (server internal) ─────────────────────────────────────
// All labels and IDs are canonical — resolved server-side from the catalog.
// userId is always obtained from the active session, never from the client payload.

export type ResolvedWizardExecution = {
  userId: string;
  clientRequestId: string;
  mode: 'exploratory';
  country: ResolvedCountry;
  catalog: ResolvedCatalog;
  industry: ResolvedIndustry;
  subindustries: ResolvedSubindustry[];
  additionalCriteria: string | null;
  systemControls: SystemControls;
};

// ── Wizard context preserved beyond GenerateAIBatchInput ─────────────────────
// GenerateAIBatchInput has no fields for subindustries, additional criteria,
// or catalog metadata. These are preserved here for traceability and future use.

export type WizardContext = {
  catalogVersion: string;
  industryId: string;
  subindustries: ResolvedSubindustry[];
  additionalCriteria: string | null;
  clientRequestId: string;
  employeeSizeCriteria: {
    minEmployeeCountExclusive: number;
    enforcement: 'hard_filter';
    scope: 'local_legal_entity';
  };
};

// ── Adapter output ────────────────────────────────────────────────────────────
// Wraps GenerateAIBatchInput with preserved wizard context.
// generationInput is ready to be passed to generateAIProspectBatch.
// wizardContext carries fields with no counterpart in the current pipeline.

export type WizardGenerationCommand = {
  generationInput: GenerateAIBatchInput;
  wizardContext: WizardContext;
};

// ── Action result (server action return type) ─────────────────────────────────

export type WizardExecutionActionResult =
  | {
      ok: true;
      status: 'created' | 'already_started';
      batchId: string;
      batchStatus: string;
      candidateCount?: number;
      redirectPath: string;
      /** Present when budget reconciliation failed after a successful generation. */
      reconciliationWarning?: 'BUDGET_RECONCILIATION_FAILED';
    }
  | {
      ok: false;
      code:
        | 'EXECUTION_DISABLED'
        | 'UNAUTHENTICATED'
        | 'INACTIVE_USER'
        | 'INVALID_REQUEST'
        | 'CATALOG_CHANGED'
        | 'IDEMPOTENCY_CONFLICT'
        | 'PROVIDER_UNAVAILABLE'
        | 'GENERATION_FAILED'
        // Pilot budget guardrail codes (16AB.43.17)
        | 'PILOT_PAUSED'
        | 'NOT_IN_PILOT'
        | 'BUDGET_PERIOD_NOT_CONFIGURED'
        | 'BUDGET_PERIOD_CLOSED'
        | 'EXECUTION_CREDIT_LIMIT_EXCEEDED'
        | 'BUDGET_EXCEEDED'
        | 'CONCURRENT_EXECUTION_ACTIVE'
        | 'BUDGET_RESERVATION_FAILED';
      message: string;
      retryable: boolean;
    };
