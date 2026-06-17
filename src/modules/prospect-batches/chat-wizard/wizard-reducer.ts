import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { SEARCH_MODE_DEFINITIONS, VALID_COUNTRY_CODES, GO_BACK_MAP } from './wizard-config';
import type {
  ProspectWizardState,
  ProspectWizardAction,
  ProspectWizardStep,
  WizardWarning,
  WizardBlockingIssue,
} from './wizard-types';

// ── Initial state factory ─────────────────────────────────────────────────────

export type InitialStateParams = {
  catalogVersion: string;
  defaultRequestedCount: number;
};

export function createInitialProspectWizardState(
  params: InitialStateParams,
): ProspectWizardState {
  return {
    currentStep: 'welcome',
    searchMode: null,
    countryCode: null,
    industryId: null,
    subindustryIds: [],
    additionalCriteriaRaw: null,
    requestedCount: params.defaultRequestedCount,
    catalogVersion: params.catalogVersion,
    validationStatus: 'idle',
    warnings: [],
    blockingIssues: [],
    lastEditedStep: null,
    restartConfirmationRequired: false,
    executionError: null,
    executionBatchId: null,
    executionRedirectPath: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function withoutWarningCode(
  warnings: WizardWarning[],
  code: WizardWarning['code'],
): WizardWarning[] {
  return warnings.filter((w) => w.code !== code);
}

function withoutBlockingCode(
  issues: WizardBlockingIssue[],
  code: WizardBlockingIssue['code'],
): WizardBlockingIssue[] {
  return issues.filter((i) => i.code !== code);
}

function withoutBlockingForStep(
  issues: WizardBlockingIssue[],
  step: ProspectWizardStep,
): WizardBlockingIssue[] {
  return issues.filter((i) => i.step !== step);
}

function withoutWarningsForStep(
  warnings: WizardWarning[],
  step: ProspectWizardStep,
): WizardWarning[] {
  return warnings.filter((w) => w.step !== step);
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function prospectWizardReducer(
  state: ProspectWizardState,
  action: ProspectWizardAction,
): ProspectWizardState {
  switch (action.type) {
    // ── START ──────────────────────────────────────────────────────────────
    case 'START': {
      if (state.currentStep !== 'welcome') return state;
      return { ...state, currentStep: 'search_type' };
    }

    // ── SELECT_SEARCH_MODE ──────────────────────────────────────────────────
    case 'SELECT_SEARCH_MODE': {
      if (state.currentStep !== 'search_type') return state;
      const modeDef = SEARCH_MODE_DEFINITIONS.find((d) => d.mode === action.mode);
      if (!modeDef) return state;

      if (modeDef.availability !== 'enabled') {
        const warning: WizardWarning = {
          code: 'MODE_COMING_SOON',
          step: 'search_type',
          message: `El modo "${modeDef.label}" estará disponible próximamente.`,
        };
        return {
          ...state,
          searchMode: action.mode,
          warnings: [
            ...withoutWarningCode(state.warnings, 'MODE_COMING_SOON'),
            warning,
          ],
        };
      }

      return {
        ...state,
        searchMode: action.mode,
        currentStep: 'country',
        warnings: withoutWarningCode(state.warnings, 'MODE_COMING_SOON'),
      };
    }

    // ── SELECT_COUNTRY ──────────────────────────────────────────────────────
    case 'SELECT_COUNTRY': {
      if (state.currentStep !== 'country') return state;

      if (!VALID_COUNTRY_CODES.has(action.countryCode)) {
        const issue: WizardBlockingIssue = {
          code: 'COUNTRY_REQUIRED',
          step: 'country',
          message: 'El código de país no es válido.',
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'COUNTRY_REQUIRED'),
            issue,
          ],
        };
      }

      return {
        ...state,
        countryCode: action.countryCode,
        currentStep: 'industry',
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'COUNTRY_REQUIRED'),
        lastEditedStep: state.lastEditedStep,
      };
    }

    // ── RECONCILE_COUNTRY_SUBINDUSTRIES ─────────────────────────────────────
    case 'RECONCILE_COUNTRY_SUBINDUSTRIES': {
      const compatible = new Set(action.compatibleSubindustryIds);
      const kept = state.subindustryIds.filter((id) => compatible.has(id));
      const removed = state.subindustryIds.length - kept.length;

      if (removed === 0) {
        return { ...state, subindustryIds: kept };
      }

      const warning: WizardWarning = {
        code: 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE',
        step: 'subindustries',
        message: `Se eliminaron ${removed} subindustria${removed > 1 ? 's' : ''} que no están disponibles para el nuevo país.`,
      };

      return {
        ...state,
        subindustryIds: kept,
        warnings: [
          ...withoutWarningCode(state.warnings, 'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE'),
          warning,
        ],
      };
    }

    // ── SELECT_INDUSTRY ─────────────────────────────────────────────────────
    case 'SELECT_INDUSTRY': {
      if (state.currentStep !== 'industry') return state;

      return {
        ...state,
        industryId: action.industryId,
        subindustryIds: [],
        currentStep: 'subindustries',
        warnings: withoutWarningCode(
          state.warnings,
          'SUBINDUSTRIES_REMOVED_AFTER_COUNTRY_CHANGE',
        ),
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'INDUSTRY_REQUIRED'),
      };
    }

    // ── SET_SUBINDUSTRIES ───────────────────────────────────────────────────
    case 'SET_SUBINDUSTRIES': {
      if (state.currentStep !== 'subindustries') return state;

      // Normalize: deduplicate via Set
      const deduped = [...new Set(action.subindustryIds)];
      const max = EXPLORATORY_SEARCH_LIMITS.subindustries.max;

      if (deduped.length > max) {
        const issue: WizardBlockingIssue = {
          code: 'TOO_MANY_SUBINDUSTRIES',
          step: 'subindustries',
          message: `Puedes seleccionar hasta ${max} subindustrias.`,
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
            issue,
          ],
        };
      }

      return {
        ...state,
        subindustryIds: deduped,
        currentStep: 'additional_criteria',
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
      };
    }

    // ── SKIP_SUBINDUSTRIES ──────────────────────────────────────────────────
    case 'SKIP_SUBINDUSTRIES': {
      if (state.currentStep !== 'subindustries') return state;

      return {
        ...state,
        subindustryIds: [],
        currentStep: 'additional_criteria',
        blockingIssues: withoutBlockingCode(state.blockingIssues, 'TOO_MANY_SUBINDUSTRIES'),
      };
    }

    // ── SET_ADDITIONAL_CRITERIA ─────────────────────────────────────────────
    case 'SET_ADDITIONAL_CRITERIA': {
      if (state.currentStep !== 'additional_criteria') return state;

      const value = action.value;
      const maxChars = EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars;

      if (value !== null && value.length > maxChars) {
        const issue: WizardBlockingIssue = {
          code: 'CRITERIA_TOO_LONG',
          step: 'additional_criteria',
          message: `El criterio específico puede tener máximo ${maxChars} caracteres.`,
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'CRITERIA_TOO_LONG'),
            issue,
          ],
        };
      }

      return {
        ...state,
        additionalCriteriaRaw: value,
        currentStep: 'requested_count',
        blockingIssues: withoutBlockingForStep(
          state.blockingIssues,
          'additional_criteria',
        ),
        warnings: withoutWarningsForStep(state.warnings, 'additional_criteria'),
      };
    }

    // ── SKIP_ADDITIONAL_CRITERIA ────────────────────────────────────────────
    case 'SKIP_ADDITIONAL_CRITERIA': {
      if (state.currentStep !== 'additional_criteria') return state;

      return {
        ...state,
        additionalCriteriaRaw: null,
        currentStep: 'summary',
        blockingIssues: withoutBlockingForStep(
          state.blockingIssues,
          'additional_criteria',
        ),
        warnings: withoutWarningsForStep(state.warnings, 'additional_criteria'),
      };
    }

    // ── APPLY_CRITERIA_GUARD_RESULT ─────────────────────────────────────────
    case 'APPLY_CRITERIA_GUARD_RESULT': {
      if (state.currentStep !== 'additional_criteria') return state;

      const { result } = action;

      if (result.status === 'blocked') {
        return {
          ...state,
          additionalCriteriaRaw: null,
          blockingIssues: [
            ...withoutBlockingForStep(state.blockingIssues, 'additional_criteria'),
            ...result.blockingIssues,
          ],
          warnings: [
            ...withoutWarningsForStep(state.warnings, 'additional_criteria'),
            ...result.warnings,
          ],
        };
      }

      // allowed or warning — advance directly to summary
      return {
        ...state,
        additionalCriteriaRaw: result.normalizedValue,
        currentStep: 'summary',
        blockingIssues: [
          ...withoutBlockingForStep(state.blockingIssues, 'additional_criteria'),
          ...result.blockingIssues,
        ],
        warnings: [
          ...withoutWarningsForStep(state.warnings, 'additional_criteria'),
          ...result.warnings,
        ],
      };
    }

    // ── SET_REQUESTED_COUNT ─────────────────────────────────────────────────
    case 'SET_REQUESTED_COUNT': {
      if (state.currentStep !== 'requested_count') return state;

      const { min, max } = EXPLORATORY_SEARCH_LIMITS.requestedCount;

      if (action.value < min || action.value > max) {
        const issue: WizardBlockingIssue = {
          code: 'REQUESTED_COUNT_OUT_OF_RANGE',
          step: 'requested_count',
          message: `La cantidad debe estar entre ${min} y ${max}.`,
          recoverable: true,
        };
        return {
          ...state,
          blockingIssues: [
            ...withoutBlockingCode(state.blockingIssues, 'REQUESTED_COUNT_OUT_OF_RANGE'),
            issue,
          ],
        };
      }

      return {
        ...state,
        requestedCount: action.value,
        currentStep: 'summary',
        blockingIssues: withoutBlockingCode(
          state.blockingIssues,
          'REQUESTED_COUNT_OUT_OF_RANGE',
        ),
      };
    }

    // ── GO_BACK ─────────────────────────────────────────────────────────────
    case 'GO_BACK': {
      const prev = GO_BACK_MAP[state.currentStep as keyof typeof GO_BACK_MAP];
      if (!prev) return state;

      return {
        ...state,
        currentStep: prev as ProspectWizardStep,
      };
    }

    // ── EDIT_STEP ───────────────────────────────────────────────────────────
    case 'EDIT_STEP': {
      return {
        ...state,
        currentStep: action.step,
        lastEditedStep: action.step,
      };
    }

    // ── REQUEST_RESTART ─────────────────────────────────────────────────────
    case 'REQUEST_RESTART': {
      return { ...state, restartConfirmationRequired: true };
    }

    // ── CANCEL_RESTART ──────────────────────────────────────────────────────
    case 'CANCEL_RESTART': {
      return { ...state, restartConfirmationRequired: false };
    }

    // ── CONFIRM_RESTART ─────────────────────────────────────────────────────
    case 'CONFIRM_RESTART': {
      return createInitialProspectWizardState({
        catalogVersion: state.catalogVersion,
        defaultRequestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
      });
    }

    // ── BEGIN_VALIDATION ────────────────────────────────────────────────────
    case 'BEGIN_VALIDATION': {
      if (state.currentStep !== 'summary' && state.currentStep !== 'blocked') return state;

      return {
        ...state,
        currentStep: 'validating',
        validationStatus: 'validating',
      };
    }

    // ── VALIDATION_SUCCEEDED ────────────────────────────────────────────────
    case 'VALIDATION_SUCCEEDED': {
      if (state.currentStep !== 'validating') return state;

      return {
        ...state,
        currentStep: 'validated',
        validationStatus: 'valid',
        blockingIssues: [],
      };
    }

    // ── VALIDATION_FAILED ───────────────────────────────────────────────────
    case 'VALIDATION_FAILED': {
      if (state.currentStep !== 'validating') return state;

      const hasBlocking = action.blockingIssues.length > 0;
      return {
        ...state,
        currentStep: hasBlocking ? 'blocked' : 'summary',
        validationStatus: 'invalid',
        warnings: [...state.warnings, ...action.warnings],
        blockingIssues: [...state.blockingIssues, ...action.blockingIssues],
      };
    }

    // ── CLEAR_FEEDBACK ──────────────────────────────────────────────────────
    case 'CLEAR_FEEDBACK': {
      return {
        ...state,
        warnings: [],
        blockingIssues: [],
        validationStatus: 'idle',
      };
    }

    // ── BEGIN_EXECUTION ─────────────────────────────────────────────────────
    case 'BEGIN_EXECUTION': {
      if (state.currentStep !== 'validated') return state;
      return {
        ...state,
        currentStep: 'submitting',
        executionError: null,
      };
    }

    // ── EXECUTION_SUCCEEDED ─────────────────────────────────────────────────
    case 'EXECUTION_SUCCEEDED': {
      if (state.currentStep !== 'submitting') return state;
      return {
        ...state,
        currentStep: 'success',
        executionBatchId: action.batchId,
        executionRedirectPath: action.redirectPath,
        executionError: null,
      };
    }

    // ── EXECUTION_FAILED ────────────────────────────────────────────────────
    case 'EXECUTION_FAILED': {
      if (state.currentStep !== 'submitting') return state;
      return {
        ...state,
        currentStep: 'validated',
        executionError: {
          code: action.errorCode,
          message: action.message,
          retryable: action.retryable,
        },
      };
    }

    default: {
      const _: never = action;
      void _;
      return state;
    }
  }
}
