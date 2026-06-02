'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCcw, Loader2 } from 'lucide-react';
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
import { toast } from 'sonner';
import { rehydrateStructuredBatchCandidatesAction } from '@/modules/prospect-batches/actions';

interface RehydrateBatchButtonProps {
  batchId: string;
}

export function RehydrateBatchButton({ batchId }: RehydrateBatchButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  function handleClose() {
    if (loading) return;
    setOpen(false);
  }

  async function handleConfirm() {
    setLoading(true);
    try {
      const result = await rehydrateStructuredBatchCandidatesAction(batchId);

      if (!result.ok) {
        toast.error(result.error ?? 'Error al reprocesar enrichment');
        setLoading(false);
        return;
      }

      toast.success(
        `Enrichment reprocesado: ${result.updatedCount} candidato${result.updatedCount !== 1 ? 's' : ''} actualizados.`,
        { duration: 5000 }
      );

      if (result.warnings.length > 0) {
        toast.warning(
          `${result.warnings.length} advertencia${result.warnings.length !== 1 ? 's' : ''}: ${result.warnings.slice(0, 2).join('; ')}`,
          { duration: 6000 }
        );
      }

      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Error inesperado al reprocesar enrichment');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="gap-1.5 text-xs"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Reprocesar enrichment
          </Button>
        }
      />

      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="pt-2">
          <DialogTitle className="text-base font-semibold">
            ¿Reprocesar enrichment de candidatos?
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Esto recalculará sector, flags de revisión y completitud de los candidatos existentes en este lote.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-1.5">
          <ul className="list-disc pl-4 space-y-1 text-xs text-muted-foreground">
            <li>No toca HubSpot ni crea empresas.</li>
            <li>No cambia estados comerciales ni de revisión.</li>
            <li>No modifica cuentas ni conversiones.</li>
            <li>Actualiza <code>review_flags</code>, <code>sector_description</code> y <code>metadata.enrichment</code>.</li>
          </ul>
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
          <Button size="sm" onClick={handleConfirm} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Procesando…
              </>
            ) : (
              'Reprocesar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
