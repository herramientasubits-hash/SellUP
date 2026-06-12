'use client';

import * as React from 'react';
import {
  ChevronRight,
  Building2,
  Users,
  Sparkles,
  Loader2,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { MultiSelect } from '@/components/forms/multi-select';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { detectPromptInjection, normalizeCriteria } from '@/modules/industry-catalog/schema';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import {
  SEARCH_MODE_DEFINITIONS,
  canAdvanceFromCurrentStep,
} from '@/modules/prospect-batches/chat-wizard';
import type {
  ProspectWizardState,
  ProspectWizardAction,
  CriteriaGuardResult,
  WizardWarning,
} from '@/modules/prospect-batches/chat-wizard';
import type { SearchableSelectOption } from '@/components/forms/searchable-select';
import type { MultiSelectOption } from '@/components/forms/multi-select';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WizardActiveStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  industryOptions: SearchableSelectOption[];
  subindustryOptions: MultiSelectOption[];
  onCountryChange: (code: string) => void;
  stepTitleRef: React.RefObject<HTMLHeadingElement | null>;
};

// ── Router ────────────────────────────────────────────────────────────────────

export function WizardActiveStep({
  state,
  dispatch,
  industryOptions,
  subindustryOptions,
  onCountryChange,
  stepTitleRef,
}: WizardActiveStepProps) {
  switch (state.currentStep) {
    case 'welcome':
      return <WelcomeStep dispatch={dispatch} titleRef={stepTitleRef} />;

    case 'search_type':
      return (
        <SearchTypeStep
          state={state}
          dispatch={dispatch}
          titleRef={stepTitleRef}
        />
      );

    case 'country':
      return (
        <CountryStep
          state={state}
          onCountryChange={onCountryChange}
          titleRef={stepTitleRef}
        />
      );

    case 'industry':
      return (
        <IndustryStep
          state={state}
          dispatch={dispatch}
          industryOptions={industryOptions}
          titleRef={stepTitleRef}
        />
      );

    case 'subindustries':
      return (
        <SubindustriesStep
          state={state}
          dispatch={dispatch}
          subindustryOptions={subindustryOptions}
          titleRef={stepTitleRef}
        />
      );

    case 'additional_criteria':
      return (
        <AdditionalCriteriaStep
          state={state}
          dispatch={dispatch}
          titleRef={stepTitleRef}
        />
      );

    case 'requested_count':
      return (
        <RequestedCountStep
          state={state}
          dispatch={dispatch}
          titleRef={stepTitleRef}
        />
      );

    case 'validating':
      return <ValidatingStep />;

    default:
      return null;
  }
}

// ── Shared step wrapper ───────────────────────────────────────────────────────

type StepWrapperProps = {
  title: string;
  children: React.ReactNode;
  titleRef?: React.RefObject<HTMLHeadingElement | null>;
};

