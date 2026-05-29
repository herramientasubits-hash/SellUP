/**
 * HubSpot Commercial Checker — Hito 16AB.5
 *
 * Verificación comercial extendida contra HubSpot CRM de UBITS.
 * Solo lectura. Soporta búsqueda por NIT, dominio y nombre normalizado.
 * Clasifica el estado comercial con granularidad completa.
 *
 * Orden de búsqueda: NIT exacto → dominio exacto → nombre normalizado.
 *
 * No crea ni modifica empresas en HubSpot.
 * No escribe en Supabase.
 * Mantiene compatibilidad hacia atrás con hubspot-duplicate-checker.ts.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type {
  HubspotMatchStatus,
  HubspotTrace,
  ReviewFlag,
  RecyclableStatus,
} from './structured-candidate-types';
import { normalizeCompanyName } from './normalization';

// ─── Constants ───────────────────────────────────────────────────────────────

const VAULT_SECRET_NAME = 'sellup_integration_hubspot';
const INTEGRATION_KEY = 'hubspot';

// Confirmed in UBITS HubSpot portal (see HUBSPOT_ACCOUNT_FIELD_MAPPING.md)
const HUBSPOT_NIT_PROPERTY = 'nit';

const RECYCLABLE_INACTIVITY_DAYS = 90;

const HS_COMMERCIAL_PROPERTIES = [
  'name',
  'domain',
  'website',
  HUBSPOT_NIT_PROPERTY,
  'lifecyclestage',
  'hs_lead_status',
  'hubspot_owner_id',
  'numberofemployees',
  'hs_lastmodifieddate',
  'hs_last_sales_activity_date',
  'notes_last_contacted',
  'num_associated_deals',
  'createdate',
];

const PROSPECT_LIFECYCLE_STAGES = new Set([
  'lead',
  'subscriber',
  'marketingqualifiedlead',
  'salesqualifiedlead',
  'opportunity',
]);

const EX_CUSTOMER_LEAD_STATUSES = new Set([
  'churned',
  'lost',
  'cancelled',
  'ex-client',
  'ex_client',
]);

// ─── Public types ─────────────────────────────────────────────────────────────

export type HubSpotCompanyCommercialStatus =
  | 'customer'
  | 'active_prospect'
  | 'recyclable_prospect'
  | 'ex_customer'
  | 'unknown'
  | 'no_match';

export type HubSpotCompanyMatchMethod =
  | 'nit'
  | 'domain'
  | 'name'
  | 'id'
  | 'none';

export type HubSpotExtendedCompanyMatch = {
  hubspotCompanyId: string;
  name: string | null;
  domain: string | null;
  nit: string | null;
  lifecycleStage: string | null;
  leadStatus: string | null;
  ownerId: string | null;
  lastMeetingDate: string | null;
  lastActivityDate: string | null;
  numberOfEmployees: number | null;
  numberOfDeals: number | null;
  matchMethod: HubSpotCompanyMatchMethod;
  matchConfidence: number;
  commercialStatus: HubSpotCompanyCommercialStatus;
  recyclableReason: string | null;
};

export type HubSpotCommercialCheckResult = {
  looked: boolean;
  connected: boolean;
  match: HubSpotExtendedCompanyMatch | null;
  possibleMatches: Array<{ hubspotId: string; name: string | null; confidence: number }>;
  hubspotMatchStatus: HubspotMatchStatus;
  commercialStatus: HubSpotCompanyCommercialStatus;
  recyclableStatus: RecyclableStatus | null;
  reviewFlags: ReviewFlag[];
  hubspotTrace: HubspotTrace;
  error: string | null;
};

// ─── Internal HubSpot API types ──────────────────────────────────────────────

interface HubSpotCommercialProperties {
  name: string | null;
  domain: string | null;
  website: string | null;
  nit: string | null;
  lifecyclestage: string | null;
  hs_lead_status: string | null;
  hubspot_owner_id: string | null;
  numberofemployees: string | null;
  hs_last_sales_activity_date: string | null;
  notes_last_contacted: string | null;
  num_associated_deals: string | null;
  createdate: string | null;
}

interface HubSpotSearchHit {
  id: string;
  properties: HubSpotCommercialProperties;
}

interface HubSpotSearchResponse {
  results: HubSpotSearchHit[];
  total: number;
}

// ─── Vault helpers (read-only) ───────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

async function getHubSpotToken(): Promise<string | null> {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc('get_vault_secret_decrypted', {
      p_name: VAULT_SECRET_NAME,
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

async function isHubSpotConnected(): Promise<boolean> {
  try {
    const admin = getAdminClient();
    const { data: integration } = await admin
      .from('external_integrations')
      .select('id')
      .eq('integration_key', INTEGRATION_KEY)
      .single();
    if (!integration?.id) return false;
    const { data: connection } = await admin
      .from('external_integration_connections')
      .select('connection_status')
      .eq('integration_id', integration.id)
      .eq('connection_status', 'connected')
      .single();
    return !!connection;
  } catch {
    return false;
  }
}

// ─── HubSpot search functions (read-only) ───────────────────────────────────

async function searchByNit(token: string, nit: string): Promise<HubSpotSearchHit[]> {
  const body = {
    filterGroups: [
      { filters: [{ propertyName: HUBSPOT_NIT_PROPERTY, operator: 'EQ', value: nit.trim() }] },
    ],
    properties: HS_COMMERCIAL_PROPERTIES,
    limit: 3,
  };
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as HubSpotSearchResponse;
  return data.results ?? [];
}

async function searchByDomainCommercial(
  token: string,
  domain: string
): Promise<HubSpotSearchHit[]> {
  const body = {
    filterGroups: [
      { filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] },
    ],
    properties: HS_COMMERCIAL_PROPERTIES,
    limit: 3,
  };
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as HubSpotSearchResponse;
  return data.results ?? [];
}

async function searchByNameCommercial(
  token: string,
  name: string
): Promise<HubSpotSearchHit[]> {
  const body = {
    query: name.trim(),
    properties: HS_COMMERCIAL_PROPERTIES,
    limit: 5,
  };
  const res = await fetch('https://api.hubapi.com/crm/v3/objects/companies/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as HubSpotSearchResponse;
  return data.results ?? [];
}

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function parseNullableInt(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

function mapHitToMatch(
  hit: HubSpotSearchHit,
  method: HubSpotCompanyMatchMethod,
  confidence: number
): HubSpotExtendedCompanyMatch {
  const p = hit.properties;
  return {
    hubspotCompanyId: hit.id,
    name: p.name ?? null,
    domain: p.domain ?? null,
    nit: p.nit ?? null,
    lifecycleStage: p.lifecyclestage ?? null,
    leadStatus: p.hs_lead_status ?? null,
    ownerId: p.hubspot_owner_id ?? null,
    lastMeetingDate: null,
    lastActivityDate: p.hs_last_sales_activity_date ?? p.notes_last_contacted ?? null,
    numberOfEmployees: parseNullableInt(p.numberofemployees),
    numberOfDeals: parseNullableInt(p.num_associated_deals),
    matchMethod: method,
    matchConfidence: confidence,
    commercialStatus: 'unknown',
    recyclableReason: null,
  };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysSince(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── classifyHubSpotCommercialMatch ──────────────────────────────────────────

/**
 * Pure classification function. No I/O, no side effects.
 * Determines commercial match status from HubSpot lifecycle and activity data.
 */
