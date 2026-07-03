'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Users,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DrawerShell } from '@/components/shared/drawer-shell';
import {
  checkBulkEnrichmentEligibilityAction,
  createBulkContactEnrichmentRunAction,
} from '@/modules/contact-enrichment/actions';
import type {
  BulkEnrichmentEligibilityResult,
  BulkEnrichmentSkipReason,
} from '@/modules/contact-enrichment/bulk-enrichment-types';
import { CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS } from '@/modules/contact-enrichment/bulk-enrichment-types';

// ── Types ──────────────────────────────────────────────────────

type SelectedAccount = {
  id: string;
  name: string | null;
  domain?: string | null;
  country_code?: string | null;
};

type DrawerState =
  | 'checking_eligibility'
  | 'ready_to_confirm'
  | 'creating_bulk_run'
  | 'executing'
  | 'completed'
  | 'completed_with_errors'
  | 'error';

type BulkRunSummary = {
  processed: number;
  with_candidates: number;
  without_candidates: number;
  failed: number;
  candidates_created: number;
};

export type BulkContactEnrichmentDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedAccounts: SelectedAccount[];
  onCompleted?: () => void;
};

// ── Skip reason labels ─────────────────────────────────────────

const SKIP_REASON_LABELS: Record<BulkEnrichmentSkipReason, string> = {
  account_archived: 'Cuenta archivada',
  missing_country_code: 'Falta país de la cuenta',
  insufficient_company_data: 'Faltan datos mínimos de empresa',
  enrichment_in_progress: 'Ya tiene un enriquecimiento en proceso',
  already_ready_for_review: 'Ya tiene candidatos listos para revisar',
  pending_candidates_exist: 'Ya tiene candidatos pendientes de revisión',
};

// ── Main component ─────────────────────────────────────────────

