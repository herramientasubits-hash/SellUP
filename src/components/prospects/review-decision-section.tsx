'use client';

// Q3F-5AZ.2D-1 — "Decisión de revisión" section, consolidated into the official
// Prospectos drawer (/accounts?tab=prospectos → drawer → tab Validación).
//
// This is the ONLY place the human-review approve action lives from now on; the
// standalone /prospect-batches/review queue is no longer linked in the sidebar.
// It reuses the ALREADY VALIDATED server action `approvePendingReviewCandidateAction`
// (Q3F-5AZ.2C) verbatim — no new action, no conversion, no HubSpot, no providers.
//
// Only "Aprobar" is enabled. Descartar / Marcar duplicado / Enviar a
// enriquecimiento / Mantener en revisión are rendered disabled ("Disponible en
// siguiente fase"). Confirmation is INLINE (a panel inside this section), NOT a
// modal stacked over the drawer — this deliberately avoids the overlay-stacking
// class of bugs that Q3F-5AZ.2C-HF1/HF2/HF3 chased in the AlertDialog path.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  Copy,
  Sparkles,
  Clock,
  Loader2,
  AlertTriangle,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  evaluateApproveEligibility,
  type ApproveRejectReason,
} from '@/modules/prospect-review/approve-eligibility';
import { approvePendingReviewCandidateAction } from '@/modules/prospect-review/approve-actions';

/**
 * Minimal candidate shape this section reads. Kept structural (not the full
 * `ProspectCandidate`) so it stays trivially testable and decoupled from the
 * large drawer type — any object with these fields satisfies it.
 */
export interface ReviewDecisionCandidate {
  id: string;
  name: string;
  status: string;
  recordOrigin?: string | null;
  duplicateStatus?: string | null;
  matchedHubspotCompanyId?: string | null;
  reviewedAt?: string | null;
}

interface ReviewDecisionSectionProps {
  candidate: ReviewDecisionCandidate;
}

// Friendly copy for each typed rejection reason surfaced by the approve action.
const APPROVE_ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'No tienes permisos para aprobar candidatos.',
  not_found: 'El candidato ya no está disponible. Actualiza la lista.',
  not_clean_production: 'Este candidato no pertenece a la cola de producción limpia.',
  status_conflict: 'El estado del candidato cambió. Actualiza la lista e inténtalo de nuevo.',
  duplicate_blocked: 'No se puede aprobar: la duplicidad bloquea la aprobación.',
  needs_duplicate_confirmation: 'Este candidato requiere confirmar el posible duplicado.',
  unexpected_error: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
};

// Copy explaining why Aprobar is disabled for a candidate that is in an
// actionable state but not eligible right now.
const BLOCK_COPY: Record<ApproveRejectReason, string> = {
  not_clean_production:
    'Este candidato no pertenece a la cola de producción limpia; no puede aprobarse desde aquí.',
  status_conflict: 'El estado del candidato no permite aprobación en este momento.',
  duplicate_blocked: 'La verificación de duplicidad bloquea la aprobación de este candidato.',
  needs_duplicate_confirmation: 'Requiere confirmar el posible duplicado antes de aprobar.',
};

// Terminal / non-actionable statuses render as a read-only state (no Aprobar).
const TERMINAL_STATUS: Record<
  string,
  { label: string; description: string; className: string }
