'use client';

/**
 * DENUE Preview Batch Panel — Hito 16AF.2
 *
 * Permite crear un lote preview controlado desde el detalle de la fuente DENUE.
 * Máximo 5 candidatos. No aprueba, no convierte, no sincroniza HubSpot.
 */

import { useState, useTransition } from 'react';
import { Database, Loader2 } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { createDenuePreviewBatchAction } from '@/modules/source-catalog/denue-batches-actions';
import type { DenuePreviewBatchResult } from '@/modules/source-catalog/denue-batches-actions';
import { PanelSummary, PanelSummaryItem, PanelWarnings, SourcePanel } from './source-panel-parts';

type Props = {
  hasStoredCredential: boolean;
  isAdmin: boolean;
};

export function DenuePreviewBatchPanel({ hasStoredCredential, isAdmin }: Props) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<DenuePreviewBatchResult | null>(null);

  const canCreate = isAdmin && hasStoredCredential;

  function handleCreate() {
    setResult(null);
    startTransition(async () => {
      const res = await createDenuePreviewBatchAction();
      setResult(res);
    });
  }

  return (
    <SourcePanel
      icon={Database}
      title="Crear lote preview"
      description="Crea un lote controlado con candidatos aceptados del dry-run DENUE. No aprueba, no convierte ni sincroniza con HubSpot. Máximo 5 candidatos por ejecución."
    >
      {!isAdmin && <Alert variant="warning">Solo administradores pueden crear lotes preview.</Alert>}

      {isAdmin && !hasStoredCredential && (
        <Alert variant="warning">Configura la credencial DENUE antes de crear un lote preview.</Alert>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleCreate}
        disabled={!canCreate || isPending}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Database className="h-3.5 w-3.5" />
        )}
        {isPending ? 'Creando lote...' : 'Crear lote preview'}
      </Button>

      {result && (
        <div className="space-y-3">
          <Alert variant={result.ok ? 'success' : 'destructive'}>
            <AlertTitle className="break-words">{result.message}</AlertTitle>
            {result.error && (
              <AlertDescription className="break-all font-mono text-xs">{result.error}</AlertDescription>
            )}
          </Alert>

          {result.ok && result.batchId && (
            <>
              <PanelSummary columns={3}>
                <PanelSummaryItem mono label="Batch ID" value={result.batchId} />
                <PanelSummaryItem label="Candidatos escritos" value={result.candidatesWritten} />
                {result.candidatesSkipped > 0 && (
                  <PanelSummaryItem label="Omitidos (novedad)" value={result.candidatesSkipped} />
                )}
              </PanelSummary>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Lote en estado <span className="font-medium text-foreground">ready_for_review</span>. Valida con SQL usando el Batch ID. Después del QA ejecutar rollback lógico.
              </p>
            </>
          )}

          <PanelWarnings warnings={result.warnings} />
        </div>
      )}
    </SourcePanel>
  );
}
