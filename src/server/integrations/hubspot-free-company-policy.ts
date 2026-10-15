/**
 * hubspot-free-company-policy.ts — ¿esta empresa de HubSpot está LIBRE para que
 * un vendedor de SellUp la tome?
 *
 * HUBSPOT-FREE-POOL-SOURCE-1 (15-10-2026). Medido en el portal real (solo lectura):
 *
 *   · un flujo de HubSpot pone `hs_lead_status = Unqualified / lost` y, EXACTAMENTE
 *     120 días después, otro flujo la pasa a `Recycled` (194/201 muestras). Recycled
 *     es la marca que le dice a otro vendedor «se puede volver a tocar». El dueño NO
 *     se borra: sigue a nombre del vendedor anterior;
 *   · 40.526 empresas están a nombre de un usuario «bolsa» (Sales Colombia, Sales
 *     México…), 2.231 sin dueño y 12.528 a nombre de personas desactivadas.
 *
 * Decisión de la dueña (15-10): las cuatro bolsas entran.
 *
 * Una empresa está libre si NO es cliente, NO tiene negocio abierto, NADIE le hizo
 * una actividad de venta en los últimos `RECENT_SALES_ACTIVITY_DAYS` días y además:
 * está Recycled, o su dueño es una bolsa, o no tiene dueño, o su dueño está
 * desactivado. Un dueño que no aparece en ningún listado NO se presume libre.
 *
 * Puro: sin red, sin env, sin reloj (la fecha entra como argumento).
 */

import { getMacroIndustryByKey } from '@/modules/macro-industry-catalog/macro-industries';

/** Propiedades de HubSpot que la regla necesita. */
export const HUBSPOT_FREE_POLICY_PROPERTIES = [
  'hubspot_owner_id',
  'hs_lead_status',
  'lifecyclestage',
  'hs_num_open_deals',
  'hs_last_sales_activity_timestamp',
] as const;

/** Valor interno de la etapa «Cliente» en el portal de UBITS (verificado 15-10). */
export const HUBSPOT_CUSTOMER_LIFECYCLE_VALUES: ReadonlySet<string> = new Set([
  '1443029400', // «Cliente»
  'customer', // «Forecast» en este portal: negocio en pronóstico, nunca libre
]);

export const HUBSPOT_RECYCLED_LEAD_STATUS = 'Recycled';
const NOT_FREE_LEAD_STATUSES: ReadonlySet<string> = new Set(['Customer', 'Open Deal']);

/**
 * Alguien le habló hace poco (llamada, correo, reunión registrada por un vendedor):
 * aunque la empresa figure en una bolsa, alguien la está trabajando.
 */
export const RECENT_SALES_ACTIVITY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Usuarios «bolsa» de HubSpot: no son personas, son colas por país o equipo.
 * Verificado contra `/crm/v3/owners` el 15-10: Sales Colombia, Sales México, Sales
 * Perú, Sales Chile, Sales Ca, Sales España, Sales smb, Sales enterprise, Sales
 * Bolivia, Ventas UBits, Equipo UBITS, KAM Virtual.
 */
const POOL_OWNER_NAME_PATTERN = /^(sales\s.+|ventas\s+ubits|equipo\s+ubits|kam\s+virtual)$/i;

export function isHubSpotPoolOwnerName(fullName: string | null | undefined): boolean {
  if (typeof fullName !== 'string') return false;
  return POOL_OWNER_NAME_PATTERN.test(fullName.trim().replace(/\s+/g, ' '));
}

/** Los dueños de HubSpot, ya clasificados. */
export type HubSpotOwnerDirectory = {
  activeIds: ReadonlySet<string>;
  /** Dueños desactivados (`archived=true`) que no siguen activos. */
  deactivatedIds: ReadonlySet<string>;
  poolIds: ReadonlySet<string>;
};

export type HubSpotOwnerRecord = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null };

export function buildHubSpotOwnerDirectory(
  active: readonly HubSpotOwnerRecord[],
  archived: readonly HubSpotOwnerRecord[],
): HubSpotOwnerDirectory {
  const activeIds = new Set(active.map((owner) => String(owner.id)));
  const poolIds = new Set(
    active
      .filter((owner) => isHubSpotPoolOwnerName(`${owner.firstName ?? ''} ${owner.lastName ?? ''}`))
      .map((owner) => String(owner.id)),
  );
  const deactivatedIds = new Set(
    archived.map((owner) => String(owner.id)).filter((id) => !activeIds.has(id)),
  );
  return { activeIds, deactivatedIds, poolIds };
}

export type HubSpotFreeReason = 'recycled' | 'pool_owner' | 'no_owner' | 'deactivated_owner';
export type HubSpotTakenReason = 'customer' | 'open_deal' | 'recent_sales_activity' | 'active_owner' | 'unknown_owner';

export type HubSpotAvailability =
  | { free: true; reason: HubSpotFreeReason }
  | { free: false; reason: HubSpotTakenReason };

