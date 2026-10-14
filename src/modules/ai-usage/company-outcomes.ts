// ============================================================
// /ai-usage — qué pasó con cada empresa entregada (funciones puras)
//
// Decisión de la dueña (13-10): «empresa entregada» se lee en tres niveles:
//   (a) llegó a revisión — candidata escrita en un lote, de una corrida REAL
//       (record_origin = 'production', persistido o derivado igual que el panel
//       del Agente 1: QA, smoke, importaciones y limpiezas no cuentan);
//   (b) aprobada — status 'approved' o 'converted_to_account', o ya convertida;
//   (c) convertida en cuenta — converted_account_id no nulo.
//
// Herramienta que la trajo: el buscador gratis (fuentes públicas), el banco de
// empresas, la web con IA (Tavily y Claude guardan sus empresas como `web_ai`,
// así que por fila no se pueden separar), Apollo, Lusha u otra.
// ============================================================

import { resolveCandidateClassification } from '@/modules/agent1-effectiveness/aggregators';
import { deriveRecordOriginClassification } from '@/modules/agent1-effectiveness/classification';
import type { Agent1BatchRow, Agent1CandidateRow } from '@/modules/agent1-effectiveness/types';

export const COMPANY_TOOLS = ['gratis', 'banco', 'web_ai', 'claude', 'apollo', 'lusha', 'otros'] as const;
export type CompanyTool = (typeof COMPANY_TOOLS)[number];

export const COMPANY_TOOL_LABELS: Readonly<Record<CompanyTool, string>> = {
  gratis: 'Buscador gratis',
  banco: 'Banco de empresas',
  web_ai: 'Web con IA (Tavily)',
  claude: 'Claude',
  apollo: 'Apollo',
  lusha: 'Lusha',
  otros: 'Otros',
};

/** source_primary de las fuentes públicas gratuitas (catálogos por país). */
const FREE_SOURCES: ReadonlySet<string> = new Set([
  'public_source',
  'preloaded',
  'socrata_colombia',
  'denue_mexico',
  'datos_gob_cl',
]);

const APPROVED_STATUSES: ReadonlySet<string> = new Set(['approved', 'converted_to_account']);

export interface CompanyBatchRow {
  id: string;
  created_at: string;
  created_by: string | null;
  country_code: string | null;
  industry: string | null;
  source: string | null;
  name: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CompanyCandidateRow {
  id: string;
  batch_id: string;
  status: string | null;
  duplicate_status: string | null;
  converted_account_id: string | null;
  source_primary: string | null;
  tax_identifier: string | null;
  website: string | null;
  domain: string | null;
  country_code: string | null;
  record_origin: string | null;
  rejection_reason: string | null;
  classification_source: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CompanyDiscardRow {
  batch_id: string;
  country_code: string | null;
  source_primary: string | null;
}

/** Una empresa que llegó a revisión, ya con su herramienta y sus niveles. */
export interface CompanyOutcome {
  candidateId: string;
  batchId: string;
  countryCode: string | null;
  tool: CompanyTool;
  approved: boolean;
  converted: boolean;
  hasTaxId: boolean;
  hasWebsite: boolean;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function toAgent1Batch(batch: CompanyBatchRow | undefined): Agent1BatchRow | undefined {
  if (!batch) return undefined;
  return {
    id: batch.id,
    status: batch.status,
    countryCode: batch.country_code,
    industry: batch.industry,
    createdBy: batch.created_by,
    createdAt: batch.created_at,
    generatedCandidateCount: null,
    adaptiveResultStatus: null,
    source: batch.source,
    name: batch.name,
    metadata: batch.metadata,
  };
}

function toAgent1Candidate(c: CompanyCandidateRow): Agent1CandidateRow {
  return {
    batchId: c.batch_id,
    status: c.status,
    duplicateStatus: c.duplicate_status,
    convertedAccountId: c.converted_account_id,
    recordOrigin: c.record_origin,
    rejectionReason: c.rejection_reason,
    classificationSource: c.classification_source,
    sourcePrimary: c.source_primary,
    reviewNotes: c.review_notes,
    reviewedBy: c.reviewed_by,
    metadata: c.metadata,
  };
}

/** ¿Es de una corrida real? La misma regla que el panel del Agente 1. */
export function isProductionCandidate(candidate: CompanyCandidateRow, batch?: CompanyBatchRow): boolean {
  return (
    resolveCandidateClassification(toAgent1Candidate(candidate), toAgent1Batch(batch)).effectiveRecordOrigin ===
    'production'
  );
}

/**
 * ¿El descarte es de una corrida real? Lo que se pregunta es de qué CORRIDA salió
 * la fila, no por qué se descartó: se clasifica como una fila recién generada de
 * ese lote (un estado «descartada» sin motivo haría que el clasificador la diera
 * por desconocida y no contaría ningún descarte).
 */
export function isProductionDiscard(discard: CompanyDiscardRow, batch?: CompanyBatchRow): boolean {
  const agent1Batch = toAgent1Batch(batch);
  const derived = deriveRecordOriginClassification(
    {
      status: 'generated',
      duplicate_status: null,
      source_primary: discard.source_primary,
      review_notes: null,
      metadata: null,
      reviewed_by: null,
    },
    agent1Batch ? { source: agent1Batch.source ?? null, name: agent1Batch.name ?? null, metadata: agent1Batch.metadata ?? null } : undefined,
  );
  return derived.recordOrigin === 'production';
}

export function candidateTool(sourcePrimary: string | null, fromBank: boolean): CompanyTool {
  if (fromBank) return 'banco';
  const source = sourcePrimary?.trim().toLowerCase() ?? '';
  if (FREE_SOURCES.has(source)) return 'gratis';
  if (source === 'web_ai' || source === 'tavily') return 'web_ai';
  if (source === 'apollo') return 'apollo';
  if (source === 'lusha') return 'lusha';
  return 'otros';
}

/** Herramienta a la que se carga el costo de una consulta, por proveedor. */
export function providerTool(providerKey: string): CompanyTool {
  if (providerKey === 'tavily') return 'web_ai';
  if (providerKey === 'anthropic' || providerKey === 'claude') return 'claude';
  if (providerKey === 'apollo' || providerKey === 'apollo_organizations') return 'apollo';
  if (providerKey === 'lusha') return 'lusha';
  return 'otros';
}

export function isApprovedCandidate(c: Pick<CompanyCandidateRow, 'status' | 'converted_account_id'>): boolean {
  return APPROVED_STATUSES.has(c.status ?? '') || c.converted_account_id != null;
}

/** Las empresas de producción que llegaron a revisión, con su herramienta y niveles. */
export function resolveCompanyOutcomes(
  candidates: readonly CompanyCandidateRow[],
  batchesById: ReadonlyMap<string, CompanyBatchRow>,
  bankCandidateIds: ReadonlySet<string>,
): CompanyOutcome[] {
  const out: CompanyOutcome[] = [];
  for (const c of candidates) {
    const batch = batchesById.get(c.batch_id);
    if (!isProductionCandidate(c, batch)) continue;
    out.push({
      candidateId: c.id,
      batchId: c.batch_id,
      countryCode: (c.country_code ?? batch?.country_code ?? null)?.trim().toUpperCase() || null,
      tool: candidateTool(c.source_primary, bankCandidateIds.has(c.id)),
      approved: isApprovedCandidate(c),
      converted: c.converted_account_id != null,
      hasTaxId: nonEmpty(c.tax_identifier),
      hasWebsite: nonEmpty(c.website) || nonEmpty(c.domain),
    });
  }
  return out;
}
