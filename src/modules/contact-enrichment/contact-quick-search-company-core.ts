// Agente 2A — Empresa sugerida de la búsqueda puntual (LinkedIn o correo). Núcleo puro.
// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE.
//
// Decisiones de Bryan (29-10):
//   - se busca PRIMERO en HubSpot y DESPUÉS en SellUp;
//   - sólo se asigna si la coincidencia es ÚNICA; si hay varias o ninguna, el candidato queda
//     «Sin empresa asociada» y el usuario la elige con «Reasignar empresa» (no se puede aprobar
//     sin empresa).
//
// Orden: empresa asociada al contacto de HubSpot (si vino de ahí) → HubSpot por dominio →
// HubSpot por nombre → SellUp por dominio → SellUp por nombre. Las búsquedas por dominio y por
// nombre de los adaptadores son parciales (ilike / CONTAINS): aquí sólo cuenta la coincidencia
// EXACTA (dominio normalizado, nombre normalizado), para no asignar «Ubits Perú» a «Ubits».
// HubSpot caído no bloquea: se sigue con SellUp.
//
// No es el resolvedor del asistente por empresa (`resolveCompanyForContactEnrichment`, SellUp
// primero): ése no cambia.

import {
  isGenericEmailDomain,
  normalizeDomain,
} from '@/server/agents/contact-enrichment-toolkit/company-consistency-checker';
import type { HubSpotCompanyMatch, SellUpAccountMatch } from '@/server/agents/contact-enrichment-toolkit/types';
import type { CompanyCandidate } from './types';

export type QuickSearchCompanyMatchedBy =
  | 'hubspot_contact_company'
  | 'hubspot_domain'
  | 'hubspot_name'
  | 'sellup_domain'
  | 'sellup_name';

export type QuickSearchCompanyResolution =
  | { status: 'resolved'; company: CompanyCandidate; matchedBy: QuickSearchCompanyMatchedBy; hubspotUnavailable: boolean }
  | { status: 'ambiguous'; where: 'hubspot' | 'sellup'; count: number; hubspotUnavailable: boolean }
  | { status: 'none'; hubspotUnavailable: boolean };

export interface QuickSearchCompanyInput {
  /** Empresa asociada al contacto de HubSpot (búsqueda por correo que salió de HubSpot). */
  hubspotCompanyId?: string | null;
  /** Dominio de la empresa según el proveedor. */
  companyDomain?: string | null;
  /** Nombre de la empresa según el proveedor. */
  companyName?: string | null;
  /** Correo de la persona: su dominio sirve si no es genérico (gmail, hotmail…). */
  email?: string | null;
}

export interface QuickSearchCompanyDeps {
  /** null ⇒ HubSpot no se pudo consultar. */
  getHubSpotCompanyById: (id: string) => Promise<HubSpotCompanyMatch[] | null>;
  searchHubSpotByDomain: (domain: string) => Promise<HubSpotCompanyMatch[] | null>;
  searchHubSpotByName: (name: string) => Promise<HubSpotCompanyMatch[] | null>;
  searchSellUpByDomain: (domain: string) => Promise<SellUpAccountMatch[]>;
  searchSellUpByName: (name: string) => Promise<SellUpAccountMatch[]>;
  toHubSpotCandidate: (match: HubSpotCompanyMatch) => CompanyCandidate;
  toSellUpCandidate: (match: SellUpAccountMatch) => CompanyCandidate;
}

const LEGAL_SUFFIXES = /\b(s\s?a\s?s|s\s?a\s?de\s?c\s?v|s\s?a|s\s?r\s?l|s\s?p\s?a|ltda|limitada|inc|llc|ltd|corp|gmbh|e\s?i\s?r\s?l|s\s?a\s?c)\b/g;

/** Nombre comparable: sin tildes, signos ni sufijo societario. */
export function normalizeCompanyNameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key || null;
}

