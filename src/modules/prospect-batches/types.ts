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

export type BatchSource = 'manual' | 'agent_1' | 'imported' | 'apollo' | 'socrata_colombia' | 'denue_mexico' | 'datos_gob_cl' | 'external_import' | 'other';

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
  | 'socrata_colombia'
  | 'denue_mexico'
  | 'datos_gob_cl'
  | 'external_import'
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
  | 'candidate_converted_to_account'
  | 'candidate_marked_ready_for_approval';

// ── Tipos para candidatos estructurados ───────────────────────

export type ReviewStatus =
  | 'needs_manual_review'
  | 'ready_for_approval'
  | 'approved'
  | 'rejected'
  | 'blocked_duplicate'
  | 'blocked_customer'
  | 'synced_to_hubspot';

export type ReviewFlag =
  | 'size_unknown'
  | 'size_confirmed'
  | 'size_estimated'
  | 'size_below_threshold'
  | 'missing_website'
  | 'missing_linkedin'
  | 'no_tax_id'
  | 'inactive_company'
  | 'liquidation_signal'
  | 'possible_inactive'
  | 'missing_sector'
  | 'possible_duplicate'
  | 'hubspot_existing_customer'
  | 'hubspot_existing_prospect'
  | 'sector_unknown'
  | 'natural_person_risk'
  | string;

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
  // ── Campos de candidatos estructurados (fuentes oficiales) ───
  review_status: ReviewStatus | null;
  review_flags: ReviewFlag[] | null;
  source_trace: Record<string, unknown> | null;
  commercial_trace: Record<string, unknown> | null;
  commercial_fit_status: string | null;
  legal_status: string | null;
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
  socrata_colombia: 'Socrata Colombia',
  denue_mexico: 'DENUE México',
  datos_gob_cl: 'Datos.gob.cl Chile',
  external_import: 'Importación externa',
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
  socrata_colombia: 'Socrata Colombia',
  denue_mexico: 'DENUE México',
  datos_gob_cl: 'Fuente oficial Chile',
  external_import: 'Importación externa',
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

// ── Duplicate check metadata ──────────────────────────────────

export interface DuplicateMatch {
  source: string;
  status: string;
  confidence: number | null;
  matched_name: string | null;
  matched_domain: string | null;
  matched_website: string | null;
  matched_id: string | null;
  reason: string | null;
}

export interface DuplicateCheckMetadata {
  summary?: string;
  sources_checked?: string[];
  matches?: DuplicateMatch[];
}

export function parseDuplicateCheck(
  metadata: Record<string, unknown>,
): DuplicateCheckMetadata | null {
  const dc = metadata?.duplicate_check;
  if (!dc || typeof dc !== 'object' || Array.isArray(dc)) return null;
  const raw = dc as Record<string, unknown>;

  // summary may be stored as a plain string or as { status: string } (legacy writer format)
  let summary: string | undefined;
  if (typeof raw.summary === 'string') {
    summary = raw.summary;
  } else if (raw.summary !== null && typeof raw.summary === 'object') {
    const s = (raw.summary as Record<string, unknown>).status;
    if (typeof s === 'string') summary = s;
  }

  const sources_checked = Array.isArray(raw.sources_checked)
    ? (raw.sources_checked as unknown[]).filter((s): s is string => typeof s === 'string')
    : undefined;

  const matches = Array.isArray(raw.matches)
    ? (raw.matches as unknown[]).filter((m): m is DuplicateMatch => typeof m === 'object' && m !== null)
    : undefined;

  return { summary, sources_checked, matches };
}

export const APPROVE_BLOCK_MESSAGES: Partial<Record<DuplicateStatus, string>> = {
  exact_duplicate: 'No se puede aprobar porque existe un duplicado exacto.',
  unchecked: 'No se puede aprobar porque la duplicidad no fue verificada.',
  insufficient_data: 'No hay datos suficientes para validar duplicidad.',
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

// ── Motivos de descarte estructurados ─────────────────────────

export type DiscardReasonKey =
  | 'out_of_segment'
  | 'too_small'
  | 'too_large'
  | 'wrong_country'
  | 'wrong_industry'
  | 'already_customer'
  | 'not_priority_now'
  | 'bad_data'
  | 'duplicate_confirmed'
  | 'inactive_or_dissolved'
  | 'not_for_profit'
  | 'other';

export const DISCARD_REASONS: { value: DiscardReasonKey; label: string }[] = [
  { value: 'out_of_segment', label: 'Fuera del segmento objetivo' },
  { value: 'too_small', label: 'Empresa muy pequeña' },
  { value: 'too_large', label: 'Empresa demasiado grande' },
  { value: 'wrong_country', label: 'País incorrecto' },
  { value: 'wrong_industry', label: 'Industria incorrecta' },
  { value: 'already_customer', label: 'Ya es cliente de Ubits' },
  { value: 'not_priority_now', label: 'No es prioridad ahora' },
  { value: 'bad_data', label: 'Datos incorrectos o incompletos' },
  { value: 'duplicate_confirmed', label: 'Duplicado confirmado manualmente' },
  { value: 'inactive_or_dissolved', label: 'Empresa inactiva o disuelta' },
  { value: 'not_for_profit', label: 'Entidad sin ánimo de lucro' },
  { value: 'other', label: 'Otro motivo' },
];

/**
 * Días de cooldown por razón de descarte.
 * 0 = la empresa nunca debe reaparecer en nuevos lotes.
 * Aplicado en application logic del candidate-writer al generar candidatos.
 */
export const COOLDOWN_DAYS: Record<DiscardReasonKey | 'default', number> = {
  default: 30,
  out_of_segment: 180,
  wrong_country: 180,
  wrong_industry: 180,
  not_priority_now: 90,
  too_small: 90,
  too_large: 90,
  bad_data: 30,
  other: 30,
  already_customer: 0,
  duplicate_confirmed: 0,
  inactive_or_dissolved: 0,
  not_for_profit: 180,
};

// ── Labels y helpers para candidatos estructurados ────────────

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  needs_manual_review: 'Requiere revisión humana',
  ready_for_approval: 'Listo para aprobación',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  blocked_duplicate: 'Bloqueado: duplicado',
  blocked_customer: 'Bloqueado: cliente',
  synced_to_hubspot: 'Sincronizado',
};