> = {
  approved: {
    label: 'Aprobado',
    description:
      'Este prospecto fue aprobado como candidato válido. Aún no ha sido convertido en cuenta.',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  discarded: {
    label: 'Descartado',
    description: 'Este prospecto fue descartado y no está disponible para aprobación.',
    className: 'border-border/50 bg-muted/40 text-muted-foreground',
  },
  duplicate: {
    label: 'Marcado como duplicado',
    description: 'Este prospecto fue marcado como duplicado y no puede aprobarse.',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400',
  },
  converted_to_account: {
    label: 'Convertido en cuenta',
    description: 'Este prospecto ya fue convertido en una cuenta de SellUp.',
    className: 'border-su-brand/30 bg-su-brand-soft text-su-brand',
  },
};

// Actions not yet available in this hito — rendered disabled for context.
const DISABLED_ACTIONS = [
  { label: 'Descartar', icon: XCircle },
  { label: 'Marcar duplicado', icon: Copy },
  { label: 'Enviar a enriquecimiento', icon: Sparkles },
  { label: 'Mantener en revisión', icon: Clock },
] as const;

const SECTION_TITLE = 'Decisión de revisión';
const SECTION_DESCRIPTION =
  'Valida si este prospecto debe avanzar. Aprobar no convierte la empresa en cuenta ni la envía a HubSpot.';

function StatePill({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

export function ReviewDecisionSection({ candidate }: ReviewDecisionSectionProps) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [approving, setApproving] = React.useState(false);

  // Reset the inline confirmation whenever the drawer swaps to another candidate.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    setConfirming(false);
    setApproving(false);
  }, [candidate.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const status = candidate.status;
  const isPossibleDuplicate = candidate.duplicateStatus === 'possible_duplicate';
  const hasHubspotMatch = !!candidate.matchedHubspotCompanyId;
  const needsWarning = isPossibleDuplicate || hasHubspotMatch;

  // ── Terminal states (approved / discarded / duplicate / converted) ──────────
  const terminal = TERMINAL_STATUS[status];
  if (terminal) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader title={SECTION_TITLE} description={SECTION_DESCRIPTION} />
        <div className="mt-1 space-y-2">
          <StatePill label={terminal.label} className={terminal.className} />
          <p className="text-xs text-muted-foreground leading-relaxed">{terminal.description}</p>
          {status === 'approved' && candidate.reviewedAt && (
            <p className="text-[11px] text-muted-foreground/70">
              Aprobado el {new Date(candidate.reviewedAt).toLocaleString('es-CO')}
            </p>
          )}
        </div>
      </SurfaceCard>
    );
  }

  // ── Actionable states (needs_review / generated / normalized) ───────────────
  // Only needs_review + production can ever be approved. generated/normalized
  // must first move to review; a needs_review row outside clean production is
  // blocked by the server-side gate, so we disable the button and explain why.
  let canApprove = false;
  let blockReason: string | null = null;

  if (status === 'generated' || status === 'normalized') {
    blockReason = 'Este candidato aún debe pasar a revisión antes de aprobarse.';
  } else if (status === 'needs_review') {
    // confirmPossibleDuplicate:true so possible_duplicate resolves to `approve`
    // here — the strong warning + explicit inline confirmation gate it in the UI.
    const decision = evaluateApproveEligibility(
      {
        status,
        recordOrigin: candidate.recordOrigin ?? null,
        duplicateStatus: candidate.duplicateStatus ?? null,
      },
      { confirmPossibleDuplicate: true },
    );
    if (decision.decision === 'approve') {
      canApprove = true;
    } else if (decision.decision === 'reject') {
      blockReason = BLOCK_COPY[decision.reason];
    } else {
      // 'idempotent' — already approved; treat as non-actionable safety net.
      blockReason = 'Este candidato ya fue aprobado.';
    }
  } else {
    blockReason = 'El estado del candidato no permite aprobación en este momento.';
  }

  async function doApprove() {
    if (approving) return;
    setApproving(true);
    try {
      const result = await approvePendingReviewCandidateAction(candidate.id, {
        confirmPossibleDuplicate: isPossibleDuplicate,
      });
      if (result.ok) {
        toast.success(
          result.status === 'idempotent_success'
            ? `"${candidate.name}" ya estaba aprobado`
            : `Prospecto aprobado.`,
        );
        setConfirming(false);
        // Server components refetch: the drawer receives the updated candidate
        // and re-renders this section in its "Aprobado" state.
        router.refresh();
      } else {
        toast.error(
          APPROVE_ERROR_MESSAGES[result.reason] ?? APPROVE_ERROR_MESSAGES.unexpected_error,
        );
      }
    } catch {
      toast.error(APPROVE_ERROR_MESSAGES.unexpected_error);
    } finally {
      setApproving(false);
    }
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader title={SECTION_TITLE} description={SECTION_DESCRIPTION} />

      {/* Strong warning for possible duplicate / HubSpot coincidence. */}
      {needsWarning && (
        <div className="mt-1 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5 text-xs leading-relaxed">
            <p className="font-medium">Este prospecto tiene posible coincidencia. Revisa antes de aprobar.</p>
            {hasHubspotMatch && (
              <p className="flex items-center gap-1 text-[11px]">
                <ShieldCheck className="h-3 w-3" />
                Coincidencia con una empresa en HubSpot.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Inline confirmation — replaces the actions row while open. Never a modal
          over the drawer: Cancelar closes only this panel, runs no action, and
          leaves no overlay behind. */}
      {confirming ? (
        <div className="mt-2 rounded-xl border border-su-brand/30 bg-su-brand/5 p-3 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">¿Confirmas aprobar este prospecto?</p>
            <p className="text-xs text-muted-foreground">
              No se creará cuenta ni se enviará a HubSpot.
            </p>
            {needsWarning && (
              <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Este prospecto tiene posible coincidencia. Revisa antes de aprobar.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={doApprove}
              disabled={approving}
              className="bg-su-brand text-white hover:bg-su-brand/90"
            >
              {approving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Confirmar aprobación
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setConfirming(false)}
              disabled={approving}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={!canApprove}
              title={canApprove ? undefined : 'No disponible para este candidato'}
              className="bg-su-brand text-white hover:bg-su-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Aprobar
            </Button>
            {DISABLED_ACTIONS.map((a) => (
              <Button
                key={a.label}
                variant="outline"
                size="sm"
                disabled
                title="Disponible en siguiente fase"
                className="cursor-not-allowed opacity-60"
              >
                <a.icon className="h-3.5 w-3.5" />
                {a.label}
              </Button>
            ))}
          </div>
          {blockReason ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">{blockReason}</p>
          ) : (
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-su-brand" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Por ahora solo puedes aprobar. Las demás acciones se habilitarán en próximos hitos.
              </p>
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
