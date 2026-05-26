'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  GitMerge,
  ArrowRightCircle,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  approveCandidate,
  discardCandidate,
  markCandidateDuplicate,
  convertCandidateToAccount,
} from '@/modules/prospect-batches/actions';
import {
  DUPLICATE_STATUS_LABELS,
  APPROVE_BLOCK_MESSAGES,
  parseDuplicateCheck,
  type ProspectCandidate,
} from '@/modules/prospect-batches/types';

const SOURCE_LABELS: Record<string, string> = {
  sellup: 'SellUp',
  hubspot: 'HubSpot',
};

interface CandidateRowActionsProps {
  candidate: ProspectCandidate;
}

export function CandidateRowActions({ candidate }: CandidateRowActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [discardReason, setDiscardReason] = React.useState('');
  const [approveConfirmOpen, setApproveConfirmOpen] = React.useState(false);

  const statusAllowsApprove = ['generated', 'normalized', 'needs_review'].includes(
    candidate.status,
  );
  const approveBlockMessage = APPROVE_BLOCK_MESSAGES[candidate.duplicate_status];
  const isDuplicateBlocked = !!approveBlockMessage;
  const isPossibleDuplicate = candidate.duplicate_status === 'possible_duplicate';

  const canDiscard = !['discarded', 'converted_to_account'].includes(candidate.status);
  const canMarkDuplicate = !['converted_to_account', 'duplicate'].includes(candidate.status);
  const canConvert = candidate.status === 'approved';

  const dc = parseDuplicateCheck(candidate.metadata);

  async function handleApproveClick() {
    if (isPossibleDuplicate) {
      setApproveConfirmOpen(true);
      return;
    }
    await doApprove();
  }

  async function doApprove() {
    setLoading(true);
    try {
      await approveCandidate(candidate.id);
      toast.success(`"${candidate.name}" aprobado`);
      setApproveConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al aprobar');
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscard() {
    setLoading(true);
    try {
      await discardCandidate(candidate.id, discardReason.trim() || undefined);
      toast.success(`"${candidate.name}" descartado`);
      setDiscardOpen(false);
      setDiscardReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al descartar');
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkDuplicate() {
    setLoading(true);
    try {
      await markCandidateDuplicate(candidate.id, { duplicate_status: 'possible_duplicate' });
      toast.success(`"${candidate.name}" marcado como posible duplicado`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al marcar duplicado');
    } finally {
      setLoading(false);
    }
  }

  async function handleConvert() {
    setLoading(true);
    try {
      await convertCandidateToAccount(candidate.id);
      toast.success(
        <span>
          Empresa prospecto creada.{' '}
          <button
            className="underline font-medium"
            onClick={() => router.push(`/accounts`)}
          >
            Ver empresas
          </button>
        </span>
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al convertir');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={loading}>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-3.5 w-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Approve — visible when candidate status allows it */}
            {statusAllowsApprove && (
              isDuplicateBlocked ? (
                <Tooltip>
                  <TooltipTrigger>
                    {/* wrapper div needed — disabled elements don't fire mouse events */}
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
                  <TooltipContent side="left" className="max-w-[220px] text-center">
                    {approveBlockMessage}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuItem onClick={handleApproveClick}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
                  Aprobar{isPossibleDuplicate ? '…' : ''}
                </DropdownMenuItem>
              )
            )}

            {canConvert && (
              <DropdownMenuItem onClick={handleConvert}>
                <ArrowRightCircle className="mr-2 h-3.5 w-3.5 text-su-brand" />
                Crear empresa prospecto
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {canMarkDuplicate && (
              <DropdownMenuItem onClick={handleMarkDuplicate}>
                <GitMerge className="mr-2 h-3.5 w-3.5 text-amber-500" />
                Marcar posible duplicado
              </DropdownMenuItem>
            )}
            {canDiscard && (
              <DropdownMenuItem
                onClick={() => setDiscardOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <XCircle className="mr-2 h-3.5 w-3.5" />
                Descartar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>

      {/* Possible duplicate confirmation dialog */}
      <Dialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
              Posibles duplicados detectados
            </DialogTitle>
            <DialogDescription>
              Este candidato tiene posibles duplicados. Revisa las coincidencias antes de aprobar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {dc?.summary && (
              <p className="text-sm text-muted-foreground">{dc.summary}</p>
            )}

            {dc?.matches && dc.matches.length > 0 ? (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {dc.matches.map((match, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border/40 bg-card p-2.5 space-y-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {SOURCE_LABELS[match.source] ?? match.source}
                      </span>
                      {match.confidence !== null && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          Conf: {match.confidence}%
                        </span>
                      )}
                    </div>
                    {match.matched_name && (
                      <p className="text-xs text-foreground">{match.matched_name}</p>
                    )}
                    {match.matched_domain && (
                      <p className="text-xs text-muted-foreground">{match.matched_domain}</p>
                    )}
                    {match.reason && (
                      <p className="text-[10px] text-muted-foreground/70 italic">{match.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin detalle de coincidencias disponible.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setApproveConfirmOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={doApprove}
              disabled={loading}
              className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Aprobar de todas formas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard dialog */}
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar candidato</DialogTitle>
            <DialogDescription>
              ¿Por qué descartás a <strong>{candidate.name}</strong>? El motivo es opcional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Motivo (opcional)</p>
            <Textarea
              value={discardReason}
              onChange={(e) => setDiscardReason(e.target.value)}
              placeholder="Ej. Empresa fuera del segmento objetivo..."
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDiscardOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscard}
              disabled={loading}
              className="gap-1.5"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
