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
  Link2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
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
  DISCARD_REASONS,
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
  // Mark duplicate dialog
  const [markDuplicateOpen, setMarkDuplicateOpen] = React.useState(false);
  const [markDuplicateType, setMarkDuplicateType] = React.useState<
    Extract<DuplicateStatus, 'possible_duplicate' | 'exact_duplicate' | 'related_company'>
  >('possible_duplicate');
  const [markDuplicateNote, setMarkDuplicateNote] = React.useState('');

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
      await approveCandidate(candidate.id);
      toast.success(`"${candidate.name}" aprobado`);
      setApproveConfirmOpen(false);
      setRelatedCompanyWarnOpen(false);
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
        <DialogContent>
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
              <Select
                value={discardReasonKey}
                onValueChange={(v) => setDiscardReasonKey(v as DiscardReasonKey)}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Seleccionar motivo…" />
                </SelectTrigger>
                <SelectContent>
                  {DISCARD_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
