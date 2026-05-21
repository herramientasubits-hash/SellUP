// ── Enums y tipos primitivos ──────────────────────────────────

export type BatchSearchDepth = 'basic' | 'standard' | 'deep';

export type BatchStatus =
  | 'draft'
  | 'generating'
  | 'ready_for_review'
  | 'in_review'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type BatchSource = 'manual' | 'agent_1' | 'imported' | 'apollo' | 'other';

export type CandidateStatus =
  | 'generated'
  | 'normalized'
  | 'needs_review'
  | 'approved'
  | 'discarded'
  | 'duplicate'
  | 'converted_to_account';

export type DuplicateStatus =
  | 'unchecked'
  | 'no_match'
  | 'possible_duplicate'
  | 'exact_duplicate'
  | 'related_company'
  | 'insufficient_data';

export type CandidateSourcePrimary =
  | 'manual'
  | 'hubspot'
  | 'apollo'
  | 'lusha'
  | 'public_source'
  | 'preloaded'
  | 'web_ai'
  | 'other';

export type CandidateAuditAction =
  | 'batch_created'
  | 'batch_updated'
  | 'batch_status_changed'
  | 'candidate_created'
  | 'candidate_updated'
  | 'candidate_approved'
  | 'candidate_discarded'
  | 'candidate_marked_duplicate'
  | 'candidate_converted_to_account';

export type TaxIdentifierType =
  | 'NIT'
  | 'RFC'
  | 'RUT'
  | 'RUC'
  | 'CUIT'
  | 'CNPJ'
  | 'RNC'
  | 'RTN'
  | 'cedula_juridica'
  | 'other';

// ── Entidades principales ─────────────────────────────────────

export interface ProspectBatch {
  id: string;
  name: string;
  description: string | null;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  target_count: number | null;
  search_depth: BatchSearchDepth;
  status: BatchStatus;
  source: BatchSource;
  agent_run_id: string | null;
  created_by: string | null;
  owner_id: string | null;
  estimated_cost_usd: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
}

export interface ProspectBatchWithMeta extends ProspectBatch {
  owner: { id: string; full_name: string | null; email: string } | null;
  created_by_user: { id: string; full_name: string | null } | null;
  total_candidates: number;
  approved_count: number;
  discarded_count: number;
  converted_count: number;
  needs_review_count: number;
  duplicate_count: number;
}

export interface ProspectCandidate {
  id: string;
  batch_id: string;
  account_id: string | null;
  name: string;
  legal_name: string | null;
  normalized_name: string | null;
  website: string | null;
  domain: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  company_size: string | null;
  tax_identifier: string | null;
  tax_identifier_type: TaxIdentifierType | null;
  source_primary: CandidateSourcePrimary | null;
  sources_checked: unknown[];
  duplicate_status: DuplicateStatus;
  matched_account_id: string | null;
  matched_hubspot_company_id: string | null;
  confidence_score: number | null;
  fit_score: number | null;
  data_completeness_score: number | null;
  estimated_cost_usd: number | null;
  status: CandidateStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  converted_account_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProspectCandidateWithReviewer extends ProspectCandidate {
  reviewer: { id: string; full_name: string | null; email: string } | null;
}

export interface ProspectCandidateAudit {
  id: string;
  batch_id: string;
  candidate_id: string | null;
  actor_user_id: string | null;
  action_type: CandidateAuditAction;
  details: Record<string, unknown>;
  created_at: string;
  actor?: { full_name: string | null; email: string } | null;
}

// ── Inputs ────────────────────────────────────────────────────

export interface CreateBatchInput {
  name: string;
  description?: string;
  country?: string;
  country_code?: string;
  industry?: string;
  target_count?: number;
  search_depth?: BatchSearchDepth;
  owner_id?: string;
}

export interface UpdateBatchInput {
  name?: string;
  description?: string;
  country?: string;
  country_code?: string;
  industry?: string;
  target_count?: number;
  search_depth?: BatchSearchDepth;
  status?: BatchStatus;
  owner_id?: string;
  estimated_cost_usd?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateCandidateInput {
  batch_id: string;
  name: string;
  legal_name?: string;
  website?: string;
  domain?: string;
  country?: string;
  country_code?: string;
  city?: string;
  region?: string;
  industry?: string;
  company_size?: string;
  tax_identifier?: string;
  tax_identifier_type?: TaxIdentifierType;
  source_primary?: CandidateSourcePrimary;
  review_notes?: string;
}

export interface UpdateCandidateInput {
  name?: string;
  legal_name?: string;
  website?: string;
  domain?: string;
  country?: string;
  country_code?: string;
  city?: string;
  region?: string;
  industry?: string;
  company_size?: string;
  tax_identifier?: string;
  tax_identifier_type?: TaxIdentifierType;
  source_primary?: CandidateSourcePrimary;
  review_notes?: string;
  confidence_score?: number;
  fit_score?: number;
  metadata?: Record<string, unknown>;
}

export interface MarkDuplicateInput {
  duplicate_status: DuplicateStatus;
  matched_account_id?: string;
  matched_hubspot_company_id?: string;
  review_notes?: string;
}

// ── Summaries ─────────────────────────────────────────────────

export interface BatchesSummary {
  total: number;
  ready_for_review: number;
  in_review: number;
  completed: number;
  total_approved_candidates: number;
}

export interface BatchDetailSummary {
  total_candidates: number;
  needs_review: number;
  approved: number;
  discarded: number;
  converted: number;
  duplicates: number;
}

// ── Opciones UI ───────────────────────────────────────────────

export interface InternalUserOption {
  id: string;
  full_name: string | null;
  email: string;
}

// ── Labels ────────────────────────────────────────────────────

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  draft: 'Borrador',
  generating: 'Generando',
  ready_for_review: 'Listo para revisión',
  in_review: 'En revisión',
  completed: 'Completado',
  cancelled: 'Cancelado',
  failed: 'Fallido',
};

export const BATCH_SOURCE_LABELS: Record<BatchSource, string> = {
  manual: 'Manual',
  agent_1: 'Agente 1',
  imported: 'Importado',
  apollo: 'Apollo',
  other: 'Otro',
};

export const BATCH_SEARCH_DEPTH_LABELS: Record<BatchSearchDepth, string> = {
  basic: 'Básica',
  standard: 'Estándar',
  deep: 'Profunda',
};

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  generated: 'Generado',
  normalized: 'Normalizado',
  needs_review: 'Necesita revisión',
  approved: 'Aprobado',
  discarded: 'Descartado',
  duplicate: 'Duplicado',
  converted_to_account: 'Convertido',
};