export function classifyHubSpotCommercialMatch(params: {
  company: HubSpotExtendedCompanyMatch | null;
  matchMethod: HubSpotCompanyMatchMethod;
  now?: Date;
}): {
  hubspotMatchStatus: HubspotMatchStatus;
  commercialStatus: HubSpotCompanyCommercialStatus;
  recyclableStatus: RecyclableStatus | null;
  reviewFlags: ReviewFlag[];
  reason: string;
} {
  const { company, matchMethod, now = new Date() } = params;

  if (!company) {
    return {
      hubspotMatchStatus: 'no_match',
      commercialStatus: 'no_match',
      recyclableStatus: null,
      reviewFlags: [],
      reason: 'No se encontró la empresa en HubSpot',
    };
  }

  const lifecycle = company.lifecycleStage?.toLowerCase().trim() ?? null;
  const leadStatus = company.leadStatus?.toLowerCase().trim() ?? null;

  if (lifecycle === 'customer') {
    return {
      hubspotMatchStatus: 'exact_match_customer',
      commercialStatus: 'customer',
      recyclableStatus: 'not_recyclable',
      reviewFlags: ['hubspot_existing_customer'],
      reason: `Cliente activo en HubSpot (lifecyclestage=customer)`,
    };
  }

  if (leadStatus && EX_CUSTOMER_LEAD_STATUSES.has(leadStatus)) {
    return {
      hubspotMatchStatus: 'exact_match_ex_customer',
      commercialStatus: 'ex_customer',
      recyclableStatus: 'pending_review',
      reviewFlags: ['hubspot_existing_prospect'],
      reason: `Ex-cliente detectado por hs_lead_status="${company.leadStatus}"`,
    };
  }

  if (lifecycle && PROSPECT_LIFECYCLE_STAGES.has(lifecycle)) {
    const activityDays = daysSince(company.lastActivityDate, now);
    const hasDeals = (company.numberOfDeals ?? 0) > 0;

    if (hasDeals || (activityDays !== null && activityDays <= RECYCLABLE_INACTIVITY_DAYS)) {
      return {
        hubspotMatchStatus: 'exact_match_prospect_active',
        commercialStatus: 'active_prospect',
        recyclableStatus: 'not_recyclable',
        reviewFlags: ['hubspot_existing_prospect'],
        reason: `Prospecto activo (actividad: ${activityDays ?? 'N/A'} días, deals: ${company.numberOfDeals ?? 0})`,
      };
    }

    if (activityDays !== null && activityDays > RECYCLABLE_INACTIVITY_DAYS && !hasDeals) {
      return {
        hubspotMatchStatus: 'exact_match_prospect_recyclable',
        commercialStatus: 'recyclable_prospect',
        recyclableStatus: 'recyclable',
        reviewFlags: ['hubspot_existing_prospect', 'hubspot_recyclable_prospect'],
        reason: `Prospecto reciclable: última actividad hace ${activityDays} días sin deals activos`,
      };
    }

    return {
      hubspotMatchStatus: 'possible_match_requires_review',
      commercialStatus: 'recyclable_prospect',
      recyclableStatus: 'pending_review',
      reviewFlags: ['hubspot_existing_prospect', 'hubspot_recyclable_prospect'],
      reason: 'Prospecto sin datos de actividad suficientes para determinar reciclabilidad',
    };
  }

  if (matchMethod === 'name' && company.matchConfidence < 75) {
    return {
      hubspotMatchStatus: 'possible_match_requires_review',
      commercialStatus: 'unknown',
      recyclableStatus: 'pending_review',
      reviewFlags: ['possible_duplicate'],
      reason: `Match por nombre con confianza baja (${company.matchConfidence}%)`,
    };
  }

  return {
    hubspotMatchStatus: 'possible_match_requires_review',
    commercialStatus: 'unknown',
    recyclableStatus: 'pending_review',
    reviewFlags: ['possible_duplicate'],
    reason: `Match en HubSpot sin lifecycle stage reconocible (${lifecycle ?? 'null'})`,
  };
}

