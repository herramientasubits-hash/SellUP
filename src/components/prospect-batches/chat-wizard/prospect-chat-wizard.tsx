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
  CriteriaGuardResult,
} from '@/modules/prospect-batches/chat-wizard';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { SearchableSelectOption } from '@/components/forms/searchable-select';
import type { MultiSelectOption } from '@/components/forms/multi-select';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { detectPromptInjection, normalizeCriteria } from '@/modules/industry-catalog/schema';
import { WizardMessageList } from './wizard-message-list';
import { WizardActiveStep } from './wizard-active-step';
import {
  WizardConversationSummary,
  RestartConfirmation,
} from './wizard-conversation-summary';
import { WizardChatComposer } from './wizard-chat-composer';
import { getComposerMode, getComposerPlaceholder } from './wizard-composer-utils';

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

  // Criteria text draft for the composer — reset on submit or skip
  const [criteriaText, setCriteriaText] = React.useState('');

  // Tracks whether the user confirmed they want to add criteria (YES/NO gate)
  const [criteriaIntention, setCriteriaIntention] = React.useState<'pending' | 'yes'>('pending');

  // ── Progressive message reveal ─────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [isTyping, setIsTyping] = React.useState(false);
  const prevMsgCountRef = React.useRef(0);
  const typingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Sound: short "pop" when AI message appears ─────────────────────────────
  const playMessageSound = React.useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
      setTimeout(() => ctx.close(), 200);
    } catch {
      // Silently ignore if AudioContext is unavailable
    }
  }, []);

  // ── Progressive reveal: show messages one-by-one with typing delay ──────────
  React.useEffect(() => {
    const prevCount = prevMsgCountRef.current;
    const newCount = messages.length;

    if (newCount > prevCount) {
      // New messages arrived — reveal them progressively
      let revealed = prevCount;
      const revealNext = () => {
        if (revealed >= newCount) {
          setIsTyping(false);
          return;
        }
        revealed++;
        setIsTyping(revealed < newCount);
        setVisibleCount(revealed);
        // Play sound only for assistant messages (not user/system)
        const msg = messages[revealed - 1];
        if (msg?.role === 'assistant') {
          playMessageSound();
        }
        if (revealed < newCount) {
          typingTimerRef.current = setTimeout(revealNext, 450);
        }
      };
      // Start revealing
      setIsTyping(true);
      typingTimerRef.current = setTimeout(revealNext, 400);
    } else if (newCount < prevCount) {
      // Messages removed (e.g. restart) — reset
      setVisibleCount(newCount);
    }

    prevMsgCountRef.current = newCount;

    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [messages.length, messages, playMessageSound]);

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

  // ── Auto-start conversation on mount ──────────────────────────────────────

  React.useEffect(() => {
    if (state.currentStep !== 'welcome') return;
    dispatch({ type: 'START' });
  }, [state.currentStep, dispatch]);

  // ── Autoscroll on step change ─────────────────────────────────────────────

  const activeStepRef = React.useRef<HTMLDivElement>(null);
  const stepTitleRef = React.useRef<HTMLHeadingElement>(null);
  const prevStepRef = React.useRef(state.currentStep);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (state.currentStep === prevStepRef.current) return;
    prevStepRef.current = state.currentStep;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const behavior = prefersReduced ? 'auto' : 'smooth';

    // For summary/validating/validated/blocked: scroll to very bottom of the scroll container
    if (SUMMARY_STEPS.has(state.currentStep) || state.currentStep === 'validated') {
      requestAnimationFrame(() => {
        // The DrawerShell puts overflow-y-auto on a parent div — find it
        const scrollEl = scrollContainerRef.current?.closest('.overflow-y-auto') as HTMLElement | null
          ?? scrollContainerRef.current?.parentElement as HTMLElement | null;
        if (scrollEl) {
          scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior });
        }
        activeStepRef.current?.scrollIntoView({ behavior, block: 'end' });
      });
    } else {
      activeStepRef.current?.scrollIntoView({ behavior, block: 'nearest' });
    }

    const focusId = setTimeout(() => {
      stepTitleRef.current?.focus({ preventScroll: true });
    }, 80);

    return () => clearTimeout(focusId);
  }, [state.currentStep]);

  // ── Autoscroll when new messages are revealed progressively ─────────────────
  React.useEffect(() => {
    if (visibleCount === 0) return;
    requestAnimationFrame(() => {
      const scrollEl = scrollContainerRef.current?.closest('.overflow-y-auto') as HTMLElement | null
        ?? scrollContainerRef.current?.parentElement as HTMLElement | null;
      if (scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      }
    });
  }, [visibleCount]);

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

  // ── Summary dispatch wrapper — resets criteria gate when going back ────────
  // GO_BACK from summary and EDIT_STEP to additional_criteria both return the
  // user to that step; reset the intention so the YES/NO gate re-appears.

  function summaryDispatch(action: Parameters<typeof dispatch>[0]) {
    if (
      action.type === 'GO_BACK' ||
      (action.type === 'EDIT_STEP' && action.step === 'additional_criteria')
    ) {
      setCriteriaIntention('pending');
      setCriteriaText('');
    }
    dispatch(action);
  }

  // ── Composer submission (additional criteria) ─────────────────────────────

  function handleComposerSubmit() {
    if (state.currentStep !== 'additional_criteria') return;
    const trimmed = criteriaText.trim();
    if (!trimmed) return;

    const maxChars = EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars;
    if (trimmed.length > maxChars) return;

    const normalized = normalizeCriteria(trimmed);
    const hasInjection = normalized ? detectPromptInjection(normalized) : false;
    const warnings: WizardWarning[] = hasInjection
      ? [
          {
            code: 'CRITERIA_OUTSIDE_CATALOG',
            step: 'additional_criteria',
            message: 'El criterio contiene instrucciones que no se procesarán.',
          },
        ]
      : [];
    const result: CriteriaGuardResult = {
      status: hasInjection ? 'warning' : 'allowed',
      normalizedValue: normalized,
      warnings,
      blockingIssues: [],
    };

    dispatch({ type: 'APPLY_CRITERIA_GUARD_RESULT', rawValue: trimmed, result });
    setCriteriaText('');
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

  // Lock the composer until the user explicitly says YES to adding criteria
  const composerMode =
    state.currentStep === 'additional_criteria' && criteriaIntention === 'pending'
      ? ('locked_selection' as const)
      : getComposerMode(state.currentStep);
  const composerPlaceholder =
    state.currentStep === 'additional_criteria' && criteriaIntention === 'pending'
      ? '¿Quieres agregar algún criterio adicional?'
      : getComposerPlaceholder(state.currentStep);
  const maxCriteriaChars = EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-0 min-h-full">
      {/* Scrollable conversation body */}
      <div ref={scrollContainerRef} className="flex flex-col gap-4 pb-6">
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
            visibleCount={visibleCount}
            isTyping={isTyping}
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
                dispatch={summaryDispatch}
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
                criteriaIntention={criteriaIntention}
                onCriteriaIntentionYes={() => setCriteriaIntention('yes')}
              />
            )}
          </div>
        )}
      </div>

      {/* Sticky composer — spans full width by negating the drawer's px-7 padding */}
      <div className="sticky bottom-0 -mx-7 px-7 pt-3 pb-4 bg-background border-t border-border/30 mt-auto">
        <WizardChatComposer
          mode={composerMode}
          value={criteriaText}
          placeholder={composerPlaceholder}
          maxLength={maxCriteriaChars}
          onChange={setCriteriaText}
          onSubmit={handleComposerSubmit}
        />
      </div>
    </div>
  );
}
