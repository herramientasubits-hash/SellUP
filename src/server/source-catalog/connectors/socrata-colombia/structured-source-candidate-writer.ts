/**
 * Structured Source Candidate Writer — Hito 16AB.9
 *
 * Writer server-side aislado para persistir lotes y candidatos Socrata
 * en modo preview. Solo opera sobre fuentes estructuradas Socrata Colombia.
 *
 * REGLAS CRÍTICAS:
 *   No importa ni llama candidate-writer.ts.
 *   No llama runProspectingPipeline.
 *   No escribe en HubSpot.
 *   No crea empresas en HubSpot.
 *   No ejecuta IA, Tavily, Apollo, Lusha ni Google CSE.
 *   No imprime secretos ni tokens.
 *   No guarda raw payloads completos.
 *   No guarda email ni phone.
 *   dryRun=false NO ejecutar sin autorización explícita.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CommercialFitStatus,
  CommercialTrace,
  HubspotMatchStatus,
  HubspotTrace,
  RecyclableStatus,
  ReviewFlag,
  ReviewStatus,
  StructuredSourceCandidateDraft,
} from '../../../agents/prospecting-toolkit/structured-candidate-types';
import {
  buildTaxIdNoveltyIndex,
  evaluateTaxIdNovelty,
} from '../../../agents/prospecting-toolkit/tax-id-novelty-checker';
import { checkHubSpotCompanyCommercialStatus } from '../../../agents/prospecting-toolkit/hubspot-commercial-checker';
import { normalizeCompanyName } from '../../../agents/prospecting-toolkit/normalization';
import type { ColombiaCompanySource } from './types';

// ── Constantes ────────────────────────────────────────────────

const WRITER_VERSION = '0.1.0';
const WRITER_HARD_MAX = 20;

// ── Tipos públicos ────────────────────────────────────────────

export type StructuredSourceCandidateWriterInput = {
  dryRun: boolean;
  requestedByUserId: string;
  ownerId?: string | null;
  country: 'Colombia';
  countryCode: 'CO';
  dataset: ColombiaCompanySource;
  candidates: StructuredSourceCandidateDraft[];
  runHubSpotCheck?: boolean;
  limit?: number;
  uiSmokeTest?: boolean;
};

export type StructuredSourceCandidateWriterReport = {
  executedAt: string;
  dryRun: boolean;
  batch: {
    wouldCreate: boolean;
    created: boolean;
    id: string | null;
    source: 'socrata_colombia';
    status: string;
    totalCandidatesInput: number;
    totalCandidatesPrepared: number;
    totalCandidatesWritten: number;
    totalCandidatesSkipped: number;
  };
  summary: {
    written: number;
    skipped: number;
    blockedCustomer: number;
    blockedDuplicate: number;
    existingAccount: number;
    pendingRecentSuggestion: number;
    rejectedRecently: number;
    sizeUnknown: number;
    hubspotLookupFailed: number;
    hubspotRecyclable: number;
  };
  items: Array<{
    name: string | null;
    taxId: string | null;
    noveltyStatus: string;
    shouldWrite: boolean;
    skippedReason: string | null;
    reviewStatus: string;
    commercialFitStatus: string;
    hubspotMatchStatus: string;
    reviewFlags: string[];
  }>;
  errors: Array<{
    name: string | null;
    taxId: string | null;
    message: string;
  }>;
};

// ── Tipo interno de candidato procesado ───────────────────────

type PreparedCandidate = {
  draft: StructuredSourceCandidateDraft;
  noveltyStatus: string;
  shouldWrite: boolean;
  skippedReason: string | null;
  reviewStatus: ReviewStatus;
  commercialFitStatus: CommercialFitStatus;
  hubspotMatchStatus: HubspotMatchStatus;
  hubspotLifecycleStatus: string | null;
  hubspotOwnerId: string | null;
  recyclableStatus: RecyclableStatus | null;
  reviewFlags: ReviewFlag[];
  hubspotTrace: HubspotTrace;
  commercialTrace: CommercialTrace;
  candidateStatus: string;
  duplicateStatus: string;
};

// ── Helpers puros ─────────────────────────────────────────────

function extractDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const { hostname } = new URL(url);
    const clean = hostname.replace(/^www\./, '').toLowerCase();
    return clean.length > 3 ? clean : null;
  } catch {
    return null;
  }
}

function buildBatchName(dataset: ColombiaCompanySource, dateLabel: string): string {
  return `Socrata CO · ${dataset.toUpperCase()} · ${dateLabel}`;
}

function resolveReviewStatus(
  hubspotMatchStatus: HubspotMatchStatus,
  base: ReviewStatus,
): ReviewStatus {
  if (hubspotMatchStatus === 'exact_match_customer') return 'blocked_customer';
  return base;
}

function resolveCommercialFit(
  hubspotMatchStatus: HubspotMatchStatus,
  base: CommercialFitStatus,
): CommercialFitStatus {
  if (hubspotMatchStatus === 'exact_match_customer') return 'customer_blocked';
  if (hubspotMatchStatus === 'exact_match_prospect_recyclable') return 'recyclable_prospect';
  return base;
}

function resolveCandidateStatus(hubspotMatchStatus: HubspotMatchStatus): string {
  if (hubspotMatchStatus === 'exact_match_customer') return 'duplicate';
  return 'needs_review';
}

function resolveDuplicateStatus(hubspotMatchStatus: HubspotMatchStatus): string {
  if (hubspotMatchStatus === 'exact_match_customer') return 'possible_duplicate';
  return 'unchecked';
}

function buildEmptyReport(executedAt: string, dryRun: boolean): StructuredSourceCandidateWriterReport {
  return {
    executedAt,
    dryRun,
    batch: {
      wouldCreate: false,
      created: false,
      id: null,
      source: 'socrata_colombia',
      status: 'empty',
      totalCandidatesInput: 0,
      totalCandidatesPrepared: 0,
      totalCandidatesWritten: 0,
      totalCandidatesSkipped: 0,
    },
    summary: {
      written: 0,
      skipped: 0,
      blockedCustomer: 0,
      blockedDuplicate: 0,
      existingAccount: 0,
      pendingRecentSuggestion: 0,
      rejectedRecently: 0,
      sizeUnknown: 0,
      hubspotLookupFailed: 0,
      hubspotRecyclable: 0,
    },
    items: [],
    errors: [],
  };
}

// ── Writer principal ──────────────────────────────────────────

/**
 * Persiste un lote de candidatos Socrata en modo preview.
 *
 * Flujo:
 *   1. Validación de input (vacío, límite)
 *   2. buildTaxIdNoveltyIndex → evaluar novedad por tax_id
 *   3. Por candidato: novelty → HubSpot check opcional → estados finales
 *   4. Si dryRun=false: crear lote → insertar candidatos
 *   5. Retornar reporte completo
 *
 * Garantías:
 *   - dryRun=true: cero writes a Supabase.
 *   - HubSpot: solo lectura, errores no rompen el lote.
 *   - Sin raw Socrata, sin email/phone, sin IA.
 *   - No toca candidate-writer.ts ni runProspectingPipeline.
 */
