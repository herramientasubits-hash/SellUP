'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Users,
  CheckCircle2,
  XCircle,
  Building2,
} from "@/icons";
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SurfaceCard } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Spinner } from '@/components/feedback/spinner';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { DrawerSection } from '@/components/shared/drawer-section';
import {
  checkBulkEnrichmentEligibilityAction,
  createBulkContactEnrichmentRunAction,
  getBulkContactEnrichmentRunStatusAction,
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
  | 'checking_status'
  | 'execution_unknown'
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
  const [currentBulkRunId, setCurrentBulkRunId] = React.useState<string | null>(null);

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
    setCurrentBulkRunId(null);

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

  const applyRunStatus = React.useCallback(
    (statusRes: Awaited<ReturnType<typeof getBulkContactEnrichmentRunStatusAction>>) => {
      if (!statusRes.ok) {
        setState('execution_unknown');
        return;
      }

      const { status, totalCandidatesCreated, totalProcessed, totalSucceeded, totalFailed } =
        statusRes;

      if (status === 'completed' || status === 'completed_with_errors') {
        setSummary({
          processed: totalProcessed,
          with_candidates: totalSucceeded,
          without_candidates: Math.max(0, totalProcessed - totalSucceeded - totalFailed),
          failed: totalFailed,
          candidates_created: totalCandidatesCreated,
        });
        router.refresh();
        onCompleted?.();
        setState(status === 'completed_with_errors' ? 'completed_with_errors' : 'completed');
      } else if (status === 'failed') {
        setExecutionError('No se pudo completar el enriquecimiento en lote.');
        setState('error');
      } else {
        // running | created
        setState('execution_unknown');
      }
    },
    [router, onCompleted],
  );

  const handleRefreshStatus = React.useCallback(async () => {
    if (!currentBulkRunId) return;
    setState('checking_status');
    const statusRes = await getBulkContactEnrichmentRunStatusAction(currentBulkRunId);
    applyRunStatus(statusRes);
  }, [currentBulkRunId, applyRunStatus]);

  const handleConfirm = React.useCallback(async () => {
    setState('creating_bulk_run');

    const createRes = await createBulkContactEnrichmentRunAction(accountIds);

    if (!createRes.success || !createRes.executeUrl || !createRes.bulkRunId) {
      setExecutionError(
        createRes.error ?? 'No pudimos iniciar el enriquecimiento en lote. Intenta nuevamente.',
      );
      setState('error');
      return;
    }

    setCurrentBulkRunId(createRes.bulkRunId);
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
      // Transport/timeout — check real DB status before showing error
      setState('checking_status');
      const statusRes = await getBulkContactEnrichmentRunStatusAction(createRes.bulkRunId);
      applyRunStatus(statusRes);
    }
  }, [accountIds, router, onCompleted, applyRunStatus]);

  const isLoading =
    state === 'checking_eligibility' ||
    state === 'creating_bulk_run' ||
    state === 'executing' ||
    state === 'checking_status';

  const isDone = state === 'completed' || state === 'completed_with_errors';

  const isUnknown = state === 'execution_unknown';

  const noEligible = !tooManyAccounts && eligibility && eligibility.eligible.length === 0;
  const canConfirm =
    !isLoading &&
    state !== 'error' &&
    !noEligible &&
    !tooManyAccounts &&
    !isDone;

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
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
      ) : isUnknown ? (
        <>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button size="sm" onClick={handleRefreshStatus} disabled={!currentBulkRunId}>
            Actualizar estado
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
      icon={<Users className="h-4 w-4" />}
      actions={footer}
    >
      <div className="space-y-4">
        {/* Conversational intro */}
        <p className="text-sm text-muted-foreground">
          Voy a revisar cuáles de estas cuentas pueden enriquecerse antes de consumir
          créditos Apollo.
        </p>

        {/* Too many accounts guard */}
        {tooManyAccounts && (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">
              Selecciona máximo {CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS} cuentas para
              enriquecer contactos en lote.
            </AlertDescription>
          </Alert>
        )}

        {/* Account cards */}
        {!tooManyAccounts && (
          <DrawerSection
            icon={Building2}
            title={`Cuentas seleccionadas (${selectedAccounts.length})`}
          >
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
                    className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface-subtle px-3 py-2.5"
                  >
                    <div className="mt-0.5 rounded-md bg-card p-1 ring-1 ring-inset ring-border/40">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {account.name ?? account.id}
                      </p>
                      {account.domain && (
                        <p className="truncate font-mono text-xs text-muted-foreground" title={account.domain}>
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
                        <Spinner size="xs" label="Comprobando elegibilidad" />
                      )}
                      {eligible && (
                        <Badge variant="positive">
                          <CheckCircle2 className="h-3 w-3" />
                          Elegible
                        </Badge>
                      )}
                      {skipped && (
                        <div className="text-right">
                          <Badge variant="warning">
                            <XCircle className="h-3 w-3" />
                            Omitida
                          </Badge>
                          <p className="mt-0.5 text-xs text-muted-foreground max-w-[140px] text-right">
                            {SKIP_REASON_LABELS[skipped.reason] ?? skipped.reason}
                          </p>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </DrawerSection>
        )}

        {/* Summary stats */}
        {!tooManyAccounts && eligibility && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
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
                  <span className="font-medium tabular-nums text-foreground">
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
              <Alert variant="warning">
                <AlertDescription className="text-warning">
                  No hay cuentas elegibles para enriquecer en este lote.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {/* Loading states */}
        {!tooManyAccounts &&
          (state === 'creating_bulk_run' ||
            state === 'executing' ||
            state === 'checking_status') && (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              {/* Decorativo: el texto de al lado es el que anuncia la espera. */}
              <Spinner decorative size="sm" />
              {state === 'creating_bulk_run'
                ? 'Preparando enriquecimiento en lote…'
                : state === 'checking_status'
                  ? 'No pude confirmar la respuesta en tiempo real. Estoy consultando el estado del lote…'
                  : 'Ejecutando enriquecimiento…'}
            </div>
          )}

        {/* Unknown / in-progress state after recovery */}
        {!tooManyAccounts && state === 'execution_unknown' && (
          <Alert variant="warning">
            <AlertDescription className="text-warning">
              El lote fue iniciado, pero todavía no tenemos confirmación final. Puedes actualizar el
              estado en unos segundos.
            </AlertDescription>
          </Alert>
        )}

        {/* Disclaimer */}
        {!tooManyAccounts && state !== 'error' && !isDone && !isUnknown && (
          <Alert role="note">
            <AlertDescription className="text-xs leading-relaxed">
              Este proceso{' '}
              <strong className="text-foreground">no crea contactos oficiales</strong> ni
              escribe en HubSpot. Los resultados quedarán como{' '}
              <strong className="text-foreground">
                candidatos pendientes de revisión
              </strong>
              .
            </AlertDescription>
          </Alert>
        )}

        {/* Completed summary */}
        {isDone && summary && (
          <>
            <Separator />
            <div className="space-y-2">
              {/* El desenlace del lote, como aviso en su tono: ámbar si hubo
                  errores, verde si dejó candidatos, neutro si no dejó nada. */}
              {state === 'completed_with_errors' ? (
                <Alert variant="warning" role="status">
                  <AlertTitle className="text-sm">
                    El lote terminó con algunos errores. Revisa el resumen.
                  </AlertTitle>
                </Alert>
              ) : summary.candidates_created > 0 ? (
                <Alert variant="success" role="status">
                  <AlertTitle className="text-sm">
                    Listo. Se crearon {summary.candidates_created} candidato
                    {summary.candidates_created !== 1 ? 's' : ''} para revisión.
                  </AlertTitle>
                </Alert>
              ) : (
                <Alert role="status">
                  <AlertTitle className="text-sm">
                    El lote terminó sin candidatos nuevos para revisar.
                  </AlertTitle>
                </Alert>
              )}
              <SurfaceCard className="p-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
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
              </SurfaceCard>
            </div>
          </>
        )}

        {/* Error state */}
        {state === 'error' && (eligibilityError ?? executionError) && (
          <Alert variant="destructive">
            <AlertDescription className="text-destructive">
              {eligibilityError ?? executionError}
            </AlertDescription>
          </Alert>
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
  const tone =
    variant === 'success' ? 'positive' : variant === 'warn' && value > 0 ? 'warning' : 'neutral';

  return <MetricCard compact title={label} value={value} tone={tone} />;
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </>
  );
}
