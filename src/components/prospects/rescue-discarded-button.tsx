'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from '@/icons';
import { Button } from '@/components/ui/button';
import { rescueDiscardedWithClaudeAction } from '@/modules/prospect-discards/rescue-discarded-actions';

export const RESCUE_DISCARDED_LABEL = 'Rescatar con IA';

/**
 * Dueña 14-11 — un administrador lanza el rescate con IA sobre todas las
 * descartadas rescatables. Corre en segundo plano; lo que pasa vuelve a revisión
 * en su búsqueda (de quien la hizo).
 */
export function RescueDiscardedButton() {
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    try {
      const result = await rescueDiscardedWithClaudeAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.companies === 0) {
        toast.info('No hay descartadas que la IA pueda rescatar ahora.');
        return;
      }
      if (result.scheduled < result.batches) {
        toast.warning(
          `La IA empezó con ${result.scheduled} de ${result.batches} búsquedas. Vuelve a intentarlo en unos minutos para las demás.`,
        );
        return;
      }
      toast.success(
        `La IA está revisando ${result.companies} empresas de ${result.batches} ${result.batches === 1 ? 'búsqueda' : 'búsquedas'}. Las que pasen aparecerán en Por revisar de quien hizo cada búsqueda.`,
      );
    } catch (err) {
      console.error('[claude-rescue] action failed:', err);
      toast.error('No se pudo lanzar la revisión. Intenta de nuevo.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={pending} aria-busy={pending || undefined}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      {RESCUE_DISCARDED_LABEL}
    </Button>
  );
}
