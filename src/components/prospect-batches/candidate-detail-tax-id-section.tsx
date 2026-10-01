'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Hash, Info, RefreshCw } from '@/icons';
import type { TaxIdentifierLookupMetadata } from '@/server/prospect-batches/tax-identifier-lookup';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/feedback/spinner';
import { CollapsibleDrawerSection } from '@/components/shared/collapsible-drawer-section';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InfoHint } from '@/components/shared/info-hint';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';
import { getTaxIdLabel } from './candidate-detail-helpers';
import { CopyButton } from './candidate-detail-parts';

interface TaxIdConfirmData {
  taxIdentifier: string;
  sourceName: string;
  sourceUrl: string | null;
  legalName?: string | null;
  confidence?: string;
}

/**
 * Estado y llamadas de la búsqueda y aprobación del identificador fiscal. Vive
 * en el panel (no en la sección) para que sobreviva al cambio de pestaña.
 */
export function useCandidateTaxIdLookup(
  candidate: ProspectCandidateWithReviewer | null,
  onCandidateUpdated?: (updated: ProspectCandidateWithReviewer) => void,
) {
  const router = useRouter();

  const [isLookingUpTaxId, setIsLookingUpTaxId] = React.useState(false);
  const [taxIdLookupError, setTaxIdLookupError] = React.useState<string | null>(null);
  const [taxIdLookupResult, setTaxIdLookupResult] = React.useState<TaxIdentifierLookupMetadata | null>(null);

  const [isApprovingTaxId, setIsApprovingTaxId] = React.useState(false);
  const [approveTaxIdError, setApproveTaxIdError] = React.useState<string | null>(null);

  const [confirmDialogData, setConfirmDialogData] = React.useState<TaxIdConfirmData | null>(null);

  // Rationale: resets transient UI state when the selected candidate changes.
  // Depends on a stable primitive (candidate.id); no cascading render risk.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    setIsLookingUpTaxId(false);
    setTaxIdLookupError(null);
    setTaxIdLookupResult(null);
    setIsApprovingTaxId(false);
    setApproveTaxIdError(null);
    setConfirmDialogData(null);
  }, [candidate?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleLookupTaxIdentifier = async () => {
    if (!candidate) return;
    setIsLookingUpTaxId(true);
    setTaxIdLookupError(null);
    try {
      const response = await fetch('/api/prospect-candidates/lookup-tax-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: candidate.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setTaxIdLookupError(data.message || 'Error al buscar identificador fiscal');
      } else {
        setTaxIdLookupResult(data.lookup);
        router.refresh();
      }
    } catch (err) {
      setTaxIdLookupError(err instanceof Error ? err.message : 'Error de red');
    } finally {
      setIsLookingUpTaxId(false);
    }
  };

  const handleApproveTaxIdentifier = async (
    taxIdentifier: string,
    sourceName: string,
    sourceUrl: string | null,
  ) => {
    if (!candidate) return;

    setIsApprovingTaxId(true);
    setApproveTaxIdError(null);
    try {
      const response = await fetch('/api/prospect-candidates/approve-tax-identifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          taxIdentifier,
          sourceName,
          sourceUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setApproveTaxIdError(data.error || 'Error al guardar el identificador fiscal');
      } else {
        const updated = data.candidate as ProspectCandidateWithReviewer;
        if (onCandidateUpdated) {
          onCandidateUpdated(updated);
        }
        setConfirmDialogData(null);
        router.refresh();
      }
    } catch (err) {
      setApproveTaxIdError(err instanceof Error ? err.message : 'Error de red');
    } finally {
      setIsApprovingTaxId(false);
    }
  };

  // 16TX.1: prefer in-memory state (fresh lookup), fallback to persisted metadata
  const taxIdLookup: TaxIdentifierLookupMetadata | null = candidate
    ? (taxIdLookupResult ??
      (candidate.metadata?.tax_identifier_lookup as TaxIdentifierLookupMetadata | undefined) ??
      null)
    : null;

  return {
    taxIdLookup,
    isLookingUpTaxId,
    taxIdLookupError,
    isApprovingTaxId,
    approveTaxIdError,
    confirmDialogData,
    setConfirmDialogData,
    handleLookupTaxIdentifier,
    handleApproveTaxIdentifier,
  };
}

export type CandidateTaxIdLookup = ReturnType<typeof useCandidateTaxIdLookup>;

interface CandidateTaxIdSectionProps {
  candidate: ProspectCandidateWithReviewer;
  lookup: CandidateTaxIdLookup;
  sellupDupStatus: string | undefined;
  hsDupStatus: string | undefined;
}

