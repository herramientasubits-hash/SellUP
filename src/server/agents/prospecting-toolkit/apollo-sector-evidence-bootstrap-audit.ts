/**
 * apollo-sector-evidence-bootstrap-audit.ts — La traza durable de un candidato
 * que se enriqueció para ADQUIRIR su clasificación y murió antes del writer.
 *
 * AGENT1-APOLLO-SECTOR-EVIDENCE-BOOTSTRAP-1 · § 17 (observabilidad).
 *
 * El agujero que cierra, y por qué no era hipotético:
 *
 *   El bootstrap autoriza a PAGAR un `organization_enrichment` para un sector sin
 *   política. Pagado el crédito, la reevaluación posterior corre deliberadamente
 *   SIN autorización, así que el candidato vuelve a `sector_not_mapped`, el
 *   orquestador lo marca como rechazo definitivo y NUNCA llega al writer. Y todo
 *   lo que ese crédito compró —la industria que Apollo sí devolvió al enriquecer,
 *   sus keywords, y el veredicto de precisión de Wave 1 sobre cada subindustria
 *   pedida— vivía sólo en dos mapas en memoria (`subindustryPrecisionByKey`,
 *   `evidenceByKey`) y en `prospect_candidates.metadata.apollo_enrichment_capture`,
 *   que sólo se escribe para los candidatos PERSISTIDOS o en revisión.
 *
 *   Es decir: la corrida que existe para CALIBRAR Wave 1 pagaba la evidencia y la
 *   perdía al terminar la request. Calibrar habría exigido volver a gastar.
 *
 * Este módulo no es una segunda fuente de verdad: es la PROYECCIÓN de lo que la
 * corrida ya decidió, sobre el bloque de metadata que el bootstrap ya publicaba
 * (`apollo_sector_evidence_bootstrap`), que el writer deja en
 * `prospect_batches.metadata` incluso cuando `candidates = []` — que es
 * exactamente el caso que hay que auditar.
 *
 * Alcance del detalle, deliberado: la clasificación comprada y las evaluaciones de
 * precisión viajan SÓLO para los candidatos cuyo enrichment se intentó (<= 5 por
 * corrida). Los meramente elegibles que nunca compitieron no compraron nada, así
 * que su registro es el ligero: quién era, por qué podía competir, y en qué acabó.
 *
 * Puro: sin I/O, sin reloj, sin env, sin llamadas al proveedor.
 */

import type {
  ApolloCandidateFinalDisposition,
  ApolloCandidateFinalDispositionEntry,
} from './apollo-two-round/candidate-final-disposition';
import type {
  ApolloTwoRoundCandidateEvidenceSnapshot,
  ApolloTwoRoundCandidateSnapshot,
  ApolloTwoRoundEnrichmentStatus,
} from './apollo-two-round/checkpoint';
import type { CandidateSectorEvidenceState } from './apollo-two-round/enrichment-ranking';
import type { ApolloSectorEvidenceBootstrapCandidateReason } from './apollo-sector-evidence-bootstrap';
import type { ApolloSubindustryPrecisionAssessment } from './apollo-subindustry-precision';
import {
  toApolloSubindustryPrecisionMetadata,
  toOperationalConfirmedRequestedSubindustryMetadata,
} from './apollo-subindustry-precision';
import type {
  ApolloSectorAdmissionSource,
  ApolloSectorPostEnrichmentAdmissionResult,
} from './apollo-sector-post-enrichment-admission';

// ─── Dónde aterriza ───────────────────────────────────────────────────────────

/**
 * Clave del bloque en `prospect_batches.metadata`.
 *
 * La misma que el bootstrap ya usaba: el contrato de observabilidad CRECE dentro
 * del bloque existente en vez de abrir uno paralelo. Dos bloques que describen el
 * mismo gasto acabarían discrepando.
 */
export const APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY =
  'apollo_sector_evidence_bootstrap' as const;

// ─── Clasificación que el enrichment trajo ────────────────────────────────────

