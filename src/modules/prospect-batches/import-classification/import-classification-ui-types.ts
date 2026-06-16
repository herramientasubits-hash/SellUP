// ── Import Classification UI Types — Hito 16AB.40 ────────────────────────────
// Client-side types for the import classification review UI.
// No Supabase, no server-side logic.

import type { ClassificationMatchStatus, ClassificationValidationStatus, ClassificationWarning } from './import-classification-types';

// ── Column mapping ────────────────────────────────────────────────────────────

export type ImportColumnTarget =
  | 'company_name'
  | 'country'
  | 'industry'
  | 'subindustry'
  | 'website'
  | 'linkedin'
  | 'city'
  | 'employee_size'
  | 'description'
  | 'primary_evidence_url'
  | 'evidence_source'
  | 'confidence'
  | 'notes'
  | 'ignore';

export type ImportColumnMapping = {
  sourceColumn: string;
  targetField: ImportColumnTarget;
  detectedAutomatically: boolean;
  sampleValues: string[];
};

// ── Classification preview row (view model for UI) ────────────────────────────

export type ImportClassificationPreviewRow = {
  rowNumber: number;

  companyName: string;
  countryCode: string | null;

  industryOriginalValue: string | null;
  industryCanonicalId: string | null;
  industryCanonicalName: string | null;
  industryMatchStatus: ClassificationMatchStatus;

  subindustryOriginalValue: string | null;
  subindustryCanonicalId: string | null;
  subindustryCanonicalName: string | null;
  subindustryMatchStatus: ClassificationMatchStatus;

  validationStatus: ClassificationValidationStatus;
  requiresHumanReview: boolean;
  warnings: ClassificationWarning[];

  correctionSource: 'automatic' | 'suggested' | 'manual' | null;
};

// ── Classification status UX mapping ──────────────────────────────────────────

export type ClassificationStatusUI = {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
  allowsConfirm: boolean;
};

export const CLASSIFICATION_STATUS_MAP: Record<ClassificationValidationStatus, ClassificationStatusUI> = {
  valid: { label: 'Válido', variant: 'success', allowsConfirm: true },
  normalized: { label: 'Normalizado', variant: 'secondary', allowsConfirm: true },
  warning: { label: 'Advertencia', variant: 'warning', allowsConfirm: true },
  requires_review: { label: 'Requiere revisión', variant: 'destructive', allowsConfirm: false },
  invalid: { label: 'Inválido', variant: 'destructive', allowsConfirm: false },
};

// ── Manual correction payload ─────────────────────────────────────────────────

export type ManualClassificationCorrection = {
  rowNumber: number;
  industryId: string;
  subindustryId: string | null;
  catalogVersion: string;
};

// ── Bulk correction group ─────────────────────────────────────────────────────

export type BulkCorrectionGroup = {
  industryOriginalValue: string | null;
  subindustryOriginalValue: string | null;
  countryCode: string | null;
  rowCount: number;
  rows: ImportClassificationPreviewRow[];
};

// ── Catalog version state ─────────────────────────────────────────────────────

export type CatalogVersionState = {
  version: string;
  isCurrent: boolean;
  lastChecked: Date;
};

// ── Filter status for preview ─────────────────────────────────────────────────

export type ClassificationFilterStatus = 'all' | 'valid' | 'normalized' | 'warning' | 'requires_review';

// ── Summary stats ─────────────────────────────────────────────────────────────

export type ClassificationSummaryStats = {
  total: number;
  valid: number;
  normalized: number;
  warning: number;
  requiresReview: number;
  invalid: number;
};

// ── API response for classification validation ────────────────────────────────

export type ClassifyImportRowsResponse = {
  success: true;
  catalogVersion: string;
  catalogVersionId: string;
  rows: ImportClassificationPreviewRow[];
  summary: ClassificationSummaryStats;
} | {
  success: false;
  code: string;
  message: string;
};

// ── API response for revalidation after correction ────────────────────────────

export type RevalidateCorrectionResponse = {
  success: true;
  row: ImportClassificationPreviewRow;
} | {
  success: false;
  code: string;
  message: string;
  warnings?: ClassificationWarning[];
};

// ── Header alias detection for Industry/Subindustry ───────────────────────────

export const INDUSTRY_HEADER_ALIASES = [
  'industria',
  'industry',
  'sector',
  'sector económico',
  'sector economico',
  'categoría',
  'categoria',
  'vertical',
  'giro',
  'ramo',
  'actividad económica',
];

export const SUBINDUSTRY_HEADER_ALIASES = [
  'subindustria',
  'sub industria',
  'sub-industria',
  'subindustry',
  'subsector',
  'sub sector',
  'subcategoría',
  'subcategoria',
  'vertical específica',
  'vertical especifica',
  'sub ramo',
  'sub-ramo',
];
