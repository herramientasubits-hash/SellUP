/**
 * Perú Migo Legal Enrichment — Perú.6A
 *
 * Foundation module for using Migo Perú API as a legal enrichment
 * point-query source for Peru candidates.
 *
 * Migo CAN provide:
 *   ruc, nombre_o_razon_social, estado_del_contribuyente,
 *   condicion_de_domicilio, ubigeo, direccion, actualizado_en
 *
 * Migo CANNOT provide (MVP blocklist):
 *   CIIU, official sector, economic activity discovery
 *
 * This module stores enrichment output at:
 *   metadata.source_enrichment.pe_migo_api
 *
 * It does NOT overwrite metadata.source_enrichment.pe_sunat_bulk.
 *
 * GUARDRAILS — this module must NEVER:
 * - Call Migo API directly (no fetch) — lookupFn is always injected
 * - Call SUNAT API directly
 * - Call Tavily or any web search API
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Set official_ciiu_available to true
 * - Assign sector_source to any value other than 'not_provided_by_migo'
 * - Store raw_payload or rawPayload in metadata
 * - Expose API key in metadata or logs
 * - Use NEXT_PUBLIC_MIGO
 *
 * Relationship with pe_sunat_bulk:
 * - pe_sunat_bulk: offline snapshot validation (Perú.5C)
 * - pe_migo_api: point-query live legal enrichment (Perú.6A+)
 * - Both coexist under metadata.source_enrichment — no key overwrites the other
 * - pe_migo_api complements pe_sunat_bulk; never replaces it
 * - Migo may complement when: SUNAT snapshot did not find the RUC,
 *   or real-time validation of status/domicile is needed.
 *
 * See docs/PERU_MVP_ACTIVATION_PLAN.md §Perú.6A
 */

