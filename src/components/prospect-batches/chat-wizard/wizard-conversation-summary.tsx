'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Pencil, RotateCcw, AlertTriangle, XCircle, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
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

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardConversationSummaryProps = {
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
      />
    );
  }

  if (state.currentStep === 'submitting') {
    return <SubmittingPanel />;
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
};

function ValidatedPanel({ state, catalog, dispatch, executionEnabled, onExecute, executionError, onEditSearch, onClose, lushaPreviewEnabled, lushaCriteria }: ValidatedPanelProps) {
  const router = useRouter();
  // Q3F-5BB.3E — Final search step. When the collected criteria resolve to the
  // hidden Lusha provider, the final "Buscar con IA" search runs Lusha read-only
  // (explicit click only, no persistence). Otherwise the existing IA generation
  // (or the "not enabled yet" message) is preserved unchanged.
  const useLushaFinalSearch =
    lushaPreviewEnabled && lushaCriteria.provider === 'lusha' && lushaCriteria.input !== null;

  // Q3F-5BB.3F — human labels (país/sector/subindustria/tamaño/criterio) resolved
  // from the wizard's own catalog for the final "Revisa tu búsqueda" recap.
  // Display only — never alters the Lusha request.
  const finalRecap = React.useMemo(
    () => buildWizardFinalRecap(state, catalog),
    [state, catalog],
  );

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

      {/* Real IA generation — only when explicitly enabled and Lusha is not backing this search. */}
      {!useLushaFinalSearch && executionEnabled && (
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

// ── Wizard generation overlay ─────────────────────────────────────────────────

function WizardGenerationOverlay() {
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 p-8 overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="Generando empresas candidatas"
      style={{
        background:
          'linear-gradient(135deg, var(--su-ai-stop-1), var(--su-ai-stop-2), var(--su-ai-stop-3), var(--su-ai-stop-4), var(--su-ai-stop-5))',
      }}
    >
      {/* Mirror shine sweep */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-[-12deg] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.06)_20%,rgba(255,255,255,0.35)_50%,rgba(255,255,255,0.06)_80%,transparent_100%)] animate-su-mirror-shine" />

      {/* Sparkle icon */}
      <div className="animate-su-float relative z-10">
        <Sparkles className="h-12 w-12 text-white/80" strokeWidth={1.5} />
      </div>

      {/* Main label */}
      <div className="relative z-10 text-center space-y-1">
        <p className="text-lg font-bold text-white">Generando empresas candidatas</p>
        <p className="text-sm text-white/70">Procesando búsqueda con IA</p>
      </div>

      {/* Body text */}
      <p className="relative z-10 text-xs text-white/60 text-center max-w-[280px]">
        Filtrando resultados y preparando candidatos para revisión
      </p>

      {/* Indeterminate progress bar */}
      <div className="relative z-10 w-full max-w-[280px]">
        <div className="h-2 w-full rounded-full bg-white/20 overflow-hidden">
          <div className="h-full w-2/3 rounded-full bg-white/80 animate-su-pulse" />
        </div>
      </div>
    </div>
  );
}

// ── Submitting panel ──────────────────────────────────────────────────────────

function SubmittingPanel() {
  return <WizardGenerationOverlay />;
}

// ── Success panel ─────────────────────────────────────────────────────────────
// Closes the drawer and refreshes the global candidates list.
// Does NOT navigate to a batch-detail route — that view no longer exists.

type SuccessPanelProps = {
  status: 'created' | 'already_started' | 'no_new_candidates' | 'success_partial' | 'success_target_reached' | null;
  noveltyExhausted?: boolean;
  candidateCount?: number;
  targetPersistibleCandidates?: number;
  onClose: () => void;
  onEditSearch: () => void;
};

function SuccessPanel({ status, noveltyExhausted, candidateCount, targetPersistibleCandidates, onClose, onEditSearch }: SuccessPanelProps) {
  const router = useRouter();

  React.useEffect(() => {
    if (status === 'no_new_candidates') {
      // Do NOT auto-close — show the panel so the user can act.
      toast.info('No se encontraron empresas nuevas.', {
        description: 'Todos los resultados ya habían sido sugeridos recientemente.',
      });
      router.refresh();
      return;
    }
    if (status === 'already_started') {
      toast.info('Esta búsqueda ya había sido iniciada.', {
        description: 'Actualizamos el listado para mostrar los resultados disponibles.',
      });
    } else if (status === 'success_target_reached') {
      toast.success('¡Objetivo alcanzado!', {
        description: targetPersistibleCandidates
          ? `Encontramos ${targetPersistibleCandidates} prospectos nuevos para revisar.`
          : 'Prospectos generados correctamente.',
      });
    } else {
      toast.success('Prospectos generados correctamente.', {
        description: 'Ya puedes revisarlos en el listado de prospectos.',
      });
    }
    router.refresh();
    onClose();
  // onClose and router.refresh are stable references; status is captured once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'no_new_candidates') {
    const noNewBody = noveltyExhausted
      ? 'El universo de empresas disponibles con estos criterios ya fue explorado recientemente. Intenta cambiar la industria, el país o los criterios adicionales.'
      : 'La búsqueda encontró resultados, pero todos ya habían sido sugeridos recientemente o no pasaron los filtros de calidad.';

    return (
      <div className="space-y-4 animate-su-fade-in" role="status">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10">
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              No encontramos empresas nuevas con estos criterios.
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
              {noNewBody}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEditSearch} className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Editar búsqueda
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  const heading =
    status === 'already_started'
      ? 'Búsqueda ya iniciada'
      : status === 'success_target_reached'
      ? '¡Objetivo alcanzado!'
      : 'Candidatos generados';

  const body =
    status === 'already_started'
      ? 'Esta búsqueda ya había sido iniciada. Actualizamos la lista para mostrar sus resultados.'
      : status === 'success_target_reached' && targetPersistibleCandidates
      ? `Encontramos ${targetPersistibleCandidates} prospectos nuevos para revisar.`
      : candidateCount
      ? `Se generaron ${candidateCount} candidatos disponibles para revisión.`
      : 'Los candidatos fueron generados y ya están disponibles para revisión.';

  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-800/40 dark:bg-emerald-900/10 animate-su-fade-in">
      <CheckCircle2
        className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {heading}
        </p>
        <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70">
          {body}
        </p>
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
