/**
 * GT RGAE Read-Only Lookup Service — Catálogo.GT.2C
 *
 * Looks up a Guatemalan supplier in source_company_snapshots using its NIT.
 * Reads ONLY from the pre-loaded gt_rgae_proveedores snapshot (RGAE — Registro
 * General de Adquisiciones del Estado, MINFIN Guatemala). Never calls any RGAE
 * endpoint or external service.
 *
 * GUARDRAILS — this service must NEVER:
 * - Call any MINFIN Guatemala / RGAE endpoint
 * - Call Tavily, Apollo, Lusha, or any LLM
 * - Insert into prospect_candidates, prospect_batches, or accounts
 * - Touch source_coverage_summaries
 * - Be called for countries other than GT (enforced by caller guard)
 * - Validate NIT fiscal status (not a SAT source) or legal status (not a
 *   Registro Mercantil source)
 * - Enable post-approval, automatic matching, account creation, or canonical
 *   name overwrite — these remain hardcoded false/not_applicable regardless
 *   of what the persisted row claims, via guardrail verification below
 *
 * Semantic obligations (enforced here by guardrail checks on raw_data):
 *   source_type: 'government_supplier_registry'
 *   tax_identifier_type: 'NIT'
 *   supplier_type: 'Sociedades'
 *   tax_validation_status: 'not_applicable'
 *   legal_validation_status: 'not_applicable'
 *   human_review_required: true
 *   post_approval_enabled: false
 *   matching_automatic_enabled: false
 *   account_creation_enabled: false
 *   canonical_name_overwrite_enabled: false
 *
 * Contract obligation (Catálogo.GT.2C):
 *   Every `found: true` result MUST carry these guardrails EXPLICITLY as SAFE
 *   LITERALS — never echoed blindly from the DB row — and only after the row's
 *   raw_data has been verified to match every one of them. A consumer must
 *   NEVER be able to read `found === true` as legal_name_verified,
 *   fiscal_identity_confirmed, or SAT-validated. `raw_data` is NOT part of the
 *   public result — it is parsed and validated internally only.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeGuatemalaNit,
  maskGuatemalaNit,
} from '../source-catalog/connectors/gt-rgae/gt-nit-normalizer';
import {
  readLatestTaxGrainSnapshotByTaxId,
  readTaxGrainSnapshotByTaxId,
  type SnapshotIdentityRow,
  type SnapshotReadClient,
} from '../source-catalog/snapshot-read/snapshot-read-contract';

const SOURCE_KEY = 'gt_rgae_proveedores';
const COUNTRY_CODE = 'GT';

/**
 * Columns this reader projects out of source_company_snapshots. Includes
 * source_year, required by the latest-year cardinality-aware lookup.
 */
const SNAPSHOT_SELECT_COLUMNS = 'source_year, legal_name, normalized_tax_id, raw_data';

// ── Safe semantic literals ───────────────────────────────────────────────────
// These NEVER come from the DB row; they are emitted only after guardrails pass.
const SOURCE_TYPE = 'government_supplier_registry' as const;
const TAX_IDENTIFIER_TYPE = 'NIT' as const;
const SUPPLIER_TYPE = 'Sociedades' as const;
const TAX_VALIDATION_STATUS = 'not_applicable' as const;
const LEGAL_VALIDATION_STATUS = 'not_applicable' as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GtRgaeLookupInput {
  nit: string | number | null | undefined;
  sourceYear?: number;
}

export type GtRgaeEconomicCapacityOutput =
  | { kind: 'not_applicable' | 'direct_purchase' | 'unparsed'; amount: null; raw: string | null }
  | { kind: 'numeric'; amount: number; raw: string | null };

export type GtRgaeLookupReason =
  | 'invalid_nit'
  | 'environment_unavailable'
  | 'query_error'
  | 'not_found'
  | 'snapshot_guardrail_violation';

/**
 * Explicit provenance of a found snapshot. Built from validated literals only —
 * never inferred from an untrusted raw field.
 */
export interface GtRgaeLookupProvenance {
  source_key: typeof SOURCE_KEY;
  country_code: typeof COUNTRY_CODE;
  source_year: number | null;
}

/**
 * Successful lookup. Carries the source's semantic guardrails EXPLICITLY so no
 * consumer can mistake `found: true` for a verified legal/fiscal identity.
 * `raw_data` is intentionally absent — it is an internal parsing detail only.
 */
export interface GtRgaeLookupFound {
  found: true;

