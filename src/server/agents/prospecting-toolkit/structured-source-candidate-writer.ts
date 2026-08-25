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
import { sanitizeStructuredDiscoveryProvenance } from './structured-discovery-provenance';
// AGENT1-CUT3B23 § 5/§ 6 — la MISMA evidencia de identidad que producen las otras
// dos rutas de escritura de Agente 1. Esta capa gratuita aportaba identidad
// FISCAL y nadie más la leía; el registro de lote es quien las compara.
import { buildCompanyIdentityEvidence } from './company-identity-evidence';
import {
  acceptIdentity,
  createBatchIdentityCounters,
  evaluateCandidateIdentity,
  isBatchIdentityHardDuplicate,
  tallyBatchIdentityDecision,
  tallyBatchIdentityDuplicateAfterAdmission,
  tallyBatchIdentityError,
  tallyBatchIdentityPersisted,
} from './batch-identity-registry';
import {
  loadBatchIdentityRegistry,
  type BatchIdentitySeedOutcome,
} from '@/server/prospect-batches/batch-identity-registry-store';
// AGENT1-CUT3B4 §§ 10/21 — el MISMO vallado y el MISMO bucle que usan las otras
// dos rutas. Esta capa no implementa política de concurrencia propia.
import {
  initialFencedPersistenceTelemetry,
  mergeFencedPersistenceTelemetry,
  runFencedPersistence,
  toFencedPersistenceMetadata,
  type FencedPersistenceTelemetry,
} from '@/server/prospect-batches/batch-identity-fenced-persistence';
// AGENT1-CUT4-B1 § 6 — la MISMA autoridad de procedencia que ya usa el writer
// canónico (`candidate-writer.ts` § A). No se abre una segunda clasificación:
// aquí sólo se proyecta la decisión que toma el clasificador canónico.
import {
  CANDIDATE_RECORD_ORIGIN_METADATA_KEY,
  resolveCandidateRecordOriginForWriter,
  toCandidateRecordOriginColumns,
  toCandidateRecordOriginMetadata,
} from './candidate-record-origin';

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
  /**
   * Valor a persistir en `prospect_batches.source`. Vocabulario DISTINTO al de
   * `prospect_candidates.source_primary` (CHECK constraints separados en la
   * base — ver migrations 040-052). Si se omite, usa `sourceProvider`,
   * preservando el comportamiento histórico de todos los callers existentes
   * (Socrata Colombia, DENUE México, datos.gob.cl, etc.).
   */
  batchSource?: string;
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
  /**
   * AGENT1-CUT3B23 § 15 — el descubrimiento NO es lo aceptado único. Un duplicado
   * de identidad de lote se cuenta aquí y NO en `errors`: no es una avería de
   * escritura.
   */
  batchIdentity: {
    rawDiscovered: number;
    /** Pasó la admisión de identidad. Permiso para intentar escribir, NO una fila. */
    identityAdmittedUnique: number;
    /** Filas que EXISTEN. Lo único que cuenta contra el objetivo del lote. */
    persistedUnique: number;
    duplicateSkipped: number;
    possibleDuplicateAllowed: number;
    distinctStrongConflict: number;
    errors: number;
    /** Filas del lote sembradas desde base de datos antes de admitir. */
    seededCount: number;
    /** `true` si la siembra degradó: MENOS cobertura, nunca supresión extra. */
    seedDegraded: boolean;
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
  /**
   * AGENT1-CUT3B23 — la MISMA entrada del reporte que este candidato produjo.
   * Se guarda la referencia en vez de buscarla luego por nombre + NIT: dos
   * candidatos pueden compartir los dos valores, y entonces la anotación de
   * admisión caería sobre la fila equivocada.
   */
  reportItem?: StructuredSourceCandidateWriterReport['items'][number];
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

/**
 * AGENT1-CUT3B23 § 15 — bloque de conteo de identidad neutro.
 *
 * Se usa en las salidas que NO llegan a admitir nada (input vacío, dryRun, nada
 * que escribir, fallo de creación de lote): ceros honestos, nunca ausencia.
 */
function emptyBatchIdentityReport(): StructuredSourceCandidateWriterReport['batchIdentity'] {
  return {
    ...toBatchIdentityCountersMetadataShape(createBatchIdentityCounters()),
    seededCount: 0,
    seedDegraded: false,
  };
}

/** Contadores en la forma camelCase del reporte del writer. */
function toBatchIdentityCountersMetadataShape(
  counters: ReturnType<typeof createBatchIdentityCounters>,
): Omit<StructuredSourceCandidateWriterReport['batchIdentity'], 'seededCount' | 'seedDegraded'> {
  return {
    rawDiscovered: counters.rawDiscovered,
    identityAdmittedUnique: counters.identityAdmittedUnique,
    persistedUnique: counters.persistedUnique,
    duplicateSkipped: counters.duplicateSkipped,
    possibleDuplicateAllowed: counters.possibleDuplicateAllowed,
    distinctStrongConflict: counters.distinctStrongConflict,
    errors: counters.errors,
  };
}

function buildEmptyReport(executedAt: string, dryRun: boolean, batchSource: string): StructuredSourceCandidateWriterReport {
  return {
    executedAt,
    dryRun,
    batch: {
      wouldCreate: false,
      created: false,
      id: null,
      source: batchSource,
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
    batchIdentity: emptyBatchIdentityReport(),
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
    // 🔴 § 6 — la metadata de un adapter es `Record<string, unknown>` sin
    // contrato. Aquí se normaliza CLAVE Y VALOR; lo que no encaja se omite.
    discoveryProvenance: sanitizeStructuredDiscoveryProvenance(disc.metadata),
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
  // AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 § 3 — vocabulario de lote
  // distinto al de candidato. Sin batchSource explícito, cae en sourceProvider:
  // comportamiento histórico intacto para todo caller existente.
  const resolvedBatchSource = input.batchSource ?? input.sourceProvider;

  const errors: StructuredSourceCandidateWriterReport['errors'] = [];

  if (!input.candidates || input.candidates.length === 0) {
    return buildEmptyReport(executedAt, dryRun, resolvedBatchSource);
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

      const reportItem = {
        name: draft.name,
        taxId: draft.taxId,
        noveltyStatus: noveltyDecision.status,
        shouldWrite: true,
        skippedReason: null as string | null,
        reviewStatus,
        commercialFitStatus,
        hubspotMatchStatus,
        reviewFlags,
      };
      items.push(reportItem);

      prepared.push({
        draft,
        reportItem,
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
        source: resolvedBatchSource,
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
      batchIdentity: emptyBatchIdentityReport(),
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
        source: resolvedBatchSource,
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
      batchIdentity: emptyBatchIdentityReport(),
      items,
      errors,
    };
  }

  let batchId = input.batchId ?? null;

  // ── AGENT1-CUT4-B1 § 6/§ 7 — la forma del LOTE tal como esta corrida lo declara
  //
  // Se calcula ANTES de la bifurcación de creación porque el clasificador canónico
  // la necesita en las DOS ramas: cuando este writer crea el lote y cuando adopta
  // uno que ya existe (`input.batchId`, la vía de `prospect-generation.ts`). Son
  // los marcadores REALES de la corrida, no una etiqueta inventada: la misma
  // `source`, el mismo nombre y las mismas claves de metadata que la fila del lote
  // lleva o llevaría.
  const resolvedBatchName =
    input.batchName ?? buildBatchName(input.sourceProvider, input.dataset, dateLabel);

  // `uiSmokeTest` es el nombre LOCAL de este writer para «esta corrida es un smoke
  // de UI». El clasificador canónico reconoce ese hecho por la clave EXACTA
  // `smoke_test` (§ SMOKE_TRUE_KEYS), así que el flag se traduce a su vocabulario
  // en la ENTRADA del clasificador. No es una segunda clasificación —la decisión
  // sigue siendo suya—; es dejar de ocultarle un marcador que ya existía.
  //
  // `preview_mode` NO se traduce, y es deliberado: describe una POLÍTICA («nada se
  // aprueba ni se asigna automáticamente»), no que la corrida no haya ocurrido. Es
  // el mismo razonamiento con el que el clasificador declara `do_not_sync_hubspot`
  // como pista NO decisiva. Traducirlo dejaría toda la capa gratuita fuera de la
  // cola de revisión limpia, que es exactamente el defecto contrario.
  //
  // El marcador propio del writer va DESPUÉS del paso a través: un caller no puede
  // apagar con su metadata un smoke que este writer sabe que está corriendo.
  const provenanceBatchShape = {
    source: resolvedBatchSource,
    name: resolvedBatchName,
    metadata: {
      ...(input.metadata ?? {}),
      preview_mode: input.previewMode ?? true,
      ui_smoke_test: input.uiSmokeTest ?? false,
      ...(input.uiSmokeTest === true ? { smoke_test: true } : {}),
    } as Record<string, unknown>,
  };

  if (!batchId) {
    // ── Crear lote preview ────────────────────────────────────

    const batchRow = {
      name: resolvedBatchName,
      country: input.country,
      country_code: input.countryCode,
      industry: input.industry ?? 'Structured source',
      target_count: input.targetCount ?? toWrite.length,
      search_depth: input.searchDepth ?? 'basic',
      status: 'ready_for_review',
      source: resolvedBatchSource,
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
          source: resolvedBatchSource,
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
        batchIdentity: emptyBatchIdentityReport(),
        items,
        errors,
      };
    }

    batchId = batchData?.id ?? null;
  }

  // ── AGENT1-CUT3B23 § 8/§ 9 — registro de identidad de ESTE lote ────────────
  //
  // Se siembra con las filas que el lote YA contiene y que lo ocupan. Cuando el
  // lote acaba de crearse en esta misma llamada la siembra es vacía por
  // construcción, y eso es correcto: no había nada persistido. Cuando el lote se
  // ADOPTA (`input.batchId`), la siembra es lo que hace que la capa gratuita vea
  // lo que la de pago ya escribió, y al revés.
  // AGENT1-CUT3B4 § 9 — la foto trae filas Y ÉPOCA del mismo estado, y avanza como
  // UN valor. Un lote recién creado en esta llamada nace en la época 0: la siembra
  // vacía es un hecho, no una omisión. Un lote ADOPTADO trae la época que tenga.
  // 🔴 AGENT1-CUT3B4 — sin lote no se puede vallar, y sin valla no se escribe.
  //
  // Hasta aquí `batchId` podía ser nulo en un caso degenerado —la creación no
  // devolvió error pero tampoco fila—, y el escritor seguía adelante insertando
  // candidatos con `batch_id` nulo para que los rechazara la base uno a uno. Eso
  // ya era ruido; con el vallado sería además una escritura SIN valla, que es
  // justo lo que este corte no puede dejar existir. Se falla CERRADO y se dice.
  if (batchId === null) {
    errors.push({
      name: null,
      taxId: null,
      message: 'Error creando lote: el lote no quedó identificado',
    });
    return {
      executedAt,
      dryRun: false,
      batch: {
        wouldCreate: false,
        created: false,
        id: null,
        source: resolvedBatchSource,
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
      batchIdentity: emptyBatchIdentityReport(),
      items,
      errors,
    };
  }

  const batchIdentitySeed = await loadBatchIdentityRegistry(supabase, batchId);
  let batchIdentitySnapshot: BatchIdentitySeedOutcome = batchIdentitySeed;
  let batchIdentityCounters = createBatchIdentityCounters();
  // 🔴 CUT-3B4-CORRECCIÓN — derivada de la foto con la MISMA regla que la
  // decisión: la bandera de compatibilidad sólo es `true` con ausencia PROBADA.
  let batchIdentityFenceTelemetry: FencedPersistenceTelemetry =
    initialFencedPersistenceTelemetry(batchIdentitySeed);

  // ── Insertar candidatos ───────────────────────────────────
  let written = 0;

  for (const p of toWrite) {
    try {
      const { draft } = p;
      const domain = extractDomain(draft.website);

      // § 5 — evidencia por el constructor COMPARTIDO. Esta ruta aporta identidad
      // fiscal (`tax_id` y `tax_identifier` con el MISMO valor) y, cuando la
      // fuente da web, dominio. No trae LinkedIn ni id de empresa de proveedor:
      // ausencia declarada, nunca fabricada.
      const identityEvidence = buildCompanyIdentityEvidence({
        countryCode: input.countryCode,
        taxId: draft.taxId,
        taxIdentifier: draft.taxId,
        domain,
        website: draft.website ?? null,
        name: draft.name,
      });
      const identityDecision = evaluateCandidateIdentity(
        batchIdentitySnapshot.registry,
        identityEvidence,
      );
      batchIdentityCounters = tallyBatchIdentityDecision(
        batchIdentityCounters,
        identityDecision,
      );

      // § 12 — un duplicado duro NO se persiste, NO es un error y NO sobrescribe
      // al ganador. El primer candidato durable aceptado sigue siendo el
      // candidato del lote.
      if (isBatchIdentityHardDuplicate(identityDecision)) {
        if (p.reportItem) {
          p.reportItem.shouldWrite = false;
          p.reportItem.skippedReason = `batch_identity_duplicate:${identityDecision.matchedSignal}`;
        }
        continue;
      }

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

      // ── AGENT1-CUT4-B1 § 6 — la metadata base, ANTES de la fila ─────────────
      //
      // Se extrae a su propia constante por una razón concreta: el clasificador
      // canónico tiene que verla para poder VETAR el ascenso a `production` desde
      // un marcador que viva en ella. Si la metadata sólo existiera dentro del
      // literal de la fila, la resolución tendría que adivinarla.
      const candidateBaseMetadata: Record<string, unknown> = {
        // 🔴 § 6 — SEGUNDA pasada del validador, y no es redundante: los
        // borradores que YA llegan como `StructuredSourceCandidateDraft`
        // atraviesan `adaptCandidate` intactos, así que sin esto un caller
        // podría fabricar `discoveryProvenance: { raw_payload: … }` y saltarse
        // la frontera. La defensa se sostiene en el límite de la FILA.
        //
        // Va PRIMERO: las claves canónicas del writer que siguen abajo siempre
        // ganan si algún día colisionaran.
        ...sanitizeStructuredDiscoveryProvenance(draft.discoveryProvenance),
        writer_version: WRITER_VERSION,
        dataset: input.dataset,
        preview_mode: true,
        human_review_required: true,
        notes: 'Tamaño no confirmado — validar manualmente',
        enrichment: enrichmentMeta,
        ...(p.duplicateCheckMetadata ? { duplicate_check: p.duplicateCheckMetadata } : {}),
      };

      // ── AGENT1-CUT4-B1 § 6 — la procedencia de la FILA ──────────────────────
      //
      // El defecto que cierra: esta capa insertaba `status='needs_review'` dejando
      // `record_origin` en NULL, y la cola de revisión limpia exige
      // `PENDING_REVIEW_RECORD_ORIGIN = 'production'` (y con ella los cuatro gates
      // de acción). El candidato era VISIBLE y no OPERABLE — ni aprobable ni
      // descartable— por una columna que el writer simplemente no escribía.
      //
      // No se fuerza nada: `record_origin` es la clase de CORRIDA de la que salió
      // la fila, y quien la decide es el clasificador canónico sobre la fila real.
      // Un marcador de smoke/QA/import gana siempre; una corrida en seco no
      // etiqueta. `source_primary` sigue siendo otra dimensión (QUÉ proveedor la
      // produjo) y no se toca.
      const recordOriginResolution = resolveCandidateRecordOriginForWriter({
        dryRun,
        candidate: {
          status: 'needs_review',
          duplicate_status: p.duplicateStatus,
          source_primary: input.sourceProvider,
          // Esta ruta no escribe `review_notes` en la fila: declararlo ausente es
          // más honesto que pasarle al clasificador un texto que no se persiste.
          review_notes: null,
          metadata: candidateBaseMetadata,
          // `review_flags` de esta capa es un ARRAY (`ReviewFlag[]`), no el
          // diccionario que el clasificador inspecciona por clave exacta. Pasarlo
          // no aportaría ningún marcador, así que se omite en vez de disfrazarlo.
        },
        batch: provenanceBatchShape,
      });

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
        // § 6 — la fila declara de qué clase de corrida salió. Sin esto un
        // candidato real de una corrida real no se puede aprobar ni descartar.
        ...toCandidateRecordOriginColumns(recordOriginResolution),
        confidence_score: null,
        fit_score: null,
        data_completeness_score: completenessScore,
        estimated_cost_usd: 0,
        metadata: {
          ...candidateBaseMetadata,
          // § 6 — cómo se decidió la procedencia de la fila, auditable sin
          // reejecutar. ADITIVO: no pisa ninguna clave anterior.
          [CANDIDATE_RECORD_ORIGIN_METADATA_KEY]:
            toCandidateRecordOriginMetadata(recordOriginResolution),
        },
      };

      // ── AGENT1-CUT3B4 §§ 7/10/21 — la escritura va VALLADA ─────────────────
      //
      // Esta capa es la GRATUITA, y la de pago escribe en el mismo lote cuando lo
      // adopta. Sin valla, las dos podían decidir «único» contra la misma foto y
      // escribir la misma empresa dos veces. La época viaja con el INSERT; si no
      // coincide, la base no escribe nada y el bucle recarga la foto y RE-PREGUNTA
      // a `evaluateCandidateIdentity`, que sigue siendo la única autoridad.
      const fenceOutcome = await runFencedPersistence({
        client: supabase,
        batchId,
        snapshot: batchIdentitySnapshot,
        plan: (snap) => {
          const decision = evaluateCandidateIdentity(snap.registry, identityEvidence);
          return isBatchIdentityHardDuplicate(decision)
            ? ({ kind: 'duplicate', decision } as const)
            : ({ kind: 'persist', rows: [candidateRow], decisions: [decision] } as const);
        },
      });
      batchIdentitySnapshot = fenceOutcome.snapshot;
      batchIdentityFenceTelemetry = mergeFencedPersistenceTelemetry(
        batchIdentityFenceTelemetry,
        fenceOutcome.telemetry,
      );

      if (fenceOutcome.status === 'duplicate') {
        // Duplicado descubierto SÓLO al re-evaluar tras perder la carrera. No es
        // error, no consume objetivo y la admisión previa se retira del conteo.
        batchIdentityCounters = tallyBatchIdentityDuplicateAfterAdmission(
          batchIdentityCounters,
        );
        if (p.reportItem) {
          p.reportItem.shouldWrite = false;
          p.reportItem.skippedReason =
            `batch_identity_duplicate_after_stale_retry:${fenceOutcome.decision.matchedSignal}`;
        }
        continue;
      }

      if (fenceOutcome.status === 'retry_exhausted') {
        // 🔴 Fallo CERRADO. No hay caída a un insert directo: escribir sin valla
        // tras perder las carreras del tope sería la fila fantasma que este corte
        // existe para impedir.
        batchIdentityCounters = tallyBatchIdentityError(batchIdentityCounters);
        errors.push({
          name: draft.name,
          taxId: draft.taxId,
          message: 'Error insertando candidato: identity_fence_retry_exhausted',
        });
        continue;
      }

      // 🔴 CUT-3B4-CORRECCIÓN — no se pudo vallar y NO hay prueba de que la 126
      // falte. Fallo CERRADO y EXPLÍCITO: se escribe como rama propia, no como
      // caída del `else` final, para que el motivo viaje al informe en vez de
      // colapsar en «desenlace no contemplado».
      if (fenceOutcome.status === 'snapshot_unavailable') {
        batchIdentityCounters = tallyBatchIdentityError(batchIdentityCounters);
        errors.push({
          name: draft.name,
          taxId: draft.taxId,
          message: `Error insertando candidato: identity_fence_${fenceOutcome.reason}`,
        });
        if (p.reportItem) {
          p.reportItem.shouldWrite = false;
          p.reportItem.skippedReason = `identity_fence_${fenceOutcome.reason}`;
        }
        continue;
      }

      let insertError: { code?: string; message: string; details?: unknown; hint?: unknown } | null =
        null;
      let persisted = false;

      if (fenceOutcome.status === 'persisted') {
        persisted = fenceOutcome.insertedCount > 0;
        if (!persisted) {
          insertError = { message: 'identity_fence_reported_zero_rows' };
        }
      } else if (fenceOutcome.status === 'insert_failed') {
        // La transacción de la valla revirtió entera: ni fila, ni avance de época.
        const raw = fenceOutcome.raw as { code?: string; message?: string; details?: unknown; hint?: unknown } | null;
        insertError = {
          code: raw?.code ?? fenceOutcome.code,
          message: raw?.message ?? fenceOutcome.code,
          details: raw?.details,
          hint: raw?.hint,
        };
      } else if (fenceOutcome.status === 'capability_absent') {
        // ── Ruta ANTERIOR a B4, conservada tal cual ───────────────────────────
        //
        // 🔴 La condición se escribe EXPLÍCITA y no como caída del `else`: el
        // único motivo legítimo para escribir sin valla es que la BASE haya dicho
        // que la función no existe —la migración 126 no está aplicada—. Un `else`
        // suelto absorbería en silencio cualquier desenlace futuro del vallado y
        // lo convertiría en una escritura sin valla, que es exactamente el desvío
        // que este corte existe para impedir.
        //
        // No es un flag y nadie puede activarla a mano. Mientras se ejecute, la
        // carrera sigue igual de abierta que antes de B4. Aplicada la 126, esta
        // rama es INALCANZABLE.
        const legacy = await supabase.from('prospect_candidates').insert(candidateRow);
        insertError = legacy.error;
        persisted = !legacy.error;
      } else {
        // Desenlace vallado no contemplado: se falla CERRADO. Nunca se degrada a
        // una escritura sin valla.
        insertError = { message: `identity_fence_unexpected_outcome` };
      }

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
            source: candidateRow.source_primary,
            review_status: candidateRow.review_status,
            hasMetadata: Boolean(candidateRow.metadata),
          },
        });
        batchIdentityCounters = tallyBatchIdentityError(batchIdentityCounters);
        errors.push({
          name: draft.name,
          taxId: draft.taxId,
          message: `Error insertando candidato: ${insertError.message}`,
        });
      } else if (persisted) {
        written++;
        // § 12 — se registra DESPUÉS de que la fila exista. Registrar antes haría
        // que un insert fallido bloqueara al siguiente candidato legítimo.
        //
        // AGENT1-CUT3B4 — y se registra DENTRO de la foto: es lo que el vallado y
        // la re-evaluación consultan, y dos acumuladores habrían divergido en la
        // primera carrera.
        batchIdentitySnapshot = {
          ...batchIdentitySnapshot,
          registry: acceptIdentity(
            batchIdentitySnapshot.registry,
            identityEvidence,
            fenceOutcome.status === 'persisted'
              ? (fenceOutcome.candidateIds[0] ?? null)
              : null,
          ),
        };
        // § 3 — y sólo aquí sube el conteo de filas REALES.
        batchIdentityCounters = tallyBatchIdentityPersisted(batchIdentityCounters);
      }
    } catch (insertErr: unknown) {
      const msg = insertErr instanceof Error ? insertErr.message : 'Error insertando candidato';
      batchIdentityCounters = tallyBatchIdentityError(batchIdentityCounters);
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
      source: resolvedBatchSource,
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
    batchIdentity: {
      ...toBatchIdentityCountersMetadataShape(batchIdentityCounters),
      seededCount: batchIdentitySeed.seededCount,
      seedDegraded: batchIdentitySeed.degraded,
      // AGENT1-CUT3B4 § 24 — telemetría de CONCURRENCIA, sin PII: sólo conteos y
      // estados. Un reintento por decisión caduca NO es error; agotar el tope SÍ.
      ...toFencedPersistenceMetadata(batchIdentityFenceTelemetry),
    },
    items,
    errors,
  };
}
