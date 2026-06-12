import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { SEARCH_MODE_DEFINITIONS } from './wizard-config';
import type {
  ProspectWizardState,
  ProspectWizardStep,
  ProspectSearchModeDefinition,
  WizardProgress,
  WizardFormPayload,
} from './wizard-types';

// ── Progress ──────────────────────────────────────────────────────────────────

const PROGRESS_STEPS: ProspectWizardStep[] = [
  'search_type',
  'country',
  'industry',
  'subindustries',
  'additional_criteria',
  'summary',
];

export function getWizardProgress(state: ProspectWizardState): WizardProgress {
  const terminal: ProspectWizardStep[] = ['summary', 'validating', 'validated', 'blocked', 'error'];
  if (terminal.includes(state.currentStep)) {
    return { currentStepIndex: PROGRESS_STEPS.length, totalSteps: PROGRESS_STEPS.length, percentage: 100 };
  }

  const idx = PROGRESS_STEPS.indexOf(state.currentStep);
  const currentStepIndex = idx === -1 ? 0 : idx;
  const totalSteps = PROGRESS_STEPS.length;
  const percentage = Math.round((currentStepIndex / totalSteps) * 100);

  return { currentStepIndex, totalSteps, percentage };
}

// ── Navigation ────────────────────────────────────────────────────────────────

const PREV_MAP: Partial<Record<ProspectWizardStep, ProspectWizardStep>> = {
  search_type: 'welcome',
  country: 'search_type',
  industry: 'country',
  subindustries: 'industry',
  additional_criteria: 'subindustries',
  summary: 'additional_criteria',
  validating: 'summary',
  validated: 'summary',
  blocked: 'summary',
  error: 'summary',
};

export function getPreviousWizardStep(
  step: ProspectWizardStep,
): ProspectWizardStep | null {
  return PREV_MAP[step] ?? null;
}

// ── Can-advance checks ────────────────────────────────────────────────────────

export function canAdvanceFromCurrentStep(state: ProspectWizardState): boolean {
  const hasBlocking = state.blockingIssues.length > 0;

  switch (state.currentStep) {
    case 'welcome':
      return true;

    case 'search_type':
      return (
        state.searchMode !== null &&
        !hasBlocking &&
        (SEARCH_MODE_DEFINITIONS.find((d) => d.mode === state.searchMode)
          ?.availability === 'enabled')
      );

    case 'country':
      return state.countryCode !== null && !hasBlocking;

    case 'industry':
      return state.industryId !== null && !hasBlocking;

    case 'subindustries':
      return !hasBlocking;

    case 'additional_criteria':
      return !hasBlocking;

    case 'summary':
      return !hasBlocking;

    default:
      return false;
  }
}

export function canValidateWizard(state: ProspectWizardState): boolean {
  return (
    state.currentStep === 'summary' &&
    state.searchMode === 'exploratory' &&
    state.countryCode !== null &&
    state.industryId !== null &&
    state.requestedCount !== null &&
    state.blockingIssues.length === 0
  );
}

export function isWizardComplete(state: ProspectWizardState): boolean {
  return state.currentStep === 'validated' && state.validationStatus === 'valid';
}

// ── Mode availability ─────────────────────────────────────────────────────────

export function getAvailableSearchModes(): ProspectSearchModeDefinition[] {
  return SEARCH_MODE_DEFINITIONS;
}

// ── Form payload builder ──────────────────────────────────────────────────────

export function buildExploratoryFormInput(
  state: ProspectWizardState,
): WizardFormPayload | null {
  // requestedCount is system-controlled and is not user-configurable in the UI.
  // It will be determined by SellUp based on quality, availability, and other criteria.
  // We keep it in the state for compatibility with existing validation/preview logic.
  const { min, max } = EXPLORATORY_SEARCH_LIMITS.requestedCount;
  const maxSubs = EXPLORATORY_SEARCH_LIMITS.subindustries.max;

  if (
    state.searchMode !== 'exploratory' ||
    !state.countryCode ||
    !state.industryId ||
    state.requestedCount === null ||
    state.requestedCount < min ||
    state.requestedCount > max ||
    state.subindustryIds.length > maxSubs ||
    state.blockingIssues.length > 0
  ) {
    return null;
  }

  return {
    countryCode: state.countryCode,
    industryId: state.industryId,
    subindustryIds: state.subindustryIds,
    additionalCriteriaRaw: state.additionalCriteriaRaw,
    requestedCount: state.requestedCount,
    catalogVersion: state.catalogVersion,
  };
}

// ── Invariant validator (dev/test use) ────────────────────────────────────────

export function validateWizardStateInvariants(state: ProspectWizardState): string[] {
  const violations: string[] = [];

  if (state.subindustryIds.length > EXPLORATORY_SEARCH_LIMITS.subindustries.max) {
    violations.push(
      `subindustryIds exceeds max (${state.subindustryIds.length} > ${EXPLORATORY_SEARCH_LIMITS.subindustries.max})`,
    );
  }

  const unique = new Set(state.subindustryIds);
  if (unique.size !== state.subindustryIds.length) {
    violations.push('subindustryIds contains duplicates');
  }

  if (state.currentStep === 'validated') {
    if (!state.countryCode) violations.push('validated state missing countryCode');
    if (!state.industryId) violations.push('validated state missing industryId');
    if (state.requestedCount === null) violations.push('validated state missing requestedCount');
  }

  if (
    state.searchMode &&
    state.searchMode !== 'exploratory' &&
    (state.currentStep === 'country' ||
      state.currentStep === 'industry' ||
      state.currentStep === 'subindustries' ||
      state.currentStep === 'additional_criteria')
  ) {
    violations.push(
      `coming_soon mode "${state.searchMode}" reached step "${state.currentStep}"`,
    );
  }

  if (state.currentStep === 'validating' && state.blockingIssues.length > 0) {
    violations.push('validating step has blockingIssues — validation should not start');
  }

  if (state.currentStep === 'summary' && state.requestedCount === null) {
    violations.push('summary step reached without requestedCount');
  }

  if (!state.catalogVersion || state.catalogVersion.trim() === '') {
    violations.push('catalogVersion is empty');
  }

  return violations;
}
