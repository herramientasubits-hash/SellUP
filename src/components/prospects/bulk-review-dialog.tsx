'use client';

// Prod 24-11 — aprobar o descartar VARIOS prospectos de «Por revisar» de una vez. Repite en
// el servidor la acción de una fila (mismos permisos y validaciones); lo que no se pudo
// queda marcado en la tabla con su motivo para revisarlo una por una.

import * as React from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, XCircle } from '@/icons';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/forms/field';
import { Textarea } from '@/components/ui/textarea';
import {
  DISCARD_REASONS,
  DISCARD_REASON_MAX_LENGTH,
  composeDiscardReason,
  validateDiscardReason,
  type DiscardReasonKey,
} from '@/modules/prospect-review/discard-reason';
import {
  bulkApprovePendingReviewCandidatesAction,
  bulkDiscardPendingReviewCandidatesAction,
} from '@/modules/prospect-review/bulk-review-actions';
import {
  bulkReviewMaxIds,
  BULK_REVIEW_ERROR_MESSAGES,
  bulkReviewFailureSummary,
  type BulkReviewResult,
} from '@/modules/prospect-review/bulk-review-core';

export type BulkReviewMode = 'approve' | 'discard';

export interface BulkReviewDialogProps {
  mode: BulkReviewMode | null;
  rows: readonly { id: string; name: string }[];
  onOpenChange: (open: boolean) => void;
  /** Después de procesar (aunque alguna haya fallado): limpiar selección y refrescar.
   *  El padre lo monta con una `key` por apertura: el motivo empieza vacío cada vez. */
  onDone: () => void;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function reportResult(result: BulkReviewResult, mode: BulkReviewMode): void {
  if (!result.ok) {
    toast.error(BULK_REVIEW_ERROR_MESSAGES[result.error]);
    return;
  }
  const verb = mode === 'approve' ? 'aprobados' : 'descartados';
  const doneText = `${plural(result.done, 'prospecto', 'prospectos')} ${verb}.`;
  if (result.failed.length === 0) {
    toast.success(doneText);
    return;
  }
  const detail = `Sin procesar: ${bulkReviewFailureSummary(result.failed)}.`;
  if (result.done > 0) toast.warning(doneText, { description: detail });
  else toast.error('No se procesó ninguno.', { description: detail });
}

export function BulkReviewDialog({ mode, rows, onOpenChange, onDone }: BulkReviewDialogProps) {
  const [busy, setBusy] = React.useState(false);
  const [reasonKey, setReasonKey] = React.useState<DiscardReasonKey | ''>('');
  const [reasonText, setReasonText] = React.useState('');
  const open = mode !== null && rows.length > 0;

  const composedReason = composeDiscardReason(reasonKey, reasonText);
  const reasonValid = validateDiscardReason(composedReason).ok;
  const count = plural(rows.length, 'prospecto', 'prospectos');
  const max = mode ? bulkReviewMaxIds(mode) : 0;
  const tooMany = rows.length > max;

  const run = async () => {
    if (!mode || busy) return;
    setBusy(true);
    try {
      const ids = rows.map((r) => r.id);
      const result =
        mode === 'approve'
          ? await bulkApprovePendingReviewCandidatesAction(ids)
          : await bulkDiscardPendingReviewCandidatesAction(ids, composedReason);
      reportResult(result, mode);
      if (result.ok) {
        onOpenChange(false);
        onDone();
      }
    } catch {
      toast.error('No se pudo completar la acción. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === 'approve' ? `¿Aprobar ${count}?` : `¿Descartar ${count}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {mode === 'approve'
              ? 'SellUp crea cada empresa y la registra en HubSpot, igual que al aprobar una por una. Las que tengan posible duplicado o ya estén en HubSpot se saltan: esas se revisan una por una.'
              : 'Saldrán de la revisión y no se crearán como empresas. El motivo queda guardado en cada una.'}
          </AlertDialogDescription>
          {tooMany && (
            <p role="alert" className="text-sm text-destructive">
              {mode === 'approve' ? 'Para aprobar' : 'Para descartar'} marca como mucho {max} a la vez.
            </p>
          )}
        </AlertDialogHeader>

        {mode === 'discard' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <FieldLabel className="block text-foreground" id="bulk-discard-reason-label">
                Motivo de descarte
              </FieldLabel>
              <div
                role="group"
                aria-labelledby="bulk-discard-reason-label"
                className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1"
              >
                {DISCARD_REASONS.map((r) => {
                  const selected = reasonKey === r.value;
                  return (
                    <Button
                      key={r.value}
                      type="button"
                      variant={selected ? 'destructive' : 'outline'}
                      size="sm"
                      aria-pressed={selected}
                      disabled={busy}
                      onClick={() => setReasonKey(r.value)}
                      className="h-auto min-h-8 shrink-0 justify-start whitespace-normal py-1.5 text-left font-medium"
                    >
                      {r.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <Field
              label={reasonKey === 'other' ? 'Motivo personalizado' : 'Notas adicionales (opcional)'}
              className="text-foreground"
            >
              <Textarea
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                disabled={busy}
                rows={2}
                maxLength={DISCARD_REASON_MAX_LENGTH}
                placeholder={reasonKey === 'other' ? 'Describe el motivo…' : 'Contexto adicional opcional…'}
                className="min-h-16"
              />
            </Field>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            variant={mode === 'discard' ? 'destructive-solid' : 'default'}
            aria-busy={busy}
            disabled={busy || tooMany || (mode === 'discard' && !reasonValid)}
            onClick={() => void run()}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : mode === 'discard' ? (
              <XCircle aria-hidden="true" />
            ) : (
              <CheckCircle2 aria-hidden="true" />
            )}
            {mode === 'discard' ? `Descartar ${count}` : `Aprobar ${count}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
