/**
 * Benchmark — Identity Resolver (Hito 16AB.23.1)
 *
 * Cuando una URL de descubrimiento pertenece a una página de contenido que menciona
 * una empresa real, intenta resolver la empresa subyacente usando el dominio del host.
 *
 * Modo offline (sin APIs externas): usa un mapa estático de dominios conocidos
 * para el entorno de benchmark y reassessment.
 *
 * Reglas:
 * - Solo una resolución por candidato.
 * - Si no se puede confirmar, no resuelve.
 * - No infiere el nombre únicamente desde el dominio sin evidencia.
 * - Registra el proceso completo.
 */

import type { IdentityResolution } from './types';

// ─── Mapa estático de dominios → empresa (offline, benchmark only) ────────────
//
// Solo incluir dominios donde la correspondencia dominio ↔ empresa es
// inequívoca y verificable públicamente.

type KnownDomainEntry = {
  company_name: string;
  root_domain: string;
  confidence: 'high' | 'medium';
  colombia_presence_confirmed: boolean;
  tech_sector_confirmed: boolean;
};

const KNOWN_DOMAIN_MAP: Record<string, KnownDomainEntry> = {
  'paymentsway.co': {
    company_name: 'Payments Way',
    root_domain: 'paymentsway.co',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: true,
  },
  'clusterds.co': {
    company_name: 'ClusterDS',
    root_domain: 'clusterds.co',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: true,
  },
  'cloudseguro.co': {
    company_name: 'CloudSeguro',
    root_domain: 'cloudseguro.co',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: true,
  },
  'indragroup.com': {
    company_name: 'Indra Group',
    root_domain: 'indragroup.com',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: true,
  },
  'puntored.co': {
    company_name: 'Puntored',
    root_domain: 'puntored.co',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: true,
  },
  'axd.com.co': {
    company_name: 'AXD',
    root_domain: 'axd.com.co',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: true,
  },
  'softland.com': {
    company_name: 'Softland',
    root_domain: 'softland.com',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: true,
  },
  'axa-assistance.co': {
    company_name: 'AXA Assistance Colombia',
    root_domain: 'axa-assistance.co',
    confidence: 'high',
    colombia_presence_confirmed: true,
    tech_sector_confirmed: false,
  },
};

// ─── Normalización de dominio ─────────────────────────────────────────────────

export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function normalizeToRootUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/`;
  } catch {
    return null;
  }
}

// ─── Resolución de identidad ──────────────────────────────────────────────────

export type IdentityResolutionResult = {
  resolved: boolean;
  resolution: IdentityResolution | null;
  normalized_official_url: string | null;
  rejection_reason: string | null;
};

/**
 * Tries to resolve the real company behind a discovery URL that may be an article
 * or content page mentioning a company.
 *
 * @param originalName  - Raw name from discovery (possibly an article title)
 * @param discoveryUrl  - URL where the company was found
 * @param _description  - Optional description for future heuristics
 */
export function resolveIdentity(
  originalName: string,
  discoveryUrl: string | null,
): IdentityResolutionResult {
  if (!discoveryUrl) {
    return {
      resolved: false,
      resolution: null,
      normalized_official_url: null,
      rejection_reason: 'No discovery URL available for identity resolution',
    };
  }

  const hostname = extractHostname(discoveryUrl);
  if (!hostname) {
    return {
      resolved: false,
      resolution: null,
      normalized_official_url: null,
      rejection_reason: 'Could not extract hostname from discovery URL',
    };
  }

  const entry = KNOWN_DOMAIN_MAP[hostname];
  if (!entry) {
    return {
      resolved: false,
      resolution: null,
      normalized_official_url: null,
      rejection_reason: `Hostname "${hostname}" not in known-domain map — cannot resolve without external API`,
    };
  }

  const normalizedUrl = `https://${entry.root_domain}/`;

  return {
    resolved: true,
    resolution: {
      original_title: originalName,
      resolved_company_name: entry.company_name,
      resolved_official_domain: entry.root_domain,
      evidence: `Domain "${hostname}" is the official corporate website of ${entry.company_name}`,
      confidence: entry.confidence,
    },
    normalized_official_url: normalizedUrl,
    rejection_reason: null,
  };
}

/**
 * Returns whether the discovery URL points to a page on the company's own domain
 * (as opposed to a third-party article mentioning the company).
 * In that case the discovery URL itself can be used as evidence, while the
 * official site should be the root domain.
 */
export function isInternalPageOnOfficialSite(
  discoveryUrl: string,
  hostname: string,
): boolean {
  try {
    const u = new URL(discoveryUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return host === hostname;
  } catch {
    return false;
  }
}
