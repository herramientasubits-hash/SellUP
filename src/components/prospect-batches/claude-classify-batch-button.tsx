'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2 } from 'lucide-react';
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
  classifyBatchCandidatesWithClaudeAction,
  type ClaudeClassifierActionResult,
} from '@/modules/prospect-batches/claude-classifier-actions';
import { CLASSIFIER_MAX_COMPANIES_PER_RUN } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates';

interface ClaudeClassifyBatchButtonProps {
  batchId: string;
  /** Candidatos «para revisión» a los que les falta sector o tamaño y aún no tienen sugerencia. */
  eligibleCount: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  disabled: 'El clasificador con Claude no está habilitado.',
  unauthorized: 'Sólo un admin puede usar el clasificador.',
  invalid_batch: 'Lote inválido.',
  model_not_configured: 'Configura Claude (Anthropic) como proveedor activo en Configuración → IA.',
  quota_exhausted: 'La cuota mensual configurada para Anthropic está agotada.',
  catalog_unavailable: 'No se pudo leer el catálogo de industrias.',
  candidates_unavailable: 'No se pudieron leer los candidatos del lote.',
};

function describeResult(result: ClaudeClassifierActionResult): string {
  if (!result.ok) return ERROR_MESSAGES[result.error] ?? 'No se pudo clasificar.';
  const done = result.classified + result.partiallyClassified;
  const pending = result.remaining > 0 ? ` · faltan ${result.remaining}: pulsa otra vez para seguir` : '';
  return (
    `${done} con sugerencia · ${result.nothingVerifiable} sin datos verificables · ` +
    `${result.skipped} sin sitio accesible · costo estimado US$${result.estimatedCostUsd.toFixed(2)}${pending}`
  );
}

export function ClaudeClassifyBatchButton({ batchId, eligibleCount }: ClaudeClassifyBatchButtonProps) {
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
      const result = await classifyBatchCandidatesWithClaudeAction(batchId);
      if (!result.ok) {
        toast.error(describeResult(result));
        return;
      }
      toast.success(describeResult(result), { duration: 7000 });
      if (result.failed > 0 || result.saveFailures > 0) {
        toast.warning(`${result.failed + result.saveFailures} candidato(s) no se pudieron clasificar o guardar.`, {
          duration: 6000,
        });
      }
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Error inesperado al clasificar con Claude');
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
          >
            <Sparkles className="h-3.5 w-3.5" />
            Sugerir sector y tamaño
          </Button>
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pt-2">
          <DialogTitle>¿Sugerir sector y tamaño con Claude?</DialogTitle>
          <DialogDescription>
            Claude leerá el sitio de {eligibleCount} candidato(s) «para revisión» a los que les falta sector o tamaño,
            y dejará una sugerencia con su fuente. Máximo {CLASSIFIER_MAX_COMPANIES_PER_RUN} por vez.
            Costo aproximado: US$0,01 a US$0,05 por empresa.
          </DialogDescription>
        </DialogHeader>

        <div>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            <li>Sólo sugiere: no cambia el estado de ningún candidato.</li>
            <li>Cada dato trae su fuente; lo que no se puede verificar se descarta.</li>
            <li>El tamaño siempre es estimado.</li>
            <li>Usa el modelo de Configuración → IA y cuenta en el consumo de Anthropic.</li>
            <li>No toca HubSpot ni gasta créditos de Apollo o Lusha.</li>
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
                Clasificando…
              </>
            ) : (
              'Sugerir'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
