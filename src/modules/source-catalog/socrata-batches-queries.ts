import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function requireActiveUser(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
}

// ─── ViewModels ───────────────────────────────────────────────────────────────

export type SocrataPreviewBatchListItem = {
  id: string;
  name: string;
  status: string;
  countryCode: string | null;
  targetCount: number | null;
  candidatesCount: number;
  dataset: string | null;
  previewMode: boolean;
  smokeTest: boolean;
  rollbackLogical: boolean;
  createdAt: string;
};

export type SocrataPreviewBatchListViewModel = {
  batches: SocrataPreviewBatchListItem[];
  totalCount: number;
  readyForReview: number;
  cancelled: number;
  smokeTests: number;
};

export type SocrataPreviewCandidateItem = {
  id: string;
  name: string | null;
  taxId: string | null;
  city: string | null;
  department: string | null;
  sectorCode: string | null;
  sectorDescription: string | null;
  legalStatus: string | null;
  website: string | null;
  domain: string | null;
  status: string;
  reviewStatus: string | null;
  duplicateStatus: string | null;
  employeeCount: number | null;
  employeeCountStatus: string | null;
  commercialFitStatus: string | null;
  hubspotMatchStatus: string | null;
  recyclableStatus: string | null;
  estimatedCostUsd: number | null;
  isConverted: boolean;
  reviewFlags: string[];
  datasetId: string | null;
  sourceKey: string | null;
  sourceRecordId: string | null;
  createdAt: string;
  warnings: string[];
};

export type SocrataPreviewBatchSummary = {
  total: number;
  needsReview: number;
  discarded: number;
  rejected: number;
  converted: number;
  totalCostUsd: number;
};

export type SocrataPreviewBatchDetailViewModel = {
  id: string;
  name: string;
  status: string;
  countryCode: string | null;
  targetCount: number | null;
  searchDepth: string | null;
  estimatedCostUsd: number | null;
  dataset: string | null;
  previewMode: boolean;
  smokeTest: boolean;
  rollbackLogical: boolean;
  createdAt: string;
  updatedAt: string;
  summary: SocrataPreviewBatchSummary;
  candidates: SocrataPreviewCandidateItem[];
};

// ─── Warning derivation ───────────────────────────────────────────────────────

const FLAG_WARNINGS: Record<string, string> = {
  size_unknown: 'Tamaño no confirmado — validar manualmente',
  missing_website: 'Sitio web no encontrado',
  missing_linkedin: 'LinkedIn no encontrado',
  missing_decision_maker: 'Decisor no encontrado',
  hubspot_existing_customer: 'Cliente existente en HubSpot — no crear prospecto',
  hubspot_existing_prospect: 'Prospecto existente en HubSpot',
  hubspot_recyclable_prospect: 'Prospecto reciclable — requiere confirmación',
  no_tax_id: 'Sin NIT — revisar manualmente',
  inactive_company: 'Empresa inactiva o estado legal no favorable',
  pii_email_risk: 'Dato de contacto sensible — no usar sin validación',
  pii_phone_risk: 'Dato de contacto sensible — no usar sin validación',
};

function deriveWarnings(flags: string[]): string[] {
  return flags.flatMap((f) => {
    const w = FLAG_WARNINGS[f];
    return w ? [w] : [];
  });
}

// ─── DB row types ─────────────────────────────────────────────────────────────

type BatchDbRow = {
  id: string;
  name: string;
  source: string;
  status: string;
  country: string | null;
  country_code: string | null;
  target_count: number | null;
  search_depth: string | null;
  estimated_cost_usd: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  owner_id: string | null;
};