type PolicyProperties = Partial<Record<(typeof HUBSPOT_FREE_POLICY_PROPERTIES)[number], unknown>>;

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Fecha de HubSpot: ISO («2026-10-01T…») o milisegundos («1727740800000»). */
export function parseHubSpotTimestamp(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = /^\d{11,}$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Decide si la empresa está libre. Primero lo que la bloquea siempre (cliente,
 * negocio abierto, actividad reciente); después, por qué está libre.
 */
export function classifyHubSpotCompanyAvailability(
  properties: PolicyProperties,
  owners: HubSpotOwnerDirectory,
  now: Date,
): HubSpotAvailability {
  const lifecycle = text(properties.lifecyclestage);
  const leadStatus = text(properties.hs_lead_status);
  if ((lifecycle && HUBSPOT_CUSTOMER_LIFECYCLE_VALUES.has(lifecycle)) || leadStatus === 'Customer') {
    return { free: false, reason: 'customer' };
  }
  const openDeals = Number(text(properties.hs_num_open_deals) ?? '0');
  if ((Number.isFinite(openDeals) && openDeals > 0) || (leadStatus !== null && NOT_FREE_LEAD_STATUSES.has(leadStatus))) {
    return { free: false, reason: 'open_deal' };
  }
  const lastActivity = parseHubSpotTimestamp(properties.hs_last_sales_activity_timestamp);
  if (lastActivity !== null && now.getTime() - lastActivity < RECENT_SALES_ACTIVITY_DAYS * DAY_MS) {
    return { free: false, reason: 'recent_sales_activity' };
  }

  if (leadStatus === HUBSPOT_RECYCLED_LEAD_STATUS) return { free: true, reason: 'recycled' };
  const ownerId = text(properties.hubspot_owner_id);
  if (ownerId === null) return { free: true, reason: 'no_owner' };
  if (owners.poolIds.has(ownerId)) return { free: true, reason: 'pool_owner' };
  if (owners.deactivatedIds.has(ownerId)) return { free: true, reason: 'deactivated_owner' };
  if (owners.activeIds.has(ownerId)) return { free: false, reason: 'active_owner' };
  return { free: false, reason: 'unknown_owner' };
}

/** Texto corto para la ficha y los motivos («Libre en HubSpot: reciclada»). */
export const HUBSPOT_FREE_REASON_LABEL: Readonly<Record<HubSpotFreeReason, string>> = {
  recycled: 'reciclada (120 días sin avanzar)',
  pool_owner: 'en la bolsa del equipo',
  no_owner: 'sin dueño',
  deactivated_owner: 'su dueño ya no está en UBITS',
};

// ─── Traducción de criterios de SellUp a valores de HubSpot ──────────────────

/**
 * Código ISO → valor interno de la propiedad `pais` del portal (verificado contra
 * `/crm/v3/properties/companies/pais` el 15-10).
 */
const HUBSPOT_PAIS_BY_COUNTRY_CODE: Readonly<Record<string, string>> = {
  AR: 'Argentina',
  BO: 'Bolivia (Estado Plurinacional de)',
  BR: 'Brasil',
  CL: 'Chile',
  CO: 'Colombia',
  CR: 'Costa Rica',
  DO: 'República Dominicana',
  EC: 'Ecuador',
  ES: 'España',
  GT: 'Guatemala',
  HN: 'Honduras',
  MX: 'México',
  NI: 'Nicaragua',
  PA: 'Panamá',
  PE: 'Perú',
  PY: 'Paraguay',
  SV: 'El Salvador',
  US: 'Estados Unidos',
  UY: 'Uruguay',
  VE: 'Venezuela',
};

export function hubSpotPaisForCountryCode(countryCode: string | null | undefined): string | null {
  if (typeof countryCode !== 'string') return null;
  return HUBSPOT_PAIS_BY_COUNTRY_CODE[countryCode.trim().toUpperCase()] ?? null;
}

/**
 * La «Macro industria» de HubSpot (`industriaespecifica`) usa la MISMA taxonomía de
 * 12 que SellUp, con el nombre visible como valor.
 */
export function hubSpotMacroIndustryValue(macroIndustryKey: string | null | undefined): string | null {
  if (typeof macroIndustryKey !== 'string' || macroIndustryKey.trim() === '') return null;
  return getMacroIndustryByKey(macroIndustryKey)?.displayName ?? null;
}

// ─── Al TOMAR una empresa libre (decisión de la dueña, 15-10) ────────────────

/**
 * Estado de lead al tomarla: deja de verse «Recycled» (libre) y el ciclo de HubSpot
 * vuelve a empezar (si no avanza: «Unqualified / lost» y, 120 días después, «Recycled»).
 */
export const HUBSPOT_CLAIMED_LEAD_STATUS = 'New';

/** Propiedades de la empresa al tomarla: dueño, estado de lead y Fecha Asignación. */
export function buildHubSpotClaimProperties(newOwnerId: string, now: Date): Record<string, string> {
  return {
    hubspot_owner_id: newOwnerId,
    hs_lead_status: HUBSPOT_CLAIMED_LEAD_STATUS,
    // «Fecha Asignación»: la última asignación del owner cuando no es Cliente.
    fecha_asignacion: now.toISOString().slice(0, 10),
  };
}

export type HubSpotContactOwner = { id: string; ownerId: string | null };

/**
 * Qué contactos de la empresa pasan al nuevo dueño: los sin dueño, los de una bolsa,
 * los de un dueño desactivado y los del dueño anterior de la empresa. Un contacto de
 * OTRO vendedor activo no se le quita (queda para revisión).
 */
export function selectContactsToReassign(
  contacts: readonly HubSpotContactOwner[],
  owners: HubSpotOwnerDirectory,
  previousCompanyOwnerId: string | null,
  newOwnerId: string,
): { reassign: string[]; keptOtherActiveOwner: string[]; alreadyOwned: number } {
  const reassign: string[] = [];
  const keptOtherActiveOwner: string[] = [];
  let alreadyOwned = 0;
  for (const contact of contacts) {
    const owner = contact.ownerId && contact.ownerId.trim() !== '' ? contact.ownerId.trim() : null;
    if (owner === newOwnerId) {
      alreadyOwned += 1;
    } else if (
      owner === null ||
      owner === previousCompanyOwnerId ||
      owners.poolIds.has(owner) ||
      owners.deactivatedIds.has(owner)
    ) {
      reassign.push(contact.id);
    } else {
      keptOtherActiveOwner.push(contact.id);
    }
  }
  return { reassign, keptOtherActiveOwner, alreadyOwned };
}
