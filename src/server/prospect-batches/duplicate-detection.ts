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
  tax_identifier_candidate?: string | null;
  normalized_name?: string | null;
  linkedin_url?: string | null;
}

export interface SellUpDuplicateCheck {
  status: 'no_match' | 'possible_duplicate' | 'duplicate' | 'error';
  matched_account_id: string | null;
  matched_candidate_id: string | null;
  matched_name: string | null;
  matched_domain: string | null;
  matched_website: string | null;
  matched_country_code: string | null;
  matched_tax_identifier: string | null;
  matched_source: 'account' | 'prospect_candidate' | null;
  matched_status: string | null;
  matched_by: string | null;
  confidence: number;
}

export interface HubSpotDuplicateCheck {
  status: 'not_configured' | 'no_match' | 'possible_match' | 'match' | 'error';
  matched_company_id: string | null;
  matched_company_name: string | null;
  matched_domain: string | null;
  matched_website: string | null;
  matched_phone: string | null;
  matched_country: string | null;
  matched_city: string | null;
  matched_state: string | null;
  matched_address: string | null;
  matched_industry: string | null;
  matched_macro_industry: string | null;
  matched_lifecycle_stage: string | null;
  matched_lead_status: string | null;
  matched_owner_id: string | null;
  matched_number_of_employees: string | null;
  matched_description: string | null;
  matched_linkedin_url: string | null;
  matched_linkedin_bio: string | null;
  matched_tax_identifier: string | null;
  matched_createdate: string | null;
  matched_lastmodifieddate: string | null;
  matched_by: string | null;
  confidence: number;
  hubspot_url: string | null;
  tax_identifier_candidate_used?: string | null;
  source?: string | null;
  requires_human_review?: boolean;
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
  name?: string | null;
  domain?: string | null;
  website?: string | null;
  country_code?: string | null;
  tax_identifier?: string | null;
  status?: string | null;
  source_primary?: string | null;
}

