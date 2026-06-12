'use client';

import * as React from 'react';
import {
  Building2,
  Users,
  Sparkles,
  Loader2,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { MultiSelect } from '@/components/forms/multi-select';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { SEARCH_MODE_DEFINITIONS } from '@/modules/prospect-batches/chat-wizard';
import type {
  ProspectWizardState,
  ProspectWizardAction,
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
  criteriaIntention: 'pending' | 'yes';
  onCriteriaIntentionYes: () => void;
};

// ── Router ────────────────────────────────────────────────────────────────────

export function WizardActiveStep({
  state,
  dispatch,
  industryOptions,
  subindustryOptions,
  onCountryChange,
  stepTitleRef,
  criteriaIntention,
  onCriteriaIntentionYes,
}: WizardActiveStepProps) {
  switch (state.currentStep) {
    case 'welcome':
      return <WelcomeStep />;

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
          intention={criteriaIntention}
          onIntentionYes={onCriteriaIntentionYes}
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

function WelcomeStep() {
  // Auto-started on mount; the conversation begins immediately in search_type
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
        compact
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

  // Draft selection — doesn't auto-advance on each individual click
  const [draft, setDraft] = React.useState<string[]>(state.subindustryIds);

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
            {draft.length}/{max} seleccionadas
          </span>
        </div>
        <MultiSelect
          options={subindustryOptions}
          value={draft}
          onValueChange={setDraft}
          placeholder={
            subindustryOptions.length === 0
              ? 'No hay subindustrias disponibles'
              : 'Seleccionar subindustrias'
          }
          searchPlaceholder="Buscar subindustria..."
          emptyMessage="No se encontraron subindustrias."
          maxSelections={max}
          disabled={subindustryOptions.length === 0}
          compact
        />
      </div>

      <StepBlockingIssues state={state} step="subindustries" />

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={draft.length === 0}
          onClick={() => dispatch({ type: 'SET_SUBINDUSTRIES', subindustryIds: draft })}
        >
          Continuar
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => dispatch({ type: 'SKIP_SUBINDUSTRIES' })}
        >
          Omitir este paso
        </Button>
      </div>
    </StepWrapper>
  );
}

// ── Additional criteria step ──────────────────────────────────────────────────
// Gate: user first picks YES/NO. YES enables the composer (text_input mode);
// NO skips directly to summary.

type AdditionalCriteriaStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  intention: 'pending' | 'yes';
  onIntentionYes: () => void;
};

function AdditionalCriteriaStep({
  state,
  dispatch,
  titleRef,
  intention,
  onIntentionYes,
}: AdditionalCriteriaStepProps) {
  if (intention === 'yes') {
    return (
      <StepWrapper
        title="¿Hay alguna característica adicional que debamos tener en cuenta?"
        titleRef={titleRef}
      >
        <p className="text-xs text-muted-foreground">
          Escríbela en el campo de abajo y presiona enviar.
        </p>
        <StepBlockingIssues state={state} step="additional_criteria" />
      </StepWrapper>
    );
  }

  return (
    <StepWrapper
      title="¿Hay alguna característica adicional que debamos tener en cuenta?"
      titleRef={titleRef}
    >
      <p className="text-xs text-muted-foreground">
        Por ejemplo: tamaño de empresa, tecnología usada, etapa de crecimiento…
      </p>

      <StepBlockingIssues state={state} step="additional_criteria" />

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          onClick={onIntentionYes}
        >
          Sí, quiero agregar
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => dispatch({ type: 'SKIP_ADDITIONAL_CRITERIA' })}
        >
          No, continuar
        </Button>
      </div>
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