  sourceKey: typeof SOURCE_KEY;
  countryCode: typeof COUNTRY_CODE;
  sourceYear: number | null;

  normalizedNit: string;
  maskedNit: string;

  /** Nombre de proveedor reportado por RGAE. NO es nombre legal verificado. */
  supplierName: string | null;
  supplierType: typeof SUPPLIER_TYPE;
  sourceType: typeof SOURCE_TYPE;
  economicCapacity: GtRgaeEconomicCapacityOutput | null;

  taxValidationStatus: typeof TAX_VALIDATION_STATUS;
  legalValidationStatus: typeof LEGAL_VALIDATION_STATUS;
  humanReviewRequired: true;
  postApprovalEnabled: false;
  matchingAutomaticEnabled: false;
  accountCreationEnabled: false;
  canonicalNameOverwriteEnabled: false;

  provenance: GtRgaeLookupProvenance;

  reason: null;
}

export interface GtRgaeLookupNotFound {
  found: false;
  normalizedNit: string | null;
  maskedNit: string | null;
  reason: GtRgaeLookupReason;
  guardrailField?: string;
}

export type GtRgaeLookupResult = GtRgaeLookupFound | GtRgaeLookupNotFound;

// ── Admin client ───────────────────────────────────────────────────────────────

function getAdminSupabase(): SupabaseClient | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://lrdruowtadwbdulndlph.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key);
}

// ── Guardrail verification ─────────────────────────────────────────────────────

type GuardrailResult = { ok: true } | { ok: false; field: string };

function verifyGuardrails(rawData: Record<string, unknown>): GuardrailResult {
  if (rawData['source_type'] !== SOURCE_TYPE) {
    return { ok: false, field: 'source_type' };
  }
  if (rawData['tax_identifier_type'] !== TAX_IDENTIFIER_TYPE) {
    return { ok: false, field: 'tax_identifier_type' };
  }
  if (rawData['supplier_type'] !== SUPPLIER_TYPE) {
    return { ok: false, field: 'supplier_type' };
  }
  if (rawData['tax_validation_status'] !== TAX_VALIDATION_STATUS) {
    return { ok: false, field: 'tax_validation_status' };
  }
  if (rawData['legal_validation_status'] !== LEGAL_VALIDATION_STATUS) {
    return { ok: false, field: 'legal_validation_status' };
  }
  if (rawData['human_review_required'] !== true) {
    return { ok: false, field: 'human_review_required' };
  }
  if (rawData['post_approval_enabled'] !== false) {
    return { ok: false, field: 'post_approval_enabled' };
  }
  if (rawData['matching_automatic_enabled'] !== false) {
    return { ok: false, field: 'matching_automatic_enabled' };
  }
  if (rawData['account_creation_enabled'] !== false) {
    return { ok: false, field: 'account_creation_enabled' };
  }
  if (rawData['canonical_name_overwrite_enabled'] !== false) {
    return { ok: false, field: 'canonical_name_overwrite_enabled' };
  }
  return { ok: true };
}

// ── Economic capacity extraction (safe) ─────────────────────────────────────────

function extractEconomicCapacity(rawData: Record<string, unknown>): GtRgaeEconomicCapacityOutput | null {
  const ec = rawData['economic_capacity'];
  if (typeof ec !== 'object' || ec === null || Array.isArray(ec)) return null;

  const capacity = ec as Record<string, unknown>;
  const kind = capacity['kind'];
  const raw = typeof capacity['raw'] === 'string' ? capacity['raw'] : null;

  if (kind === 'numeric') {
    const amount = capacity['amount'];
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      return { kind: 'numeric', amount, raw };
    }
    // Declared numeric but amount is unusable — do not fabricate a value.
    return { kind: 'unparsed', amount: null, raw };
  }

  if (kind === 'not_applicable' || kind === 'direct_purchase' || kind === 'unparsed') {
    return { kind, amount: null, raw };
  }

  return null;
}

// ── Main lookup ────────────────────────────────────────────────────────────────

/**
 * Looks up a Guatemalan supplier in source_company_snapshots (gt_rgae_proveedores)
 * by normalized NIT. If sourceYear is omitted, selects the most recent available
 * year. Never calls any RGAE/MINFIN endpoint — reads local snapshot only.
 * The NIT is never logged in full; masked form used for diagnostics.
 */
