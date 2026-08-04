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
import { buildWizardFinalRecap } from '@/modules/prospect-batches/wizard-final-summary';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import { WizardLushaFinalSearch } from './wizard-lusha-final-search';
// A1-APOLLO-QA-CONTROL-SURFACE-1 — selector administrativo por corrida (§ 2–5) y
// etapas/cierre de la modalidad de dos rondas (§ 11).
import { WizardRunProviderSelector } from './wizard-run-provider-selector';
// Paneles de la fase de ejecución (overlay, envío y éxito), extraídos a su propio
// archivo para mantener este por debajo del techo de tamaño del repo.
import { SubmittingPanel, SuccessPanel } from './wizard-execution-panels';
import type { NoNewCandidatesBreakdown } from '@/modules/prospect-batches/chat-wizard-execution/wizard-no-new-candidates-copy';
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
        onEditSearch={onEditSearch}
        onClose={onClose}
        lushaPreviewEnabled={lushaPreviewEnabled}
        lushaCriteria={lushaCriteria}
        providerOverrideCapability={providerOverrideCapability}
        apolloRunModeLimits={apolloRunModeLimits}
        requestedProvider={requestedProvider}
        onRequestedProviderChange={onRequestedProviderChange}
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
};

function ValidatedPanel({ state, catalog, dispatch, executionEnabled, onExecute, executionError, onEditSearch, onClose, lushaPreviewEnabled, lushaCriteria, providerOverrideCapability, apolloRunModeLimits, requestedProvider, onRequestedProviderChange }: ValidatedPanelProps) {
  const router = useRouter();
  // Q3F-5BB.3E — Final search step. When the collected criteria resolve to the
  // hidden Lusha provider, the final "Buscar con IA" search runs Lusha read-only
  // (explicit click only, no persistence). Otherwise the existing IA generation
  // (or the "not enabled yet" message) is preserved unchanged.
  const useLushaFinalSearch =
    lushaPreviewEnabled && lushaCriteria.provider === 'lusha' && lushaCriteria.input !== null;

  // Q3F-5BB.10C3-FIX-1 (P0-2, STRICT-ALL) — the criteria are Lusha-eligible but
  // the preview flag is off. This MUST fail closed: no Lusha search, and — the
  // whole point of the fix — no fall-through to the Agent 1 / Apollo "Generar
  // prospectos" button. We render a blocked notice and nothing that can spend.
  const isLushaBlocked = lushaCriteria.provider === 'blocked_lusha_disabled';

  // Q3F-5BB.3F — human labels (país/sector/subindustria/tamaño/criterio) resolved
  // from the wizard's own catalog for the final "Revisa tu búsqueda" recap.
  // Display only — never alters the Lusha request.
  const finalRecap = React.useMemo(
    () => buildWizardFinalRecap(state, catalog),
    [state, catalog],
  );

  if (isLushaBlocked) {
    return <LushaDisabledBlockedPanel onEditSearch={onEditSearch} dispatch={dispatch} />;
  }

  const validBody = useLushaFinalSearch
    ? 'Revisa los criterios y ejecuta la búsqueda. Nada se guarda todavía.'
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
          <p className="text-xs text-destructive">{executionError.message}</p>
        </div>
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
          onViewProspects={() => {
            router.push(PROSPECTOS_TAB_ROUTE);
            router.refresh();
            onClose();
          }}
          onGenerateAnother={() => dispatch({ type: 'CONFIRM_RESTART' })}
        />
      )}

      {/* Real IA generation — only when explicitly enabled, Lusha is not backing
          this search, and the search is not a blocked Lusha-eligible one. The
          `!isLushaBlocked` guard is redundant with the early return above but is
          kept explicit so this Apollo-capable button can never render for a
          Lusha-eligible + flag-off search (Q3F-5BB.10C3-FIX-1, STRICT-ALL). */}
      {/* A1-APOLLO-QA-CONTROL-SURFACE-1 § 2 — «Proveedor de esta corrida».
          Comparte exactamente el mismo gate que el botón de generación: si esta
          pantalla no puede ejecutar, tampoco ofrece elegir con qué. El propio
          selector se autocensura cuando la capacidad no lo permite, así que para
          un no-admin no se renderiza nada. */}
      {!useLushaFinalSearch &&
        !isLushaBlocked &&
        executionEnabled &&
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

      {!useLushaFinalSearch && !isLushaBlocked && executionEnabled && (
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

// ── Lusha-disabled blocked panel (Q3F-5BB.10C3-FIX-1, STRICT-ALL) ──────────────
// Shown when the collected criteria are Lusha-eligible but the preview flag is
// off. Fail closed: it offers only "Editar búsqueda" / "Comenzar de nuevo" — no
// generation control of any kind, so nothing here can reach a provider, spend
// Apollo credits, call Tavily, or create a batch.

type LushaDisabledBlockedPanelProps = {
  onEditSearch: () => void;
  dispatch: React.Dispatch<ProspectWizardAction>;
};

function LushaDisabledBlockedPanel({ onEditSearch, dispatch }: LushaDisabledBlockedPanelProps) {
  return (
    <div
      className="space-y-4 animate-su-fade-in"
      role="alert"
      data-testid="wizard-lusha-blocked-notice"
    >
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10">
        <AlertTriangle
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            La generación con estos criterios no está disponible por ahora.
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
            Esta búsqueda utiliza un proveedor que todavía no está habilitado. No
            se ejecutará ninguna generación ni se consumirán créditos. Ajusta los
            criterios o vuelve a intentarlo más tarde.
          </p>
        </div>
      </div>

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

// ── Summary panel ─────────────────────────────────────────────────────────────

type SummaryPanelProps = {
  state: ProspectWizardState;
  catalog: ActiveIndustryCatalog;
  dispatch: React.Dispatch<ProspectWizardAction>;
};

function SummaryPanel({ state, catalog, dispatch }: SummaryPanelProps) {
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === state.countryCode);
  const industryEntry = catalog.industries.find((i) => i.id === state.industryId);
  const selectedSubs = catalog.subindustries.filter((s) =>
    state.subindustryIds.includes(s.id),
  );

  const countryLabel = countryEntry
    ? `${getFlagEmoji(countryEntry.code)} ${countryEntry.name}`
    : '—';
  const industryLabel = industryEntry?.name ?? '—';
  const subsLabel =
    selectedSubs.length > 0
      ? selectedSubs.map((s) => s.name).join(', ')
      : 'Toda la industria';
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
          label="Industria"
          value={industryLabel}
          onEdit={() => dispatch({ type: 'EDIT_STEP', step: 'industry' })}
        />
        <SummaryRow
          label="Subindustrias"
          value={subsLabel}
          onEdit={() => dispatch({ type: 'EDIT_STEP', step: 'subindustries' })}
        />
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
