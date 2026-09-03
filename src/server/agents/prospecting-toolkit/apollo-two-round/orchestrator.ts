/**
 * orchestrator.ts — Ejecución adaptativa de dos rondas con objetivo de cinco
 * empresas únicas y elegibles.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 4, § 7, § 8, § 9.
 *
 * Orden por ronda, y ninguna operación pagada ocurre antes de terminarlo:
 *
 *   normalización
 *   → dedup dentro de la respuesta
 *   → dedup contra rondas anteriores
 *   → dominio válido
 *   → compatibilidad geográfica
 *   → plataforma externa
 *   → identidad y ownership preliminar
 *   → duplicado en SellUp
 *   → duplicado en HubSpot
 *   → cooldown e historial de sugerencias
 *   → sector mapeado
 *   → evidencia sectorial contradictoria
 *   → ranking para enrichment
 *
 * Parada: en cuanto se acumulan `targetEligibleCompanies` únicas y elegibles, la
 * corrida se detiene. Una segunda ronda presupuestada NO se ejecuta sólo por
 * estar presupuestada.
 *
 * Puro y por inyección de dependencias: el proveedor, los gates y el enrichment
 * entran como funciones. Ninguna línea de este archivo llama a Apollo, lee env,
 * toca Supabase ni mira el reloj — por eso la suite completa corre sin una sola
 * llamada real ni un crédito gastado.
 */

import type { ApolloTwoRoundDiscoveryConfig } from './config';
// CUT-2 §§ 4, 6 — la cota de demanda residual, en su único sitio.
import { boundByRemainingTarget } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import {
  createSeenOrganizationRegistry,
  evaluateSeenOrganization,
  registerSeenOrganization,
  countSeenOrganizations,
  type NormalizedOrganizationIdentity,
  type OrganizationIdentityInput,
  type SeenOrganizationRegistry,
} from './seen-registry';
import {
  buildRound1Hypothesis,
  buildRound2Hypothesis,
  findSharedEffectiveKeywords,
  withRequestedPage,
  type ApolloRound2Hypothesis,
  type ApolloTwoRoundQueryContext,
  type ApolloTwoRoundQueryHypothesis,
} from './query-hypothesis';
import {
  selectCandidatesForEnrichment,
  rankFinalEligibleCompanies,
  type CandidateSectorEvidenceState,
  type EnrichmentSelection,
  type EnrichmentSkip,
  type FinalRankingSignals,
  type FreeCandidateSignals,
} from './enrichment-ranking';
import {
  buildEmptyRoundMetrics,
  buildRunMetrics,
  type ApolloEffectiveRequestBuildStatus,
  type ApolloRound2PageDecision,
  type ApolloRound2PageEscalationReason,
  type ApolloRoundSubindustryCoverage,
  type ApolloTwoRoundRoundMetrics,
  type ApolloTwoRoundRunMetrics,
  type EnrichmentOutcome,
} from './observability';
import {
  buildApolloTwoRoundOperationContext,
  buildApolloTwoRoundEnrichmentSubject,
  ApolloTwoRoundOperationLedger,
  type ApolloTwoRoundOperationContext,
  type ApolloTwoRoundRunCorrelation,
} from './idempotency';
import {
  evaluateCandidateTargetEligibility,
  type CandidateTargetCondition,
  type CandidateTargetEligibility,
  type GateVerdict,
  type SubindustryMatchVerdict,
} from '../candidate-completeness-contract';
import type { CompanyFieldMappingStatus } from '../apollo-company-fields-mapping';
import {
  EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
  resolveApolloNextNetNewPage,
  withApolloSearchPlanPageConsumption,
  type ApolloSearchPlanPageConsumption,
  type ApolloSearchPlanPageCursors,
} from './net-new-page-cursor';

// ─── Entrada del proveedor ────────────────────────────────────────────────────

/**
 * Organización cruda tal como llega de la búsqueda, reducida a lo que el
 * orquestador necesita. El adaptador de producción la construye desde la
 * respuesta normalizada de Apollo.
 */
export type RawDiscoveredOrganization = OrganizationIdentityInput & {
  /** Posición en la respuesta del proveedor (1-indexed). Desempate estable. */
  providerRank: number;
  /** Industria que el proveedor DECLARA. Puede faltar. */
  declaredIndustry?: string | null;
};

export type RoundSearchOutcome = {
  organizations: readonly RawDiscoveredOrganization[];
  /** Llamadas emitidas al proveedor. Normalmente 1 por ronda. */
  providerRequestCount: number;
  /** Créditos que NUESTRO ledger registró para esta búsqueda. */
  internalRecordedCredits: number;
  /**
   * QUERY-QUALITY-2 § 3 — `total_pages` que el proveedor declaró.
   *
   * Es lo que autoriza a la ronda 2 a pedir la página 2 cuando no existe una
   * variante de términos. Ausente ⇒ null: sin declaración del proveedor no se
   * pide una página que puede no existir.
   */
  providerTotalPages?: number | null;
  /**
   * § 4 del FINAL-FIX — la petición SALIÓ y su resultado o su cobro quedaron sin
   * confirmar (timeout, corte de red, 5xx, respuesta ambigua). La operación no se
   * reintenta y las que dependen de ella no se ejecutan.
   */
  indeterminate?: boolean;
  /**
   * A1-APOLLO-NET-NEW-PAGINATION-V2 — qué páginas dejó consumidas esta búsqueda,
   * y de QUÉ plan de búsqueda (`search_plan_fingerprint`, el body efectivo SIN
   * `page`).
   *
   * Es lo que permite que la ronda siguiente del MISMO plan arranque en la
   * primera página que ese plan todavía no ha pedido, en vez de en un literal.
   * Ausente o `null` ⇒ la búsqueda no informó desenlaces por página y el cursor
   * no inventa ninguno: se conserva el comportamiento previo al corte.
   */
  consumedPages?: ApolloSearchPlanPageConsumption | null;
};

// ─── Evaluación barata ────────────────────────────────────────────────────────

/**
 * Motivo por el que un candidato se descartó ANTES de cualquier gasto.
 * Todos valen cero llamadas y cero créditos.
 */
export type CheapRejectionReason =
  | 'duplicate_within_response'
  | 'seen_in_previous_round'
  | 'invalid_domain'
  | 'country_incompatible'
  | 'external_platform_domain'
  | 'ownership_mismatch'
  | 'duplicate_in_sellup'
  | 'duplicate_in_hubspot'
  | 'cooldown_or_prior_suggestion'
  | 'sector_not_mapped'
  | 'sector_evidence_contradictory'
  | 'raw_result_cap_reached';

/**
 * Veredicto de los gates baratos sobre un candidato. Lo produce una dependencia
 * inyectada: los gates reales viven en `apollo-enrichment-eligibility-gate` y
 * `apollo-sector-relevance-gate`, y el orquestador no los reimplementa.
 */
export type CheapAssessment = {
  /** null cuando el candidato superó todos los gates baratos. */
  rejection: CheapRejectionReason | null;
  sectorEvidenceState: CandidateSectorEvidenceState;
  /** Señales gratuitas para el ranking. Sin claves: las pone el orquestador. */
  signals: Omit<
    FreeCandidateSignals,
    'candidateKey' | 'roundNumber' | 'providerRank' | 'sectorEvidenceState'
  >;
  /** El candidato no había sido sugerido antes en el mismo contexto. */
  noPriorSuggestion: boolean;
};

/** Resultado de un enrichment ya ejecutado, re-evaluado por los mismos gates. */
export type EnrichmentResult = {
  executed: boolean;
  /** Veredicto sectorial DESPUÉS del enrichment. */
  sectorEvidenceState: CandidateSectorEvidenceState;
  /** Créditos que nuestro ledger registró por esta llamada. */
  internalRecordedCredits: number;
  /** Un rechazo que sólo se pudo ver con el perfil enriquecido. */
  postEnrichmentRejection?: CheapRejectionReason | null;
  /** § 4 del FINAL-FIX — cobro sin confirmar. Detiene los enrichments restantes. */
  indeterminate?: boolean;
  /** El proveedor respondió sin organización coincidente. Ni cargo ni evidencia. */
  noMatch?: boolean;
  /**
   * STABLE-TARGET-WRITER-PARITY § 5 — estado de los campos OBLIGATORIOS después
   * del enrichment, leído de la MISMA captura que verá el writer
   * (`providerCompanyFields`).
   *
   * Es lo que cierra el ciclo del § 5: un enrichment se compra porque falta
   * `employee_count` o `linkedin_url`, y hasta este hito el orquestador nunca se
   * enteraba de si lo había resuelto —las señales gratuitas venían de la
   * búsqueda y no se volvían a tocar—. Sin esto, un candidato al que el
   * enrichment SÍ le resolvió el campo seguiría sin poder contar hacia el
   * objetivo, y la corrida gastaría los enrichments restantes para nada.
   *
   * Ausente ⇒ el enrichment no informó nada y las señales previas se conservan.
   * Nunca se asume que un campo se resolvió por el hecho de haber pagado.
   */
  providerCompanyFields?: {
    employeeCountStatus: CompanyFieldMappingStatus;
    linkedinStatus: CompanyFieldMappingStatus;
  } | null;
};

// ─── STABLE-TARGET-WRITER-PARITY § 1/§ 2 — condiciones del contrato canónico ───

/**
 * Veredicto de CADA condición del contrato de completitud
 * (`candidate-completeness-contract.ts`) para UN candidato, tal como lo evaluará
 * el writer, y la lista de las que todavía no se pueden saber.
 *
 * Existe para que el orquestador no tenga una segunda semántica de objetivo. Su
 * `stableFinalizableCandidateCount()` no reimplementa nada: rellena esta
 * estructura y se la pasa a `evaluateCandidateTargetEligibility`, la misma
 * función que decide `complete_valid` y `counts_toward_target` en el writer.
 *
 * `persistenceSuccess` NO viaja aquí a propósito: es la única condición que un
 * consumidor pre-writer no puede evaluar ni tiene por qué, y por eso la decisión
 * pre-writer se lee de `countsTowardTargetIfPersisted` (§ 10).
 */
export type ApolloTwoRoundCandidateTargetConditions = {
  subindustryMatch: SubindustryMatchVerdict;
  employeeCountStatus: CompanyFieldMappingStatus;
  linkedinStatus: CompanyFieldMappingStatus;
  /** Valor tal como se persistiría en `prospect_candidates.duplicate_status`. */
  duplicateStatus: string | null;
  ownershipGate: GateVerdict;
  qualityGate: GateVerdict;
  /**
   * § 2 — condiciones que ni el orquestador ni su adaptador pueden resolver
   * antes de que el writer corra. Fail-closed: una pendiente impide contar.
   */
  pendingConditions?: readonly CandidateTargetCondition[];
  /**
   * WRITER-ONLY-ADMISSION-PENDING § 2 — comprobaciones de ADMISIÓN del writer
   * que este adaptador declara SIN resolver.
   *
   * No son condiciones del contrato (ver `CandidateTargetEligibilityInput`), pero
   * tienen el mismo efecto: mientras haya una, el candidato no puede sostener una
   * parada por objetivo. Ausente ⇒ el adaptador afirma haberlas resuelto todas;
   * es el caso de las suites puras, que no tienen writer al que ganarle.
   */
  unresolvedWriterOnlyAdmissionChecks?: readonly string[];
  /**
   * ADAPTIVE-EARLY-STOP § 6 — comprobaciones de admisión que el adaptador SÍ
   * resolvió y que salieron NEGATIVAS. Bloquean igual que una pendiente, pero no
   * son una pendiente: hay respuesta, y es que no pasa.
   */
  failedWriterOnlyAdmissionChecks?: readonly string[];
  /**
   * § 11 — comprobaciones resueltas y APROBADAS. Sólo observabilidad: no
   * participan de ninguna decisión, y por eso el contrato canónico ni las mira.
   */
  resolvedWriterOnlyAdmissionChecks?: readonly string[];
};

// ─── Dependencias ─────────────────────────────────────────────────────────────

/**
 * QUERY-QUALITY-2-FIX § 1 y § 2 — el request EFECTIVO de una ronda, construido sin
 * ejecutarla.
 *
 * Lo produce el mismo constructor que gobierna la llamada real
 * (`buildApolloOrganizationsEffectiveRequest`), así que la huella que aquí se
 * compara es literalmente la del body que saldría. No es una reimplementación del
 * mapper: es el mapper, invocado antes de pagar.
 */
export type RoundProviderRequestPreview = {
  /** Huella del body efectivo, `page` incluida. Base de la decisión económica. */
  effectiveRequestFingerprint: string;
  /**
   * A1-APOLLO-NET-NEW-PAGINATION-V2 — huella del body efectivo SIN `page`
   * (`filtersFingerprint` del contrato). Identifica el PLAN de búsqueda, que es
   * la unidad lógica del universo de páginas: la página 1 y la 2 del mismo plan
   * la comparten, y por eso `effectiveRequestFingerprint` no sirve para esto.
   *
   * Opcional para no romper las suites puras que inyectan un preview simulado;
   * ausente ⇒ no hay cursor por plan y rige el comportamiento previo al corte.
   */
  searchPlanFingerprint?: string | null;
  page: number;
  perPage: number;
  /** Términos que sobrevivieron a la prioridad, la dedupe y el truncamiento. */
  effectiveKeywordTags: readonly string[];
  /**
   * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 §§ 6 y 7 — cobertura del body
   * efectivo de esta ronda sobre las subindustrias pedidas.
   *
   * Viaja en el PREVIEW, es decir antes de pagar, porque es lo que decide si la
   * ronda se emite: una consulta que no representa a todo lo seleccionado no se
   * cobra (§ 7). Opcional para no romper las suites puras que inyectan un preview
   * simulado; ausente ⇒ el gate no bloquea y la cobertura se reporta `null`.
   */
  subindustryCoverage?: ApolloRoundSubindustryCoverage | null;
  /** § 7 — código estático del bloqueo. Non-null ⇒ la ronda NO se ejecuta. */
  subindustryCoverageBlockReason?: string | null;
};

/**
 * HARDENING-3 § 4 — resultado de intentar construir el request efectivo de una
 * ronda, con la causa cuando no se pudo.
 *
 * Sustituye al `preview | null` anterior: un null sin causa hacía indistinguibles
 * "no hay constructor", "el constructor lanzó" y "el checkpoint es antiguo", y las
 * tres tenían el mismo efecto silencioso — caer a la huella de hipótesis y
 * autorizar una segunda llamada pagada cuya diversidad nadie había probado.
 */
export type RoundEffectiveRequestBuild = {
  status: ApolloEffectiveRequestBuildStatus;
  /** Non-null si y sólo si `status === 'success'`. */
  preview: RoundProviderRequestPreview | null;
  /** Código sanitizado. Non-null sólo en `build_error`. */
  errorCode: string | null;
};