/**
 * Los campos clasificatorios del perfil COMPRADO, normalizados.
 *
 * No es el payload de Apollo: es la lista blanca que el gate sectorial y el
 * evaluador de precisión leen, que es lo único con lo que una revisión manual
 * puede repetir el juicio. Las descripciones viajan como presencia y no como
 * texto — su contenido no cambia ningún veredicto que no esté ya en el veredicto,
 * y sí multiplicaría el tamaño del documento.
 */
export type ApolloSectorEvidenceBootstrapEnrichedClassification = {
  industry: string | null;
  industries: string[];
  keywords: string[];
  organizationKeywords: string[];
  hasShortDescription: boolean;
  hasSeoDescription: boolean;
  hasDescription: boolean;
  employeeCount: number | null;
};

/**
 * ¿El perfil comprado trajo ALGO clasificatorio?
 *
 * Es la pregunta que separa «el enrichment resolvió la ausencia y el sector sigue
 * sin política» de «el enrichment tampoco trajo nada». Los dos terminan en
 * `sector_not_mapped` y significan cosas opuestas para la calibración.
 */
export function hasApolloSectorEvidenceBootstrapClassification(
  classification: ApolloSectorEvidenceBootstrapEnrichedClassification,
): boolean {
  return (
    classification.industry !== null ||
    classification.industries.length > 0 ||
    classification.keywords.length > 0 ||
    classification.organizationKeywords.length > 0 ||
    classification.hasShortDescription ||
    classification.hasSeoDescription ||
    classification.hasDescription
  );
}

function toEnrichedClassification(
  evidence: ApolloTwoRoundCandidateEvidenceSnapshot,
): ApolloSectorEvidenceBootstrapEnrichedClassification {
  return {
    industry: evidence.industry,
    industries: [...evidence.industries],
    keywords: [...evidence.keywords],
    organizationKeywords: [...evidence.organization_keywords],
    hasShortDescription: evidence.short_description !== null,
    hasSeoDescription: evidence.seo_description !== null,
    hasDescription: evidence.description !== null,
    employeeCount: evidence.employee_count,
  };
}

// ─── El registro por candidato ────────────────────────────────────────────────

export type ApolloSectorEvidenceBootstrapCandidateAudit = {
  candidateKey: string;
  bootstrapReason: ApolloSectorEvidenceBootstrapCandidateReason;
  selectedForEnrichment: boolean;
  /** Puesto en la selección de enrichment (1-based). `null` si no compitió. */
  selectionRank: number | null;
  enrichmentStatus: ApolloTwoRoundEnrichmentStatus;
  enrichmentExecuted: boolean;
  /**
   * Sólo cuando el enrichment se intentó. `null` en un candidato elegible que
   * nunca llegó a competir: no compró nada que auditar.
   */
  enrichedClassification: ApolloSectorEvidenceBootstrapEnrichedClassification | null;
  /** Veredicto de precisión POSTERIOR al enrichment. `null` por la misma razón. */
  postEnrichmentPrecision: ApolloSubindustryPrecisionAssessment | null;
  postEnrichmentSectorState: CandidateSectorEvidenceState | null;
  /**
   * POST-ENRICHMENT-ADMISSION-1 § 20 — cómo cruzó (o no) el gate sectorial.
   *
   * `null` cuando el candidato nunca llegó a la resolución de admisión: no
   * compitió, o su enrichment quedó indeterminado. Ausencia, no `legacy`.
   */
  sectorAdmission: ApolloSectorPostEnrichmentAdmissionResult | null;
  /** Disposición terminal canónica. Exactamente una por candidato (§ E). */
  terminalDisposition: ApolloCandidateFinalDisposition | null;
  terminalReason: string | null;
};

export type ApolloSectorEvidenceBootstrapAuditInput = {
  /** Candidatos que quedaron elegibles para adquirir evidencia, con su motivo. */
  bootstrapEligibleReasonByKey: ReadonlyMap<string, ApolloSectorEvidenceBootstrapCandidateReason>;
  /** Puesto en la selección de enrichment, 1-based. */
  selectionRankByKey: ReadonlyMap<string, number>;
  enrichmentStatusByKey: ReadonlyMap<string, ApolloTwoRoundEnrichmentStatus>;
  /** Evidencia vigente: el runner la sustituye por la enriquecida al comprarla. */
  evidenceByKey: ReadonlyMap<string, ApolloTwoRoundCandidateEvidenceSnapshot>;
  precisionByKey: ReadonlyMap<string, ApolloSubindustryPrecisionAssessment>;
  sectorEvidenceStateByKey: ReadonlyMap<string, CandidateSectorEvidenceState>;
  /** POST-ENRICHMENT-ADMISSION-1 § 20. Ausente ⇒ todos los registros con `null`. */
  sectorAdmissionByKey?: ReadonlyMap<string, ApolloSectorPostEnrichmentAdmissionResult>;
  finalDispositions: readonly ApolloCandidateFinalDispositionEntry[];
};

