'use client';

import * as React from 'react';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { validateExploratorySearch } from '@/modules/industry-catalog/action';
import { detectIncompatibleSubindustries } from '@/modules/industry-catalog/catalog-utils';
import {
  prospectWizardReducer,
  createInitialProspectWizardState,
  deriveWizardMessages,
  getWizardProgress,
  canValidateWizard,
  buildExploratoryFormInput,
} from '@/modules/prospect-batches/chat-wizard';
import type {
  EditableWizardStep,
  WizardBlockingIssue,
  WizardWarning,
  WizardMessageContext,
} from '@/modules/prospect-batches/chat-wizard';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { SearchableSelectOption } from '@/components/forms/searchable-select';
import type { MultiSelectOption } from '@/components/forms/multi-select';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { WizardMessageList } from './wizard-message-list';
import { WizardActiveStep } from './wizard-active-step';
import {
  WizardConversationSummary,
  RestartConfirmation,
} from './wizard-conversation-summary';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUMMARY_STEPS = new Set([
  'summary',
  'validating',
  'validated',
  'blocked',
  'error',
]);

// ── Main component ────────────────────────────────────────────────────────────

type ProspectChatWizardProps = {
  catalog: ActiveIndustryCatalog;
  onClose: () => void;
};

export function ProspectChatWizard({ catalog, onClose }: ProspectChatWizardProps) {
  const [state, dispatch] = React.useReducer(
    prospectWizardReducer,
    undefined,
    () =>
      createInitialProspectWizardState({
        catalogVersion: catalog.version,
        defaultRequestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
      }),
  );

  // ── Derived context for messages ──────────────────────────────────────────

  const messageContext = React.useMemo<WizardMessageContext>(
    () => ({
      countries: LATAM_COUNTRIES,
      industries: catalog.industries.map((i) => ({ id: i.id, name: i.name })),
      subindustries: catalog.subindustries.map((s) => ({
        id: s.id,
        name: s.name,
      })),
    }),
    [catalog],
  );

  const messages = React.useMemo(
    () => deriveWizardMessages(state, messageContext),
    [state, messageContext],
  );

  const progress = React.useMemo(() => getWizardProgress(state), [state]);

  // ── Catalog options derived for UI ────────────────────────────────────────

  const industryOptions = React.useMemo<SearchableSelectOption[]>(
    () =>
      catalog.industries.map((i) => ({
        value: i.id,
        label: i.name,
        description: i.description ?? undefined,
      })),
    [catalog.industries],
  );

  const subindustryOptions = React.useMemo<MultiSelectOption[]>(() => {
    if (!state.industryId) return [];
    return catalog.subindustries
      .filter((s) => {
        if (s.industryId !== state.industryId) return false;
        if (!state.countryCode) return true;
        return (
          s.applicableCountries === null ||
          s.applicableCountries.includes(state.countryCode)
        );
      })
      .map((s) => ({
        value: s.id,
        label: s.name,
        description: s.description ?? undefined,
      }));
  }, [state.industryId, state.countryCode, catalog.subindustries]);

  // ── Autoscroll & focus on step change ────────────────────────────────────

  const activeStepRef = React.useRef<HTMLDivElement>(null);
  const stepTitleRef = React.useRef<HTMLHeadingElement>(null);
  const prevStepRef = React.useRef(state.currentStep);

  React.useEffect(() => {
    if (state.currentStep === prevStepRef.current) return;
    prevStepRef.current = state.currentStep;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    activeStepRef.current?.scrollIntoView({
      behavior: prefersReduced ? 'auto' : 'smooth',
      block: 'nearest',
    });

    // Focus step title for keyboard / screen reader users
    const focusId = setTimeout(() => {
      stepTitleRef.current?.focus({ preventScroll: true });
    }, 80);

    return () => clearTimeout(focusId);
  }, [state.currentStep]);

  // ── Country change with geographic reconciliation ─────────────────────────

  function handleCountryChange(code: string) {
    const incompatibleIds = detectIncompatibleSubindustries(
      state.subindustryIds,
      catalog.subindustries,
      code,
    );
    const compatibleIds = state.subindustryIds.filter(
      (id) => !incompatibleIds.includes(id),
    );
    dispatch({ type: 'SELECT_COUNTRY', countryCode: code });
    if (incompatibleIds.length > 0) {
      dispatch({
        type: 'RECONCILE_COUNTRY_SUBINDUSTRIES',
        compatibleSubindustryIds: compatibleIds,
      });
    }
  }

  // ── Edit step ─────────────────────────────────────────────────────────────

  function handleEditStep(step: EditableWizardStep) {
    dispatch({ type: 'EDIT_STEP', step });
  }

  // ── Validation ────────────────────────────────────────────────────────────

  async function handleValidate() {
    if (!canValidateWizard(state)) return;
    const payload = buildExploratoryFormInput(state);
    if (!payload) return;

    dispatch({ type: 'BEGIN_VALIDATION' });

    try {
      const result = await validateExploratorySearch(payload);

      if (result.valid) {
        dispatch({ type: 'VALIDATION_SUCCEEDED' });
        return;
      }

      const blockingIssues: WizardBlockingIssue[] = [];
      for (const [field, errors] of Object.entries(result.fieldErrors)) {
        for (const msg of errors) {
          blockingIssues.push({
            code: 'SERVER_VALIDATION_FAILED',
            step: 'summary',
            message:
              field !== '_root' && field !== 'catalogVersion'
                ? `${field}: ${msg}`
                : msg,
            recoverable: true,
          });
        }
      }

      const warnings: WizardWarning[] = result.warnings.map((msg) => ({
        code: 'CRITERIA_OUTSIDE_CATALOG',
        step: 'summary' as const,
        message: msg,
      }));

      dispatch({ type: 'VALIDATION_FAILED', warnings, blockingIssues });
    } catch (err) {
      dispatch({
        type: 'VALIDATION_FAILED',
        warnings: [],
        blockingIssues: [
          {
            code: 'SERVER_VALIDATION_FAILED',
            step: 'summary',
            message:
              err instanceof Error
                ? err.message
                : 'Error al validar la búsqueda.',
            recoverable: true,
          },
        ],
      });
    }
  }

  // ── Progress label ────────────────────────────────────────────────────────

  const showProgress =
    !['welcome', 'validating', 'validated', 'blocked', 'error'].includes(
      state.currentStep,
    );
  const progressLabel =
    progress.currentStepIndex > 0
      ? `Paso ${progress.currentStepIndex} de ${progress.totalSteps}`
      : null;

  const isSummaryPhase = SUMMARY_STEPS.has(state.currentStep);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">
      {/* Progress indicator */}
      {showProgress && progressLabel && (
        <div className="flex items-center gap-3" aria-hidden>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-su-brand transition-all duration-500"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {progressLabel}
          </span>
        </div>
      )}

      {/* Conversation history */}
      {messages.length > 0 && (
        <WizardMessageList
          messages={messages}
          currentStep={state.currentStep}
          onEditStep={handleEditStep}
        />
      )}

      {/* Restart confirmation (inline modal) */}
      {state.restartConfirmationRequired && (
        <RestartConfirmation dispatch={dispatch} />
      )}

      {/* Active step input or summary */}
      {!state.restartConfirmationRequired && (
        <div ref={activeStepRef}>
          {isSummaryPhase ? (
            <WizardConversationSummary
              state={state}
              catalog={catalog}
              dispatch={dispatch}
              onValidate={handleValidate}
              onClose={onClose}
            />
          ) : (
            <WizardActiveStep
              state={state}
              dispatch={dispatch}
              industryOptions={industryOptions}
              subindustryOptions={subindustryOptions}
              onCountryChange={handleCountryChange}
              stepTitleRef={stepTitleRef}
            />
          )}
        </div>
      )}
    </div>
  );
}
