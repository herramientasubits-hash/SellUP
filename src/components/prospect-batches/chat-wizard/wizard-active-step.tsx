'use client';

import * as React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChatQuestionBackContext, ChatQuestionPanel, ChatThinking, type ChatQuestionOptionDetail } from '@/components/chat';
import { FieldError } from '@/components/forms/field';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { COMPETITOR_REFERENCE_LIMITS } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { isSubindustrySelectionEnabled } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import {
  MAX_COMPETITOR_COUNTRIES,
  getPreviousWizardStep,
  REFERENCE_COMPANY_LIMITS,
  resolveSearchModeDefinitions,
} from '@/modules/prospect-batches/chat-wizard';
import { getActiveAccountsForPicker } from '@/modules/accounts/actions';
import { resolveCompetitorReferenceAction } from '@/modules/prospect-batches/competitor-search/actions';
import { useCorporateTreeEnabled } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import { SupplierReferenceSuggestions, useSupplierReferenceSuggestions } from './supplier-reference-suggestions';
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
  'reference_company',
  'reference_confirm',
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

/**
 * El paso activo, con «Volver» en su pregunta: regresa a la anterior sin borrar lo
 * ya elegido (el reductor sólo cambia el paso). En la primera pregunta no hay.
 */
export function WizardActiveStep(props: WizardActiveStepProps) {
  const { state, dispatch } = props;
  const previous = getPreviousWizardStep(state.currentStep, state.catalogVersion, state.searchMode);
  const onBack = React.useMemo(
    () => (previous && previous !== 'welcome' ? () => dispatch({ type: 'GO_BACK' }) : null),
    [previous, dispatch],
  );
  return (
    <ChatQuestionBackContext.Provider value={onBack}>
      <WizardActiveStepBody {...props} />
    </ChatQuestionBackContext.Provider>
  );
}