type CandidateDbRow = {
  id: string;
  batch_id: string;
  name: string | null;
  normalized_name: string | null;
  tax_id: string | null;
  city: string | null;
  department: string | null;
  sector_code: string | null;
  sector_description: string | null;
  legal_status: string | null;
  website: string | null;
  domain: string | null;
  source_primary: string | null;
  status: string;
  review_status: string | null;
  duplicate_status: string | null;
  employee_count: number | null;
  employee_count_status: string | null;
  commercial_fit_status: string | null;
  hubspot_match_status: string | null;
  recyclable_status: string | null;
  estimated_cost_usd: number | null;
  converted_account_id: string | null;
  review_flags: string[] | null;
  source_trace: Record<string, unknown> | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDataset(meta: Record<string, unknown>, batchName: string): string | null {
  const raw =
    (meta.dataset as string | undefined) ??
    (meta.dataset_id as string | undefined) ??
    (Array.isArray(meta.datasets) ? (meta.datasets[0] as string | undefined) : undefined) ??
    null;
  if (raw) return raw;
  if (batchName.toUpperCase().includes('RUES')) return 'rues';
  return null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapBatchListItem(
  batch: BatchDbRow,
  candidatesCount: number,
): SocrataPreviewBatchListItem {
  const meta = batch.metadata ?? {};
  return {
    id: batch.id,
    name: batch.name,
    status: batch.status,
    countryCode: batch.country_code ?? null,
    targetCount: batch.target_count ?? null,
    candidatesCount,
    dataset: resolveDataset(meta, batch.name),
    previewMode: !!(meta.preview_mode ?? meta.dry_run),
    smokeTest: !!(meta.smoke_test),
    rollbackLogical: !!(meta.rollback_logical),
    createdAt: batch.created_at,
  };
}

function mapCandidate(row: CandidateDbRow): SocrataPreviewCandidateItem {
  const flags: string[] = Array.isArray(row.review_flags) ? row.review_flags : [];
  const sourceTrace = row.source_trace ?? {};
  return {
    id: row.id,
    name: row.name ?? null,
    taxId: row.tax_id ?? null,
    city: row.city ?? null,
    department: row.department ?? null,
    sectorCode: row.sector_code ?? null,
    sectorDescription: row.sector_description ?? null,
    legalStatus: row.legal_status ?? null,
    website: row.website ?? null,
    domain: row.domain ?? null,
    status: row.status,
    reviewStatus: row.review_status ?? null,
    duplicateStatus: row.duplicate_status ?? null,
    employeeCount: row.employee_count ?? null,
    employeeCountStatus: row.employee_count_status ?? null,
    commercialFitStatus: row.commercial_fit_status ?? null,
    hubspotMatchStatus: row.hubspot_match_status ?? null,
    recyclableStatus: row.recyclable_status ?? null,
    estimatedCostUsd: row.estimated_cost_usd ?? null,
    isConverted: !!row.converted_account_id,
    reviewFlags: flags,
    datasetId: (sourceTrace.datasetId as string | undefined) ?? null,
    sourceKey: (sourceTrace.sourceKey as string | undefined) ?? null,
    sourceRecordId: (sourceTrace.sourceRecordId as string | undefined) ?? null,
    createdAt: row.created_at,
    warnings: deriveWarnings(flags),
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getSocrataPreviewBatches(): Promise<SocrataPreviewBatchListViewModel> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data: batches, error } = await supabase
    .from('prospect_batches')
    .select(
      'id, name, source, status, country, country_code, target_count, metadata, created_at, created_by, owner_id',
    )
    .eq('source', 'socrata_colombia')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new Error(`Error al cargar lotes Socrata: ${error.message}`);
  const rows = (batches ?? []) as BatchDbRow[];
  if (rows.length === 0) {
    return { batches: [], totalCount: 0, readyForReview: 0, cancelled: 0, smokeTests: 0 };
  }

  const batchIds = rows.map((b) => b.id);
  const { data: candidateRows } = await supabase
    .from('prospect_candidates')
    .select('batch_id')
    .in('batch_id', batchIds);

  const countsByBatch: Record<string, number> = {};
  for (const c of candidateRows ?? []) {
    countsByBatch[c.batch_id] = (countsByBatch[c.batch_id] ?? 0) + 1;
  }

  const items = rows.map((b) => mapBatchListItem(b, countsByBatch[b.id] ?? 0));

  return {
    batches: items,
    totalCount: items.length,
    readyForReview: items.filter((b) => b.status === 'ready_for_review').length,
    cancelled: items.filter((b) => b.status === 'cancelled').length,
    smokeTests: items.filter((b) => b.smokeTest).length,
  };
}

export async function getSocrataPreviewBatchDetail(
  batchId: string,
): Promise<SocrataPreviewBatchDetailViewModel | null> {
  await requireActiveUser();
  const supabase = await createClient();

  const { data: batch, error: batchError } = await supabase
    .from('prospect_batches')
    .select(
      'id, name, source, status, country, country_code, target_count, search_depth, estimated_cost_usd, metadata, created_at, updated_at, created_by, owner_id',
    )
    .eq('id', batchId)
    .eq('source', 'socrata_colombia')
    .maybeSingle();

  if (batchError) throw new Error(`Error al cargar lote: ${batchError.message}`);
  if (!batch) return null;

  const batchRow = batch as BatchDbRow;

  const { data: candidateRows, error: candidatesError } = await supabase
    .from('prospect_candidates')
    .select(
      'id, batch_id, name, normalized_name, tax_id, city, department, sector_code, sector_description, legal_status, website, domain, source_primary, status, review_status, duplicate_status, employee_count, employee_count_status, commercial_fit_status, hubspot_match_status, recyclable_status, estimated_cost_usd, converted_account_id, review_flags, source_trace, created_at',
    )
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });

  if (candidatesError) throw new Error(`Error al cargar candidatos: ${candidatesError.message}`);

  const meta = batchRow.metadata ?? {};
  const candidates = ((candidateRows ?? []) as CandidateDbRow[]).map(mapCandidate);

  const summary: SocrataPreviewBatchSummary = {
    total: candidates.length,
    needsReview: candidates.filter((c) => c.status === 'needs_review').length,
    discarded: candidates.filter((c) => c.status === 'discarded').length,
    rejected: candidates.filter((c) => c.reviewStatus === 'rejected').length,
    converted: candidates.filter((c) => c.isConverted).length,
    totalCostUsd: candidates.reduce((acc, c) => acc + (c.estimatedCostUsd ?? 0), 0),
  };

  return {
    id: batchRow.id,
    name: batchRow.name,
    status: batchRow.status,
    countryCode: batchRow.country_code ?? null,
    targetCount: batchRow.target_count ?? null,
    searchDepth: batchRow.search_depth ?? null,
    estimatedCostUsd: batchRow.estimated_cost_usd ?? null,
    dataset: resolveDataset(meta, batchRow.name),
    previewMode: !!(meta.preview_mode ?? meta.dry_run),
    smokeTest: !!(meta.smoke_test),
    rollbackLogical: !!(meta.rollback_logical),
    createdAt: batchRow.created_at,
    updatedAt: batchRow.updated_at,
    summary,
    candidates,
  };
}