// ─── buildHubspotTraceFromLookup ──────────────────────────────────────────────

/**
 * Pure helper. Builds a HubspotTrace from a completed lookup.
 * Never includes raw HubSpot API payloads, tokens, or full response bodies.
 * syncAttempted is always false (sync is out of scope for this hito).
 */
export function buildHubspotTraceFromLookup(params: {
  lookupAttempted: boolean;
  matchStatus: HubspotMatchStatus;
  matchedCompanyId: string | null;
  matchedBy: 'nit' | 'domain' | 'name' | 'id' | null;
  possibleMatches?: Array<{ hubspotId: string; name: string | null; confidence: number }>;
  error?: string | null;
}): HubspotTrace {
  return {
    lookupAttempted: params.lookupAttempted,
    lookupAt: params.lookupAttempted ? new Date().toISOString() : null,
    matchStatus: params.matchStatus,
    matchedCompanyId: params.matchedCompanyId,
    matchedBy: params.matchedBy,
    possibleMatches: params.possibleMatches ?? [],
    syncAttempted: false,
    syncAt: null,
    syncStatus: null,
    syncError: params.error ? params.error.substring(0, 500) : null,
    syncedByUserId: null,
  };
}

// ─── checkHubSpotCompanyCommercialStatus ─────────────────────────────────────

/**
 * Verifica el estado comercial de una empresa en HubSpot.
 * Read-only. Orden de búsqueda: NIT → dominio → nombre.
 *
 * No crea ni modifica empresas en HubSpot.
 * No escribe en Supabase.
 * No conecta al pipeline web_ai existente.
 */
