'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  checkBulkEnrichmentEligibilityAction,
  createBulkContactEnrichmentRunAction,
} from '@/modules/contact-enrichment/actions';
import type { BulkEnrichmentEligibilityResult, BulkEnrichmentSkipReason } from '@/modules/contact-enrichment/bulk-enrichment-types';
import { CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS } from '@/modules/contact-enrichment/bulk-enrichment-types';

// ── Types ──────────────────────────────────────────────────────

type SelectedAccount = {
  id: string;
  name: string | null;
  domain?: string | null;
  country_code?: string | null;
};

type DialogState =
  | 'checking_eligibility'
  | 'ready_to_confirm'
  | 'creating_bulk_run'
  | 'executing'
  | 'completed'
  | 'error';

type BulkRunSummary = {
  processed: number;
  with_candidates: number;
  without_candidates: number;
  failed: number;
  candidates_created: number;
};

export type BulkContactEnrichmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedAccounts: SelectedAccount[];
  onCompleted?: () => void;
};

// ── Skip reason labels ─────────────────────────────────────────

const SKIP_REASON_LABELS: Record<BulkEnrichmentSkipReason, string> = {
  missing_country_code: 'Falta país de la cuenta',
  insufficient_company_data: 'Faltan datos mínimos de empresa',
  enrichment_in_progress: 'Ya tiene un enriquecimiento en proceso',
  already_ready_for_review: 'Ya tiene candidatos listos para revisar',
  pending_candidates_exist: 'Ya tiene candidatos pendientes de revisión',
};

// ── Main component ─────────────────────────────────────────────

