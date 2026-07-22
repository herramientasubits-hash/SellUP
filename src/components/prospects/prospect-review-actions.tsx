'use client';

// Q3F-5AZ.2D-1-UX1 — Prospectos drawer action zone.
// Q3F-5AZ.2D-1-UX2 — action HIERARCHY (visual reorder only).
// Q3F-5AZ.2E-1     — "Aprobar" now approves AND creates the empresa.
//
// The operative "Aprobar" surface, relocated out of the Validación tab content
// and into the drawer's own action zone (rendered as a sticky footer via
// `DrawerShell`'s `footer` prop) so it is available regardless of which tab
// is active — the natural place for a per-prospect action, not a bespoke
// content block.
//
// Q3F-5AZ.2E-1 fixes the functional contract: approving now validates the
// prospect, creates/links the SellUp account and best-effort syncs HubSpot,
// through the SAFE server wrapper `approveAndConvertPendingReviewCandidateAction`
// (admin gate + Prospectos eligibility, then delegates to the canonical
// convert action). The client NEVER calls the legacy
// `approveAndConvertCandidateAction` directly and NEVER imports HubSpot.
// No opportunity/proposal is created; no bulk approve.
//
// UX2 reorders the presentation so the zone reads as a hierarchy instead of a
// flat row of equal-weight buttons:
//   - Aprobar        → primary, enabled only when the candidate is eligible.
//   - Descartar      → secondary/destructive. Q3F-5AZ.2G-1 ENABLES it for an
//                       eligible (needs_review, clean-production) candidate;
//                       disabled otherwise. Discarding removes the prospect from
//                       review WITHOUT creating an empresa and WITHOUT touching
//                       HubSpot/providers/AI, through the SAFE server wrapper
//                       `discardPendingReviewCandidateAction`.
//   - Más acciones ▼ → dropdown holding the remaining future actions
//                       (Marcar duplicado / Enviar a enriquecimiento /
//                       Mantener en revisión), all still disabled.
//
// Confirmation is INLINE (a panel inside this action zone), NOT a modal
// stacked over the drawer — this deliberately avoids the overlay-stacking
// class of bugs that Q3F-5AZ.2C-HF1/HF2/HF3 chased in the AlertDialog path.
// Approve and discard each have their own inline confirmation; only one is
// ever shown at a time.
//
// `autoConfirm` / `discardAutoConfirm` let row-menu / context-menu /
// selection-bar entry points open this drawer with the approve / discard
// confirmation already armed (only when the candidate is actually eligible)
// instead of acting directly.

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
  DISCARD_ERROR_MESSAGES,
  DUPLICATE_ERROR_MESSAGES,
  type ReviewDecisionCandidate,
} from './prospect-review-decision-utils';
import {
  approveAndConvertPendingReviewCandidateAction,
  type ConvertApproveHubSpotStatus,
} from '@/modules/prospect-review/approve-and-convert-actions';
import { discardPendingReviewCandidateAction } from '@/modules/prospect-review/discard-actions';
import { markDuplicatePendingReviewCandidateAction } from '@/modules/prospect-review/duplicate-actions';

// Copy shared by every not-yet-available action (tooltip + menu hint).
// Exported so the Prospectos selection action bar (prospects-data-table-client.tsx)
// can reuse the exact same copy/icons and stay visually consistent with this
// footer (Q3F-5AZ.2E-1-UX1).
export const FUTURE_ACTION_HINT = 'Disponible en siguiente fase';

/**
 * Post-success toast copy. HubSpot is best-effort: the message only claims a
 * HubSpot sync when the result confirms it, and otherwise makes clear the
 * empresa was created in SellUp while HubSpot stayed pending / not configured.
 */
function resolveSuccessMessage(
  status: 'converted_to_account' | 'idempotent_success',
  hubSpotStatus?: ConvertApproveHubSpotStatus,
): string {
  if (status === 'idempotent_success') {
    return 'Este prospecto ya estaba convertido en empresa.';
  }
  switch (hubSpotStatus) {
    case 'created':
    case 'linked_existing':
      return 'Empresa creada desde prospecto.';
    case 'skipped_not_configured':
    case 'skipped_possible_match':
      return 'Empresa creada en SellUp. HubSpot no se sincronizó porque no está configurado o requiere revisión.';
    case 'failed_create':
      return 'Empresa creada en SellUp. HubSpot no se pudo sincronizar.';
    default:
      return 'Empresa creada desde prospecto.';
  }
}

