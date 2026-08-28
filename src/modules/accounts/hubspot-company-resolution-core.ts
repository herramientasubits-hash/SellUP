// Agente 2A — Qué hacer con la empresa de una cuenta, dado el resultado de la búsqueda en
// HubSpot (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// Núcleo PURO: no llama a HubSpot, no llama a Supabase. Recibe el veredicto YA calculado por
// `checkHubSpotCompanyCommercialStatus` (que sigue siendo la única autoridad sobre CÓMO se
// decide una coincidencia) y sólo traduce ESE veredicto a una acción para el flujo de
// aprobación de contacto — que es una pregunta distinta de la que resuelve el checker.
//
// Deliberadamente NO reutiliza `attemptHubSpotSync` (prospect-batches/actions.ts): esa función
// tiene reglas propias de prospección masiva (NIT obligatorio en Colombia, guardas de
// liquidación) que no aplican a una cuenta que YA es cliente activo de SellUp con un contacto
// recién aprobado.

import type { HubspotMatchStatus } from '@/server/agents/prospecting-toolkit/structured-candidate-types';

export type HubSpotCompanyResolutionAction = 'create' | 'block_silent' | 'pending_review';

export interface HubSpotCompanyResolutionResult {
  action: HubSpotCompanyResolutionAction;
}

/**
 * `possible_match_requires_review` es el ÚNICO estado que pausa a esperar una decisión humana.
 * Todo lo demás que no sea `no_match` se bloquea en silencio, exactamente igual que hoy en el
 * flujo de prospectos — este hito no amplía esa parte.
 */
export function classifyHubSpotCompanyResolution(input: {
  hubspotMatchStatus: HubspotMatchStatus;
}): HubSpotCompanyResolutionResult {
  if (input.hubspotMatchStatus === 'no_match') return { action: 'create' };
  if (input.hubspotMatchStatus === 'possible_match_requires_review') {
    return { action: 'pending_review' };
  }
  return { action: 'block_silent' };
}
