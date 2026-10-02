'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  GitMerge,
  Loader2,
  ShieldCheck,
  ClipboardCheck,
  RotateCcw,
} from "@/icons";
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DuplicateReviewConfirmDialog,
  PossibleDuplicateApproveDialog,
  RelatedCompanyApproveDialog,
} from './candidate-approve-dialogs';
import { CandidateDiscardDialog } from './candidate-discard-dialog';
import {
  CandidateMarkDuplicateDialog,
  type MarkDuplicateType,
} from './candidate-mark-duplicate-dialog';
import { CandidateRollbackConversionDialog } from './candidate-rollback-conversion-dialog';
import { toast } from 'sonner';
import {
  approveAndConvertCandidateAction,
  discardCandidate,
  markCandidateDuplicate,
  markCandidateReadyForApprovalAction,
  markCandidateDuplicateReviewedAction,
  rollbackCandidateAccountConversionAction,
} from '@/modules/prospect-batches/actions';
import {
  DUPLICATE_STATUS_LABELS,
  APPROVE_BLOCK_MESSAGES,
  DISCARD_REASONS,
  isStructuredCandidate,
  parseDuplicateCheck,
  type ProspectCandidate,
  type DiscardReasonKey,
} from '@/modules/prospect-batches/types';

interface CandidateRowActionsProps {
  candidate: ProspectCandidate;
  onBeforeAction?: () => void;
  /**
   * Q3F-5AZ.2D-1-HF1 — safe-approve override for the Prospectos surface.
   *
   * When provided, the row-menu "Aprobar" entry NO LONGER runs the legacy
   * convert-and-approve flow (`approveAndConvertCandidateAction`, which creates
   * an account and may trigger HubSpot). It instead delegates to this callback,
   * which the Prospectos data table wires to open the detail drawer with its
   * inline confirmation armed — the already-validated
   * `approvePendingReviewCandidateAction` path. Left undefined elsewhere (e.g.
   * prospect-batches), the legacy behaviour is preserved verbatim.
   */
  onApproveOverride?: () => void;
  /**
   * Q3F-5AZ.2G-1 — safe-discard override for the Prospectos surface.
   *
   * When provided, the row-menu "Descartar" entry NO LONGER opens the local
   * reason dialog that calls the legacy `discardCandidate` directly (which runs
   * under `requireActiveUser`, not the Prospectos admin gate). It instead
   * delegates to this callback, which the Prospectos data table wires to open
   * the detail drawer with its inline discard confirmation armed — the
   * admin-gated `discardPendingReviewCandidateAction` path. Left undefined
   * elsewhere (e.g. prospect-batches), the legacy behaviour is preserved
   * verbatim.
   */
  onDiscardOverride?: () => void;
  /**
   * Q3F-5AZ.2G-2 — safe mark-duplicate override for the Prospectos surface.
   *
   * When provided, the row-menu "Marcar como duplicado" entry NO LONGER opens
   * the local duplicate dialog that calls the legacy `markCandidateDuplicate`
   * directly (which runs under `requireActiveUser`, not the Prospectos admin
   * gate). It instead delegates to this callback, which the Prospectos data
   * table wires to open the detail drawer with its inline duplicate confirmation
   * armed — the admin-gated `markDuplicatePendingReviewCandidateAction` path.
   * Left undefined elsewhere (e.g. prospect-batches), the legacy behaviour is
   * preserved verbatim.
   */
  onMarkDuplicateOverride?: () => void;
}

