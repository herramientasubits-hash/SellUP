'use client';

/**
 * DENUE Preview Batch Panel — Hito 16AF.2
 *
 * Permite crear un lote preview controlado desde el detalle de la fuente DENUE.
 * Máximo 5 candidatos. No aprueba, no convierte, no sincroniza HubSpot.
 */

import { useState, useTransition } from 'react';
import { Database, Loader2, CheckCircle2, XCircle, AlertTriangle } from "@/icons";
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
      <div className="mb-5 flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-border/40">
          <Database className="h-4 w-4" />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold leading-tight tracking-tight text-foreground">
            Crear lote preview
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Crea un lote controlado con candidatos aceptados del dry-run DENUE. No aprueba,
            no convierte ni sincroniza con HubSpot. Máximo 5 candidatos por ejecución.
          </p>
        </div>
      </div>

      {!isAdmin && (
        <p className="mb-4 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-xs text-warning">
          Solo administradores pueden crear lotes preview.
        </p>
      )}

      {isAdmin && !hasStoredCredential && (
        <p className="mb-4 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3 text-xs text-warning">
          Configura la credencial DENUE antes de crear un lote preview.
        </p>
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
        <div className="mt-5 space-y-3">
          {/* Estado */}
          <div className="flex items-start gap-2">
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            )}
            <p className="min-w-0 break-words text-sm text-foreground">{result.message}</p>
          </div>

          {/* Detalle si fue exitoso */}
          {result.ok && result.batchId && (
            <div className="space-y-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                    Batch ID
                  </dt>
                  <dd className="font-mono text-foreground break-all">{result.batchId}</dd>
                </div>
                <div>
                  <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                    Candidatos escritos
                  </dt>
                  <dd className="font-medium text-foreground tabular-nums">{result.candidatesWritten}</dd>
                </div>
                {result.candidatesSkipped > 0 && (
                  <div>
                    <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                      Omitidos (novedad)
                    </dt>
                    <dd className="font-medium text-muted-foreground tabular-nums">{result.candidatesSkipped}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-2 border-t border-border/50 pt-2 text-xs leading-relaxed text-muted-foreground">
                Lote en estado <span className="font-medium text-foreground">ready_for_review</span>. Valida con SQL usando el Batch ID. Después del QA ejecutar rollback lógico.
              </p>
            </div>
          )}

          {/* Error técnico */}
          {result.error && (
            <p className="break-all rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">{result.error}</p>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="space-y-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-warning">
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