export async function checkHubSpotCompanyCommercialStatus(input: {
  name: string;
  domain?: string | null;
  taxId?: string | null;
  countryCode?: string | null;
}): Promise<HubSpotCommercialCheckResult> {
  const buildNotConnected = (error?: string): HubSpotCommercialCheckResult => ({
    looked: false,
    connected: false,
    match: null,
    possibleMatches: [],
    hubspotMatchStatus: 'not_attempted',
    commercialStatus: 'no_match',
    recyclableStatus: null,
    reviewFlags: [],
    hubspotTrace: buildHubspotTraceFromLookup({
      lookupAttempted: false,
      matchStatus: 'not_attempted',
      matchedCompanyId: null,
      matchedBy: null,
      error,
    }),
    error: error ?? null,
  });

  const connected = await isHubSpotConnected();
  if (!connected) return buildNotConnected();

  const token = await getHubSpotToken();
  if (!token) return buildNotConnected('Token HubSpot no disponible');

  try {
    let bestMatch: HubSpotExtendedCompanyMatch | null = null;
    const possibleMatches: Array<{ hubspotId: string; name: string | null; confidence: number }> = [];
    let matchedBy: HubSpotCompanyMatchMethod = 'none';

    // 1. NIT exacto — máxima confianza
    const normalizedNit = input.taxId?.replace(/[\s.\-]/g, '').trim() ?? null;
    if (normalizedNit && normalizedNit.length >= 5) {
      const hits = await searchByNit(token, normalizedNit);
      if (hits.length > 0) {
        bestMatch = mapHitToMatch(hits[0], 'nit', 98);
        matchedBy = 'nit';
        for (const h of hits.slice(1)) {
          possibleMatches.push({ hubspotId: h.id, name: h.properties.name ?? null, confidence: 90 });
        }
      }
    }

    // 2. Dominio exacto
    if (!bestMatch && input.domain) {
      const domain = input.domain.toLowerCase().replace(/^www\./, '').trim();
      if (domain.length > 3) {
        const hits = await searchByDomainCommercial(token, domain);
        if (hits.length > 0) {
          bestMatch = mapHitToMatch(hits[0], 'domain', 92);
          matchedBy = 'domain';
        }
      }
    }

    // 3. Nombre normalizado — fallback
    if (!bestMatch && input.name.trim().length >= 3) {
      const hits = await searchByNameCommercial(token, input.name.trim());
      if (hits.length > 0) {
        const inputNorm = normalizeCompanyName(input.name);
        const scored = hits.map((h) => {
          const rNorm = normalizeCompanyName(h.properties.name ?? '');
          let conf = 50;
          if (rNorm === inputNorm) conf = 82;
          else if (rNorm.includes(inputNorm) || inputNorm.includes(rNorm)) conf = 65;
          return { hit: h, conf };
        });
        scored.sort((a, b) => b.conf - a.conf);
        bestMatch = mapHitToMatch(scored[0].hit, 'name', scored[0].conf);
        matchedBy = 'name';
        for (const { hit, conf } of scored.slice(1)) {
          possibleMatches.push({ hubspotId: hit.id, name: hit.properties.name ?? null, confidence: conf });
        }
      }
    }

    const classification = classifyHubSpotCommercialMatch({
      company: bestMatch,
      matchMethod: matchedBy,
    });

    if (bestMatch) {
      bestMatch = {
        ...bestMatch,
        commercialStatus: classification.commercialStatus,
        recyclableReason: classification.reason,
      };
    }

    const trace = buildHubspotTraceFromLookup({
      lookupAttempted: true,
      matchStatus: classification.hubspotMatchStatus,
      matchedCompanyId: bestMatch?.hubspotCompanyId ?? null,
      matchedBy: matchedBy === 'none' ? null : matchedBy,
      possibleMatches,
    });

    return {
      looked: true,
      connected: true,
      match: bestMatch,
      possibleMatches,
      hubspotMatchStatus: classification.hubspotMatchStatus,
      commercialStatus: classification.commercialStatus,
      recyclableStatus: classification.recyclableStatus,
      reviewFlags: classification.reviewFlags,
      hubspotTrace: trace,
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error consultando HubSpot';
    return {
      looked: true,
      connected: true,
      match: null,
      possibleMatches: [],
      hubspotMatchStatus: 'hubspot_lookup_failed',
      commercialStatus: 'no_match',
      recyclableStatus: null,
      reviewFlags: [],
      hubspotTrace: buildHubspotTraceFromLookup({
        lookupAttempted: true,
        matchStatus: 'hubspot_lookup_failed',
        matchedCompanyId: null,
        matchedBy: null,
        error: msg,
      }),
      error: msg,
    };
  }
}
