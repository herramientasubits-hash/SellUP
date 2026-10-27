// «Agregar empresa» (el BD, a mano) no deja entrar basura: sin sitio web ni NIT no hay
// forma de saber si la empresa ya existe, y lo que ya está en SellUp o en HubSpot no se
// duplica. Aquí están las reglas, sin red, para poder probarlas; la acción las cablea.

import type { HubspotMatchStatus } from '@/server/agents/prospecting-toolkit/structured-candidate-types';

export const MANUAL_ACCOUNT_MESSAGES = {
  missingIdentity: 'Agrega el sitio web o el NIT: sin uno de los dos no podemos saber si la empresa ya existe.',
  existsVisible: (name: string | null) =>
    `${name ? `«${name}»` : 'Esta empresa'} ya está en SellUp. Ábrela en vez de crearla de nuevo.`,
  existsOtherSeller: 'Esta empresa ya está en SellUp y la lleva otro vendedor.',
  hubspotCustomer: 'Esta empresa ya es cliente en HubSpot: no se agrega como prospecto.',
  hubspotActive: 'Esta empresa ya la está trabajando un vendedor en HubSpot. Si es tuya, pide que te la asignen.',
  hubspotLinked: 'Ya existía en HubSpot: quedó vinculada a esa empresa, no se creó otra.',
  hubspotPossible: 'Hay una empresa parecida en HubSpot. Se revisa antes de mandar su primer contacto.',
  hubspotUnavailable: 'No pudimos revisar HubSpot ahora. Se revisa antes de mandar su primer contacto.',
} as const;

/** Sin dominio ni NIT no hay con qué buscar duplicados. */
export function manualAccountIdentityError(keys: { domain: string | null; taxIdentifier: string | null }): string | null {
  return keys.domain || keys.taxIdentifier?.trim() ? null : MANUAL_ACCOUNT_MESSAGES.missingIdentity;
}

export type ManualAccountHubSpotDecision =
  | { kind: 'create'; notice: string | null }
  | { kind: 'link'; hubspotCompanyId: string; notice: string }
  | { kind: 'block'; error: string };

/**
 * Qué hacer con lo que HubSpot dice de la empresa:
 *  - cliente o prospecto activo de alguien ⇒ no se agrega;
 *  - prospecto reciclable o ex cliente ⇒ se agrega VINCULADA a esa empresa (no se duplica);
 *  - parecida o sin respuesta ⇒ se agrega sin vincular; la guarda antes de crear en HubSpot
 *    (al aprobar su primer contacto) vuelve a buscar y falla cerrada.
 */
export function decideManualAccountHubSpot(check: {
  hubspotMatchStatus: HubspotMatchStatus;
  match: { hubspotCompanyId: string } | null;
}): ManualAccountHubSpotDecision {
  switch (check.hubspotMatchStatus) {
    case 'no_match':
      return { kind: 'create', notice: null };
    case 'exact_match_customer':
      return { kind: 'block', error: MANUAL_ACCOUNT_MESSAGES.hubspotCustomer };
    case 'exact_match_prospect_active':
      return { kind: 'block', error: MANUAL_ACCOUNT_MESSAGES.hubspotActive };
    case 'exact_match_prospect_recyclable':
    case 'exact_match_ex_customer':
      return check.match
        ? { kind: 'link', hubspotCompanyId: check.match.hubspotCompanyId, notice: MANUAL_ACCOUNT_MESSAGES.hubspotLinked }
        : { kind: 'create', notice: MANUAL_ACCOUNT_MESSAGES.hubspotPossible };
    case 'possible_match_requires_review':
      return { kind: 'create', notice: MANUAL_ACCOUNT_MESSAGES.hubspotPossible };
    default:
      return { kind: 'create', notice: MANUAL_ACCOUNT_MESSAGES.hubspotUnavailable };
  }
}
