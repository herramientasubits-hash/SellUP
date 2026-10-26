'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  classifyBatchCandidatesWithClaudeAction,
  type ClaudeClassifierActionResult,
} from '@/modules/prospect-batches/claude-classifier-actions';
import { CLASSIFIER_MAX_COMPANIES_PER_RUN } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates';
import { formatUSD } from '@/lib/format-money';

interface ClaudeClassifyBatchButtonProps {
  batchId: string;
  /** Candidatos «para revisión» a los que les falta sector o tamaño y aún no tienen sugerencia. */
  eligibleCount: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  disabled: 'La clasificación con IA no está habilitada.',
  unauthorized: 'Sólo un admin puede usar el clasificador.',
  invalid_batch: 'Lote inválido.',
  model_not_configured: 'Activa el proveedor de IA en Configuración → IA.',
  quota_exhausted: 'La cuota mensual de la IA está agotada.',
  catalog_unavailable: 'No se pudo leer el catálogo de industrias.',
  candidates_unavailable: 'No se pudieron leer los candidatos del lote.',
  // AUDIT-HARDENING-1 — candado por lote (WS2 § 11): un segundo clic no paga dos veces.
  in_progress: 'Ya hay una clasificación con IA en curso para esta búsqueda. Espera a que termine.',
  lock_unavailable: 'No se pudo comprobar si ya hay una clasificación en curso. Inténtalo en un momento.',
};

function describeResult(result: ClaudeClassifierActionResult): string {
  if (!result.ok) return ERROR_MESSAGES[result.error] ?? 'No se pudo clasificar.';
  const done = result.classified + result.partiallyClassified;
  const pending = result.remaining > 0 ? ` · faltan ${result.remaining}: pulsa otra vez para seguir` : '';
  return (
    `${done} con sugerencia · ${result.nothingVerifiable} sin datos verificables · ` +
    `${result.skipped} sin sitio accesible · costo estimado ${formatUSD(result.estimatedCostUsd)}${pending}`
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
      toast.error('No se pudo clasificar. Inténtalo de nuevo en un momento.');
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
          Sugerir sector y tamaño
        </Button>
      }
      icon={Sparkles}
      title="¿Sugerir sector y tamaño con IA?"
      description={
        <>
          La IA leerá el sitio de {eligibleCount} candidato(s) «para revisión» a los que les falta sector o tamaño,
          y dejará una sugerencia con su fuente. Máximo {CLASSIFIER_MAX_COMPANIES_PER_RUN} por vez.
          Costo aproximado: US$0,01 a US$0,05 por empresa.
        </>
      }
      confirmLabel={loading ? 'Clasificando…' : 'Sugerir'}
      loading={loading}
      onConfirm={handleConfirm}
      className="sm:max-w-md"
    >
      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
        <li>Sólo sugiere: no cambia el estado de ningún candidato.</li>
        <li>Cada dato trae su fuente; lo que no se puede verificar se descarta.</li>
        <li>El tamaño siempre es estimado.</li>
        <li>Usa el modelo de Configuración → IA y cuenta en el consumo de Anthropic.</li>
        <li>No toca HubSpot ni gasta créditos de Apollo o Lusha.</li>
      </ul>
    </ConfirmDialog>
  );
}
