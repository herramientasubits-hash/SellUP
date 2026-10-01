'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2 } from "@/icons";
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
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Sparkles className="h-3.5 w-3.5" />
            Completar con Claude
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pt-2">
          <DialogTitle>¿Completar este lote con Claude?</DialogTitle>
          <DialogDescription>
            Es el mismo rescate que corre solo al terminar cada búsqueda. Sirve para lo que quedó pendiente.
          </DialogDescription>
        </DialogHeader>
        <div>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Si Claude completa los datos y la empresa cumple, queda en Candidatos por revisar.</li>
            <li>Si Claude demuestra con fuente que no cumple, pasa a Descartadas con el motivo.</li>
            <li>Nada se aprueba solo. Costo aproximado: US$0,035 por empresa.</li>
          </ul>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" disabled={loading} onClick={handleClose} />}>
            Cancelar
          </DialogClose>
          <Button size="sm" onClick={handleConfirm} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Completando…
              </>
            ) : (
              'Completar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
