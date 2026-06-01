'use client';

/**
 * DENUE Preview Batch Panel — Hito 16AF.2
 *
 * Permite crear un lote preview controlado desde el detalle de la fuente DENUE.
 * Máximo 5 candidatos. No aprueba, no convierte, no sincroniza HubSpot.
 */

import { useState, useTransition } from 'react';
import { Database, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SurfaceCard } from '@/components/shared/surface-card';
import { createDenuePreviewBatchAction } from '@/modules/source-catalog/denue-batches-actions';
import type { DenuePreviewBatchResult } from '@/modules/source-catalog/denue-batches-actions';

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
    <SurfaceCard>
      <h2 className="text-[0.8125rem] font-semibold text-foreground font-heading mb-4 flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground/70" />
        Crear lote preview
      </h2>

      <p className="text-sm text-muted-foreground mb-4">
        Crea un lote controlado con candidatos aceptados del dry-run DENUE. No aprueba,
        no convierte ni sincroniza con HubSpot. Máximo 5 candidatos por ejecución.
      </p>

      {!isAdmin && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
          Solo administradores pueden crear lotes preview.
        </p>
      )}

      {isAdmin && !hasStoredCredential && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
          Configura la credencial DENUE antes de crear un lote preview.
        </p>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={handleCreate}
        disabled={!canCreate || isPending}
        className="gap-2"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Database className="h-3.5 w-3.5" />
        )}
        {isPending ? 'Creando lote...' : 'Crear lote preview'}
      </Button>

      {result && (
        <div className="mt-5 space-y-3">
          {/* Estado */}
          <div className="flex items-start gap-2">
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <p className="text-sm text-foreground">{result.message}</p>
          </div>

          {/* Detalle si fue exitoso */}
          {result.ok && result.batchId && (
            <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 space-y-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                    Batch ID
                  </dt>
                  <dd className="font-mono text-foreground break-all">{result.batchId}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                    Candidatos escritos
                  </dt>
                  <dd className="font-medium text-foreground tabular-nums">{result.candidatesWritten}</dd>
                </div>
                {result.candidatesSkipped > 0 && (
                  <div>
                    <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">
                      Omitidos (novedad)
                    </dt>
                    <dd className="font-medium text-muted-foreground tabular-nums">{result.candidatesSkipped}</dd>
                  </div>
                )}
              </dl>
              <p className="text-[11px] text-muted-foreground border-t border-border/30 pt-2 mt-2">
                Lote en estado <span className="font-medium text-foreground">ready_for_review</span>. Valida con SQL usando el Batch ID. Después del QA ejecutar rollback lógico.
              </p>
            </div>
          )}

          {/* Error técnico */}
          {result.error && (
            <p className="text-xs text-destructive font-mono break-all">{result.error}</p>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
