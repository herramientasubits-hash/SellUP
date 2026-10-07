// HUBSPOT-ACCOUNT-SYNC-1 — Ficha de HubSpot → empresa de SellUp (núcleo puro)
//
// Cuando una empresa de SellUp nace de (o se vincula a) una empresa de HubSpot, antes sólo
// se copiaban nombre, dominio y país: responsable, industria, tamaño y NIT se perdían aunque
// HubSpot los tuviera. Este módulo traduce la ficha de HubSpot a columnas de `accounts` y
// decide qué se escribe sin pisar nada que SellUp ya tenga.
//
// Sin red, sin Supabase: lo que llega de HubSpot entra como datos y sale como un parche.

import { resolveMacroIndustryByDisplayName } from '@/modules/macro-industry-catalog/macro-industries';

/**
 * Propiedades de empresa que se leen de HubSpot. Los nombres internos son los del portal
 * real de UBITS (verificados contra `/crm/v3/properties/companies` el 2026-10-07):
 * la «Macro industria» vive en `industriaespecifica` y el NIT/RFC/RUC en
 * `identificaci_n_fiscal`.
 */
export const HUBSPOT_COMPANY_PROFILE_PROPERTIES = [
  'name',
  'domain',
  'website',
  'country',
  'pais',
  'hs_country_code',
  'city',
  'state',
  'industriaespecifica',
  'numberofemployees',
  'identificaci_n_fiscal',
  'rfc_mx_',
  'hubspot_owner_id',
  'owneremail',
  'linkedin_company_page',
] as const;

export type HubSpotCompanyProfileProperties = Partial<
  Record<(typeof HUBSPOT_COMPANY_PROFILE_PROPERTIES)[number], string | null>
>;

/** Columnas de `accounts` que una ficha de HubSpot puede completar. */
export interface AccountFieldsFromHubSpot {
  name: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  company_size: string | null;
  tax_identifier: string | null;
  linkedin_url: string | null;
}

export interface HubSpotCompanyProfileMapping {
  fields: AccountFieldsFromHubSpot;
  /** Dueño de la empresa en HubSpot (`hubspot_owner_id`) y su correo, si HubSpot lo trae. */
  hubspotOwnerId: string | null;
  hubspotOwnerEmail: string | null;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanDomain(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const host = raw
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0];
  return host.length > 0 ? host : null;
}

/** Número de empleados como entero en texto («746»), igual que lo guarda el Agente 1. */
function cleanEmployees(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const n = Number(raw.replace(/[.,\s](?=\d{3}\b)/g, ''));
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : null;
}

function cleanCountryCode(value: string | null | undefined): string | null {
  const raw = clean(value);
  return raw && /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null;
}

/**
 * Traduce la ficha de HubSpot a columnas de SellUp.
 *
 * `countryNameToCode` se inyecta (el mapa de países vive en el resolutor de empresas del
 * Agente 2A) para que este núcleo no arrastre módulos de servidor.
 */
export function mapHubSpotCompanyProfile(
  properties: HubSpotCompanyProfileProperties,
  countryNameToCode: (country: string | null) => string | null,
): HubSpotCompanyProfileMapping {
  const country = clean(properties.pais) ?? clean(properties.country);
  const domain = cleanDomain(properties.domain) ?? cleanDomain(properties.website);
  const website = clean(properties.website) ?? (domain ? `https://${domain}` : null);
  // Sólo la Macro industria: es la misma taxonomía de 12 que usa SellUp. La `industry`
  // estándar de HubSpot (148 opciones en inglés) no se traduce a ojo.
  const macro = resolveMacroIndustryByDisplayName(clean(properties.industriaespecifica));

  return {
    fields: {
      name: clean(properties.name),
      domain,
      website,
      country,
      country_code: cleanCountryCode(properties.hs_country_code) ?? countryNameToCode(country),
      city: clean(properties.city),
      region: clean(properties.state),
      industry: macro?.displayName ?? null,
      company_size: cleanEmployees(properties.numberofemployees),
      tax_identifier: clean(properties.identificaci_n_fiscal) ?? clean(properties.rfc_mx_),
      linkedin_url: clean(properties.linkedin_company_page),
    },
    hubspotOwnerId: clean(properties.hubspot_owner_id),
    hubspotOwnerEmail: clean(properties.owneremail)?.toLowerCase() ?? null,
  };
}

/** Columnas que el parche de completado puede tocar (nunca nombre ni IDs). */
const FILLABLE_COLUMNS = [
  'domain',
  'website',
  'country',
  'country_code',
  'city',
  'region',
  'industry',
  'company_size',
  'tax_identifier',
  'linkedin_url',
] as const satisfies ReadonlyArray<keyof AccountFieldsFromHubSpot>;

export type FillableAccountColumn = (typeof FILLABLE_COLUMNS)[number];
export type AccountFillPatch = Partial<Record<FillableAccountColumn, string>>;

/**
 * Parche que completa SÓLO lo vacío. Lo que SellUp ya tiene manda: HubSpot nunca pisa un
 * valor existente (la columna `domain` además es la llave de deduplicación).
 */
export function buildAccountFillPatch(
  existing: Partial<Record<FillableAccountColumn, string | null>>,
  fields: AccountFieldsFromHubSpot,
): AccountFillPatch {
  const patch: AccountFillPatch = {};
  for (const column of FILLABLE_COLUMNS) {
    const incoming = fields[column];
    if (incoming && !clean(existing[column] ?? null)) {
      patch[column] = incoming;
    }
  }
  return patch;
}

export type AccountOwnerSource = 'hubspot_owner' | 'searcher';

export interface AccountOwnerDecision {
  ownerId: string | null;
  source: AccountOwnerSource | null;
}

/**
 * Responsable de la empresa en SellUp.
 *
 *  1. Si HubSpot ya tiene dueño y ese dueño es un usuario de SellUp, manda HubSpot: la
 *     empresa ya tiene vendedor y SellUp no debe contradecirlo.
 *  2. Si no, el responsable es quien buscó: quien lanzó la búsqueda del Agente 1 o quien
 *     buscó contactos de una empresa que no estaba en SellUp (Agente 2).
 */
export function decideAccountOwner(input: {
  hubspotOwnerUserId: string | null;
  searcherUserId: string | null;
}): AccountOwnerDecision {
  if (input.hubspotOwnerUserId) {
    return { ownerId: input.hubspotOwnerUserId, source: 'hubspot_owner' };
  }
  if (input.searcherUserId) {
    return { ownerId: input.searcherUserId, source: 'searcher' };
  }
  return { ownerId: null, source: null };
}