export type ApolloTwoRoundDeps = {
  /**
   * § 2 — construye el request efectivo de una ronda SIN emitir la llamada.
   *
   * Ausente ⇒ la ronda 2 NO se ejecuta (§ 3 del HARDENING-3): sin body efectivo no
   * hay prueba de que una segunda búsqueda pueda traer algo nuevo, y la huella de
   * hipótesis no sirve para autorizar gasto. Las suites puras que necesiten dos
   * rondas deben inyectar una dependencia simulada EXPLÍCITA; producción la exige
   * por tipo y en runtime (`createApolloTwoRoundProductionOrchestratorDeps`).
   */
  buildRoundProviderRequest?: (input: {
    roundNumber: number;
    hypothesis: ApolloTwoRoundQueryHypothesis;
    requestedResultLimit: number;
  }) => RoundProviderRequestPreview | null;

  /**
   * Ejecuta UNA búsqueda de una ronda. Nunca se llama dos veces por ronda.
   *
   * Recibe el contexto de operación COMPLETO —ronda, operación y sujeto— porque es
   * el adaptador quien escribe la fila económica y necesita los tres para poder
   * distinguir esta búsqueda de la de la otra ronda.
   */
  searchRound: (input: {
    roundNumber: number;
    hypothesis: ApolloTwoRoundQueryHypothesis;
    requestedResultLimit: number;
    operationContext: ApolloTwoRoundOperationContext;
  }) => Promise<RoundSearchOutcome>;

  /** Aplica los gates baratos. No puede llamar al proveedor ni gastar créditos. */
  assessCandidate: (input: {
    organization: RawDiscoveredOrganization;
    identity: NormalizedOrganizationIdentity;
    roundNumber: number;
  }) => Promise<CheapAssessment> | CheapAssessment;

  /** Ejecuta UN Organization Enrichment. Sólo se llama bajo el cap global. */
  enrichCandidate: (input: {
    candidateKey: string;
    roundNumber: number;
    operationContext: ApolloTwoRoundOperationContext;
    identity: NormalizedOrganizationIdentity;
  }) => Promise<EnrichmentResult>;

  /**
   * § 3 del FINAL-FIX — persiste el estado tras CADA transición recuperable.
   *
   * Debe resolver a `true` sólo cuando el estado quedó durablemente escrito. Un
   * `false` (o un throw) hace que la operación que acaba de ejecutarse se degrade
   * a INDETERMINADA en vez de quedar como completada: una operación cuyo
   * resultado no se puede recuperar no es una operación completada.
   *
   * Ausente ⇒ el orquestador corre sin durabilidad. Es lo que hacen las suites
   * puras que sólo ejercitan la lógica de rondas; producción siempre la inyecta.
   */
  saveCheckpoint?: (
    checkpoint: ApolloTwoRoundCheckpointSnapshot,
  ) => Promise<boolean> | boolean;

  /**
   * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 5 — gates FINALES, después de la
   * reevaluación sectorial y antes de declarar elegible a nadie.
   *
   * Existe porque el orden estaba roto por abajo. El gate de ownership del writer
   * corre DESPUÉS de que el orquestador haya contado sus elegibles, así que en la
   * corrida `be181d2d` una empresa entró en `run_metrics.persisted_candidates` y
   * el writer la descartó a continuación: la métrica decía 3 y las filas eran 2.
   * Un rechazo que el orquestador puede conocer tiene que conocerlo ANTES de
   * contar, no después de publicar.
   *
   * Gratis por contrato: sin llamadas al proveedor y sin créditos. Sólo re-aplica
   * criterios puros sobre el candidato ya construido.
   *
   * Ausente ⇒ no se aplica ningún gate final; es lo que hacen las suites puras
   * que sólo ejercitan la lógica de rondas. Producción la inyecta siempre.
   */
  applyFinalGates?: (input: {
    candidateKey: string;
    roundNumber: number;
    identity: NormalizedOrganizationIdentity;
  }) => Promise<{ rejection: CheapRejectionReason | null }> | { rejection: CheapRejectionReason | null };

  /**
   * STABLE-TARGET-WRITER-PARITY § 1 — veredicto del contrato canónico para UN
   * candidato, con los MISMOS datos que leerá el writer.
   *
   * Es libre de créditos y de llamadas por contrato: sólo lee lo que la corrida
   * ya construyó (`providerCompanyFields`, la precisión de subindustria, el
   * veredicto de duplicidad y los gates puros del writer).
   *
   * Se invoca de nuevo después de cada enrichment, porque el enrichment es
   * exactamente lo que puede cambiar el veredicto: por eso NO se cachea como
   * `applyFinalGates`, cuyo rechazo sí es definitivo.
   *
   * Ausente ⇒ el orquestador deriva las condiciones de sus propias señales
   * gratuitas (país/ownership/duplicidad de los gates baratos, `employee_count`
   * y LinkedIn de la respuesta del proveedor, subindustria del veredicto
   * sectorial). Es lo que hacen las suites puras; producción la inyecta siempre,
   * porque sólo el adaptador conoce la precisión de subindustria sin catálogo y
   * los gates del writer.
   */
  readCandidateTargetConditions?: (input: {
    candidateKey: string;
    roundNumber: number;
    identity: NormalizedOrganizationIdentity;
    sectorEvidenceState: CandidateSectorEvidenceState;
  }) =>
    | Promise<ApolloTwoRoundCandidateTargetConditions>
    | ApolloTwoRoundCandidateTargetConditions;
};

/**
 * HARDENING-3 § 6 — dependencias de la ruta de PRODUCCIÓN: el constructor del
 * request efectivo es OBLIGATORIO.
 *
 * En `ApolloTwoRoundDeps` sigue siendo opcional porque las suites puras y los
 * consumidores legacy no atraviesan la capa de producción. Pero producción no puede
 * ni compilar ni ejecutar dos rondas sin él: una corrida real que decidiera la
 * ronda 2 sin body efectivo estaría autorizando un cargo sobre una diversidad no
 * demostrada.
 */
export type ApolloTwoRoundProductionOrchestratorDeps = ApolloTwoRoundDeps &
  Required<Pick<ApolloTwoRoundDeps, 'buildRoundProviderRequest'>>;

/** Error que levanta la factory cuando falta el constructor efectivo. */
export const APOLLO_TWO_ROUND_PRODUCTION_BUILDER_REQUIRED =
  'apollo_two_round_production_requires_effective_request_builder' as const;

/**
 * § 6 — puerta única de la ruta de producción.
 *
 * El tipo ya lo exige en compilación; esto lo exige además en runtime, para que un
 * objeto construido dinámicamente (o un `as` de conveniencia) no pueda colarse.
 * Falla ruidoso ANTES de emitir una sola llamada: cero créditos gastados.
 */
export function createApolloTwoRoundProductionOrchestratorDeps(
  deps: ApolloTwoRoundProductionOrchestratorDeps,
): ApolloTwoRoundProductionOrchestratorDeps {
  if (typeof deps.buildRoundProviderRequest !== 'function') {
    throw new Error(APOLLO_TWO_ROUND_PRODUCTION_BUILDER_REQUIRED);
  }
  return deps;
}

/**
 * Lo que el orquestador entrega en cada checkpoint.
 *
 * El ledger viaja DENTRO del snapshot a propósito: el escritor lo persiste en la
 * misma escritura que el resto del estado, así que "operación completada" y "su
 * resultado es recuperable" no pueden quedar en documentos distintos.
 */
export type ApolloTwoRoundCheckpointSnapshot = {
  reason: ApolloTwoRoundCheckpointTrigger;
  resume: ApolloTwoRoundResumeState;
  /** Operación que provocó el checkpoint. Null en los de fase. */
  operationContext: ApolloTwoRoundOperationContext | null;
};

export type ApolloTwoRoundCheckpointTrigger =
  | 'search_round_completed'
  | 'search_round_indeterminate'
  | 'round_assessment_completed'
  | 'enrichment_completed'
  | 'enrichment_indeterminate'
  | 'run_completed';

// ─── Salida ───────────────────────────────────────────────────────────────────

export type ApolloTwoRoundResultStatus =
  | 'target_reached'
  | 'partial_target_not_reached'
  /**
   * § 4 del FINAL-FIX — al menos una operación quedó con cobro sin confirmar.
   * Gana sobre los otros dos estados: una corrida que alcanzó el objetivo pero
   * dejó una operación indeterminada NO puede reportarse como cerrada.
   */
  | 'apollo_operation_indeterminate';

/** Operación cuyo resultado o cobro no se pudo confirmar. */
export type ApolloTwoRoundIndeterminateOperation = {
  roundNumber: number;
  operationKey: 'organizations_search' | 'organization_enrichment';
  subject: string;
  operationId: string;
  /** Por qué quedó indeterminada. Vocabulario estático. */
  reason: 'provider_outcome_unknown' | 'checkpoint_not_durable';
};

/** Por qué no se ejecutó la segunda ronda. Null cuando sí se ejecutó. */
export type SecondRoundSkippedReason =
  | 'target_reached'
  | 'max_rounds_is_one'
  | 'raw_result_cap_reached'
  /**
   * MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § C — la corrida ya escribió sus
   * candidatos. Un reintento posterior no abre una ronda nueva: recupera lo
   * pagado, no compra más.
   */
  | 'candidates_already_persisted'
  /**
   * QUERY-QUALITY-2 § 3 — los parámetros normalizados que la ronda 2 enviaría
   * son los MISMOS que envió la ronda 1. Vocabulario del hito.
   */
  | 'identical_provider_request'
  /**
   * HARDENING-3 § 3 — una de las dos huellas EFECTIVAS no se pudo construir (no hay
   * constructor, o lanzó, o no devolvió nada).
   *
   * Es fail-closed a propósito: sin las dos huellas no se puede demostrar que la
   * ronda 2 pediría algo distinto, y una diversidad no demostrada no autoriza un
   * segundo cargo. NO se sustituye por «las hipótesis difieren»: esa comparación es
   * exactamente la que dejó pasar la ronda 2 pagada del QA `edb6f40c`.
   */
  | 'effective_request_fingerprint_unavailable'
  /**
   * HARDENING-3 § 5 — la ronda 1 se rehidrató de un checkpoint escrito antes de que
   * la huella efectiva existiera.
   *
   * La ronda 1 y su gasto se conservan intactos; lo único que se prohíbe es una
   * ronda 2 nueva. El campo NO se rellena con la huella de hipótesis, ni se emite
   * una llamada para «reconstruirlo»: eso sería pagar por un dato de auditoría.
   */
  | 'legacy_checkpoint_missing_effective_fingerprint'
  /**
   * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 7 — el body efectivo de la ronda no
   * representaba a todas las subindustrias pedidas.
   *
   * Fail-closed: la ronda no se emite y no consume créditos. No es un
   * «no había variante»: es que la consulta que se iba a pagar omitía un criterio
   * que el usuario eligió.
   */
  | 'subindustry_query_coverage_incomplete'
  /**
   * Código heredado del hito anterior. Se conserva SÓLO para poder rehidratar un
   * checkpoint escrito antes de este cambio; ninguna corrida nueva lo emite.
   */
  | 'round2_hypothesis_identical_to_round1'
  /**
   * A1-APOLLO-NET-NEW-PAGINATION-V2 § 1 — la única página que la ronda 2 podría
   * pedir de este PLAN de búsqueda ya la consumió una ronda anterior, y el
   * proveedor no declara ninguna posterior.
   *
   * Fail-closed y a favor del dinero: sin páginas nuevas que pedir, ejecutar la
   * ronda 2 sería volver a comprar exactamente lo que la ronda 1 acaba de pagar.
   * No es «no había variante»: la variante existía y era otra página, pero ese
   * plan ya se recorrió entero.
   */
  | 'net_new_pages_exhausted';

export type AccumulatedCompany = {
  candidateKey: string;
  roundNumber: number;
  providerRank: number;
  identity: NormalizedOrganizationIdentity;
  sectorEvidenceState: CandidateSectorEvidenceState;
  /** True cuando llegó a elegible sólo después de un enrichment pagado. */
  becameEligibleAfterEnrichment: boolean;
};

/**
 * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § D — por qué una empresa se
 * persiste SÓLO para revisión.
 *
 * Hoy hay una sola causa, y tiene nombre propio en vez de un booleano: cuando
 * aparezca la segunda, el consumidor no tendrá que adivinar cuál de las dos leyó.
 */
export type ReviewOnlyCompanyReason =
  /** Se pagó su enrichment y la subindustria siguió sin poder demostrarse. */
  'subindustry_ambiguous_after_enrichment';

export type ReviewOnlyCompany = AccumulatedCompany & {
  reviewReason: ReviewOnlyCompanyReason;
};

export type ApolloTwoRoundRunResult = {
  resultStatus: ApolloTwoRoundResultStatus;
  /**
   * El objetivo que GOBERNÓ la corrida.
   *
   * 🔴 CUT-2 § 6 — con demanda residual aplicada es el objetivo RECORTADO, no el
   * configurado. Reportar aquí el de la config diría que la corrida buscaba cinco
   * empresas cuando en realidad se paró en tres, y quien leyera el resultado
   * diagnosticaría un fallo de recall donde hubo un objetivo cumplido.
   */
  targetEligibleCompanies: number;
  /** CUT-2 § 6 — el techo de la config, sin recortar. Diagnóstico. */
  configuredTargetEligibleCompanies: number;
  /**
   * CUT-2 §§ 4, 6 — el hueco que la capa gratuita dejó abierto, si lo hubo.
   * `null` ⇒ no hubo capa previa y el objetivo configurado gobernó entero.
   */
  remainingTargetApplied: number | null;
  eligibleCompaniesFound: number;
  /**
   * STABLE-TARGET-WRITER-PARITY § 3 — candidatos que cumplen TODAS las
   * condiciones del contrato canónico salvo la persistencia, que todavía no ha
   * ocurrido.
   *
   * Es la única cifra que detiene gasto y la única comparable con el objetivo
   * antes del writer. NO es `eligibleCompaniesFound`: un elegible con
   * `employee_count` ausente, LinkedIn ausente, subindustria ambigua o cualquier
   * condición pendiente se persiste como `needs_review` y no cuenta.
   */
  stableFinalizableCandidateCount: number;
  /**
   * WRITER-ONLY-ADMISSION-PENDING § 3 — candidatos a los que sólo les faltan las
   * admisiones que el writer resuelve (`active_duplicate_guard`, `novelty_index`,
   * cooldown de identidad, dedupe intra-lote, cupo del lote).
   *
   * OBSERVABILIDAD ÚNICAMENTE. Es siempre `>= stableFinalizableCandidateCount` y
   * NUNCA puede emitir `target_already_reached`: si pudiera, el defecto que este
   * addendum cierra volvería con otro nombre.
   */
  projectedFinalizableCandidateCount: number;
  /** § 8 — `projected - stable`: cuántos están bloqueados SÓLO por writer-only. */
  writerOnlyPendingCount: number;
  /** § 8 — nombres de las admisiones writer-only observadas sin resolver. */
  writerOnlyPendingReasons: string[];
  /**
   * ADAPTIVE-EARLY-STOP § 11 — comprobaciones de admisión PRE-writer agregadas
   * sobre los candidatos elegibles, en tres cubetas mutuamente excluyentes.
   *
   * OBSERVABILIDAD ÚNICAMENTE. Ninguna de las tres decide nada: la decisión la
   * toma `stableFinalizableCandidateCount`, que ya incorpora su efecto.
   */
  preWriterAdmissionPassCount: number;
  preWriterAdmissionFailedCount: number;
  preWriterAdmissionPendingCount: number;
  /** § 11 — `max(0, target - stableFinalizableCandidateCount)`, PRE-writer. */
  projectedTargetGap: number;
  persistedCandidates: number;
  roundsExecuted: number;
  /**
   * § 11 — proyección PRE-writer: `stableFinalizableCandidateCount >= target`.
   * La cifra autoritativa la emite la reconciliación posterior al writer
   * (`reconcileApolloTwoRoundPersistedTruth`), que sí sabe cuántas filas hay.
   */
  targetReached: boolean;
  /** Código estático cuando el objetivo no se alcanzó. Null cuando sí. */
  partialResultReason: 'partial_target_not_reached' | null;
  secondRoundSkippedReason: SecondRoundSkippedReason | null;
  /**
   * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 7 — código estático cuando la
   * corrida se detuvo porque ninguna consulta cubría todas las subindustrias
   * pedidas. `null` en una corrida normal. Con valor, los créditos gastados en
   * búsquedas son CERO.
   */
  queryCoverageBlockReason: string | null;
  /**
   * HARDENING-3 § 7 — resultado de la comparación de huellas EFECTIVAS.
   *
   * `true` ⇒ la ronda 2 pedía algo distinto y se ejecutó. `false` ⇒ pedía lo mismo
   * (`identical_provider_request`). `null` ⇒ la comparación no se pudo hacer: no se
   * llegó a ella, o una de las dos huellas no estaba disponible. Nunca `false` para
   * un valor desconocido.
   */
  effectiveFingerprintsAreDistinct: boolean | null;
  /**
   * SCALE-SECOND-ROUND-FIX-1B § 1 — decisión de página de la ronda 2 tomada en
   * ESTE intento, con su causa.
   *
   * `null` cuando nadie la tomó: la ronda 2 no llegó a construirse, o se recuperó
   * de un checkpoint anterior. Ausencia no es «se decidió la página 1».
   */
  round2PageDecision: ApolloRound2PageDecision | null;

  /** Empresas que se persisten, en orden de calidad. */
  persisted: AccumulatedCompany[];
  /**
   * § D — empresas que TAMBIÉN se persisten, pero como `needs_review`, y que NO
   * cuentan hacia el objetivo.
   *
   * Son las que pagaron un enrichment y siguieron ambiguas: hay evidencia
   * suficiente para que valga la pena mirarlas, e insuficiente para afirmar que
   * pertenecen a la subindustria pedida. Nunca incluye a una empresa con rechazo
   * definitivo — ownership, país, duplicidad, sector contradictorio o calidad —,
   * porque un rechazo con causa no es una duda.
   */
  reviewOnly: ReviewOnlyCompany[];
  /** Elegibles que el tope dejó fuera. Sus métricas NO se pierden (§ 9). */
  notPersisted: Array<AccumulatedCompany & { reason: 'eligible_not_persisted_due_to_target_cap' }>;

  rounds: ApolloTwoRoundRoundMetrics[];
  runMetrics: ApolloTwoRoundRunMetrics;

  enrichmentSelections: EnrichmentSelection[];
  enrichmentSkips: EnrichmentSkip[];
  /** Claves de operación completadas. Un reintento las reconoce y no repite. */
  completedOperationKeys: string[];
  /**
   * Claves de operación INDETERMINADAS. Un reintento tampoco las repite —
   * repetirlas podría duplicar un cargo— y la corrida exige conciliación manual.
   */
  indeterminateOperationKeys: string[];
  /** Detalle de cada operación indeterminada, para la conciliación manual. */
  indeterminateOperations: ApolloTwoRoundIndeterminateOperation[];
  /** § 4 — la corrida no puede declararse conciliada de forma automática. */
  manualReconciliationRequired: boolean;
  /** Checkpoints que no se pudieron persistir. Vacío en una corrida sana. */
  checkpointWriteFailures: ApolloTwoRoundCheckpointTrigger[];
  /**
   * TODOS los candidatos evaluados —elegibles y rechazados— con su motivo. Es lo
   * que un reintento necesita para no volver a partir de cero (§ 7).
   */
  evaluatedCandidates: ResumedCandidate[];
  /** Motivos de rechazo observados. Alimentan la adaptación de la ronda 2. */
  observedRejectionReasons: CheapRejectionReason[];
};

