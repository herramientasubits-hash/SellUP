'use client';

/**
 * Wizard final search step — persist Lusha results as pending review (Q3F-5BB.4)
 *
 * Rendered at the END of the CONVERSATIONAL "Generar con IA" wizard, only when
 * the collected criteria resolve to Lusha (see `resolveWizardLushaCriteria`).
 *
 * On the explicit "Buscar con IA" click this runs Lusha ONCE and PERSISTS the
 * results as a pending-review prospect batch + candidates (the drawer is NOT a
 * results list — the review happens in Prospectos). Safety:
 *   - NO auto-run: persistence fires only from the button onClick (no effects).
 *   - Lusha runs through the read-only preview core → page 0 / size 10 / ≤1
 *     credit guardrails are server-authoritative.
 *   - DB writes are limited to batch + candidates (server action). No accounts,
 *     no HubSpot, no enrichment.
 *   - Lusha is HIDDEN: it surfaces only as traceability ("Fuente usada: Lusha").
 * Criteria are locked (already collected conversationally) and shown as a recap.
 */

import * as React from 'react';
import {
  Search,
  Loader2,
  CheckCircle2,
  Info,
  Building2,
  RotateCcw,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  LockedCriteriaRecap,
  LUSHA_PREVIEW_COST_NOTICE,
} from '@/components/prospect-batches/lusha-preview-drawer';
import {
  generateLushaPendingReviewBatchAction,
  type GenerateLushaPendingReviewBatchActionResult,
} from '@/modules/prospect-batches/lusha-pending-review-actions';
import type { WizardLushaInput } from '@/modules/prospect-batches/wizard-lusha-criteria';
import type { WizardFinalRecap } from '@/modules/prospect-batches/wizard-final-summary';

export const WIZARD_LUSHA_SEARCH_LABEL = 'Buscar con IA';
export const WIZARD_LUSHA_SEARCH_LOADING_LABEL = 'Buscando con IA…';
/** Discreet traceability shown only after persistence (never a selector). */
export const WIZARD_LUSHA_PROVIDER_LABEL = 'Lusha';

/** Injectable persist runner (tests). Default = real server action. */
export type RunLushaPendingReviewSearch = (
  input: WizardLushaInput,
) => Promise<GenerateLushaPendingReviewBatchActionResult>;

/** The step labels shown while the search + persistence runs (display only). */
export const WIZARD_LUSHA_LOADER_STEPS = [
  'Preparando la búsqueda',
  'Consultando el proveedor configurado',
  'Normalizando empresas',
  'Dejando candidatos listos para revisión',
] as const;

type PanelStatus = 'idle' | 'loading' | 'done';

export interface WizardLushaFinalSearchProps {
  /** Read-only Lusha input built from the wizard's collected criteria. */
  input: WizardLushaInput;
  /**
   * Q3F-5BB.3F — Recap enriquecido (labels humanos del wizard) para el paso
   * final "Revisa tu búsqueda". Solo presentación; no altera la request a Lusha.
   */
  recap?: WizardFinalRecap;
  /** Inyectable para tests. Por defecto usa la server action real. */
  runPersist?: RunLushaPendingReviewSearch;
  /** Ir a Prospectos (cierra el drawer y refresca la lista). */
  onViewProspects?: () => void;
  /** Reiniciar el wizard para una nueva búsqueda. */
  onGenerateAnother?: () => void;
}

export function WizardLushaFinalSearch({
  input,
  recap,
  runPersist = generateLushaPendingReviewBatchAction,
  onViewProspects,
  onGenerateAnother,
}: WizardLushaFinalSearchProps) {
  const [status, setStatus] = React.useState<PanelStatus>('idle');
  const [result, setResult] =
    React.useState<GenerateLushaPendingReviewBatchActionResult | null>(null);

  // IMPORTANTE: única vía de ejecución. Invocada solo por el onClick del botón.
  async function handleSearch() {
    if (status === 'loading') return;
    setStatus('loading');
    setResult(null);
    try {
      const res = await runPersist(input);
      setResult(res);
    } catch (err) {
      setResult({
        ok: false,
        status: 'error',
        batchId: null,
        createdCandidatesCount: 0,
        skippedCount: 0,
        creditsCharged: null,
        resultsReturned: null,
        reviewUrl: '/accounts?tab=prospectos',
        message: 'No fue posible guardar los prospectos. Intenta de nuevo.',
        error: err instanceof Error ? err.message.slice(0, 200) : 'error',
      });
    } finally {
      setStatus('done');
    }
  }

  // ── Terminal states: confirmation / empty / error (no result cards) ─────────
  if (status === 'done' && result) {
    if (result.ok && result.status === 'success') {
      return (
        <div data-testid="wizard-lusha-final-search">
          <PersistConfirmation
            result={result}
            onViewProspects={onViewProspects}
            onGenerateAnother={onGenerateAnother}
          />
        </div>
      );
    }
    if (result.ok && result.status === 'empty') {
      return (
        <div data-testid="wizard-lusha-final-search">
          <EmptyResult onGenerateAnother={onGenerateAnother} />
        </div>
      );
    }
    return (
      <div data-testid="wizard-lusha-final-search">
        <ErrorResult message={result.message} onRetry={handleSearch} />
      </div>
    );
  }

  // ── Review + search surface (idle / loading) ────────────────────────────────
  return (
    <div className="space-y-6" data-testid="wizard-lusha-final-search">
      <LockedCriteriaRecap
        countryCode={input.countryCode}
        sectorKey={input.sectorKey}
        searchText={input.searchText ?? ''}
        {...(recap ? { recap } : {})}
      />

      <div className="space-y-3">
        <Alert variant="warning">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs" data-testid="lusha-preview-cost-notice">
            {LUSHA_PREVIEW_COST_NOTICE}
          </AlertDescription>
        </Alert>

        <Button
          type="button"
          size="sm"
          className="gap-2"
          disabled={status === 'loading'}
          onClick={handleSearch}
          data-testid="lusha-preview-run"
        >
          {status === 'loading' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {WIZARD_LUSHA_SEARCH_LOADING_LABEL}
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" />
              {WIZARD_LUSHA_SEARCH_LABEL}
            </>
          )}
        </Button>
      </div>

      {status === 'loading' && <SearchLoader />}
    </div>
  );
}

