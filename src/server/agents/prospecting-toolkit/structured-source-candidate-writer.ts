/**
 * Centralized Structured Source Candidate Writer
 *
 * Generic writer server-side to persist batches and candidates from
 * structured sources (Socrata Colombia, DENUE Mexico, cl_res Chile, etc.)
 * in preview mode.
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
  StructuredSourceTrace,
} from './structured-candidate-types';
import type { SourceDiscoveryCandidate } from '../../source-catalog/source-discovery-types';
import {
  buildTaxIdNoveltyIndex,
  evaluateTaxIdNovelty,
} from './tax-id-novelty-checker';
import { checkHubSpotCompanyCommercialStatus } from './hubspot-commercial-checker';
import { normalizeCompanyName } from './normalization';

// ── Constantes ────────────────────────────────────────────────

const WRITER_VERSION = '0.2.0';
const WRITER_HARD_MAX = 20;

// ── Tipos públicos ────────────────────────────────────────────

export type StructuredSourceCandidateWriterInput = {
  dryRun?: boolean;
  requestedByUserId?: string | null; // For legacy compatibility
  ownerId?: string | null;
  country: string;
  countryCode: string;
  sourceKey: string;
  sourceProvider: string;
  dataset: string;
  batchName?: string;
  industry?: string;
  targetCount?: number;
  searchDepth?: 'basic' | 'standard' | 'deep';
  createdBy?: string | null;
  agentRunId?: string | null;
  initiatedBy?: 'agent_1' | 'ui_source_catalog' | null;
  candidates: Array<StructuredSourceCandidateDraft | SourceDiscoveryCandidate>;
  previewMode?: boolean;
  uiSmokeTest?: boolean;
  runHubspotCheck?: boolean;
  runHubSpotCheck?: boolean;
  limit?: number;
  metadata?: Record<string, unknown>;
  batchId?: string | null;
};

export type StructuredSourceCandidateWriterReport = {
  executedAt: string;
  dryRun: boolean;
  batch: {
    wouldCreate: boolean;
    created: boolean;
    id: string | null;
    source: string;
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
  duplicateCheckMetadata: Record<string, unknown> | null;
};

// ── Helpers puros ─────────────────────────────────────────────

/**
 * Sanitiza el payload de duplicate_check para garantizar que siempre sea
 * serializable a JSONB y no contenga undefined, funciones ni ciclos.
 */
function buildSafeDuplicateCheckMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const safeMatches = Array.isArray(raw.matches)
    ? (raw.matches as unknown[]).slice(0, 5).map((m) => {
        if (typeof m !== 'object' || m === null) return null;
        const match = m as Record<string, unknown>;
        return {
          source: typeof match.source === 'string' ? match.source : null,
          status: typeof match.status === 'string' ? match.status : null,
          confidence: typeof match.confidence === 'number' ? match.confidence : null,
          matched_name: typeof match.matched_name === 'string' ? match.matched_name : null,
          matched_domain: typeof match.matched_domain === 'string' ? match.matched_domain : null,
          matched_id: typeof match.matched_id === 'string' ? match.matched_id : null,
          reason: typeof match.reason === 'string' ? match.reason : null,
        };
      }).filter(Boolean)
    : [];

  const sourcesChecked = Array.isArray(raw.sources_checked)
    ? (raw.sources_checked as unknown[]).filter((s): s is string => typeof s === 'string')
    : ['sellup'];

  const rawSummary = raw.summary;
  const summary: string =
    typeof rawSummary === 'string'
      ? rawSummary
      : typeof rawSummary === 'object' && rawSummary !== null && typeof (rawSummary as Record<string, unknown>).status === 'string'
        ? (rawSummary as Record<string, unknown>).status as string
        : 'Verificado';

  const result: Record<string, unknown> = {
    summary,
    sources_checked: sourcesChecked,
    matches: safeMatches,
  };

  if (typeof raw.warning === 'string') result.warning = raw.warning;

  return result;
}

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

function buildBatchName(sourceProvider: string, dataset: string, dateLabel: string): string {
  return `${sourceProvider} · ${dataset.toUpperCase()} · ${dateLabel}`;
}

/**
 * Calcula un score de completitud determinístico (0–100) para un candidato estructurado.
 * +20 por cada campo clave presente. Sin IA. Sin inferencia.
 */