/** «Identificador fiscal»: el dato validado, la sugerencia por revisar o el estado de la búsqueda. */
export function CandidateTaxIdSection({
  candidate,
  lookup,
  sellupDupStatus,
  hsDupStatus,
}: CandidateTaxIdSectionProps) {
  const {
    taxIdLookup,
    isLookingUpTaxId,
    taxIdLookupError,
    approveTaxIdError,
    setConfirmDialogData,
    handleLookupTaxIdentifier,
  } = lookup;

  const hasTaxIdSuggestion = !candidate.tax_identifier && Boolean(taxIdLookup?.best_candidate);
  const taxIdSummary = candidate.tax_identifier
    ? `${candidate.tax_identifier} · validado`
    : isLookingUpTaxId || taxIdLookup?.status === 'searching'
      ? 'Buscando…'
      : hasTaxIdSuggestion
        ? 'Hay uno sugerido: revísalo antes de aprobar'
        : taxIdLookup?.status === 'failed'
          ? 'La búsqueda no se pudo completar'
          : taxIdLookup?.status === 'no_result' || taxIdLookup?.status === 'completed'
            ? 'No se encontró uno confiable'
            : 'Sin identificador todavía';

  return (
    <CollapsibleDrawerSection
      title="Identificador fiscal"
      hint="Dato legal o tributario consultado en fuentes disponibles. Debe revisarse antes de aprobarlo."
      summary={taxIdSummary}
      icon={Hash}
      tone={hasTaxIdSuggestion ? 'warning' : 'brand'}
      // Abierta cuando hay una sugerencia esperando tu decisión.
      defaultOpen={hasTaxIdSuggestion}
    >
      {candidate.tax_identifier ? (
        /* Identificador ya existente */
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="positive">
              <CheckCircle2 aria-hidden="true" />
              Identificador validado
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="min-w-0 break-all font-mono text-sm font-semibold tabular-nums text-foreground">
              {candidate.tax_identifier}
            </span>
            <CopyButton value={candidate.tax_identifier} />
          </div>
          {taxIdLookup?.selected_candidate && (
            <p className="text-xs text-muted-foreground">
              Fuente: {taxIdLookup.selected_candidate.source_name}
            </p>
          )}
        </div>
      ) : (
        /* Sin identificador — flujo automático */
        (() => {
          const isCO = candidate.country_code?.toUpperCase() === 'CO';
          const lookupStatus = taxIdLookup?.status;
          const hasBestCandidate = !!taxIdLookup?.best_candidate;
          const isDuplicateConfirmed =
            candidate.duplicate_status === 'exact_duplicate' ||
            sellupDupStatus === 'duplicate' ||
            hsDupStatus === 'match';

          /* En búsqueda activa */
          if (isLookingUpTaxId || lookupStatus === 'searching') {
            return (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner size="sm" tone="primary" label="Buscando identificador fiscal…" />
                <span>Buscando identificador fiscal…</span>
                <InfoHint label="Más información">
                  SellUp está consultando fuentes disponibles para encontrar el identificador fiscal.
                </InfoHint>
              </div>
            );
          }

          /* Sugerencia encontrada */
          if (hasBestCandidate && taxIdLookup?.best_candidate) {
            return (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="warning">
                    <AlertTriangle aria-hidden="true" />
                    {`${getTaxIdLabel(candidate.country_code)} sugerido — requiere revisión`}
                  </Badge>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-semibold text-primary">
                        {`${getTaxIdLabel(candidate.country_code)} sugerido`}
                      </p>
                      <p className="break-all font-mono text-sm font-bold tabular-nums text-foreground">
                        {taxIdLookup.best_candidate.tax_identifier}
                      </p>
                      {taxIdLookup.best_candidate.legal_name && (
                        <p className="text-xs text-muted-foreground">
                          Razón social: {taxIdLookup.best_candidate.legal_name}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={taxIdLookup.best_candidate.confidence === 'high' ? 'positive' : 'warning'}
                      className="shrink-0"
                    >
                      {taxIdLookup.best_candidate.confidence === 'high'
                        ? 'Alta confianza'
                        : 'Confianza media'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2.5">
                    <div className="min-w-0 text-xs text-muted-foreground leading-relaxed">
                      <span>Fuente: {taxIdLookup.best_candidate.source_name}</span>
                      {taxIdLookup.best_candidate.source_url && (
                        <a
                          href={taxIdLookup.best_candidate.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-1 inline-flex items-center gap-0.5 rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                        >
                          (Ver fuente)
                        </a>
                      )}
                    </div>
                    <Button
                      onClick={() =>
                        setConfirmDialogData({
                          taxIdentifier: taxIdLookup.best_candidate!.tax_identifier,
                          sourceName: taxIdLookup.best_candidate!.source_name,
                          sourceUrl: taxIdLookup.best_candidate!.source_url,
                          legalName: taxIdLookup.best_candidate!.legal_name,
                          confidence: taxIdLookup.best_candidate!.confidence,
                        })
                      }
                      size="xs"
                      type="button"
                    >
                      Usar este {getTaxIdLabel(candidate.country_code)}
                    </Button>
                  </div>
                </div>
                {approveTaxIdError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs leading-relaxed text-current">
                      {approveTaxIdError}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            );
          }

          /* Error en búsqueda */
          if (lookupStatus === 'failed') {
            return (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">No fue posible completar la búsqueda.</p>
                {!isDuplicateConfirmed && isCO && (
                  <Button
                    onClick={handleLookupTaxIdentifier}
                    variant="outline"
                    size="sm"
                    type="button"
                    aria-label="Reintentar búsqueda de identificador fiscal"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Reintentar búsqueda
                  </Button>
                )}
                {taxIdLookupError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs leading-relaxed text-current">
                      {taxIdLookupError}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            );
          }

          /* Sin resultado */
          if (lookupStatus === 'no_result' || (lookupStatus === 'completed' && !hasBestCandidate)) {
            const skipReasonLabels: Record<string, string> = {
              no_high_confidence_candidate: 'Sin candidato con confianza suficiente.',
              nit_check_digit_invalid: 'Dígito de verificación incorrecto en los candidatos encontrados.',
              name_match_too_weak: 'La coincidencia de nombre es demasiado débil.',
              critical_risk_present: 'Riesgos críticos detectados en los candidatos.',
              no_candidates: 'No se encontraron candidatos.',
            };
            const skipReason = taxIdLookup?.best_candidate_skip_reason
              ? skipReasonLabels[taxIdLookup.best_candidate_skip_reason] ||
                taxIdLookup.best_candidate_skip_reason
              : null;
            return (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  No encontramos un identificador fiscal confiable.
                  {skipReason && <span className="italic text-muted-foreground"> Motivo: {skipReason}</span>}
                </p>
                {!isDuplicateConfirmed && isCO && (
                  <Button
                    onClick={handleLookupTaxIdentifier}
                    variant="outline"
                    size="sm"
                    type="button"
                    aria-label="Reintentar búsqueda de identificador fiscal"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Reintentar búsqueda
                  </Button>
                )}
                {taxIdLookupError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs leading-relaxed text-current">
                      {taxIdLookupError}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            );
          }

          /* País no soportado */
          if (!isCO) {
            return (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground italic">
                  La búsqueda automática todavía no está disponible para este país.
                </p>
              </div>
            );
          }

          /* Estado inicial / pendiente para CO */
          return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
              <span>Identificador fiscal pendiente de búsqueda automática.</span>
            </div>
          );
        })()
      )}
    </CollapsibleDrawerSection>
  );
}

interface CandidateTaxIdConfirmDialogProps {
  candidate: ProspectCandidateWithReviewer;
  lookup: CandidateTaxIdLookup;
}

/** Confirmación antes de guardar el identificador fiscal sugerido. */
export function CandidateTaxIdConfirmDialog({ candidate, lookup }: CandidateTaxIdConfirmDialogProps) {
  const {
    confirmDialogData,
    setConfirmDialogData,
    isApprovingTaxId,
    approveTaxIdError,
    handleApproveTaxIdentifier,
  } = lookup;

  return (
    <ConfirmDialog
      open={!!confirmDialogData}
      onOpenChange={(open) => {
        if (!open) setConfirmDialogData(null);
      }}
      icon={Hash}
      title="Confirmar identificador fiscal"
      description={
        <span>
          ¿Estás seguro de que deseas aprobar{' '}
          <span className="font-mono text-foreground font-medium">{confirmDialogData?.taxIdentifier}</span>{' '}
          como el identificador fiscal oficial de este candidato?
        </span>
      }
      confirmLabel={isApprovingTaxId ? 'Guardando…' : `Guardar ${getTaxIdLabel(candidate.country_code)}`}
      loading={isApprovingTaxId}
      onConfirm={() => {
        if (confirmDialogData) {
          void handleApproveTaxIdentifier(
            confirmDialogData.taxIdentifier,
            confirmDialogData.sourceName,
            confirmDialogData.sourceUrl,
          );
        }
      }}
      className="sm:max-w-md"
    >
      <>
        <dl className="divide-y divide-border/50 text-sm">
          {confirmDialogData?.legalName && (
            <div className="flex items-start justify-between gap-3 py-2 first:pt-0">
              <dt className="shrink-0 text-xs text-muted-foreground">Razón social:</dt>
              <dd className="min-w-0 break-words text-right font-medium text-foreground">
                {confirmDialogData.legalName}
              </dd>
            </div>
          )}
          <div className="flex items-start justify-between gap-3 py-2 first:pt-0">
            <dt className="shrink-0 text-xs text-muted-foreground">Fuente:</dt>
            <dd className="min-w-0 break-words text-right text-foreground">
              {confirmDialogData?.sourceName}
            </dd>
          </div>
          {confirmDialogData?.confidence && (
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="shrink-0 text-xs text-muted-foreground">Confianza:</dt>
              <dd
                className={`font-semibold capitalize ${
                  confirmDialogData.confidence === 'high' ? 'text-success' : 'text-warning'
                }`}
              >
                {confirmDialogData.confidence === 'high' ? 'Alta' : 'Media'}
              </dd>
            </div>
          )}
        </dl>
        <Alert variant="warning">
          <AlertDescription className="text-xs leading-relaxed text-current">
            El identificador se guardará localmente en SellUp. No se sincronizará con HubSpot en este momento.
          </AlertDescription>
        </Alert>
        {approveTaxIdError && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs leading-relaxed text-current">
              {approveTaxIdError}
            </AlertDescription>
          </Alert>
        )}
      </>
    </ConfirmDialog>
  );
}
