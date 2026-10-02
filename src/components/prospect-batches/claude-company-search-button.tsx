'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search } from '@/icons';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  searchCompaniesWithClaudeAction,
  type ClaudeCompanySearchActionResult,
} from '@/modules/prospect-batches/claude-classifier-actions';

const ERROR_MESSAGES: Record<string, string> = {
  disabled: 'La búsqueda con Claude no está habilitada.',
  unauthorized: 'Sólo un admin puede usar la búsqueda con Claude.',
  invalid_batch: 'Lote inválido.',
  source_batch_not_found: 'No se pudo leer el país y la industria de este lote.',
  model_not_configured: 'Configura Claude (Anthropic) como proveedor activo en Configuración → IA.',
  quota_exhausted: 'La cuota mensual configurada para Anthropic está agotada.',
  search_failed: 'La búsqueda con Claude falló. No se escribió nada.',
  write_failed: 'Claude encontró empresas pero no se pudieron guardar.',
};

function describeResult(result: Extract<ClaudeCompanySearchActionResult, { ok: true }>): string {
  const cost = `costo estimado US$${result.estimatedCostUsd.toFixed(2)}`;
  if (!result.batchId) return `Claude no encontró empresas nuevas que pasaran el primer filtro · ${cost}`;
  return `${result.candidatesCreated} empresas nuevas de ${result.passedPreFilter} propuestas verificadas · ${cost}`;
}

/** Piloto: Claude busca más empresas del mismo país e industria, en un lote nuevo. */
export function ClaudeCompanySearchButton({ batchId }: { batchId: string }) {
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
      const result = await searchCompaniesWithClaudeAction(batchId);
      if (!result.ok) {
        toast.error(ERROR_MESSAGES[result.error] ?? 'No se pudo buscar con Claude.');
        return;
      }
      toast.success(describeResult(result), { duration: 10000 });
      setOpen(false);
      if (result.batchId) router.push(`/prospect-batches/${result.batchId}`);
      else router.refresh();
    } catch {
      toast.error('Error inesperado al buscar con Claude');
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
          <Search className="h-3.5 w-3.5" />
          Buscar más con Claude
        </Button>
      }
      icon={Search}
      title="¿Buscar más empresas con Claude?"
      description="Piloto: Claude busca en la web empresas del mismo país e industria que este lote."
      confirmLabel={loading ? 'Buscando…' : 'Buscar'}
      loading={loading}
      onConfirm={handleConfirm}
      className="sm:max-w-md"
    >
      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
        <li>Sólo cuentan las empresas cuyo sitio salió en la búsqueda; las ya vistas en SellUp se saltan.</li>
        <li>Pasan por los mismos filtros de siempre y quedan en un lote nuevo, en Candidatos por revisar.</li>
        <li>Nada se aprueba solo. Puede tardar 1–2 minutos. Costo aproximado: US$0,20–0,40 por búsqueda.</li>
      </ul>
    </ConfirmDialog>
  );
}
