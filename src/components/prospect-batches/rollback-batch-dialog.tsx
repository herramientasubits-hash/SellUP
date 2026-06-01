'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
        toast.success('Rollback aplicado', {
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
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogTrigger
        render={
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setOpen(true)}
            className="gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Rollback lógico
          </Button>
        }
      />

      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="pt-2">
          <div className="flex items-center gap-2 text-destructive mb-1">
            <AlertTriangle className="h-5 w-5" />
            <DialogTitle className="text-base font-semibold">Confirmar Rollback Lógico</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Este rollback marcará el lote y sus candidatos como descartados. No eliminará datos y no afectará el lote Apollo relacionado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="rollback-reason" className="text-xs font-semibold text-muted-foreground/80">
              Motivo del rollback (opcional)
            </Label>
            <Textarea
              id="rollback-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. QA rollback para lote structured de Agente 1..."
              disabled={loading}
              rows={3}
              className="resize-none text-xs"
            />
          </div>
        </div>

        <DialogFooter className="mt-2">
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
            variant="destructive"
            size="sm"
            disabled={loading}
            onClick={handleConfirm}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            {loading ? 'Aplicando...' : 'Aplicar rollback lógico'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
