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
 * una actividad de venta en los últimos `RECENT_SALES_ACTIVITY_DAYS` días, NO tiene
 * una actividad agendada a futuro y además:
 * está Recycled, o su dueño es una bolsa, o no tiene dueño, o su dueño está
 * desactivado. Un dueño que no aparece en ningún listado NO se presume libre.
 *
 * Puro: sin red, sin env, sin reloj (la fecha entra como argumento).
 */

import { getMacroIndustryByKey } from '@/modules/macro-industry-catalog/macro-industries';

/**
 * FEEDBACK 17-11 (Grupo Refax: reunión agendada y llamadas del vendedor, pero SellUp
 * la ofreció como libre). `hs_last_sales_activity_timestamp` es la última vez que el
 * CONTACTO interactuó (abrió un correo, agendó): las llamadas, correos, notas y
 * reuniones que registra el vendedor viven en `notes_last_updated` («Fecha de última
 * actividad», la que ve el vendedor en la ficha) y `notes_last_contacted`. Cuenta la
 * más reciente de las tres.
 */
export const HUBSPOT_LAST_ACTIVITY_PROPERTIES = [
  'notes_last_updated',
  'notes_last_contacted',
  'hs_last_sales_activity_timestamp',
] as const;

/**
 * FEEDBACK 24-11 — el churn en el portal de UBITS (leído de /crm/v3/properties/companies,
 * 24-11): «Estado de la cuenta Auto [Ops|E]» (`estado_de_la_cuenta`) = `Churn` (935
 * empresas). La etapa NO cambia: 934 de esas 935 siguen en «Cliente», así que mirar sólo
 * la etapa trataba a cada ex cliente como cliente actual y lo bloqueaba.
 */
export const HUBSPOT_ACCOUNT_STATE_PROPERTY = 'estado_de_la_cuenta';
export const HUBSPOT_CHURN_ACCOUNT_STATE = 'Churn';
export const HUBSPOT_LAST_CHURN_DATE_PROPERTY = 'fecha_ultimo_churn';
export const HUBSPOT_CHURN_REASON_PROPERTY = 'razon_de_churn';
export const HUBSPOT_CHURN_PROPERTIES = [
  HUBSPOT_ACCOUNT_STATE_PROPERTY,
  HUBSPOT_LAST_CHURN_DATE_PROPERTY,
  HUBSPOT_CHURN_REASON_PROPERTY,
] as const;

/** Propiedades de HubSpot que la regla necesita. */
export const HUBSPOT_FREE_POLICY_PROPERTIES = [
  'hubspot_owner_id',
  'hs_lead_status',
  'lifecyclestage',
  'hs_num_open_deals',
  ...HUBSPOT_LAST_ACTIVITY_PROPERTIES,
  'notes_next_activity_date',
  ...HUBSPOT_CHURN_PROPERTIES,
] as const;

/** Valor interno de la etapa «Cliente» en el portal de UBITS (verificado 15-10). */
export const HUBSPOT_CLIENT_LIFECYCLE_VALUE = '1443029400';
/** `customer` es «Forecast» en este portal: negocio en pronóstico, nunca libre. */
export const HUBSPOT_FORECAST_LIFECYCLE_VALUE = 'customer';