export async function writeStructuredSourceCandidatesPreview(
  supabase: SupabaseClient,
  input: StructuredSourceCandidateWriterInput,
): Promise<StructuredSourceCandidateWriterReport> {
  const executedAt = new Date().toISOString();
  const dateLabel = executedAt.slice(0, 10);
  const { dryRun } = input;
  const runHubSpotCheck = input.runHubSpotCheck ?? false;

  const errors: StructuredSourceCandidateWriterReport['errors'] = [];

  if (input.candidates.length === 0) {
    return buildEmptyReport(executedAt, dryRun);
  }

  // Aplicar límite (hard max: 20)
  const effectiveLimit = Math.min(input.limit ?? WRITER_HARD_MAX, WRITER_HARD_MAX);
  const totalCandidatesInput = input.candidates.length;
  const candidates = input.candidates.slice(0, effectiveLimit);
  const totalCandidatesPrepared = candidates.length;

  // Contadores por tipo de skip
  let blockedCustomer = 0;
  let blockedDuplicate = 0;
  let existingAccount = 0;
  let pendingRecentSuggestion = 0;
  let rejectedRecently = 0;
  let sizeUnknown = 0;
  let hubspotLookupFailed = 0;
  let hubspotRecyclable = 0;

  // ── Paso 1: Índice de novedad por tax_id ──────────────────
  const taxIds = candidates.map((c) => c.taxId);
  const noveltyIndex = await buildTaxIdNoveltyIndex({
    supabase,
    taxIds,
    countryCode: 'CO',
  });

  // ── Paso 2: Evaluar cada candidato ────────────────────────
  const prepared: PreparedCandidate[] = [];
  const items: StructuredSourceCandidateWriterReport['items'] = [];

  for (const draft of candidates) {
    try {
      const noveltyDecision = evaluateTaxIdNovelty({
        name: draft.name,
        taxId: draft.taxId,
        countryCode: 'CO',
        index: noveltyIndex,
      });

      // Candidato descartado por novedad
      if (noveltyDecision.shouldSkip) {
        switch (noveltyDecision.status) {
          case 'blocked_customer':      blockedCustomer++;       break;
          case 'blocked_duplicate':     blockedDuplicate++;      break;
          case 'existing_account':      existingAccount++;       break;
          case 'pending_recent_suggestion': pendingRecentSuggestion++; break;
          case 'rejected_recently':     rejectedRecently++;      break;
        }

        items.push({
          name: draft.name,
          taxId: draft.taxId,
          noveltyStatus: noveltyDecision.status,
          shouldWrite: false,
          skippedReason: noveltyDecision.reason,
          reviewStatus: draft.reviewStatus,
          commercialFitStatus: draft.commercialFitStatus,
          hubspotMatchStatus: draft.hubspotMatchStatus,
          reviewFlags: draft.reviewFlags,
        });

        prepared.push({
          draft,
          noveltyStatus: noveltyDecision.status,
          shouldWrite: false,
          skippedReason: noveltyDecision.reason,
          reviewStatus: draft.reviewStatus,
          commercialFitStatus: draft.commercialFitStatus,
          hubspotMatchStatus: draft.hubspotMatchStatus,
          hubspotLifecycleStatus: null,
          hubspotOwnerId: null,
          recyclableStatus: null,
          reviewFlags: draft.reviewFlags,
          hubspotTrace: draft.hubspotTrace,
          commercialTrace: draft.commercialTrace,
          candidateStatus: 'needs_review',
          duplicateStatus: 'unchecked',
        });
        continue;
      }

      // Candidato pasa novedad — construir estados mutables
      let reviewStatus: ReviewStatus = draft.reviewStatus;
      let commercialFitStatus: CommercialFitStatus = draft.commercialFitStatus;
      let hubspotMatchStatus: HubspotMatchStatus = draft.hubspotMatchStatus;
      let hubspotLifecycleStatus: string | null = null;
      let hubspotOwnerId: string | null = null;
      let recyclableStatus: RecyclableStatus | null = null;
      let reviewFlags: ReviewFlag[] = [...draft.reviewFlags];
      let hubspotTrace: HubspotTrace = draft.hubspotTrace;

      // Añadir flag no_tax_id si viene del checker (no duplicar si mapper ya lo puso)
      if (
        noveltyDecision.status === 'new_candidate_no_tax_id' &&
        !reviewFlags.includes('no_tax_id')
      ) {
        reviewFlags = [...reviewFlags, 'no_tax_id'];
      }

      // ── HubSpot check (read-only, opcional) ───────────────
      if (runHubSpotCheck) {
        try {
          const hsResult = await checkHubSpotCompanyCommercialStatus({
            name: draft.name,
            taxId: draft.taxId,
            domain: draft.website ?? null,
            countryCode: 'CO',
          });

          hubspotMatchStatus = hsResult.hubspotMatchStatus;
          hubspotTrace = hsResult.hubspotTrace;
          recyclableStatus = hsResult.recyclableStatus;
          hubspotOwnerId = hsResult.match?.ownerId ?? null;
          hubspotLifecycleStatus = hsResult.match?.lifecycleStage ?? null;

          // Merge flags sin duplicados
          const newFlags = hsResult.reviewFlags.filter((f) => !reviewFlags.includes(f));
          reviewFlags = [...reviewFlags, ...newFlags];

          // Resolver estados a partir de HubSpot
          reviewStatus = resolveReviewStatus(hubspotMatchStatus, reviewStatus);
          commercialFitStatus = resolveCommercialFit(hubspotMatchStatus, commercialFitStatus);

          if (hubspotMatchStatus === 'hubspot_lookup_failed') {
            hubspotLookupFailed++;
          }
          if (
            hubspotMatchStatus === 'exact_match_prospect_recyclable' ||
            hsResult.recyclableStatus === 'recyclable'
          ) {
            hubspotRecyclable++;
          }

          if (hsResult.error) {
            errors.push({
              name: draft.name,
              taxId: draft.taxId,
              message: `HubSpot lookup warning: ${hsResult.error}`,
            });
          }
        } catch (hsErr: unknown) {
          // Error de HubSpot no rompe el lote
          hubspotMatchStatus = 'hubspot_lookup_failed';
          hubspotLookupFailed++;
          const msg = hsErr instanceof Error ? hsErr.message : 'Error HubSpot desconocido';
          errors.push({
            name: draft.name,
            taxId: draft.taxId,
            message: `HubSpot lookup error: ${msg}`,
          });
        }
      }

      // Conteo de tamaño desconocido
      if (draft.employeeCountStatus === 'unknown_requires_manual_validation') {
        sizeUnknown++;
      }

      const updatedCommercialTrace: CommercialTrace = {
        ...draft.commercialTrace,
        reviewFlags,
      };

      items.push({
        name: draft.name,
        taxId: draft.taxId,
        noveltyStatus: noveltyDecision.status,
        shouldWrite: true,
        skippedReason: null,
        reviewStatus,
        commercialFitStatus,
        hubspotMatchStatus,
        reviewFlags,
      });

      prepared.push({
        draft,
        noveltyStatus: noveltyDecision.status,
        shouldWrite: true,
        skippedReason: null,
        reviewStatus,
        commercialFitStatus,
        hubspotMatchStatus,
        hubspotLifecycleStatus,
        hubspotOwnerId,
        recyclableStatus,
        reviewFlags,
        hubspotTrace,
        commercialTrace: updatedCommercialTrace,
        candidateStatus: resolveCandidateStatus(hubspotMatchStatus),
        duplicateStatus: resolveDuplicateStatus(hubspotMatchStatus),
      });

    } catch (candidateErr: unknown) {
      const msg = candidateErr instanceof Error ? candidateErr.message : 'Error procesando candidato';
      errors.push({ name: draft.name, taxId: draft.taxId, message: msg });

      items.push({
        name: draft.name,
        taxId: draft.taxId,
        noveltyStatus: 'error',
        shouldWrite: false,
        skippedReason: msg,
        reviewStatus: 'needs_manual_review',
        commercialFitStatus: 'needs_manual_review',
        hubspotMatchStatus: 'not_attempted',
        reviewFlags: [],
      });
    }
  }

  const toWrite = prepared.filter((p) => p.shouldWrite);
  const totalSkipped = totalCandidatesPrepared - toWrite.length;

  // ── Modo dryRun: retornar sin writes ──────────────────────
  if (dryRun) {
    return {
      executedAt,
      dryRun: true,
      batch: {
        wouldCreate: toWrite.length > 0,
        created: false,
        id: null,
        source: 'socrata_colombia',
        status: 'dry_run_not_created',
        totalCandidatesInput,
        totalCandidatesPrepared,
        totalCandidatesWritten: 0,
        totalCandidatesSkipped: totalSkipped,
      },
      summary: {
        written: 0,
        skipped: totalSkipped,
        blockedCustomer,
        blockedDuplicate,
        existingAccount,
        pendingRecentSuggestion,
        rejectedRecently,
        sizeUnknown,
        hubspotLookupFailed,
        hubspotRecyclable,
      },
      items,
      errors,
    };
  }

  // ── dryRun=false: persistir lote y candidatos ─────────────

  if (toWrite.length === 0) {
    return {
      executedAt,
      dryRun: false,
      batch: {
        wouldCreate: false,
        created: false,
        id: null,
        source: 'socrata_colombia',
        status: 'nothing_to_write',
        totalCandidatesInput,
        totalCandidatesPrepared,
        totalCandidatesWritten: 0,
        totalCandidatesSkipped: totalSkipped,
      },
      summary: {
        written: 0,
        skipped: totalSkipped,
        blockedCustomer,
        blockedDuplicate,
        existingAccount,
        pendingRecentSuggestion,
        rejectedRecently,
        sizeUnknown,
        hubspotLookupFailed,
        hubspotRecyclable,
      },
      items,
      errors,
    };
  }

  // ── Crear lote preview ────────────────────────────────────
  const batchRow = {
    name: buildBatchName(input.dataset, dateLabel),
    country: input.country,
    country_code: input.countryCode,
    industry: 'Structured source',
    target_count: toWrite.length,
    search_depth: 'basic',
    status: 'ready_for_review',
    source: 'socrata_colombia',
    created_by: input.requestedByUserId || null,
    owner_id: input.ownerId ?? null,
    estimated_cost_usd: 0,
    metadata: {
      preview_mode: true,
      ui_smoke_test: input.uiSmokeTest ?? false,
      generated_by: 'structured_source_candidate_writer',
      writer_version: WRITER_VERSION,
      dataset: input.dataset,
      limit: effectiveLimit,
      run_hubspot_check: runHubSpotCheck,
      total_candidates_input: totalCandidatesInput,
      total_candidates_written: toWrite.length,
      total_candidates_skipped: totalSkipped,
      warning: 'Modo preview — ningún candidato aprobado ni asignado automáticamente.',
    },
  };

  const { data: batchData, error: batchError } = await supabase
    .from('prospect_batches')
    .insert(batchRow)
    .select('id')
    .single();

  if (batchError) {
    console.error('[StructuredSourceWriter] Error al crear lote en prospect_batches:', {
      code: batchError.code,
      message: batchError.message,
      details: batchError.details,
      hint: batchError.hint,
      batchRow: { ...batchRow, created_by: batchRow.created_by ? '[set]' : null },
    });
    errors.push({
      name: null,
      taxId: null,
      message: `Error creando lote: ${batchError.message}`,
    });
    return {
      executedAt,
      dryRun: false,
      batch: {
        wouldCreate: false,
        created: false,
        id: null,
        source: 'socrata_colombia',
        status: 'batch_creation_failed',
        totalCandidatesInput,
        totalCandidatesPrepared,
        totalCandidatesWritten: 0,
        totalCandidatesSkipped: totalCandidatesPrepared,
      },
      summary: {
        written: 0,
        skipped: totalCandidatesPrepared,
        blockedCustomer,
        blockedDuplicate,
        existingAccount,
        pendingRecentSuggestion,
        rejectedRecently,
        sizeUnknown,
        hubspotLookupFailed,
        hubspotRecyclable,
      },
      items,
      errors,
    };
  }

  const batchId = batchData?.id ?? null;

  // ── Insertar candidatos ───────────────────────────────────
  let written = 0;

  for (const p of toWrite) {
    try {
      const { draft } = p;
      const domain = extractDomain(draft.website);

      const candidateRow = {
        batch_id: batchId,
        name: draft.name,
        normalized_name: normalizeCompanyName(draft.name),
        country: input.country,
        country_code: input.countryCode,
        industry: draft.sectorDescription ?? null,
        website: draft.website ?? null,
        domain,
        city: draft.city,
        region: draft.department,
        department: draft.department,
        sector_code: draft.sectorCode,
        sector_description: draft.sectorDescription,
        legal_status: draft.legalStatus,
        tax_id: draft.taxId,
        tax_identifier: draft.taxId,
        tax_identifier_type: 'NIT',
        source_primary: 'socrata_colombia',
        sources_checked: ['socrata_colombia'],
        employee_count: null,
        employee_count_status: 'unknown_requires_manual_validation',
        employee_count_source: null,
        employee_count_confidence: null,
        commercial_fit_status: p.commercialFitStatus,
        hubspot_match_status: p.hubspotMatchStatus,
        hubspot_lifecycle_status: p.hubspotLifecycleStatus,
        hubspot_owner_id: p.hubspotOwnerId,
        recyclable_status: p.recyclableStatus ?? null,
        review_status: p.reviewStatus,
        review_flags: p.reviewFlags,
        source_trace: draft.sourceTrace,
        hubspot_trace: p.hubspotTrace,
        commercial_trace: p.commercialTrace,
        status: p.candidateStatus,
        duplicate_status: p.duplicateStatus,
        confidence_score: null,
        fit_score: null,
        data_completeness_score: null,
        estimated_cost_usd: 0,
        metadata: {
          writer_version: WRITER_VERSION,
          dataset: input.dataset,
          preview_mode: true,
          notes: 'Tamaño no confirmado — validar manualmente',
        },
      };

      const { error: insertError } = await supabase
        .from('prospect_candidates')
        .insert(candidateRow);

      if (insertError) {
        errors.push({
          name: draft.name,
          taxId: draft.taxId,
          message: `Error insertando candidato: ${insertError.message}`,
        });
      } else {
        written++;
      }
    } catch (insertErr: unknown) {
      const msg = insertErr instanceof Error ? insertErr.message : 'Error insertando candidato';
      errors.push({
        name: p.draft.name,
        taxId: p.draft.taxId,
        message: msg,
      });
    }
  }

  return {
    executedAt,
    dryRun: false,
    batch: {
      wouldCreate: false,
      created: batchId !== null,
      id: batchId,
      source: 'socrata_colombia',
      status: 'ready_for_review',
      totalCandidatesInput,
      totalCandidatesPrepared,
      totalCandidatesWritten: written,
      totalCandidatesSkipped: totalCandidatesPrepared - written,
    },
    summary: {
      written,
      skipped: totalCandidatesPrepared - written,
      blockedCustomer,
      blockedDuplicate,
      existingAccount,
      pendingRecentSuggestion,
      rejectedRecently,
      sizeUnknown,
      hubspotLookupFailed,
      hubspotRecyclable,
    },
    items,
    errors,
  };
}
