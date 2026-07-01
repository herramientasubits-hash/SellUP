// Agente 2A — Company Resolver Core
// Hito 17A.1 — Solo lectura. No llama Apollo ni Lusha. No escribe en HubSpot.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { Agent2AInput, CompanyCandidate, CompanyResolutionResult } from '@/modules/contact-enrichment/types';
import type { CompanyResolverDeps, SellUpAccountMatch, HubSpotCompanyMatch } from './types';
import { checkHubSpotCompanyDuplicate } from '@/server/integrations/hubspot-company-search';

// ── Admin Supabase (service_role) ─────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ── Default SellUp search implementations ────────────────────

async function defaultSearchByAccountId(id: string): Promise<SellUpAccountMatch | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('accounts')
    .select('id, name, domain, country, country_code, hubspot_company_id')
    .eq('id', id)
    .is('archived_at', null)
    .neq('pipeline_status', 'archived')
    .single();
  return data ?? null;
}

async function defaultSearchByHubSpotId(hsId: string): Promise<SellUpAccountMatch[]> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('accounts')
    .select('id, name, domain, country, country_code, hubspot_company_id')
    .eq('hubspot_company_id', hsId)
    .is('archived_at', null)
    .neq('pipeline_status', 'archived')
    .limit(5);
  return data ?? [];
}

async function defaultSearchByDomain(domain: string): Promise<SellUpAccountMatch[]> {
  const admin = getAdminClient();
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  const { data } = await admin
    .from('accounts')
    .select('id, name, domain, country, country_code, hubspot_company_id')
    .ilike('domain', `%${normalized}%`)
    .is('archived_at', null)
    .neq('pipeline_status', 'archived')
    .limit(5);
  return data ?? [];
}

async function defaultSearchByName(name: string): Promise<SellUpAccountMatch[]> {
  const admin = getAdminClient();
  const { data } = await admin
    .from('accounts')
    .select('id, name, domain, country, country_code, hubspot_company_id')
    .ilike('name', `%${name.trim()}%`)
    .is('archived_at', null)
    .neq('pipeline_status', 'archived')
    .limit(5);
  return data ?? [];
}

async function defaultSearchHubSpot(opts: { domain?: string; name?: string }): Promise<HubSpotCompanyMatch[]> {
  const result = await checkHubSpotCompanyDuplicate({
    domain: opts.domain,
    companyName: opts.name,
  });
  if (result.skipped || !result.checked) return [];
  return result.matches;
}

// ── Helpers de conversión ────────────────────────────────────

function sellupMatchToCandidate(match: SellUpAccountMatch, confidence: number): CompanyCandidate {
  return {
    source: 'sellup',
    sellupAccountId: match.id,
    hubspotCompanyId: match.hubspot_company_id ?? undefined,
    name: match.name,
    domain: match.domain,
    country: match.country,
    countryCode: match.country_code,
    linkedinUrl: null,
    matchConfidence: confidence,
  };
}

function hubspotMatchToCandidate(match: HubSpotCompanyMatch): CompanyCandidate {
  return {
    source: 'hubspot',
    hubspotCompanyId: match.id,
    name: match.name ?? 'Empresa sin nombre',
    domain: match.domain,
    country: null,
    countryCode: null,
    linkedinUrl: null,
    matchConfidence: 0.8,
  };
}

// ── Resolver principal ───────────────────────────────────────

/**
 * Resuelve qué empresa será objetivo del enriquecimiento de contactos.
 *
 * Búsqueda en orden de precisión:
 * 1. SellUp por account UUID (exacto → confianza 1.0)
 * 2. SellUp por hubspot_company_id (exacto → confianza 1.0)
 * 3. SellUp por dominio (parcial → confianza 0.9)
 * 4. SellUp por nombre (ilike → confianza 0.7)
 * 5. HubSpot (dominio o nombre) — solo lectura, no obligatorio
 *
 * Si HubSpot no está disponible, devuelve skippedHubSpot: true sin error fatal.
 */
