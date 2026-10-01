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
        setErrorMsg(result.message ?? 'No se pudo crear el lote. Inténtalo de nuevo.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" size="sm" onClick={handleClick} disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            Creando lote…
          </>
        ) : (
          <>
            <Plus aria-hidden />
            Crear lote de prueba
          </>
        )}
      </Button>

      {errorMsg && (
        <div role="alert" className="flex max-w-sm items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
          <p className="min-w-0 break-words text-xs font-medium text-destructive">{errorMsg}</p>
        </div>
      )}
    </div>
  );
}
