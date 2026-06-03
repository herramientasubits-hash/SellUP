/**
 * Detección universal de duplicados para prospect_candidates.
 *
 * Funciona para cualquier origen: external_import, agent_1, socrata_colombia,
 * datos_gob_cl, denue_mexico, manual, futuros sources.
 *
 * Valida contra:
 *   1. SellUp (accounts + prospect_candidates)
 *   2. HubSpot en modo solo lectura, si está configurado
 *
 * No crea accounts. No escribe en HubSpot.
 * No llama a Tavily, Claude, Gemini ni Apollo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeTaxIdentifier,
  normalizeLinkedinUrl,
} from '@/server/agents/prospecting-toolkit/normalization';
import {
  checkHubSpotDuplicates,
} from '@/server/agents/prospecting-toolkit/hubspot-duplicate-checker';
import type { DuplicateCheckInput } from '@/server/agents/prospecting-toolkit/types';

// ============================================================
// Tipos de entrada y salida
// ============================================================

export interface CandidateForDetection {
  id: string;
  name: string;
  website?: string | null;
  domain?: string | null;
  country_code?: string | null;
  tax_identifier?: string | null;
  normalized_name?: string | null;
  linkedin_url?: string | null;
}

export interface SellUpDuplicateCheck {
  status: 'no_match' | 'possible_duplicate' | 'duplicate' | 'error';
  matched_account_id: string | null;
  matched_candidate_id: string | null;
  matched_by: string | null;
  confidence: number;
}

export interface HubSpotDuplicateCheck {
  status: 'not_configured' | 'no_match' | 'possible_match' | 'match' | 'error';
  matched_company_id: string | null;
  matched_company_name: string | null;
  matched_by: string | null;
  confidence: number;
}

export interface NormalizedKeys {
  normalized_name: string;
  normalized_domain: string | null;
  normalized_tax_identifier: string | null;
  normalized_linkedin_url: string | null;
  country_code: string | null;
}

export interface CandidateDuplicateResult {
  sellup_duplicate_check: SellUpDuplicateCheck;
  hubspot_duplicate_check: HubSpotDuplicateCheck;
  normalized_keys: NormalizedKeys;
  /** Campo derivado para almacenar en duplicate_status de BD */
  db_duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  /** Campo derivado para matched_account_id en BD */
  db_matched_account_id: string | null;
  /** Campo derivado para matched_hubspot_company_id en BD */
  db_matched_hubspot_company_id: string | null;
  /** Campo derivado para confidence_score en BD */
  db_confidence_score: number;
  /** true cuando HubSpot respondió (aunque sea not_configured) */
  hubspot_connected: boolean;
}

// ============================================================
// Verificación en SellUp
// ============================================================

interface SellUpRow {
  id: string;
}

