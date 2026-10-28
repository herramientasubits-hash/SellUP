// ── Public API — Prospect Chat Wizard (16AB.35.1) ─────────────────────────────
// No visual components in this hito. Only the state machine core.

export type {
  ProspectSearchMode,
  ProspectSearchModeAvailability,
  ProspectSearchModeDefinition,
  ProspectWizardStep,
  EditableWizardStep,
  WizardWarningCode,
  WizardBlockingIssueCode,
  WizardWarning,
  WizardBlockingIssue,
  CriteriaGuardResult,
  ProspectWizardState,
  ProspectWizardAction,
  DerivedWizardMessage,
  DerivedWizardMessageRole,
  DerivedWizardMessageType,
  WizardMessageContext,
  WizardProgress,
  WizardFormPayload,
  WizardSearchModePayload,
} from './wizard-types';

export {
  SEARCH_MODE_DEFINITIONS,
  BULK_SEARCH_OPTION,
  searchModeDisplayLabel,
  VALID_COUNTRY_CODES,
  REFERENCE_COMPANY_LIMITS,
  MAX_COMPETITOR_COUNTRIES,
  resolveSearchModeDefinitions,
} from './wizard-config';

export {
  createInitialProspectWizardState,
  prospectWizardReducer,
} from './wizard-reducer';
export type { InitialStateParams } from './wizard-reducer';

export { deriveWizardMessages } from './wizard-messages';

export {
  canAdvanceFromCurrentStep,
  canValidateWizard,
  isWizardComplete,
  getWizardProgress,
  getPreviousWizardStep,
  getAvailableSearchModes,
  buildExploratoryFormInput,
  buildSearchModePayload,
  getSearchCountryCodes,
  hasValidReferenceCompany,
  validateWizardStateInvariants,
} from './wizard-selectors';
