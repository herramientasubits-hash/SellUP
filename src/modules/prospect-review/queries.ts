// Q3F-5AZ.2A — Pending Review Queue read-only query layer.
//
// Server-only reads. The queue is `prospect_candidates` with record_origin =
// 'production' AND status = 'needs_review' (Q3F-5AZ.1: 55 clean pending). We
// scope batches to the referenced batch ids (conceptual join by batch_id).
// Mirrors the fail-closed admin-client read pattern used by the sibling read
// models (agent1-effectiveness, provider-effectiveness): NO hardcoded project
// fallback, NO writes, NO upsert/insert/update/delete, NO rpc, NO provider
// calls. Only .from/.select/.eq/.in/.order/.limit.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type {
  PendingReviewCandidate,
  PendingReviewBatch,
  PendingReviewEvidence,
} from './types';

// Query criteria — the canonical definition of the "clean pending" queue.
export const PENDING_REVIEW_RECORD_ORIGIN = 'production';
export const PENDING_REVIEW_STATUS = 'needs_review';

// Defensive upper bound; the real queue is ~55 rows today.
const MAX_ROWS = 5000;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

function toNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNullableInteger(v: unknown): number | null {
  const n = toNullableNumber(v);
  return n == null ? null : Math.trunc(n);
}

function toNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

interface RawCandidateRow {
  id: string;
  batch_id: string | null;
  name: string | null;
  normalized_name: string | null;
  domain: string | null;
  website: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  subindustry: string | null;
  company_size: string | null;
  employee_count: number | null;
  fit_score: number | string | null;
  confidence_score: number | string | null;
  data_completeness_score: number | string | null;
  duplicate_status: string | null;
  matched_hubspot_company_id: string | null;
  hubspot_match_status: string | null;
  status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  source_primary: string | null;
  record_origin: string | null;
  classification_source: string | null;
}

interface RawBatchRow {
  id: string;
  name: string | null;
  source: string | null;
  status: string | null;
  created_at: string | null;
  owner_id: string | null;
  created_by: string | null;
}

const CANDIDATE_COLUMNS = [
  'id',
  'batch_id',
  'name',
  'normalized_name',
  'domain',
  'website',
  'country',
  'country_code',
  'city',
  'region',
  'industry',
  'subindustry',
  'company_size',
  'employee_count',
  'fit_score',
  'confidence_score',
  'data_completeness_score',
  'duplicate_status',
  'matched_hubspot_company_id',
  'hubspot_match_status',
  'status',
  'reviewed_by',
  'reviewed_at',
  'created_at',
  'source_primary',
  'record_origin',
  'classification_source',
].join(', ');

async function fetchCandidateRows(
  admin: ReturnType<typeof getAdminClient>,
): Promise<RawCandidateRow[]> {
  const { data, error } = await admin
    .from('prospect_candidates')
    .select(CANDIDATE_COLUMNS)
    .eq('record_origin', PENDING_REVIEW_RECORD_ORIGIN)
    .eq('status', PENDING_REVIEW_STATUS)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS);
  if (error) {
    throw new Error(`prospect-review: failed to load prospect_candidates: ${error.message}`);
  }
  return (data ?? []) as unknown as RawCandidateRow[];
}

async function fetchBatchRows(
  admin: ReturnType<typeof getAdminClient>,
  batchIds: string[],
): Promise<RawBatchRow[]> {
  if (batchIds.length === 0) return [];
  const { data, error } = await admin
    .from('prospect_batches')
    .select('id, name, source, status, created_at, owner_id, created_by')
    .in('id', batchIds)
    .limit(MAX_ROWS);
  if (error) {
    throw new Error(`prospect-review: failed to load prospect_batches: ${error.message}`);
  }
  return (data ?? []) as unknown as RawBatchRow[];
}

function mapCandidate(r: RawCandidateRow): PendingReviewCandidate {
  return {
    id: r.id,
    batchId: r.batch_id,
    name: r.name,
    normalizedName: r.normalized_name,
    domain: r.domain,
    website: r.website,
    country: r.country,
    countryCode: r.country_code,
    city: r.city,
    region: r.region,
    industry: r.industry,
    subindustry: r.subindustry,
    companySize: r.company_size,
    employeeCount: toNullableInteger(r.employee_count),
    fitScore: toNullableNumber(r.fit_score),
    confidenceScore: toNullableNumber(r.confidence_score),
    dataCompletenessScore: toNullableNumber(r.data_completeness_score),
    duplicateStatus: r.duplicate_status,
    matchedHubspotCompanyId: toNullableString(r.matched_hubspot_company_id),
    hubspotMatchStatus: r.hubspot_match_status,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    sourcePrimary: r.source_primary,
    recordOrigin: r.record_origin,
    classificationSource: r.classification_source,
  };
}

function mapBatch(r: RawBatchRow): PendingReviewBatch {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    status: r.status,
    createdAt: r.created_at,
    ownerId: r.owner_id,
    createdBy: r.created_by,
  };
}

/**
 * Loads the clean-pending queue evidence: all matching candidates plus the
 * batches they belong to. Read-only end to end.
 */
export async function fetchPendingReviewEvidence(): Promise<PendingReviewEvidence> {
  const admin = getAdminClient();

  const candidateRows = await fetchCandidateRows(admin);
  const batchIds = [
    ...new Set(candidateRows.map((c) => c.batch_id).filter((id): id is string => id != null)),
  ];
  const batchRows = await fetchBatchRows(admin, batchIds);

  return {
    candidates: candidateRows.map(mapCandidate),
    batches: batchRows.map(mapBatch),
  };
}
