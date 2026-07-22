'use client';

// Q3F-5AZ.2D-1-UX1 — Prospectos drawer action zone.
//
// The operative "Aprobar" surface, relocated out of the Validación tab content
// and into the drawer's own action zone (rendered as a sticky footer via
// `DrawerShell`'s `footer` prop) so it is available regardless of which tab
// is active — the natural place for a per-prospect action, not a bespoke
// content block. Reuses the ALREADY VALIDATED
// `approvePendingReviewCandidateAction` (Q3F-5AZ.2C) verbatim — no new
// action, no conversion, no HubSpot, no providers.
//
// Only "Aprobar" is enabled. Descartar / Marcar duplicado / Enviar a
// enriquecimiento / Mantener en revisión render disabled ("Disponible en
// siguiente fase") in the same action zone — future actions, present
// context, no functionality yet.
//
// Confirmation is INLINE (a panel inside this action zone), NOT a modal
// stacked over the drawer — this deliberately avoids the overlay-stacking
// class of bugs that Q3F-5AZ.2C-HF1/HF2/HF3 chased in the AlertDialog path.
//
// `autoConfirm` lets row-menu / context-menu / selection-bar entry points
// open this drawer with the confirmation already armed (only when the
// candidate is actually eligible) instead of approving directly.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, Copy, Sparkles, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  resolveReviewDecisionView,
  APPROVE_ERROR_MESSAGES,
  type ReviewDecisionCandidate,
} from './prospect-review-decision-utils';
import { approvePendingReviewCandidateAction } from '@/modules/prospect-review/approve-actions';

interface ProspectReviewActionsProps {
  candidate: ReviewDecisionCandidate;
  /** Arm the inline confirmation on mount (row menu / selection bar intent). */
  autoConfirm?: boolean;
  /** Called once the auto-confirm intent has been applied (or found ineligible). */
  onApproveIntentConsumed?: () => void;
}

// Actions not yet available in this hito — rendered disabled for context.
const DISABLED_ACTIONS = [
  { label: 'Descartar', icon: XCircle },
  { label: 'Marcar duplicado', icon: Copy },
  { label: 'Enviar a enriquecimiento', icon: Sparkles },
  { label: 'Mantener en revisión', icon: Clock },
] as const;

export function ProspectReviewActions({
  candidate,
  autoConfirm = false,
  onApproveIntentConsumed,
}: ProspectReviewActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [approving, setApproving] = React.useState(false);

  const view = resolveReviewDecisionView(candidate);

  // Reset the inline confirmation whenever the drawer swaps to another candidate.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    setConfirming(false);
    setApproving(false);
  }, [candidate.id]);

  // Arm the inline confirmation when opened via row menu / context menu /
  // selection action bar — only when the candidate is genuinely approvable.
  // Never approves directly; the human still confirms inline.
  React.useEffect(() => {
    if (autoConfirm && view.canApprove) {
      setConfirming(true);
    }
    if (autoConfirm) {
      onApproveIntentConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConfirm, candidate.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function doApprove() {
    if (approving) return;
    setApproving(true);
    try {
      const result = await approvePendingReviewCandidateAction(candidate.id, {
        confirmPossibleDuplicate: view.isPossibleDuplicate,
      });
      if (result.ok) {
        toast.success(
          result.status === 'idempotent_success'
            ? `"${candidate.name}" ya estaba aprobado`
            : `Prospecto aprobado.`,
        );
        setConfirming(false);
        // Server components refetch: the drawer receives the updated candidate
        // and re-renders this zone (and the status info card) in the
        // "Aprobado" state.
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

  // Terminal states (approved / discarded / duplicate / converted) have
  // nothing actionable — the informational card already explains the state.
  if (view.terminal) return null;

  return (
    <div className="shrink-0 border-t border-border/50 bg-muted/20 px-7 py-4">
      {confirming ? (
        <div className="rounded-xl border border-su-brand/30 bg-su-brand/5 p-3 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">¿Confirmas aprobar este prospecto?</p>
            <p className="text-xs text-muted-foreground">
              No se creará cuenta ni se enviará a HubSpot.
            </p>
            {view.needsWarning && (
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={!view.canApprove}
            title={view.canApprove ? undefined : 'No disponible para este candidato'}
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
      )}
    </div>
  );
}
