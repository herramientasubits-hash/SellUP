/**
 * hubspot-free-pool-approval.ts — qué ficha de HubSpot se enlaza al APROBAR una
 * empresa que estaba libre en HubSpot, y si se le cambia el dueño.
 *
 * HUBSPOT-FREE-POOL-SOURCE-1. Dos reglas:
 *
 *   1. NUNCA se crea en HubSpot una empresa que ya está allí. La ficha sale de la
 *      marca que dejó el escritor (`metadata.hubspot_free_pool`) o, si la empresa
 *      entró por una capa que no la guardó (registros oficiales por país), de una
 *      búsqueda por dominio EXACTO justo antes de crear. Dos fichas con el mismo
 *      dominio ⇒ ambigüedad: no se enlaza ni se crea a ciegas (revisión humana).
 *   2. El dueño en HubSpot sólo cambia si, comprobado EN ESE MOMENTO, la empresa
 *      sigue libre. Si alguien la tomó por HubSpot mientras tanto, se enlaza pero
 *      no se le quita.
 *
 * Núcleo puro + puertas inyectadas: sin red, sin env.
 */

import type { HubSpotAvailability } from '@/server/integrations/hubspot-free-company-policy';

export type FreePoolApprovalInput = {
  candidateMetadata: Record<string, unknown> | null | undefined;
  /** Ficha ya enlazada por el flujo de siempre (coincidencia previa). */
  matchedCompanyId: string | null | undefined;
  /** Estado del chequeo de HubSpot guardado en el candidato (`possible_match`…). */
  hubspotCheckStatus: string | null | undefined;
  name: string | null | undefined;
  domain: string | null | undefined;
  taxIdentifier: string | null | undefined;
  countryCode: string | null | undefined;
};

/** Una ficha de HubSpot que es la MISMA empresa (dominio exacto o fiscal probado). */
export type StrongHubSpotIdentity = {
  hubspotCompanyId: string;
  /** Libre ahora (con su motivo) o `null` si la tiene alguien. */
  freeReason: 'recycled' | 'pool_owner' | 'no_owner' | 'deactivated_owner' | null;
};

export type FreePoolApprovalPorts = {
  /**
   * El chequeo de duplicados de siempre (fiscal, dominio, nombre) contra HubSpot, en
   * ese momento. `null` ⇒ HubSpot no respondió.
   */
  findStrongHubSpotIdentities: (input: {
    name: string;
    domain: string | null;
    taxIdentifier: string | null;
    countryCode: string | null;
  }) => Promise<StrongHubSpotIdentity[] | null>;
  readLiveAvailability: (hubspotCompanyId: string) => Promise<HubSpotAvailability | null>;
};

export type FreePoolApprovalLink =
  | {
      kind: 'link';
      hubspotCompanyId: string;
      source: 'candidate_metadata' | 'live_check';
      /** Comprobado ahora. `null` ⇒ no se pudo leer: no se cambia el dueño. */
      availability: HubSpotAvailability | null;
    }
  /** Más de una ficha con ese dominio: ni enlazar ni crear. */
  | { kind: 'ambiguous'; hubspotCompanyIds: string[] }
  /** La ficha existe pero hoy la tiene otro vendedor: ni enlazar ni crear. */
  | { kind: 'taken'; hubspotCompanyId: string; reason: string }
  /** HubSpot no respondió al buscar o leer la ficha: ni enlazar ni crear a ciegas. */
  | { kind: 'lookup_failed'; stage: 'domain_search' | 'availability' };

/** ¿Este desenlace impide crear la empresa en HubSpot (revisión humana)? */
export function blocksHubSpotCreate(link: FreePoolApprovalLink | null): boolean {
  return link !== null && link.kind !== 'link';
}

