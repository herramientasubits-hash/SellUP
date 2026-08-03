export type {
  WizardExecutionErrorCode,
  WizardExecutionRequest,
  ResolvedCountry,
  ResolvedIndustry,
  ResolvedSubindustry,
  ResolvedCatalog,
  SystemControls,
  ResolvedWizardExecution,
  WizardContext,
  WizardGenerationCommand,
  WizardExecutionActionResult,
  WizardRunProviderOutcome,
} from './wizard-execution-types';

// A1-APOLLO-QA-CONTROL-SURFACE-1 § 2/§ 4 — capacidad sanitizada de la superficie
// administrativa. El núcleo es puro; el resolutor server-side vive en el módulo
// `.server` y NO se reexporta aquí para que un componente cliente no pueda
// importarlo por accidente.
export {
  resolveWizardProviderOverrideCapability,
  isProviderOptionEnabled,
  isRunProviderOverrideSurfaceAvailable,
  isWizardRunSelectableProvider,
  NO_PROVIDER_OVERRIDE_CAPABILITY,
  WIZARD_RUN_SELECTABLE_PROVIDERS,
} from './wizard-run-provider-capability';
export type {
  ApolloRunModeLimits,
  WizardProviderOverrideCapability,
  WizardProviderOverrideCapabilityInput,
  WizardRunSelectableProvider,
} from './wizard-run-provider-capability';
export { WizardExecutionError } from './wizard-execution-types';

export { executeProspectWizardGenerationAction, executeProspectWizardGeneration } from './wizard-execution-actions';
export type { WizardExecutionDeps } from './wizard-execution-actions';

export {
  wizardExecutionRequestSchema,
  validateAndNormalizeCriteria,
  detectDiscriminatoryCriteria,
  detectOutOfScopeCriteria,
  detectPromptInjection,
  normalizeCriteria,
} from './wizard-execution-schema';
export type {
  WizardExecutionRequestParsed,
  CriteriaValidationResult,
} from './wizard-execution-schema';

export { resolveWizardCatalog } from './wizard-catalog-resolver';
export type {
  CatalogResolutionInput,
  CatalogResolutionOutput,
} from './wizard-catalog-resolver';

export {
  adaptResolvedWizardToGenerationInput,
  WIZARD_SYSTEM_CONTROLS,
} from './wizard-pipeline-adapter';

export {
  reserveWizardExecutionSlot,
  WizardIdempotencyError,
} from './wizard-idempotency';
export type {
  WizardExecutionReservationInput,
  WizardExecutionReservationResult,
  IdempotencyDbClient,
  DbError,
} from './wizard-idempotency';