interface ProspectReviewActionsProps {
  candidate: ReviewDecisionCandidate;
  /** Arm the inline APPROVE confirmation on mount (row menu / selection bar intent). */
  autoConfirm?: boolean;
  /** Called once the approve auto-confirm intent has been applied (or found ineligible). */
  onApproveIntentConsumed?: () => void;
  /**
   * Arm the inline DISCARD confirmation on mount (row menu / context menu /
   * selection bar intent). Q3F-5AZ.2G-1 — mirrors `autoConfirm` for discard.
   */
  discardAutoConfirm?: boolean;
  /** Called once the discard auto-confirm intent has been applied (or found ineligible). */
  onDiscardIntentConsumed?: () => void;
  /**
   * Arm the inline MARK-DUPLICATE confirmation on mount (row menu / context menu
   * / selection bar intent). Q3F-5AZ.2G-2 — mirrors `autoConfirm` for duplicate.
   */
  duplicateAutoConfirm?: boolean;
  /** Called once the duplicate auto-confirm intent has been applied (or found ineligible). */
  onDuplicateIntentConsumed?: () => void;
}

// Future secondary action kept VISIBLE alongside Aprobar (disabled for now).
export const DISCARD_ACTION = { label: 'Descartar', icon: XCircle } as const;

// Q3F-5AZ.2G-2 — "Marcar duplicado" is now an ENABLED action (inside "Más
// acciones") for an eligible candidate. Exported so the Prospectos selection
// action bar (prospects-data-table-client.tsx) can reuse the exact same
// copy/icon and stay visually consistent with this footer.
export const MARK_DUPLICATE_ACTION = { label: 'Marcar duplicado', icon: Copy } as const;

// Remaining future actions still grouped under "Más acciones", all disabled.
export const FUTURE_MORE_ACTIONS = [
  { label: 'Enviar a enriquecimiento', icon: Sparkles },
  { label: 'Mantener en revisión', icon: Clock },
] as const;