async function checkSellUp(
  supabase: SupabaseClient,
  candidateId: string,
  keys: NormalizedKeys,
  taxIdentifierRaw: string | null
): Promise<SellUpDuplicateCheck> {
  const result: SellUpDuplicateCheck = {
    status: 'no_match',
    matched_account_id: null,
    matched_candidate_id: null,
    matched_by: null,
    confidence: 0,
  };

  try {
    // ── 1. Tax identifier exacto ──────────────────────────────
    if (taxIdentifierRaw && taxIdentifierRaw.trim().length >= 4) {
      const { data: accMatch } = await supabase
        .from('accounts')
        .select('id')
        .eq('tax_identifier', taxIdentifierRaw.trim())
        .is('archived_at', null)
        .limit(1);

      if (accMatch && accMatch.length > 0) {
        return {
          status: 'duplicate',
          matched_account_id: (accMatch[0] as SellUpRow).id,
          matched_candidate_id: null,
          matched_by: 'tax_identifier',
          confidence: 100,
        };
      }

      const { data: candMatch } = await supabase
        .from('prospect_candidates')
        .select('id')
        .eq('tax_identifier', taxIdentifierRaw.trim())
        .neq('id', candidateId)
        .neq('status', 'discarded')
        .limit(1);

      if (candMatch && candMatch.length > 0) {
        return {
          status: 'duplicate',
          matched_account_id: null,
          matched_candidate_id: (candMatch[0] as SellUpRow).id,
          matched_by: 'tax_identifier',
          confidence: 100,
        };
      }
    }

    // ── 2. Domain exacto ─────────────────────────────────────
    if (keys.normalized_domain) {
      const { data: accMatch } = await supabase
        .from('accounts')
        .select('id')
        .eq('domain', keys.normalized_domain)
        .is('archived_at', null)
        .limit(1);

      if (accMatch && accMatch.length > 0) {
        return {
          status: 'duplicate',
          matched_account_id: (accMatch[0] as SellUpRow).id,
          matched_candidate_id: null,
          matched_by: 'domain',
          confidence: 100,
        };
      }

      const { data: candMatch } = await supabase
        .from('prospect_candidates')
        .select('id')
        .eq('domain', keys.normalized_domain)
        .neq('id', candidateId)
        .neq('status', 'discarded')
        .limit(1);

      if (candMatch && candMatch.length > 0) {
        return {
          status: 'duplicate',
          matched_account_id: null,
          matched_candidate_id: (candMatch[0] as SellUpRow).id,
          matched_by: 'domain',
          confidence: 100,
        };
      }
    }

    // ── 3. Nombre normalizado + país ─────────────────────────
    if (keys.normalized_name && keys.normalized_name.length >= 3 && keys.country_code) {
      const { data: accMatch } = await supabase
        .from('accounts')
        .select('id')
        .eq('normalized_name', keys.normalized_name)
        .eq('country_code', keys.country_code)
        .is('archived_at', null)
        .limit(1);

      if (accMatch && accMatch.length > 0) {
        result.status = 'possible_duplicate';
        result.matched_account_id = (accMatch[0] as SellUpRow).id;
        result.matched_by = 'normalized_name_country';
        result.confidence = 85;
      } else {
        const { data: candMatch } = await supabase
          .from('prospect_candidates')
          .select('id')
          .eq('normalized_name', keys.normalized_name)
          .eq('country_code', keys.country_code)
          .neq('id', candidateId)
          .neq('status', 'discarded')
          .limit(1);

        if (candMatch && candMatch.length > 0) {
          result.status = 'possible_duplicate';
          result.matched_candidate_id = (candMatch[0] as SellUpRow).id;
          result.matched_by = 'normalized_name_country';
          result.confidence = 85;
        }
      }
    }
  } catch {
    return {
      status: 'error',
      matched_account_id: null,
      matched_candidate_id: null,
      matched_by: null,
      confidence: 0,
    };
  }

  return result;
}

// ============================================================
// Verificación en HubSpot — solo lectura
// ============================================================

async function checkHubSpot(
  input: DuplicateCheckInput
): Promise<{ check: HubSpotDuplicateCheck; connected: boolean }> {
  try {
    const outcome = await checkHubSpotDuplicates(input);

    if (!outcome.connected) {
      return {
        check: {
          status: 'not_configured',
          matched_company_id: null,
          matched_company_name: null,
          matched_by: null,
          confidence: 0,
        },
        connected: false,
      };
    }

    const matches = outcome.matches ?? [];

    if (matches.length === 0) {
      return {
        check: {
          status: outcome.error ? 'error' : 'no_match',
          matched_company_id: null,
          matched_company_name: null,
          matched_by: null,
          confidence: 0,
        },
        connected: true,
      };
    }

    // Mejor match
    const best = matches.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
    const isExactMatch = best.status === 'existing_in_hubspot';

    let matched_by: string | null = null;
    if (best.reason?.includes('Dominio')) matched_by = 'domain';
    else if (best.reason?.includes('nombre')) matched_by = 'company_name';
    else matched_by = 'company_name';

    return {
      check: {
        status: isExactMatch ? 'match' : 'possible_match',
        matched_company_id: best.matchedId ?? null,
        matched_company_name: best.matchedName ?? null,
        matched_by,
        confidence: best.confidence,
      },
      connected: true,
    };
  } catch {
    return {
      check: {
        status: 'error',
        matched_company_id: null,
        matched_company_name: null,
        matched_by: null,
        confidence: 0,
      },
      connected: false,
    };
  }
}

// ============================================================
// detectCandidateDuplicates — función principal
// ============================================================

