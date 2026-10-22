'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2 } from '@/icons';
import { setCompetitorReferenceFollowAction } from '@/modules/prospect-batches/competitor-search/watch-actions';

/**
 * «Seguir esta referencia» (migración 156): los lunes llega a la campana cuántas
 * competidoras nuevas trajo el equipo. No busca ni gasta.
 */
export function CompetitorFollowButton({ batchId, initialFollowing }: { batchId: string; initialFollowing: boolean }) {
  const [following, setFollowing] = React.useState(initialFollowing);
  const [pending, setPending] = React.useState(false);
  const toggle = async () => {
    setPending(true);
    try {
      const result = await setCompetitorReferenceFollowAction({ batchId, follow: !following });
      if (result.ok) {
        setFollowing(result.following);
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setPending(false);
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant={following ? 'secondary' : 'outline'}
      disabled={pending}
      aria-pressed={following}
      aria-busy={pending || undefined}
      title="Aviso semanal en la campana con las competidoras nuevas"
      onClick={() => void toggle()}
    >
      {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
      {following ? 'Siguiendo' : 'Seguir esta referencia'}
    </Button>
  );
}