function StepWrapper({ title, children, titleRef }: StepWrapperProps) {
  return (
    <div className="space-y-4">
      <h3
        ref={titleRef}
        tabIndex={-1}
        className="text-sm font-semibold text-foreground focus:outline-none"
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

// ── Blocking issues for a step ────────────────────────────────────────────────

function StepBlockingIssues({ state, step }: { state: ProspectWizardState; step: string }) {
  const issues = state.blockingIssues.filter((i) => i.step === step);
  if (issues.length === 0) return null;
  return (
    <div className="space-y-2" role="alert">
      {issues.map((issue) => (
        <p key={issue.code} className="text-xs text-destructive">
          {issue.message}
        </p>
      ))}
    </div>
  );
}

// ── Welcome step ──────────────────────────────────────────────────────────────

type WelcomeStepProps = {
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
};

function WelcomeStep({ dispatch, titleRef }: WelcomeStepProps) {
  // Welcome step is auto-started, so we don't render anything here
  // The conversation begins immediately in search_type
  return null;
}

// ── Search type step ──────────────────────────────────────────────────────────

type SearchTypeStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
};

function SearchTypeStep({ state, dispatch, titleRef }: SearchTypeStepProps) {
  const comingSoonWarning = state.warnings.find((w) => w.code === 'MODE_COMING_SOON');

  return (
    <StepWrapper title="¿Qué tipo de prospectos quieres encontrar?" titleRef={titleRef}>
      <div
        className="space-y-3"
        role="group"
        aria-label="Tipo de búsqueda de prospectos"
      >
        {SEARCH_MODE_DEFINITIONS.map((def) => {
          const isComingSoon = def.availability === 'coming_soon';
          const isSelected = state.searchMode === def.mode;

          const Icon =
            def.mode === 'exploratory'
              ? Building2
              : def.mode === 'competitors'
              ? Users
              : Sparkles;

          return (
            <button
              key={def.mode}
              type="button"
              onClick={() =>
                dispatch({ type: 'SELECT_SEARCH_MODE', mode: def.mode })
              }
              aria-disabled={isComingSoon}
              aria-pressed={isSelected}
              className={[
                'flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all',
                isSelected && !isComingSoon
                  ? 'border-su-brand bg-su-brand-soft/40 shadow-sm'
                  : 'border-border bg-card hover:border-su-brand/40 hover:bg-muted/40',
                isComingSoon
                  ? 'cursor-default opacity-60'
                  : 'cursor-pointer',
              ].join(' ')}
            >
              <div
                className={[
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  isSelected && !isComingSoon
                    ? 'bg-su-brand-soft'
                    : 'bg-muted',
                ].join(' ')}
              >
                <Icon
                  className={[
                    'h-4 w-4',
                    isSelected && !isComingSoon
                      ? 'text-su-brand'
                      : 'text-muted-foreground',
                  ].join(' ')}
                  aria-hidden
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {def.label}
                  </span>
                  {isComingSoon && (
                    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" aria-hidden />
                      Próximamente
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                  {def.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {comingSoonWarning && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-400"
        >
          Esta forma de búsqueda estará disponible próximamente. Por ahora puedes buscar empresas por criterios.
        </div>
      )}
    </StepWrapper>
  );
}

// ── Country step ──────────────────────────────────────────────────────────────

const COUNTRY_OPTIONS: SearchableSelectOption[] = LATAM_COUNTRIES.map((c) => ({
  value: c.code,
  label: `${getFlagEmoji(c.code)} ${c.name}`,
}));

type CountryStepProps = {
  state: ProspectWizardState;
  onCountryChange: (code: string) => void;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
};

function CountryStep({ state, onCountryChange, titleRef }: CountryStepProps) {
  return (
    <StepWrapper title="¿En qué país quieres buscar prospectos?" titleRef={titleRef}>
      <SearchableSelect
        options={COUNTRY_OPTIONS}
        value={state.countryCode ?? ''}
        onValueChange={onCountryChange}
        placeholder="Seleccionar país"
        searchPlaceholder="Buscar país..."
        emptyMessage="No se encontraron países."
      />
      <StepBlockingIssues state={state} step="country" />
    </StepWrapper>
  );
}

// ── Industry step ─────────────────────────────────────────────────────────────

type IndustryStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  industryOptions: SearchableSelectOption[];
  titleRef: React.RefObject<HTMLHeadingElement | null>;
};

function IndustryStep({
  state,
  dispatch,
  industryOptions,
  titleRef,
}: IndustryStepProps) {
  return (
    <StepWrapper
      title="¿En qué industria deberían operar las empresas?"
      titleRef={titleRef}
    >
      <SearchableSelect
        options={industryOptions}
        value={state.industryId ?? ''}
        onValueChange={(id) =>
          dispatch({ type: 'SELECT_INDUSTRY', industryId: id })
        }
        placeholder="Seleccionar industria"
        searchPlaceholder="Buscar industria..."
        emptyMessage="No se encontraron industrias."
      />
      <StepBlockingIssues state={state} step="industry" />
    </StepWrapper>
  );
}

// ── Subindustries step ────────────────────────────────────────────────────────

type SubindustriesStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  subindustryOptions: MultiSelectOption[];
  titleRef: React.RefObject<HTMLHeadingElement | null>;
};

function SubindustriesStep({
  state,
  dispatch,
  subindustryOptions,
  titleRef,
}: SubindustriesStepProps) {
  const max = EXPLORATORY_SEARCH_LIMITS.subindustries.max;
  const selected = state.subindustryIds;

  function handleContinue() {
    dispatch({ type: 'SET_SUBINDUSTRIES', subindustryIds: selected });
  }

  function handleSkip() {
    dispatch({ type: 'SKIP_SUBINDUSTRIES' });
  }

  function handleMaxReached() {
    // Blocking issue is shown via StepBlockingIssues — no need for toast here
  }

  return (
    <StepWrapper title="¿Quieres enfocar más la búsqueda?" titleRef={titleRef}>
      <p className="text-xs text-muted-foreground">
        Puedes seleccionar hasta {max} subindustrias o continuar con toda la
        industria.
      </p>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Subindustrias</span>
          <span aria-live="polite" aria-atomic="true">
            {selected.length}/{max} seleccionadas
          </span>
        </div>
        <MultiSelect
          options={subindustryOptions}
          value={selected}
          onValueChange={(ids) =>
            dispatch({ type: 'SET_SUBINDUSTRIES', subindustryIds: ids })
          }
          placeholder={
            subindustryOptions.length === 0
              ? 'No hay subindustrias disponibles'
              : 'Seleccionar subindustrias'
          }
          searchPlaceholder="Buscar subindustria..."
          emptyMessage="No se encontraron subindustrias."
          maxSelections={max}
          onMaxSelectionsReached={handleMaxReached}
          disabled={subindustryOptions.length === 0}
        />
      </div>

      <StepBlockingIssues state={state} step="subindustries" />

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          onClick={handleContinue}
          disabled={selected.length === 0}
        >
          Continuar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={handleSkip}
        >
          Omitir este paso
        </Button>
      </div>
    </StepWrapper>
  );
}

// ── Additional criteria step ──────────────────────────────────────────────────

type AdditionalCriteriaStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
};

function AdditionalCriteriaStep({
  state,
  dispatch,
  titleRef,
}: AdditionalCriteriaStepProps) {
  const maxChars = EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars;
  const [text, setText] = React.useState(state.additionalCriteriaRaw ?? '');

  const charCount = text.length;
  const overLimit = charCount > maxChars;

  function handleContinue() {
    const trimmed = text.trim();
    if (trimmed === '') {
      dispatch({ type: 'SKIP_ADDITIONAL_CRITERIA' });
      return;
    }
    // Basic criteria guard (full ethics module: 16AB.35.3)
    const normalized = normalizeCriteria(trimmed);
    const hasInjection = normalized ? detectPromptInjection(normalized) : false;
    const warnings: WizardWarning[] = hasInjection
      ? [
          {
            code: 'CRITERIA_OUTSIDE_CATALOG',
            step: 'additional_criteria',
            message:
              'El criterio contiene instrucciones que no se procesarán.',
          },
        ]
      : [];
    const result: CriteriaGuardResult = {
      status: hasInjection ? 'warning' : 'allowed',
      normalizedValue: normalized,
      warnings,
      blockingIssues: [],
    };
    dispatch({
      type: 'APPLY_CRITERIA_GUARD_RESULT',
      rawValue: trimmed,
      result,
    });
  }

  function handleSkip() {
    dispatch({ type: 'SKIP_ADDITIONAL_CRITERIA' });
  }

  return (
    <StepWrapper
      title="¿Hay alguna característica adicional que debamos tener en cuenta?"
      titleRef={titleRef}
    >
      <div className="space-y-1">
        <Textarea
          id="wizard-additional-criteria"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Empresas con operación regional. Equipos distribuidos. Señales recientes de crecimiento. Presencia en varios países."
          rows={4}
          maxLength={maxChars + 1}
          className="resize-none text-sm"
          aria-label="Criterio adicional — opcional"
          aria-describedby="wizard-criteria-counter"
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Opcional</span>
          <span
            id="wizard-criteria-counter"
            aria-live="polite"
            aria-atomic="true"
            className={
              overLimit
                ? 'font-semibold text-destructive'
                : 'text-muted-foreground'
            }
          >
            {charCount}/{maxChars}
          </span>
        </div>
        {overLimit && (
          <p role="alert" className="text-xs text-destructive">
            El criterio puede tener máximo {maxChars} caracteres.
          </p>
        )}
      </div>

      <StepBlockingIssues state={state} step="additional_criteria" />

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          onClick={handleContinue}
          disabled={overLimit}
        >
          Continuar
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={handleSkip}
          >
            No agregar criterio
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 text-muted-foreground"
            onClick={handleSkip}
          >
            No estoy seguro
          </Button>
        </div>
      </div>
    </StepWrapper>
  );
}

// ── Requested count step ──────────────────────────────────────────────────────

type RequestedCountStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
};

function RequestedCountStep({
  state,
  dispatch,
  titleRef,
}: RequestedCountStepProps) {
  const { options, default: defaultCount } =
    EXPLORATORY_SEARCH_LIMITS.requestedCount;
  const selected = state.requestedCount ?? defaultCount;

  return (
    <StepWrapper
      title="¿Cuántas empresas quieres encontrar?"
      titleRef={titleRef}
    >
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Cantidad de empresas"
      >
        {options.map((n) => {
          const isSelected = selected === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() =>
                dispatch({ type: 'SET_REQUESTED_COUNT', value: n })
              }
              aria-pressed={isSelected}
              className={[
                'rounded-full border px-4 py-1.5 text-sm font-medium transition-all',
                isSelected
                  ? 'border-su-brand bg-su-brand text-white shadow-sm'
                  : 'border-border bg-card text-foreground hover:border-su-brand/50 hover:bg-muted/40',
              ].join(' ')}
            >
              {n}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          SellUp intentará encontrar hasta <strong>{selected}</strong> empresas.
          La cantidad final puede variar según calidad y duplicados.
        </p>
      </div>

      <StepBlockingIssues state={state} step="requested_count" />

      <Button
        type="button"
        onClick={() => dispatch({ type: 'SET_REQUESTED_COUNT', value: selected })}
        disabled={!canAdvanceFromCurrentStep(state)}
      >
        Continuar
      </Button>
    </StepWrapper>
  );
}

// ── Validating step ───────────────────────────────────────────────────────────

function ValidatingStep() {
  return (
    <div
      className="flex items-center gap-3 rounded-xl bg-muted/40 px-5 py-4"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-su-brand" aria-hidden />
      <p className="text-sm text-foreground">
        Estamos revisando la configuración…
      </p>
    </div>
  );
}
