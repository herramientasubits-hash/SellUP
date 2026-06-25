'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  GitMerge,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Link2,
  ClipboardCheck,
  RotateCcw,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  type DuplicateStatus,
  type DiscardReasonKey,
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
  const [markDuplicateType, setMarkDuplicateType] = React.useState<
    Extract<DuplicateStatus, 'possible_duplicate' | 'exact_duplicate' | 'related_company'>
  >('possible_duplicate');
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
            <button
              className="underline font-medium"
              onClick={() => router.push('/accounts')}
            >
              Ver empresas
            </button>
          </span>
        );
      } else {
        toast.success(
          <span>
            {message}{' '}
            <button
              className="underline font-medium"
              onClick={() => router.push('/accounts')}
            >
              Ver empresas
            </button>
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
            {/* Marcar revisado — solo candidatos estructurados en needs_manual_review */}
            {canMarkReady && (
              <DropdownMenuItem onClick={handleMarkReady}>
                <ClipboardCheck className="mr-2 h-3.5 w-3.5 text-su-brand" />
                Marcar revisado
              </DropdownMenuItem>
            )}

            {/* Marcar duplicidad revisada — estructurados en ready_for_approval con duplicate_status=unchecked */}
            {canMarkDuplicateReviewed && (
              <Tooltip>
                <TooltipTrigger>
                  <DropdownMenuItem onClick={() => setDuplicateReviewConfirmOpen(true)}>
                    <ShieldCheck className="mr-2 h-3.5 w-3.5 text-su-brand" />
                    Marcar duplicidad revisada
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[240px] text-center">
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
                  <TooltipContent side="left" className="max-w-[220px] text-center">
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
                  <TooltipContent side="left" className="max-w-[240px] text-center">
                    Este candidato viene de una fuente oficial. Primero debe marcarse como listo para aprobación.
                  </TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuItem onClick={handleApproveClick}>
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
                  Aprobar{isPossibleDuplicate ? '…' : ''}
                </DropdownMenuItem>
              )
            )}

            {canRollback && (
              <DropdownMenuItem
                onClick={() => { setRollbackReason(''); setRollbackOpen(true); }}
                className="text-amber-600 dark:text-amber-400 focus:text-amber-600"
              >
                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                Deshacer conversión…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {canMarkDuplicate && (
              <DropdownMenuItem onClick={handleMarkDuplicateClick}>
                <GitMerge className="mr-2 h-3.5 w-3.5 text-amber-500" />
                Marcar como duplicado…
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
      <Dialog open={discardOpen} onOpenChange={(open) => {
        setDiscardOpen(open);
        if (!open) { setDiscardReason(''); setDiscardReasonKey(''); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Descartar candidato</DialogTitle>
            <DialogDescription>
              Descartando <strong>{candidate.name}</strong>. Seleccioná el motivo para mantener
              trazabilidad.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                Motivo de descarte
              </Label>
              <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
                {DISCARD_REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setDiscardReasonKey(r.value)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      discardReasonKey === r.value
                        ? 'border-destructive bg-destructive/10'
                        : 'border-border/40 bg-card hover:bg-muted/40'
                    }`}
                  >
                    <p className={`text-sm ${discardReasonKey === r.value ? 'text-destructive font-medium' : 'text-foreground'}`}>
                      {r.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {discardReasonKey === 'other' ? 'Motivo personalizado' : 'Notas adicionales (opcional)'}
              </Label>
              <Textarea
                value={discardReason}
                onChange={(e) => setDiscardReason(e.target.value)}
                placeholder={
                  discardReasonKey === 'other'
                    ? 'Describí el motivo…'
                    : 'Contexto adicional opcional…'
                }
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDiscardOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscard}
              disabled={loading || (discardReasonKey === 'other' && !discardReason.trim())}
              className="gap-1.5"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Mark-duplicate dialog */}
      <Dialog open={markDuplicateOpen} onOpenChange={(open) => {
        setMarkDuplicateOpen(open);
        if (!open) setMarkDuplicateNote('');
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Marcar como duplicado</DialogTitle>
            <DialogDescription>
              Seleccioná el tipo de duplicado para <strong>{candidate.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Type selector — 3 options as toggle buttons */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tipo</Label>
              <div className="flex flex-col gap-1.5">
                {(
                  [
                    {
                      value: 'possible_duplicate',
                      label: 'Posible duplicado',
                      desc: 'Requiere confirmación manual',
                      color: 'text-amber-600 dark:text-amber-400',
                    },
                    {
                      value: 'exact_duplicate',
                      label: 'Duplicado exacto',
                      desc: 'Ya existe en SellUp o HubSpot — no reaparece',
                      color: 'text-destructive',
                    },
                    {
                      value: 'related_company',
                      label: 'Empresa relacionada',
                      desc: 'Filial o subsidiaria de otra empresa',
                      color: 'text-orange-600 dark:text-orange-400',
                    },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMarkDuplicateType(opt.value)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      markDuplicateType === opt.value
                        ? 'border-su-brand bg-su-brand-soft'
                        : 'border-border/40 bg-card hover:bg-muted/40'
                    }`}
                  >
                    <p className={`text-xs font-semibold ${opt.color}`}>{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Optional note — for related_company: parent company name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {markDuplicateType === 'related_company'
                  ? 'Empresa matriz o relacionada (opcional)'
                  : 'Notas (opcional)'}
              </Label>
              <Textarea
                value={markDuplicateNote}
                onChange={(e) => setMarkDuplicateNote(e.target.value)}
                placeholder={
                  markDuplicateType === 'related_company'
                    ? 'Ej. Filial de Siigo S.A. (CO)…'
                    : 'Contexto adicional…'
                }
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setMarkDuplicateOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button onClick={doMarkDuplicate} disabled={loading} className="gap-1.5">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate review confirmation dialog */}
      <Dialog open={duplicateReviewConfirmOpen} onOpenChange={setDuplicateReviewConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-su-brand shrink-0" />
              Confirmar revisión de duplicados
            </DialogTitle>
            <DialogDescription>
              Antes de aprobar <strong>{candidate.name}</strong>, confirmá que verificaste
              posibles duplicados en SellUp y HubSpot y que no existe un registro previo de
              esta empresa.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-border/40 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">¿Ya verificaste?</p>
            <p>• Buscar la empresa en SellUp (Cuentas / Candidatos)</p>
            <p>• Buscar la empresa en HubSpot por nombre y NIT</p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDuplicateReviewConfirmOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleMarkDuplicateReviewed}
              disabled={loading}
              className="gap-1.5"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Sí, sin duplicados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback conversión dialog */}
      <Dialog open={rollbackOpen} onOpenChange={(open) => {
        setRollbackOpen(open);
        if (!open) setRollbackReason('');
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-amber-500 shrink-0" />
              Deshacer conversión
            </DialogTitle>
            <DialogDescription>
              Esta acción revierte la creación de la empresa en SellUp y conserva el historial para auditoría. La cuenta queda marcada como no operativa y el candidato regresa a estado aprobado.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400 space-y-1">
            <p className="font-medium">¿Qué hace este rollback?</p>
            <p>• La cuenta queda marcada como no operativa en metadata.</p>
            <p>• El candidato vuelve a estado &quot;Aprobado&quot; con trazabilidad completa.</p>
            <p>• El vínculo candidate/account se conserva para auditoría.</p>
            <p>• No se borra ningún dato. No se toca HubSpot.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Motivo del rollback <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              placeholder="Ej. Conversión de QA, empresa incorrecta, error de proceso…"
              rows={3}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRollbackOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleRollback}
              disabled={loading || !rollbackReason.trim()}
              className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Deshacer conversión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Related-company approval warning */}
      <Dialog open={relatedCompanyWarnOpen} onOpenChange={setRelatedCompanyWarnOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-orange-500 shrink-0" />
              Empresa relacionada detectada
            </DialogTitle>
            <DialogDescription>
              <strong>{candidate.name}</strong> está marcada como empresa relacionada
              (filial o subsidiaria de otra empresa). Podés aprobarla, pero registrá la
              relación en el campo de notas al crear la cuenta.
            </DialogDescription>
          </DialogHeader>

          {dc?.summary && (
            <p className="text-sm text-muted-foreground">{dc.summary}</p>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRelatedCompanyWarnOpen(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={doApprove}
              disabled={loading}
              className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Aprobar de todas formas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