export const HUBSPOT_CUSTOMER_LIFECYCLE_VALUES: ReadonlySet<string> = new Set([
  HUBSPOT_CLIENT_LIFECYCLE_VALUE,
  HUBSPOT_FORECAST_LIFECYCLE_VALUE,
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
export type HubSpotTakenReason =
  | 'customer'
  | 'open_deal'
  | 'recent_sales_activity'
  | 'scheduled_activity'
  | 'active_owner'
  | 'unknown_owner';

/** Fue cliente de UBITS y se fue (churn): cuándo y por qué, como lo dice HubSpot. */
export type HubSpotChurnInfo = {
  /** «Fecha último churn» (AAAA-MM-DD) o `null` si HubSpot no la tiene. */
  churnedAt: string | null;
  /** «Razón de Churn Principal» o `null`. */
  reason: string | null;
};

export type HubSpotAvailability =
  | { free: true; reason: HubSpotFreeReason; churn?: HubSpotChurnInfo }
  | { free: false; reason: HubSpotTakenReason; churn?: HubSpotChurnInfo };

type PolicyProperties = Partial<Record<(typeof HUBSPOT_FREE_POLICY_PROPERTIES)[number], unknown>>;

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** La cuenta está marcada como churn en HubSpot («Estado de la cuenta» = Churn). */
export function isHubSpotChurnedAccount(properties: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return text(properties?.[HUBSPOT_ACCOUNT_STATE_PROPERTY]) === HUBSPOT_CHURN_ACCOUNT_STATE;
}

/** Cuándo y por qué se fue, o `null` si la cuenta no está marcada como churn. */
export function readHubSpotChurn(properties: Readonly<Record<string, unknown>> | null | undefined): HubSpotChurnInfo | null {
  if (!isHubSpotChurnedAccount(properties)) return null;
  const at = parseHubSpotTimestamp(properties?.[HUBSPOT_LAST_CHURN_DATE_PROPERTY]);
  return {
    churnedAt: at === null ? null : new Date(at).toISOString().slice(0, 10),
    reason: text(properties?.[HUBSPOT_CHURN_REASON_PROPERTY]),
  };
}

/**
 * ¿Es cliente ACTUAL? Etapa «Cliente» o «Forecast», o estado de lead «Customer»; pero
 * una cuenta marcada como churn ya no es cliente aunque siga en «Cliente» (HubSpot no
 * le cambia la etapa). «Forecast» sí bloquea siempre: hay un negocio en pronóstico.
 */
export function isHubSpotCurrentCustomer(properties: Readonly<Record<string, unknown>> | null | undefined): boolean {
  const lifecycle = text(properties?.lifecyclestage);
  if (lifecycle === HUBSPOT_FORECAST_LIFECYCLE_VALUE) return true;
  if (isHubSpotChurnedAccount(properties)) return false;
  return lifecycle === HUBSPOT_CLIENT_LIFECYCLE_VALUE || text(properties?.hs_lead_status) === 'Customer';
}

/** Texto corto para la ficha: «Ex cliente de UBITS (churn 2025-03-01 · Pricing & Billing)». */
export function describeHubSpotChurn(churn: HubSpotChurnInfo): string {
  const details = [churn.churnedAt ? `churn ${churn.churnedAt}` : 'churn', churn.reason].filter(Boolean);
  return `Ex cliente de UBITS (${details.join(' · ')})`;
}

/** Fecha de HubSpot: ISO («2026-10-01T…») o milisegundos («1727740800000»). */
export function parseHubSpotTimestamp(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = /^\d{11,}$/.test(raw) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** La actividad de venta más reciente de la ficha (vendedor o contacto); `null` si no hay. */
export function latestHubSpotActivity(properties: PolicyProperties): number | null {
  let latest: number | null = null;
  for (const name of HUBSPOT_LAST_ACTIVITY_PROPERTIES) {
    const at = parseHubSpotTimestamp(properties[name]);
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/**
 * Decide si la empresa está libre. Primero lo que la bloquea siempre (cliente,
 * negocio abierto, actividad reciente o agendada); después, por qué está libre.
 */
export function classifyHubSpotCompanyAvailability(
  properties: PolicyProperties,
  owners: HubSpotOwnerDirectory,
  now: Date,
): HubSpotAvailability {
  const verdict = classifyAvailabilityIgnoringChurn(properties, owners, now);
  // Un ex cliente no se bloquea por haber sido cliente: pasa por la misma regla que
  // cualquier otra ficha (negocio abierto, actividad, dueño) y lleva la marca de churn.
  const churn = readHubSpotChurn(properties);
  return churn ? { ...verdict, churn } : verdict;
}

function classifyAvailabilityIgnoringChurn(
  properties: PolicyProperties,
  owners: HubSpotOwnerDirectory,
  now: Date,
): HubSpotAvailability {
  if (isHubSpotCurrentCustomer(properties)) {
    return { free: false, reason: 'customer' };
  }
  const leadStatus = text(properties.hs_lead_status);
  const openDeals = Number(text(properties.hs_num_open_deals) ?? '0');
  // «Customer» en el estado de lead de un ex cliente es un resto de cuando lo era.
  const blockingLeadStatus = leadStatus !== null && NOT_FREE_LEAD_STATUSES.has(leadStatus) && leadStatus !== 'Customer';
  if ((Number.isFinite(openDeals) && openDeals > 0) || blockingLeadStatus) {
    return { free: false, reason: 'open_deal' };
  }
  const lastActivity = latestHubSpotActivity(properties);
  if (lastActivity !== null && now.getTime() - lastActivity < RECENT_SALES_ACTIVITY_DAYS * DAY_MS) {
    return { free: false, reason: 'recent_sales_activity' };
  }
  // Una reunión, llamada o tarea agendada a futuro: alguien la está trabajando hoy.
  const nextActivity = parseHubSpotTimestamp(properties.notes_next_activity_date);
  if (nextActivity !== null && nextActivity >= now.getTime()) {
    return { free: false, reason: 'scheduled_activity' };
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

/**
 * Propiedades de la empresa al tomarla: dueño y estado de lead.
 *
 * 🔴 «Fecha Asignación» NO se escribe: un flujo de HubSpot la pone en la fecha de hoy
 * cada vez que cambia el dueño (medido el 15-10: AUTOMATION_PLATFORM, 3 s después).
 */
export function buildHubSpotClaimProperties(newOwnerId: string): Record<string, string> {
  return {
    hubspot_owner_id: newOwnerId,
    hs_lead_status: HUBSPOT_CLAIMED_LEAD_STATUS,
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
