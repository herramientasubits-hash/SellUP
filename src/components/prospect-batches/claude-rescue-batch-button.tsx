'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  rescueBatchWithClaudeAction,
  type ClaudeRescueActionResult,
} from '@/modules/prospect-batches/claude-classifier-actions';

const ERROR_MESSAGES: Record<string, string> = {
  disabled: 'El rescate con Claude no está habilitado.',
  unauthorized: 'Sólo un admin puede usar el rescate.',
  invalid_batch: 'Lote inválido.',
  model_not_configured: 'Configura Claude (Anthropic) como proveedor activo en Configuración → IA.',
  quota_exhausted: 'La cuota mensual configurada para Anthropic está agotada.',
  catalog_unavailable: 'No se pudo leer el catálogo de industrias.',
  load_failed: 'No se pudieron leer los candidatos del lote.',
};

function describeResult(result: ClaudeRescueActionResult): string {
  if (!result.ok) return ERROR_MESSAGES[result.error] ?? 'No se pudo completar.';
  const pending = result.remaining > 0 ? ` · faltan ${result.remaining}: pulsa otra vez` : '';
  return (
    `${result.candidatesCompleted} completados · ${result.candidatesDiscarded} descartados · ` +
    `${result.dispositionsAdmitted} rescatados de Descartadas · costo estimado US$${result.estimatedCostUsd.toFixed(2)}${pending}`
  );
}

export function ClaudeRescueBatchButton({ batchId }: { batchId: string }) {
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
      const result = await rescueBatchWithClaudeAction(batchId);
      if (!result.ok) {
        toast.error(describeResult(result));
        return;
      }
      toast.success(describeResult(result), { duration: 8000 });
      if (result.failed > 0) toast.warning(`${result.failed} empresa(s) no se pudieron procesar; se reintentan en la próxima.`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Error inesperado al completar con Claude');
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
          <Sparkles className="h-3.5 w-3.5" />
          Completar con Claude
        </Button>
      }
      icon={Sparkles}
      title="¿Completar este lote con Claude?"
      description="Es el mismo rescate que corre solo al terminar cada búsqueda. Sirve para lo que quedó pendiente."
      confirmLabel={loading ? 'Completando…' : 'Completar'}
      loading={loading}
      onConfirm={handleConfirm}
      className="sm:max-w-md"
    >
      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
        <li>Si Claude completa los datos y la empresa cumple, queda en Candidatos por revisar.</li>
        <li>Si Claude demuestra con fuente que no cumple, pasa a Descartadas con el motivo.</li>
        <li>Nada se aprueba solo. Costo aproximado: US$0,035 por empresa.</li>
      </ul>
    </ConfirmDialog>
  );
}
