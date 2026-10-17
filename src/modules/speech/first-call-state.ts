/**
 * Agente 3 · Primera llamada — reglas puras sobre lo que está guardado.
 */

import type { ResearchBrief } from '@/server/agents/first-call/types';

/** ¿La investigación sirve todavía (suficiente o parcial, no vencida)? Un paquete nuevo no paga otra. */
export function isBriefFresh(
  brief: Pick<ResearchBrief, 'status' | 'expiresAt'> | null,
  nowMs: number,
): boolean {
  return (
    !!brief &&
    (brief.status === 'sufficient' || brief.status === 'partial') &&
    !!brief.expiresAt &&
    Date.parse(brief.expiresAt) > nowMs
  );
}