import {
  normalizeRuc,
  isValidRuc,
} from '../source-catalog/connectors/sunat-peru/normalizers';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PeMigoApiEnrichmentInput {
  candidateId?: string;
  accountId?: string;
  countryCode: string;
  /** Direct RUC field */
  ruc?: string | null;
  /** tax_id or tax_identifier column from prospect_candidates */
  taxId?: string | null;
  legalName?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Normalized payload from Migo API for a single RUC query.
 * Does NOT include raw_payload, token, authorization headers,
 * legal representatives, or any personal data.
 */
export interface PeMigoApiLookupPayload {
  ruc: string;
  legal_name: string | null;
  taxpayer_status: string | null;
  domicile_condition: string | null;
  ubigeo: string | null;
  address: string | null;
  updated_at_source: string | null;
}

export type PeMigoApiLookupStatus =
  | 'found'
  | 'not_found'
  | 'api_unavailable';

export interface PeMigoApiLookupResult {
  status: PeMigoApiLookupStatus;
  payload?: PeMigoApiLookupPayload;
  error?: string;
}

export type PeMigoLegalValidationStatus =
  | 'verified'
  | 'not_found'
  | 'flagged'
  | 'api_unavailable'
  | 'pending_validation'
  | 'invalid_ruc_format';

export type PeMigoLegalValidationReason =
  | 'migo_ruc_found_active'
  | 'migo_ruc_not_found'
  | 'migo_taxpayer_inactive'
  | 'migo_domicile_not_habido'
  | 'migo_api_unavailable'
  | 'invalid_ruc_format'
  | 'missing_ruc';

/**
 * Stored at metadata.source_enrichment.pe_migo_api after enrichment.
 *
 * CIIU invariants are always present and always indicate that Migo
 * does not provide official CIIU data. These must never be changed.
 */
export interface PeMigoApiEnrichmentBlock {
  ruc: string | null;
  legal_name: string | null;
  taxpayer_status: string | null;
  domicile_condition: string | null;
  ubigeo: string | null;
  address: string | null;
  updated_at_source: string | null;
  source_key: 'pe_migo_api';
  enriched_at: string;
  legal_validation_status: PeMigoLegalValidationStatus;
  legal_validation_reason: PeMigoLegalValidationReason;
  /** Migo does NOT provide CIIU — always 'unavailable_for_mvp' */
  ciiu_status: 'unavailable_for_mvp';
  /** Migo does NOT provide official CIIU — always false */
  official_ciiu_available: false;
  /** Migo does NOT provide sector — always 'not_provided_by_migo' */
  sector_source: 'not_provided_by_migo';
}

export type PeMigoApiEnrichmentReason =
  | 'not_pe_country'
  | 'invalid_ruc_format'
  | 'no_ruc'
  | 'migo_lookup_completed';

export interface PeMigoApiEnrichmentResult {
  enriched: boolean;
  countryCode: string;
  ruc: string | null;
  /** pe_migo_api block to merge into metadata.source_enrichment — null for non-PE */
  pe_migo_api: PeMigoApiEnrichmentBlock | null;
  reason: PeMigoApiEnrichmentReason;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * CIIU invariants present in every Migo enrichment block.
 * Migo does not provide CIIU data. These must always be present
 * and must never change to true/available.
 */
const PE_MIGO_CIIU_INVARIANTS = {
  ciiu_status: 'unavailable_for_mvp' as const,
  official_ciiu_available: false as const,
  sector_source: 'not_provided_by_migo' as const,
};

// ── Default lookup (not yet wired — returns api_unavailable safely) ────────────

/**
 * Placeholder lookup. Returns api_unavailable until a real Migo API caller
 * is implemented in a future hito. This prevents accidental real calls
 * before the caller is wired.
 */
const _notYetImplementedLookup = async (
  _ruc: string,
): Promise<PeMigoApiLookupResult> => ({
  status: 'api_unavailable',
  error: 'migo_live_lookup_not_wired',
});

// ── RUC resolution ─────────────────────────────────────────────────────────────

/**
 * Resolves RUC from enrichment input, checking fields in priority order:
 *   1. input.ruc
 *   2. input.taxId  (maps to tax_id / tax_identifier column)
 *   3. input.metadata.ruc
 *   4. input.metadata.tax_id
 *   5. input.metadata.tax_identifier
 *
 * Never guesses or infers RUC from legal name. Returns null if no RUC found.
 */
export function resolveRucFromMigoInput(
  input: PeMigoApiEnrichmentInput,
): string | null {
  if (typeof input.ruc === 'string' && input.ruc.trim()) {
    return input.ruc.trim();
  }
  if (typeof input.taxId === 'string' && input.taxId.trim()) {
    return input.taxId.trim();
  }
  const meta = input.metadata;
  if (meta) {
    if (typeof meta.ruc === 'string' && (meta.ruc as string).trim()) {
      return (meta.ruc as string).trim();
    }
    if (typeof meta.tax_id === 'string' && (meta.tax_id as string).trim()) {
      return (meta.tax_id as string).trim();
    }
    if (
      typeof meta.tax_identifier === 'string' &&
      (meta.tax_identifier as string).trim()
    ) {
      return (meta.tax_identifier as string).trim();
    }
  }
  return null;
}

// ── Block builders ─────────────────────────────────────────────────────────────

function buildMissingRucBlock(enrichedAt: string): PeMigoApiEnrichmentBlock {
  return {
    ruc: null,
    legal_name: null,
    taxpayer_status: null,
    domicile_condition: null,
    ubigeo: null,
    address: null,
    updated_at_source: null,
    source_key: 'pe_migo_api',
    enriched_at: enrichedAt,
    legal_validation_status: 'pending_validation',
    legal_validation_reason: 'missing_ruc',
    ...PE_MIGO_CIIU_INVARIANTS,
  };
}

function buildInvalidRucFormatBlock(
  ruc: string,
  enrichedAt: string,
): PeMigoApiEnrichmentBlock {
  return {
    ruc,
    legal_name: null,
    taxpayer_status: null,
    domicile_condition: null,
    ubigeo: null,
    address: null,
    updated_at_source: null,
    source_key: 'pe_migo_api',
    enriched_at: enrichedAt,
    legal_validation_status: 'invalid_ruc_format',
    legal_validation_reason: 'invalid_ruc_format',
    ...PE_MIGO_CIIU_INVARIANTS,
  };
}

function buildApiUnavailableBlock(
  ruc: string,
  enrichedAt: string,
): PeMigoApiEnrichmentBlock {
  return {
    ruc,
    legal_name: null,
    taxpayer_status: null,
    domicile_condition: null,
    ubigeo: null,
    address: null,
    updated_at_source: null,
    source_key: 'pe_migo_api',
    enriched_at: enrichedAt,
    legal_validation_status: 'api_unavailable',
    legal_validation_reason: 'migo_api_unavailable',
    ...PE_MIGO_CIIU_INVARIANTS,
  };
}

function buildNotFoundBlock(
  ruc: string,
  enrichedAt: string,
): PeMigoApiEnrichmentBlock {
  return {
    ruc,
    legal_name: null,
    taxpayer_status: null,
    domicile_condition: null,
    ubigeo: null,
    address: null,
    updated_at_source: null,
    source_key: 'pe_migo_api',
    enriched_at: enrichedAt,
    legal_validation_status: 'not_found',
    legal_validation_reason: 'migo_ruc_not_found',
    ...PE_MIGO_CIIU_INVARIANTS,
  };
}

function buildFromFoundPayload(
  payload: PeMigoApiLookupPayload,
  enrichedAt: string,
): PeMigoApiEnrichmentBlock {
  const isActive = payload.taxpayer_status?.toUpperCase() === 'ACTIVO';
  const isHabido = payload.domicile_condition?.toUpperCase() === 'HABIDO';

  const base = {
    ruc: payload.ruc,
    legal_name: payload.legal_name,
    taxpayer_status: payload.taxpayer_status,
    domicile_condition: payload.domicile_condition,
    ubigeo: payload.ubigeo,
    address: payload.address,
    updated_at_source: payload.updated_at_source,
    source_key: 'pe_migo_api' as const,
    enriched_at: enrichedAt,
    ...PE_MIGO_CIIU_INVARIANTS,
  };

  if (!isActive) {
    return {
      ...base,
      legal_validation_status: 'flagged',
      legal_validation_reason: 'migo_taxpayer_inactive',
    };
  }

  if (!isHabido) {
    return {
      ...base,
      legal_validation_status: 'flagged',
      legal_validation_reason: 'migo_domicile_not_habido',
    };
  }

  return {
    ...base,
    legal_validation_status: 'verified',
    legal_validation_reason: 'migo_ruc_found_active',
  };
}

// ── Main enrichment function ───────────────────────────────────────────────────

/**
 * Enriches a Peru candidate using Migo API as a legal point-query source.
 *
 * Behavior by case:
 * - countryCode !== 'PE' → enriched=false, reason='not_pe_country', pe_migo_api=null
 * - countryCode === 'PE', no RUC → pending_validation + missing_ruc
 * - countryCode === 'PE', invalid RUC format → invalid_ruc_format block
 * - countryCode === 'PE', valid RUC → calls lookupFn, maps result to enrichment block
 *
 * The returned pe_migo_api block is meant to be stored at:
 *   metadata.source_enrichment.pe_migo_api
 *
 * It does NOT overwrite metadata.source_enrichment.pe_sunat_bulk.
 *
 * @param lookupFn - Injected for testing or future real implementation.
 *                   Defaults to a safe no-op that returns api_unavailable.
 */
export async function enrichPeruCandidateWithMigoLegalLookup(
  input: PeMigoApiEnrichmentInput,
  lookupFn: (ruc: string) => Promise<PeMigoApiLookupResult> = _notYetImplementedLookup,
): Promise<PeMigoApiEnrichmentResult> {
  const enrichedAt = new Date().toISOString();
  const countryCode = (input.countryCode ?? '').toUpperCase();

  // Guard: no-op for non-Peru countries — Migo is PE-only
  if (countryCode !== 'PE') {
    return {
      enriched: false,
      countryCode: input.countryCode,
      ruc: null,
      pe_migo_api: null,
      reason: 'not_pe_country',
    };
  }

  const rawRuc = resolveRucFromMigoInput(input);

  if (!rawRuc) {
    return {
      enriched: true,
      countryCode,
      ruc: null,
      pe_migo_api: buildMissingRucBlock(enrichedAt),
      reason: 'no_ruc',
    };
  }

  const normalizedRuc = normalizeRuc(rawRuc);

  if (!isValidRuc(normalizedRuc)) {
    return {
      enriched: true,
      countryCode,
      ruc: rawRuc,
      pe_migo_api: buildInvalidRucFormatBlock(rawRuc, enrichedAt),
      reason: 'invalid_ruc_format',
    };
  }

  const lookupResult = await lookupFn(normalizedRuc);

  if (lookupResult.status === 'api_unavailable') {
    return {
      enriched: true,
      countryCode,
      ruc: normalizedRuc,
      pe_migo_api: buildApiUnavailableBlock(normalizedRuc, enrichedAt),
      reason: 'migo_lookup_completed',
    };
  }

  if (lookupResult.status === 'not_found') {
    return {
      enriched: true,
      countryCode,
      ruc: normalizedRuc,
      pe_migo_api: buildNotFoundBlock(normalizedRuc, enrichedAt),
      reason: 'migo_lookup_completed',
    };
  }

  // status === 'found'
  const block =
    lookupResult.payload
      ? buildFromFoundPayload(lookupResult.payload, enrichedAt)
      : buildApiUnavailableBlock(normalizedRuc, enrichedAt);

  return {
    enriched: true,
    countryCode,
    ruc: normalizedRuc,
    pe_migo_api: block,
    reason: 'migo_lookup_completed',
  };
}
