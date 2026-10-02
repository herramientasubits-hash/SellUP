'use client';

import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChatQuestionPanel, ChatThinking, type ChatQuestionOptionDetail } from '@/components/chat';
import { FieldError } from '@/components/forms/field';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { isSubindustrySelectionEnabled } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { SEARCH_MODE_DEFINITIONS } from '@/modules/prospect-batches/chat-wizard';
import type {
  ProspectWizardState,
  ProspectWizardAction,
  ProspectWizardStep,
} from '@/modules/prospect-batches/chat-wizard';
import type { SearchableSelectOption } from '@/components/forms/searchable-select';
import type { MultiSelectOption } from '@/components/forms/multi-select';

/**
 * Todo lo que el agente pregunta se contesta con la misma pieza: la pregunta
 * acoplada al pie del panel (`ChatQuestionPanel`), con opciones numeradas,
 * «Otro» cuando cabe una respuesta libre y «Omitir»/«Enviar». Los pasos que no
 * preguntan (bienvenida, validación) se pintan en el hilo.
 */
export const WIZARD_QUESTION_STEPS: ReadonlySet<ProspectWizardStep> = new Set<ProspectWizardStep>([
  'search_type',
  'country',
  'industry',
  'subindustries',
  'additional_criteria',
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export type WizardActiveStepProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  industryOptions: SearchableSelectOption[];
  subindustryOptions: MultiSelectOption[];
  onCountryChange: (code: string) => void;
  stepTitleRef: React.RefObject<HTMLHeadingElement | null>;
  /** El criterio adicional escrito en «Otro»; pasa por la misma guarda que antes. */
  onSubmitCriteria: (text: string) => void;
};

// ── Router ────────────────────────────────────────────────────────────────────

export function WizardActiveStep({
  state,
  dispatch,
  industryOptions,
  subindustryOptions,
  onCountryChange,
  stepTitleRef,
  onSubmitCriteria,
}: WizardActiveStepProps) {
  switch (state.currentStep) {
    case 'welcome':
      // Arranca solo al montar: la conversación empieza directamente en search_type.
      return null;

    case 'search_type':
      return <SearchTypeStep state={state} dispatch={dispatch} titleRef={stepTitleRef} />;

    case 'country':
      return <CountryStep state={state} onCountryChange={onCountryChange} titleRef={stepTitleRef} />;

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
      // paso no se renderiza NI VACÍO NI DESHABILITADO: devuelve `null`.
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
          onSubmitCriteria={onSubmitCriteria}
        />
      );

    case 'validating':
      return <ValidatingStep />;

    default:
      return null;
  }
}

type TitleRef = React.RefObject<HTMLHeadingElement | null>;

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

function hasIssues(state: ProspectWizardState, step: string): boolean {
  return state.blockingIssues.some((i) => i.step === step);
}

// ── Search type step ──────────────────────────────────────────────────────────

/** Las formas de búsqueda, como opciones numeradas de la pregunta del agente. */
const SEARCH_TYPE_OPTIONS: readonly ChatQuestionOptionDetail[] = SEARCH_MODE_DEFINITIONS.map((def) => ({
  value: def.mode,
  label: def.label,
  description: def.description,
  ...(def.availability === 'coming_soon' ? { hint: 'Próximamente', unavailable: true } : {}),
}));

function SearchTypeStep({
  state,
  dispatch,
  titleRef,
}: {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: TitleRef;
}) {
  const comingSoonWarning = state.warnings.find((w) => w.code === 'MODE_COMING_SOON');

  // Una opción «Próximamente» se puede tocar: el reductor responde con el aviso
  // de abajo en vez de avanzar, que es como explica por qué no sirve.
  return (
    <ChatQuestionPanel
      aria-label="Tipo de búsqueda de prospectos"
      title="¿Qué tipo de prospectos quieres encontrar?"
      titleRef={titleRef}
      options={SEARCH_TYPE_OPTIONS}
      selected={state.searchMode ? [state.searchMode] : []}
      onAnswer={(mode) => {
        const definition = SEARCH_MODE_DEFINITIONS.find((def) => def.mode === mode);
        if (definition) dispatch({ type: 'SELECT_SEARCH_MODE', mode: definition.mode });
      }}
      footerNotice={
        comingSoonWarning ? (
          <Alert variant="warning" role="status">
            <AlertDescription className="text-xs">
              Esta forma de búsqueda estará disponible próximamente. Por ahora puedes buscar empresas por criterios.
            </AlertDescription>
          </Alert>
        ) : undefined
      }
    />
  );
}

// ── Country step ──────────────────────────────────────────────────────────────

const COUNTRY_OPTIONS: readonly ChatQuestionOptionDetail[] = LATAM_COUNTRIES.map((c) => ({
  value: c.code,
  label: `${getFlagEmoji(c.code)} ${c.name}`,
}));

function CountryStep({
  state,
  onCountryChange,
  titleRef,
}: {
  state: ProspectWizardState;
  onCountryChange: (code: string) => void;
  titleRef: TitleRef;
}) {
  return (
    <ChatQuestionPanel
      aria-label="País de la búsqueda"
      title="¿En qué país quieres buscar prospectos?"
      titleRef={titleRef}
      options={COUNTRY_OPTIONS}
      selected={state.countryCode ? [state.countryCode] : []}
      onAnswer={onCountryChange}
      filterPlaceholder="Buscar país"
      footerNotice={hasIssues(state, 'country') ? <StepBlockingIssues state={state} step="country" /> : undefined}
    />
  );
}

