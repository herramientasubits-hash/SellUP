'use client';

import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ChatQuestionCard, ChatThinking, type ChatQuestionOptionDetail } from '@/components/chat';
import { FieldError } from '@/components/forms/field';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { MultiSelect } from '@/components/forms/multi-select';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { isSubindustrySelectionEnabled } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
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
      // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 7 — con la selección desactivada el
      // paso no se renderiza NI VACÍO NI DESHABILITADO: devuelve `null`, que es
      // lo que produce la ausencia sin hueco. El reducer ya no puede traer aquí
      // el paso activo; esto cubre el caso de un estado restaurado.
      if (!isSubindustrySelectionEnabled(state.catalogVersion)) return null;
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
        className="text-base font-semibold tracking-tight text-foreground focus:outline-none"
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
        <FieldError key={issue.code}>{issue.message}</FieldError>
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

/** Las formas de búsqueda, como opciones numeradas de la pregunta del agente. */
const SEARCH_TYPE_OPTIONS: readonly ChatQuestionOptionDetail[] = SEARCH_MODE_DEFINITIONS.map((def) => ({
  value: def.mode,
  label: def.label,
  description: def.description,
  ...(def.availability === 'coming_soon' ? { hint: 'Próximamente', unavailable: true } : {}),
}));

function SearchTypeStep({ state, dispatch, titleRef }: SearchTypeStepProps) {
  const comingSoonWarning = state.warnings.find((w) => w.code === 'MODE_COMING_SOON');

  return (
    <StepWrapper title="¿Qué tipo de prospectos quieres encontrar?" titleRef={titleRef}>
      {/* Una opción «Próximamente» se puede tocar: el reductor responde con el
          aviso de abajo en vez de avanzar, que es como explica por qué no sirve. */}
      <ChatQuestionCard
        aria-label="Tipo de búsqueda de prospectos"
        question={{ options: SEARCH_TYPE_OPTIONS }}
        selected={state.searchMode ?? undefined}
        active
        onAnswer={(mode) => {
          const definition = SEARCH_MODE_DEFINITIONS.find((def) => def.mode === mode);
          if (definition) dispatch({ type: 'SELECT_SEARCH_MODE', mode: definition.mode });
        }}
      />

      {comingSoonWarning && (
        <Alert variant="warning" role="status">
          <AlertDescription className="text-xs">
            Esta forma de búsqueda estará disponible próximamente. Por ahora puedes buscar empresas por criterios.
          </AlertDescription>
        </Alert>
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
  // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 §§ 5, 7 y 18 — bajo la taxonomía macro el
  // control es el mismo (selección única y obligatoria) y sólo cambia cómo se
  // NOMBRA lo que se está eligiendo. `SearchableSelect` ya es single-select: el
  // contrato de «exactamente una» no se añade aquí, se hereda.
  const macro = !isSubindustrySelectionEnabled(state.catalogVersion);
  return (
    <StepWrapper
      title={
        macro
          ? '¿En qué macro industria deberían operar las empresas?'
          : '¿En qué industria deberían operar las empresas?'
      }
      titleRef={titleRef}
    >
      <SearchableSelect
        options={industryOptions}
        value={state.industryId ?? ''}
        onValueChange={(id) =>
          dispatch({ type: 'SELECT_INDUSTRY', industryId: id })
        }
        placeholder={macro ? 'Seleccionar macro industria' : 'Seleccionar industria'}
        searchPlaceholder={macro ? 'Buscar macro industria...' : 'Buscar industria...'}
        emptyMessage={
          macro ? 'No se encontraron macro industrias.' : 'No se encontraron industrias.'
        }
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

  // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A — la selección NO vive aquí.
  //
  // Antes este paso guardaba un `useState` local que sólo se volcaba al estado al
  // pulsar «Continuar». El árbol del paso activo se desmonta cada vez que el hilo
  // de mensajes vuelve a "escribir", y al remontar ese borrador se reinicializaba
  // desde `state.subindustryIds`: lo elegido y aún no confirmado desaparecía sin
  // aviso, y el lote se creaba con menos subindustrias de las pedidas. Ahora cada
  // cambio se compromete en el reductor y este componente es sólo una vista.
  const selected = state.subindustryIds;
  const selectedLabels = selected.map(
    (id) => subindustryOptions.find((option) => option.value === id)?.label ?? id,
  );

  return (
    <StepWrapper title="¿Quieres enfocar más la búsqueda?" titleRef={titleRef}>
      <p className="text-xs text-muted-foreground">
        Puedes seleccionar hasta {max} subindustrias o continuar con toda la
        industria.
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Subindustrias</span>
          <span className="shrink-0 tabular-nums" aria-live="polite" aria-atomic="true">
            {selected.length}/{max} seleccionadas
          </span>
        </div>
        <MultiSelect
          options={subindustryOptions}
          value={selected}
          onValueChange={(subindustryIds) =>
            dispatch({ type: 'SET_SUBINDUSTRY_SELECTION', subindustryIds })
          }
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

      {/* § A.4 — la lista explícita, no sólo el resumen del control: una pérdida
          entre dos clics tiene que ser visible ANTES de gastar créditos. */}
      {selectedLabels.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-surface-subtle px-3 py-2.5 text-xs text-muted-foreground">
          {selectedLabels.map((label, index) => (
            <li key={selected[index]} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span className="min-w-0 break-words text-foreground">{label}</span>
            </li>
          ))}
        </ul>
      )}

      <StepBlockingIssues state={state} step="subindustries" />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={selected.length === 0}
          onClick={() =>
            dispatch({ type: 'SET_SUBINDUSTRIES', subindustryIds: selected })
          }
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

const CRITERIA_YES = 'Sí, quiero agregar';
const CRITERIA_NO = 'No, continuar';
const CRITERIA_INTENTION_OPTIONS: readonly string[] = [CRITERIA_YES, CRITERIA_NO];

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

      <ChatQuestionCard
        aria-label="¿Quieres agregar un criterio adicional?"
        question={{ options: CRITERIA_INTENTION_OPTIONS }}
        active
        onAnswer={(answer) => {
          if (answer === CRITERIA_YES) onIntentionYes();
          else dispatch({ type: 'SKIP_ADDITIONAL_CRITERIA' });
        }}
      />
    </StepWrapper>
  );
}

// ── Validating step ───────────────────────────────────────────────────────────

function ValidatingStep() {
  return <ChatThinking label="Estamos revisando la configuración…" />;
}
