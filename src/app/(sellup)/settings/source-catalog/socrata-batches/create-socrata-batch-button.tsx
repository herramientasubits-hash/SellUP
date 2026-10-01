'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from "@/icons";
import { Alert } from '@/components/ui/alert';
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
        <Alert variant="destructive" className="max-w-sm text-left">
          <span className="min-w-0 break-words">{errorMsg}</span>
        </Alert>
      )}
    </div>
  );
}
