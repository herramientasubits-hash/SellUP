'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Pencil, RotateCcw, AlertTriangle, XCircle, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import type {
  ProspectWizardState,
  ProspectWizardAction,
  EditableWizardStep,
} from '@/modules/prospect-batches/chat-wizard';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { WizardLushaCriteriaDecision } from '@/modules/prospect-batches/wizard-lusha-criteria';
import { isLushaRouteHonored } from '@/modules/prospect-batches/prospect-discovery-provider';
// AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 — bajo el catálogo v2 (macro industria) la
// selección de subindustria no existe: el resumen no puede seguir preguntando
// por ella con la señal equivocada (`subindustryIds.length === 0`, que también es
// alcanzable en v1 cuando el usuario decide no acotar). El gate es la MISMA
// capacidad que ya decide si el paso del wizard se renderiza.
import { isSubindustrySelectionEnabled } from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
// AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — bloqueo de presupuesto ANTES del
// primer clic. El núcleo es puro y la instantánea la resolvió el servidor: esta
// pantalla no lee la base, no estima nada y no puede autorizar una corrida.
import { resolveWizardPreExecutionBudgetBlock } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import { mapBudgetExceeded, presentFreeContribution } from './wizard-execution-error-map';
import type { WizardFreeContribution } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';
// AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — disponibilidad del discovery de Agente
// 1, y el catálogo de países del propio wizard como fuente de verdad.
import {
  resolveWizardDiscoveryAvailability,
  type WizardDiscoveryUnavailableReason,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-discovery-availability';
import { VALID_COUNTRY_CODES } from '@/modules/prospect-batches/chat-wizard';
import {
  buildWizardFinalRecap,
  buildWizardSubindustrySelectionRecap,
  WIZARD_SUBINDUSTRY_RECAP_EMPTY_LABEL,
  WIZARD_SUBINDUSTRY_RECAP_LABEL,
} from '@/modules/prospect-batches/wizard-final-summary';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import { WizardLushaFinalSearch } from './wizard-lusha-final-search';
// A1-APOLLO-QA-CONTROL-SURFACE-1 — selector administrativo por corrida (§ 2–5) y
// etapas/cierre de la modalidad de dos rondas (§ 11).
import { WizardRunProviderSelector } from './wizard-run-provider-selector';
// Paneles de la fase de ejecución (overlay, envío y éxito), extraídos a su propio
// archivo para mantener este por debajo del techo de tamaño del repo.
import { SubmittingPanel, SuccessPanel } from './wizard-execution-panels';
import type { NoNewCandidatesBreakdown } from '@/modules/prospect-batches/chat-wizard-execution/wizard-no-new-candidates-copy';
import type { WizardPersistenceOutcome } from '@/modules/prospect-batches/chat-wizard-execution/wizard-result-copy';
import type { ApolloRunModeLimits } from './wizard-run-provider-copy';
import {
  NO_PROVIDER_OVERRIDE_CAPABILITY,
  type WizardProviderOverrideCapability,
  type WizardRunSelectableProvider,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A1-APOLLO-QA-CONTROL-SURFACE-1 — superficie de proveedor por corrida.
 *
 * Todo opcional y fail-closed: omitir estas props equivale a «sin capacidad, sin
 * topes, sin etapas», que es el comportamiento previo al hito. Un llamador que se
 * olvide de pasarlas no expone el selector por accidente.
 */
type WizardRunProviderSurfaceProps = {
  providerOverrideCapability?: WizardProviderOverrideCapability;
  apolloRunModeLimits?: ApolloRunModeLimits | null;
  /** `undefined` = el administrador no tocó el selector (§ 3). */
  requestedProvider?: WizardRunSelectableProvider | undefined;
  onRequestedProviderChange?: (provider: WizardRunSelectableProvider) => void;
  /** § 11 — listar las etapas de dos rondas mientras la corrida está en vuelo. */
  showApolloTwoRoundStages?: boolean;
  /** § 11 — cifras reales devueltas por el backend. `null` = no corrió / no llegó. */
  twoRoundOutcome?: { roundsExecuted: number | null; eligibleCompaniesFound: number | null } | null;
  /** QUERY-QUALITY-2 § 8 — distribución real de descartes de la corrida. */
  noNewCandidatesBreakdown?: NoNewCandidatesBreakdown | null;
  /** PERSISTENCE-READINESS-4 § 8 — cifras reales de la escritura. `null` = no llegaron. */
  persistenceOutcome?: WizardPersistenceOutcome | null;
  /**
   * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — saldo del período y coste del peor
   * caso por proveedor, resueltos en el servidor. Ausente/`null` ⇒ sin
   * instantánea: no se bloquea por presupuesto y la reserva atómica decide.
   */
  budgetPreflight?: WizardBudgetPreflight | null;
  /**
   * Proveedor que el servidor resolvió como predeterminado. Sólo se usa para
   * saber a qué coste comparar cuando el administrador no eligió uno para esta
   * corrida; `null` ⇒ proveedor sin nombrar, y entonces no se bloquea.
   */
  defaultDiscoveryProvider?: WizardRunSelectableProvider | null;
};

type WizardConversationSummaryProps = WizardRunProviderSurfaceProps & {
  state: ProspectWizardState;
  catalog: ActiveIndustryCatalog;
  dispatch: React.Dispatch<ProspectWizardAction>;
  onClose: () => void;
  executionEnabled: boolean;
  onExecute: () => void;
  onEditSearch: () => void;
  /** Q3F-5BB.3E — hidden Lusha provider gate for the final search step. */
  lushaPreviewEnabled: boolean;
  /** Q3F-5BB.3E — resolved provider decision + read-only Lusha input. */
  lushaCriteria: WizardLushaCriteriaDecision;
};

// ── Main component ────────────────────────────────────────────────────────────

export function WizardConversationSummary({
  state,
  catalog,
  dispatch,
  onClose,
  executionEnabled,
  onExecute,
  onEditSearch,
  lushaPreviewEnabled,
  lushaCriteria,
  providerOverrideCapability = NO_PROVIDER_OVERRIDE_CAPABILITY,
  apolloRunModeLimits = null,
  requestedProvider,
  onRequestedProviderChange,
  showApolloTwoRoundStages = false,
  twoRoundOutcome = null,
  noNewCandidatesBreakdown = null,
  persistenceOutcome = null,
  budgetPreflight = null,
  defaultDiscoveryProvider = null,
}: WizardConversationSummaryProps) {
  if (state.currentStep === 'validating') {
    return <ValidatingPanel />;
  }

  if (state.currentStep === 'validated') {
    return (
      <ValidatedPanel
        state={state}
        catalog={catalog}
        dispatch={dispatch}
        executionEnabled={executionEnabled}
        onExecute={onExecute}
        executionError={state.executionError}
        freeContribution={state.executionFreeContribution}
        onEditSearch={onEditSearch}
        onClose={onClose}
        lushaPreviewEnabled={lushaPreviewEnabled}
        lushaCriteria={lushaCriteria}
        providerOverrideCapability={providerOverrideCapability}
        apolloRunModeLimits={apolloRunModeLimits}
        requestedProvider={requestedProvider}
        onRequestedProviderChange={onRequestedProviderChange}
        budgetPreflight={budgetPreflight}
        defaultDiscoveryProvider={defaultDiscoveryProvider}
      />
    );
  }

  if (state.currentStep === 'submitting') {
    return (
      <SubmittingPanel
        showApolloTwoRoundStages={showApolloTwoRoundStages}
        maxRounds={apolloRunModeLimits?.maxRounds ?? null}
      />
    );
  }

  if (state.currentStep === 'success') {
    return (
      <SuccessPanel
        status={state.executionStatus}
        noveltyExhausted={state.executionNoveltyExhausted}
        candidateCount={state.executionTargetPersistibleCandidates}
        targetPersistibleCandidates={state.executionTargetPersistibleCandidates}
        onClose={onClose}
        onEditSearch={onEditSearch}
        twoRoundOutcome={twoRoundOutcome}
        noNewCandidatesBreakdown={noNewCandidatesBreakdown}
        persistenceOutcome={persistenceOutcome}
        targetEligibleCompanies={apolloRunModeLimits?.targetEligibleCompanies ?? null}
      />
    );
  }

  if (state.currentStep === 'blocked') {
    return (
      <BlockedPanel
        state={state}
        dispatch={dispatch}
      />
    );
  }

  // Default: summary step — auto-validation fires via useEffect in prospect-chat-wizard
  return (
    <SummaryPanel
      state={state}
      catalog={catalog}
      dispatch={dispatch}
    />
  );
}

// ── Validating panel ──────────────────────────────────────────────────────────

function ValidatingPanel() {
  return (
    <div
      className="flex items-center gap-3 rounded-xl bg-muted/40 px-5 py-4"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-su-brand" aria-hidden />
      <p className="text-sm text-foreground">Verificando disponibilidad de generación…</p>
    </div>
  );
}

// ── Validated panel ───────────────────────────────────────────────────────────

type ValidatedPanelProps = {
  state: ProspectWizardState;
  catalog: ActiveIndustryCatalog;
  dispatch: React.Dispatch<ProspectWizardAction>;
  executionEnabled: boolean;
  onExecute: () => void;
  executionError: { code: string; message: string; retryable: boolean } | null;
  /**
   * CUT-6B § 3 — lo que la capa gratuita dejó guardado en la ejecución fallida.
   * `null` = no hay nada que declarar, y el bloque de error se pinta byte por
   * byte como antes de este corte.
   */
  freeContribution: WizardFreeContribution | null;
  onEditSearch: () => void;
  onClose: () => void;
  lushaPreviewEnabled: boolean;
  lushaCriteria: WizardLushaCriteriaDecision;
  providerOverrideCapability: WizardProviderOverrideCapability;
  apolloRunModeLimits: ApolloRunModeLimits | null;
  requestedProvider: WizardRunSelectableProvider | undefined;
  /**
   * Ausente ⇒ el selector no se renderiza. Un control cuyo cambio nadie escucha
   * es peor que no ofrecerlo: parece elegible y no elige nada.
   */
  onRequestedProviderChange?: (provider: WizardRunSelectableProvider) => void;
  budgetPreflight: WizardBudgetPreflight | null;
  defaultDiscoveryProvider: WizardRunSelectableProvider | null;
};

function ValidatedPanel({ state, catalog, dispatch, executionEnabled, onExecute, executionError, freeContribution, onEditSearch, onClose, lushaPreviewEnabled, lushaCriteria, providerOverrideCapability, apolloRunModeLimits, requestedProvider, onRequestedProviderChange, budgetPreflight, defaultDiscoveryProvider }: ValidatedPanelProps) {
  const router = useRouter();
  // Q3F-5BB.3E — Final search step. When the collected criteria resolve to the
  // hidden Lusha provider, the final "Buscar con IA" search runs Lusha read-only
  // (explicit click only, no persistence). Otherwise the existing IA generation
  // (or the "not enabled yet" message) is preserved unchanged.
  // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — la ruta de Lusha se pregunta por su
  // predicado, no comparando literales: con el flag apagado `isLushaRouteHonored`
  // es false y Lusha no corre, que es la propiedad de seguridad de 10C3.
  const useLushaFinalSearch =
    lushaPreviewEnabled &&
    isLushaRouteHonored(lushaCriteria.provider) &&
    lushaCriteria.input !== null;

  // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — disponibilidad del discovery de
  // Agente 1 (Tavily / Apollo), decidida por la FORMA de la búsqueda y por nada
  // más. No consulta la ruta de Lusha, ni la industria, ni las subindustrias, ni el
  // criterio adicional, ni el proveedor predeterminado.
  //
  // Antes esta pantalla derivaba la disponibilidad de la ruta del proveedor OCULTO
  // Lusha: con criterios Lusha-elegibles y el flag apagado retiraba el selector y
  // «Generar prospectos», así que Colombia + Salud + tres subindustrias no tenía
  // ninguna forma de ejecutarse aunque Apollo estuviera desplegado y con
  // presupuesto. Un proveedor oculto que el usuario nunca eligió no puede decidir
  // si la búsqueda que sí eligió es ofrecible.
  const discoveryAvailability = resolveWizardDiscoveryAvailability({
    searchMode: state.searchMode,
    countryCode: state.countryCode,
    industryId: state.industryId,
    supportedCountryCodes: VALID_COUNTRY_CODES,
  });

  // Q3F-5BB.3F — human labels (país/sector/subindustria/tamaño/criterio) resolved
  // from the wizard's own catalog for the final "Revisa tu búsqueda" recap.
  // Display only — never alters the Lusha request.
  const finalRecap = React.useMemo(
    () => buildWizardFinalRecap(state, catalog),
    [state, catalog],
  );

  // A1-APOLLO-PERSISTENCE-READINESS-4-FIX § 1 — el preflight de persistencia
  // bloqueó la corrida. El texto dice que hay que esperar a que se corrija el
  // almacenamiento; dejar «Generar prospectos» a un clic contradiría el mensaje y
  // sólo produciría el mismo bloqueo otra vez. Se retira también el selector de
  // proveedor, que comparte gate con el botón por diseño: si esta pantalla no
  // puede ejecutar, tampoco ofrece elegir con qué.
  // 🔴 CUT-6B § 4 — la decisión de mostrar y el texto salen de UNA función pura y
  // compartida (`presentFreeContribution`), no de una comparación escrita aquí.
  // Devuelve `null` con aporte ausente o en cero, así que este componente no
  // puede anunciar empresas que no existen.
  const freeContributionNotice = presentFreeContribution(freeContribution);
  const isPersistenceBlocked = executionError?.code === 'PERSISTENCE_NOT_READY';

  // AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 § 4 — un intento anterior ya volvió con
  // `BUDGET_EXCEEDED`: reintentar sin cambiar nada fallaría exactamente igual, y
  // la reserva atómica del servidor sigue siendo quien decide de verdad (fail-
  // closed) — esto sólo evita ofrecer un botón que la UI ya sabe que va a
  // rechazarse. Comparte gate con el selector de proveedor por el mismo motivo
  // que `isPersistenceBlocked`: si esta pantalla no puede ejecutar, tampoco
  // ofrece elegir con qué.
  const isBudgetReactivelyBlocked = executionError?.code === 'BUDGET_EXCEEDED';

  // AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — el bloqueo REACTIVO de arriba llega
  // tarde: exige que la usuaria gaste un clic para descubrir que la corrida no
  // cabía. Con la instantánea del período ya resuelta en el servidor, el mismo
  // bloqueo se conoce ANTES del primer intento.
  //
  // Tres propiedades que este bloque no puede romper:
  //   · No autoriza nada. Sólo puede retirar una oferta, nunca añadirla: la
  //     reserva atómica (`try_reserve_wizard_credits`) sigue siendo la única
  //     autoridad, y la carrera «la UI dice que cabe / otra corrida se lo gasta»
  //     la sigue resolviendo ella con el bloqueo reactivo.
  //   · Sin instantánea no bloquea. Una lectura fallida deja la pantalla como
  //     estaba; convertir «no pude leer» en «no puedes ejecutar» bloquearía a
  //     todo el mundo por un error de diagnóstico.
  //   · No nombra un proveedor que nadie eligió: sin selección explícita compara
  //     contra el predeterminado que resolvió el servidor, y si tampoco lo hay,
  //     no bloquea.
  //
  // AGENT1-LUSHA-PRECLICK-UX-CONSISTENCY-FIX-1 § P0 — este preflight es el de
  // Apollo/Tavily, y SÓLO de ellos.
  //
  // La ruta de Lusha tiene su propio aviso previo dentro de
  // `WizardLushaFinalSearch` (el resolutor plan-aware de esa ruta), que es el
  // único consciente de cuántas ramas ejecuta la macro industria. Mientras este
  // bloque se evaluaba también en esa ruta, la misma pantalla publicaba DOS
  // autoridades económicas incompatibles: la QA visual del 2026-08-19 (CO ·
  // health_pharma · 6 disponibles) vio a la vez «Requeridos: 20 créditos» —el
  // techo de Tavily, un proveedor que esa corrida no va a usar— y el panel
  // correcto de Lusha con 6/6 y su CTA habilitado. Un aviso que nombra el coste
  // de otro proveedor no es un aviso: es ruido que contradice al que sí manda.
  //
  // `!useLushaFinalSearch` no debilita ningún gate: la ruta Lusha conserva su
  // propio bloqueo previo, y la autoridad económica real sigue siendo la reserva
  // atómica del servidor (`try_reserve_wizard_credits`), que no depende de nada
  // de esta pantalla. Apollo/Tavily conservan su preflight intacto.
  const budgetProvider = requestedProvider ?? defaultDiscoveryProvider;
  const preExecutionBudgetBlock =
    !useLushaFinalSearch && budgetProvider
      ? resolveWizardPreExecutionBudgetBlock(budgetPreflight, budgetProvider)
      : null;

  const isBudgetBlocked = isBudgetReactivelyBlocked || preExecutionBudgetBlock !== null;

  // El aviso previo usa el MISMO redactor que el reactivo, así que «no alcanza»
  // vs. «se agotó» y las dos cifras son idénticas antes y después de intentar.
  // Cuando ya hay un error de ejecución en pantalla no se duplica: ese banner ya
  // dice lo mismo con los números que devolvió el servidor.
  const preExecutionBudgetMessage =
    preExecutionBudgetBlock !== null && executionError === null
      ? mapBudgetExceeded(preExecutionBudgetBlock).message
      : null;

  // § 6 — «la configuración es válida» describe los CRITERIOS (país, industria,
  // proveedor…), no si la corrida puede ejecutarse ahora mismo. Con un bloqueo
  // conocido (presupuesto o persistencia) el cuerpo del banner verde deja de
  // prometer una ejecución que no va a ocurrir; el motivo concreto vive en el
  // banner rojo de abajo, nunca duplicado aquí.
  const validBody = useLushaFinalSearch
    ? 'Revisa los criterios y ejecuta la búsqueda. Nada se guarda todavía.'
    : isPersistenceBlocked || isBudgetBlocked
      ? 'Los criterios de la búsqueda son correctos, pero todavía no puede ejecutarse. Revisa el aviso debajo.'
      : executionEnabled
        ? 'La búsqueda puede tardar unos segundos. No cierres esta ventana mientras se generan los candidatos.'
        : 'La generación real todavía no está habilitada.';

  return (
    <div className="space-y-4 animate-su-fade-in" role="status">
      {/* Banner A — validation (positive). */}
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-800/40 dark:bg-emerald-900/10">
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            La configuración es válida.
          </p>
          <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70">
            {validBody}
          </p>
        </div>
      </div>

      {executionError && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          {/* 🔴 CUT-6B § 4 — el bloque de error tiene DOS lecturas posibles y sólo
              una cambia. Sin aporte durable se pinta el MISMO árbol de antes de
              este corte —el `<p>` como hijo directo del flex, sin envoltorio— y no
              una versión equivalente: una rama aparte cuesta tres líneas y hace
              literal la afirmación de que ese caso no cambió. Con aporte se
              encabeza con el título y se añade la frase que declara lo guardado.

              El título NO se pone en el caso sin aporte a propósito: cada código
              ya trae su propia explicación (presupuesto, persistencia, proveedor
              omitido), y anteponerles un encabezado genérico las reencuadraría a
              todas por un cambio que sólo pretende dejar de callar un hecho. */}
          {freeContributionNotice === null ? (
            <p className="text-xs text-destructive">{executionError.message}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-destructive">
                {freeContributionNotice.title}
              </p>
              <p className="text-xs text-destructive">{executionError.message}</p>
              <p className="text-xs text-foreground" data-testid="wizard-free-contribution-notice">
                {freeContributionNotice.message}
              </p>
            </div>
          )}
        </div>
      )}

      {/* AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — mismo tratamiento visual que el
          error de ejecución: el bloqueo es igual de real, sólo que se conoce
          antes. `role="alert"` porque aparece sin que la usuaria haya actuado. */}
      {preExecutionBudgetMessage !== null && (
        <div
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3"
          role="alert"
          data-testid="wizard-budget-preflight-notice"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <p className="text-xs text-destructive">{preExecutionBudgetMessage}</p>
        </div>
      )}

      {/* La forma de la búsqueda no admite proveedor externo. Dice la causa real y
          no ofrece ningún control que pueda gastar. */}
      {!discoveryAvailability.available && (
        <DiscoveryUnavailableNotice reason={discoveryAvailability.reason} />
      )}

      {/* MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A.4 — la selección completa,
          en la ÚLTIMA pantalla antes de gastar créditos.
          Hasta ahora la recapitulación de subindustrias sólo existía dentro del
          panel de Lusha: la ruta que de verdad gasta (Apollo / «Generar
          prospectos») no mostraba ninguna, así que perder una subindustria entre
          dos clics era indetectable hasta leer el lote ya creado. */}
      {!useLushaFinalSearch && isSubindustrySelectionEnabled(state.catalogVersion) && (
        <SubindustrySelectionRecap state={state} catalog={catalog} />
      )}

      {/* Hidden Lusha provider — final "Revisa tu búsqueda" surface. The recap
          (país/sector/subindustria/tamaño/criterio/proveedor/costo), the credit
          banner and the primary "Buscar con IA" CTA all live inside. On click it
          persists the results as pending-review prospects and shows a brief
          confirmation (NOT a results list) with "Ver prospectos". */}
      {useLushaFinalSearch && lushaCriteria.input && (
        <WizardLushaFinalSearch
          input={lushaCriteria.input}
          recap={finalRecap}
          // AGENT1-LUSHA-BUDGET-GATE-1 § 6 — la MISMA instantánea que ya usa el
          // bloqueo previo de Apollo/Tavily unos bloques más arriba. Un segundo
          // canal para Lusha podría desviarse y avisar sobre otro período.
          budgetPreflight={budgetPreflight}
          onViewProspects={() => {
            router.push(PROSPECTOS_TAB_ROUTE);
            router.refresh();
            onClose();
          }}
          onGenerateAnother={() => dispatch({ type: 'CONFIRM_RESTART' })}
        />
      )}

      {/* Real IA generation — only when explicitly enabled, the search shape admits
          an external discovery provider, and Lusha is not backing this search. */}
      {/* A1-APOLLO-QA-CONTROL-SURFACE-1 § 2 — «Proveedor de esta corrida».
          Comparte exactamente el mismo gate que el botón de generación: si esta
          pantalla no puede ejecutar, tampoco ofrece elegir con qué. El propio
          selector se autocensura cuando la capacidad no lo permite, así que para
          un no-admin no se renderiza nada. */}
      {!useLushaFinalSearch &&
        discoveryAvailability.available &&
        executionEnabled &&
        !isPersistenceBlocked &&
        !isBudgetBlocked &&
        onRequestedProviderChange !== undefined && (
          <WizardRunProviderSelector
            capability={providerOverrideCapability}
            // § 3 — sin selección explícita el control muestra Tavily, y la
            // solicitud sigue viajando SIN campo de proveedor.
            value={requestedProvider ?? 'tavily'}
            onChange={onRequestedProviderChange}
            apolloLimits={apolloRunModeLimits}
          />
        )}

      {/* La conjunción `!useLushaFinalSearch && discoveryAvailability.available &&
          executionEnabled && !isPersistenceBlocked` es la que fija el gate de
          generación, y está pinada literalmente por
          prospect-wizard-route-static.test.ts. `!useLushaFinalSearch` conserva el
          guardrail de Lusha: una corrida que va a Lusha no ofrece «Generar
          prospectos». */}
      {!useLushaFinalSearch &&
        discoveryAvailability.available &&
        executionEnabled &&
        !isPersistenceBlocked &&
        !isBudgetBlocked && (
          <Button
            type="button"
            size="sm"
            className="w-full gap-1.5"
            onClick={onExecute}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Generar prospectos
          </Button>
        )}

      {/* Action hierarchy: primary = "Buscar con IA" (inside the panel above);
          secondary = "Editar búsqueda"; tertiary = "Comenzar de nuevo" (link).
          Close lives on the drawer's top X, not competing here. */}
      <div className="space-y-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={onEditSearch}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Editar búsqueda
        </Button>
        <button
          type="button"
          className="mx-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => dispatch({ type: 'REQUEST_RESTART' })}
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Comenzar de nuevo
        </button>
      </div>
    </div>
  );
}

// ── Aviso de discovery no aplicable ───────────────────────────────────────────
// AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — sustituye al aviso de «Lusha
// deshabilitado», que afirmaba «esta búsqueda utiliza un proveedor que todavía no
// está habilitado» para una búsqueda cuyo proveedor real —Tavily o Apollo— sí
// estaba habilitado. Cada motivo trae su propio texto y ninguno menciona un
// proveedor: la causa que se muestra es la que el código declara.

/** Texto por motivo. `Record` exhaustivo: un motivo nuevo no compila sin copy. */
const DISCOVERY_UNAVAILABLE_COPY: Readonly<
  Record<WizardDiscoveryUnavailableReason, { title: string; detail: string }>
> = {
  search_mode_not_provider_applicable: {
    title: 'Este tipo de búsqueda todavía no genera empresas automáticamente.',
    detail:
      'No se ejecutará ninguna generación ni se consumirán créditos. Elige «Empresas por criterios» para generar candidatos.',
  },
  country_not_selected: {
    title: 'Falta el país de la búsqueda.',
    detail: 'No se ejecutará ninguna generación ni se consumirán créditos. Vuelve a elegir el país.',
  },
  country_not_supported: {
    title: 'El país seleccionado no está disponible para generar empresas.',
    detail: 'No se ejecutará ninguna generación ni se consumirán créditos. Elige otro país.',
  },
  industry_not_selected: {
    title: 'Falta la industria de la búsqueda.',
    detail:
      'No se ejecutará ninguna generación ni se consumirán créditos. Vuelve a elegir la industria.',
  },
};

type DiscoveryUnavailableNoticeProps = {
  reason: WizardDiscoveryUnavailableReason;
};

function DiscoveryUnavailableNotice({ reason }: DiscoveryUnavailableNoticeProps) {
  const copy = DISCOVERY_UNAVAILABLE_COPY[reason];
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10"
      role="alert"
      data-testid="wizard-discovery-unavailable-notice"
    >
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">{copy.title}</p>
        <p className="text-xs text-amber-600/80 dark:text-amber-400/70">{copy.detail}</p>
      </div>
    </div>
  );
}


