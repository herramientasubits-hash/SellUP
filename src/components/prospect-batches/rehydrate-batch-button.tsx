'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCcw } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
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
    <ConfirmDialog
      open={open}
      onOpenChange={(v) => (v ? setOpen(true) : handleClose())}
      trigger={
        <Button variant="outline" size="sm">
          <RefreshCcw className="h-3.5 w-3.5" />
          Recalcular datos
        </Button>
      }
      icon={RefreshCcw}
      title="¿Reprocesar enrichment de candidatos?"
      description="Esto recalculará sector, flags de revisión y completitud de los candidatos existentes en este lote."
      confirmLabel={loading ? 'Procesando…' : 'Reprocesar'}
      loading={loading}
      onConfirm={handleConfirm}
      className="sm:max-w-md"
    >
      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
        <li>No toca HubSpot ni crea empresas.</li>
        <li>No cambia estados comerciales ni de revisión.</li>
        <li>No modifica cuentas ni conversiones.</li>
        <li>Actualiza <code>review_flags</code>, <code>sector_description</code> y <code>metadata.enrichment</code>.</li>
      </ul>
    </ConfirmDialog>
  );
}
