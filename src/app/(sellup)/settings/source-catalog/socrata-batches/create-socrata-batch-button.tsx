'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, AlertCircle } from "@/icons";
import { Button } from '@/components/ui/button';
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
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Crea hasta 3 candidatos en modo preview. No aprueba, no asigna y no
        sincroniza con HubSpot.
      </p>

      <Button type="button" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            Creando lote…
          </>
        ) : (
          <>
            <Plus aria-hidden />
            Crear lote RUES de prueba
          </>
        )}
      </Button>

      {errorMsg && (
        <div className="flex w-full items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <p className="min-w-0 break-words text-xs font-medium text-destructive">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}