/**
 * Proyecta la traza de los candidatos bootstrap-eligible de una corrida.
 *
 * Orden determinista —seleccionados primero por puesto, después el resto por
 * clave— para que dos ejecuciones del mismo run produzcan el mismo documento.
 */
export function buildApolloSectorEvidenceBootstrapAudit(
  input: ApolloSectorEvidenceBootstrapAuditInput,
): ApolloSectorEvidenceBootstrapCandidateAudit[] {
  const dispositionByKey = new Map(
    input.finalDispositions.map((entry) => [entry.candidateKey, entry]),
  );

  const records = [...input.bootstrapEligibleReasonByKey.entries()].map(
    ([candidateKey, bootstrapReason]) => {
      const selectionRank = input.selectionRankByKey.get(candidateKey) ?? null;
      const enrichmentStatus = input.enrichmentStatusByKey.get(candidateKey) ?? 'not_attempted';
      // «Se intentó» y no «se cobró»: un `no_match` o un `indeterminate` también
      // consumieron el cupo y también son un dato de calibración. Lo que NO se
      // intentó no compró nada, y por eso no arrastra clasificación ni precisión.
      const attempted = enrichmentStatus !== 'not_attempted';
      const evidence = attempted ? (input.evidenceByKey.get(candidateKey) ?? null) : null;
      const disposition = dispositionByKey.get(candidateKey) ?? null;

      return {
        candidateKey,
        bootstrapReason,
        selectedForEnrichment: selectionRank !== null,
        selectionRank,
        enrichmentStatus,
        enrichmentExecuted: enrichmentStatus === 'executed',
        enrichedClassification: evidence === null ? null : toEnrichedClassification(evidence),
        postEnrichmentPrecision: attempted
          ? (input.precisionByKey.get(candidateKey) ?? null)
          : null,
        postEnrichmentSectorState: input.sectorEvidenceStateByKey.get(candidateKey) ?? null,
        sectorAdmission: input.sectorAdmissionByKey?.get(candidateKey) ?? null,
        terminalDisposition: disposition?.finalDisposition ?? null,
        terminalReason: disposition?.finalReason ?? null,
      } satisfies ApolloSectorEvidenceBootstrapCandidateAudit;
    },
  );

  return records.sort((a, b) => {
    if (a.selectionRank !== b.selectionRank) {
      if (a.selectionRank === null) return 1;
      if (b.selectionRank === null) return -1;
      return a.selectionRank - b.selectionRank;
    }
    return a.candidateKey.localeCompare(b.candidateKey);
  });
}

// ─── Proyección a metadata ────────────────────────────────────────────────────