export function BulkContactEnrichmentDialog({
  open,
  onOpenChange,
  selectedAccounts,
  onCompleted,
}: BulkContactEnrichmentDialogProps) {
  const router = useRouter();
  const [state, setState] = React.useState<DialogState>('checking_eligibility');
  const [eligibility, setEligibility] = React.useState<BulkEnrichmentEligibilityResult | null>(null);
  const [eligibilityError, setEligibilityError] = React.useState<string | null>(null);
  const [executionError, setExecutionError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<BulkRunSummary | null>(null);

  const accountIds = React.useMemo(
    () => selectedAccounts.map((a) => a.id),
    [selectedAccounts],
  );

  // Check eligibility when dialog opens
  React.useEffect(() => {
    if (!open) return;

    // Reset dialog state when it opens — standard pattern for controlled dialogs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState('checking_eligibility');
    setEligibility(null);
    setEligibilityError(null);
    setExecutionError(null);
    setSummary(null);

    checkBulkEnrichmentEligibilityAction(accountIds).then((res) => {
      if (res.success && res.data) {
        setEligibility(res.data);
        setState('ready_to_confirm');
      } else {
        setEligibilityError(res.error ?? 'Error verificando elegibilidad');
        setState('error');
      }
    });
  }, [open, accountIds]);

  const handleConfirm = React.useCallback(async () => {
    setState('creating_bulk_run');

    const createRes = await createBulkContactEnrichmentRunAction(accountIds);

    if (!createRes.success || !createRes.executeUrl) {
      setExecutionError(createRes.error ?? 'No pudimos iniciar el enriquecimiento en lote. Intenta nuevamente.');
      setState('error');
      return;
    }

    setState('executing');

    try {
      const execRes = await fetch(createRes.executeUrl, { method: 'POST' });
      const execBody = await execRes.json().catch(() => ({}));

      const runSummary: BulkRunSummary = {
        processed: execBody?.totalProcessed ?? execBody?.summary?.total_processed ?? createRes.eligibility?.eligible.length ?? 0,
        with_candidates: execBody?.summary?.accounts_with_candidates ?? 0,
        without_candidates: execBody?.summary?.accounts_without_candidates ?? 0,
        failed: execBody?.totalFailed ?? execBody?.summary?.accounts_failed ?? 0,
        candidates_created: execBody?.totalCandidatesCreated ?? execBody?.summary?.total_candidates_created ?? 0,
      };

      setSummary(runSummary);
      setState('completed');
      router.refresh();
      onCompleted?.();
    } catch {
      setExecutionError('El lote terminó con errores. Revisa el resumen para ver qué cuentas se procesaron.');
      setState('error');
    }
  }, [accountIds, router, onCompleted]);

  const handleClose = React.useCallback(() => {
    if (state === 'creating_bulk_run' || state === 'executing') return;
    onOpenChange(false);
  }, [state, onOpenChange]);

  const isLoading = state === 'checking_eligibility' || state === 'creating_bulk_run' || state === 'executing';
  const tooManyAccounts = selectedAccounts.length > CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS;
  const noEligible = !tooManyAccounts && eligibility && eligibility.eligible.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enriquecer contactos en lote</DialogTitle>
          <DialogDescription>
            SellUp buscará contactos potenciales para las cuentas elegibles. Los resultados
            quedarán como candidatos pendientes de revisión.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Too many accounts guard */}
          {tooManyAccounts && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              Selecciona máximo {CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS} cuentas para enriquecer contactos en lote.
            </div>
          )}

          {/* Loading state */}
          {!tooManyAccounts && state === 'checking_eligibility' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando elegibilidad…
            </div>
          )}

          {/* Creating / executing states */}
          {!tooManyAccounts && (state === 'creating_bulk_run' || state === 'executing') && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {state === 'creating_bulk_run'
                ? 'Preparando enriquecimiento en lote…'
                : 'Ejecutando enriquecimiento…'}
            </div>
          )}

          {/* Eligibility result */}
          {(state === 'ready_to_confirm' || state === 'completed') && eligibility && (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <Stat label="Seleccionadas" value={eligibility.selectedCount} />
                <Stat label="Elegibles" value={eligibility.eligible.length} variant="success" />
                <Stat label="Omitidas" value={eligibility.skipped.length} variant={eligibility.skipped.length > 0 ? 'warn' : 'default'} />
              </div>

              {eligibility.estimatedApolloCredits > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Créditos Apollo estimados: <span className="font-medium text-foreground">{eligibility.estimatedApolloCredits}</span>
                </p>
              )}

              {eligibility.eligible.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Cuentas elegibles</p>
                  <ul className="space-y-1 max-h-28 overflow-y-auto">
                    {eligibility.eligible.map((a) => (
                      <li key={a.accountId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                        <span className="truncate">{a.name || a.accountId}</span>
                        {a.domain && <span className="text-muted-foreground/60 truncate">({a.domain})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {eligibility.skipped.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Cuentas omitidas</p>
                  <ul className="space-y-1 max-h-24 overflow-y-auto">
                    {eligibility.skipped.map((a) => (
                      <li key={a.accountId} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <XCircle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                        <span>
                          <span className="text-foreground">{a.name ?? a.accountId}</span>
                          {' — '}
                          {SKIP_REASON_LABELS[a.reason] ?? a.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {noEligible && (
                <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  No hay cuentas elegibles para enriquecer en este lote.
                </div>
              )}

              <Separator />

              <div className="rounded-md bg-muted/60 px-3 py-2 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Este proceso <strong className="text-foreground">no crea contactos oficiales</strong> ni
                  escribe en HubSpot. Los resultados quedarán como{' '}
                  <strong className="text-foreground">candidatos pendientes de revisión</strong>.
                </p>
              </div>
            </>
          )}

          {/* Completed summary */}
          {state === 'completed' && summary && (
            <>
              <Separator />
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Bulk finalizado
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                  <SummaryRow label="Cuentas procesadas" value={summary.processed} />
                  <SummaryRow label="Con candidatos" value={summary.with_candidates} />
                  <SummaryRow label="Sin candidatos" value={summary.without_candidates} />
                  <SummaryRow label="Fallidas" value={summary.failed} />
                  <SummaryRow label="Candidatos creados" value={summary.candidates_created} />
                </dl>
              </div>
            </>
          )}

          {/* Error states */}
          {state === 'error' && (eligibilityError || executionError) && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {eligibilityError ?? executionError}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {state === 'completed' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
              <Button size="sm" onClick={() => { onOpenChange(false); router.push('/contacts?tab=candidates'); }}>
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
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={isLoading || state === 'error' || !!noEligible || tooManyAccounts}
              >
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirmar enriquecimiento
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Small helpers ──────────────────────────────────────────────

function Stat({
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
    <div className="rounded-md bg-muted/40 px-2 py-2">
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
