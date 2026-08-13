import type { ContactCandidateStatus } from './types';

/**
 * AGENT2A-PHONE-REVEAL-4O-H3-B-R1 — estados en los que un candidato sigue siendo REVISABLE.
 *
 * Hasta este hito el detalle sólo admitía `pending_review`, así que un candidato que la detección
 * de duplicados acababa de mover a `duplicate` dejaba de poder abrirse — y con él desaparecía la
 * decisión humana de H3-B. `duplicate` NO es terminal desde el punto de vista de la revisión: es
 * justamente el estado que ESPERA una decisión.
 *
 * La lista es EXPLÍCITA a propósito. No se admite «cualquier estado no nulo»: `approved` y
 * `discarded` siguen fuera, y añadir uno nuevo exige tocar esta constante (y el ratchet que la
 * fija en los tests).
 *
 * Vive aquí y no en `actions.ts` porque ese módulo es `'use server'`, y un módulo de server
 * actions sólo puede exportar funciones asíncronas: exportar la constante desde allí rompe el
 * build ("A 'use server' file can only export async functions, found object").
 */
export const REVIEWABLE_CONTACT_CANDIDATE_STATUSES = [
  'pending_review',
  'duplicate',
] as const satisfies readonly ContactCandidateStatus[];
