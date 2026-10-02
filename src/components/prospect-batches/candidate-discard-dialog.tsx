'use client';

import * as React from 'react';
import { Loader2 } from '@/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel } from '@/components/forms/field';
import { OptionTile } from '@/components/selection/option-tile';
import { ModalShell } from '@/components/shared/modal-shell';
import { DISCARD_REASONS, type DiscardReasonKey } from '@/modules/prospect-batches/types';

interface CandidateDiscardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName: string;
  loading: boolean;
  reasonKey: DiscardReasonKey | '';
  onReasonKeyChange: (key: DiscardReasonKey) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
}

/** Formulario corto para descartar un candidato dejando el motivo. */
export function CandidateDiscardDialog({
  open,
  onOpenChange,
  candidateName,
  loading,
  reasonKey,
  onReasonKeyChange,
  reason,
  onReasonChange,
  onConfirm,
}: CandidateDiscardDialogProps) {
  const reasonLabelId = React.useId();
  const isOther = reasonKey === 'other';

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Descartar candidato"
      description={
        <>
          Descartando <strong>{candidateName}</strong>. Seleccioná el motivo para mantener trazabilidad.
        </>
      }
      actions={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant="destructive-solid"
            onClick={onConfirm}
            disabled={loading || (isOther && !reason.trim())}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Descartar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <FieldLabel id={reasonLabelId} className="block">
            Motivo de descarte
          </FieldLabel>
          <div
            role="radiogroup"
            aria-labelledby={reasonLabelId}
            className="grid max-h-64 gap-1.5 overflow-y-auto p-0.5 pr-1 sm:grid-cols-2"
          >
            {DISCARD_REASONS.map((r) => (
              <OptionTile
                key={r.value}
                compact
                option={{ value: r.value, label: r.label }}
                selected={reasonKey === r.value}
                onSelect={() => onReasonKeyChange(r.value)}
              />
            ))}
          </div>
        </div>

        <Field label={isOther ? 'Motivo personalizado' : 'Notas adicionales (opcional)'} required={isOther}>
          <Textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder={isOther ? 'Describí el motivo…' : 'Contexto adicional opcional…'}
            rows={2}
          />
        </Field>
      </div>
    </ModalShell>
  );
}
