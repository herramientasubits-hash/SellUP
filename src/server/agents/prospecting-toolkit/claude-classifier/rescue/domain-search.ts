/**
 * Agente 1 · Rescate con Claude — descartadas SIN DOMINIO (Fase B, paso 1; puro).
 *
 * Apollo devuelve empresas con LinkedIn pero sin sitio web (`missing_domain_final`,
 * 160 en Prod el 30-09). Claude busca el sitio oficial (`domain-finder.ts`), se
 * revisa si ya existe en SellUp/HubSpot y, si es nueva, sigue el rescate de siempre.
 *
 * Qué se guarda en la evidencia (`claude_domain_search`): el sitio encontrado y cómo
 * se comprobó, o por qué no se encontró. Así una segunda corrida NO vuelve a pagar
 * la búsqueda: reutiliza el dominio ya comprobado.
 */

import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import { normalizeLinkedInCompanyUrl } from '../../linkedin-company-enrichment';
import type { DuplicateStatus } from '../../types';
import type { DomainFinderInput, DomainFinderOutcome } from '../domain-finder';
import { CLAUDE_CLASSIFIER_CONTRACT_VERSION, CLAUDE_CLASSIFIER_PROVIDER_KEY } from '../types';
import { CLAUDE_RESCUE_METADATA_KEY } from './rescue-patch';

export const DOMAIN_SEARCH_REASON_CODE = 'missing_domain_final';
export const CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY = 'claude_domain_search';
export const CLAUDE_DOMAIN_SEARCH_OPERATION_KEY = 'company_domain_search';
/**
 * Versión del buscador. d1 = #514 (30-09). d2 (01-10): nombre desde el slug de LinkedIn
 * cuando falta el original, subdominios de un resultado y URL fuera de la búsqueda si
 * enlaza al mismo LinkedIn. Un «no encontrado» de una versión anterior se reintenta UNA vez.
 */
export const DOMAIN_SEARCH_VERSION = 'd2';

/** Errores pasajeros (modelo, sitio caído) se reintentan hasta este número de búsquedas. */
export const DOMAIN_SEARCH_MAX_ATTEMPTS = 3;
const TRANSIENT_REASONS: ReadonlySet<string> = new Set(['model_error', 'page_unreachable']);

function previousAttempts(evidence: Evidence | null): number {
  const attempts = (evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { attempts?: unknown } | undefined)?.attempts;
  return typeof attempts === 'number' && attempts > 0 ? attempts : 0;
}

type Evidence = Record<string, unknown>;

export type DomainSearchRow = {
  id: string;
  name: string;
  domain: string | null;
  country_code: string | null;
  reason_code: string | null;
  evidence: Evidence | null;
};

export type FoundWebsite = {
  website: string;
  domain: string;
  verification: 'linkedin_cross_link' | 'name_match';
};

/** Resultado de revisar duplicados en SellUp + HubSpot (sólo lectura). */
export type DomainDuplicateCheck = { status: DuplicateStatus; summary: string };

function readString(evidence: Evidence | null, key: string): string | null {
  const value = evidence?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * «bbva-technology-en-america» → «Bbva Technology En America». Conserva el orden de
 * las palabras, que el `name` normalizado pierde. Quita el sufijo numérico que
 * LinkedIn agrega a slugs repetidos («unam_3», «prepa-en-linea-sep-286»).
 */
export function nameFromLinkedInSlug(linkedinUrl: string | null): string | null {
  if (!linkedinUrl) return null;
  const slug = normalizeLinkedInCompanyUrl(linkedinUrl).slug;
  if (!slug) return null;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // slug con % suelto: se usa tal cual
  }
  const words = decoded
    .replace(/[-_.]+\d+$/, '')
    .split(/[-_.]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1)).join(' ');
}

/**
 * El `name` de la disposición viene normalizado y desordenado («america bbva en
 * technology»). Primero el nombre original del proveedor; si falta (56 de 166 en
 * Prod el 01-10, todo el lote MX×Tec), el del slug de LinkedIn.
 */
export function dispositionDisplayName(row: Pick<DomainSearchRow, 'name' | 'evidence'>): string {
  return (
    readString(row.evidence, 'provider_raw_name') ??
    nameFromLinkedInSlug(readString(row.evidence, 'linkedin_url')) ??
    row.name
  );
}

export function dispositionLinkedInUrl(row: Pick<DomainSearchRow, 'evidence'>): string | null {
  const raw = readString(row.evidence, 'linkedin_url');
  if (!raw) return null;
  const normalized = normalizeLinkedInCompanyUrl(raw);
  return normalized.rejected ? null : normalized.normalized;
}

/** «Sitio no encontrado» con una versión vieja del buscador: vale un intento con la nueva. */
export function websiteNotFoundWithOlderSearch(evidence: Evidence | null): boolean {
  const rescue = evidence?.[CLAUDE_RESCUE_METADATA_KEY] as { decision?: unknown } | undefined;
  if (rescue?.decision !== 'website_not_found') return false;
  const search = evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { search_version?: unknown } | undefined;
  return search?.search_version !== DOMAIN_SEARCH_VERSION;
}

