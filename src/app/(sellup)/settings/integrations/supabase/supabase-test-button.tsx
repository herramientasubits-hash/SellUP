'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from '@/icons';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  testSupabaseConnectionAction,
  type TestSupabaseConnectionResult,
} from '@/modules/storage-usage/actions';

/** «Probar conexión» y, de paso, volver a medir el espacio (refresca la página). */
export function SupabaseTestConnectionButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<TestSupabaseConnectionResult | null>(null);

  function handleTest() {
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await testSupabaseConnectionAction());
      } catch {
        setResult({ ok: false, message: 'No se pudo probar la conexión. Intenta de nuevo.' });
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleTest} disabled={isPending}>
        {isPending && <Loader2 className="animate-spin" />}
        Probar conexión y volver a medir
      </Button>
      {result && <Alert variant={result.ok ? 'success' : 'destructive'}>{result.message}</Alert>}
    </div>
  );
}
