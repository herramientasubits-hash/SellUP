// HUBSPOT-ACCOUNT-SYNC-1 — Completado de empresas existentes (núcleo puro)
//
// SellUp trabajó primero contra un sandbox de HubSpot y después contra el HubSpot real.
// Ninguna empresa guardó de qué portal vino su `hubspot_company_id`, así que la única
// prueba fiable es preguntarle al HubSpot real: si contesta 404, el ID era del sandbox.
// Este núcleo decide qué hacer con cada empresa a partir de esas respuestas.

export type CurrentHubSpotIdStatus = 'found' | 'not_found' | 'unavailable' | 'none';

export type HubSpotLinkDecision =
  /** El ID actual existe en el HubSpot real: se queda. */
  | { action: 'keep'; hubspotCompanyId: string }
  /** El ID no existe (sandbox) o faltaba, y hay UNA empresa real con el mismo dominio. */
  | { action: 'relink'; hubspotCompanyId: string; previousHubspotCompanyId: string | null }
  /** Varias empresas reales con ese dominio: lo decide una persona. */
  | { action: 'review'; candidateIds: string[]; previousHubspotCompanyId: string | null }
  /** No existe en el HubSpot real. Crearla allí es una decisión aparte. */
  | { action: 'missing_in_hubspot'; previousHubspotCompanyId: string | null }
  /** HubSpot no respondió: no se toca nada. */
  | { action: 'unavailable' };

export function decideHubSpotLink(input: {
  currentHubspotCompanyId: string | null;
  currentStatus: CurrentHubSpotIdStatus;
  /** IDs del HubSpot real con dominio EXACTO; `null` si no se buscó o no hay dominio. */
  domainMatchIds: string[] | null;
}): HubSpotLinkDecision {
  const previous = input.currentHubspotCompanyId;
  if (input.currentStatus === 'found' && previous) {
    return { action: 'keep', hubspotCompanyId: previous };
  }
  if (input.currentStatus === 'unavailable') return { action: 'unavailable' };

  const ids = [...new Set(input.domainMatchIds ?? [])];
  if (ids.length === 1) {
    return { action: 'relink', hubspotCompanyId: ids[0], previousHubspotCompanyId: previous };
  }
  if (ids.length > 1) {
    return { action: 'review', candidateIds: ids, previousHubspotCompanyId: previous };
  }
  return { action: 'missing_in_hubspot', previousHubspotCompanyId: previous };
}

/** Quién buscó la empresa, en orden de evidencia. */
export function pickBackfillSearcher(input: {
  contactSearchTriggeredBy: string | null;
  agent1BatchCreatedBy: string | null;
  accountCreatedBy: string | null;
}): string | null {
  return input.contactSearchTriggeredBy ?? input.agent1BatchCreatedBy ?? input.accountCreatedBy ?? null;
}
