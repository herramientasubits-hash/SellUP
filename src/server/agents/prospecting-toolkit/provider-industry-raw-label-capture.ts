// Prospecting Toolkit — Provider Industry Raw Label Observation Capture
// (Q3F-5AU.5)
//
// Server-side adapter around the capture_provider_industry_raw_label_observations
// RPC (migration 090). All writes into
// public.provider_industry_raw_label_observations pass exclusively through
// this RPC — there is no direct table INSERT/UPDATE anywhere in this file.
//
// This adapter captures OBSERVATIONS, not mappings: a captured observation
// creates no concept entry, has no snapshot lifecycle effect, and has zero
// effect on any candidate, candidate status, scoring, or ranking.
//
// This file MUST NOT call Apollo, MUST NOT call Lusha, MUST NOT call Tavily,
// MUST NOT call any AI provider, MUST NOT perform an HTTP fetch, and MUST
// NOT import any mapping draft/snapshot/association/publication lifecycle
// module or the candidate writer. It accepts pre-normalized labels only —
// it does not itself normalize raw provider text (see
// ingestApolloOrganizationIndustryRawLabels for that boundary, which is not
// modified or wired by this hito).
//
// callRpc is injectable (default-parameter DI, mirrors
// createContactEnrichmentAttempt's AttemptCreatorDeps pattern) so this
// adapter's control flow is unit-testable without a database.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Public input contract ────────────────────────────────────────────────

export interface ProviderIndustryRawLabelForCapture {
  readonly rawLabel: string;
  readonly normalizedLookupKey: string;
}

export interface CaptureProviderIndustryRawLabelObservationsInput {
  readonly sourceVocabularyKey: string;
  readonly providerKey: string;
  readonly operationKey: string;
  readonly labels: readonly ProviderIndustryRawLabelForCapture[];
  readonly countryCode?: string | null;
  readonly requestedIndustry?: string | null;
  readonly agentRunId?: string | null;
  readonly sourceContext?: Record<string, unknown>;
}

// ── Public result contract ───────────────────────────────────────────────

export type CaptureProviderIndustryRawLabelObservationsResult =
  | {
      status: 'captured';
      capturedCount: number;
      insertedCount: number;
      updatedCount: number;
      skippedCount: number;
    }
  | {
      status: 'skipped';
      reason: 'no_labels' | 'client_unavailable' | 'feature_disabled';
    }
  | {
      status: 'failed';
      errorCode: string;
    };

// ── Source context minimization ──────────────────────────────────────────
// source_context is a small triage payload (see 089's table comment): it
// must never carry PII or a full raw provider response. Only an explicit
// allowlist of scalar keys survives; every other key — including a full
// Apollo/Lusha object accidentally passed in — is dropped. Scalar string
// values that look like an email, a LinkedIn URL, or a phone number are
// dropped even when the key is allowlisted, as a second, independent layer.

const SOURCE_CONTEXT_ALLOWED_KEYS = [
  'queryShape',
  'operation',
  'resultCount',
  'requestId',
  'batchIndex',
] as const;

function isSafeScalarSourceContextValue(value: unknown): value is string | number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'string') return false;
  if (value.includes('@')) return false;
  if (/linkedin\.com/i.test(value)) return false;
  if (/\+?\d[\d\s().-]{6,}\d/.test(value)) return false;
  return true;
}

export function minimizeProviderIndustrySourceContext(
  sourceContext: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!sourceContext || typeof sourceContext !== 'object') return {};

  const minimized: Record<string, unknown> = {};
  for (const key of SOURCE_CONTEXT_ALLOWED_KEYS) {
    if (!(key in sourceContext)) continue;
    const value = sourceContext[key];
    if (isSafeScalarSourceContextValue(value)) {
      minimized[key] = value;
    }
  }
  return minimized;
}

// ── Admin client + RPC call (default implementation) ─────────────────────

function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key);
}

interface CaptureRpcRow {
  success: boolean;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  observed_count_delta: number;
  error_code: string | null;
}

interface CaptureRpcCallResult {
  data: CaptureRpcRow | null;
  error: { message: string } | null;
}

interface CaptureRpcCallParams {
  sourceVocabularyKey: string;
  providerKey: string;
  operationKey: string;
  observations: ReadonlyArray<{ raw_label: string; normalized_lookup_key: string }>;
  countryCode: string | null;
  requestedIndustry: string | null;
  agentRunId: string | null;
  sourceContext: Record<string, unknown>;
}

async function defaultCallRpc(
  params: CaptureRpcCallParams,
): Promise<CaptureRpcCallResult | 'client_unavailable'> {
  const admin = getAdminClient();
  if (!admin) return 'client_unavailable';

  const { data, error } = await admin.rpc('capture_provider_industry_raw_label_observations', {
    p_source_vocabulary_key: params.sourceVocabularyKey,
    p_provider_key: params.providerKey,
    p_operation_key: params.operationKey,
    p_observations: params.observations,
    p_country_code: params.countryCode,
    p_requested_industry: params.requestedIndustry,
    p_agent_run_id: params.agentRunId,
    p_source_context: params.sourceContext,
  });

  if (error) {
    return { data: null, error: { message: error.message } };
  }
  return { data: (data as CaptureRpcRow | null) ?? null, error: null };
}

export interface CaptureProviderIndustryRawLabelObservationsDeps {
  callRpc?: (params: CaptureRpcCallParams) => Promise<CaptureRpcCallResult | 'client_unavailable'>;
}

// ── Public entry point ───────────────────────────────────────────────────

export async function captureProviderIndustryRawLabelObservations(
  input: CaptureProviderIndustryRawLabelObservationsInput,
  deps: CaptureProviderIndustryRawLabelObservationsDeps = {},
): Promise<CaptureProviderIndustryRawLabelObservationsResult> {
  const { callRpc = defaultCallRpc } = deps;

  if (!input.labels || input.labels.length === 0) {
    return { status: 'skipped', reason: 'no_labels' };
  }

  const observations = input.labels.map((label) => ({
    raw_label: label.rawLabel,
    normalized_lookup_key: label.normalizedLookupKey,
  }));

  const sourceContext = minimizeProviderIndustrySourceContext(input.sourceContext);

  let result: CaptureRpcCallResult | 'client_unavailable';
  try {
    result = await callRpc({
      sourceVocabularyKey: input.sourceVocabularyKey,
      providerKey: input.providerKey,
      operationKey: input.operationKey,
      observations,
      countryCode: input.countryCode ?? null,
      requestedIndustry: input.requestedIndustry ?? null,
      agentRunId: input.agentRunId ?? null,
      sourceContext,
    });
  } catch {
    return { status: 'failed', errorCode: 'rpc_threw' };
  }

  if (result === 'client_unavailable') {
    return { status: 'skipped', reason: 'client_unavailable' };
  }

  if (result.error) {
    return { status: 'failed', errorCode: 'rpc_call_failed' };
  }

  if (!result.data) {
    return { status: 'failed', errorCode: 'empty_rpc_result' };
  }

  if (!result.data.success) {
    return { status: 'failed', errorCode: result.data.error_code ?? 'unknown_error' };
  }

  return {
    status: 'captured',
    capturedCount: result.data.inserted_count + result.data.updated_count,
    insertedCount: result.data.inserted_count,
    updatedCount: result.data.updated_count,
    skippedCount: result.data.skipped_count,
  };
}