/** Dominios a probar, en orden: el de la empresa del proveedor y el del correo (si no es genérico). */
export function quickSearchCandidateDomains(input: QuickSearchCompanyInput): string[] {
  const domains: string[] = [];
  const push = (value: string | null | undefined) => {
    const domain = normalizeDomain(value);
    if (domain && !isGenericEmailDomain(domain) && !domains.includes(domain)) domains.push(domain);
  };
  push(input.companyDomain);
  const email = input.email?.trim().toLowerCase() ?? '';
  const at = email.lastIndexOf('@');
  if (at > 0) push(email.slice(at + 1));
  return domains;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function hubspotDomain(match: HubSpotCompanyMatch): string | null {
  return normalizeDomain(match.domain) ?? normalizeDomain(match.website);
}

export async function resolveQuickSearchCompany(
  input: QuickSearchCompanyInput,
  deps: QuickSearchCompanyDeps,
): Promise<QuickSearchCompanyResolution> {
  let hubspotUnavailable = false;
  const resolved = (match: CompanyCandidate, matchedBy: QuickSearchCompanyMatchedBy): QuickSearchCompanyResolution => ({
    status: 'resolved',
    company: match,
    matchedBy,
    hubspotUnavailable,
  });
  const ambiguous = (where: 'hubspot' | 'sellup', count: number): QuickSearchCompanyResolution => ({
    status: 'ambiguous',
    where,
    count,
    hubspotUnavailable,
  });

  const domains = quickSearchCandidateDomains(input);
  const nameKey = normalizeCompanyNameKey(input.companyName);

  /** HubSpot contesta `null` cuando no se pudo consultar: desde ahí no se le vuelve a preguntar. */
  const askHubSpot = async (call: () => Promise<HubSpotCompanyMatch[] | null>): Promise<HubSpotCompanyMatch[]> => {
    if (hubspotUnavailable) return [];
    try {
      const result = await call();
      if (result === null) {
        hubspotUnavailable = true;
        return [];
      }
      return uniqueBy(result, (m) => m.id);
    } catch {
      hubspotUnavailable = true;
      return [];
    }
  };

  // 1. La empresa asociada al contacto de HubSpot: es la del CRM, no una suposición.
  const companyId = input.hubspotCompanyId?.trim();
  if (companyId) {
    const byId = await askHubSpot(() => deps.getHubSpotCompanyById(companyId));
    if (byId.length === 1) return resolved(deps.toHubSpotCandidate(byId[0]), 'hubspot_contact_company');
  }

  // 2. HubSpot por dominio exacto.
  for (const domain of domains) {
    const matches = (await askHubSpot(() => deps.searchHubSpotByDomain(domain))).filter(
      (m) => hubspotDomain(m) === domain,
    );
    if (matches.length === 1) return resolved(deps.toHubSpotCandidate(matches[0]), 'hubspot_domain');
    if (matches.length > 1) return ambiguous('hubspot', matches.length);
  }

  // 3. HubSpot por nombre exacto (normalizado).
  if (nameKey && input.companyName) {
    const name = input.companyName.trim();
    const matches = (await askHubSpot(() => deps.searchHubSpotByName(name))).filter(
      (m) => normalizeCompanyNameKey(m.name) === nameKey,
    );
    if (matches.length === 1) return resolved(deps.toHubSpotCandidate(matches[0]), 'hubspot_name');
    if (matches.length > 1) return ambiguous('hubspot', matches.length);
  }

  // 4. SellUp por dominio exacto.
  for (const domain of domains) {
    const rows = await deps.searchSellUpByDomain(domain).catch(() => [] as SellUpAccountMatch[]);
    const matches = uniqueBy(rows, (m) => m.id).filter((m) => normalizeDomain(m.domain) === domain);
    if (matches.length === 1) return resolved(deps.toSellUpCandidate(matches[0]), 'sellup_domain');
    if (matches.length > 1) return ambiguous('sellup', matches.length);
  }

  // 5. SellUp por nombre exacto (normalizado).
  if (nameKey && input.companyName) {
    const rows = await deps.searchSellUpByName(input.companyName.trim()).catch(() => [] as SellUpAccountMatch[]);
    const matches = uniqueBy(rows, (m) => m.id).filter((m) => normalizeCompanyNameKey(m.name) === nameKey);
    if (matches.length === 1) return resolved(deps.toSellUpCandidate(matches[0]), 'sellup_name');
    if (matches.length > 1) return ambiguous('sellup', matches.length);
  }

  return { status: 'none', hubspotUnavailable };
}