// ── Industry step ─────────────────────────────────────────────────────────────

function IndustryStep({
  state,
  dispatch,
  industryOptions,
  titleRef,
}: {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  industryOptions: SearchableSelectOption[];
  titleRef: TitleRef;
}) {
  // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 §§ 5, 7 y 18 — bajo la taxonomía macro la
  // pregunta es la misma (selección única y obligatoria) y sólo cambia cómo se
  // NOMBRA lo que se está eligiendo.
  const macro = !isSubindustrySelectionEnabled(state.catalogVersion);
  const options = React.useMemo<ChatQuestionOptionDetail[]>(
    () =>
      industryOptions
        .filter((option) => !option.disabled)
        .map((option) => ({ value: option.value, label: option.label, description: option.description })),
    [industryOptions],
  );
  return (
    <ChatQuestionPanel
      aria-label={macro ? 'Macro industria de la búsqueda' : 'Industria de la búsqueda'}
      title={
        macro
          ? '¿En qué macro industria deberían operar las empresas?'
          : '¿En qué industria deberían operar las empresas?'
      }
      titleRef={titleRef}
      options={options}
      selected={state.industryId ? [state.industryId] : []}
      onAnswer={(id) => dispatch({ type: 'SELECT_INDUSTRY', industryId: id })}
      filterPlaceholder={macro ? 'Buscar macro industria' : 'Buscar industria'}
      footerNotice={hasIssues(state, 'industry') ? <StepBlockingIssues state={state} step="industry" /> : undefined}
    />
  );
}

// ── Subindustries step ────────────────────────────────────────────────────────

function SubindustriesStep({
  state,
  dispatch,
  subindustryOptions,
  titleRef,
}: {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  subindustryOptions: MultiSelectOption[];
  titleRef: TitleRef;
}) {
  const max = EXPLORATORY_SEARCH_LIMITS.subindustries.max;
  const options = React.useMemo<ChatQuestionOptionDetail[]>(
    () =>
      subindustryOptions
        .filter((option) => !option.disabled)
        .map((option) => ({ value: option.value, label: option.label, description: option.description })),
    [subindustryOptions],
  );

  // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A — la selección NO vive aquí:
  // cada cambio se compromete en el reductor y este paso es sólo una vista, para
  // que lo marcado no se pierda si el hilo vuelve a «escribir» y lo desmonta.
  return (
    <ChatQuestionPanel
      aria-label="Subindustrias de la búsqueda"
      title="¿Quieres enfocar más la búsqueda?"
      description={
        options.length === 0
          ? 'No hay subindustrias disponibles para esta industria.'
          : `Marca hasta ${max} subindustrias o continúa con toda la industria.`
      }
      titleRef={titleRef}
      mode="multiple"
      max={max}
      options={options}
      selected={state.subindustryIds}
      onSelectionChange={(subindustryIds) => dispatch({ type: 'SET_SUBINDUSTRY_SELECTION', subindustryIds })}
      onSubmitSelection={(subindustryIds) => dispatch({ type: 'SET_SUBINDUSTRIES', subindustryIds })}
      onSkip={() => dispatch({ type: 'SKIP_SUBINDUSTRIES' })}
      skipLabel="Omitir este paso"
      filterPlaceholder="Buscar subindustria"
      footerNotice={
        hasIssues(state, 'subindustries') ? <StepBlockingIssues state={state} step="subindustries" /> : undefined
      }
    />
  );
}

// ── Additional criteria step ──────────────────────────────────────────────────

const CRITERIA_NO = 'No, continuar';

function AdditionalCriteriaStep({
  state,
  dispatch,
  titleRef,
  onSubmitCriteria,
}: {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: TitleRef;
  onSubmitCriteria: (text: string) => void;
}) {
  // Un solo gesto: «No, continuar» o escribir la característica en «Otro». Ya no
  // hay que decir primero «sí» para que se encienda la caja de escribir.
  return (
    <ChatQuestionPanel
      aria-label="Criterio adicional de la búsqueda"
      title="¿Hay alguna característica adicional que debamos tener en cuenta?"
      description="Por ejemplo: tamaño de empresa, tecnología usada, etapa de crecimiento…"
      titleRef={titleRef}
      options={[CRITERIA_NO]}
      onAnswer={() => dispatch({ type: 'SKIP_ADDITIONAL_CRITERIA' })}
      otherPlaceholder="Escribe la característica"
      otherMaxLength={EXPLORATORY_SEARCH_LIMITS.additionalCriteria.maxChars}
      onOther={onSubmitCriteria}
      footerNotice={
        hasIssues(state, 'additional_criteria') ? (
          <StepBlockingIssues state={state} step="additional_criteria" />
        ) : undefined
      }
    />
  );
}

// ── Validating step ───────────────────────────────────────────────────────────

function ValidatingStep() {
  return <ChatThinking label="Estamos revisando la configuración…" />;
}