export async function resolveCompanyForContactEnrichment(
  input: Agent2AInput,
  deps: CompanyResolverDeps = {}
): Promise<CompanyResolutionResult> {
  const {
    searchSellUpByAccountId = defaultSearchByAccountId,
    searchSellUpByHubSpotId = defaultSearchByHubSpotId,
    searchSellUpByDomain = defaultSearchByDomain,
    searchSellUpByName = defaultSearchByName,
    searchHubSpot = defaultSearchHubSpot,
  } = deps;

  const sellupCandidates: CompanyCandidate[] = [];
  let skippedHubSpot = false;
  let resolverError: string | undefined;

  // 1. Por sellupAccountId exacto
  if (input.sellupAccountId) {
    try {
      const match = await searchSellUpByAccountId(input.sellupAccountId);
      if (match) {
        sellupCandidates.push(sellupMatchToCandidate(match, 1.0));
      }
    } catch (err) {
      resolverError = err instanceof Error ? err.message : 'Error buscando en SellUp';
    }
  }

  // 2. Por hubspotCompanyId exacto en SellUp
  if (input.hubspotCompanyId && sellupCandidates.length === 0) {
    try {
      const matches = await searchSellUpByHubSpotId(input.hubspotCompanyId);
      for (const m of matches) {
        sellupCandidates.push(sellupMatchToCandidate(m, 1.0));
      }
    } catch (err) {
      resolverError = err instanceof Error ? err.message : 'Error buscando en SellUp';
    }
  }

  // 3. Por dominio en SellUp
  if (input.companyDomain && sellupCandidates.length === 0) {
    try {
      const matches = await searchSellUpByDomain(input.companyDomain);
      for (const m of matches) {
        sellupCandidates.push(sellupMatchToCandidate(m, 0.9));
      }
    } catch (err) {
      resolverError = err instanceof Error ? err.message : 'Error buscando en SellUp';
    }
  }

  // 4. Por nombre en SellUp
  if (input.companyName && sellupCandidates.length === 0) {
    try {
      const matches = await searchSellUpByName(input.companyName);
      for (const m of matches) {
        sellupCandidates.push(sellupMatchToCandidate(m, 0.7));
      }
    } catch (err) {
      resolverError = err instanceof Error ? err.message : 'Error buscando en SellUp';
    }
  }

  // 5. HubSpot — opcional, solo lectura
  const hubspotCandidates: CompanyCandidate[] = [];
  if (input.companyDomain || input.companyName) {
    try {
      const hsMatches = await searchHubSpot({
        domain: input.companyDomain,
        name: input.companyName,
      });

      if (hsMatches === null) {
        skippedHubSpot = true;
      } else {
        for (const m of hsMatches) {
          // Evitar duplicar si ya aparece en SellUp (mismo hubspot_company_id)
          const alreadyPresent = sellupCandidates.some(
            (c) => c.hubspotCompanyId === m.id
          );
          if (!alreadyPresent) {
            hubspotCandidates.push(hubspotMatchToCandidate(m));
          }
        }
      }
    } catch (err) {
      // HubSpot no está disponible → continúa sin romper el flujo
      skippedHubSpot = true;
      if (!resolverError) {
        resolverError = err instanceof Error ? err.message : 'HubSpot no disponible';
      }
    }
  } else {
    skippedHubSpot = true;
  }

  // Deduplicar por dominio normalizado: cuando hay múltiples SellUp con mismo dominio,
  // mantener el que tenga hubspot_company_id (más completo), si hay empate el primero.
  const seenDomains = new Set<string>();
  const deduped: CompanyCandidate[] = [];
  for (const c of sellupCandidates) {
    const key = c.domain ? c.domain.toLowerCase().replace(/^www\./, '') : c.sellupAccountId ?? c.name;
    if (!seenDomains.has(key)) {
      seenDomains.add(key);
      deduped.push(c);
    } else {
      // Si este candidato tiene hubspot_company_id y el ya registrado no, reemplazar
      const existing = deduped.findIndex(
        (x) => (x.domain ? x.domain.toLowerCase().replace(/^www\./, '') : x.sellupAccountId ?? x.name) === key
      );
      if (existing >= 0 && !deduped[existing].hubspotCompanyId && c.hubspotCompanyId) {
        deduped[existing] = c;
      }
    }
  }

  const allCandidates = [...deduped, ...hubspotCandidates];

  if (allCandidates.length === 0) {
    return {
      resolved: false,
      singleMatch: false,
      candidates: [],
      skippedHubSpot,
      error: resolverError,
    };
  }

  const singleMatch = allCandidates.length === 1;
  const selected = singleMatch ? allCandidates[0] : undefined;

  return {
    resolved: true,
    singleMatch,
    candidates: allCandidates,
    selected,
    skippedHubSpot,
    error: resolverError,
  };
}
