/**
 * Lusha People Adapter — Agente 2A · Hito 17B.3
 *
 * Funciones puras para normalizar respuestas mock/reales de Lusha.
 * Sin llamadas a la API. Phone siempre null.
 */

import { normalizeDomain } from './company-consistency-checker';
import type {
  LushaRawDecisionMaker,
  NormalizedLushaContact,
  LushaUsageMetadata,
  LushaUsageMetadataInput,
} from './lusha-types';

function buildFullName(raw: LushaRawDecisionMaker): string | null {
  if (raw.fullName?.trim()) return raw.fullName.trim();
  if (raw.name?.trim()) return raw.name.trim();
  const first = raw.firstName?.trim() ?? '';
  const last = raw.lastName?.trim() ?? '';
  const combined = `${first} ${last}`.trim();
  return combined || null;
}

function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('http')) return trimmed;
  return `https://www.linkedin.com/in/${trimmed}`;
}

export function normalizeLushaDecisionMaker(
  raw: LushaRawDecisionMaker,
  context: {
    companyName: string;
    companyDomain: string | null;
    countryCode: string | null;
  }
): NormalizedLushaContact {
  const fullName = buildFullName(raw);
  const title = raw.title?.trim() || raw.jobTitle?.trim() || null;
  const email = raw.email?.trim() || null;
  const linkedinUrl = normalizeLinkedinUrl(raw.linkedinUrl);
  const companyDomain =
    normalizeDomain(raw.companyDomain) ?? normalizeDomain(context.companyDomain);

  return {
    provider: 'lusha',
    providerPersonId: raw.id?.trim() || null,
    fullName,
    title,
    email,
    phone: null, // Phone reveal disabled in v1. Never change this.
    linkedinUrl,
    companyName: raw.companyName?.trim() || context.companyName,
    companyDomain: companyDomain ?? null,
    countryCode: raw.country?.trim() || context.countryCode,
    raw,
    metadata: {
      provider: 'lusha',
      lusha_id: raw.id?.trim() || null,
      source_endpoint: 'decision_makers',
      reveal: ['emails'],
      phone_reveal_enabled: false,
    },
  };
}

export function buildLushaUsageMetadata(
  input: LushaUsageMetadataInput
): LushaUsageMetadata {
  return {
    provider: 'lusha',
    endpoint: input.endpoint,
    company_name: input.companyName,
    company_domain: input.companyDomain,
    raw_results_count: input.rawResultsCount,
    normalized_count: input.normalizedCount,
    inserted_candidates_count: input.insertedCandidatesCount,
    phone_reveal_enabled: false,
    billing: input.billing ?? null,
    request_id: input.requestId ?? null,
  };
}