// ── Blocked panel ─────────────────────────────────────────────────────────────

type BlockedPanelProps = {
  state: ProspectWizardState;
  dispatch: React.Dispatch<ProspectWizardAction>;
};

function BlockedPanel({ state, dispatch }: BlockedPanelProps) {
  return (
    <div className="space-y-3 animate-su-fade-in" role="alert">
      <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3.5">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-destructive">
            La búsqueda tiene problemas que deben corregirse.
          </p>
          <p className="text-xs text-destructive/80">
            Revisa los errores y edita los campos indicados.
          </p>
        </div>
      </div>

      {state.blockingIssues.map((issue) => (
        <div
          key={issue.code}
          className="flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5"
        >
          <p className="text-xs text-destructive leading-relaxed">{issue.message}</p>
          {issue.recoverable && issue.step !== 'summary' && issue.step !== 'blocked' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto shrink-0 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10"
              onClick={() =>
                dispatch({
                  type: 'EDIT_STEP',
                  step: issue.step as EditableWizardStep,
                })
              }
            >
              Editar
            </Button>
          )}
        </div>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full gap-1.5 text-muted-foreground"
        onClick={() => dispatch({ type: 'REQUEST_RESTART' })}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Comenzar de nuevo
      </Button>
    </div>
  );
}

// ── Multiselección de subindustrias (§ A.4) ──────────────────────────────────

/**
 * MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A.4 — la selección COMPLETA, una
 * línea por subindustria, más el contador.
 *
 * Existe porque un resumen de una sola etiqueta no permite detectar que falta una
 * subindustria antes de gastar créditos: la corrida `7d92773b` pidió dos y el lote
 * se creó con una, y ninguna pantalla lo mostraba. El contador va aparte del
 * listado a propósito: si el catálogo no puede nombrar un id, la lista se acorta
 * pero la cuenta no miente.
 */
function SubindustrySelectionRecap({
  state,
  catalog,
}: {
  state: ProspectWizardState;
  catalog: ActiveIndustryCatalog;
}) {
  const recap = React.useMemo(
    () => buildWizardSubindustrySelectionRecap(state, catalog),
    [state, catalog],
  );

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {WIZARD_SUBINDUSTRY_RECAP_LABEL}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {recap.countLabel}
        </span>
      </div>
      {recap.count === 0 ? (
        <p className="text-xs text-foreground">{WIZARD_SUBINDUSTRY_RECAP_EMPTY_LABEL}</p>
      ) : (
        <ul className="space-y-1">
          {recap.names.map((name) => (
            <li key={name} className="flex gap-1.5 text-xs text-foreground">
              <span aria-hidden>•</span>
              <span>{name}</span>
            </li>
          ))}
          {recap.unresolvedIds.map((id) => (
            <li key={id} className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <span aria-hidden>•</span>
              <span>Subindustria no reconocida en el catálogo ({id})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Summary panel ─────────────────────────────────────────────────────────────

type SummaryPanelProps = {
  state: ProspectWizardState;
  catalog: ActiveIndustryCatalog;
  dispatch: React.Dispatch<ProspectWizardAction>;
};

function SummaryPanel({ state, catalog, dispatch }: SummaryPanelProps) {
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === state.countryCode);
  const industryEntry = catalog.industries.find((i) => i.id === state.industryId);
  // AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 — catálogo v2 (macro industria): la
  // selección de subindustria NO EXISTE, así que la fila y la recapitulación de
  // abajo deben desaparecer por completo, no mostrar «Toda la industria» /
  // «Sin subindustrias seleccionadas» como si el usuario hubiera decidido no
  // acotar. v1 legacy conserva el comportamiento exacto de siempre.
  const subindustrySelectionEnabled = isSubindustrySelectionEnabled(state.catalogVersion);
  // § A.4 — el mismo recapitulador puro que la pantalla previa al gasto: orden de
  // selección conservado y ningún id descartado en silencio.
  const subsRecap = buildWizardSubindustrySelectionRecap(state, catalog);

  const countryLabel = countryEntry
    ? `${getFlagEmoji(countryEntry.code)} ${countryEntry.name}`
    : '—';
  const industryLabel = industryEntry?.name ?? '—';
  const subsLabel =
    subsRecap.count > 0
      ? `${subsRecap.names.join(', ')} · ${subsRecap.countLabel}`
      : WIZARD_SUBINDUSTRY_RECAP_EMPTY_LABEL;
  const criteriaLabel = state.additionalCriteriaRaw ?? 'Ninguno';

  const serverWarnings = state.warnings.filter((w) => w.step === 'summary');

  return (
    <div className="space-y-4 animate-su-fade-in">
      <h3 className="text-sm font-semibold text-foreground">
        Resumen de la búsqueda
      </h3>

      <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
        <SummaryRow
          label="Tipo de búsqueda"
          value="Empresas por criterios"
        />
        <SummaryRow
          label="País"
          value={countryLabel}
          onEdit={() => dispatch({ type: 'EDIT_STEP', step: 'country' })}
        />
        <SummaryRow
          label={subindustrySelectionEnabled ? 'Industria' : 'Macro Industria'}
          value={industryLabel}
          onEdit={() => dispatch({ type: 'EDIT_STEP', step: 'industry' })}
        />
        {subindustrySelectionEnabled && (
          <SummaryRow
            label={WIZARD_SUBINDUSTRY_RECAP_LABEL}
            value={subsLabel}
            onEdit={() => dispatch({ type: 'EDIT_STEP', step: 'subindustries' })}
            wrap
          />
        )}
        <SummaryRow
          label="Criterio adicional"
          value={criteriaLabel}
          onEdit={() =>
            dispatch({ type: 'EDIT_STEP', step: 'additional_criteria' })
          }
          wrap
        />
        <SummaryRow
          label="Tamaño mínimo"
          value=">200 empleados"
        />
      </div>

      {/* § A.4 — la multiselección completa, explícita y contada. Ausente por
          completo en macro mode: no hay selección de subindustria que recapitular. */}
      {subindustrySelectionEnabled && (
        <SubindustrySelectionRecap state={state} catalog={catalog} />
      )}

      <div className="rounded-lg bg-muted/40 px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Cantidad:</span> SellUp determinará cuántas empresas entregar según calidad, disponibilidad y criterios de búsqueda.
        </p>
      </div>

      {serverWarnings.map((w) => (
        <div
          key={w.code}
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-900/10 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{w.message}</span>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full gap-1.5 text-muted-foreground"
          onClick={() => dispatch({ type: 'REQUEST_RESTART' })}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Comenzar de nuevo
        </Button>
      </div>
    </div>
  );
}

// ── Summary row ───────────────────────────────────────────────────────────────

type SummaryRowProps = {
  label: string;
  value: string;
  onEdit?: () => void;
  wrap?: boolean;
};

function SummaryRow({ label, value, onEdit, wrap = false }: SummaryRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={[
            'mt-0.5 text-sm font-medium text-foreground',
            wrap ? 'break-words' : 'truncate',
          ].join(' ')}
        >
          {value}
        </p>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${label}`}
          className="flex shrink-0 items-center gap-1 self-center text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Pencil className="h-3 w-3" aria-hidden />
          Editar
        </button>
      )}
    </div>
  );
}

// ── Restart confirmation dialog ───────────────────────────────────────────────

type RestartConfirmationProps = {
  dispatch: React.Dispatch<ProspectWizardAction>;
};

export function RestartConfirmation({ dispatch }: RestartConfirmationProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar reinicio"
      className="rounded-xl border border-border bg-card p-5 shadow-md space-y-4 animate-su-scale-in"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">
          ¿Quieres comenzar de nuevo?
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Se eliminarán las selecciones actuales.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => dispatch({ type: 'CANCEL_RESTART' })}
          autoFocus
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="flex-1"
          onClick={() => dispatch({ type: 'CONFIRM_RESTART' })}
        >
          Comenzar de nuevo
        </Button>
      </div>
    </div>
  );
}