export function toApolloSectorEvidenceBootstrapAuditMetadata(
  records: readonly ApolloSectorEvidenceBootstrapCandidateAudit[],
): Record<string, unknown>[] {
  return records.map((record) => ({
    candidate_key: record.candidateKey,
    bootstrap_reason: record.bootstrapReason,
    selected_for_enrichment: record.selectedForEnrichment,
    selection_rank: record.selectionRank,
    enrichment_status: record.enrichmentStatus,
    enrichment_executed: record.enrichmentExecuted,
    enriched_classification:
      record.enrichedClassification === null
        ? null
        : {
            industry: record.enrichedClassification.industry,
            industries: record.enrichedClassification.industries,
            keywords: record.enrichedClassification.keywords,
            organization_keywords: record.enrichedClassification.organizationKeywords,
            has_short_description: record.enrichedClassification.hasShortDescription,
            has_seo_description: record.enrichedClassification.hasSeoDescription,
            has_description: record.enrichedClassification.hasDescription,
            employee_count: record.enrichedClassification.employeeCount,
            // Derivado y explícito: la revisión manual necesita distinguir «el
            // enrichment resolvió la ausencia» de «tampoco trajo nada», y esa
            // diferencia no se lee de un vistazo sobre ocho campos.
            provider_classification_resolved: hasApolloSectorEvidenceBootstrapClassification(
              record.enrichedClassification,
            ),
          },
    post_enrichment_precision:
      record.postEnrichmentPrecision === null
        ? null
        : toApolloSubindustryPrecisionMetadata(record.postEnrichmentPrecision),
    post_enrichment_sector_state: record.postEnrichmentSectorState,
    // POST-ENRICHMENT-ADMISSION-1 § 20 — la traza que permite auditar «este
    // candidato cruzó el gate sectorial porque EPS, que se pidió, quedó confirmada
    // tras el enrichment». `post_enrichment_sector_state` de arriba es el estado
    // RESUELTO; `sector_admission.post_enrichment_sector_state` es el que había
    // antes de resolver, así que el cambio queda visible sin deducirlo.
    sector_admission:
      record.sectorAdmission === null
        ? null
        : {
            source: record.sectorAdmission.admissionSource,
            admitted_by_requested_subindustry_precision:
              record.sectorAdmission.admittedByRequestedSubindustryPrecision,
            matched_requested_subindustry: record.sectorAdmission.matchedRequestedSubindustry,
            operational_confirmation: toOperationalConfirmedRequestedSubindustryMetadata(
              record.sectorAdmission.operationalConfirmation,
            ),
            post_enrichment_sector_state: record.sectorAdmission.postEnrichmentSectorState,
            block_reason: record.sectorAdmission.blockReason,
          },
    terminal_disposition: record.terminalDisposition,
    terminal_reason: record.terminalReason,
  }));
}

// ─── Lectura del pack de revisión manual ──────────────────────────────────────

/**
 * Una fila del pack: un candidato × una subindustria PEDIDA.
 *
 * Una fila por candidato no bastaría — el juicio manual de Wave 1 es por
 * subindustria, y un candidato compite contra hasta cinco.
 */
export type ApolloSectorEvidenceBootstrapManualReviewRow = {
  candidateKey: string;
  company: string | null;
  domain: string | null;
  enrichmentExecuted: boolean;
  providerIndustry: string | null;
  /** ¿El perfil comprado trajo keywords o descripciones que juzgar? */
  keywordsOrDescriptionsAvailable: boolean;
  requestedSubindustry: string | null;
  /** Veredicto DIAGNÓSTICO de la regla: `confirmed` / `ambiguous` / `rejected`. */
  diagnosticVerdict: string | null;
  /** Código estable de por qué el veredicto es ése. */
  verdictReason: string | null;
  /**
   * `término@campo(fuente)`.
   *
   * Es la evidencia del ASSESSMENT, no de la subindustria de la fila: el
   * evaluador conserva las evaluaciones por etiqueta
   * (`perRequestedSubindustryEvaluations`) pero acumula la evidencia una sola vez,
   * así que se repite en cada fila del mismo candidato. Recortarla por etiqueta
   * aquí sería inventar una atribución que el evaluador no hizo.
   */
  evidence: string[];
  bootstrapReason: ApolloSectorEvidenceBootstrapCandidateReason;
  selectionRank: number | null;
  postEnrichmentSectorState: CandidateSectorEvidenceState | null;
  /**
   * POST-ENRICHMENT-ADMISSION-1 § 20 — por qué cruzó el gate sectorial.
   *
   * Sin esto, un revisor que ve `sector_evidence_confirmed` en una corrida SIN
   * política de sector no puede saber si lo confirmó una hija pedida o de dónde
   * salió. `null` cuando el candidato nunca llegó a la resolución de admisión.
   */
  sectorAdmissionSource: ApolloSectorAdmissionSource | null;
  /** La subindustria PEDIDA que produjo la admisión. `null` si no hubo. */
  admittedByRequestedSubindustry: string | null;
  /** SIEMPRE derivado de la disposición terminal, nunca supuesto. */
  persisted: boolean;
  terminalReason: string | null;
  /** Columna vacía a rellenar: TRUE_POSITIVE / FALSE_POSITIVE / UNCERTAIN. */
  manualDecision: null;
};