export function isDomainSearchCandidate(row: Pick<DomainSearchRow, 'domain' | 'reason_code'>): boolean {
  return !row.domain && row.reason_code === DOMAIN_SEARCH_REASON_CODE;
}

export function buildDomainFinderInput(row: DomainSearchRow, countryName: string | null): DomainFinderInput {
  return {
    name: dispositionDisplayName(row),
    countryName,
    countryCode: row.country_code,
    linkedinUrl: dispositionLinkedInUrl(row),
  };
}

/** Sitio ya encontrado y comprobado en una corrida anterior (no se vuelve a pagar). */
export function readFoundWebsite(evidence: Evidence | null): FoundWebsite | null {
  const search = evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as
    | { found?: unknown; website?: unknown; domain?: unknown; verification?: unknown }
    | undefined;
  if (search?.found !== true) return null;
  if (typeof search.website !== 'string' || typeof search.domain !== 'string') return null;
  if (search.verification !== 'linkedin_cross_link' && search.verification !== 'name_match') return null;
  return { website: search.website, domain: search.domain, verification: search.verification };
}

export function buildFoundEvidence(evidence: Evidence | null, found: FoundWebsite, searchedAt: string): Evidence {
  return {
    ...(evidence ?? {}),
    [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      search_version: DOMAIN_SEARCH_VERSION,
      searched_at: searchedAt,
      found: true,
      website: found.website,
      domain: found.domain,
      verification: found.verification,
    },
  };
}

/**
 * La empresa se QUEDA en Descartadas por la búsqueda del sitio (no encontrado, o ya
 * existe en SellUp/HubSpot). Un error pasajero se reintenta hasta DOMAIN_SEARCH_MAX_ATTEMPTS
 * búsquedas en total; lo demás es final.
 */
export function buildDomainSearchStaysEvidence(
  evidence: Evidence | null,
  params:
    | { kind: 'not_found'; outcome: Extract<DomainFinderOutcome, { found: false }> }
    | { kind: 'duplicate'; found: FoundWebsite; duplicate: DomainDuplicateCheck },
  decidedAt: string,
): Evidence {
  const attempts = previousAttempts(evidence) + (params.kind === 'not_found' ? 1 : 0);
  const base = params.kind === 'duplicate' ? buildFoundEvidence(evidence, params.found, decidedAt) : { ...(evidence ?? {}) };
  const search =
    params.kind === 'not_found'
      ? {
          contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
          search_version: DOMAIN_SEARCH_VERSION,
          searched_at: decidedAt,
          found: false,
          attempts,
          reason: params.outcome.reason,
          claimed_url: params.outcome.claimedUrl ?? null,
          error_code: params.outcome.errorCode ?? null,
        }
      : {
          ...(base[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as Evidence),
          duplicate_status: params.duplicate.status,
          duplicate_summary: params.duplicate.summary,
        };
  const retryable =
    params.kind === 'not_found' && TRANSIENT_REASONS.has(params.outcome.reason) && attempts < DOMAIN_SEARCH_MAX_ATTEMPTS;
  return {
    ...base,
    [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: search,
    [CLAUDE_RESCUE_METADATA_KEY]: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      decided_at: decidedAt,
      decision: retryable ? 'retryable' : params.kind === 'duplicate' ? 'duplicate' : 'website_not_found',
    },
  };
}

/** Columnas del candidato nuevo: nombre original, sitio comprobado y LinkedIn. */
export function buildFoundWebsiteColumns(row: DomainSearchRow, found: FoundWebsite): Record<string, unknown> {
  const linkedinUrl = dispositionLinkedInUrl(row);
  return {
    name: dispositionDisplayName(row),
    domain: found.domain,
    website: found.website,
    ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
  };
}

export function buildDomainSearchUsageLog(
  outcome: DomainFinderOutcome,
  context: { batchId: string; dispositionId: string; triggeredBy: string | null; searchedAt: string; durationMs: number },
): LogProviderUsageInput | null {
  if (!outcome.usage) return null;
  const isError = !outcome.found && outcome.reason === 'model_error';
  const errorCode = outcome.found ? undefined : outcome.errorCode ?? undefined;
  return {
    batch_id: context.batchId,
    usage_key: `${CLAUDE_DOMAIN_SEARCH_OPERATION_KEY}:${context.dispositionId}:${context.searchedAt}`,
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: CLAUDE_DOMAIN_SEARCH_OPERATION_KEY,
    model: outcome.usage.model,
    input_tokens: outcome.usage.inputTokens,
    output_tokens: outcome.usage.outputTokens,
    results_returned: outcome.found ? 1 : 0,
    estimated_cost_usd: outcome.usage.estimatedCostUsd,
    status: isError && errorCode === 'rate_limited' ? 'rate_limited' : isError ? 'error' : 'success',
    error_code: errorCode,
    duration_ms: context.durationMs,
    triggered_by: context.triggeredBy ?? undefined,
    metadata: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      flow: 'claude_rescue',
      disposition_id: context.dispositionId,
      found: outcome.found,
      reason: outcome.found ? outcome.verification : outcome.reason,
      web_search_requests: outcome.usage.webSearchRequests,
      pricing_source: outcome.usage.pricingSource,
    },
  };
}