async function checkSellUp(
  supabase: SupabaseClient,
  candidateId: string,
  keys: NormalizedKeys,
  taxIdentifierRaw: string | null,
  taxIdentifierCandidateRaw: string | null
): Promise<SellUpDuplicateCheck> {
  const NO_MATCH: SellUpDuplicateCheck = {
    status: 'no_match',
    matched_account_id: null,
    matched_candidate_id: null,
    matched_name: null,
    matched_domain: null,
    matched_website: null,
    matched_country_code: null,
    matched_tax_identifier: null,
    matched_source: null,
    matched_status: null,
    matched_by: null,
    confidence: 0,
  };

  const result: SellUpDuplicateCheck = { ...NO_MATCH };

  const ACC_SELECT = 'id, name, domain, website, country_code, tax_identifier';
  const CAND_SELECT = 'id, name, domain, website, country_code, tax_identifier, status, source_primary';

  try {
    // ── 1. Tax identifier exacto ──────────────────────────────
    if (taxIdentifierRaw && taxIdentifierRaw.trim().length >= 4) {
      const { data: accMatch } = await supabase
        .from('accounts')
        .select(ACC_SELECT)
        .eq('tax_identifier', taxIdentifierRaw.trim())
        .is('archived_at', null)
        .limit(1);

      if (accMatch && accMatch.length > 0) {
        const r = accMatch[0] as SellUpRow;
        return {
          status: 'duplicate',
          matched_account_id: r.id,
          matched_candidate_id: null,
          matched_name: r.name ?? null,
          matched_domain: r.domain ?? null,
          matched_website: r.website ?? null,
          matched_country_code: r.country_code ?? null,
          matched_tax_identifier: r.tax_identifier ?? null,
          matched_source: 'account',
          matched_status: null,
          matched_by: 'tax_identifier',
          confidence: 100,
        };
      }

      const { data: candMatch } = await supabase
        .from('prospect_candidates')
        .select(CAND_SELECT)
        .eq('tax_identifier', taxIdentifierRaw.trim())
        .neq('id', candidateId)
        .neq('status', 'discarded')
        .limit(1);

      if (candMatch && candMatch.length > 0) {
        const r = candMatch[0] as SellUpRow;
        return {
          status: 'duplicate',
          matched_account_id: null,
          matched_candidate_id: r.id,
          matched_name: r.name ?? null,
          matched_domain: r.domain ?? null,
          matched_website: r.website ?? null,
          matched_country_code: r.country_code ?? null,
          matched_tax_identifier: r.tax_identifier ?? null,
          matched_source: 'prospect_candidate',
          matched_status: r.status ?? null,
          matched_by: 'tax_identifier',
          confidence: 100,
        };
      }
    }

    // ── 1B. Tax identifier candidato (señal de duplicidad) ───
    if (taxIdentifierCandidateRaw && taxIdentifierCandidateRaw.trim().length >= 4) {
      const cleanedCandidateTaxId = taxIdentifierCandidateRaw.trim();
      const { data: accMatch } = await supabase
        .from('accounts')
        .select(ACC_SELECT)
        .eq('tax_identifier', cleanedCandidateTaxId)
        .is('archived_at', null)
        .limit(1);

      if (accMatch && accMatch.length > 0) {
        const r = accMatch[0] as SellUpRow;
        return {
          status: 'possible_duplicate',
          matched_account_id: r.id,
          matched_candidate_id: null,
          matched_name: r.name ?? null,
          matched_domain: r.domain ?? null,
          matched_website: r.website ?? null,
          matched_country_code: r.country_code ?? null,
          matched_tax_identifier: r.tax_identifier ?? null,
          matched_source: 'account',
          matched_status: null,
          matched_by: 'tax_identifier_candidate',
          confidence: 85,
        };
      }

      const { data: candMatch } = await supabase
        .from('prospect_candidates')
        .select(CAND_SELECT)
        .eq('tax_identifier', cleanedCandidateTaxId)
        .neq('id', candidateId)
        .neq('status', 'discarded')
        .limit(1);

      if (candMatch && candMatch.length > 0) {
        const r = candMatch[0] as SellUpRow;
        return {
          status: 'possible_duplicate',
          matched_account_id: null,
          matched_candidate_id: r.id,
          matched_name: r.name ?? null,
          matched_domain: r.domain ?? null,
          matched_website: r.website ?? null,
          matched_country_code: r.country_code ?? null,
          matched_tax_identifier: r.tax_identifier ?? null,
          matched_source: 'prospect_candidate',
          matched_status: r.status ?? null,
          matched_by: 'tax_identifier_candidate',
          confidence: 85,
        };
      }
    }

    // ── 2. Domain exacto ─────────────────────────────────────
    if (keys.normalized_domain) {
      const { data: accMatch } = await supabase
        .from('accounts')
        .select(ACC_SELECT)
        .eq('domain', keys.normalized_domain)
        .is('archived_at', null)
        .limit(1);

      if (accMatch && accMatch.length > 0) {
        const r = accMatch[0] as SellUpRow;
        return {
          status: 'duplicate',
          matched_account_id: r.id,
          matched_candidate_id: null,
          matched_name: r.name ?? null,
          matched_domain: r.domain ?? null,
          matched_website: r.website ?? null,
          matched_country_code: r.country_code ?? null,
          matched_tax_identifier: r.tax_identifier ?? null,
          matched_source: 'account',
          matched_status: null,
          matched_by: 'domain',
          confidence: 100,
        };
      }

      const { data: candMatch } = await supabase
        .from('prospect_candidates')
        .select(CAND_SELECT)
        .eq('domain', keys.normalized_domain)
        .neq('id', candidateId)
        .neq('status', 'discarded')
        .limit(1);

      if (candMatch && candMatch.length > 0) {
        const r = candMatch[0] as SellUpRow;
        return {
          status: 'duplicate',
          matched_account_id: null,
          matched_candidate_id: r.id,
          matched_name: r.name ?? null,
          matched_domain: r.domain ?? null,
          matched_website: r.website ?? null,
          matched_country_code: r.country_code ?? null,
          matched_tax_identifier: r.tax_identifier ?? null,
          matched_source: 'prospect_candidate',
          matched_status: r.status ?? null,
          matched_by: 'domain',
          confidence: 100,
        };
      }
    }

    // ── 3. Nombre normalizado + país ─────────────────────────
    if (keys.normalized_name && keys.normalized_name.length >= 3 && keys.country_code) {
      const { data: accMatch } = await supabase
        .from('accounts')
        .select(ACC_SELECT)
        .eq('normalized_name', keys.normalized_name)
        .eq('country_code', keys.country_code)
        .is('archived_at', null)
        .limit(1);

      if (accMatch && accMatch.length > 0) {
        const r = accMatch[0] as SellUpRow;
        result.status = 'possible_duplicate';
        result.matched_account_id = r.id;
        result.matched_name = r.name ?? null;
        result.matched_domain = r.domain ?? null;
        result.matched_website = r.website ?? null;
        result.matched_country_code = r.country_code ?? null;
        result.matched_tax_identifier = r.tax_identifier ?? null;
        result.matched_source = 'account';
        result.matched_by = 'normalized_name_country';
        result.confidence = 85;
      } else {
        const { data: candMatch } = await supabase
          .from('prospect_candidates')
          .select(CAND_SELECT)
          .eq('normalized_name', keys.normalized_name)
          .eq('country_code', keys.country_code)
          .neq('id', candidateId)
          .neq('status', 'discarded')
          .limit(1);

        if (candMatch && candMatch.length > 0) {
          const r = candMatch[0] as SellUpRow;
          result.status = 'possible_duplicate';
          result.matched_candidate_id = r.id;
          result.matched_name = r.name ?? null;
          result.matched_domain = r.domain ?? null;
          result.matched_website = r.website ?? null;
          result.matched_country_code = r.country_code ?? null;
          result.matched_tax_identifier = r.tax_identifier ?? null;
          result.matched_source = 'prospect_candidate';
          result.matched_status = r.status ?? null;
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
      matched_name: null,
      matched_domain: null,
      matched_website: null,
      matched_country_code: null,
      matched_tax_identifier: null,
      matched_source: null,
      matched_status: null,
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
  const EMPTY_HS: HubSpotDuplicateCheck = {
    status: 'not_configured',
    matched_company_id: null,
    matched_company_name: null,
    matched_domain: null,
    matched_website: null,
    matched_phone: null,
    matched_country: null,
    matched_city: null,
    matched_state: null,
    matched_address: null,
    matched_industry: null,
    matched_macro_industry: null,
    matched_lifecycle_stage: null,
    matched_lead_status: null,
    matched_owner_id: null,
    matched_number_of_employees: null,
    matched_description: null,
    matched_linkedin_url: null,
    matched_linkedin_bio: null,
    matched_tax_identifier: null,
    matched_createdate: null,
    matched_lastmodifieddate: null,
    matched_by: null,
    confidence: 0,
    hubspot_url: null,
  };

  try {
    const outcome = await checkHubSpotDuplicates(input);

    if (!outcome.connected) {
      return { check: { ...EMPTY_HS, status: 'not_configured' }, connected: false };
    }

    const matches = outcome.matches ?? [];

    if (matches.length === 0) {
      return {
        check: { ...EMPTY_HS, status: outcome.error ? 'error' : 'no_match' },
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

    const raw = best.raw as Record<string, string | null | undefined> | undefined;

    return {
      check: {
        status: isExactMatch ? 'match' : 'possible_match',
        matched_company_id: best.matchedId ?? null,
        matched_company_name: best.matchedName ?? null,
        matched_domain: best.matchedDomain ?? null,
        matched_website: best.matchedWebsite ?? null,
        matched_phone: raw?.phone ?? null,
        matched_country: raw?.country ?? raw?.pais ?? null,
        matched_city: raw?.city ?? raw?.ciudad ?? null,
        matched_state: raw?.state ?? null,
        matched_address: raw?.address ?? null,
        matched_industry: raw?.industry ?? null,
        matched_macro_industry: raw?.macro_industria ?? null,
        matched_lifecycle_stage: raw?.lifecyclestage ?? null,
        matched_lead_status: raw?.hs_lead_status ?? null,
        matched_owner_id: raw?.hubspot_owner_id ?? null,
        matched_number_of_employees: raw?.numberofemployees ?? null,
        matched_description: raw?.description ?? null,
        matched_linkedin_url: raw?.linkedin_company_page ?? raw?.linkedin_url ?? null,
        matched_linkedin_bio: raw?.linkedinbio ?? null,
        matched_tax_identifier: raw?.nit ?? raw?.identificacion_fiscal ?? raw?.rfc ?? raw?.ruc ?? raw?.tax_id ?? best.matchedTaxIdentifier ?? null,
        matched_createdate: raw?.createdate ?? null,
        matched_lastmodifieddate: raw?.hs_lastmodifieddate ?? null,
        matched_by,
        confidence: best.confidence,
        hubspot_url: raw?.hubspot_url ?? null,
      },
      connected: true,
    };
  } catch {
    return {
      check: { ...EMPTY_HS, status: 'error' },
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
    taxIdentifierCandidate: candidate.tax_identifier_candidate ?? undefined,
  };

  const [sellupCheck, hubspotResult] = await Promise.all([
    checkSellUp(
      supabase,
      candidate.id,
      normalizedKeys,
      candidate.tax_identifier ?? null,
      candidate.tax_identifier_candidate ?? null
    ),
    includeHubSpot
      ? checkHubSpot(hubspotInput)
      : Promise.resolve({
          check: {
            status: 'not_configured' as const,
            matched_company_id: null,
            matched_company_name: null,
            matched_domain: null,
            matched_website: null,
            matched_phone: null,
            matched_country: null,
            matched_city: null,
            matched_state: null,
            matched_address: null,
            matched_industry: null,
            matched_macro_industry: null,
            matched_lifecycle_stage: null,
            matched_lead_status: null,
            matched_owner_id: null,
            matched_number_of_employees: null,
            matched_description: null,
            matched_linkedin_url: null,
            matched_linkedin_bio: null,
            matched_tax_identifier: null,
            matched_createdate: null,
            matched_lastmodifieddate: null,
            matched_by: null,
            confidence: 0,
            hubspot_url: null,
          } as HubSpotDuplicateCheck,
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
