'use server';

// Dueña 14-11 — «Claude tiene que revisar siempre todo lo que pueda para rescatarlo».
// Lanza el mismo rescate de siempre sobre TODAS las búsquedas que tienen descartadas
// rescatables sin revisar. Lo que pasa vuelve a revisión en el MISMO lote (de quien hizo
// la búsqueda) hasta 10 por búsqueda; el resto va al banco gratuito. Sólo administradores.
// La lógica vive en `rescue-pending-sweep.server.ts` (también la usa el cron diario).

import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { isAgent1ClaudeRescueEnabled } from '@/lib/feature-flags.server';
import { schedulePendingDiscardRescues } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-pending-sweep.server';

export type RescueDiscardedResult =
  | { ok: true; batches: number; companies: number; scheduled: number }
  | { ok: false; error: string };

export async function rescueDiscardedWithClaudeAction(): Promise<RescueDiscardedResult> {
  if (!isAgent1ClaudeRescueEnabled()) {
    return { ok: false, error: 'El rescate con IA está apagado.' };
  }
  const [me, isAdmin] = await Promise.all([getCurrentUser(), isCurrentUserAdmin()]).catch(() => [null, false] as const);
  if (!me || me.access_status !== 'active' || !isAdmin) {
    return { ok: false, error: 'Sólo un administrador puede lanzar el rescate.' };
  }
  const sweep = await schedulePendingDiscardRescues({ triggeredBy: me.id });
  if (!sweep) return { ok: false, error: 'No se pudieron leer las descartadas. Intenta de nuevo.' };
  return { ok: true, ...sweep };
}