function calculateDataCompleteness(draft: StructuredSourceCandidateDraft): {
  score: number;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  let score = 0;

  if (draft.taxId) { score += 20; } else { missingFields.push('tax_id'); }
  if (draft.website) { score += 20; } else { missingFields.push('website'); }
  if (draft.sectorCode || draft.sectorDescription) { score += 20; } else { missingFields.push('sector'); }
  if (draft.city || draft.department) { score += 20; } else { missingFields.push('city_region'); }
  if (draft.employeeCount !== null) { score += 20; } else { missingFields.push('company_size'); }

  return { score, missingFields };
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
  switch (hubspotMatchStatus) {
    case 'no_match':
      return 'no_match';
    case 'exact_match_customer':
      return 'exact_duplicate';
    case 'exact_match_prospect_active':
    case 'possible_match_requires_review':
      return 'possible_duplicate';
    case 'exact_match_prospect_recyclable':
    case 'exact_match_ex_customer':
      return 'related_company';
    case 'hubspot_lookup_failed':
    case 'not_attempted':
    default:
      return 'unchecked';
  }
}

function buildDcSummary(hubspotMatchStatus: HubspotMatchStatus, hubspotRan: boolean): string {
  if (!hubspotRan) return 'Verificado contra SellUp (NIT/tax_id). Sin coincidencia en SellUp.';
  switch (hubspotMatchStatus) {
    case 'no_match': return 'Sin coincidencia en HubSpot ni en SellUp.';
    case 'exact_match_customer': return 'Empresa encontrada en HubSpot como cliente activo.';
    case 'exact_match_prospect_active': return 'Empresa encontrada en HubSpot como prospecto activo.';
    case 'exact_match_prospect_recyclable': return 'Empresa encontrada en HubSpot como prospecto reciclable.';
    case 'exact_match_ex_customer': return 'Empresa encontrada en HubSpot como ex-cliente.';
    case 'possible_match_requires_review': return 'Posible coincidencia en HubSpot. Requiere revisión manual.';
    case 'hubspot_lookup_failed': return 'Error al consultar HubSpot. Verificación SellUp completada.';
    default: return 'Verificado contra SellUp y HubSpot.';
  }
}

function buildMatchReason(
  status: HubspotMatchStatus,
  matchMethod: string | null,
): string {
  const methodLabel =
    matchMethod === 'nit' ? 'NIT exacto'
    : matchMethod === 'domain' ? 'dominio exacto'
    : matchMethod === 'name' ? 'nombre normalizado'
    : matchMethod === 'id' ? 'ID directo'
    : 'búsqueda';
  switch (status) {
    case 'exact_match_customer': return `Cliente activo — ${methodLabel}`;
    case 'exact_match_prospect_active': return `Prospecto activo — ${methodLabel}`;
    case 'exact_match_prospect_recyclable': return `Prospecto reciclable — ${methodLabel}`;
    case 'exact_match_ex_customer': return `Ex-cliente — ${methodLabel}`;
    case 'possible_match_requires_review': return `Posible coincidencia — ${methodLabel}`;
    default: return methodLabel;
  }
}