export function CandidateRowActions({
  candidate,
  onBeforeAction,
  onApproveOverride,
  onDiscardOverride,
  onMarkDuplicateOverride,
}: CandidateRowActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  // Discard
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [discardReasonKey, setDiscardReasonKey] = React.useState<DiscardReasonKey | ''>('');
  const [discardReason, setDiscardReason] = React.useState('');
  // Approve confirmation (possible_duplicate)
  const [approveConfirmOpen, setApproveConfirmOpen] = React.useState(false);
  // Approve warning (related_company)
  const [relatedCompanyWarnOpen, setRelatedCompanyWarnOpen] = React.useState(false);
  // Duplicate review confirmation
  const [duplicateReviewConfirmOpen, setDuplicateReviewConfirmOpen] = React.useState(false);
  // Rollback conversión
  const [rollbackOpen, setRollbackOpen] = React.useState(false);
  const [rollbackReason, setRollbackReason] = React.useState('');
  // Mark duplicate dialog
  const [markDuplicateOpen, setMarkDuplicateOpen] = React.useState(false);
  const [markDuplicateType, setMarkDuplicateType] = React.useState<MarkDuplicateType>('possible_duplicate');
  const [markDuplicateNote, setMarkDuplicateNote] = React.useState('');

  const isStructured = isStructuredCandidate(candidate);
  const reviewStatus = candidate.review_status ?? null;

  const statusAllowsApprove = ['generated', 'normalized', 'needs_review'].includes(
    candidate.status,
  );
  const approveBlockMessage = APPROVE_BLOCK_MESSAGES[candidate.duplicate_status];
  const isDuplicateBlocked = !!approveBlockMessage;
  const isPossibleDuplicate = candidate.duplicate_status === 'possible_duplicate';

  // Para candidatos estructurados: solo aprobar si review_status = ready_for_approval
  const approveBlockedNotReady =
    isStructured && statusAllowsApprove && reviewStatus !== 'ready_for_approval';
  const canMarkReady =
    isStructured &&
    candidate.status === 'needs_review' &&
    reviewStatus === 'needs_manual_review';

  const canMarkDuplicateReviewed =
    isStructured &&
    reviewStatus === 'ready_for_approval' &&
    candidate.duplicate_status === 'unchecked';

  const canDiscard = !['discarded', 'converted_to_account'].includes(candidate.status);
  const canMarkDuplicate = !['converted_to_account', 'duplicate'].includes(candidate.status);

  const conversionRolledBack =
    (candidate.commercial_trace as Record<string, unknown> | null)?.conversionRollback === true;
  const canRollback =
    isStructured &&
    candidate.status === 'converted_to_account' &&
    candidate.converted_account_id !== null &&
    !conversionRolledBack;

  const dc = parseDuplicateCheck(candidate.metadata);

  async function handleApproveClick() {
    // related_company: allow approval but show informational warning first
    if (candidate.duplicate_status === 'related_company') {
      setRelatedCompanyWarnOpen(true);
      return;
    }
    // possible_duplicate: require explicit confirmation
    if (isPossibleDuplicate) {
      setApproveConfirmOpen(true);
      return;
    }
    await doApprove();
  }

  async function doApprove() {
    setLoading(true);
    try {
      const result = await approveAndConvertCandidateAction(candidate.id);

      if (!result.success) {
        toast.error(result.message || 'Error al aprobar candidato');
        return;
      }

      const hs = result.hubspot;
      const message = result.message;

      if (hs.action === 'failed') {
        toast.warning(
          <span>
            {message}{' '}
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0 align-baseline text-current underline"
              onClick={() => router.push('/accounts')}
            >
              Ver empresas
            </Button>
          </span>
        );
      } else {
        toast.success(
          <span>
            {message}{' '}
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0 align-baseline text-current underline"
              onClick={() => router.push('/accounts')}
            >
              Ver empresas
            </Button>
          </span>
        );
      }
      setApproveConfirmOpen(false);
      setRelatedCompanyWarnOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aprobar');
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscard() {
    const reasonObj = DISCARD_REASONS.find((r) => r.value === discardReasonKey);
    let finalReason: string | undefined;
    if (discardReasonKey && discardReasonKey !== 'other') {
      finalReason = discardReason.trim()
        ? `${reasonObj?.label}: ${discardReason.trim()}`
        : reasonObj?.label;
    } else {
      finalReason = discardReason.trim() || undefined;
    }

    setLoading(true);
    try {
      await discardCandidate(candidate.id, finalReason);
      toast.success(`"${candidate.name}" descartado`);
      setDiscardOpen(false);
      setDiscardReason('');
      setDiscardReasonKey('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al descartar');
    } finally {
      setLoading(false);
    }
  }

  function handleMarkDuplicateClick() {
    setMarkDuplicateType('possible_duplicate');
    setMarkDuplicateNote('');
    setMarkDuplicateOpen(true);
  }

  async function doMarkDuplicate() {
    setLoading(true);
    try {
      await markCandidateDuplicate(candidate.id, {
        duplicate_status: markDuplicateType,
        review_notes: markDuplicateNote.trim() || undefined,
      });
      toast.success(
        `"${candidate.name}" marcado como ${DUPLICATE_STATUS_LABELS[markDuplicateType].toLowerCase()}`
      );
      setMarkDuplicateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al marcar duplicado');
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkDuplicateReviewed() {
    setLoading(true);
    try {
      const result = await markCandidateDuplicateReviewedAction(candidate.id);
      if (!result.ok) {
        toast.error(result.error ?? 'Error al marcar duplicidad revisada');
        return;
      }
      toast.success(`Duplicidad de "${candidate.name}" marcada como revisada`);
      setDuplicateReviewConfirmOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al marcar duplicidad revisada');
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkReady() {
    setLoading(true);
    try {
      const result = await markCandidateReadyForApprovalAction(candidate.id);
      if (!result.ok) {
        toast.error(result.error ?? 'Error al marcar como listo');
        return;
      }
      toast.success(`"${candidate.name}" marcado como listo para aprobación`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al marcar como listo');
    } finally {
      setLoading(false);
    }
  }

  async function handleRollback() {
    setLoading(true);
    try {
      const result = await rollbackCandidateAccountConversionAction(candidate.id, rollbackReason);
      if (!result.ok) {
        toast.error(result.error ?? 'Error al aplicar rollback');
        return;
      }
      toast.success(`Conversión de "${candidate.name}" revertida. La cuenta queda marcada como no operativa.`);
      setRollbackOpen(false);
      setRollbackReason('');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aplicar rollback');
    } finally {
      setLoading(false);
    }
  }


  return (
    <>
      <TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-xs" disabled={loading} aria-label={`Acciones para ${candidate.name}`} />}
          >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-3.5 w-3.5" />
              )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Marcar revisado — solo candidatos estructurados en needs_manual_review */}
            {canMarkReady && (
              <DropdownMenuItem onClick={handleMarkReady}>
                <ClipboardCheck className="mr-2 h-3.5 w-3.5 text-primary" />
                Marcar revisado
              </DropdownMenuItem>
            )}

            {/* Marcar duplicidad revisada — estructurados en ready_for_approval con duplicate_status=unchecked */}
            {canMarkDuplicateReviewed && (
              <Tooltip>
                <TooltipTrigger>
                  <DropdownMenuItem onClick={() => setDuplicateReviewConfirmOpen(true)}>
                    <ShieldCheck className="mr-2 h-3.5 w-3.5 text-primary" />
                    Marcar duplicidad revisada
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-60 text-center">
                  Confirma que revisaste posibles duplicados antes de aprobar.
                </TooltipContent>
              </Tooltip>
            )}

            {/* Approve — visible when candidate status allows it */}
            {statusAllowsApprove && (
              isDuplicateBlocked ? (
                <Tooltip>
                  <TooltipTrigger>
                    <div>
                      <DropdownMenuItem
                        disabled
                        className="text-muted-foreground cursor-not-allowed"
                      >
                        <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                        Aprobar
                      </DropdownMenuItem>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-56 text-center">
                    {approveBlockMessage}
                  </TooltipContent>
                </Tooltip>
              ) : approveBlockedNotReady ? (
                <Tooltip>
                  <TooltipTrigger>
                    <div>
                      <DropdownMenuItem
                        disabled
                        className="text-muted-foreground cursor-not-allowed"
                      >
                        <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                        Aprobar
                      </DropdownMenuItem>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-60 text-center">
                    Este candidato viene de una fuente oficial. Primero debe marcarse como listo para aprobación.
                  </TooltipContent>
                </Tooltip>
              ) : (
                // Q3F-5AZ.2D-1-HF1: in Prospectos (onApproveOverride set) this
                // opens the safe drawer confirmation instead of the legacy
                // convert-and-approve flow. handleApproveClick — the only path to
                // approveAndConvertCandidateAction — is unreachable in that mode.
                <DropdownMenuItem onClick={onApproveOverride ?? handleApproveClick}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-success" />
                  Aprobar{!onApproveOverride && isPossibleDuplicate ? '…' : ''}
                </DropdownMenuItem>
              )
            )}

            {canRollback && (
              <DropdownMenuItem
                onClick={() => { setRollbackReason(''); setRollbackOpen(true); }}
                className="text-warning focus:text-warning"
              >
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Deshacer conversión…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {canMarkDuplicate && (
              // Q3F-5AZ.2G-2: in Prospectos (onMarkDuplicateOverride set) this
              // opens the safe drawer confirmation instead of the legacy dialog
              // that calls markCandidateDuplicate directly. handleMarkDuplicateClick
              // — the only path to the legacy markCandidateDuplicate — is
              // unreachable in that mode.
              <DropdownMenuItem onClick={onMarkDuplicateOverride ?? handleMarkDuplicateClick}>
                <GitMerge className="mr-2 h-3.5 w-3.5 text-warning" />
                Marcar como duplicado{onMarkDuplicateOverride ? '' : '…'}
              </DropdownMenuItem>
            )}
            {canDiscard && (
              // Q3F-5AZ.2G-1: in Prospectos (onDiscardOverride set) this opens
              // the safe drawer confirmation instead of the legacy reason dialog
              // that calls discardCandidate directly. handleDiscard — the only
              // path to the legacy discardCandidate — is unreachable in that mode.
              <DropdownMenuItem
                onClick={
                  onDiscardOverride ?? (() => { onBeforeAction?.(); setDiscardOpen(true); })
                }
                className="text-destructive focus:text-destructive"
              >
                <XCircle className="mr-2 h-3.5 w-3.5" />
                Descartar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>

      <PossibleDuplicateApproveDialog
        open={approveConfirmOpen}
        onOpenChange={setApproveConfirmOpen}
        loading={loading}
        onConfirm={doApprove}
        duplicateCheck={dc}
      />

      <CandidateDiscardDialog
        open={discardOpen}
        onOpenChange={(open) => {
          setDiscardOpen(open);
          if (!open) { setDiscardReason(''); setDiscardReasonKey(''); }
        }}
        candidateName={candidate.name}
        loading={loading}
        reasonKey={discardReasonKey}
        onReasonKeyChange={setDiscardReasonKey}
        reason={discardReason}
        onReasonChange={setDiscardReason}
        onConfirm={handleDiscard}
      />

      <CandidateMarkDuplicateDialog
        open={markDuplicateOpen}
        onOpenChange={(open) => {
          setMarkDuplicateOpen(open);
          if (!open) setMarkDuplicateNote('');
        }}
        candidateName={candidate.name}
        loading={loading}
        type={markDuplicateType}
        onTypeChange={setMarkDuplicateType}
        note={markDuplicateNote}
        onNoteChange={setMarkDuplicateNote}
        onConfirm={doMarkDuplicate}
      />

      <DuplicateReviewConfirmDialog
        open={duplicateReviewConfirmOpen}
        onOpenChange={setDuplicateReviewConfirmOpen}
        loading={loading}
        onConfirm={handleMarkDuplicateReviewed}
        candidateName={candidate.name}
      />

      <CandidateRollbackConversionDialog
        open={rollbackOpen}
        onOpenChange={(open) => {
          setRollbackOpen(open);
          if (!open) setRollbackReason('');
        }}
        loading={loading}
        reason={rollbackReason}
        onReasonChange={setRollbackReason}
        onConfirm={handleRollback}
      />

      <RelatedCompanyApproveDialog
        open={relatedCompanyWarnOpen}
        onOpenChange={setRelatedCompanyWarnOpen}
        loading={loading}
        onConfirm={doApprove}
        candidateName={candidate.name}
        summary={dc?.summary}
      />
    </>
  );
}
