// ── Search mode contracts ─────────────────────────────────────────────────────

export type ProspectSearchMode = 'exploratory' | 'competitors' | 'suppliers';

export type ProspectSearchModeAvailability = 'enabled' | 'coming_soon' | 'disabled';

export type ProspectSearchModeDefinition = {
  mode: ProspectSearchMode;
  label: string;
  description: string;
  availability: ProspectSearchModeAvailability;
};

// ── Step contracts ────────────────────────────────────────────────────────────

export type ProspectWizardStep =
  | 'welcome'
  | 'search_type'
  | 'country'
  | 'industry'
  | 'subindustries'
  | 'additional_criteria'
  | 'requested_count'
  | 'summary'
  | 'validating'
  | 'validated'
  | 'submitting'
  | 'success'
  | 'blocked'
  | 'error';

export type EditableWizardStep =
  | 'search_type'
  | 'country'
  | 'industry'
  | 'subindustries'
  | 'additional_criteria'
  | 'requested_count';

// ── Feedback contracts ────────────────────────────────────────────────────────

export type WizardWarningCode =
  | 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE'
  | 'MODE_COMING_SOON'
  | 'CRITERIA_DIFFICULT_TO_VERIFY'
  | 'CRITERIA_OUTSIDE_CATALOG';

export type WizardBlockingIssueCode =
  | 'COUNTRY_REQUIRED'
  | 'INDUSTRY_REQUIRED'
  | 'TOO_MANY_SUBINDUSTRIES'
  | 'CRITERIA_TOO_LONG'
  | 'REQUESTED_COUNT_OUT_OF_RANGE'
  | 'UNSAFE_CRITERIA'
  | 'DISCRIMINATORY_CRITERIA'
  | 'PROMPT_INJECTION'
  | 'OUT_OF_SCOPE'
  | 'SERVER_VALIDATION_FAILED';

export type WizardWarning = {
  code: WizardWarningCode;
  step: ProspectWizardStep;
  message: string;
};

export type WizardBlockingIssue = {
  code: WizardBlockingIssueCode;
  step: ProspectWizardStep;
  message: string;
  recoverable: boolean;
};

// ── Guard contract (prepared for 16AB.35.3) ───────────────────────────────────

export type CriteriaGuardResult = {
  status: 'allowed' | 'warning' | 'blocked';
  normalizedValue: string | null;
  warnings: WizardWarning[];
  blockingIssues: WizardBlockingIssue[];
};

// ── State contract ────────────────────────────────────────────────────────────

export type ProspectWizardState = {
  currentStep: ProspectWizardStep;

  searchMode: ProspectSearchMode | null;
  countryCode: string | null;
  industryId: string | null;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
  requestedCount: number | null;
  catalogVersion: string;

  validationStatus: 'idle' | 'validating' | 'valid' | 'invalid';

  warnings: WizardWarning[];
  blockingIssues: WizardBlockingIssue[];

  lastEditedStep: ProspectWizardStep | null;
  restartConfirmationRequired: boolean;

  executionError: { code: string; message: string; retryable: boolean } | null;
  executionBatchId: string | null;
  executionRedirectPath: string | null;
  executionStatus: 'created' | 'already_started' | 'no_new_candidates' | null;
  /** True when novelty pre-check confirms the universe of domains for these criteria is exhausted. */
  executionNoveltyExhausted?: boolean;
};

// ── Action contracts ──────────────────────────────────────────────────────────

export type ProspectWizardAction =
  | { type: 'START' }
  | { type: 'SELECT_SEARCH_MODE'; mode: ProspectSearchMode }
  | { type: 'SELECT_COUNTRY'; countryCode: string }
  | { type: 'SELECT_INDUSTRY'; industryId: string }
  | { type: 'SET_SUBINDUSTRIES'; subindustryIds: string[] }
  | { type: 'SKIP_SUBINDUSTRIES' }
  | { type: 'SET_ADDITIONAL_CRITERIA'; value: string | null }
  | { type: 'SKIP_ADDITIONAL_CRITERIA' }
  | { type: 'SET_REQUESTED_COUNT'; value: number }
  | { type: 'GO_BACK' }
  | { type: 'EDIT_STEP'; step: EditableWizardStep }
  | { type: 'REQUEST_RESTART' }
  | { type: 'CANCEL_RESTART' }
  | { type: 'CONFIRM_RESTART' }
  | { type: 'BEGIN_VALIDATION' }
  | { type: 'VALIDATION_SUCCEEDED' }
  | {
      type: 'VALIDATION_FAILED';
      warnings: WizardWarning[];
      blockingIssues: WizardBlockingIssue[];
    }
  | { type: 'CLEAR_FEEDBACK' }
  | { type: 'RECONCILE_COUNTRY_SUBINDUSTRIES'; compatibleSubindustryIds: string[] }
  | { type: 'APPLY_CRITERIA_GUARD_RESULT'; rawValue: string; result: CriteriaGuardResult }
  | { type: 'BEGIN_EXECUTION' }
  | { type: 'EXECUTION_SUCCEEDED'; batchId: string; redirectPath: string; status: 'created' | 'already_started' | 'no_new_candidates'; noveltyExhausted?: boolean }
  | { type: 'EXECUTION_FAILED'; errorCode: string; message: string; retryable: boolean };

// ── Derived message contract ──────────────────────────────────────────────────

export type DerivedWizardMessageRole = 'assistant' | 'user' | 'system';

export type DerivedWizardMessageType =
  | 'text'
  | 'choice'
  | 'selection_summary'
  | 'warning'
  | 'error'
  | 'confirmation';

export type DerivedWizardMessage = {
  id: string;
  role: DerivedWizardMessageRole;
  messageType: DerivedWizardMessageType;
  content: string;
  step: ProspectWizardStep;
};

export type WizardMessageContext = {
  countries: Array<{ code: string; name: string }>;
  industries: Array<{ id: string; name: string }>;
  subindustries: Array<{ id: string; name: string }>;
};

// ── Selector output contracts ─────────────────────────────────────────────────

export type WizardProgress = {
  currentStepIndex: number;
  totalSteps: number;
  percentage: number;
};

export type WizardFormPayload = {
  countryCode: string;
  industryId: string;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
  requestedCount: number;
  catalogVersion: string;
};
