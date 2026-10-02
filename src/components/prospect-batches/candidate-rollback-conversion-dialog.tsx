'use client';

import { Loader2 } from '@/icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/forms/field';
import { ModalShell } from '@/components/shared/modal-shell';

interface CandidateRollbackConversionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
}

/** Formulario corto para deshacer la conversión de un candidato en empresa. */
export function CandidateRollbackConversionDialog({
  open,
  onOpenChange,
  loading,
  reason,
  onReasonChange,
  onConfirm,
}: CandidateRollbackConversionDialogProps) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Deshacer conversión"
      description="Esta acción revierte la creación de la empresa en SellUp y conserva el historial para auditoría. La cuenta queda marcada como no operativa y el candidato regresa a estado aprobado."
      actions={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={loading || !reason.trim()}>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Deshacer conversión
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert variant="warning">
          <AlertTitle>¿Qué hace este rollback?</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              <li>La cuenta queda marcada como no operativa en metadata.</li>
              <li>El candidato vuelve a estado &quot;Aprobado&quot; con trazabilidad completa.</li>
              <li>El vínculo candidate/account se conserva para auditoría.</li>
              <li>No se borra ningún dato. No se toca HubSpot.</li>
            </ul>
          </AlertDescription>
        </Alert>

        <Field label="Motivo del rollback" required>
          <Textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Ej. Conversión de QA, empresa incorrecta, error de proceso…"
            rows={3}
          />
        </Field>
      </div>
    </ModalShell>
  );
}