export type ApolloTwoRoundRunInput = {
  config: ApolloTwoRoundDiscoveryConfig;
  queryContext: ApolloTwoRoundQueryContext;
  correlation: ApolloTwoRoundRunCorrelation;
  /**
   * Claves de operación que un intento anterior ya completó. Permite que un
   * reintento con el mismo `idempotencyKey` salte lo ya hecho en vez de
   * repetirlo (§ 12).
   */
  completedOperationKeys?: readonly string[];
  /**
   * Estado recuperado de un intento anterior (§ 7).
   *
   * Sin él, un reintento que salta la búsqueda de la ronda 1 por clave de
   * operación trataría esa ronda como si hubiera devuelto CERO candidatos, y la
   * corrida terminaría vacía a pesar de haber pagado. Con él, el reintento
   * recupera lo que la ronda ya produjo y sólo ejecuta lo que falta.
   */
  resume?: ApolloTwoRoundResumeState | null;
  /**
   * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 4, 6, 7 — lo que esta corrida debe
   * buscar DE VERDAD, después de descontar lo que la capa gratuita ya cerró.
   *
   * `null`/ausente ⇒ no hubo capa previa y gobierna `config.targetEligibleCompanies`
   * entero, que es el comportamiento anterior a este corte, byte por byte.
   *
   * 🔴 Recorta la DEMANDA de resultados, jamás la reserva financiera (§ 5). La
   * reserva la fija `estimateApolloTwoRoundBudget(config)`, que se deriva de
   * `maxResultsPerRound × maxRounds` y del cap de enrichment y NO recibe este
   * número — el ratchet estático del corte lo defiende.
   *
   * 🔴 Nunca AMPLÍA: `boundByRemainingTarget` toma el mínimo, así que un hueco
   * mayor que el objetivo configurado no puede autorizar buscar más.
   */
  remainingTarget?: number | null;
};

/**
 * Estado de una corrida interrumpida, suficiente para continuarla sin repetir
 * ninguna operación pagada.
 *
 * Lo produce `toApolloTwoRoundResumeState` a partir de un resultado parcial y lo
 * persiste el adaptador de producción; este módulo sólo lo consume.
 */
export type ApolloTwoRoundResumeState = {
  /** Identidades ya vistas: la ronda 2 no puede volver a procesarlas. */
  seenIdentities: readonly NormalizedOrganizationIdentity[];
  /** Candidatos ya evaluados, con su veredicto y su motivo de rechazo. */
  candidates: readonly ResumedCandidate[];
  /** Métricas de las rondas ya completadas. */
  rounds: readonly ApolloTwoRoundRoundMetrics[];
  totalRawResults: number;
  totalSearchCredits: number;
  totalEnrichmentCredits: number;
  /** Enrichments ya PAGADOS. Descuentan del cap global de la corrida. */
  enrichmentsExecuted: number;
  observedRejectionReasons: readonly CheapRejectionReason[];
  secondRoundSkippedReason?: SecondRoundSkippedReason | null;
  /**
   * § 5 del FINAL-FIX — el ledger viaja DENTRO del estado recuperable. Antes las
   * claves completadas se pasaban por un campo aparte y el estado por otro, así
   * que un reintento podía traer uno sin el otro: sabía que la ronda 1 ya se había
   * buscado y no tenía nada que recuperar de ella.
   */
  completedOperationKeys?: readonly string[];
  indeterminateOperationKeys?: readonly string[];
  indeterminateOperations?: readonly ApolloTwoRoundIndeterminateOperation[];
  /** True cuando los candidatos ya se escribieron. Un reintento NO los reescribe. */
  candidatesPersisted?: boolean;
  /**
   * § 5 del FINAL-FIX — organizaciones que una búsqueda YA PAGADA devolvió y cuya
   * evaluación barata nunca llegó a registrarse.
   *
   * El hueco que cierra: entre el checkpoint de "búsqueda completada" y el de
   * "evaluación de la ronda completada" hay una ventana. Un fallo dentro de ella
   * dejaba la búsqueda marcada como completada —correcto, se pagó— y la ronda sin
   * candidatos, así que el reintento la registraba con CERO organizaciones y la
   * corrida terminaba vacía después de haber pagado. Con esto, el reintento
   * recupera las organizaciones y sólo repite la evaluación, que es gratis.
   */
  pendingRoundOrganizations?: readonly {
    roundNumber: number;
    organizations: readonly RawDiscoveredOrganization[];
  }[];
};

/** Candidato recuperado de un intento anterior, con su estado completo. */
export type ResumedCandidate = {
  candidateKey: string;
  roundNumber: number;
  providerRank: number;
  identity: NormalizedOrganizationIdentity;
  assessment: CheapAssessment;
  sectorEvidenceState: CandidateSectorEvidenceState;
  eligible: boolean;
  becameEligibleAfterEnrichment: boolean;
  enrichmentExecuted: boolean;
  finallyRejectedOrDuplicated: boolean;
  /**
   * § D — opcionales porque un checkpoint escrito antes de este hito no los
   * tiene. Al rehidratar se derivan de la evaluación barata, que es la única
   * información que ese checkpoint sí guardó.
   */
  definitivelyRejected?: boolean;
  definitiveRejectionReason?: CheapRejectionReason | 'sector_evidence_contradictory' | null;
  /**
   * STABLE-TARGET-WRITER-PARITY § 5 — opcional por la misma razón que los dos de
   * arriba: un checkpoint escrito antes de este hito no lo tiene, y su ausencia
   * significa «nadie informó», no «el enrichment no resolvió nada».
   */
  resolvedCompanyFields?: {
    employeeCountStatus: CompanyFieldMappingStatus;
    linkedinStatus: CompanyFieldMappingStatus;
  } | null;
};

/**
 * Proyecta un resultado (parcial o completo) al estado que un reintento
 * necesita. Deliberadamente NO incluye nada derivable: las métricas de corrida y
 * el ranking final se recalculan, porque recalcularlos es gratis y guardarlos
 * abre la puerta a que el estado y el resultado discrepen.
 */
export function toApolloTwoRoundResumeState(
  result: ApolloTwoRoundRunResult,
): ApolloTwoRoundResumeState {
  return {
    seenIdentities: result.evaluatedCandidates.map((c) => c.identity),
    candidates: result.evaluatedCandidates,
    rounds: result.rounds,
    totalRawResults: result.runMetrics.totalRawResults,
    totalSearchCredits: result.runMetrics.totalSearchCredits,
    totalEnrichmentCredits: result.runMetrics.totalEnrichmentCredits,
    enrichmentsExecuted: result.runMetrics.enrichmentsExecuted,
    observedRejectionReasons: result.observedRejectionReasons,
    secondRoundSkippedReason: result.secondRoundSkippedReason,
    completedOperationKeys: result.completedOperationKeys,
    indeterminateOperationKeys: result.indeterminateOperationKeys,
    indeterminateOperations: result.indeterminateOperations,
  };
}

// ─── Estado interno de un candidato ───────────────────────────────────────────

type TrackedCandidate = {
  candidateKey: string;
  roundNumber: number;
  providerRank: number;
  identity: NormalizedOrganizationIdentity;
  assessment: CheapAssessment;
  sectorEvidenceState: CandidateSectorEvidenceState;
  eligible: boolean;
  becameEligibleAfterEnrichment: boolean;
  enrichmentExecuted: boolean;
  finallyRejectedOrDuplicated: boolean;
  /**
   * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § D — hay un rechazo DEFINITIVO
   * con causa nombrada (gate barato, duplicado post-enrichment, gate final o
   * sector contradictorio).
   *
   * Se separa de `finallyRejectedOrDuplicated` a propósito: ese campo alimenta
   * `enrichmentWaste` y marca también al candidato que sigue AMBIGUO tras pagar
   * su enrichment. Ambiguo y rechazado no son lo mismo — el primero se persiste
   * como `needs_review` y el segundo no se persiste — y confundirlos era
   * exactamente lo que impedía al usuario revisar empresas potencialmente útiles.
   */
  definitivelyRejected: boolean;
  /** Causa del rechazo definitivo, cuando la hay. Nunca se inventa. */
  definitiveRejectionReason: CheapRejectionReason | 'sector_evidence_contradictory' | null;
  /**
   * AGENT1-APOLLO-FINALIZATION-HARDENING-1 § A — `deps.applyFinalGates` ya
   * corrió sobre este candidato. Evita invocarlo dos veces (una vez temprano,
   * vía `stableFinalizableCandidateCount()`, y otra en el barrido final) y es lo que le
   * permite a `stableFinalizableCandidateCount()` saber a quién todavía le falta
   * resolver.
   */
  finalGateEvaluated: boolean;
  /**
   * STABLE-TARGET-WRITER-PARITY § 5 — estado de los campos OBLIGATORIOS después
   * del último enrichment ejecutado sobre este candidato.
   *
   * `null` mientras ningún enrichment lo haya informado: entonces mandan las
   * señales gratuitas de la búsqueda (`hasCompanySizeSignal`, `hasLinkedInUrl`).
   * Nunca se rellena por el hecho de haber pagado: se rellena con lo que el
   * proveedor devolvió.
   */
  resolvedCompanyFields: {
    employeeCountStatus: CompanyFieldMappingStatus;
    linkedinStatus: CompanyFieldMappingStatus;
  } | null;
};

/**
 * Clave de un candidato dentro de la corrida.
 *
 * Prefiere el id del proveedor; cae al dominio y luego al nombre canónico. Sin
 * ninguno de los tres, la posición sirve de último recurso — un candidato sin
 * identidad no puede deduplicarse, pero tampoco puede colisionar con otro.
 */
function buildCandidateKey(
  identity: NormalizedOrganizationIdentity,
  roundNumber: number,
  providerRank: number,
): string {
  if (identity.providerOrganizationId) return `apollo:${identity.providerOrganizationId}`;
  if (identity.normalizedDomain) return `domain:${identity.normalizedDomain}`;
  if (identity.canonicalName) return `name:${identity.canonicalName}`;
  return `unidentified:r${roundNumber}:${providerRank}`;
}

/**
 * Una empresa cuenta para el objetivo cuando superó todos los gates baratos y su
 * pertenencia al sector está CONFIRMADA.
 *
 * `sector_evidence_missing_needs_enrichment` no cuenta: aceptar sin evidencia
 * sería exactamente la degradación de calidad que el hito prohíbe. Ese estado es
 * el que puede competir por un enrichment, y sólo si el enrichment lo confirma
 * pasa a elegible.
 */
function isEligible(
  rejection: CheapRejectionReason | null,
  sectorEvidenceState: CandidateSectorEvidenceState,
): boolean {
  return rejection === null && sectorEvidenceState === 'sector_evidence_confirmed';
}

/**
 * HARDENING-3 § 4 — código de error SANITIZADO del constructor efectivo.
 *
 * Sólo el nombre de la clase de error, y sólo si es un identificador plano. Nunca el
 * mensaje, la traza, la API key ni el payload: este código viaja a metadata
 * persistible y a `provider_usage_logs`.
 */
export function sanitizeEffectiveRequestBuildErrorCode(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const safe = /^[A-Za-z0-9_]{1,40}$/.test(name) ? name : 'unknown';
  return `effective_request_build_threw:${safe}`;
}

/**
 * HARDENING-3 § 5 — normaliza una ronda rehidratada de un checkpoint.
 *
 * Un checkpoint escrito antes de este hito no tiene `effectiveRequestBuildStatus`.
 * Se le estampa `legacy_checkpoint_missing` para que la decisión de la ronda 2 pueda
 * nombrar la causa exacta. Lo que NO se hace: rellenar `effectiveProviderFingerprint`
 * con la huella de hipótesis. Sus resultados, su gasto y sus métricas se conservan
 * exactamente como estaban.
 */
function normalizeRestoredRoundMetrics(
  round: ApolloTwoRoundRoundMetrics,
): ApolloTwoRoundRoundMetrics {
  if (round.effectiveRequestBuildStatus !== undefined) return { ...round };
  return {
    ...round,
    effectiveRequestBuildStatus:
      round.effectiveProviderFingerprint === null || round.effectiveProviderFingerprint === undefined
        ? 'legacy_checkpoint_missing'
        : 'success',
    effectiveRequestBuildErrorCode: round.effectiveRequestBuildErrorCode ?? null,
  };
}

