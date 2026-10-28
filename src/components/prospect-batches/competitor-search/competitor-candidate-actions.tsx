'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Sparkles, Users } from '@/icons';
import { getAgentRunsStore, executeWizardRunViaRoute } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import {
  findMoreLikeThisAction,
  prepareCompetitorOfCompetitorRunAction,
} from '@/modules/prospect-batches/competitor-search/more-like-this-actions';
import { verifyCompetitorSizeAction } from '@/modules/prospect-batches/competitor-search/size-verify-actions';

/**
 * Agente 1 · «Competidores» — acciones sobre una competidora (Fase C/D, 21-10).
 * Las dos que gastan Apollo («Más como esta», «Verificar tamaño») sólo corren con
 * un clic y lo dicen en su título (decisión de la dueña 21-10).
 */

/** «Más como esta» y «Sus competidores», en la ficha de una competidora. */
export function CompetitorCandidateActions({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<'more' | 'expand' | null>(null);

  const findMore = async () => {
    setPending('more');
    try {
      const result = await findMoreLikeThisAction({ candidateId });
      if (result.ok) {
        toast.success(result.message);
        if (result.persistedCount > 0) router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('No se pudo buscar. Intenta de nuevo.');
    } finally {
      setPending(null);
    }
  };

  const expand = async () => {
    setPending('expand');
    try {
      const prepared = await prepareCompetitorOfCompetitorRunAction({ candidateId });
      if (!prepared.ok) {
        toast.error(prepared.message);
        return;
      }
      const store = getAgentRunsStore();
      const run = store
        ? store.startRun({ title: prepared.title, concurrencyKey: prepared.concurrencyKey, payload: prepared.payload })
        : executeWizardRunViaRoute(prepared.payload);
      // Termina por su cuenta: su resultado vive en el Centro de procesos.
      void run.catch(() => undefined);
      toast.success('Buscando sus competidores: lo verás en el Centro de procesos.');
    } catch {
      toast.error('No se pudo empezar la búsqueda. Intenta de nuevo.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending !== null}
        aria-busy={pending === 'more' || undefined}
        title="Busca empresas parecidas a esta (unos 2 créditos)"
        onClick={() => void findMore()}
      >
        {pending === 'more' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        Más como esta
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending !== null}
        aria-busy={pending === 'expand' || undefined}
        title="Nueva búsqueda de competidores con esta empresa como referencia"
        onClick={() => void expand()}
      >
        {pending === 'expand' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Users aria-hidden="true" />}
        Sus competidores
      </Button>
    </div>
  );
}

/** «Verificar tamaño» de una competidora pequeña (1 crédito de Apollo). */
export function VerifyCompetitorSizeButton({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const verify = async () => {
    setPending(true);
    try {
      const result = await verifyCompetitorSizeAction({ candidateId });
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('No se pudo verificar el tamaño. Intenta de nuevo.');
    } finally {
      setPending(false);
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-busy={pending || undefined}
      title="Confirma el número de empleados (1 crédito)"
      onClick={() => void verify()}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
      Verificar tamaño
    </Button>
  );
}