function companyIdOf(block: unknown): string | null {
  if (!block || typeof block !== 'object') return null;
  const id = (block as Record<string, unknown>)['company_id'];
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/**
 * La ficha libre que dejó marcada el camino de entrada: el escritor del Agente 1
 * (`metadata.hubspot_free_pool`) o la detección de duplicados de Importar
 * (`metadata.validation.hubspot_duplicate_check.free_to_take`).
 */
export function readStoredFreePoolCompanyId(metadata: Record<string, unknown> | null | undefined): string | null {
  const fromWriter = companyIdOf(metadata?.['hubspot_free_pool']);
  if (fromWriter) return fromWriter;
  const validation = metadata?.['validation'];
  const hubspotCheck =
    validation && typeof validation === 'object'
      ? (validation as Record<string, unknown>)['hubspot_duplicate_check']
      : null;
  return hubspotCheck && typeof hubspotCheck === 'object'
    ? companyIdOf((hubspotCheck as Record<string, unknown>)['free_to_take'])
    : null;
}

/**
 * La ficha a enlazar, o `null` cuando esto no le toca (ya había coincidencia del
 * flujo de siempre que no es de la bolsa, posible coincidencia pendiente de un
 * humano, o HubSpot no tiene esa empresa).
 */
export async function resolveFreePoolApprovalLink(
  input: FreePoolApprovalInput,
  ports: FreePoolApprovalPorts,
): Promise<FreePoolApprovalLink | null> {
  const stored = readStoredFreePoolCompanyId(input.candidateMetadata);
  if (stored) {
    return {
      kind: 'link',
      hubspotCompanyId: stored,
      source: 'candidate_metadata',
      availability: await ports.readLiveAvailability(stored).catch(() => null),
    };
  }
  if (input.matchedCompanyId || input.hubspotCheckStatus === 'possible_match') return null;
  const name = input.name?.trim() ?? '';
  const domain = input.domain?.trim().toLowerCase() || null;
  const taxIdentifier = input.taxIdentifier?.trim() || null;
  if (!name && !domain && !taxIdentifier) return null;
  // Justo antes de CREAR: ¿HubSpot ya tiene esta empresa? Cubre lo que entró por un
  // camino que no guardó la ficha (registros oficiales, Lusha, rescate…).
  const found = await ports
    .findStrongHubSpotIdentities({ name, domain, taxIdentifier, countryCode: input.countryCode ?? null })
    .catch(() => null);
  // `null` = HubSpot no respondió: crear a ciegas podría duplicar la empresa.
  if (found === null) return { kind: 'lookup_failed', stage: 'domain_search' };
  const ids = [...new Set(found.map((identity) => identity.hubspotCompanyId))];
  if (ids.length === 0) return null;
  if (ids.length > 1) return { kind: 'ambiguous', hubspotCompanyIds: ids };
  const freeReason = found.find((identity) => identity.freeReason !== null)?.freeReason ?? null;
  // Encontrada sólo AHORA (no venía marcada libre): se enlaza sólo si está libre.
  if (freeReason === null) return { kind: 'taken', hubspotCompanyId: ids[0], reason: 'not_free' };
  return { kind: 'link', hubspotCompanyId: ids[0], source: 'live_check', availability: { free: true, reason: freeReason } };
}

export type FreePoolOwnerDecision =
  | { write: true; hubspotOwnerId: string }
  | { write: false; reason: 'flag_off' | 'not_free_now' | 'availability_unknown' | 'no_owner_mapping' };

/** ¿Se pone al vendedor como dueño en HubSpot? */
export function decideFreePoolOwnerWrite(input: {
  writebackEnabled: boolean;
  availability: HubSpotAvailability | null;
  sellerHubSpotOwnerId: string | null;
}): FreePoolOwnerDecision {
  if (!input.writebackEnabled) return { write: false, reason: 'flag_off' };
  if (input.availability === null) return { write: false, reason: 'availability_unknown' };
  if (!input.availability.free) return { write: false, reason: 'not_free_now' };
  if (!input.sellerHubSpotOwnerId) return { write: false, reason: 'no_owner_mapping' };
  return { write: true, hubspotOwnerId: input.sellerHubSpotOwnerId };
}
