/**
 * Lusha People Adapter — Agente 2A · Hito 17B.3 / 17B.4J
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

// Conectores que van en minúsculas salvo que sean el primer token del nombre.
const LOWERCASE_CONNECTORS = new Set([
  'de', 'del', 'la', 'las', 'los', 'y', 'e', 'el',
  'di', 'da', 'dos', 'das', 'von', 'van', 'der',
]);

/**
 * Normaliza un nombre completo devuelto por Lusha:
 * - null/vacío → null
 * - Normalización Unicode NFC (resuelve combining characters)
 * - Colapsa espacios múltiples
 * - Capitalización título por token (preserva acentos existentes)
 * - Conectores comunes en minúsculas (de, del, la, las…)
 * - NO inventa acentos ausentes ("hernandez" ≠ "hernández")
 */
export function normalizeLushaPersonName(input: string | null | undefined): string | null {
  if (input == null) return null;
  const nfc = input.normalize('NFC').trim();
  if (!nfc) return null;
  const collapsed = nfc.replace(/\s+/g, ' ');
  const tokens = collapsed.split(' ');
  const result = tokens.map((token, i) => {
    if (!token) return token;
    const lower = token.toLowerCase();
    if (i > 0 && LOWERCASE_CONNECTORS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
  return result.join(' ') || null;
}

function buildFullName(raw: LushaRawDecisionMaker): string | null {
  const first = raw.firstName?.trim() ?? '';
  const last = raw.lastName?.trim() ?? '';
  const fromParts = `${first} ${last}`.trim();
  const raw_name = fromParts || raw.fullName?.trim() || raw.name?.trim() || null;
  return normalizeLushaPersonName(raw_name);
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