function buildEmptyReport(executedAt: string, dryRun: boolean, sourceProvider: string): StructuredSourceCandidateWriterReport {
  return {
    executedAt,
    dryRun,
    batch: {
      wouldCreate: false,
      created: false,
      id: null,
      source: sourceProvider,
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

/**
 * Adapts a candidate (either StructuredSourceCandidateDraft or SourceDiscoveryCandidate)
 * into a canonical StructuredSourceCandidateDraft.
 */
function adaptCandidate(
  candidate: StructuredSourceCandidateDraft | SourceDiscoveryCandidate,
  sourceProvider: string,
  sourceKey: string,
  countryCode: string
): StructuredSourceCandidateDraft {
  // Check if it's already a StructuredSourceCandidateDraft (duck typing check)
  if ('hubspotTrace' in candidate && 'commercialTrace' in candidate) {
    return candidate as StructuredSourceCandidateDraft;
  }

  const disc = candidate as SourceDiscoveryCandidate;

  const emptyHubspotTrace: HubspotTrace = {
    lookupAttempted: false,
    lookupAt: null,
    matchStatus: 'not_attempted',
    matchedCompanyId: null,
    matchedBy: null,
    possibleMatches: [],
    syncAttempted: false,
    syncAt: null,
    syncStatus: null,
    syncError: null,
    syncedByUserId: null,
  };

  const emptyCommercialTrace: CommercialTrace = {
    employeeCountStatus: 'unknown_requires_manual_validation',
    employeeCountSource: null,
    employeeCountConfidence: null,
    fitReasons: [],
    reviewFlags: (disc.reviewFlags as ReviewFlag[]) ?? [],
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    approvedBy: null,
    approvedAt: null,
  };

  const defaultSourceTrace: StructuredSourceTrace = {
    sourceProvider,
    sourceKey,
    sourceType: 'structured_registry',
    sourceMode: 'discovery',
    datasetId: null,
    sourceRecordId: null,
    queryParams: {},
    fetchedAt: new Date().toISOString(),
    connectorVersion: '0.1.0',
    normalizedAt: new Date().toISOString(),
    countryCode,
  };

  let sourceTrace: StructuredSourceTrace = defaultSourceTrace;
  if (disc.sourceTrace && typeof disc.sourceTrace === 'object') {
    sourceTrace = {
      ...defaultSourceTrace,
      ...(disc.sourceTrace as Record<string, unknown>),
    };
  }

  return {
    name: disc.name,
    taxId: disc.taxId ?? null,
    taxIdentifierType: disc.taxIdentifierType ?? null,
    city: disc.city ?? null,
    department: disc.region ?? null,
    sectorCode: disc.sectorCode ?? null,
    sectorDescription: disc.sectorDescription ?? null,
    legalStatus: (disc.metadata?.legalStatus as string) ?? null,
    website: (disc.metadata?.website as string) ?? null,
    countryCode: disc.countryCode ?? countryCode,
    sourcePrimary: disc.sourcePrimary || sourceProvider,
    employeeCount: null,
    employeeCountStatus: 'unknown_requires_manual_validation',
    commercialFitStatus: 'needs_manual_review',
    hubspotMatchStatus: 'not_attempted',
    reviewStatus: 'needs_manual_review',
    reviewFlags: (disc.reviewFlags as ReviewFlag[]) ?? [],
    sourceTrace,
    hubspotTrace: emptyHubspotTrace,
    commercialTrace: emptyCommercialTrace,
  };
}

// ── Writer principal ──────────────────────────────────────────

/**
 * Persiste un lote de candidatos estructurados en modo preview.
 *
 * Flujo:
 *   1. Adaptación y validación de input (vacío, límite)
 *   2. buildTaxIdNoveltyIndex → evaluar novedad por tax_id
 *   3. Por candidato: novelty → HubSpot check opcional → estados finales
 *   4. Si dryRun=false: crear lote → insertar candidatos
 *   5. Retornar reporte completo
 *
 * Garantías:
 *   - dryRun=true: cero writes a Supabase.
 *   - HubSpot: solo lectura, errores no rompen el lote.
 *   - Sin raw payloads completos, sin email/phone, sin IA.
 *   - No toca candidate-writer.ts ni runProspectingPipeline.
 */
export async function writeStructuredSourceCandidatesPreview(
  supabase: SupabaseClient,
  input: StructuredSourceCandidateWriterInput,
): Promise<StructuredSourceCandidateWriterReport> {
  const executedAt = new Date().toISOString();
  const dateLabel = executedAt.slice(0, 10);
  const dryRun = input.dryRun ?? true; // Safe default
  // Both casing variants accepted: callers may pass runHubSpotCheck (uppercase) or runHubspotCheck (lowercase)
  const runHubSpotCheck = input.runHubSpotCheck ?? input.runHubspotCheck ?? false;

  const errors: StructuredSourceCandidateWriterReport['errors'] = [];

  if (!input.candidates || input.candidates.length === 0) {
    return buildEmptyReport(executedAt, dryRun, input.sourceProvider);
  }

  // Aplicar límite (hard max: 20)
  const effectiveLimit = Math.min(input.limit ?? WRITER_HARD_MAX, WRITER_HARD_MAX);
  const totalCandidatesInput = input.candidates.length;
  const candidatesRaw = input.candidates.slice(0, effectiveLimit);
  const totalCandidatesPrepared = candidatesRaw.length;

  // Adaptar todos los candidatos
  const candidates = candidatesRaw.map((c) =>
    adaptCandidate(c, input.sourceProvider, input.sourceKey, input.countryCode),
  );

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
    countryCode: input.countryCode,
  });

  // ── Paso 2: Evaluar cada candidato ────────────────────────
  const prepared: PreparedCandidate[] = [];
  const items: StructuredSourceCandidateWriterReport['items'] = [];

  for (const draft of candidates) {
    try {
      const noveltyDecision = evaluateTaxIdNovelty({
        name: draft.name,
        taxId: draft.taxId,
        countryCode: input.countryCode,
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
          duplicateCheckMetadata: null,
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
      // duplicateCheckMetadata se construye aquí y se guarda en metadata.duplicate_check
      // para que el modal UI de coincidencias pueda mostrarlo.
      let duplicateCheckMetadata: Record<string, unknown> = buildSafeDuplicateCheckMetadata({
        summary: 'Verificado contra SellUp (NIT/tax_id). Sin coincidencia en SellUp.',
        sources_checked: ['sellup'],
        matches: [],
      });

      if (runHubSpotCheck) {
        try {
          const hsResult = await checkHubSpotCompanyCommercialStatus({
            name: draft.name,
            taxId: draft.taxId,
            domain: draft.website ?? null,
            countryCode: input.countryCode,
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
              message: `hubspot_lookup_warning: ${hsResult.error}`,
            });
          }

          // Construir matches para el modal UI
          const dcMatches: Array<Record<string, unknown>> = [];
          if (hsResult.match) {
            dcMatches.push({
              source: 'hubspot',
              status: hubspotMatchStatus,
              confidence: typeof hsResult.match.matchConfidence === 'number' ? hsResult.match.matchConfidence : null,
              matched_name: hsResult.match.name ?? null,
              matched_domain: hsResult.match.domain ?? null,
              matched_website: null,
              matched_id: hsResult.match.hubspotCompanyId ?? null,
              reason: buildMatchReason(hubspotMatchStatus, hsResult.match.matchMethod ?? null),
            });
          }
          for (const pm of (hsResult.possibleMatches ?? [])) {
            if (pm.hubspotId !== hsResult.match?.hubspotCompanyId) {
              dcMatches.push({
                source: 'hubspot',
                status: 'possible_match_requires_review',
                confidence: typeof pm.confidence === 'number' ? pm.confidence : null,
                matched_name: pm.name ?? null,
                matched_domain: null,
                matched_website: null,
                matched_id: pm.hubspotId ?? null,
                reason: 'Posible coincidencia detectada',
              });
            }
          }
          duplicateCheckMetadata = buildSafeDuplicateCheckMetadata({
            summary: buildDcSummary(hubspotMatchStatus, true),
            sources_checked: ['sellup', 'hubspot'],
            matches: dcMatches,
          });
        } catch (hsErr: unknown) {
          // HubSpot failure does not block batch creation — degrade gracefully
          hubspotMatchStatus = 'hubspot_lookup_failed';
          hubspotLookupFailed++;
          const msg = hsErr instanceof Error ? hsErr.message : 'Error HubSpot desconocido';
          errors.push({
            name: draft.name,
            taxId: draft.taxId,
            message: `hubspot_lookup_failed: ${msg}`,
          });
          duplicateCheckMetadata = buildSafeDuplicateCheckMetadata({
            summary: { status: 'lookup_failed' },
            sources_checked: ['sellup'],
            matches: [],
            warning: 'hubspot_lookup_failed',
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
        duplicateCheckMetadata,
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
        source: input.sourceProvider,
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
        source: input.sourceProvider,
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

  let batchId = input.batchId ?? null;

  if (!batchId) {
    // ── Crear lote preview ────────────────────────────────────
    const resolvedBatchName = input.batchName ?? buildBatchName(input.sourceProvider, input.dataset, dateLabel);

    const batchRow = {
      name: resolvedBatchName,
      country: input.country,
      country_code: input.countryCode,
      industry: input.industry ?? 'Structured source',
      target_count: input.targetCount ?? toWrite.length,
      search_depth: input.searchDepth ?? 'basic',
      status: 'ready_for_review',
      source: input.sourceProvider,
      created_by: input.createdBy || input.requestedByUserId || null,
      owner_id: input.ownerId ?? null,
      agent_run_id: input.agentRunId ?? null,
      estimated_cost_usd: 0,
      metadata: {
        initiated_by: input.initiatedBy ?? 'ui_source_catalog',
        agent_run_id: input.agentRunId ?? null,
        batch_type: 'structured',
        source_channels: [input.sourceKey],
        structured_source_keys: [input.sourceKey],
        source_provider: input.sourceProvider,
        source_key: input.sourceKey,
        source_discovery_mode: input.initiatedBy === 'agent_1' ? 'agent_1_structured' : 'source_catalog_preview',
        country_code: input.countryCode,
        industry: input.industry ?? 'Structured source',
        target_count: input.targetCount ?? toWrite.length,
        preview_mode: input.previewMode ?? true,
        human_review_required: true,
        hubspot_sync_enabled: false,
        run_hubspot_check: runHubSpotCheck,
        total_candidates_input: totalCandidatesInput,
        total_candidates_written: toWrite.length,
        total_candidates_skipped: totalSkipped,
        writer_version: WRITER_VERSION,
        dataset: input.dataset,
        ui_smoke_test: input.uiSmokeTest ?? false,
        warning: 'Modo preview — ningún candidato aprobado ni asignado automáticamente.',
        ...(input.metadata ?? {}),
      },
    };

    const { data: batchData, error: batchError } = await supabase
      .from('prospect_batches')
      .insert(batchRow)
      .select('id')
      .single();

    if (batchError) {
      console.error('[StructuredSourceWriter] batch_creation_failed — prospect_batches insert rejected:', {
        errorCode: batchError.code,
        errorMessage: batchError.message,
        errorDetails: batchError.details,
        errorHint: batchError.hint,
        batchPayload: {
          country_code: batchRow.country_code,
          source: batchRow.source,
          status: batchRow.status,
          search_depth: batchRow.search_depth,
          target_count: batchRow.target_count,
          hasCreatedBy: Boolean(batchRow.created_by),
          hasOwnerId: Boolean(batchRow.owner_id),
          hasAgentRunId: Boolean(batchRow.agent_run_id),
          hasMetadata: Boolean(batchRow.metadata),
        },
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
          source: input.sourceProvider,
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

    batchId = batchData?.id ?? null;
  }

  // ── Insertar candidatos ───────────────────────────────────
  let written = 0;

  for (const p of toWrite) {
    try {
      const { draft } = p;
      const domain = extractDomain(draft.website);

      // Resolver tax_identifier_type según el país
      let resolvedTaxIdentifierType = draft.taxIdentifierType;
      const upperCc = input.countryCode?.toUpperCase();
      if (upperCc === 'CO') {
        resolvedTaxIdentifierType = 'NIT';
      } else if (upperCc === 'MX') {
        resolvedTaxIdentifierType = 'RFC';
      } else if (upperCc === 'CL') {
        resolvedTaxIdentifierType = 'RUT';
      } else if (upperCc === 'PE') {
        resolvedTaxIdentifierType = 'RUC';
      } else if (upperCc === 'EC') {
        resolvedTaxIdentifierType = 'RUC';
      }

      const { score: completenessScore, missingFields } = calculateDataCompleteness(draft);

      const enrichmentMeta: Record<string, unknown> = {
        city: draft.city ?? null,
        region: draft.department ?? null,
        sector_description: draft.sectorDescription ?? null,
        economic_activity: draft.sectorCode ?? null,
        legal_status: draft.legalStatus ?? null,
        data_completeness_score: completenessScore,
        missing_fields: missingFields,
        enrichment_sources: [input.sourceKey],
      };

      const candidateRow = {
        batch_id: batchId,
        account_id: null,
        converted_account_id: null,
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
        tax_identifier_type: resolvedTaxIdentifierType ?? null,
        source_primary: input.sourceProvider,
        sources_checked: [input.sourceProvider],
        employee_count: null,
        employee_count_status: 'unknown_requires_manual_validation',
        employee_count_source: null,
        employee_count_confidence: null,
        commercial_fit_status: p.commercialFitStatus,
        hubspot_match_status: p.hubspotMatchStatus,
        hubspot_lifecycle_status: p.hubspotLifecycleStatus,
        hubspot_owner_id: p.hubspotOwnerId,
        recyclable_status: p.recyclableStatus ?? null,
        review_status: 'needs_manual_review', // Forced to human review
        review_flags: p.reviewFlags,
        source_trace: draft.sourceTrace,
        hubspot_trace: p.hubspotTrace,
        commercial_trace: p.commercialTrace,
        status: 'needs_review', // Forced to review state
        duplicate_status: p.duplicateStatus,
        confidence_score: null,
        fit_score: null,
        data_completeness_score: completenessScore,
        estimated_cost_usd: 0,
        metadata: {
          writer_version: WRITER_VERSION,
          dataset: input.dataset,
          preview_mode: true,
          human_review_required: true,
          notes: 'Tamaño no confirmado — validar manualmente',
          enrichment: enrichmentMeta,
          ...(p.duplicateCheckMetadata ? { duplicate_check: p.duplicateCheckMetadata } : {}),
        },
      };

      const { error: insertError } = await supabase
        .from('prospect_candidates')
        .insert(candidateRow);

      if (insertError) {
        console.error('[StructuredSourceWriter] candidate_insert_failed — prospect_candidates insert rejected:', {
          errorCode: insertError.code,
          errorMessage: insertError.message,
          errorDetails: insertError.details,
          errorHint: insertError.hint,
          candidatePayload: {
            name: draft.name,
            country_code: input.countryCode,
            tax_identifier_type: candidateRow.tax_identifier_type,
            hasTaxIdentifier: Boolean(candidateRow.tax_identifier),
            source: input.sourceProvider,
            review_status: candidateRow.review_status,
            hasMetadata: Boolean(candidateRow.metadata),
          },
        });
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
      source: input.sourceProvider,
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