export function ProspectReviewActions({
  candidate,
  autoConfirm = false,
  onApproveIntentConsumed,
  discardAutoConfirm = false,
  onDiscardIntentConsumed,
  duplicateAutoConfirm = false,
  onDuplicateIntentConsumed,
}: ProspectReviewActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  // Q3F-5AZ.2G-1 — the discard inline confirmation is a separate mode from the
  // approve one; only one panel is ever shown at a time (see render below).
  const [discardConfirming, setDiscardConfirming] = React.useState(false);
  const [discarding, setDiscarding] = React.useState(false);
  // Q3F-5AZ.2G-2 — the mark-duplicate inline confirmation is a third mutually
  // exclusive mode; only one of approve/discard/duplicate panels shows at a time.
  const [duplicateConfirming, setDuplicateConfirming] = React.useState(false);
  const [markingDuplicate, setMarkingDuplicate] = React.useState(false);

  const view = resolveReviewDecisionView(candidate);

  // Reset both inline confirmations whenever the drawer swaps to another candidate.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    setConfirming(false);
    setApproving(false);
    setDiscardConfirming(false);
    setDiscarding(false);
    setDuplicateConfirming(false);
    setMarkingDuplicate(false);
  }, [candidate.id]);

  // Arm the inline APPROVE confirmation when opened via row menu / context menu /
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

  // Arm the inline DISCARD confirmation when opened via row menu / context menu /
  // selection action bar — only when the candidate is genuinely discardable.
  // Never discards directly; the human still confirms inline.
  React.useEffect(() => {
    if (discardAutoConfirm && view.canDiscard) {
      setDiscardConfirming(true);
    }
    if (discardAutoConfirm) {
      onDiscardIntentConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardAutoConfirm, candidate.id]);

  // Arm the inline MARK-DUPLICATE confirmation when opened via row menu /
  // context menu / selection action bar — only when the candidate is genuinely
  // markable. Never marks directly; the human still confirms inline.
  React.useEffect(() => {
    if (duplicateAutoConfirm && view.canMarkDuplicate) {
      setDuplicateConfirming(true);
    }
    if (duplicateAutoConfirm) {
      onDuplicateIntentConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateAutoConfirm, candidate.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function doApprove() {
    if (approving) return;
    setApproving(true);
    try {
      // The inline confirmation IS the explicit human confirmation, so a
      // possible-duplicate / HubSpot-match candidate carries its confirm flag.
      const result = await approveAndConvertPendingReviewCandidateAction(candidate.id, {
        confirmPossibleDuplicate: view.isPossibleDuplicate,
        confirmHubSpotMatch: view.hasHubspotMatch,
        source: 'prospectos_drawer',
      });
      if (result.ok) {
        toast.success(resolveSuccessMessage(result.status, result.hubSpotStatus));
        setConfirming(false);
        // Server components refetch: the drawer receives the updated candidate
        // and re-renders this zone (null — terminal) and the status info card
        // in the "Convertido en cuenta" state with the "Ver empresa" CTA.
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

  async function doDiscard() {
    if (discarding) return;
    setDiscarding(true);
    try {
      const result = await discardPendingReviewCandidateAction(candidate.id, {
        source: 'prospectos_drawer',
      });
      if (result.ok) {
        toast.success('Prospecto descartado.');
        setDiscardConfirming(false);
        // Server components refetch: the drawer receives the updated candidate
        // and re-renders this zone (null — terminal) and the status info card
        // in the "Descartado" state.
        router.refresh();
      } else {
        toast.error(
          DISCARD_ERROR_MESSAGES[result.reason] ?? DISCARD_ERROR_MESSAGES.unexpected_error,
        );
      }
    } catch {
      toast.error(DISCARD_ERROR_MESSAGES.unexpected_error);
    } finally {
      setDiscarding(false);
    }
  }

  async function doMarkDuplicate() {
    if (markingDuplicate) return;
    setMarkingDuplicate(true);
    try {
      const result = await markDuplicatePendingReviewCandidateAction(candidate.id, {
        source: 'prospectos_drawer',
      });
      if (result.ok) {
        toast.success('Prospecto marcado como duplicado.');
        setDuplicateConfirming(false);
        // Server components refetch: the drawer receives the updated candidate
        // and re-renders this zone (null — terminal) and the status info card
        // in the "Marcado como duplicado" state.
        router.refresh();
      } else {
        toast.error(
          DUPLICATE_ERROR_MESSAGES[result.reason] ?? DUPLICATE_ERROR_MESSAGES.unexpected_error,
        );
      }
    } catch {
      toast.error(DUPLICATE_ERROR_MESSAGES.unexpected_error);
    } finally {
      setMarkingDuplicate(false);
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
            <p className="text-sm font-medium text-foreground">¿Aprobar y crear empresa?</p>
            <p className="text-xs text-muted-foreground">
              Esto validará el prospecto, creará la empresa en SellUp e intentará sincronizarla con
              HubSpot según la configuración disponible. No se creará oportunidad ni propuesta
              todavía.
            </p>
            {view.hasHubspotMatch ? (
              <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Este prospecto tiene una coincidencia de HubSpot. Al aprobar, SellUp intentará
                vincular la empresa existente.
              </p>
            ) : (
              view.needsWarning && (
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  Este prospecto tiene posible coincidencia. Revisa antes de aprobar y crear
                  empresa.
                </p>
              )
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
      ) : discardConfirming ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">¿Descartar prospecto?</p>
            <p className="text-xs text-muted-foreground">
              Este prospecto saldrá de la revisión y no se creará como empresa en SellUp. Podrás
              conservar trazabilidad del descarte.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={doDiscard}
              disabled={discarding}
            >
              {discarding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              Confirmar descarte
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setDiscardConfirming(false)}
              disabled={discarding}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : duplicateConfirming ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">¿Marcar prospecto como duplicado?</p>
            <p className="text-xs text-muted-foreground">
              Este prospecto saldrá de la revisión como duplicado. No se creará empresa en SellUp ni
              se sincronizará con HubSpot.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={doMarkDuplicate}
              disabled={markingDuplicate}
              className="bg-amber-500 text-white hover:bg-amber-500/90"
            >
              {markingDuplicate ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Confirmar duplicado
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setDuplicateConfirming(false)}
              disabled={markingDuplicate}
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

            {/* Secondary/destructive — Q3F-5AZ.2G-1 enables Descartar for an
                eligible (needs_review, clean-production) candidate. Clicking it
                arms the inline discard confirmation; it never discards directly.
                Disabled (with the future-action hint) otherwise. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDiscardConfirming(true)}
              disabled={!view.canDiscard}
              title={view.canDiscard ? undefined : FUTURE_ACTION_HINT}
              className="text-destructive disabled:cursor-not-allowed disabled:opacity-60"
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
                {/* Q3F-5AZ.2G-2 — "Marcar duplicado" is enabled for an eligible
                    candidate; clicking it arms the inline duplicate confirmation
                    (it never marks directly). Disabled (with the future-action
                    hint) for an ineligible candidate. */}
                <DropdownMenuItem
                  disabled={!view.canMarkDuplicate}
                  title={view.canMarkDuplicate ? undefined : FUTURE_ACTION_HINT}
                  onClick={() => setDuplicateConfirming(true)}
                >
                  <MARK_DUPLICATE_ACTION.icon className="h-3.5 w-3.5" />
                  <span className="flex-1">{MARK_DUPLICATE_ACTION.label}</span>
                  {!view.canMarkDuplicate && (
                    <span className="text-[10px] text-muted-foreground">{FUTURE_ACTION_HINT}</span>
                  )}
                </DropdownMenuItem>
                {/* Remaining future actions stay disabled. */}
                {FUTURE_MORE_ACTIONS.map((a) => (
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
            Puedes aprobar, descartar o marcar como duplicado este prospecto. Las demás acciones se
            habilitarán en próximos hitos.
          </p>
        </div>
      )}
    </div>
  );
}