export const REVIEW_STATUS_STYLES: Record<ReviewStatus, string> = {
  needs_manual_review: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ready_for_approval: 'bg-su-brand-soft text-su-brand',
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  rejected: 'bg-muted/60 text-muted-foreground/60',
  blocked_duplicate: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  blocked_customer: 'bg-destructive/10 text-destructive',
  synced_to_hubspot: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

export const CRITICAL_REVIEW_FLAG_LABELS: Partial<Record<string, string>> = {
  inactive_company: 'Posible inactiva',
  liquidation_signal: 'En liquidación',
  possible_inactive: 'Posible inactiva',
  no_tax_id: 'Sin NIT',
  size_unknown: 'Tamaño desconocido',
  sector_unknown: 'Sector desconocido',
  missing_sector: 'Sin sector',
  missing_website: 'Sin sitio web',
  natural_person_risk: 'Riesgo persona natural',
};

export const STRUCTURED_SOURCE_LABELS: Record<string, string> = {
  socrata_colombia: 'RUES Colombia',
  denue_mexico: 'DENUE México',
  datos_gob_cl: 'Datos.gob.cl',
  chilecompra_chile: 'ChileCompra',
};

// Vendor-facing source labels — hides technical provider names from sellers
export const VENDOR_CANDIDATE_SOURCE_LABELS: Record<string, string> = {
  socrata_colombia: 'Fuente oficial',
  denue_mexico: 'DENUE México',
  datos_gob_cl: 'Fuente oficial Chile',
  apollo: 'Apollo',
  web_ai: 'Web/IA',
  manual: 'Manual',
  hubspot: 'HubSpot',
  lusha: 'Lusha',
  public_source: 'Fuente pública',
  preloaded: 'Precargado',
  external_import: 'Importación externa',
  other: 'Otro',
};

// Vendor-facing badge label for structured candidates (Empresa cell)
export const VENDOR_STRUCTURED_SOURCE_LABELS: Record<string, string> = {
  socrata_colombia: 'Fuente oficial',
  denue_mexico: 'DENUE México',
  datos_gob_cl: 'Datos.gob.cl',
  chilecompra_chile: 'ChileCompra',
};

export function isStructuredCandidate(
  candidate: Pick<ProspectCandidate, 'review_status' | 'source_primary'>
): boolean {
  return candidate.review_status !== null && candidate.review_status !== undefined;
}

export function isUsefulReviewCandidate(candidate: {
  name?: string | null;
  legal_name?: string | null;
  country_code?: string | null;
  tax_identifier?: string | null;
  duplicate_status?: string | null;
  status?: string | null;
  review_flags?: string[] | null;
  legal_status?: string | null;
  industry?: string | null;
  source_primary?: string | null;
}): boolean {
  if (!candidate.name || typeof candidate.name !== 'string' || candidate.name.trim() === '') {
    return false;
  }

  const country = (candidate.country_code || '').toUpperCase();
  if (country === 'CO' && (!candidate.tax_identifier || candidate.tax_identifier.trim() === '')) {
    // external_import: missing NIT is a warning, not a blocking omission
    if (candidate.source_primary !== 'external_import') {
      return false;
    }
  }

  if (candidate.status === 'discarded') {
    return false;
  }

  if (candidate.duplicate_status === 'exact_duplicate') {
    return false;
  }

  const flags = candidate.review_flags || [];
  if (flags.includes('liquidation_signal') || flags.includes('inactive_company')) {
    return false;
  }

  if (flags.includes('possible_inactive')) {
    const legalStatus = (candidate.legal_status || '').toLowerCase();
    const inactiveKeywords = ['inactiva', 'cancelada', 'liquidada', 'disuelta', 'clausurada'];
    if (inactiveKeywords.some((kw) => legalStatus.includes(kw))) {
      return false;
    }
  }

  const upperName = (candidate.name || '').toUpperCase();
  const upperLegalName = (candidate.legal_name || '').toUpperCase();
  const upperLegalStatus = (candidate.legal_status || '').toUpperCase();
  const blacklistedKeywords = [
    'EN LIQUIDACION',
    'EN LIQUIDACIÓN',
    'EN DISOLUCION',
    'EN DISOLUCIÓN',
    'LIQUIDADA',
    'DISUELTA',
    'CANCELADA',
    'INACTIVA',
  ];

  if (
    blacklistedKeywords.some(
      (kw) => upperName.includes(kw) || upperLegalName.includes(kw) || upperLegalStatus.includes(kw)
    )
  ) {
    return false;
  }

  return true;
}

