'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Loader2, AlertTriangle } from 'lucide-react';
import { DialogClose } from '@/components/ui/dialog';
import { ModalShell } from '@/components/shared/modal-shell';
import { FieldLabel } from '@/components/forms/field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { rollbackStructuredAgentBatchAction } from '@/modules/prospect-batches/actions';

interface RollbackBatchDialogProps {
  batchId: string;
  batchName: string;
}

export function RollbackBatchDialog({ batchId, batchName }: RollbackBatchDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  function handleClose() {
    if (loading) return;
    setOpen(false);
    setReason('');
  }

  async function handleConfirm() {
    setLoading(true);
    try {
      const result = await rollbackStructuredAgentBatchAction(batchId, reason.trim() || undefined);
      if (result.ok) {
        toast.success('Lote revertido', {
          description: `El lote "${batchName}" quedó cancelado y sus ${result.candidatesUpdated} candidatos descartados.`,
        });
        setOpen(false);
        setReason('');
        router.refresh();
      } else {
        toast.error('No se pudo aplicar el rollback', {
          description: result.error ?? 'Ocurrió un error inesperado.',
        });
      }
    } catch (err) {
      toast.error('Error al aplicar el rollback', {
        description: err instanceof Error ? err.message : 'Error desconocido.',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      trigger={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Deshacer lote
        </Button>
      }
      size="md"
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
          Deshacer este lote de candidatos
        </span>
      }
      description="Esta acción revierte la creación del lote en SellUp y conserva el historial para auditoría. Los candidatos quedan descartados y el lote no afecta el flujo de prospección."
      actions={
        <>
          <DialogClose
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={handleClose}
              />
            }
          >
            Cancelar
          </DialogClose>
          <Button
            variant="destructive-solid"
            size="sm"
            disabled={loading}
            onClick={handleConfirm}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {loading ? 'Aplicando...' : 'Confirmar, deshacer lote'}
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <FieldLabel htmlFor="rollback-reason" className="block leading-none">
          Motivo (opcional)
        </FieldLabel>
        <Textarea
          id="rollback-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. QA rollback para lote structured de Agente 1..."
          disabled={loading}
          rows={3}
          className="resize-none"
        />
      </div>
    </ModalShell>
  );
}
