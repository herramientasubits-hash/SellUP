'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, AlertTriangle } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Field } from '@/components/forms/field';
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
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
      trigger={
        <Button variant="outline" size="sm">
          <RotateCcw className="h-3.5 w-3.5" />
          Deshacer lote
        </Button>
      }
      variant="destructive"
      icon={AlertTriangle}
      title="Deshacer este lote de candidatos"
      description="Esta acción revierte la creación del lote en SellUp y conserva el historial para auditoría. Los candidatos quedan descartados y el lote no afecta el flujo de prospección."
      confirmLabel={loading ? 'Aplicando...' : 'Confirmar, deshacer lote'}
      loading={loading}
      onConfirm={handleConfirm}
      className="sm:max-w-md"
    >
      <Field label="Motivo (opcional)">
        <Textarea
          id="rollback-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej. QA rollback para lote structured de Agente 1..."
          disabled={loading}
          rows={3}
          className="resize-none"
        />
      </Field>
    </ConfirmDialog>
  );
}