export async function lookupGtRgaeByNit(
  input: GtRgaeLookupInput,
  supabaseOverride?: SupabaseClient,
): Promise<GtRgaeLookupResult> {
  const normalized = normalizeGuatemalaNit(input.nit);

  if (!normalized.isValid || !normalized.normalized) {
    return {
      found: false,
      normalizedNit: null,
      maskedNit: null,
      reason: 'invalid_nit',
    };
  }

  const normalizedNit = normalized.normalized;
  const maskedNit = maskGuatemalaNit(normalizedNit);

  const sb = supabaseOverride ?? getAdminSupabase();
  if (!sb) {
    return {
      found: false,
      normalizedNit,
      maskedNit,
      reason: 'environment_unavailable',
    };
  }

  try {
    const client = sb as unknown as SnapshotReadClient<SnapshotIdentityRow>;

    // Migrated to the cardinality-aware contract (EC4D5.APP-C4B). The prior
    // hand-rolled `.limit(2)` + same-latest-year guardrail is now delegated to
    // the shared TAX_GRAIN lookups (exact year vs desc-ordered latest year),
    // which never `.limit(1).maybeSingle()`. This wrapper stays thin: it maps
    // the contract's cardinality violation back to the existing
    // `duplicate_same_year_row` guardrail reason and still enforces GT RGAE's
    // own raw_data guardrails on the FOUND row via safe literals below.
    const result =
      input.sourceYear != null
        ? await readTaxGrainSnapshotByTaxId({
            client,
            sourceKey: SOURCE_KEY,
            countryCode: COUNTRY_CODE,
            sourceYear: input.sourceYear,
            normalizedTaxId: normalizedNit,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          })
        : await readLatestTaxGrainSnapshotByTaxId({
            client,
            sourceKey: SOURCE_KEY,
            countryCode: COUNTRY_CODE,
            normalizedTaxId: normalizedNit,
            selectColumns: SNAPSHOT_SELECT_COLUMNS,
          });

    if (
      result.status === 'RECORD_IDENTITY_NOT_FOUND' ||
      result.status === 'IDENTITY_UNAVAILABLE'
    ) {
      // IDENTITY_UNAVAILABLE is unreachable here (normalizedNit is validated),
      // but treated as a no-match rather than a silent fall-through.
      return {
        found: false,
        normalizedNit,
        maskedNit,
        reason: 'not_found',
      };
    }

    if (
      result.status === 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION' ||
      result.status === 'MULTI_RECORD_SAME_FISCAL_IDENTITY'
    ) {
      // Two+ rows for the same NIT within one source_year — the anomaly the
      // snapshot contract forbids. Preserve the pre-migration guardrail reason.
      return {
        found: false,
        normalizedNit,
        maskedNit,
        reason: 'snapshot_guardrail_violation',
        guardrailField: 'duplicate_same_year_row',
      };
    }

    const row = result.row as Record<string, unknown>;
    const rawData = (row['raw_data'] as Record<string, unknown>) ?? {};

    const guardrail = verifyGuardrails(rawData);
    if (!guardrail.ok) {
      return {
        found: false,
        normalizedNit,
        maskedNit,
        reason: 'snapshot_guardrail_violation',
        guardrailField: guardrail.field,
      };
    }

    const sourceYear = typeof row['source_year'] === 'number' ? row['source_year'] : null;
    const supplierName = typeof row['legal_name'] === 'string' ? row['legal_name'] : null;
    const economicCapacity = extractEconomicCapacity(rawData);

    // Guardrails passed. Emit semantic fields as SAFE LITERALS (not echoed from
    // the row) and build provenance only now that raw_data has been validated.
    return {
      found: true,

      sourceKey: SOURCE_KEY,
      countryCode: COUNTRY_CODE,
      sourceYear,

      normalizedNit,
      maskedNit,

      supplierName,
      supplierType: SUPPLIER_TYPE,
      sourceType: SOURCE_TYPE,
      economicCapacity,

      taxValidationStatus: TAX_VALIDATION_STATUS,
      legalValidationStatus: LEGAL_VALIDATION_STATUS,
      humanReviewRequired: true,
      postApprovalEnabled: false,
      matchingAutomaticEnabled: false,
      accountCreationEnabled: false,
      canonicalNameOverwriteEnabled: false,

      provenance: {
        source_key: SOURCE_KEY,
        country_code: COUNTRY_CODE,
        source_year: sourceYear,
      },

      reason: null,
    };
  } catch {
    // Internal error details are never propagated to the caller.
    return {
      found: false,
      normalizedNit,
      maskedNit,
      reason: 'query_error',
    };
  }
}
