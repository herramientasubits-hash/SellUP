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
import { executeProspectWizardGenerationAction } from '@/modules/prospect-batches/chat-wizard-execution';
import { resolveWizardLushaCriteria } from '@/modules/prospect-batches/wizard-lusha-criteria';
import { WizardMessageList } from './wizard-message-list';
import { WizardActiveStep } from './wizard-active-step';
import {
  WizardConversationSummary,
  RestartConfirmation,
} from './wizard-conversation-summary';
import { WizardChatComposer } from './wizard-chat-composer';
import { getComposerMode, getComposerPlaceholder } from './wizard-composer-utils';
import { useWizardMessageSound } from './use-wizard-message-sound';
// A1-APOLLO-WIZARD-1 — indicador del proveedor de búsqueda. La resolución es del
// backend (prop `discoveryProvider` + ruta Lusha + omisión reportada por la
// acción); aquí sólo se reduce y se pinta.
import { WizardProviderIndicatorRow } from './wizard-provider-indicator';
import { resolveWizardProviderIndicator } from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator';
import type {
  WizardIndicatorLushaRoute,
  WizardIndicatorProviderKey,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator';
import type { WizardDiscoveryProviderKey } from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver';
import type { NoNewCandidatesBreakdown } from '@/modules/prospect-batches/chat-wizard-execution/wizard-no-new-candidates-copy';
import type { WizardPersistenceOutcome } from '@/modules/prospect-batches/chat-wizard-execution/wizard-result-copy';
// A1-APOLLO-QA-CONTROL-SURFACE-1 — superficie administrativa de proveedor por
// corrida. La capacidad la resuelve el servidor; aquí sólo se guarda la elección
// del administrador y se envía como PETICIÓN.
import {
  NO_PROVIDER_OVERRIDE_CAPABILITY,
  isProviderOptionEnabled,
  type WizardProviderOverrideCapability,
  type WizardRunSelectableProvider,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import type { ApolloRunModeLimits } from './wizard-run-provider-copy';
// AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — instantánea de presupuesto resuelta
// en el servidor; aquí sólo se transporta hasta el panel que decide qué ofrecer.
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';

// ── Error code → user-facing message mapping ──────────────────────────────────
// Extracted to a separate module so tests can import without a DOM environment.

import {
  mapExecutionError,
  mapPersistenceNotReady,
  mapProviderSkip,
  mapBudgetExceeded,
} from './wizard-execution-error-map';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUMMARY_STEPS = new Set([
  'summary',
  'validating',
  'validated',
  'submitting',
  'success',
  'blocked',
  'error',
]);

// ── Main component ────────────────────────────────────────────────────────────

type ProspectChatWizardProps = {
  catalog: ActiveIndustryCatalog;
  onClose: () => void;
  executionEnabled?: boolean;
  /**
   * Q3F-5BB.3E — When true, the final search step uses Lusha as a HIDDEN
   * discovery provider (read-only) if the collected criteria are compatible.
   * The conversational flow is identical either way; Lusha only backs the final
   * "Buscar con IA" search. Gated by ENABLE_LUSHA_PREVIEW upstream. Default false.
   */
  lushaPreviewEnabled?: boolean;
  /**
   * A1-APOLLO-WIZARD-1 — proveedor de descubrimiento resuelto EN EL SERVIDOR por
   * `resolveWizardDiscoveryProvider()`, la misma función que enruta la ejecución.
   * `null`/ausente = sin resolución conocida; el indicador lo dice en lugar de
   * asumir un default. El cliente nunca lo deduce de flags ni de env.
   */
  discoveryProvider?: WizardDiscoveryProviderKey | null;
  /**
   * A1-APOLLO-QA-CONTROL-SURFACE-1 § 2 — capacidad SANITIZADA resuelta en el
   * servidor (sesión + rol admin + `ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE`).
   *
   * Ausente ⇒ sin capacidad, que es el default de todo el sistema y el estado
   * actual de Producción. Este objeto NO es una autorización: la ejecución vuelve
   * a derivar autoridad y flags server-side, así que un cliente que lo manipule no
   * consigue Apollo.
   */
  providerOverrideCapability?: WizardProviderOverrideCapability;
  /**
   * § 5 — topes efectivos de la modalidad de dos rondas, resueltos server-side por
   * las mismas funciones que gobiernan la reserva. `null` ⇒ no se anuncia ninguna
   * cifra, en vez de repetir los defaults del código a mano.
   */
  apolloRunModeLimits?: ApolloRunModeLimits | null;
  /**
   * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — saldo del período vigente y coste
   * del peor caso de cada proveedor seleccionable, resueltos server-side por las
   * MISMAS funciones que calculan la reserva.
   *
   * No es una autorización ni una reserva: la RPC atómica sigue siendo la única
   * autoridad. Sólo permite que la pantalla avise antes de ofrecer un botón cuyo
   * rechazo ya se conoce. Ausente/`null` ⇒ sin instantánea, no se bloquea nada.
   */
  budgetPreflight?: WizardBudgetPreflight | null;
};

export function ProspectChatWizard({
  catalog,
  onClose,
  executionEnabled = false,
  lushaPreviewEnabled = false,
  discoveryProvider = null,
  providerOverrideCapability = NO_PROVIDER_OVERRIDE_CAPABILITY,
  apolloRunModeLimits = null,
  budgetPreflight = null,
}: ProspectChatWizardProps) {
  const [state, dispatch] = React.useReducer(
    prospectWizardReducer,
    undefined,
    () =>
      createInitialProspectWizardState({
        catalogVersion: catalog.version,
        defaultRequestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
      }),
  );

  // clientRequestId — generated once when entering validated state, reset on restart
  const clientRequestIdRef = React.useRef<string | null>(null);

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

  // ── Sound: short mechanical keyboard click when AI message appears ──────────
  // Extraído a un hook propio; comportamiento idéntico.
  const playMessageSound = useWizardMessageSound();

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

  // ── Hidden Lusha provider decision for the final search step ────────────────
  // Pure: classifies the collected criteria + builds the read-only Lusha input.
  // NEVER runs Lusha — the explicit "Buscar con IA" click is the only trigger.
  const lushaCriteria = React.useMemo(
    () =>
      resolveWizardLushaCriteria(
        {
          countryCode: state.countryCode,
          industryId: state.industryId,
          subindustryIds: state.subindustryIds,
          additionalCriteriaRaw: state.additionalCriteriaRaw,
        },
        catalog,
        lushaPreviewEnabled,
      ),
    [
      state.countryCode,
      state.industryId,
      state.subindustryIds,
      state.additionalCriteriaRaw,
      catalog,
      lushaPreviewEnabled,
    ],
  );

  // ── Proveedor de búsqueda omitido por el backend ────────────────────────────
  // Sólo se llena con lo que reporta la acción (`providerSkipped`). Se limpia al
  // iniciar cada ejecución: una omisión pasada no describe el intento actual.
  const [skippedProvider, setSkippedProvider] =
    React.useState<WizardIndicatorProviderKey | null>(null);

  // ── § 3 · proveedor pedido para ESTA corrida ────────────────────────────────
  // `undefined` = el administrador no tocó el selector. Ese es el valor inicial a
  // propósito: sin petición, la acción no consulta el rol y la corrida resuelve al
  // predeterminado global igual que antes del hito. La selección vive sólo en
  // estado de React — nunca en localStorage, cookies, perfil ni configuración
  // global — así que no puede sobrevivir a una corrida nueva ni contaminar a otro
  // usuario.
  const [requestedProvider, setRequestedProvider] = React.useState<
    WizardRunSelectableProvider | undefined
  >(undefined);

  // ── § 10 · proveedor que el SERVIDOR resolvió para esta corrida ─────────────
  // Se llena sólo con lo que devuelve la acción. Si el administrador pidió Apollo
  // y el servidor resolvió Tavily, aquí queda Tavily: el indicador nunca refleja
  // la selección local.
  const [runResolvedProvider, setRunResolvedProvider] =
    React.useState<WizardDiscoveryProviderKey | null>(null);

  // ── § 11 · cifras reales de la modalidad de dos rondas ──────────────────────
  const [twoRoundOutcome, setTwoRoundOutcome] = React.useState<{
    roundsExecuted: number | null;
    eligibleCompaniesFound: number | null;
  } | null>(null);

  // ── QUERY-QUALITY-2 § 8 · distribución REAL de descartes ────────────────────
  // El copy de «no encontramos empresas nuevas» se deriva de esto. Sin dato, la
  // UI no afirma ninguna causa concreta.
  const [noNewCandidatesBreakdown, setNoNewCandidatesBreakdown] =
    React.useState<NoNewCandidatesBreakdown | null>(null);

  // ── PERSISTENCE-READINESS-4 § 8 · resultado REAL de la escritura ────────────
  // Gana sobre historial y calidad al resolver el copy: un fallo de
  // almacenamiento no es una razón de historial y pedirle al usuario que repita
  // la búsqueda le costaría los créditos otra vez.
  const [persistenceOutcome, setPersistenceOutcome] =
    React.useState<WizardPersistenceOutcome | null>(null);

  // ── Indicador de proveedor de búsqueda ──────────────────────────────────────
  // Reducción pura de las señales del backend: el proveedor resuelto POR CORRIDA
  // (que manda cuando existe), el predeterminado global resuelto en el servidor,
  // la ruta efectiva de Lusha y el proveedor que la acción reportó como omitido.
  const providerIndicator = React.useMemo(
    () =>
      resolveWizardProviderIndicator({
        serverDiscoveryProvider: discoveryProvider,
        lushaRoute: lushaCriteria.provider as WizardIndicatorLushaRoute,
        skippedProvider,
        runResolvedProvider,
      }),
    [discoveryProvider, lushaCriteria.provider, skippedProvider, runResolvedProvider],
  );

  /**
   * § 11 — ¿esta corrida va a ejecutar Apollo en dos rondas?
   *
   * Se deriva de la petición del administrador Y de la capacidad, que el servidor
   * sólo declara con el kill switch y la modalidad de dos rondas encendidos. Es lo
   * más cerca que el cliente puede estar de la verdad mientras la ejecución está
   * en vuelo, y por eso las etapas se presentan como PLAN y no como progreso.
   */
  const willRunApolloTwoRound =
    requestedProvider === 'apollo_organizations' &&
    isProviderOptionEnabled(providerOverrideCapability, 'apollo_organizations');

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

  // ── Reset clientRequestId when wizard is restarted (step returns to welcome) ─

  React.useEffect(() => {
    if (state.currentStep === 'welcome') {
      clientRequestIdRef.current = null;
    }
  }, [state.currentStep]);

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

  // ── Scroll to active step once typing finishes (step UI appears) ─────────────
  const prevTypingRef = React.useRef(isTyping);
  React.useEffect(() => {
    if (prevTypingRef.current && !isTyping) {
      requestAnimationFrame(() => {
        activeStepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      });
    }
    prevTypingRef.current = isTyping;
  }, [isTyping]);

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

  // ── Edit search from validated panel ─────────────────────────────────────
  // Goes directly to additional_criteria (last data step) instead of summary,
  // so auto-validation on summary is not immediately re-triggered in a loop.

  function handleEditSearch() {
    setCriteriaIntention('pending');
    setCriteriaText('');
    dispatch({ type: 'EDIT_STEP', step: 'additional_criteria' });
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
        if (!clientRequestIdRef.current) {
          clientRequestIdRef.current = crypto.randomUUID();
          // § 3 — una corrida NUEVA vuelve a Tavily. El punto de reinicio es el
          // momento en que se acuña un clientRequestId, porque la elección de
          // proveedor pertenece a esa corrida y a ninguna otra: recordar Apollo
          // aquí convertiría una prueba puntual en el default silencioso del
          // wizard. «Editar búsqueda» conserva el clientRequestId y por tanto la
          // elección — es la misma corrida (§ 9).
          setRequestedProvider(undefined);
          setRunResolvedProvider(null);
          setTwoRoundOutcome(null);
        }
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

  // ── Auto-validation when configuration is complete ────────────────────────
  // Fires when the wizard reaches 'summary' with a valid config and message
  // animations have finished. Replaces the removed manual "Validar" button.
  //
  // The ref is updated in a layout effect (runs after render, before effects)
  // so the auto-validation effect always calls the latest handleValidate closure
  // without adding it as a dep (which would cause the effect to re-run every render).

  const handleValidateRef = React.useRef(handleValidate);
  React.useLayoutEffect(() => {
    handleValidateRef.current = handleValidate;
  });

  React.useEffect(() => {
    if (state.currentStep !== 'summary') return;
    if (isTyping) return;
    if (!canValidateWizard(state)) return;
    handleValidateRef.current();
    // Re-runs only when currentStep or isTyping changes. Data-field changes
    // always transition the step away from 'summary' first, so canValidateWizard
    // is guaranteed to be re-evaluated on the next summary entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentStep, isTyping]);

  // ── Execution ─────────────────────────────────────────────────────────────

  async function handleExecute() {
    if (state.currentStep !== 'validated') return;
    if (!clientRequestIdRef.current) return;

    dispatch({ type: 'BEGIN_EXECUTION' });
    // Un intento nuevo empieza sin omisión previa: el indicador vuelve al
    // proveedor resuelto hasta que el backend diga otra cosa.
    setSkippedProvider(null);

    try {
      const result = await executeProspectWizardGenerationAction({
        countryCode: state.countryCode!,
        industryId: state.industryId!,
        subindustryIds: state.subindustryIds,
        additionalCriteriaRaw: state.additionalCriteriaRaw,
        catalogVersion: state.catalogVersion,
        clientRequestId: clientRequestIdRef.current,
        // § 6 — lo ÚNICO que el cliente puede enviar sobre el proveedor: una
        // petición. Nunca `resolvedDiscoveryProvider`, `providerResolutionReason`,
        // `isAdmin`, `providerAuthorized`, `authority` ni `overrideAllowed`; el
        // schema es `.strict()` y rechazaría la solicitud entera.
        //
        // Ausente cuando el administrador no tocó el selector, de modo que un
        // wizard sin tocar produce exactamente la misma solicitud que antes del
        // hito.
        ...(requestedProvider !== undefined
          ? { requestedDiscoveryProvider: requestedProvider }
          : {}),
      });

      // § 10 — la fuente del indicador es el servidor, en éxito y en fallo.
      if (result.runProvider) {
        setRunResolvedProvider(
          result.runProvider.resolved === 'lusha_companies'
            ? null
            : result.runProvider.resolved,
        );
      }
      if (result.ok && result.twoRoundOutcome) {
        setTwoRoundOutcome(result.twoRoundOutcome);
      }
      if (result.ok && result.noNewCandidatesBreakdown) {
        setNoNewCandidatesBreakdown(result.noNewCandidatesBreakdown);
      }
      if (result.ok && result.persistenceOutcome) {
        setPersistenceOutcome(result.persistenceOutcome);
      }

      if (result.ok) {
        dispatch({
          type: 'EXECUTION_SUCCEEDED',
          batchId: result.batchId,
          redirectPath: result.redirectPath,
          status: result.status,
        });
      } else {
        // A1-APOLLO-WIZARD-1: un proveedor omitido trae su propio motivo, con
        // mensaje y reintentabilidad precisos; el resto sigue por el mapa de
        // códigos de siempre.
        //
        // A1-APOLLO-PERSISTENCE-READINESS-4-FIX § 1 y § 2: el preflight de
        // persistencia se resuelve igual, desde su resultado estructurado. Pasar
        // por `mapExecutionError` a secas descartaría `persistenceNotReady.reason`
        // —la diferencia entre «falta la migración» y «no se pudo comprobar»— y
        // sustituiría el `retryable` que decidió el servidor por el de una tabla.
        const mapped =
          result.code === 'PROVIDER_UNAVAILABLE'
            ? mapProviderSkip(result.providerSkipped?.skipReason)
            : result.code === 'PERSISTENCE_NOT_READY'
              ? mapPersistenceNotReady(result.persistenceNotReady, result.retryable)
              : result.code === 'BUDGET_EXCEEDED'
                ? mapBudgetExceeded(result.budgetExceeded)
                : mapExecutionError(result.code);
        // El nombre del proveedor omitido se conserva visible; el motivo técnico
        // NO se muestra: el usuario ve el mensaje funcional ya mapeado.
        if (result.code === 'PROVIDER_UNAVAILABLE' && result.providerSkipped) {
          setSkippedProvider(result.providerSkipped.provider);
        }
        // 🔴 AGENT1-LOCAL-CUT6B-PARTIAL-UI-PROPAGATION §§ 1, 3 — el fallo se
        // despacha igual que siempre y ADEMÁS lleva el aporte durable que el
        // servidor declaró. Antes de este corte esta rama descartaba
        // `result.freeContribution` en silencio: la corrida dejaba 4 empresas
        // guardadas y el mago decía «falló» a secas, que es la misma pérdida del
        // todo-o-nada trasladada al último salto.
        //
        // Se propaga TAL CUAL, sin releerlo ni recalcularlo: el servidor es la
        // única autoridad sobre cuántas filas sobrevivieron y en qué lote. En
        // particular el `batchId` viaja desde aquí y nunca se busca «el último
        // lote», que sería una heurística capaz de señalar a otra corrida.
        dispatch({
          type: 'EXECUTION_FAILED',
          errorCode: result.code,
          message: mapped.message,
          retryable: mapped.retryable,
          ...(result.freeContribution ? { freeContribution: result.freeContribution } : {}),
        });
      }
    } catch {
      dispatch({
        type: 'EXECUTION_FAILED',
        errorCode: 'GENERATION_FAILED',
        message: 'No fue posible completar la generación de prospectos.',
        retryable: false,
      });
    }
  }

  // ── Progress label ────────────────────────────────────────────────────────

  const showProgress =
    !['welcome', 'validating', 'validated', 'submitting', 'success', 'blocked', 'error'].includes(
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

  // Q3F-5BB.3F — At the final review step the actions live in the panel footer
  // ("Buscar con IA" / "Editar búsqueda" / "Comenzar de nuevo"). A disabled
  // "La configuración ya fue validada" input would only read as a dead field,
  // so we hide the composer once the configuration is validated (or done).
  const hideComposer =
    state.currentStep === 'validated' || state.currentStep === 'success';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-0 min-h-full">
      {/* Scrollable conversation body */}
      <div ref={scrollContainerRef} className="flex flex-col gap-4 pb-6">
        {/* Encabezado del contenido: progreso + proveedor de búsqueda.
            Van en el mismo bloque con separación mínima para que el indicador
            cueste una línea, no un bloque más en el gap-4 de la conversación.
            El indicador se mantiene visible en todos los pasos: la barra se
            oculta al validar, que es justo cuando saber el proveedor importa. */}
        <div className="flex flex-col gap-1.5">
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

          <WizardProviderIndicatorRow indicator={providerIndicator} />
        </div>

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

        {/* Active step input or summary — hidden while messages are still being revealed */}
        {!state.restartConfirmationRequired && !isTyping && (
          <div ref={activeStepRef}>
            {isSummaryPhase ? (
              <WizardConversationSummary
                state={state}
                catalog={catalog}
                dispatch={summaryDispatch}
                onClose={onClose}
                executionEnabled={executionEnabled}
                onExecute={handleExecute}
                onEditSearch={handleEditSearch}
                lushaPreviewEnabled={lushaPreviewEnabled}
                lushaCriteria={lushaCriteria}
                providerOverrideCapability={providerOverrideCapability}
                apolloRunModeLimits={apolloRunModeLimits}
                budgetPreflight={budgetPreflight}
                // El coste contra el que se compara es el del proveedor que de
                // verdad correría: la selección de esta corrida si el
                // administrador la hizo, y si no, el predeterminado que resolvió
                // el servidor. Nunca se adivina uno en el cliente.
                defaultDiscoveryProvider={discoveryProvider}
                requestedProvider={requestedProvider}
                onRequestedProviderChange={setRequestedProvider}
                showApolloTwoRoundStages={willRunApolloTwoRound}
                twoRoundOutcome={twoRoundOutcome}
                noNewCandidatesBreakdown={noNewCandidatesBreakdown}
                persistenceOutcome={persistenceOutcome}
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

      {/* Sticky composer — spans full width by negating the drawer's px-7 padding.
          Hidden at the final review step: actions move to the panel footer. */}
      {!hideComposer && (
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
      )}
    </div>
  );
}