function WizardActiveStepBody({
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

    case 'reference_company':
      // Proveedores: se escribe el nombre. Competidores: se elige o se escribe y
      // SellUp arma la ficha.
      return state.searchMode === 'competitors' ? (
        <CompetitorReferenceStep dispatch={dispatch} titleRef={stepTitleRef} />
      ) : (
        <ReferenceCompanyStep state={state} dispatch={dispatch} titleRef={stepTitleRef} />
      );

    case 'reference_confirm':
      return (
        <ReferenceConfirmStep
          state={state}
          dispatch={dispatch}
          industryOptions={industryOptions}
          titleRef={stepTitleRef}
        />
      );

    case 'country':
      return (
        <CountryStep state={state} dispatch={dispatch} onCountryChange={onCountryChange} titleRef={stepTitleRef} />
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

/**
 * Las formas de búsqueda, como opciones numeradas de la pregunta del agente.
 * AGENT1-CORPORATE-TREE-1 — el árbol se ofrece sólo si la ruta dice que está
 * encendido; si no, se ve «Próximamente» como las demás que aún no están.
 */
function buildSearchTypeOptions(state: ProspectWizardState, corporateTreeEnabled: boolean): ChatQuestionOptionDetail[] {
  return resolveSearchModeDefinitions(state).map((def) => {
    const comingSoon = def.availability === 'coming_soon' || (def.mode === 'corporate_tree' && !corporateTreeEnabled);
    return {
      value: def.mode,
      label: def.label,
      description: def.description,
      ...(comingSoon ? { hint: 'Próximamente', unavailable: true } : {}),
    };
  });
}

function SearchTypeStep({
  state,
  dispatch,
  titleRef,
}: {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: TitleRef;
}) {
  const corporateTreeEnabled = useCorporateTreeEnabled();
  const [treeUnavailable, setTreeUnavailable] = React.useState(false);
  const comingSoonWarning = state.warnings.find((w) => w.code === 'MODE_COMING_SOON') ?? (treeUnavailable ? true : undefined);
  const definitions = resolveSearchModeDefinitions(state);

  // Una opción «Próximamente» se puede tocar: el reductor responde con el aviso
  // de abajo en vez de avanzar, que es como explica por qué no sirve.
  return (
    <ChatQuestionPanel
      aria-label="Tipo de búsqueda de prospectos"
      title="¿Qué tipo de prospectos quieres encontrar?"
      titleRef={titleRef}
      options={buildSearchTypeOptions(state, corporateTreeEnabled)}
      selected={state.searchMode ? [state.searchMode] : []}
      onAnswer={(mode) => {
        const definition = definitions.find((def) => def.mode === mode);
        if (!definition) return;
        if (definition.mode === 'corporate_tree' && !corporateTreeEnabled) {
          setTreeUnavailable(true);
          return;
        }
        setTreeUnavailable(false);
        dispatch({ type: 'SELECT_SEARCH_MODE', mode: definition.mode });
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

// ── Competitor reference step («Competidores de una empresa») ────────────────

type ReferenceLookup =
  | { status: 'idle'; message: null }
  | { status: 'resolving'; message: null }
  | { status: 'failed'; message: string };

/**
 * La empresa de referencia: una de las cuentas de la vendedora (opciones con
 * filtro) o lo que escriba en «Otro». SellUp arma su ficha con Claude y la
 * muestra para confirmar.
 */
function CompetitorReferenceStep({
  dispatch,
  titleRef,
}: {
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: TitleRef;
}) {
  const [accounts, setAccounts] = React.useState<readonly ChatQuestionOptionDetail[]>([]);
  const [lookup, setLookup] = React.useState<ReferenceLookup>({ status: 'idle', message: null });

  React.useEffect(() => {
    let cancelled = false;
    // Sin cuentas (o si la lectura falla) queda sólo «Otro»: escribir siempre funciona.
    getActiveAccountsForPicker()
      .then((rows) => {
        if (cancelled) return;
        setAccounts(
          rows.map((row) => ({ value: row.id, label: row.name, ...(row.domain ? { description: row.domain } : {}) })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = React.useCallback(
    async (request: { accountId: string } | { query: string }) => {
      setLookup({ status: 'resolving', message: null });
      try {
        const result = await resolveCompetitorReferenceAction(request);
        if (result.ok) {
          setLookup({ status: 'idle', message: null });
          dispatch({ type: 'REFERENCE_RESOLVED', reference: result.reference });
          return;
        }
        setLookup({ status: 'failed', message: result.message });
      } catch {
        setLookup({ status: 'failed', message: 'No pudimos buscar la empresa. Intenta de nuevo.' });
      }
    },
    [dispatch],
  );

  if (lookup.status === 'resolving') {
    return <ChatThinking label="Buscando la empresa en la web…" />;
  }

  return (
    <ChatQuestionPanel
      aria-label="Empresa de referencia"
      title="¿De qué empresa quieres encontrar competidores?"
      description="Elige una de tus cuentas o escribe su nombre o su web."
      titleRef={titleRef}
      options={accounts}
      onAnswer={(accountId) => void resolve({ accountId })}
      otherPlaceholder="Nombre o web de la empresa"
      otherMaxLength={COMPETITOR_REFERENCE_LIMITS.nameMaxChars}
      onOther={(text) => void resolve({ query: text })}
      filterPlaceholder="Buscar en tus cuentas"
      footerNotice={
        lookup.status === 'failed' ? (
          <Alert variant="warning" role="status">
            <AlertDescription className="text-xs">{lookup.message}</AlertDescription>
          </Alert>
        ) : undefined
      }
    />
  );
}

// ── Reference company step (AGENT1-SUPPLIER-SEARCH-1) ─────────────────────────

/**
 * «Proveedores de una empresa»: una de las cuentas de la vendedora (opciones con
 * filtro) o lo que escriba. AGENT1-SUPPLIER-SEARCH-4 — paridad con «Competidores»:
 * los clientes ancla suelen estar ya en SellUp.
 */
function ReferenceCompanyStep({
  state,
  dispatch,
  titleRef,
}: {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  titleRef: TitleRef;
}) {
  const [accounts, setAccounts] = React.useState<readonly ChatQuestionOptionDetail[]>([]);
  // AGENT1-SUPPLIER-REFERENCE-SUGGEST-1 — lo escrito en «Otra empresa», para sugerir
  // entidades públicas que la búsqueda en compras públicas reconoce por nombre exacto.
  const [typed, setTyped] = React.useState('');
  const suggestions = useSupplierReferenceSuggestions(typed);

  React.useEffect(() => {
    let cancelled = false;
    // Sin cuentas (o si la lectura falla) queda sólo escribir, que siempre funciona.
    getActiveAccountsForPicker()
      .then((rows) => {
        if (cancelled) return;
        setAccounts(
          rows.map((row) => ({ value: row.id, label: row.name, ...(row.domain ? { description: row.domain } : {}) })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ChatQuestionPanel
      aria-label="Empresa de referencia"
      title="¿De qué empresa quieres encontrar proveedores?"
      description={
        accounts.length > 0
          ? 'Elige una de tus cuentas o escribe su nombre. Si es una entidad pública, te sugerimos las que tienen compras públicas cargadas.'
          : 'Escribe su nombre, por ejemplo: Ecopetrol o Seguro Social. Si es una entidad pública, te sugerimos las que tienen compras públicas cargadas.'
      }
      titleRef={titleRef}
      options={accounts}
      onAnswer={(accountId) => {
        const account = accounts.find((option) => option.value === accountId);
        if (account) dispatch({ type: 'SET_REFERENCE_COMPANY', value: account.label });
      }}
      filterPlaceholder="Buscar en tus cuentas"
      otherLabel={accounts.length > 0 ? 'Otra empresa' : 'Empresa'}
      otherPlaceholder="Nombre de la empresa o entidad pública"
      otherMaxLength={REFERENCE_COMPANY_LIMITS.maxChars}
      onOther={(value) => dispatch({ type: 'SET_REFERENCE_COMPANY', value })}
      onOtherChange={setTyped}
      otherSuggestions={
        <SupplierReferenceSuggestions
          state={suggestions}
          onPick={(item) =>
            dispatch({ type: 'SET_REFERENCE_COMPANY', value: item.name, suggestedCountryCode: item.countryCode })
          }
        />
      }
      footerNotice={
        hasIssues(state, 'reference_company') ? (
          <StepBlockingIssues state={state} step="reference_company" />
        ) : undefined
      }
    />
  );
}

const REFERENCE_CONFIRM = 'confirm';
const REFERENCE_REJECT = 'reject';

function ReferenceConfirmStep({
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
  const reference = state.referenceCompany ?? null;
  if (!reference) return null;
  const country = LATAM_COUNTRIES.find((c) => c.code === reference.countryCode);
  const industry = industryOptions.find((option) => option.value === reference.industryId)?.label ?? null;
  const facts = [
    reference.domain,
    country ? `${getFlagEmoji(country.code)} ${country.name}` : null,
    industry,
  ].filter(Boolean);
  return (
    <ChatQuestionPanel
      aria-label="Confirmar empresa de referencia"
      title={`¿Es ${reference.name}?`}
      description={
        <span className="block space-y-1">
          {facts.length > 0 && <span className="block">{facts.join(' · ')}</span>}
          {reference.description && <span className="block">{reference.description}</span>}
        </span>
      }
      titleRef={titleRef}
      options={[
        { value: REFERENCE_CONFIRM, label: 'Sí, buscar sus competidores' },
        { value: REFERENCE_REJECT, label: 'No, es otra' },
      ]}
      onAnswer={(value) =>
        dispatch(value === REFERENCE_CONFIRM ? { type: 'CONFIRM_REFERENCE' } : { type: 'REJECT_REFERENCE' })
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
  dispatch,
  onCountryChange,
  titleRef,
}: {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
  onCountryChange: (code: string) => void;
  titleRef: TitleRef;
}) {
  // «Competidores»: varios países (una búsqueda por cada uno). La selección vive en el
  // reductor para sobrevivir a los remontajes del hilo, como las subindustrias.
  if (state.searchMode === 'competitors') {
    const selected = state.competitorCountryCodes ?? [];
    return (
      <ChatQuestionPanel
        aria-label="Países de la búsqueda"
        title="¿En qué países buscamos sus competidores?"
        description={`Elige hasta ${MAX_COMPETITOR_COUNTRIES}. Se hace una búsqueda por país.`}
        titleRef={titleRef}
        mode="multiple"
        max={MAX_COMPETITOR_COUNTRIES}
        options={COUNTRY_OPTIONS}
        selected={selected}
        onSelectionChange={(countryCodes) => dispatch({ type: 'SET_COMPETITOR_COUNTRIES', countryCodes })}
        onSubmitSelection={(countryCodes) => {
          if (countryCodes.length === 0) return;
          dispatch({ type: 'SET_COMPETITOR_COUNTRIES', countryCodes });
          onCountryChange(countryCodes[0]);
        }}
        filterPlaceholder="Buscar país"
        footerNotice={hasIssues(state, 'country') ? <StepBlockingIssues state={state} step="country" /> : undefined}
      />
    );
  }
  const suggested = state.countryCode;
  return (
    <ChatQuestionPanel
      aria-label="País de la búsqueda"
      title="¿En qué país quieres buscar prospectos?"
      titleRef={titleRef}
      options={COUNTRY_OPTIONS}
      selected={suggested ? [suggested] : []}
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
        state.searchMode === 'suppliers'
          ? '¿De qué industria deberían ser los proveedores?'
          : macro
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
