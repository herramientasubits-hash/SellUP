/**
 * hubspot-free-match.ts — una coincidencia con una empresa LIBRE de HubSpot deja de
 * ser «ya existe en HubSpot».
 *
 * HUBSPOT-FREE-POOL-SOURCE-1. Todos los modos del Agente 1 (Tavily, Apollo, Claude,
 * banco, árbol, competidores, proveedores, capa gratuita) preguntan por duplicados
 * con `checkCompanyDuplicate`, y todos leen la fuerza de la coincidencia con el
 * lector compartido (`strong-identity-duplicate-match`), que trata `new_candidate`
 * como «no es identidad». Por eso basta con cambiar el `status` AQUÍ, en un solo
 * sitio: ningún consumidor tiene que aprender una regla nueva.
 *
 * 🔴 Sólo una identidad FUERTE puede volverse «libre»: dominio exacto (92) o número
 * fiscal oficial probado (95). Un nombre parecido NO prueba que sea la misma empresa:
 * marcarlo libre enlazaría la cuenta (y el dueño) a una empresa ajena. Las
 * coincidencias débiles que apuntan a la MISMA ficha libre se marcan con ella (son la
 * misma empresa); las que apuntan a OTRA ficha se quedan como estaban y, con ellas,
 * la empresa sigue yendo a revisión humana.
 *
 * La evidencia no se pierde: la coincidencia conserva confianza, id y ficha, y lleva
 * `hubspotFreeToTake` para que el escritor guarde con qué ficha se enlaza al aprobar.
 *
 * Puro: sin red, sin env.
 */

import type { HubSpotAvailability } from '@/server/integrations/hubspot-free-company-policy';
import { HUBSPOT_FREE_REASON_LABEL } from '@/server/integrations/hubspot-free-company-policy';
import type { DuplicateCheckResult, DuplicateMatch, HubSpotFreeToTake } from './types';

/** Confianzas del checker de HubSpot que prueban identidad: fiscal oficial y dominio exacto. */
const STRONG_HUBSPOT_CONFIDENCES: ReadonlySet<number> = new Set([95, 92]);
const DUPLICATE_STATUSES: ReadonlySet<DuplicateMatch['status']> = new Set(['existing_in_hubspot', 'possible_duplicate']);

export function isStrongHubSpotIdentityMatch(match: DuplicateMatch): boolean {
  return (
    match.source === 'hubspot' &&
    match.status === 'existing_in_hubspot' &&
    STRONG_HUBSPOT_CONFIDENCES.has(match.confidence) &&
    Boolean(match.matchedId)
  );
}

function markFree(match: DuplicateMatch, free: HubSpotFreeToTake): DuplicateMatch {
  return {
    ...match,
    status: 'new_candidate',
    reason: `Libre en HubSpot (${HUBSPOT_FREE_REASON_LABEL[free.reason]}) — ${match.reason}`,
    hubspotFreeToTake: free,
  };
}

/**
 * Marca libres las coincidencias de las fichas libres. `availabilityOf` da el veredicto
 * de la regla para una coincidencia FUERTE (o `null` si no se pudo decidir).
 */
export function markFreeHubSpotMatchesPure(
  matches: readonly DuplicateMatch[],
  availabilityOf: (match: DuplicateMatch) => { availability: HubSpotAvailability | null; ownerId: string | null },
): DuplicateMatch[] {
  const freeById = new Map<string, HubSpotFreeToTake>();
  for (const match of matches) {
    if (!isStrongHubSpotIdentityMatch(match)) continue;
    const { availability, ownerId } = availabilityOf(match);
    if (availability?.free) {
      freeById.set(match.matchedId as string, { hubspotCompanyId: match.matchedId as string, reason: availability.reason, ownerId });
    }
  }
  if (freeById.size === 0) return [...matches];
  return matches.map((match) => {
    const free = match.source === 'hubspot' && match.matchedId ? freeById.get(match.matchedId) : undefined;
    return free && DUPLICATE_STATUSES.has(match.status) ? markFree(match, free) : match;
  });
}

/**
 * La empresa libre de este resultado, si la hay y si NADA más la bloquea: ni una
 * empresa de SellUp, ni otra ficha de HubSpot (tomada o sólo parecida).
 */
export function resolveHubSpotFreeToTake(
  status: DuplicateCheckResult['status'],
  matches: readonly DuplicateMatch[],
): HubSpotFreeToTake | undefined {
  if (status === 'existing_in_hubspot' || status === 'existing_in_sellup' || status === 'possible_duplicate') {
    return undefined;
  }
  const free = matches.find((match) => match.hubspotFreeToTake)?.hubspotFreeToTake;
  if (!free) return undefined;
  const otherHubSpotEvidence = matches.some(
    (match) =>
      match.source === 'hubspot' && !match.hubspotFreeToTake && DUPLICATE_STATUSES.has(match.status),
  );
  return otherHubSpotEvidence ? undefined : free;
}
