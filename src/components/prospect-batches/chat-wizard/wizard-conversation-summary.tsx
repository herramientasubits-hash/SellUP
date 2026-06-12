'use client';

import * as React from 'react';
import { CheckCircle2, Pencil, RotateCcw, X, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
import type {
  ProspectWizardState,
  ProspectWizardAction,
  EditableWizardStep,
} from '@/modules/prospect-batches/chat-wizard';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type WizardConversationSummaryProps = {
  state: ProspectWizardState;
  catalog: ActiveIndustryCatalog;
  dispatch: React.Dispatch<ProspectWizardAction>;
  onValidate: () => void;
  onClose: () => void;
};

// ── Main component ────────────────────────────────────────────────────────────

export function WizardConversationSummary({
  state,
  catalog,
  dispatch,
  onValidate,
  onClose,
}: WizardConversationSummaryProps) {
  if (state.currentStep === 'validating') {
    return <ValidatingPanel />;
  }

  if (state.currentStep === 'validated') {
    return (
      <ValidatedPanel
        dispatch={dispatch}
        onClose={onClose}
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

  // Default: summary step
  return (
    <SummaryPanel
      state={state}
      catalog={catalog}
      dispatch={dispatch}
      onValidate={onValidate}
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
      <p className="text-sm text-foreground">Estamos revisando la configuración…</p>
    </div>
  );
}

// ── Validated panel ───────────────────────────────────────────────────────────

type ValidatedPanelProps = {
  dispatch: React.Dispatch<ProspectWizardAction>;
  onClose: () => void;
};

function ValidatedPanel({ dispatch, onClose }: ValidatedPanelProps) {
  return (
    <div className="space-y-4 animate-su-fade-in" role="status">
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
            La generación real todavía no fue iniciada.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={() => dispatch({ type: 'GO_BACK' })}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Editar búsqueda
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex-1 gap-1.5 text-muted-foreground"
          onClick={() => dispatch({ type: 'REQUEST_RESTART' })}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Comenzar de nuevo
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="flex-1 gap-1.5 text-muted-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Cerrar
        </Button>
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
  onValidate: () => void;
};

function SummaryPanel({ state, catalog, dispatch, onValidate }: SummaryPanelProps) {
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
  const countLabel = state.requestedCount != null ? String(state.requestedCount) : '—';

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
        <SummaryRow
          label="Cantidad"
          value={`${countLabel} empresas`}
          onEdit={() => dispatch({ type: 'EDIT_STEP', step: 'requested_count' })}
        />
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
          className="w-full gap-2"
          onClick={onValidate}
        >
          Validar búsqueda
        </Button>
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
