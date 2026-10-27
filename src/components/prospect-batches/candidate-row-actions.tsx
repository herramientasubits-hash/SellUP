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
  UserPlus,
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
import { DuplicateReviewConfirmDialog } from './candidate-approve-dialogs';
import { CandidateRollbackConversionDialog } from './candidate-rollback-conversion-dialog';
import { toast } from 'sonner';
// AGENT1-AUDIT-WS4 — este componente cliente ya NO importa
// `approveAndConvertCandidateAction`, `discardCandidate` ni
// `markCandidateDuplicate`: importarlas aquí publicaba sus IDs de server action
// al navegador aunque la UI nunca llegara a llamarlas. Aprobar / Descartar /
// Marcar duplicado SIEMPRE abren el drawer con la confirmación armada, que llama
// a los envoltorios seguros de `@/modules/prospect-review`.
import {
  markCandidateReadyForApprovalAction,
  markCandidateDuplicateReviewedAction,
  rollbackCandidateAccountConversionAction,
} from '@/modules/prospect-batches/actions';
import {
  APPROVE_BLOCK_MESSAGES,
  isStructuredCandidate,
  type ProspectCandidate,
} from '@/modules/prospect-batches/types';
import { mensajeDeError } from '@/lib/friendly-error';

interface CandidateRowActionsProps {
  candidate: ProspectCandidate;
  /**
   * Q3F-5AZ.2D-1-HF1 — «Aprobar» abre el drawer con la confirmación armada (la
   * vía segura `approveAndConvertPendingReviewCandidateAction`).
   * AGENT1-AUDIT-WS4 — obligatorio: ya no existe la vía heredada.
   */
  onApproveOverride: () => void;
  /**
   * Q3F-5AZ.2G-1 — «Descartar» abre el drawer con la confirmación armada (la vía
   * segura `discardPendingReviewCandidateAction`).
   * AGENT1-AUDIT-WS4 — obligatorio: ya no existe la vía heredada.
   */
  onDiscardOverride: () => void;
  /**
   * Q3F-5AZ.2G-2 — «Marcar como duplicado» abre el drawer con la confirmación
   * armada (la vía segura `markDuplicatePendingReviewCandidateAction`).
   * AGENT1-AUDIT-WS4 — obligatorio: ya no existe la vía heredada.
   */
  onMarkDuplicateOverride: () => void;
  /**
   * BULK-COMPANY-ASSIGNMENT-1 — en Prospectos abre «Asignar a…» para esta fila.
   * Sin definir (p. ej. en prospect-batches) la entrada no aparece.
   */
  onAssign?: () => void;
}

export function CandidateRowActions({
  candidate,
  onApproveOverride,
  onDiscardOverride,
  onMarkDuplicateOverride,
  onAssign,
}: CandidateRowActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  // Duplicate review confirmation
  const [duplicateReviewConfirmOpen, setDuplicateReviewConfirmOpen] = React.useState(false);
  // Rollback conversión
  const [rollbackOpen, setRollbackOpen] = React.useState(false);
  const [rollbackReason, setRollbackReason] = React.useState('');

  const isStructured = isStructuredCandidate(candidate);
  const reviewStatus = candidate.review_status ?? null;

  const statusAllowsApprove = ['generated', 'normalized', 'needs_review'].includes(
    candidate.status,
  );
  const approveBlockMessage = APPROVE_BLOCK_MESSAGES[candidate.duplicate_status];
  const isDuplicateBlocked = !!approveBlockMessage;

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

  async function handleMarkDuplicateReviewed() {
    setLoading(true);
    try {
      const result = await markCandidateDuplicateReviewedAction(candidate.id);
      if (!result.ok) {
        toast.error(result.error ?? 'Error al marcar duplicidad revisada');
        return;
      }
      // La revisión se vuelve a correr: lo que se avisa es lo que encontró.
      if (result.duplicateStatus === 'no_match') {
        toast.success(result.message ?? `Duplicidad de "${candidate.name}" revisada`);
      } else {
        toast.warning(result.message ?? `Revisa la duplicidad de "${candidate.name}"`);
      }
      setDuplicateReviewConfirmOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo marcar la duplicidad como revisada'));
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
      toast.error(mensajeDeError(err, 'No se pudo marcar como lista'));
    } finally {
      setLoading(false);
    }
  }

  async function handleRollback() {
    setLoading(true);
    try {
      const result = await rollbackCandidateAccountConversionAction(candidate.id, rollbackReason);
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo deshacer la conversión');
        return;
      }
      toast.success(`Conversión de "${candidate.name}" revertida. La cuenta queda marcada como no operativa.`);
      setRollbackOpen(false);
      setRollbackReason('');
      router.refresh();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo deshacer la conversión'));
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
                    Revisar duplicados
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-60 text-center">
                  Vuelve a buscar la empresa en SellUp y HubSpot antes de aprobar.
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
                // Q3F-5AZ.2D-1-HF1 / AGENT1-AUDIT-WS4: abre siempre la
                // confirmación segura del drawer (no hay vía heredada).
                <DropdownMenuItem onClick={onApproveOverride}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-success" />
                  Aprobar
                </DropdownMenuItem>
              )
            )}

            {onAssign && (
              <DropdownMenuItem onClick={onAssign}>
                <UserPlus className="mr-2 h-3.5 w-3.5 text-primary" />
                Asignar a…
              </DropdownMenuItem>
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
              // Q3F-5AZ.2G-2 / AGENT1-AUDIT-WS4: abre siempre la confirmación
              // segura del drawer (no hay vía heredada).
              <DropdownMenuItem onClick={onMarkDuplicateOverride}>
                <GitMerge className="mr-2 h-3.5 w-3.5 text-warning" />
                Marcar como duplicado
              </DropdownMenuItem>
            )}
            {canDiscard && (
              // Q3F-5AZ.2G-1 / AGENT1-AUDIT-WS4: abre siempre la confirmación
              // segura del drawer (no hay vía heredada).
              <DropdownMenuItem
                onClick={onDiscardOverride}
                className="text-destructive focus:text-destructive"
              >
                <XCircle className="mr-2 h-3.5 w-3.5" />
                Descartar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>

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

    </>
  );
}