function tallyRejection(
  metrics: ApolloTwoRoundRoundMetrics,
  reason: CheapRejectionReason,
): void {
  switch (reason) {
    case 'duplicate_within_response':
    case 'seen_in_previous_round':
      metrics.seenDuplicates++;
      break;
    case 'duplicate_in_sellup':
      metrics.knownCompanyDuplicates++;
      metrics.duplicateInSellUp++;
      break;
    case 'duplicate_in_hubspot':
      metrics.knownCompanyDuplicates++;
      metrics.duplicateInHubSpot++;
      break;
    case 'cooldown_or_prior_suggestion':
      metrics.knownCompanyDuplicates++;
      metrics.cooldownOrPriorSuggestion++;
      break;
    case 'country_incompatible':
      metrics.countryRejected++;
      break;
    case 'sector_not_mapped':
    case 'sector_evidence_contradictory':
      metrics.sectorRejected++;
      break;
    case 'invalid_domain':
    case 'external_platform_domain':
    case 'ownership_mismatch':
      metrics.ownershipRejected++;
      break;
    case 'raw_result_cap_reached':
      // Un tope alcanzado no es un rechazo de calidad del candidato: no se
      // contabiliza como duplicado ni como falso positivo, porque inflaría
      // ambas tasas con un límite nuestro.
      break;
  }
}

// ─── Orquestador ──────────────────────────────────────────────────────────────

/**
 * Ejecuta la corrida completa: ronda 1, parada o adaptación, ronda 2, ranking
 * final y estado del resultado.
 *
 * Nunca ejecuta una tercera ronda, aunque el objetivo no se alcance.
 */
