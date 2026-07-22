'use client';

// Q3F-5AZ.2D-1-UX1 — Prospectos drawer action zone.
// Q3F-5AZ.2D-1-UX2 — action HIERARCHY (visual reorder only).
//
// The operative "Aprobar" surface, relocated out of the Validación tab content
// and into the drawer's own action zone (rendered as a sticky footer via
// `DrawerShell`'s `footer` prop) so it is available regardless of which tab
// is active — the natural place for a per-prospect action, not a bespoke
// content block. Reuses the ALREADY VALIDATED
// `approvePendingReviewCandidateAction` (Q3F-5AZ.2C) verbatim — no new
// action, no conversion, no HubSpot, no providers.
//
// UX2 reorders the presentation so the zone reads as a hierarchy instead of a
// flat row of equal-weight buttons:
//   - Aprobar        → primary, enabled only when the candidate is eligible.
//   - Descartar      → secondary/destructive, VISIBLE but disabled (future).
//   - Más acciones ▼ → dropdown holding the remaining future actions
//                       (Marcar duplicado / Enviar a enriquecimiento /
//                       Mantener en revisión), all disabled.
// Every non-approve action stays disabled ("Disponible en siguiente fase") —
// UX2 is a visual reorder ONLY: no new action is implemented and the approve
// logic is untouched.
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
import { CheckCircle2, XCircle, Copy, Sparkles, Clock, ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  resolveReviewDecisionView,
  APPROVE_ERROR_MESSAGES,
  type ReviewDecisionCandidate,
} from './prospect-review-decision-utils';
import { approvePendingReviewCandidateAction } from '@/modules/prospect-review/approve-actions';

// Copy shared by every not-yet-available action (tooltip + menu hint).
const FUTURE_ACTION_HINT = 'Disponible en siguiente fase';

interface ProspectReviewActionsProps {
  candidate: ReviewDecisionCandidate;
  /** Arm the inline confirmation on mount (row menu / selection bar intent). */
  autoConfirm?: boolean;
  /** Called once the auto-confirm intent has been applied (or found ineligible). */
  onApproveIntentConsumed?: () => void;
}

// Future secondary action kept VISIBLE alongside Aprobar (disabled for now).
const DISCARD_ACTION = { label: 'Descartar', icon: XCircle } as const;

// Future actions grouped under the "Más acciones" dropdown (all disabled).
const MORE_ACTIONS = [
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
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Primary — the only enabled action, and only when eligible. */}
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

            {/* Secondary/destructive — visible but disabled until a later hito. */}
            <Button
              variant="outline"
              size="sm"
              disabled
              title={FUTURE_ACTION_HINT}
              className="cursor-not-allowed text-destructive opacity-60 disabled:opacity-60"
            >
              <DISCARD_ACTION.icon className="h-3.5 w-3.5" />
              {DISCARD_ACTION.label}
            </Button>

            {/* Remaining future actions collapsed into a small menu. */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  Más acciones
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                {MORE_ACTIONS.map((a) => (
                  <DropdownMenuItem key={a.label} disabled title={FUTURE_ACTION_HINT}>
                    <a.icon className="h-3.5 w-3.5" />
                    <span className="flex-1">{a.label}</span>
                    <span className="text-[10px] text-muted-foreground">{FUTURE_ACTION_HINT}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <p className="text-xs text-muted-foreground">
            Por ahora solo puedes aprobar. Las demás acciones se habilitarán en próximos hitos.
          </p>
        </div>
      )}
    </div>
  );
}
