'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { createSocrataRuesPreviewBatchAction } from '@/modules/source-catalog/socrata-batches-actions';

export function CreateSocrataBatchButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleClick() {
    setErrorMsg(null);
    startTransition(async () => {
      const result = await createSocrataRuesPreviewBatchAction();
      if (result.ok && result.batchId) {
        router.push(
          `/settings/source-catalog/socrata-batches/${result.batchId}`,
        );
      } else {
        setErrorMsg(result.message ?? 'Error desconocido al crear el lote.');
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">
        Crea hasta 3 candidatos en modo preview. No aprueba, no asigna y no
        sincroniza con HubSpot.
      </p>

      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md bg-su-brand-soft px-3 py-1.5 text-xs font-medium text-su-brand transition-colors hover:bg-su-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Creando lote…
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Crear lote RUES de prueba
          </>
        )}
      </button>

      {errorMsg && (
        <div className="flex items-start gap-1.5">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <p className="text-xs text-destructive">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}