// ── Rich IA loader (CSS-driven steps — no timers, no effects) ─────────────────

function SearchLoader() {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-6 animate-su-fade-in"
      role="status"
      aria-live="polite"
      aria-label="Buscando empresas candidatas"
      data-testid="wizard-lusha-search-loader"
      style={{
        background:
          'linear-gradient(135deg, var(--su-ai-stop-1), var(--su-ai-stop-2), var(--su-ai-stop-3), var(--su-ai-stop-4), var(--su-ai-stop-5))',
      }}
    >
      {/* Mirror shine sweep */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-[-12deg] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.06)_20%,rgba(255,255,255,0.35)_50%,rgba(255,255,255,0.06)_80%,transparent_100%)] animate-su-mirror-shine" />

      <div className="relative z-10 space-y-4">
        <div className="flex items-center gap-2 text-white">
          <Building2 className="h-4 w-4 animate-su-float" aria-hidden />
          <p className="text-sm font-semibold">Buscando empresas candidatas…</p>
        </div>

        <ol className="space-y-2">
          {WIZARD_LUSHA_LOADER_STEPS.map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-2 text-xs text-white/90 animate-su-fade-in"
              style={{ animationDelay: `${index * 320}ms`, animationFillMode: 'both' }}
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-white/80" aria-hidden />
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ── Confirmation (brief — the review happens in Prospectos, not here) ──────────

function PersistConfirmation({
  result,
  onViewProspects,
  onGenerateAnother,
}: {
  result: GenerateLushaPendingReviewBatchActionResult;
  onViewProspects?: () => void;
  onGenerateAnother?: () => void;
}) {
  const count = result.createdCandidatesCount;
  const credits = result.creditsCharged;
  const shortBatch = result.batchId ? result.batchId.slice(0, 8) : '—';

  return (
    <div className="space-y-4 animate-su-fade-in" data-testid="wizard-lusha-persist-confirmation">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-800/40 dark:bg-emerald-900/10">
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Empresas candidatas listas para revisión
          </p>
          <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70">
            Encontramos {count} {count === 1 ? 'empresa' : 'empresas'} y las dejamos en
            Prospectos para que las revises antes de aprobarlas.
          </p>
        </div>
      </div>

      <dl className="rounded-xl border border-border bg-card divide-y divide-border/60 text-sm">
        <DetailRow
          label="Fuente usada"
          value={WIZARD_LUSHA_PROVIDER_LABEL}
          testId="wizard-lusha-persist-provider"
        />
        <DetailRow label="Créditos consumidos" value={credits === null ? '—' : String(credits)} />
        <DetailRow label="Lote" value={shortBatch} />
      </dl>

      <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1">
        <p className="text-xs text-muted-foreground">Nada fue enviado a HubSpot.</p>
        <p className="text-xs text-muted-foreground">Ninguna empresa fue creada todavía.</p>
      </div>

      <div className="space-y-2 pt-1">
        <Button
          type="button"
          size="sm"
          className="w-full gap-1.5"
          onClick={onViewProspects}
          data-testid="wizard-lusha-view-prospects"
        >
          Ver prospectos
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <button
          type="button"
          className="mx-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={onGenerateAnother}
          data-testid="wizard-lusha-generate-another"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Generar otra búsqueda
        </button>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className="text-sm font-medium text-foreground"
        {...(testId ? { 'data-testid': testId } : {})}
      >
        {value}
      </dd>
    </div>
  );
}

// ── Empty result ──────────────────────────────────────────────────────────────

function EmptyResult({ onGenerateAnother }: { onGenerateAnother?: () => void }) {
  return (
    <div className="space-y-4 animate-su-fade-in" data-testid="wizard-lusha-empty">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800/40 dark:bg-amber-900/10">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            No encontramos empresas nuevas con estos criterios.
          </p>
          <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
            Prueba con otra industria, país o criterio adicional.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="mx-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={onGenerateAnother}
        data-testid="wizard-lusha-generate-another"
      >
        <RotateCcw className="h-3 w-3" aria-hidden />
        Generar otra búsqueda
      </button>
    </div>
  );
}

// ── Error result ──────────────────────────────────────────────────────────────

function ErrorResult({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-4 animate-su-fade-in" data-testid="wizard-lusha-error">
      <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-5 py-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-destructive">No se pudo completar la búsqueda.</p>
          <p className="text-xs text-destructive/80">{message}</p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={onRetry}
        data-testid="lusha-preview-run"
      >
        <Search className="h-3.5 w-3.5" />
        {WIZARD_LUSHA_SEARCH_LABEL}
      </Button>
    </div>
  );
}
