// La empresa de una cuenta llega a HubSpot (al aprobar un contacto, o cuando alguien decide
// «es otra empresa») pasando por la MISMA guarda que la aprobación de prospectos:
// `runHubSpotPreCreateGuard` — liquidación/inactividad, búsqueda en vivo justo antes del POST
// y falla cerrada. Aquí sólo se traduce su veredicto, sin red, para poder probarlo.

import type { HubSpotPreCreateGuardResult } from '@/modules/prospect-batches/hubspot-precreate-guard';

export type AccountPreCreateDecision =
  | { ok: true }
  /** La búsqueda en vivo encontró la empresa: no se crea, la decide una persona. */
  | { ok: false; error: 'blocked_duplicate'; liveMatch: { hubspotCompanyId: string; matchedBy: string[] } }
  | { ok: false; error: 'blocked_inactive_or_liquidation' | 'failed_lookup' };

/**
 * `rejectedCompanyIds`: las empresas de HubSpot que una persona ya dijo que NO son esta
 * (decisión «es otra empresa»). Si la búsqueda en vivo sólo encuentra esas, se crea; si
 * aparece cualquier otra, no.
 */
export function decideAccountPreCreate(
  guard: HubSpotPreCreateGuardResult,
  { rejectedCompanyIds = [] }: { rejectedCompanyIds?: readonly string[] } = {},
): AccountPreCreateDecision {
  if (guard.allowed) return { ok: true };
  if (guard.syncStatus !== 'blocked_duplicate') return { ok: false, error: guard.syncStatus };

  const others = guard.companyIds.filter((id) => !rejectedCompanyIds.includes(id));
  if (guard.companyIds.length > 0 && others.length === 0) return { ok: true };
  const first = others[0] ?? guard.companyIds[0];
  if (!first) return { ok: false, error: 'failed_lookup' };
  return { ok: false, error: 'blocked_duplicate', liveMatch: { hubspotCompanyId: first, matchedBy: guard.matchedBy } };
}