export const DUPLICATE_STATUS_LABELS: Record<DuplicateStatus, string> = {
  unchecked: 'Sin verificar',
  no_match: 'Sin coincidencia',
  possible_duplicate: 'Posible duplicado',
  exact_duplicate: 'Duplicado exacto',
  related_company: 'Empresa relacionada',
  insufficient_data: 'Datos insuficientes',
};

export const CANDIDATE_SOURCE_LABELS: Record<CandidateSourcePrimary, string> = {
  manual: 'Manual',
  hubspot: 'HubSpot',
  apollo: 'Apollo',
  lusha: 'Lusha',
  public_source: 'Fuente pública',
  preloaded: 'Precargado',
  web_ai: 'Web/IA',
  other: 'Otro',
};

export const TAX_IDENTIFIER_TYPE_LABELS: Record<TaxIdentifierType, string> = {
  NIT: 'NIT (Colombia)',
  RFC: 'RFC (México)',
  RUT: 'RUT (Chile/Uruguay)',
  RUC: 'RUC (Perú/Ecuador/Paraguay)',
  CUIT: 'CUIT (Argentina)',
  CNPJ: 'CNPJ (Brasil)',
  RNC: 'RNC (Rep. Dominicana)',
  RTN: 'RTN (Honduras)',
  cedula_juridica: 'Cédula Jurídica',
  other: 'Otro',
};

export const LATAM_COUNTRIES: { code: string; name: string }[] = [
  { code: 'CO', name: 'Colombia' },
  { code: 'MX', name: 'México' },
  { code: 'CL', name: 'Chile' },
  { code: 'AR', name: 'Argentina' },
  { code: 'BR', name: 'Brasil' },
  { code: 'PE', name: 'Perú' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'PA', name: 'Panamá' },
  { code: 'DO', name: 'Rep. Dominicana' },
  { code: 'US', name: 'Estados Unidos' },
  { code: 'ES', name: 'España' },
];

export const INDUSTRIES: string[] = [
  'Tecnología',
  'Servicios financieros / Fintech',
  'Retail / E-commerce',
  'Manufactura',
  'Salud / Healthcare',
  'Educación / EdTech',
  'Logística / Transporte',
  'Energía / Utilities',
  'Construcción / Real Estate',
  'Medios / Publicidad',
  'Agroindustria',
  'Minería',
  'Telecomunicaciones',
  'Consultoría / Servicios profesionales',
  'Alimentos y bebidas',
  'Automotriz',
  'Gobierno / Sector público',
  'Otro',
];

export const COMPANY_SIZES: string[] = [
  '1-10 empleados',
  '11-50 empleados',
  '51-200 empleados',
  '201-500 empleados',
  '501-1,000 empleados',
  '1,001-5,000 empleados',
  '5,001+ empleados',
];