export function BulkContactEnrichmentDrawer({
  open,
  onOpenChange,
  selectedAccounts,
  onCompleted,
}: BulkContactEnrichmentDrawerProps) {
  const router = useRouter();
  const [state, setState] = React.useState<DrawerState>('checking_eligibility');
  const [eligibility, setEligibility] = React.useState<BulkEnrichmentEligibilityResult | null>(null);
  const [eligibilityError, setEligibilityError] = React.useState<string | null>(null);
  const [executionError, setExecutionError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<BulkRunSummary | null>(null);

  const accountIds = React.useMemo(
    () => selectedAccounts.map((a) => a.id),
    [selectedAccounts],
  );

  const tooManyAccounts = selectedAccounts.length > CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS;

  // Check eligibility when drawer opens
  React.useEffect(() => {
    if (!open) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('checking_eligibility');
    setEligibility(null);
    setEligibilityError(null);
    setExecutionError(null);
    setSummary(null);

    if (tooManyAccounts) return;

    checkBulkEnrichmentEligibilityAction(accountIds).then((res) => {
      if (res.success && res.data) {
        setEligibility(res.data);
        setState('ready_to_confirm');
      } else {
        setEligibilityError(res.error ?? 'Error verificando elegibilidad');
        setState('error');
      }
    });
  }, [open, accountIds, tooManyAccounts]);

  const handleConfirm = React.useCallback(async () => {
    setState('creating_bulk_run');

    const createRes = await createBulkContactEnrichmentRunAction(accountIds);

    if (!createRes.success || !createRes.executeUrl) {
      setExecutionError(
        createRes.error ?? 'No pudimos iniciar el enriquecimiento en lote. Intenta nuevamente.',
      );
      setState('error');
      return;
    }

    setState('executing');

    try {
      const execRes = await fetch(createRes.executeUrl, { method: 'POST' });
      const execBody = await execRes.json().catch(() => ({}));

      // HTTP-level error (auth, server crash, etc.) — not a business-logic failure
      if (!execRes.ok) {
        const msg =
          (execBody as Record<string, unknown>)?.error as string | undefined;
        setExecutionError(
          msg ?? 'No pudimos ejecutar el enriquecimiento en lote. Intenta nuevamente.',
        );
        setState('error');
        return;
      }

      const { status, summary: runSummary } = normalizeBulkExecutionSummary(execBody);

      setSummary(runSummary);
      router.refresh();
      onCompleted?.();

      if (status === 'failed') {
        setExecutionError('No se pudo completar el enriquecimiento en lote.');
        setState('error');
      } else if (status === 'completed_with_errors') {
        setState('completed_with_errors');
      } else {
        setState('completed');
      }
    } catch {
      setExecutionError(
        'No pudimos ejecutar el enriquecimiento en lote. Intenta nuevamente.',
      );
      setState('error');
    }
  }, [accountIds, router, onCompleted]);

  const isLoading =
    state === 'checking_eligibility' ||
    state === 'creating_bulk_run' ||
    state === 'executing';

  const isDone = state === 'completed' || state === 'completed_with_errors';

  const noEligible = !tooManyAccounts && eligibility && eligibility.eligible.length === 0;
  const canConfirm =
    !isLoading &&
    state !== 'error' &&
    !noEligible &&
    !tooManyAccounts &&
    !isDone;

  const footer = (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      {isDone ? (
        <>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onOpenChange(false);
              router.push('/contacts?tab=candidates');
            }}
          >
            <Users className="h-4 w-4" />
            Ver candidatos para revisar
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!canConfirm}>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar enriquecimiento del lote
          </Button>
        </>
      )}
    </div>
  );

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => {
        if (isLoading) return;
        onOpenChange(v);
      }}
      side="right"
      size="lg"
      title="Enriquecer contactos en lote"
      description={`Prepara runs de enriquecimiento para ${selectedAccounts.length} cuenta${selectedAccounts.length !== 1 ? 's' : ''} seleccionada${selectedAccounts.length !== 1 ? 's' : ''}.`}
      footer={footer}
    >
      <div className="space-y-5 px-1">
        {/* Conversational intro */}
        <p className="text-sm text-muted-foreground">
          Voy a revisar cuáles de estas cuentas pueden enriquecerse antes de consumir
          créditos Apollo.
        </p>

        {/* Too many accounts guard */}
        {tooManyAccounts && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            Selecciona máximo {CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS} cuentas para
            enriquecer contactos en lote.
          </div>
        )}

        {/* Account cards */}
        {!tooManyAccounts && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">
              Cuentas seleccionadas ({selectedAccounts.length})
            </p>
            <ul className="space-y-2">
              {selectedAccounts.map((account) => {
                const eligible = eligibility?.eligible.find(
                  (e) => e.accountId === account.id,
                );
                const skipped = eligibility?.skipped.find(
                  (s) => s.accountId === account.id,
                );

                return (
                  <li
                    key={account.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <div className="mt-0.5 rounded-md bg-muted p-1">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {account.name ?? account.id}
                      </p>
                      {account.domain && (
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {account.domain}
                        </p>
                      )}
                      {account.country_code && (
                        <p className="text-xs text-muted-foreground">
                          {account.country_code}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 mt-0.5">
                      {state === 'checking_eligibility' && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
                      )}
                      {eligible && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Elegible
                        </span>
                      )}
                      {skipped && (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            <XCircle className="h-3 w-3" />
                            Omitida
                          </span>
                          <p className="mt-0.5 text-[10px] text-muted-foreground max-w-[140px] text-right">
                            {SKIP_REASON_LABELS[skipped.reason] ?? skipped.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Summary stats */}
        {!tooManyAccounts && eligibility && (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              <StatCard label="Seleccionadas" value={eligibility.selectedCount} />
              <StatCard
                label="Elegibles"
                value={eligibility.eligible.length}
                variant="success"
              />
              <StatCard
                label="Omitidas"
                value={eligibility.skipped.length}
                variant={eligibility.skipped.length > 0 ? 'warn' : 'default'}
              />
            </div>

            {eligibility.estimatedApolloCredits > 0 && (
              <div className="space-y-1 text-center">
                <p className="text-xs text-muted-foreground">
                  Cuentas elegibles para búsqueda Apollo:{' '}
                  <span className="font-medium text-foreground">
                    {eligibility.estimatedApolloCredits}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Apollo puede consumir créditos adicionales según búsqueda y completions.
                  No se revelarán teléfonos automáticamente.
                </p>
              </div>
            )}

            {noEligible && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                No hay cuentas elegibles para enriquecer en este lote.
              </div>
            )}
          </>
        )}

        {/* Loading states */}
        {!tooManyAccounts && (state === 'creating_bulk_run' || state === 'executing') && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {state === 'creating_bulk_run'
              ? 'Preparando enriquecimiento en lote…'
              : 'Ejecutando enriquecimiento…'}
          </div>
        )}

        {/* Disclaimer */}
        {!tooManyAccounts && state !== 'error' && !isDone && (
          <div className="rounded-md bg-muted/60 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              Este proceso{' '}
              <strong className="text-foreground">no crea contactos oficiales</strong> ni
              escribe en HubSpot. Los resultados quedarán como{' '}
              <strong className="text-foreground">
                candidatos pendientes de revisión
              </strong>
              .
            </p>
          </div>
        )}

        {/* Completed summary */}
        {isDone && summary && (
          <>
            <Separator />
            <div className="space-y-2">
              {state === 'completed_with_errors' ? (
                <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  El lote terminó con algunos errores. Revisa el resumen.
                </div>
              ) : summary.candidates_created > 0 ? (
                <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Listo. Se crearon {summary.candidates_created} candidato
                  {summary.candidates_created !== 1 ? 's' : ''} para revisión.
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  El lote terminó sin candidatos nuevos para revisar.
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                <SummaryRow label="Cuentas procesadas" value={summary.processed} />
                <SummaryRow label="Con candidatos" value={summary.with_candidates} />
                <SummaryRow
                  label="Sin candidatos"
                  value={summary.without_candidates}
                />
                <SummaryRow label="Fallidas" value={summary.failed} />
                <SummaryRow
                  label="Candidatos creados"
                  value={summary.candidates_created}
                />
              </dl>
            </div>
          </>
        )}

        {/* Error state */}
        {state === 'error' && (eligibilityError ?? executionError) && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {eligibilityError ?? executionError}
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

// ── Normalizer ─────────────────────────────────────────────────

export function normalizeBulkExecutionSummary(body: unknown): {
  status: string;
  summary: BulkRunSummary;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = ((b.summary ?? {}) as Record<string, unknown>);

  const status =
    typeof b.status === 'string' ? b.status : 'completed';

  return {
    status,
    summary: {
      processed:
        (b.totalProcessed as number | undefined) ??
        (s.total_processed as number | undefined) ??
        0,
      with_candidates:
        (b.totalSucceeded as number | undefined) ??
        (s.accounts_with_candidates as number | undefined) ??
        0,
      without_candidates:
        (s.accounts_without_candidates as number | undefined) ?? 0,
      failed:
        (b.totalFailed as number | undefined) ??
        (s.accounts_failed as number | undefined) ??
        0,
      candidates_created:
        (b.totalCandidatesCreated as number | undefined) ??
        (s.total_candidates_created as number | undefined) ??
        0,
    },
  };
}

// ── Small helpers ──────────────────────────────────────────────

function StatCard({
  label,
  value,
  variant = 'default',
}: {
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'warn';
}) {
  const valueClass =
    variant === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : variant === 'warn' && value > 0
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-foreground';

  return (
    <div className="rounded-lg bg-muted/40 px-2 py-2.5 text-center">
      <p className={`text-lg font-semibold ${valueClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </>
  );
}