export async function runApolloTwoRoundDiscovery(
  input: ApolloTwoRoundRunInput,
  deps: ApolloTwoRoundDeps,
): Promise<ApolloTwoRoundRunResult> {
  const { config, queryContext, correlation } = input;
  const resume = input.resume ?? null;

  /**
   * CUT-2 §§ 4, 6, 7 — el objetivo EFECTIVO de esta corrida, resuelto UNA vez.
   *
   * Todas las paradas, el hueco proyectado, la selección de enrichment y el
   * ranking final leen esta variable y no `config.targetEligibleCompanies`. Que
   * haya un solo sitio es el punto: con once lecturas del config y una cota
   * aplicada en algunas, la corrida podría pararse con un número y redactar la
   * ronda 2 con otro.
   *
   * 🔴 `config` se deja INTACTO a propósito. Es el objeto que la reserva y el
   * peor caso económico consumen aguas arriba, y mutarlo aquí acoplaría la demanda
   * de resultados con el techo financiero — exactamente lo que § 5 prohíbe
   * mientras P0-1 siga sin confirmación de Apollo.
   */
  const remainingTargetApplied =
    typeof input.remainingTarget === 'number' && Number.isFinite(input.remainingTarget)
      ? input.remainingTarget
      : null;
  const targetEligibleCompanies =
    remainingTargetApplied === null
      ? config.targetEligibleCompanies
      : boundByRemainingTarget(config.targetEligibleCompanies, remainingTargetApplied);
  // § 5 — el ledger se rehidrata del estado recuperado y, sólo como segunda
  // fuente, de las claves sueltas que un llamador antiguo pudiera pasar.
  const ledger = ApolloTwoRoundOperationLedger.fromCompletedKeys([
    ...(input.completedOperationKeys ?? []),
    ...(resume?.completedOperationKeys ?? []),
  ]);
  for (const key of resume?.indeterminateOperationKeys ?? []) {
    ledger.markIndeterminate(key);
  }

  // § 7 — el estado recuperado siembra la corrida. Sin esto, un reintento que
  // salta una ronda ya buscada la trataría como si hubiera devuelto cero.
  let seenRegistry: SeenOrganizationRegistry = createSeenOrganizationRegistry();
  for (const identity of resume?.seenIdentities ?? []) {
    seenRegistry = registerSeenOrganization(seenRegistry, identity);
  }
  const tracked: TrackedCandidate[] = (resume?.candidates ?? []).map((c) => {
    // § D — un checkpoint anterior a este hito no trae el rechazo definitivo. Se
    // deriva de lo que ese checkpoint SÍ guardó: el gate barato y el veredicto
    // sectorial. Nunca se rellena con `false` a ciegas.
    const derivedReason: CheapRejectionReason | 'sector_evidence_contradictory' | null =
      c.assessment.rejection ??
      (c.sectorEvidenceState === 'sector_evidence_contradictory'
        ? 'sector_evidence_contradictory'
        : null);
    return {
      ...c,
      definitivelyRejected: c.definitivelyRejected ?? derivedReason !== null,
      definitiveRejectionReason: c.definitiveRejectionReason ?? derivedReason,
      // § A — un checkpoint anterior a este hito no trae el campo. Se asume NO
      // evaluado: en el peor caso, `applyFinalGates` se vuelve a invocar sobre un
      // candidato ya resuelto, y el contrato lo garantiza gratis y puro.
      finalGateEvaluated: false,
      resolvedCompanyFields: c.resolvedCompanyFields ?? null,
    };
  });
  // § 5 — las rondas rehidratadas declaran si su huella efectiva es verificable o si
  // vienen de un checkpoint anterior a este hito. Sin backfill de la huella.
  const roundMetrics: ApolloTwoRoundRoundMetrics[] = (resume?.rounds ?? []).map(
    normalizeRestoredRoundMetrics,
  );
  /**
   * A1-APOLLO-NET-NEW-PAGINATION-V2 — cursor de página POR PLAN DE BÚSQUEDA.
   *
   * Se siembra desde las rondas rehidratadas: un reintento que sólo ejecute la
   * ronda 2 tiene que saber por dónde dejó la ronda 1 ese MISMO plan. Un
   * checkpoint anterior a este hito no trae los campos y simplemente no aporta
   * cursor — el comportamiento previo, sin adivinar páginas.
   */
  let searchPlanPageCursors: ApolloSearchPlanPageCursors = roundMetrics.reduce(
    (cursors, round) =>
      withApolloSearchPlanPageConsumption(cursors, {
        searchPlanFingerprint: round.searchPlanFingerprint ?? null,
        lastConsumedPage: round.lastConsumedPage ?? null,
      }),
    EMPTY_APOLLO_SEARCH_PLAN_PAGE_CURSORS,
  );
  const enrichmentSelections: EnrichmentSelection[] = [];
  const enrichmentSkips: EnrichmentSkip[] = [];
  const observedRejectionReasons = new Set<CheapRejectionReason>(
    resume?.observedRejectionReasons ?? [],
  );
  const indeterminateOperations: ApolloTwoRoundIndeterminateOperation[] = [
    ...(resume?.indeterminateOperations ?? []),
  ];
  const checkpointWriteFailures: ApolloTwoRoundCheckpointTrigger[] = [];
  /**
   * Organizaciones de una búsqueda ya pagada cuya evaluación aún no se registró.
   *
   * Se llena en cuanto la búsqueda devuelve y se vacía cuando las métricas de la
   * ronda se registran. Mientras esté llena, viaja en cada checkpoint: es lo que
   * permite que un reintento recupere lo que la búsqueda trajo en vez de tratar la
   * ronda como si hubiera devuelto cero.
   */
  const pendingRoundOrganizations = new Map<number, readonly RawDiscoveredOrganization[]>();
  for (const entry of resume?.pendingRoundOrganizations ?? []) {
    pendingRoundOrganizations.set(entry.roundNumber, entry.organizations);
  }

  let totalRawResults = resume?.totalRawResults ?? 0;
  let totalSearchCredits = resume?.totalSearchCredits ?? 0;
  let totalEnrichmentCredits = resume?.totalEnrichmentCredits ?? 0;
  let remainingEnrichmentBudget = Math.max(
    0,
    config.maxEnrichmentsPerRun - (resume?.enrichmentsExecuted ?? 0),
  );
  let secondRoundSkippedReason: SecondRoundSkippedReason | null =
    resume?.secondRoundSkippedReason ?? null;
  /**
   * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 7 — por qué la corrida no pudo pagar
   * ninguna búsqueda.
   *
   * Se distingue del `secondRoundSkippedReason` a propósito: un bloqueo de cobertura
   * en la ronda 1 no es «la ronda 2 se omitió», es «no se construyó ninguna consulta
   * cobrable». `null` en una corrida normal.
   */
  let queryCoverageBlockReason: string | null = null;
  /**
   * § 7 — sólo se fija cuando la comparación de huellas efectivas se hizo de verdad.
   * Mientras siga en null, nadie comparó nada.
   */
  let effectiveFingerprintsAreDistinct: boolean | null = null;
  /**
   * SCALE-SECOND-ROUND-FIX-1B § 1 — decisión de página de la ronda 2. Se queda en
   * `null` mientras nadie la tome; no se rehidrata de `resume` porque describe una
   * decisión de ESTE intento, y un reintento que no vuelve a construir la ronda 2
   * no ha decidido nada.
   */
  let round2PageDecision: ApolloRound2PageDecision | null = null;
  /**
   * SCALE-AND-SECOND-ROUND-FIX-1 § 4 — desenlace de cada enrichment pagado en
   * ESTA invocación, en tres cubetas mutuamente excluyentes. No se rehidratan de
   * `resume`: igual que `enrichmentSelections`/`enrichmentSkips`, describen sólo
   * lo que este intento ejecutó, no el acumulado histórico.
   */
  let sectorConfirmedByEnrichmentCount = 0;
  let sectorStillUnconfirmedAfterEnrichmentCount = 0;
  /** HARDENING-1 § 5 — el enrichment CONTRADIJO el sector. Cubeta propia. */
  let sectorRejectedAfterEnrichmentCount = 0;
  let enrichmentFailedCount = 0;

  /**
   * AGENT1-APOLLO-FINALIZATION-HARDENING-1 § A — aplica `deps.applyFinalGates`
   * a UN candidato, a lo sumo una vez.
   *
   * Extraída de lo que antes era un único barrido al final de la corrida
   * (HARDENING-1 § 5) para poder invocarla TEMPRANO, desde `stableFinalizableCandidateCount()`,
   * justo antes de cada decisión de parada. El barrido final (más abajo) sigue
   * existiendo para la cohorte de revisión, que no participa de `eligibleCount()`
   * y por tanto no necesita resolverse antes de ninguna parada.
   */
  const ensureFinalGateEvaluated = async (candidate: TrackedCandidate): Promise<void> => {
    if (!deps.applyFinalGates) return;
    if (candidate.finalGateEvaluated) return;
    candidate.finalGateEvaluated = true;
    const verdict = await deps.applyFinalGates({
      candidateKey: candidate.candidateKey,
      roundNumber: candidate.roundNumber,
      identity: candidate.identity,
    });
    if (verdict.rejection === null) return;
    observedRejectionReasons.add(verdict.rejection);
    candidate.definitivelyRejected = true;
    candidate.definitiveRejectionReason = verdict.rejection;
    candidate.finallyRejectedOrDuplicated = true;
    if (!candidate.eligible) return;
    const metricsForRound = roundMetrics.find((m) => m.roundNumber === candidate.roundNumber) ?? null;
    if (metricsForRound) tallyRejection(metricsForRound, verdict.rejection);
    candidate.eligible = false;
    candidate.becameEligibleAfterEnrichment = false;
  };

  /**
   * STABLE-TARGET-WRITER-PARITY § 2 — condiciones del contrato canónico que el
   * ORQUESTADOR puede evaluar por sí solo, sin adaptador.
   *
   * No es una segunda semántica: es el relleno de la estructura que consume
   * `evaluateCandidateTargetEligibility`, la misma función del writer. Cada
   * condición se toma de la señal que la responde, y ninguna se da por buena:
   *
   *   subindustry_match     ← veredicto sectorial ya plegado con la precisión de
   *                           subindustria (`foldSubindustryPrecisionIntoSectorState`)
   *   employee_count_status ← `resolvedCompanyFields` si un enrichment lo informó;
   *                           si no, la señal gratuita de la búsqueda
   *   linkedin_status       ← ídem
   *   duplicate_status      ← duplicado conocido de los gates baratos
   *   ownership_gate        ← rechazo de ownership (barato o final)
   *   quality_gate          ← cualquier otro rechazo definitivo
   *
   * Producción NO usa esta derivación: inyecta `readCandidateTargetConditions`,
   * que lee exactamente lo que leerá el writer. Ésta es la que hace que las
   * suites puras —que no tienen writer— sigan pudiendo ejercitar la parada.
   */
  const deriveTargetConditions = (
    candidate: TrackedCandidate,
  ): ApolloTwoRoundCandidateTargetConditions => {
    const signals = candidate.assessment.signals;
    const resolved = candidate.resolvedCompanyFields;
    const rejection = candidate.definitiveRejectionReason ?? candidate.assessment.rejection;
    const ownershipRejected =
      rejection === 'ownership_mismatch' ||
      rejection === 'invalid_domain' ||
      rejection === 'external_platform_domain';
    return {
      subindustryMatch:
        candidate.sectorEvidenceState === 'sector_evidence_confirmed'
          ? 'confirmed'
          : 'not_confirmed',
      employeeCountStatus:
        resolved?.employeeCountStatus ??
        (signals.hasCompanySizeSignal ? 'confirmed' : 'not_returned'),
      linkedinStatus:
        resolved?.linkedinStatus ?? (signals.hasLinkedInUrl ? 'confirmed' : 'not_returned'),
      duplicateStatus: signals.knownDuplicate ? 'possible_duplicate' : 'no_match',
      ownershipGate: ownershipRejected ? 'fail' : 'pass',
      // Cualquier rechazo definitivo que no sea de ownership (país, duplicidad
      // final, sector contradictorio, calidad) cae aquí: el writer tampoco
      // habría persistido a ese candidato.
      qualityGate: rejection !== null && !ownershipRejected ? 'fail' : 'pass',
    };
  };

  /**
   * § 1 — elegibilidad hacia el objetivo de UN candidato, por la función
   * CANÓNICA, en su estado actual.
   *
   * `persistenceSuccess: true` no afirma que la fila exista: afirma la hipótesis
   * bajo la que se lee el resultado, y por eso lo que se consume aguas arriba es
   * `countsTowardTargetIfPersisted` (§ 10). Un fallo de base posterior lo
   * desmiente para esa fila sin invalidar esta decisión.
   */
  const evaluateCandidateFinalizability = async (
    candidate: TrackedCandidate,
  ): Promise<{
    eligibility: CandidateTargetEligibility;
    /** § 11 — admisiones aprobadas, para el contador agregado. */
    resolvedAdmissionChecks: readonly string[];
  }> => {
    const conditions = deps.readCandidateTargetConditions
      ? await deps.readCandidateTargetConditions({
          candidateKey: candidate.candidateKey,
          roundNumber: candidate.roundNumber,
          identity: candidate.identity,
          sectorEvidenceState: candidate.sectorEvidenceState,
        })
      : deriveTargetConditions(candidate);
    return {
      eligibility: evaluateCandidateTargetEligibility({
        persistenceSuccess: true,
        subindustryMatch: conditions.subindustryMatch,
        employeeCountStatus: conditions.employeeCountStatus,
        linkedinStatus: conditions.linkedinStatus,
        duplicateStatus: conditions.duplicateStatus,
        ownershipGate: conditions.ownershipGate,
        qualityGate: conditions.qualityGate,
        pendingConditions: conditions.pendingConditions,
        unresolvedWriterOnlyAdmissionChecks: conditions.unresolvedWriterOnlyAdmissionChecks,
        failedWriterOnlyAdmissionChecks: conditions.failedWriterOnlyAdmissionChecks,
      }),
      resolvedAdmissionChecks: conditions.resolvedWriterOnlyAdmissionChecks ?? [],
    };
  };

  /**
   * § 3 — la ÚNICA cuenta que puede detener gasto.
   *
   * El defecto que cierra, y que sobrevivió al § A de este mismo hito: § A ya
   * había hecho que la cuenta se resolviera con los gates finales (ownership,
   * país, duplicidad) antes de cada parada, pero seguía contando «elegibles» en
   * el sentido del ORQUESTADOR —gates baratos limpios y sector confirmado— y ése
   * no es el sentido del WRITER. Un candidato con el sector confirmado gratis y
   * `employee_count` ausente era «elegible» aquí y `needs_review` allí: la
   * corrida `bdc51c49` confirmó a Surtifamiliar y La Canasta por nombre
   * comercial, las contó, y el writer las dejó fuera de `target_count`. Dos
   * semánticas de objetivo, y la de aquí —la que decide el gasto— era la laxa.
   *
   * Ahora la cuenta es exactamente `count(eligibleForTarget === true)` según el
   * contrato canónico. Fail-closed en las dos direcciones que importan:
   *
   *   · una condición FALLIDA no cuenta (review-only nunca detiene enrichments);
   *   · una condición PENDIENTE tampoco (§ 2): no saber no es cumplir.
   *
   * Sigue resolviendo los gates finales antes de contar (§ A), porque un
   * candidato que va a caer por ownership no puede sostener una parada.
   */
  /**
   * WRITER-ONLY-ADMISSION-PENDING §§ 3 y 8 — un solo barrido, tres cifras que NO
   * son la misma y que por eso no comparten nombre.
   *
   *   `stable`    — cero condiciones fallidas, cero pendientes y cero admisiones
   *                 writer-only sin resolver. La ÚNICA que puede detener gasto.
   *   `projected` — igual, pero ignorando las admisiones writer-only. Es una
   *                 PROYECCIÓN optimista: sólo observabilidad (§ 3).
   *   `writerOnlyPending` — candidatos que serían finalizables si alguien
   *                 resolviera sus admisiones writer-only. Es exactamente
   *                 `projected - stable`, calculado y no deducido.
   */
  type FinalizabilityScan = {
    stable: number;
    projected: number;
    writerOnlyPending: number;
    writerOnlyPendingReasons: string[];
    /** § 11 — admisiones PRE-writer agregadas sobre los candidatos elegibles. */
    admissionPassCount: number;
    admissionFailedCount: number;
    admissionPendingCount: number;
  };

  const scanFinalizability = async (): Promise<FinalizabilityScan> => {
    for (const candidate of tracked) {
      if (candidate.eligible) await ensureFinalGateEvaluated(candidate);
    }
    let stable = 0;
    let projected = 0;
    let writerOnlyPending = 0;
    let admissionPassCount = 0;
    let admissionFailedCount = 0;
    let admissionPendingCount = 0;
    const reasons: string[] = [];
    for (const candidate of tracked) {
      if (!candidate.eligible) continue;
      const scan = await evaluateCandidateFinalizability(candidate);
      const eligibility = scan.eligibility;
      admissionPassCount += scan.resolvedAdmissionChecks.length;
      admissionFailedCount += eligibility.writerOnlyFailedChecks.length;
      admissionPendingCount += eligibility.writerOnlyPendingChecks.length;
      if (eligibility.countsTowardTargetIfPersisted) {
        stable++;
        projected++;
        continue;
      }
      // Proyectado ⇔ lo ÚNICO que le falta son admisiones writer-only. Un
      // candidato con una condición del contrato fallida o pendiente no es
      // proyectable: le falta algo que sí se sabe.
      const blockedOnlyByWriterOnly =
        eligibility.writerOnlyPendingChecks.length > 0 &&
        eligibility.strictlyFailedConditions.length === 0 &&
        eligibility.pendingConditions.every((entry) =>
          eligibility.writerOnlyPendingChecks.includes(entry),
        );
      if (!blockedOnlyByWriterOnly) continue;
      projected++;
      writerOnlyPending++;
      for (const reason of eligibility.writerOnlyPendingChecks) {
        if (!reasons.includes(reason)) reasons.push(reason);
      }
    }
    return {
      stable,
      projected,
      writerOnlyPending,
      writerOnlyPendingReasons: reasons,
      admissionPassCount,
      admissionFailedCount,
      admissionPendingCount,
    };
  };

  const stableFinalizableCandidateCount = async (): Promise<number> =>
    (await scanFinalizability()).stable;

  /** § 11 — hueco PROYECTADO contra el objetivo, antes del writer. Nunca negativo. */
  const projectedTargetGap = async (): Promise<number> =>
    Math.max(0, targetEligibleCompanies - (await stableFinalizableCandidateCount()));

  /** Estado recuperable en ESTE instante. Se recalcula en cada checkpoint. */
  const currentResumeState = (): ApolloTwoRoundResumeState => ({
    seenIdentities: tracked.map((c) => c.identity),
    candidates: tracked.map((c) => ({ ...c })),
    rounds: roundMetrics.map((r) => ({ ...r })),
    totalRawResults,
    totalSearchCredits,
    totalEnrichmentCredits,
    enrichmentsExecuted: tracked.filter((c) => c.enrichmentExecuted).length,
    observedRejectionReasons: [...observedRejectionReasons],
    secondRoundSkippedReason,
    completedOperationKeys: ledger.completedKeys,
    indeterminateOperationKeys: ledger.indeterminateKeys,
    indeterminateOperations: [...indeterminateOperations],
    candidatesPersisted: resume?.candidatesPersisted === true,
    pendingRoundOrganizations: [...pendingRoundOrganizations].map(
      ([roundNumber, organizations]) => ({ roundNumber, organizations }),
    ),
  });

  /**
   * Persiste el estado. Nunca lanza: un fallo se reporta como `false` y el
   * llamador decide, en vez de tumbar una corrida que ya gastó.
   */
  const persistCheckpoint = async (
    reason: ApolloTwoRoundCheckpointTrigger,
    operationContext: ApolloTwoRoundOperationContext | null,
  ): Promise<boolean> => {
    if (!deps.saveCheckpoint) return true;
    try {
      const saved = await deps.saveCheckpoint({
        reason,
        resume: currentResumeState(),
        operationContext,
      });
      if (saved === false) {
        checkpointWriteFailures.push(reason);
        return false;
      }
      return true;
    } catch {
      checkpointWriteFailures.push(reason);
      return false;
    }
  };

  /**
   * Cierra UNA operación externa: marca el ledger y lo persiste en la misma
   * escritura que el estado.
   *
   * El orden del § 3 se respeta aquí: la operación externa ya ocurrió y su usage
   * log lo escribió la dependencia antes de devolver; lo que falta es el
   * checkpoint durable y el ledger, y los dos van juntos.
   *
   * Si el checkpoint no se pudo persistir, la operación NO queda completada: se
   * degrada a indeterminada. Ni se repite (segundo cargo) ni se salta como si su
   * resultado estuviera recuperable (corrida vacía tras pagar).
   */
  const commitOperation = async (
    operationContext: ApolloTwoRoundOperationContext,
    outcome: 'completed' | 'indeterminate',
  ): Promise<'completed' | 'indeterminate'> => {
    if (outcome === 'indeterminate') {
      ledger.markIndeterminate(operationContext.operationId);
      indeterminateOperations.push({
        roundNumber: operationContext.roundNumber,
        operationKey: operationContext.operationKey,
        subject: operationContext.subject,
        operationId: operationContext.operationId,
        reason: 'provider_outcome_unknown',
      });
      await persistCheckpoint(
        operationContext.operationKey === 'organizations_search'
          ? 'search_round_indeterminate'
          : 'enrichment_indeterminate',
        operationContext,
      );
      return 'indeterminate';
    }

    ledger.markCompleted(operationContext.operationId);
    const persisted = await persistCheckpoint(
      operationContext.operationKey === 'organizations_search'
        ? 'search_round_completed'
        : 'enrichment_completed',
      operationContext,
    );
    if (persisted) return 'completed';

    ledger.downgradeToIndeterminate(operationContext.operationId);
    indeterminateOperations.push({
      roundNumber: operationContext.roundNumber,
      operationKey: operationContext.operationKey,
      subject: operationContext.subject,
      operationId: operationContext.operationId,
      reason: 'checkpoint_not_durable',
    });
    return 'indeterminate';
  };

  /** True en cuanto una operación quedó indeterminada: nada dependiente corre. */
  const hasIndeterminateOperation = (): boolean => indeterminateOperations.length > 0;

  /**
   * § 2 y § 4 — request efectivo de una ronda, sin ejecutarla, con la CAUSA cuando
   * no se pudo construir.
   *
   * Nunca lanza: un fallo aquí no puede tumbar la ronda 1 ya ejecutada ni el wizard
   * completo, porque el resultado parcial sigue siendo seguro de devolver. Lo único
   * que impide es una segunda llamada cuya diversidad no se pueda demostrar.
   *
   * Lo que ya NO hace: devolver `null` a secas. El estado viaja con el dato, así que
   * la decisión económica no puede confundir "no hay constructor" con "las dos
   * rondas piden lo mismo".
   */
  const buildRoundEffectiveRequest = (
    roundNumber: number,
    hypothesis: ApolloTwoRoundQueryHypothesis,
    requestedResultLimit: number,
  ): RoundEffectiveRequestBuild => {
    if (!deps.buildRoundProviderRequest) {
      return { status: 'unavailable_dependency', preview: null, errorCode: null };
    }
    try {
      const preview = deps.buildRoundProviderRequest({
        roundNumber,
        hypothesis,
        requestedResultLimit,
      });
      if (preview === null || typeof preview.effectiveRequestFingerprint !== 'string') {
        // El constructor existe y no produjo huella: es un fallo de construcción,
        // no una dependencia ausente. Nombrarlo distinto importa para el diagnóstico.
        return {
          status: 'build_error',
          preview: null,
          errorCode: 'effective_request_builder_returned_no_fingerprint',
        };
      }
      return { status: 'success', preview, errorCode: null };
    } catch (err: unknown) {
      return {
        status: 'build_error',
        preview: null,
        errorCode: sanitizeEffectiveRequestBuildErrorCode(err),
      };
    }
  };

  // ── Bucle de rondas ─────────────────────────────────────────────────────────
  //
  // 🔴 CUT-2 § 4 — con el hueco YA cerrado por la capa gratuita, Apollo NO ejecuta.
  // Ni la ronda 1. La comprobación de objetivo de dentro del bucle no basta: sólo
  // mira a partir de la ronda 2, porque hasta este corte era imposible entrar con
  // el objetivo satisfecho de antemano. Ahora es posible y es el caso barato.
  const roundsAuthorized = targetEligibleCompanies > 0;

  for (
    let roundNumber = 1;
    roundsAuthorized && roundNumber <= config.maxRounds;
    roundNumber++
  ) {
    // § 7: una ronda cuyo estado ya se recuperó no se vuelve a ejecutar NI se
    // vuelve a registrar. Sus métricas y sus candidatos ya están en el estado.
    if (roundMetrics.some((m) => m.roundNumber === roundNumber)) continue;

    // § 4: una operación indeterminada detiene lo que dependa de ella. La ronda 2
    // depende de saber qué trajo la ronda 1, y un enrichment depende de saber qué
    // organizaciones hay: ninguno de los dos se ejecuta a ciegas.
    if (hasIndeterminateOperation()) break;

    // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § C — una corrida que YA escribió
    // sus candidatos no abre una ronda NUEVA en un reintento. Un reintento existe
    // para recuperar lo ya pagado, nunca para comprar más.
    //
    // Hasta ahora esta garantía se sostenía por accidente: el checkpoint
    // conservaba un `eligible` ANTERIOR a los gates finales (§ C.8), así que un
    // reintento creía el objetivo alcanzado y se detenía solo. Con el estado final
    // ya autoritativo esa creencia desaparece —correctamente— y la garantía de
    // gasto tiene que ser explícita en vez de depender de un dato equivocado.
    if (resume?.candidatesPersisted === true) {
      if (roundNumber > 1 && secondRoundSkippedReason === null) {
        secondRoundSkippedReason = 'candidates_already_persisted';
      }
      break;
    }

    // § 7: parada inmediata. La ronda 2 no se ejecuta por estar presupuestada.
    // § A — con la cuenta ESTABLE: una parada real, no una que un gate final
    // pueda deshacer después de que la ronda 2 ya se descartó.
    if (roundNumber > 1 && (await stableFinalizableCandidateCount()) >= targetEligibleCompanies) {
      secondRoundSkippedReason = 'target_reached';
      break;
    }
    if (roundNumber > 1 && totalRawResults >= config.maxRawResultsPerRun) {
      secondRoundSkippedReason = 'raw_result_cap_reached';
      break;
    }

    /**
     * CUT-2 §§ 6, 7 — cuántos resultados pide ESTA ronda.
     *
     * 🔴 RATCHET INVERTIDO. Hasta este corte el valor era `config.maxResultsPerRound`
     * fijo, con el argumento de que «recortar la petición no ahorra créditos porque
     * Apollo cobra por resultado devuelto». Ese argumento es precisamente una
     * afirmación sobre el contrato de facturación de Apollo, y P0-1 sigue SIN
     * confirmación escrita del proveedor: no se puede sostener una decisión de
     * volumen sobre un modelo de cobro que nadie ha verificado, en ninguna de las
     * dos direcciones.
     *
     * Lo que sí es verificable sin conocer la factura es la demanda: pedir 5 cuando
     * falta 1 es pedir cuatro empresas que el producto va a tirar. § 6 lo formula
     * como invariante — la maquinaria local nunca apunta, a propósito, a más de lo
     * que falta.
     *
     * El hueco es el de AHORA, no el del principio (§ 7): `projectedTargetGap()`
     * ya descuenta lo que la ronda 1 aportó, así que la ronda 2 no puede
     * reiniciarse al objetivo entero. Con hueco 3 y 2 aportados en la ronda 1, la
     * ronda 2 pide 1.
     *
     * 🔴 El suelo es 1 y no 0: llegar aquí significa que las paradas de arriba ya
     * decidieron que esta ronda debe ejecutarse (hueco > 0), y un `per_page: 0`
     * sería una petición pagada que no puede devolver nada.
     */
    const requestedResultLimit =
      remainingTargetApplied === null
        ? // 🔴 Sin capa previa NADA cambia, byte por byte. La cota es de la demanda
          // residual: donde no hay demanda que descontar, no hay cota que aplicar, y
          // esta rama tiene que seguir siendo indistinguible de la de antes del
          // corte. Es la misma disciplina que el resto de la cadena.
          config.maxResultsPerRound
        : Math.max(
            1,
            boundByRemainingTarget(
              config.maxResultsPerRound,
              roundNumber === 1 ? targetEligibleCompanies : await projectedTargetGap(),
            ),
          );

    let hypothesis: ApolloTwoRoundQueryHypothesis;
    let effectiveBuild: RoundEffectiveRequestBuild;
    if (roundNumber === 1) {
      hypothesis = buildRound1Hypothesis(queryContext, requestedResultLimit);
      effectiveBuild = buildRoundEffectiveRequest(1, hypothesis, requestedResultLimit);
    } else {
      const round1Metrics = roundMetrics.find((m) => m.roundNumber === 1) ?? null;
      const providerTotalPages = round1Metrics?.providerTotalPages ?? null;
      // Huella de HIPÓTESIS de la ronda 1: SÓLO diagnóstico y observabilidad. Ya no
      // participa en la decisión económica — era la comparación que dejó pasar la
      // ronda 2 pagada del QA `edb6f40c`.
      const round1HypothesisFingerprint = round1Metrics?.providerRequestFingerprint ?? null;
      const round1EffectiveFingerprint = round1Metrics?.effectiveProviderFingerprint ?? null;
      const round1BuildStatus: ApolloEffectiveRequestBuildStatus =
        round1Metrics?.effectiveRequestBuildStatus ?? 'legacy_checkpoint_missing';

      /**
       * § 3 y § 5 — sin huella efectiva de la ronda 1 no hay ronda 2.
       *
       * Se distingue la causa: un checkpoint antiguo (§ 5) no es lo mismo que un
       * constructor ausente o roto (§ 3). Ninguna de las dos se resuelve emitiendo
       * una llamada para «reconstruir» el dato, ni sustituyendo la huella efectiva
       * por la de hipótesis. La ronda 1, sus resultados y su gasto se conservan.
       */
      if (round1EffectiveFingerprint === null) {
        secondRoundSkippedReason =
          round1BuildStatus === 'legacy_checkpoint_missing'
            ? 'legacy_checkpoint_missing_effective_fingerprint'
            : 'effective_request_fingerprint_unavailable';
        break;
      }

      let round2: ApolloRound2Hypothesis = buildRound2Hypothesis(
        queryContext,
        {
          // § 11 — el hueco PROYECTADO, sobre la cuenta estable. La ronda 2 se
          // redacta para lo que de verdad falta, no para lo que una cifra
          // provisional decía que faltaba.
          remainingTarget: await projectedTargetGap(),
          excludedSeenOrganizationCount: countSeenOrganizations(seenRegistry),
          observedRejectionReasons: [...observedRejectionReasons],
          // § 3 — la página 2 sólo es una variante válida si el proveedor
          // declaró que existe.
          providerTotalPages,
        },
        requestedResultLimit,
      );
      let round2Build = buildRoundEffectiveRequest(2, round2, requestedResultLimit);

      /**
       * § 1 y § 3 — la ronda 2 sólo se autoriza cuando AMBAS huellas efectivas
       * existen y son distintas.
       *
       * `null` no significa "distintas": significa que no se puede afirmar nada. Es
       * la diferencia entre no gastar y gastar sobre una suposición.
       */
      const compareEffective = (
        build: RoundEffectiveRequestBuild,
      ): boolean | null =>
        build.preview === null
          ? null
          : build.preview.effectiveRequestFingerprint !== round1EffectiveFingerprint;

      /**
       * § 4 + SCALE-SECOND-ROUND-FIX-1B § 1 — cuándo la ronda 2 tiene que pedir
       * OTRA página.
       *
       * HARDENING-3 sólo saltaba de página cuando el body efectivo era idéntico al
       * de la ronda 1. La corrida live `eae6d47f` demostró que eso no basta: la
       * ronda 2 salió con tres de sus cinco términos efectivos compartidos con la
       * ronda 1 —huella distinta, ventana igual— y Apollo devolvió las MISMAS cinco
       * empresas en la página 1. Cinco créditos, cero organizaciones nuevas.
       *
       * Así que el disparador es el solapamiento, no la identidad: con un solo
       * término efectivo en común la página 1 vuelve a caer sobre el mismo ranking.
       * Sin términos compartidos la ventana es genuinamente otra y la página 1 sigue
       * siendo correcta. Pedir una página que el proveedor no declaró sigue estando
       * prohibido: sería pagar por una respuesta vacía.
       */
      const round1EffectiveKeywords = round1Metrics?.effectiveKeywordsSent ?? [];
      const sharedEffectiveKeywords =
        round2Build.preview === null
          ? []
          : findSharedEffectiveKeywords(
              round1EffectiveKeywords,
              round2Build.preview.effectiveKeywordTags,
            );
      const escalationReason: ApolloRound2PageEscalationReason | null =
        compareEffective(round2Build) === false
          ? 'identical_effective_request'
          : sharedEffectiveKeywords.length > 0
            ? 'overlapping_effective_keywords'
            : null;
      /**
       * A1-APOLLO-NET-NEW-PAGINATION-V2 § 1 — la página de arranque de la ronda 2
       * sale del CURSOR DEL PLAN, no de un literal.
       *
       * Hasta este corte había DOS sitios que la fijaban en 2, los dos bajo el
       * mismo supuesto —que una ronda nueva estrena universo de páginas—:
       *
       *   1. `buildRound2Hypothesis`, variante `same_query_next_page` (sin
       *      términos ni región alternativos, la única forma de traer algo nuevo
       *      es otra página);
       *   2. el salto por solapamiento de SCALE-SECOND-ROUND-FIX-1B.
       *
       * El supuesto es falso. La unidad lógica del universo de páginas es el PLAN
       * de búsqueda (`searchPlanFingerprint`: el body efectivo SIN `page`), y la
       * ronda es sólo una etapa de su ejecución. Con la paginación net-new
       * conectada la ronda 1 ya no consume UNA página sino varias, así que el 2
       * aterrizaba en mitad de lo ya comprado: la corrida real pidió 1,2,3,4 en la
       * ronda 1 y 2,3,4,5 en la ronda 2 — tres páginas pagadas dos veces.
       *
       *     nextPage = última página consumida por ESE plan + 1
       *
       * Un plan del que no consta consumo devuelve 1: un fingerprint distinto es
       * un universo de paginación INDEPENDIENTE y no hereda el cursor de otro. Por
       * eso el 2 del solapamiento se conserva como SUELO —es el remedio de
       * SCALE-SECOND-ROUND-FIX-1B y no depende del cursor— y el cursor sólo puede
       * empujar la página hacia adelante, nunca hacia atrás.
       */
      const round2PlanFingerprint = round2Build.preview?.searchPlanFingerprint ?? null;
      const netNewCursorPage = resolveApolloNextNetNewPage(
        searchPlanPageCursors,
        round2PlanFingerprint,
      );
      const hypothesisPage = round2.queryParameters.page;
      const overlapFloorPage = escalationReason !== null ? 2 : 1;
      const requestedPage = Math.max(hypothesisPage, overlapFloorPage, netNewCursorPage);
      const pageMoveNeeded = requestedPage > hypothesisPage;
      // Pedir una página que el proveedor no declaró sigue prohibido: sería pagar
      // por una respuesta vacía. Con cursor, lo que se comprueba es que exista la
      // página CONCRETA a la que se movería, no que exista «una segunda».
      const requestedPageDeclared =
        providerTotalPages !== null && providerTotalPages >= requestedPage;

      let escalatedToPage2 = false;
      let advancedByNetNewCursor = false;
      if (pageMoveNeeded && requestedPageDeclared) {
        round2 = withRequestedPage(round2, requestedPage, round1HypothesisFingerprint);
        // La página no toca los términos, así que `sharedEffectiveKeywords` sigue
        // describiendo el solapamiento que motivó el salto.
        round2Build = buildRoundEffectiveRequest(2, round2, requestedResultLimit);
        escalatedToPage2 = hypothesisPage === 1 && escalationReason !== null;
        advancedByNetNewCursor = netNewCursorPage > Math.max(hypothesisPage, overlapFloorPage);
      }

      round2PageDecision = {
        requestedPage: round2.queryParameters.page,
        pageSource: escalatedToPage2
          ? 'effective_request_escalation'
          : round2.queryParameters.page > 1
            ? 'hypothesis_variant'
            : 'first_page',
        escalatedToPage2,
        escalationReason,
        sharedEffectiveKeywords,
        providerTotalPages,
        netNewCursorPage,
        netNewCursorPlanFingerprint: round2PlanFingerprint,
        advancedByNetNewCursor,
        escalationBlockedReason: !pageMoveNeeded || requestedPageDeclared
          ? null
          : providerTotalPages === null
            ? 'provider_total_pages_unknown'
            : // V2 — con `total_pages` declarado, la causa deja de ser siempre «el
              // proveedor declaró una sola página»: puede ser que el plan ya se
              // recorriera entero y el cursor apunte más allá del final. Retroceder
              // sería volver a comprar lo que la ronda anterior acaba de pagar.
              providerTotalPages < 2
              ? 'provider_declared_single_page'
              : 'provider_page_range_exhausted',
      };

      /**
       * V2 § 1 — si la página que la ronda 2 iba a pedir ya está consumida por
       * ESTE plan y no se pudo avanzar a una posterior, la ronda no se emite.
       *
       * Caer de vuelta a la página que la hipótesis proponía sería re-comprar lo
       * que la ronda 1 acaba de pagar: exactamente el gasto que este corte
       * elimina. La ronda 1, sus resultados y su gasto se conservan.
       */
      if (pageMoveNeeded && !requestedPageDeclared && netNewCursorPage > hypothesisPage) {
        secondRoundSkippedReason = 'net_new_pages_exhausted';
        break;
      }

      const distinct = compareEffective(round2Build);
      if (distinct === null) {
        // La ronda 2 no se pudo construir: su diversidad es indemostrable.
        effectiveFingerprintsAreDistinct = null;
        secondRoundSkippedReason = 'effective_request_fingerprint_unavailable';
        break;
      }
      effectiveFingerprintsAreDistinct = distinct;
      if (!distinct) {
        secondRoundSkippedReason = 'identical_provider_request';
        break;
      }
      hypothesis = round2;
      effectiveBuild = round2Build;
    }
    const requestPreview = effectiveBuild.preview;

    // § 2 — el contexto completo, no sólo el digest: la ronda y el sujeto viajan
    // hasta la fila económica.
    const searchOperationContext = buildApolloTwoRoundOperationContext({
      correlation,
      roundNumber,
      operationKey: 'organizations_search',
      subject: JSON.stringify(hypothesis.queryParameters),
    });

    const metrics = buildEmptyRoundMetrics(
      roundNumber,
      hypothesis.queryHypothesis,
      hypothesis.queryAdaptationReason,
      {
        subindustryCoverage: requestPreview?.subindustryCoverage ?? null,
        requestFingerprint: hypothesis.providerRequestFingerprint,
        // § 10 — la huella EFECTIVA queda registrada por ronda. Es la que la ronda
        // siguiente compara y la que el próximo QA puede auditar.
        effectiveRequestFingerprint: requestPreview?.effectiveRequestFingerprint ?? null,
        // HARDENING-3 § 4 y § 7 — y la CAUSA cuando falta, sanitizada.
        effectiveRequestBuildStatus: effectiveBuild.status,
        effectiveRequestBuildErrorCode: effectiveBuild.errorCode,
        page: requestPreview?.page ?? hypothesis.queryParameters.page,
        perPage: requestPreview?.perPage ?? null,
        // V2 — el PLAN de esta ronda queda en el checkpoint desde antes de
        // buscar: es la clave con la que la ronda siguiente lee el cursor.
        searchPlanFingerprint: requestPreview?.searchPlanFingerprint ?? null,
        // V3-A § 5 — la familia que esta ronda emitió queda en el checkpoint junto
        // al plan de búsqueda que produjo. Son el mismo hecho visto por sus dos
        // caras: la familia explica POR QUÉ el plan es distinto al de la ronda
        // anterior, y el plan es la clave con la que el cursor de página razona.
        macroQueryVariantKey: hypothesis.macroQueryVariantKey,
        macroQueryFamiliesAvailable: hypothesis.macroQueryFamiliesAvailable,
        specificTermsSent: hypothesis.queryParameters.keywordTags,
        effectiveKeywordsSent: requestPreview?.effectiveKeywordTags ?? [],
      },
    );

    /**
     * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 7 — fail-closed ANTES de gastar.
     *
     * El preview ya trae el veredicto porque lo calcula el mismo constructor que
     * gobierna la llamada real. Si el body efectivo no representa a todas las
     * subindustrias pedidas, la ronda se registra —para que el bloqueo sea legible
     * en vez de invisible— y la corrida se detiene sin emitir la búsqueda.
     *
     * Se comprueba en TODAS las rondas, no sólo en la primera: la ronda 2 cambia
     * los términos, y una variante que perdiera una subindustria sería otra
     * búsqueda pagada que omite un criterio elegido.
     */
    if (requestPreview?.subindustryCoverageBlockReason) {
      queryCoverageBlockReason = requestPreview.subindustryCoverageBlockReason;
      secondRoundSkippedReason = 'subindustry_query_coverage_incomplete';
      roundMetrics.push(metrics);
      break;
    }

    // § 12: una ronda ya completada por un intento anterior no se vuelve a
    // buscar. § 5: si de esa búsqueda quedaron organizaciones sin evaluar, se
    // evalúan ahora —la evaluación es gratis— en vez de registrar la ronda con
    // cero. Sin organizaciones pendientes se registra vacía, para que el reintento
    // sea legible en vez de invisible.
    if (!ledger.canExecute(searchOperationContext.operationId)) {
      const recovered = pendingRoundOrganizations.get(roundNumber) ?? null;
      if (recovered === null) {
        roundMetrics.push(metrics);
        continue;
      }
      await assessRoundOrganizations(roundNumber, metrics, recovered);
      // § A — cuenta ESTABLE: ver el comentario de `stableFinalizableCandidateCount()`.
      if ((await stableFinalizableCandidateCount()) >= targetEligibleCompanies) {
        if (roundNumber < config.maxRounds) secondRoundSkippedReason = 'target_reached';
        break;
      }
      continue;
    }

    const outcome = await deps.searchRound({
      roundNumber,
      hypothesis,
      requestedResultLimit,
      operationContext: searchOperationContext,
    });

    // § 5 — las organizaciones se anotan como PENDIENTES antes de cerrar la
    // operación, así que el checkpoint de la búsqueda ya las lleva. Sin esto, un
    // fallo entre ese checkpoint y el de la evaluación dejaba la búsqueda marcada
    // como completada y la ronda sin nada que recuperar: corrida vacía tras pagar.
    pendingRoundOrganizations.set(roundNumber, outcome.organizations);

    // § 3 — el usage log ya lo escribió la dependencia; ahora el ledger y el
    // checkpoint, juntos. Un cobro sin confirmar cierra la corrida aquí.
    const searchOutcomeState = await commitOperation(
      searchOperationContext,
      outcome.indeterminate === true ? 'indeterminate' : 'completed',
    );
    if (searchOutcomeState === 'indeterminate') {
      // Los créditos que el ledger interno SÍ registró se conservan: la búsqueda
      // pudo haberse cobrado, y descontarlos aquí escondería ese gasto.
      metrics.providerRequestCount = outcome.providerRequestCount;
      metrics.rawResultsReturned = outcome.organizations.length;
      metrics.internalRecordedCredits = outcome.internalRecordedCredits;
      // V2 — un desenlace indeterminado NO borra las páginas que sí salieron.
      // Son exactamente las que no pueden volver a pedirse.
      recordRoundPageConsumption(metrics, outcome);
      totalSearchCredits += outcome.internalRecordedCredits;
      roundMetrics.push(metrics);
      // La ronda queda registrada, así que ya no hay nada pendiente de ella: lo
      // que falta es conciliación manual, no recuperación.
      pendingRoundOrganizations.delete(roundNumber);
      break;
    }

    metrics.providerRequestCount = outcome.providerRequestCount;
    metrics.rawResultsReturned = outcome.organizations.length;
    metrics.internalRecordedCredits = outcome.internalRecordedCredits;
    metrics.providerTotalPages = outcome.providerTotalPages ?? null;
    recordRoundPageConsumption(metrics, outcome);
    totalSearchCredits += outcome.internalRecordedCredits;

    // ── Procesamiento barato, en el orden del § 4 ────────────────────────────
    await assessRoundOrganizations(roundNumber, metrics, outcome.organizations);

    // § 7: alcanzado el objetivo con gates baratos, la corrida no busca más.
    // § A — cuenta ESTABLE.
    if ((await stableFinalizableCandidateCount()) >= targetEligibleCompanies) {
      if (roundNumber < config.maxRounds) secondRoundSkippedReason = 'target_reached';
      break;
    }
  }

  /**
   * A1-APOLLO-NET-NEW-PAGINATION-V2 — anota en la ronda, y en el cursor de la
   * corrida, qué páginas dejó consumidas su búsqueda y de qué plan.
   *
   * La búsqueda que no informa desenlaces por página no aporta cursor: se
   * conserva el comportamiento previo al corte en vez de adivinar un número.
   */
  function recordRoundPageConsumption(
    metrics: ApolloTwoRoundRoundMetrics,
    outcome: RoundSearchOutcome,
  ): void {
    const consumption = outcome.consumedPages ?? null;
    if (consumption === null) return;
    /**
     * El plan al que pertenecen estas páginas es el que ESTA ronda construyó con
     * el mismo constructor que gobierna la llamada real
     * (`RoundProviderRequestPreview.searchPlanFingerprint`). No se toma la huella
     * que la búsqueda reporta: eso ataría el cursor a que dos capas calculen la
     * misma cadena, cuando lo que la corrida ya garantiza es que el request
     * construido ANTES de ejecutar es el que sale (HARDENING-3 § 2).
     */
    const planFingerprint = metrics.searchPlanFingerprint;
    if (planFingerprint === null) return;
    /**
     * Defensa en profundidad: si la búsqueda SÍ declaró un plan y no es éste, sus
     * páginas no se atribuyen a ninguno. Un cursor apuntando al plan equivocado
     * saltaría páginas que nadie pidió, o repetiría las que sí.
     */
    if (
      consumption.searchPlanFingerprint !== null &&
      consumption.searchPlanFingerprint !== planFingerprint
    ) {
      return;
    }
    metrics.lastConsumedPage = consumption.lastConsumedPage;
    searchPlanPageCursors = withApolloSearchPlanPageConsumption(searchPlanPageCursors, {
      searchPlanFingerprint: planFingerprint,
      lastConsumedPage: consumption.lastConsumedPage,
    });
  }

  /**
   * Evalúa las organizaciones de UNA ronda con los gates baratos, en el orden del
   * § 4, y registra sus métricas.
   *
   * Extraída del bucle porque tiene DOS llamadores: la ronda recién buscada y la
   * ronda cuya búsqueda ya se pagó pero cuya evaluación no llegó a registrarse.
   * Que los dos caminos compartan el código es lo que garantiza que un reintento
   * produzca el mismo veredicto que el intento original.
   */
  async function assessRoundOrganizations(
    roundNumber: number,
    metrics: ApolloTwoRoundRoundMetrics,
    organizations: readonly RawDiscoveredOrganization[],
  ): Promise<void> {
    // Las organizaciones ya están anotadas como pendientes (las anotó el bucle al
    // volver la búsqueda, o el estado recuperado). Aquí sólo se evalúan.
    const roundCandidates: TrackedCandidate[] = [];
    const identitiesInThisResponse = createSeenOrganizationRegistry();
    let localIdentities = identitiesInThisResponse;

    for (const organization of organizations) {
      // Tope de resultados crudos de la corrida. Se cuenta lo que efectivamente
      // se procesa, no lo que el proveedor devolvió de más.
      if (totalRawResults >= config.maxRawResultsPerRun) {
        tallyRejection(metrics, 'raw_result_cap_reached');
        continue;
      }
      totalRawResults++;

      // 1. Dedup dentro de la respuesta.
      const withinResponse = evaluateSeenOrganization(localIdentities, organization);
      if (withinResponse.seen) {
        metrics.normalizedResults++;
        tallyRejection(metrics, 'duplicate_within_response');
        observedRejectionReasons.add('duplicate_within_response');
        continue;
      }
      localIdentities = registerSeenOrganization(localIdentities, withinResponse.identity);

      // 2. Dedup contra rondas anteriores. La ronda 2 no puede procesar ni
      //    facturar de nuevo una organización que la ronda 1 ya vio.
      const acrossRounds = evaluateSeenOrganization(seenRegistry, organization);
      if (acrossRounds.seen) {
        metrics.normalizedResults++;
        tallyRejection(metrics, 'seen_in_previous_round');
        observedRejectionReasons.add('seen_in_previous_round');
        continue;
      }

      const identity = acrossRounds.identity;
      metrics.normalizedResults++;
      // § 4 / § 10 — nuevo es lo que superó AMBAS deduplicaciones. Un resultado
      // no puede contarse a la vez como nuevo y como repetido.
      metrics.newUniqueResults++;

      // 3-11. Resto de gates baratos, inyectados.
      const assessment = await deps.assessCandidate({ organization, identity, roundNumber });

      seenRegistry = registerSeenOrganization(seenRegistry, identity);

      const candidateKey = buildCandidateKey(identity, roundNumber, organization.providerRank);
      const eligible = isEligible(assessment.rejection, assessment.sectorEvidenceState);

      if (assessment.rejection !== null) {
        tallyRejection(metrics, assessment.rejection);
        observedRejectionReasons.add(assessment.rejection);
      }

      const candidate: TrackedCandidate = {
        candidateKey,
        roundNumber,
        providerRank: organization.providerRank,
        identity,
        assessment,
        sectorEvidenceState: assessment.sectorEvidenceState,
        eligible,
        becameEligibleAfterEnrichment: false,
        enrichmentExecuted: false,
        finallyRejectedOrDuplicated: assessment.rejection !== null,
        // § D — un gate barato y un sector contradictorio son rechazos con causa.
        // «Falta evidencia» todavía no lo es: eso es justo lo que el enrichment
        // existe para resolver.
        definitivelyRejected:
          assessment.rejection !== null ||
          assessment.sectorEvidenceState === 'sector_evidence_contradictory',
        definitiveRejectionReason:
          assessment.rejection ??
          (assessment.sectorEvidenceState === 'sector_evidence_contradictory'
            ? 'sector_evidence_contradictory'
            : null),
        finalGateEvaluated: false,
        // STABLE-TARGET-WRITER-PARITY § 5 — todavía nadie compró nada para este
        // candidato: mandan las señales gratuitas de la búsqueda.
        resolvedCompanyFields: null,
      };
      roundCandidates.push(candidate);
      tracked.push(candidate);
    }

    metrics.eligibleBeforeEnrichment = roundCandidates.filter((c) => c.eligible).length;
    // La fase de enrichment corre DESPUÉS de todas las rondas (§ 6), así que en
    // este punto lo elegible tras enrichment coincide con lo elegible barato. La
    // fase global lo actualiza cuando un enrichment cambia un veredicto.
    metrics.eligibleAfterEnrichment = metrics.eligibleBeforeEnrichment;
    metrics.newEligibleCompaniesAdded = metrics.eligibleBeforeEnrichment;
    roundMetrics.push(metrics);
    // Evaluadas y registradas: ya no hay nada pendiente de esta ronda.
    pendingRoundOrganizations.delete(roundNumber);

    // § 3 — la evaluación barata de la ronda es una transición recuperable: sin
    // este checkpoint, un fallo posterior obligaría a volver a buscar para
    // recuperar veredictos que no costaron nada calcular.
    await persistCheckpoint('round_assessment_completed', null);
  }

  if (config.maxRounds === 1 && secondRoundSkippedReason === null) {
    secondRoundSkippedReason = 'max_rounds_is_one';
  }

  // ── Fase global de enrichment (§ 6, opción recomendada) ─────────────────────
  //
  // Las señales GRATUITAS de ambas rondas se procesan primero; sólo entonces se
  // decide a quién se le compra evidencia. Enriquecer al final de la ronda 1
  // gastaba el presupuesto sin conocer todavía a los candidatos de la ronda 2,
  // así que un candidato débil de la primera ronda podía consumir los dos
  // créditos que un candidato fuerte de la segunda merecía más. Aquí compiten
  // todos contra todos, una sola vez.
  //
  // La ronda 2 se decide con gates baratos (`eligibleCount()`), no con
  // enrichment: es exactamente lo que el contrato permite y lo que evita pagar
  // por confirmar antes de saber si hacía falta buscar más.
  const roundMetricsByNumber = new Map(roundMetrics.map((m) => [m.roundNumber, m]));

  const globalFreeSignals: FreeCandidateSignals[] = tracked
    .filter(
      (c) =>
        c.assessment.rejection === null &&
        !c.enrichmentExecuted &&
        // § A — un candidato puede llegar aquí con el gate barato limpio y, a la
        // vez, ya RECHAZADO por `applyFinalGates` — posible desde que § A lo
        // invoca temprano, vía `stableFinalizableCandidateCount()`, en vez de sólo al final.
        // Antes de este hito era imposible llegar aquí con `definitivelyRejected
        // === true`: los gates finales corrían DESPUÉS de esta selección. Gastar
        // un enrichment en una empresa ya descartada por ownership o duplicidad
        // final no resuelve nada — el rechazo no depende de la evidencia que el
        // enrichment podría traer.
        !c.definitivelyRejected,
    )
    .map((c) => ({
      ...c.assessment.signals,
      candidateKey: c.candidateKey,
      roundNumber: c.roundNumber,
      providerRank: c.providerRank,
      sectorEvidenceState: c.sectorEvidenceState,
    }));

  const globalSelection = selectCandidatesForEnrichment({
    candidates: globalFreeSignals,
    remainingEnrichmentBudget,
    // § A — cuenta ESTABLE: decide si vale la pena seguir gastando en
    // enrichments con el mismo conteo que decide todas las demás paradas.
    eligibleCompaniesSoFar: await stableFinalizableCandidateCount(),
    targetEligibleCompanies: targetEligibleCompanies,
  });
  enrichmentSkips.push(...globalSelection.skipped);
  for (const entry of [...globalSelection.selected, ...globalSelection.skipped]) {
    const metricsForRound = roundMetricsByNumber.get(entry.roundNumber);
    if (metricsForRound) metricsForRound.enrichmentCandidates++;
  }

  for (const chosen of globalSelection.selected) {
    // § 4 — una operación indeterminada detiene los enrichments restantes: su
    // presupuesto ya no es conocido y seguir gastando sobre un cobro sin
    // confirmar es exactamente lo que no se puede hacer.
    if (hasIndeterminateOperation()) {
      enrichmentSkips.push({
        candidateKey: chosen.candidateKey,
        roundNumber: chosen.roundNumber,
        skippedReason: 'prior_operation_indeterminate',
      });
      continue;
    }

    // Parada dentro del propio bucle: si una llamada previa ya completó el
    // objetivo, las restantes no se ejecutan (§ 6). § A — cuenta ESTABLE.
    if ((await stableFinalizableCandidateCount()) >= targetEligibleCompanies) {
      enrichmentSkips.push({
        candidateKey: chosen.candidateKey,
        roundNumber: chosen.roundNumber,
        skippedReason: 'target_already_reached',
      });
      continue;
    }

    const candidate = tracked.find((c) => c.candidateKey === chosen.candidateKey);
    if (!candidate) continue;
    const metricsForRound = roundMetricsByNumber.get(candidate.roundNumber) ?? null;

    // § 2 — sujeto sanitizado y estable: id del proveedor, dominio normalizado o
    // clave de candidato. Nunca un timestamp, para que dos reintentos de la misma
    // operación produzcan la misma identidad.
    const enrichmentOperationContext = buildApolloTwoRoundOperationContext({
      correlation,
      roundNumber: candidate.roundNumber,
      operationKey: 'organization_enrichment',
      subject: buildApolloTwoRoundEnrichmentSubject({
        providerOrganizationId: candidate.identity.providerOrganizationId,
        normalizedDomain: candidate.identity.normalizedDomain,
        candidateKey: candidate.candidateKey,
      }),
    });
    // § 12: un enrichment ya ejecutado —o ya indeterminado— por un intento
    // anterior no se repite.
    if (!ledger.canExecute(enrichmentOperationContext.operationId)) {
      enrichmentSkips.push({
        candidateKey: chosen.candidateKey,
        roundNumber: chosen.roundNumber,
        skippedReason: 'known_duplicate',
      });
      continue;
    }

    const result = await deps.enrichCandidate({
      candidateKey: candidate.candidateKey,
      roundNumber: candidate.roundNumber,
      operationContext: enrichmentOperationContext,
      identity: candidate.identity,
    });

    enrichmentSelections.push(chosen);
    remainingEnrichmentBudget = Math.max(0, remainingEnrichmentBudget - 1);

    if (result.executed) {
      candidate.enrichmentExecuted = true;
      totalEnrichmentCredits += result.internalRecordedCredits;
      // STABLE-TARGET-WRITER-PARITY § 5 — lo que el enrichment RESOLVIÓ de los
      // campos obligatorios. Sin esto, un candidato al que este crédito acaba de
      // llenarle `employee_count` seguiría sin poder contar, y los enrichments
      // restantes se gastarían buscando un objetivo que ya estaba alcanzado.
      if (result.providerCompanyFields) {
        candidate.resolvedCompanyFields = { ...result.providerCompanyFields };
      }
      if (metricsForRound) {
        metricsForRound.enrichmentsExecuted++;
        metricsForRound.internalRecordedCredits += result.internalRecordedCredits;
      }
    }

    const enrichmentOutcomeState = await commitOperation(
      enrichmentOperationContext,
      result.indeterminate === true ? 'indeterminate' : 'completed',
    );
    if (enrichmentOutcomeState === 'indeterminate') {
      // El veredicto sectorial de una llamada cuyo resultado no se confirmó no se
      // aplica: sería decidir la elegibilidad con evidencia que no sabemos si
      // llegó. El candidato conserva su estado previo al enrichment.
      enrichmentFailedCount++;
      continue;
    }

    // § 4 — clasificación en cubetas, ANTES de aplicar el veredicto: un `noMatch`
    // no aporta evidencia utilizable y no debe contarse como "sector aún sin
    // confirmar", que implicaría que sí se evaluó con datos frescos.
    //
    // HARDENING-1 § 5 — el rechazo tiene cubeta propia. Antes «el enrichment
    // demostró que NO es del sector» y «el enrichment no bastó para confirmarlo»
    // caían en la misma cifra, y son desenlaces opuestos: en el primero ya no hay
    // nada que confirmar, en el segundo sí.
    if (result.noMatch === true) {
      enrichmentFailedCount++;
    } else if (result.sectorEvidenceState === 'sector_evidence_confirmed') {
      sectorConfirmedByEnrichmentCount++;
    } else if (result.sectorEvidenceState === 'sector_evidence_contradictory') {
      sectorRejectedAfterEnrichmentCount++;
    } else {
      sectorStillUnconfirmedAfterEnrichmentCount++;
    }

    candidate.sectorEvidenceState = result.sectorEvidenceState;
    const postRejection = result.postEnrichmentRejection ?? null;
    if (postRejection !== null) {
      if (metricsForRound) tallyRejection(metricsForRound, postRejection);
      observedRejectionReasons.add(postRejection);
      candidate.finallyRejectedOrDuplicated = true;
      candidate.definitivelyRejected = true;
      candidate.definitiveRejectionReason = postRejection;
      candidate.eligible = false;
      continue;
    }
    // § D — el enrichment pudo REVELAR una contradicción sectorial. Eso sí es un
    // rechazo con causa, y descalifica incluso para revisión.
    //
    // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § B.5 — y además SE CUENTA.
    //
    // Esta rama marcaba el rechazo y no lo tallyaba, así que el desglose por
    // ronda perdía al candidato: la corrida `7d92773b` cerró la ronda 2 con
    // 7 duplicados + 2 ownership = 9 sobre 10 empresas únicas, y la décima
    // (`instaleap`, contradictoria tras el enrichment) no aparecía en ninguna
    // fila. `run_metrics.sector_rejected_after_enrichment` decía 1 y
    // `rounds[].sector_rejected` decía 0.
    //
    // No hay doble conteo: la rama de `postRejection` de arriba ya tallya y
    // corta con `continue`, así que este camino es mutuamente excluyente con
    // ella. Los gates finales de más abajo tampoco lo re-tallyan: sólo actúan
    // sobre candidatos aún elegibles, y éste ya no lo es.
    if (result.sectorEvidenceState === 'sector_evidence_contradictory') {
      candidate.definitivelyRejected = true;
      candidate.definitiveRejectionReason = 'sector_evidence_contradictory';
      if (metricsForRound) tallyRejection(metricsForRound, 'sector_evidence_contradictory');
      observedRejectionReasons.add('sector_evidence_contradictory');
    }
    // SECTOR-EVIDENCE-BOOTSTRAP-1 — el desenlace del bootstrap, con nombre.
    //
    // Un candidato que compitió por ADQUIRIR su clasificación termina aquí cuando,
    // pagada la adquisición, el sector sigue sin política que aplique: eso es un
    // rechazo sectorial con causa, no una duda pendiente, y no puede persistirse
    // como `needs_review`. Sin esta rama caería en `insufficient_evidence_not_
    // enriched_final`, cuyo nombre afirma que nunca llegó a competir — y sí compitió,
    // y se pagó por él.
    //
    // Inalcanzable para las corridas con política de sector: ahí `sector_not_mapped`
    // es un rechazo BARATO, así que el candidato jamás llega a la fase de enrichment.
    if (result.sectorEvidenceState === 'sector_not_mapped') {
      candidate.definitivelyRejected = true;
      candidate.definitiveRejectionReason = 'sector_not_mapped';
      if (metricsForRound) tallyRejection(metricsForRound, 'sector_not_mapped');
      observedRejectionReasons.add('sector_not_mapped');
    }
    const nowEligible = isEligible(candidate.assessment.rejection, result.sectorEvidenceState);
    if (nowEligible && !candidate.eligible) {
      candidate.eligible = true;
      candidate.becameEligibleAfterEnrichment = true;
    }
    if (!nowEligible) {
      // El enrichment se pagó y la empresa sigue sin confirmarse: eso es
      // exactamente `enrichmentWaste`, y así queda contado.
      //
      // § D — `finallyRejectedOrDuplicated` NO implica rechazo definitivo. Si
      // aquí no se marcó `definitivelyRejected`, esta empresa quedó AMBIGUA tras
      // pagar por resolverla, y se persistirá como `needs_review`.
      candidate.finallyRejectedOrDuplicated = true;
      // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § D — un rechazo DEFINITIVO no
      // puede convivir con `eligible: true`. La rama de `postRejection` ya lo
      // hacía; ésta no, y un candidato elegible antes del enrichment cuya
      // evidencia lo contradice después habría quedado contado como elegible en
      // `eligibleAfterEnrichment`.
      if (candidate.definitivelyRejected) candidate.eligible = false;
    }
  }

  // ── HARDENING-1 § 5 — gates FINALES ────────────────────────────────────────
  //
  // Orden del contrato: reevaluación sectorial → ownership → calidad / encaje de
  // negocio → elegibilidad final → writer. Hasta aquí el ownership sólo se
  // evaluaba con los datos de la BÚSQUEDA; el veredicto definitivo lo emitía el
  // writer, ya fuera del alcance de estas métricas. Por eso la corrida
  // `be181d2d` publicó tres persistidos y escribió dos.
  //
  // Se aplica sólo sobre quien sigue siendo elegible: a un candidato ya
  // descartado no hay nada que volver a rechazarle, y re-tallyarlo lo contaría
  // dos veces en el desglose de la ronda.
  //
  // § D — los gates finales se aplican TAMBIÉN a las empresas que sólo irían a
  // revisión. El contrato es explícito: un rechazo de ownership, país,
  // duplicidad o calidad no se persiste ni siquiera como `needs_review`. Sin
  // esto, una empresa rechazada por ownership entraría en la base disfrazada de
  // duda pendiente.
  const isReviewOnlyCohort = (candidate: TrackedCandidate): boolean =>
    !candidate.eligible &&
    !candidate.definitivelyRejected &&
    candidate.enrichmentExecuted &&
    candidate.sectorEvidenceState === 'sector_evidence_missing_needs_enrichment';

  // § A — a estas alturas, todo candidato que en algún momento fue elegible ya
  // pasó por `ensureFinalGateEvaluated` (vía `stableFinalizableCandidateCount()`, invocada
  // antes de cada parada). Este barrido ya no repite esa llamada — el flag
  // `finalGateEvaluated` lo evita — y sólo le queda resolver la cohorte de
  // revisión, que nunca participa de `eligibleCount()` y por tanto nunca pasó
  // por una parada.
  if (deps.applyFinalGates) {
    for (const candidate of tracked) {
      if (candidate.eligible) {
        await ensureFinalGateEvaluated(candidate);
        continue;
      }
      if (!isReviewOnlyCohort(candidate) || candidate.finalGateEvaluated) continue;
      candidate.finalGateEvaluated = true;
      const verdict = await deps.applyFinalGates({
        candidateKey: candidate.candidateKey,
        roundNumber: candidate.roundNumber,
        identity: candidate.identity,
      });
      if (verdict.rejection === null) continue;
      observedRejectionReasons.add(verdict.rejection);
      candidate.definitivelyRejected = true;
      candidate.definitiveRejectionReason = verdict.rejection;
      candidate.finallyRejectedOrDuplicated = true;
      // La cohorte de revisión ya es `!eligible`: no hay nada más que voltear,
      // y el desglose por ronda sólo cuenta rechazos de candidatos que SÍ eran
      // elegibles (ver `ensureFinalGateEvaluated`).
    }
  }

  // Las métricas por ronda se recalculan tras la fase global: un enrichment pudo
  // volver elegible a un candidato de cualquiera de las dos rondas.
  for (const metricsForRound of roundMetrics) {
    const ofRound = tracked.filter((c) => c.roundNumber === metricsForRound.roundNumber);
    metricsForRound.eligibleAfterEnrichment = ofRound.filter((c) => c.eligible).length;
    metricsForRound.newEligibleCompaniesAdded = metricsForRound.eligibleAfterEnrichment;
  }

  // ── Acumulación y ranking final (§ 9) ───────────────────────────────────────
  const eligibleCompanies = tracked.filter((c) => c.eligible);
  const finalSignals: FinalRankingSignals[] = eligibleCompanies.map((c) => ({
    ...c.assessment.signals,
    candidateKey: c.candidateKey,
    roundNumber: c.roundNumber,
    providerRank: c.providerRank,
    sectorEvidenceState: c.sectorEvidenceState,
    noPriorSuggestion: c.assessment.noPriorSuggestion,
  }));

  const ranked = rankFinalEligibleCompanies(finalSignals, targetEligibleCompanies);
  const byKey = new Map(eligibleCompanies.map((c) => [c.candidateKey, c]));

  // `explicit` permite acumular a un candidato que NO está en `byKey`: ese mapa
  // sólo contiene elegibles, y la cohorte de revisión (§ D) por definición no lo es.
  const toAccumulated = (
    candidateKey: string,
    explicit?: TrackedCandidate,
  ): AccumulatedCompany | null => {
    const candidate = explicit ?? byKey.get(candidateKey);
    if (!candidate) return null;
    return {
      candidateKey: candidate.candidateKey,
      roundNumber: candidate.roundNumber,
      providerRank: candidate.providerRank,
      identity: candidate.identity,
      sectorEvidenceState: candidate.sectorEvidenceState,
      becameEligibleAfterEnrichment: candidate.becameEligibleAfterEnrichment,
    };
  };

  const persisted = ranked.persisted
    .map((entry) => toAccumulated(entry.candidateKey))
    .filter((entry): entry is AccumulatedCompany => entry !== null);
  const notPersisted = ranked.notPersisted
    .map((entry) => {
      const accumulated = toAccumulated(entry.candidateKey);
      return accumulated === null
        ? null
        : { ...accumulated, reason: 'eligible_not_persisted_due_to_target_cap' as const };
    })
    .filter(
      (entry): entry is AccumulatedCompany & {
        reason: 'eligible_not_persisted_due_to_target_cap';
      } => entry !== null,
    );

  // § D — cohorte de revisión, calculada DESPUÉS de los gates finales para que
  // ninguna empresa con rechazo definitivo se cuele en ella. El orden importa: en
  // el orden inverso, la rechazada por ownership del `be181d2d` habría entrado.
  const reviewOnly: ReviewOnlyCompany[] = tracked
    .filter(isReviewOnlyCohort)
    .map((candidate) => {
      const accumulated = toAccumulated(candidate.candidateKey, candidate);
      return accumulated === null
        ? null
        : {
            ...accumulated,
            reviewReason: 'subindustry_ambiguous_after_enrichment' as const,
          };
    })
    .filter((entry): entry is ReviewOnlyCompany => entry !== null);

  const eligibleCompaniesFound = eligibleCompanies.length;
  /**
   * STABLE-TARGET-WRITER-PARITY §§ 3 y 11 — el objetivo se declara alcanzado con
   * la cuenta ESTABLE, no con la de elegibles.
   *
   * `eligibleCompaniesFound` sigue existiendo y sigue significando lo mismo
   * —candidatos con los gates baratos limpios, el sector confirmado y los gates
   * finales resueltos—, pero ya no decide nada económico: un elegible al que le
   * falta `employee_count` o LinkedIn se persiste, se revisa, y NO alcanza el
   * objetivo. Confundir las dos cifras es exactamente lo que hacía que una
   * corrida con 3 candidatos completos se declarara cerrada en 5.
   */
  const finalizability = await scanFinalizability();
  const stableFinalizableCandidates = finalizability.stable;
  const projectedGap = Math.max(0, targetEligibleCompanies - stableFinalizableCandidates);
  const targetReached = stableFinalizableCandidates >= targetEligibleCompanies;

  const enrichmentOutcomes: EnrichmentOutcome[] = tracked.map((c) => ({
    candidateKey: c.candidateKey,
    enrichmentExecuted: c.enrichmentExecuted,
    finallyRejectedOrDuplicated: c.finallyRejectedOrDuplicated,
  }));

  const manualReconciliationRequired = indeterminateOperations.length > 0;

  // § 3 — último checkpoint de la corrida. Los candidatos aún no se han escrito;
  // ese paso lo sella el adaptador con su propio checkpoint.
  await persistCheckpoint('run_completed', null);

  return {
    resultStatus: manualReconciliationRequired
      ? 'apollo_operation_indeterminate'
      : targetReached
        ? 'target_reached'
        : 'partial_target_not_reached',
    targetEligibleCompanies,
    configuredTargetEligibleCompanies: config.targetEligibleCompanies,
    remainingTargetApplied,
    eligibleCompaniesFound,
    stableFinalizableCandidateCount: stableFinalizableCandidates,
    projectedFinalizableCandidateCount: finalizability.projected,
    writerOnlyPendingCount: finalizability.writerOnlyPending,
    writerOnlyPendingReasons: finalizability.writerOnlyPendingReasons,
    preWriterAdmissionPassCount: finalizability.admissionPassCount,
    preWriterAdmissionFailedCount: finalizability.admissionFailedCount,
    preWriterAdmissionPendingCount: finalizability.admissionPendingCount,
    projectedTargetGap: projectedGap,
    persistedCandidates: persisted.length,
    roundsExecuted: roundMetrics.length,
    targetReached,
    partialResultReason: targetReached ? null : 'partial_target_not_reached',
    secondRoundSkippedReason,
    queryCoverageBlockReason,
    effectiveFingerprintsAreDistinct,
    round2PageDecision,
    persisted,
    reviewOnly,
    notPersisted,
    rounds: roundMetrics,
    runMetrics: buildRunMetrics({
      rounds: roundMetrics,
      totalUniqueOrganizations: tracked.length,
      totalEligibleCompanies: eligibleCompaniesFound,
      persistedCandidates: persisted.length,
      totalSearchCredits,
      totalEnrichmentCredits,
      enrichmentOutcomes,
      effectiveFingerprintsAreDistinct,
      sectorConfirmedByEnrichment: sectorConfirmedByEnrichmentCount,
      sectorStillUnconfirmedAfterEnrichment: sectorStillUnconfirmedAfterEnrichmentCount,
      sectorRejectedAfterEnrichment: sectorRejectedAfterEnrichmentCount,
      enrichmentFailedCount,
      targetEligibleCompanies: targetEligibleCompanies,
      // §§ 3 y 11 — la cuenta estable viaja EXPLÍCITA. Hasta este hito
      // `buildRunMetrics` la aliaseaba a `totalEligibleCompanies`, así que la
      // métrica que decía «estable» era la provisional con otro nombre.
      stableFinalizableCandidateCount: stableFinalizableCandidates,
      // WRITER-ONLY-ADMISSION-PENDING § 8 — la proyección y el motivo de que no
      // sea estable, cada uno con su nombre. Ninguno puede detener gasto.
      projectedFinalizableCandidateCount: finalizability.projected,
      writerOnlyPendingCount: finalizability.writerOnlyPending,
      writerOnlyPendingReasons: finalizability.writerOnlyPendingReasons,
      // ADAPTIVE-EARLY-STOP § 11 — cuántas admisiones se resolvieron de verdad.
      preWriterAdmissionPassCount: finalizability.admissionPassCount,
      preWriterAdmissionFailedCount: finalizability.admissionFailedCount,
      preWriterAdmissionPendingCount: finalizability.admissionPendingCount,
    }),
    enrichmentSelections,
    enrichmentSkips,
    // Se devuelven para que un reintento con el mismo `idempotencyKey` reconozca
    // lo ya ejecutado y no lo repita (§ 12).
    completedOperationKeys: ledger.completedKeys,
    indeterminateOperationKeys: ledger.indeterminateKeys,
    indeterminateOperations,
    manualReconciliationRequired,
    checkpointWriteFailures,
    evaluatedCandidates: tracked.map((c) => ({
      candidateKey: c.candidateKey,
      roundNumber: c.roundNumber,
      providerRank: c.providerRank,
      identity: c.identity,
      assessment: c.assessment,
      sectorEvidenceState: c.sectorEvidenceState,
      eligible: c.eligible,
      becameEligibleAfterEnrichment: c.becameEligibleAfterEnrichment,
      enrichmentExecuted: c.enrichmentExecuted,
      finallyRejectedOrDuplicated: c.finallyRejectedOrDuplicated,
      definitivelyRejected: c.definitivelyRejected,
      definitiveRejectionReason: c.definitiveRejectionReason,
    })),
    observedRejectionReasons: [...observedRejectionReasons],
  };
}