/**
 * Detecta duplicados para un candidato en SellUp y HubSpot.
 *
 * Funciona para cualquier origen (external_import, agent_1, sourcing IA, manual, etc.)
 * y cualquier país (Colombia, Chile, México, Guatemala, etc.).
 *
 * - Solo lectura. No crea ni modifica registros.
 * - Si HubSpot no está configurado, retorna status: 'not_configured' sin fallar.
 *
 * @example
 * const result = await detectCandidateDuplicates({
 *   supabase,
 *   candidate: { id, name, domain, country_code, tax_identifier },
 *   includeHubSpot: true,
 * });
 * // result.sellup_duplicate_check.status → 'no_match' | 'possible_duplicate' | 'duplicate'
 * // result.hubspot_duplicate_check.status → 'not_configured' | 'no_match' | 'match' | ...
 */
export async function detectCandidateDuplicates({
  supabase,
  candidate,
  includeHubSpot = true,
}: {
  supabase: SupabaseClient;
  candidate: CandidateForDetection;
  includeHubSpot?: boolean;
}): Promise<CandidateDuplicateResult> {
  // ── Normalizar claves ────────────────────────────────────────
  const normalizedName = normalizeCompanyName(candidate.name ?? '');
  const normalizedDomain =
    normalizeDomain(candidate.domain ?? '') ??
    normalizeDomain(candidate.website ?? '');
  const normalizedTaxId = candidate.tax_identifier
    ? normalizeTaxIdentifier(candidate.tax_identifier)
    : null;
  const normalizedLinkedin = normalizeLinkedinUrl(candidate.linkedin_url);
  const countryCode = candidate.country_code
    ? candidate.country_code.toUpperCase().trim()
    : null;

  const normalizedKeys: NormalizedKeys = {
    normalized_name: normalizedName,
    normalized_domain: normalizedDomain,
    normalized_tax_identifier: normalizedTaxId,
    normalized_linkedin_url: normalizedLinkedin,
    country_code: countryCode,
  };

  // ── Verificación paralela SellUp + HubSpot ───────────────────
  const hubspotInput: DuplicateCheckInput = {
    name: candidate.name,
    website: candidate.website ?? undefined,
    domain: normalizedDomain ?? undefined,
    countryCode: countryCode ?? undefined,
    taxIdentifier: candidate.tax_identifier ?? undefined,
  };

  const [sellupCheck, hubspotResult] = await Promise.all([
    checkSellUp(supabase, candidate.id, normalizedKeys, candidate.tax_identifier ?? null),
    includeHubSpot
      ? checkHubSpot(hubspotInput)
      : Promise.resolve({
          check: {
            status: 'not_configured' as const,
            matched_company_id: null,
            matched_company_name: null,
            matched_by: null,
            confidence: 0,
          },
          connected: false,
        }),
  ]);

  const hubspotCheck = hubspotResult.check;

  // ── Derivar campos de BD ─────────────────────────────────────
  let dbDuplicateStatus: CandidateDuplicateResult['db_duplicate_status'] = 'no_match';

  if (sellupCheck.status === 'duplicate') {
    dbDuplicateStatus = 'exact_duplicate';
  } else if (sellupCheck.status === 'possible_duplicate') {
    dbDuplicateStatus = 'possible_duplicate';
  } else if (hubspotCheck.status === 'match') {
    dbDuplicateStatus = 'possible_duplicate';
  } else if (hubspotCheck.status === 'possible_match') {
    dbDuplicateStatus = 'possible_duplicate';
  } else if (!normalizedName && !normalizedDomain && !normalizedTaxId) {
    dbDuplicateStatus = 'insufficient_data';
  }

  const dbConfidenceScore =
    sellupCheck.confidence > 0
      ? sellupCheck.confidence
      : hubspotCheck.confidence;

  return {
    sellup_duplicate_check: sellupCheck,
    hubspot_duplicate_check: hubspotCheck,
    normalized_keys: normalizedKeys,
    db_duplicate_status: dbDuplicateStatus,
    db_matched_account_id: sellupCheck.matched_account_id,
    db_matched_hubspot_company_id: hubspotCheck.matched_company_id,
    db_confidence_score: dbConfidenceScore,
    hubspot_connected: hubspotResult.connected,
  };
}
