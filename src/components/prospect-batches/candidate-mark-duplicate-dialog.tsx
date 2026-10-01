'use client';

import * as React from 'react';
import { Loader2 } from '@/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel } from '@/components/forms/field';
import { OptionTile } from '@/components/selection/option-tile';
import { ModalShell } from '@/components/shared/modal-shell';
import type { DuplicateStatus } from '@/modules/prospect-batches/types';

export type MarkDuplicateType = Extract<
  DuplicateStatus,
  'possible_duplicate' | 'exact_duplicate' | 'related_company'
>;

const DUPLICATE_TYPE_OPTIONS: { value: MarkDuplicateType; label: string; description: string }[] = [
  {
    value: 'possible_duplicate',
    label: 'Posible duplicado',
    description: 'Requiere confirmación manual',
  },
  {
    value: 'exact_duplicate',
    label: 'Duplicado exacto',
    description: 'Ya existe en SellUp o HubSpot — no reaparece',
  },
  {
    value: 'related_company',
    label: 'Empresa relacionada',
    description: 'Filial o subsidiaria de otra empresa',
  },
];

interface CandidateMarkDuplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName: string;
  loading: boolean;
  type: MarkDuplicateType;
  onTypeChange: (type: MarkDuplicateType) => void;
  note: string;
  onNoteChange: (note: string) => void;
  onConfirm: () => void;
}

/** Formulario corto para marcar un candidato como duplicado o empresa relacionada. */
export function CandidateMarkDuplicateDialog({
  open,
  onOpenChange,
  candidateName,
  loading,
  type,
  onTypeChange,
  note,
  onNoteChange,
  onConfirm,
}: CandidateMarkDuplicateDialogProps) {
  const typeLabelId = React.useId();
  const isRelated = type === 'related_company';

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Marcar como duplicado"
      description={
        <>
          Seleccioná el tipo de duplicado para <strong>{candidateName}</strong>.
        </>
      }
      actions={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <FieldLabel id={typeLabelId} className="block">
            Tipo
          </FieldLabel>
          <div role="radiogroup" aria-labelledby={typeLabelId} className="flex flex-col gap-1.5">
            {DUPLICATE_TYPE_OPTIONS.map((opt) => (
              <OptionTile
                key={opt.value}
                option={opt}
                selected={type === opt.value}
                onSelect={() => onTypeChange(opt.value)}
              />
            ))}
          </div>
        </div>

        <Field label={isRelated ? 'Empresa matriz o relacionada (opcional)' : 'Notas (opcional)'}>
          <Textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={isRelated ? 'Ej. Filial de Siigo S.A. (CO)…' : 'Contexto adicional…'}
            rows={2}
          />
        </Field>
      </div>
    </ModalShell>
  );
}