/**
 * Disposiciones que significan «esta candidata llegó al writer».
 *
 * Todo lo demás es no persistida. Se enumeran las positivas y no las negativas a
 * propósito: una disposición NUEVA debe leerse como no persistida hasta que
 * alguien la revise, nunca al revés.
 */
const PERSISTED_DISPOSITIONS: ReadonlySet<ApolloCandidateFinalDisposition> = new Set([
  'provisionally_persisted_pending_writer_final',
  'persisted_review_only_final',
]);

/**
 * El pack de revisión manual, sin tocar `prospect_candidates`.
 *
 * `candidateSnapshots` son los del checkpoint (`apollo_two_round_checkpoint`), y
 * aportan lo ÚNICO que el bloque de bootstrap no guarda: nombre y dominio. El
 * bloque no los duplica porque ya están ahí y porque su clave es la misma; que la
 * empresa se nombre en un solo sitio es lo que impide que los dos discrepen.
 */
export function toApolloSectorEvidenceBootstrapManualReviewRows(input: {
  audit: readonly ApolloSectorEvidenceBootstrapCandidateAudit[];
  candidateSnapshots: readonly ApolloTwoRoundCandidateSnapshot[];
}): ApolloSectorEvidenceBootstrapManualReviewRow[] {
  const snapshotByKey = new Map(
    input.candidateSnapshots.map((snapshot) => [snapshot.candidate_key, snapshot]),
  );

  return input.audit.flatMap((record): ApolloSectorEvidenceBootstrapManualReviewRow[] => {
    const snapshot = snapshotByKey.get(record.candidateKey) ?? null;
    const classification = record.enrichedClassification;
    const base = {
      candidateKey: record.candidateKey,
      company: snapshot?.evidence?.title ?? snapshot?.normalized_name ?? null,
      domain: snapshot?.evidence?.domain ?? snapshot?.normalized_domain ?? null,
      enrichmentExecuted: record.enrichmentExecuted,
      providerIndustry: classification?.industry ?? null,
      keywordsOrDescriptionsAvailable:
        classification !== null &&
        (classification.keywords.length > 0 ||
          classification.organizationKeywords.length > 0 ||
          classification.hasShortDescription ||
          classification.hasSeoDescription ||
          classification.hasDescription),
      bootstrapReason: record.bootstrapReason,
      selectionRank: record.selectionRank,
      postEnrichmentSectorState: record.postEnrichmentSectorState,
      sectorAdmissionSource: record.sectorAdmission?.admissionSource ?? null,
      // Sólo se nombra la hija cuando ELLA produjo la admisión. Con política legacy
      // la etiqueta existe igual y atribuirle el pase sería falso.
      admittedByRequestedSubindustry:
        record.sectorAdmission?.admittedByRequestedSubindustryPrecision === true
          ? record.sectorAdmission.matchedRequestedSubindustry
          : null,
      persisted:
        record.terminalDisposition !== null &&
        PERSISTED_DISPOSITIONS.has(record.terminalDisposition),
      terminalReason: record.terminalReason,
      manualDecision: null,
    } as const;

    const precision = record.postEnrichmentPrecision;
    const evidence = (precision?.subindustryEvidence ?? []).map(
      (item) => `${item.term}@${item.field}(${item.source})`,
    );

    const evaluations = precision?.perRequestedSubindustryEvaluations ?? [];
    if (evaluations.length === 0) {
      // Sin evaluaciones no se inventa una fila por subindustria: el candidato
      // existe y su ausencia de juicio es en sí el dato.
      return [
        {
          ...base,
          requestedSubindustry: null,
          diagnosticVerdict: null,
          verdictReason: null,
          evidence,
        },
      ];
    }

    return evaluations.map((evaluation) => ({
      ...base,
      requestedSubindustry: evaluation.requestedSubindustry,
      diagnosticVerdict: evaluation.subindustryMatch,
      verdictReason: evaluation.verdictReason,
      evidence,
    }));
  });
}
