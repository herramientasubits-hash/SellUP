/**
 * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — contrato de completitud del candidato y
 * regla de conteo hacia el target.
 *
 * Puro: sin I/O, sin reloj, sin proveedor.
 *
 * Por qué existe:
 *   «Persistido» y «completo» no son lo mismo. La corrida del 5 de agosto
 *   persistió dos candidatos sin LinkedIn ni número de empleados y los contó
 *   igual que a un candidato completo. Un candidato incompleto puede persistirse
 *   —con `needs_review`— pero no puede inflar el target.
 *
 * Fail-closed: cualquier condición desconocida NO cuenta. Nada aquí adivina.
 */

import type { CompanyFieldMappingStatus } from './apollo-company-fields-mapping';
import type {
  ApolloSubindustryPrecisionAssessment,
  RequestedSubindustryEvaluation,
  SubindustryMatchFamily,
} from './apollo-subindustry-precision';

// ─── Entradas de la regla (§ 5 del addendum) ──────────────────────────────────

export type GateVerdict = 'pass' | 'fail' | 'unknown';
export type SubindustryMatchVerdict = 'confirmed' | 'not_confirmed' | 'unknown';

/**
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · STABLE-TARGET-WRITER-PARITY § 2 —
 * las condiciones del contrato, en su orden, como DATO.
 *
 * Existen como constante enumerable porque hay dos consumidores que tienen que
 * hablar de ellas por nombre y no sólo evaluarlas: el orquestador —que declara
 * cuáles todavía no puede resolver— y el writer —que las resuelve todas—. Una
 * lista implícita en el cuerpo de la función no se puede declarar como
 * pendiente.
 */
export const CANDIDATE_TARGET_CONDITIONS = [
  'persistence_success',
  'subindustry_match',
  'employee_count_status',
  'linkedin_status',
  'duplicate_status',
  'ownership_gate',
  'quality_gate',
] as const;

export type CandidateTargetCondition = (typeof CANDIDATE_TARGET_CONDITIONS)[number];

/**
 * § 2 — las condiciones del contrato que NO son `persistence_success`.
 *
 * Son exactamente las que un consumidor PRE-writer puede evaluar: la única
 * diferencia legítima entre la evaluación de antes y la de después de escribir
 * es si la fila llegó a la base.
 */
export const CANDIDATE_PRE_PERSISTENCE_TARGET_CONDITIONS: readonly CandidateTargetCondition[] =
  CANDIDATE_TARGET_CONDITIONS.filter((condition) => condition !== 'persistence_success');

/**
 * § 2 — estado de UNA condición.
 *
 *   `satisfied` — se evaluó y se cumple.
 *   `failed`    — se evaluó y NO se cumple.
 *   `pending`   — todavía no se puede saber. NO es «se cumple»: un pendiente
 *                 nunca cuenta hacia el objetivo.
 *
 * `pending` sólo aparece cuando el llamador lo DECLARA (`pendingConditions`).
 * Ningún veredicto se degrada solo: un `unknown` de gate o un
 * `duplicateStatus` nulo siguen siendo `failed`, exactamente como antes de este
 * hito, porque son respuestas —«no lo demostró»— y no ausencias de respuesta.
 */
export type CandidateTargetConditionStatus = 'satisfied' | 'failed' | 'pending';

export type CandidateTargetEligibilityInput = {
  persistenceSuccess: boolean;
  subindustryMatch: SubindustryMatchVerdict;
  employeeCountStatus: CompanyFieldMappingStatus;
  linkedinStatus: CompanyFieldMappingStatus;
  /** Valor tal como se persiste en `prospect_candidates.duplicate_status`. */
  duplicateStatus: string | null;
  ownershipGate: GateVerdict;
  qualityGate: GateVerdict;
  /**
   * § 2 — condiciones que este llamador todavía NO puede resolver.
   *
   * Es lo que hace posible que el orquestador use ESTA función —la misma que
   * usa el writer— sin tener que inventar un veredicto para lo que sólo el
   * writer sabe. Fail-closed: una condición declarada pendiente impide contar,
   * igual que una fallida, y se reporta aparte para que la causa sea legible.
   *
   * Ausente ⇒ ninguna condición pendiente: es el caso del writer, que las
   * resuelve todas, y el comportamiento histórico de esta función.
   */
  pendingConditions?: readonly CandidateTargetCondition[];
};

export type CandidateTargetEligibility = {
  countsTowardTarget: boolean;
  /**
   * Condiciones que no se cumplieron, en el orden del contrato.
   *
   * Incluye las PENDIENTES: para un contador agregado, «no se cumplió» y «no se
   * pudo saber» tienen el mismo efecto —no cuenta— y separarlas aquí habría
   * cambiado `failed_condition_counts` para todo consumidor ya escrito.
   * `strictlyFailedConditions` y `pendingConditions` llevan el desglose.
   */
  failedConditions: string[];
  // ── STABLE-TARGET-WRITER-PARITY § 1 — campos del contrato canónico ──────────
  /**
   * § 3 — el ÚNICO booleano que puede detener gasto. `true` sólo cuando las
   * SIETE condiciones están satisfechas: ni una fallida, ni una pendiente.
   */
  eligibleForTarget: boolean;
  /** Estado de cada condición, por nombre. Nada se deduce; todo se declara. */
  conditionStates: Record<CandidateTargetCondition, CandidateTargetConditionStatus>;
  /** Condiciones evaluadas y NO cumplidas, sin las pendientes. */
  strictlyFailedConditions: string[];
  /** Condiciones que todavía no se pueden saber, en el orden del contrato. */
  pendingConditions: string[];
  /**
   * § 10 — verdad determinista PRE-persistencia: todas las condiciones salvo
   * `persistence_success` están satisfechas.
   *
   * Es lo que un consumidor pre-writer puede afirmar honestamente. Un fallo de
   * base posterior lo desmiente para esa fila —`eligibleForTarget` pasa a
   * `false`— sin invalidar la decisión que se tomó antes de escribir.
   */
  countsTowardTargetIfPersisted: boolean;
  /**
   * `completeValid` y `countsTowardTarget` son el MISMO booleano con dos
   * nombres (ver `CandidateCanonicalTargetEligibility`); éste es su proyección
   * pre-persistencia.
   */
  completeValidIfPersisted: boolean;
};

/** Único valor de duplicado que el contrato acepta. */
const REQUIRED_DUPLICATE_STATUS = 'no_match';

/**
 * Evalúa si un candidato cuenta hacia el target de la modalidad QA.
 *
 * FUNCIÓN CANÓNICA ÚNICA (STABLE-TARGET-WRITER-PARITY § 1). No existe —ni puede
 * existir— una segunda implementación de esta decisión: el orquestador la usa
 * para decidir si puede dejar de gastar, y el writer para decidir si la fila
 * cuenta. Antes de este hito eran dos semánticas distintas, y la del
 * orquestador era más laxa: bastaba «sector confirmado» para detener
 * enrichments que el writer iba a dejar en `needs_review`.
 *
 * La conjunción es exactamente la del contrato; ninguna condición se pondera ni
 * se compensa con otra.
 */
export function evaluateCandidateTargetEligibility(
  input: CandidateTargetEligibilityInput,
): CandidateTargetEligibility {
  const declaredPending = new Set<CandidateTargetCondition>(input.pendingConditions ?? []);

  /** Veredicto crudo de cada condición, antes de aplicar lo declarado pendiente. */
  const satisfied: Record<CandidateTargetCondition, boolean> = {
    persistence_success: input.persistenceSuccess,
    subindustry_match: input.subindustryMatch === 'confirmed',
    employee_count_status: input.employeeCountStatus === 'confirmed',
    linkedin_status: input.linkedinStatus === 'confirmed',
    duplicate_status: input.duplicateStatus === REQUIRED_DUPLICATE_STATUS,
    ownership_gate: input.ownershipGate === 'pass',
    quality_gate: input.qualityGate === 'pass',
  };

  const conditionStates = {} as Record<CandidateTargetCondition, CandidateTargetConditionStatus>;
  const failedConditions: string[] = [];
  const strictlyFailedConditions: string[] = [];
  const pendingConditions: string[] = [];

  for (const condition of CANDIDATE_TARGET_CONDITIONS) {
    const state: CandidateTargetConditionStatus = declaredPending.has(condition)
      ? 'pending'
      : satisfied[condition]
        ? 'satisfied'
        : 'failed';
    conditionStates[condition] = state;
    if (state === 'satisfied') continue;
    failedConditions.push(condition);
    if (state === 'pending') pendingConditions.push(condition);
    else strictlyFailedConditions.push(condition);
  }

  const countsTowardTargetIfPersisted = CANDIDATE_PRE_PERSISTENCE_TARGET_CONDITIONS.every(
    (condition) => conditionStates[condition] === 'satisfied',
  );
  const eligibleForTarget =
    countsTowardTargetIfPersisted && conditionStates.persistence_success === 'satisfied';

  return {
    countsTowardTarget: eligibleForTarget,
    failedConditions,
    eligibleForTarget,
    conditionStates,
    strictlyFailedConditions,
    pendingConditions,
    countsTowardTargetIfPersisted,
    completeValidIfPersisted: countsTowardTargetIfPersisted,
  };
}

/** Traduce el estado de evidencia sectorial de la modalidad al veredicto del contrato. */
export function toSubindustryMatchVerdict(
  sectorEvidenceState: string | null | undefined,
): SubindustryMatchVerdict {
  if (sectorEvidenceState === undefined || sectorEvidenceState === null) return 'unknown';
  return sectorEvidenceState === 'sector_evidence_confirmed' ? 'confirmed' : 'not_confirmed';
}

// ─── AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 3 ────────────────────
//
// El defecto que esta sección cierra: `toSubindustryMatchVerdict` sólo conoce
// `sectorEvidenceState`, un veredicto de RELEVANCIA SECTORIAL/de INDUSTRIA que
// el gate sectorial (`apollo-sector-relevance-gate.ts`) confirma con señales
// amplias. Cuando la búsqueda pide una SUBINDUSTRIA específica y esa
// subindustria no tiene catálogo de anclas propio
// (`assessApolloSubindustryPrecision` → `subindustryMapped: false`), el pliegue
// (`foldSubindustryPrecisionIntoSectorState`) deja `sectorEvidenceState` tal
// cual —a propósito, para no romper búsquedas SIN subindustria— y ese
// veredicto de industria, subindustria-ciego, se leía como si demostrara la
// subindustria pedida. Así contaron hacia el objetivo, sin subindustria
// confirmada, tres de cuatro candidatos de la corrida `8c86eb06…`.
//
// La corrección NO cambia `toSubindustryMatchVerdict` ni `sectorEvidenceState`
// —ambos siguen siendo correctos para búsquedas SIN subindustria— sino que
// añade la resolución que faltaba: cuando SÍ se pidió una subindustria, el
// veredicto que decide el conteo es el de `ApolloSubindustryPrecisionAssessment`
// —ya calculado, ya fail-closed (§ 3 de HARDENING-1) y ya persistido en
// `metadata.apollo_enrichment_capture.precision`— y no el estado de industria.

/**
 * Veredicto de subindustria para el conteo.
 *
 * `unmapped` y `evaluation_unavailable` son estados PROPIOS, no matices de
 * `ambiguous`, porque exigen acciones distintas: la primera pide un mapeo nuevo
 * en el catálogo, la segunda dice que la evaluación no llegó a ocurrir. Ninguno
 * de los dos cuenta.
 */
export type SubindustryRequirementMatch =
  | 'confirmed'
  | 'ambiguous'
  | 'unmapped'
  | 'rejected'
  | 'evaluation_unavailable'
  | 'not_requested';

/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 5 — causa ESPECÍFICA de que
 * la subindustria no cuente.
 *
 * La condición del contrato es siempre `subindustry_match`; este código dice por
 * qué. Sin él, la ficha tenía que adivinar la causa desde `subindustry_mapped` y
 * no podía distinguir «rechazada» de «ambigua» —el contrasentido que el § 5
 * prohíbe mostrar—.
 */
export type SubindustryBlockingReason =
  | 'subindustry_ambiguous'
  | 'subindustry_not_mapped'
  | 'subindustry_rejected'
  | 'subindustry_evaluation_unavailable';

export type CandidateSubindustryRequirementResult = {
  /** `true` cuando la búsqueda declaró al menos una subindustria. */
  subindustryRequirementApplied: boolean;
  /** Subindustrias pedidas, saneadas. Vacío cuando no se pidió ninguna. */
  requestedSubindustries: string[];
  /** § 2 — veredicto de CADA subindustria pedida. Ninguna selección se descarta. */
  perRequestedSubindustryEvaluations: RequestedSubindustryEvaluation[];
  /** § 2 — la subindustria pedida que confirmó. `null` cuando ninguna confirmó. */
  matchedRequestedSubindustry: string | null;
  /** § 2 — familia que produjo la confirmación, para subindustrias compuestas. */
  matchedSubindustryFamily: SubindustryMatchFamily;
  /** La subindustria pedida tiene catálogo de anclas propio. `false` cuando no se pidió ninguna. */
  subindustryMapped: boolean;
  subindustryMatch: SubindustryRequirementMatch;
  /** `null` cuando la subindustria NO bloquea (confirmada, o no se pidió ninguna). */
  subindustryBlockingReason: SubindustryBlockingReason | null;
  /** Veredicto de dos estados que consume `evaluateCandidateTargetEligibility`. */
  eligibilityVerdict: SubindustryMatchVerdict;
};

/** Compara etiquetas de subindustria sin depender de tildes, caja ni espacios. */
function subindustryLabelKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeRequestedSubindustries(
  requested: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!Array.isArray(requested)) return [];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const entry of requested) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const key = subindustryLabelKey(trimmed);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    labels.push(trimmed);
  }
  return labels;
}

/**
 * Resuelve, para UN candidato, si la subindustria pedida cuenta hacia el
 * objetivo.
 *
 * Invariantes (§ 2 del addendum):
 *
 *   A. subindustryMatch = 'confirmed' es OBLIGATORIO para contar, cuando se
 *      pidió una subindustria.
 *   B/D. 'ambiguous' o subindustryMapped = false → NO cuenta, se persiste
 *      `needs_review`. Nunca se sustituye por el veredicto de industria.
 *   C. 'rejected' → no llega aquí: el candidato no se persiste.
 *   E. `industryMatch = 'confirmed'` (dentro de `precision`) NUNCA convierte un
 *      `subindustryMatch` ambiguo o no mapeado en confirmado: no se lee en
 *      absoluto para esta decisión.
 *
 * Cuando NO se pidió subindustria, la pregunta no aplica: el veredicto de
 * relevancia sectorial/de industria de siempre (`sectorEvidenceState`) sigue
 * decidiendo, exactamente como antes de este cambio.
 */
export function resolveCandidateSubindustryRequirement(input: {
  sectorEvidenceState: string | null | undefined;
  /**
   * § 3 — subindustrias que la BÚSQUEDA pidió, según el request, no según lo que
   * el proveedor alcanzó a evaluar.
   *
   * Es la entrada que hace posible el fail-closed explícito: sin ella, «no se
   * pidió subindustria» y «se pidió y nadie la evaluó» eran indistinguibles, y
   * el segundo caso caía a `sectorEvidenceState` —el veredicto de INDUSTRIA— y
   * contaba. Omitirla conserva el comportamiento histórico (se deduce del
   * assessment), pero todo consumidor de producción debe pasarla.
   */
  requestedSubindustries?: readonly (string | null | undefined)[] | null;
  /** `null` cuando no hay assessment de Apollo para este candidato (otra vía, u otro proveedor). */
  subindustryPrecision: ApolloSubindustryPrecisionAssessment | null;
}): CandidateSubindustryRequirementResult {
  const precision = input.subindustryPrecision;

  const requestedFromInput = sanitizeRequestedSubindustries(input.requestedSubindustries);
  const requestedFromPrecision = sanitizeRequestedSubindustries(
    precision === null
      ? []
      : precision.requestedSubindustries.length > 0
        ? precision.requestedSubindustries
        : [precision.requestedSubindustry],
  );
  const requestedSubindustries =
    requestedFromInput.length > 0 ? requestedFromInput : requestedFromPrecision;

  // ── No se pidió subindustria: la pregunta no aplica y nada cambia ──────────
  if (requestedSubindustries.length === 0) {
    return {
      subindustryRequirementApplied: false,
      requestedSubindustries: [],
      perRequestedSubindustryEvaluations: [],
      matchedRequestedSubindustry: null,
      matchedSubindustryFamily: 'none',
      subindustryMapped: false,
      subindustryMatch: 'not_requested',
      subindustryBlockingReason: null,
      eligibilityVerdict: toSubindustryMatchVerdict(input.sectorEvidenceState),
    };
  }

  /**
   * § 3 — la subindustria se pidió pero NO hay veredicto que la responda.
   *
   * Tres formas de llegar aquí, y las tres acaban igual: no cuenta.
   *
   *   1. otro proveedor (Tavily/legacy) que nunca calcula precisión;
   *   2. el capture de Apollo llegó sin `precision`;
   *   3. la precisión se calculó SIN subindustria (`requestedSubindustry: null`)
   *      aunque la búsqueda sí pidió una.
   *
   * Lo que NO se hace, y es el defecto que este § cierra: caer a
   * `sectorEvidenceState`. Ese estado es el veredicto de INDUSTRIA; leerlo aquí
   * afirmaría una pertenencia que nadie midió.
   */
  const unavailable = (): CandidateSubindustryRequirementResult => ({
    subindustryRequirementApplied: true,
    requestedSubindustries,
    perRequestedSubindustryEvaluations: [],
    matchedRequestedSubindustry: null,
    matchedSubindustryFamily: 'none',
    subindustryMapped: false,
    subindustryMatch: 'evaluation_unavailable',
    subindustryBlockingReason: 'subindustry_evaluation_unavailable',
    eligibilityVerdict: 'not_confirmed',
  });

  if (precision === null || precision.requestedSubindustry === null) return unavailable();

  const mapped = precision.subindustryMapped;
  const match = precision.subindustryMatch;

  // Fail-closed ante un desajuste de cableado: una confirmación sólo cuenta si la
  // subindustria que confirmó es una de las PEDIDAS. Inerte en producción —el
  // writer y el runner leen la misma lista— y la única red si algún día dejan de
  // hacerlo, porque el desenlace inseguro sería contar la confirmación de una
  // subindustria que el usuario no eligió.
  const requestedKeys = new Set(requestedSubindustries.map(subindustryLabelKey));
  const confirmedLabel = precision.matchedRequestedSubindustry ?? precision.requestedSubindustry;
  if (match === 'confirmed' && !requestedKeys.has(subindustryLabelKey(confirmedLabel))) {
    return unavailable();
  }

  const confirmed = mapped && match === 'confirmed';
  const reportedMatch: SubindustryRequirementMatch = confirmed
    ? 'confirmed'
    : match === 'rejected'
      ? 'rejected'
      : mapped
        ? 'ambiguous'
        : 'unmapped';

  return {
    subindustryRequirementApplied: true,
    requestedSubindustries,
    perRequestedSubindustryEvaluations: precision.perRequestedSubindustryEvaluations,
    matchedRequestedSubindustry: confirmed ? confirmedLabel : null,
    matchedSubindustryFamily: confirmed ? precision.subindustryMatchFamily : 'none',
    subindustryMapped: mapped,
    subindustryMatch: reportedMatch,
    subindustryBlockingReason: confirmed
      ? null
      : reportedMatch === 'rejected'
        ? 'subindustry_rejected'
        : reportedMatch === 'ambiguous'
          ? 'subindustry_ambiguous'
          : 'subindustry_not_mapped',
    // D — sin mapeo, fail-closed sin importar el veredicto.
    eligibilityVerdict: confirmed ? 'confirmed' : 'not_confirmed',
  };
}

/**
 * Fuente CANÓNICA única de elegibilidad hacia el target, para UN candidato.
 *
 * Compone `resolveCandidateSubindustryRequirement` (§ A–E) con
 * `evaluateCandidateTargetEligibility` (el resto del contrato) para que ningún
 * consumidor —orchestrator, writer, run_metrics, checkpoint, UI, auditorías—
 * tenga que reimplementar la composición ni pueda diverger de ella.
 *
 * `completeValid` y `countsTowardTarget` son el MISMO booleano con dos nombres:
 * en este contrato no existe un candidato que cuente hacia el target sin ser
 * completo y válido, ni al revés. `reviewOnlyReasons` y `blockingReasons`
 * son, por la misma razón, la MISMA lista: toda condición incumplida es a la
 * vez el motivo de revisión y el motivo de que no cuente.
 */
export type CandidateCanonicalTargetEligibility = CandidateTargetEligibility & {
  completeValid: boolean;
  reviewOnly: boolean;
  /**
   * Motivos de revisión en vocabulario ACCIONABLE: idéntico a `failedConditions`
   * salvo que `subindustry_match` se sustituye por su causa concreta
   * (`subindustry_ambiguous`, `subindustry_not_mapped`, `subindustry_rejected`,
   * `subindustry_evaluation_unavailable`).
   *
   * Es lo que la ficha muestra (§ 5). `failedConditions` conserva el vocabulario
   * del contrato porque es el que agregan los contadores.
   */
  reviewOnlyReasons: string[];
  blockingReasons: string[];
  subindustryRequirementApplied: boolean;
  requestedSubindustries: string[];
  perRequestedSubindustryEvaluations: RequestedSubindustryEvaluation[];
  matchedRequestedSubindustry: string | null;
  matchedSubindustryFamily: SubindustryMatchFamily;
  subindustryMapped: boolean;
  subindustryMatch: SubindustryRequirementMatch;
  subindustryBlockingReason: SubindustryBlockingReason | null;
};

export function evaluateCandidateSubindustryTargetEligibility(input: {
  persistenceSuccess: boolean;
  sectorEvidenceState: string | null | undefined;
  /** § 3 — lo que la búsqueda PIDIÓ. Ver `resolveCandidateSubindustryRequirement`. */
  requestedSubindustries?: readonly (string | null | undefined)[] | null;
  subindustryPrecision: ApolloSubindustryPrecisionAssessment | null;
  employeeCountStatus: CompanyFieldMappingStatus;
  linkedinStatus: CompanyFieldMappingStatus;
  duplicateStatus: string | null;
  ownershipGate: GateVerdict;
  qualityGate: GateVerdict;
  /**
   * STABLE-TARGET-WRITER-PARITY § 2 — condiciones que este llamador todavía no
   * puede resolver. Es lo que permite al orquestador compartir esta función con
   * el writer sin fingir veredictos. Ver `CandidateTargetEligibilityInput`.
   */
  pendingConditions?: readonly CandidateTargetCondition[];
}): CandidateCanonicalTargetEligibility {
  const subindustry = resolveCandidateSubindustryRequirement({
    sectorEvidenceState: input.sectorEvidenceState,
    requestedSubindustries: input.requestedSubindustries,
    subindustryPrecision: input.subindustryPrecision,
  });

  const base = evaluateCandidateTargetEligibility({
    persistenceSuccess: input.persistenceSuccess,
    subindustryMatch: subindustry.eligibilityVerdict,
    employeeCountStatus: input.employeeCountStatus,
    linkedinStatus: input.linkedinStatus,
    duplicateStatus: input.duplicateStatus,
    ownershipGate: input.ownershipGate,
    qualityGate: input.qualityGate,
    pendingConditions: input.pendingConditions,
  });

  const reviewOnlyReasons = base.failedConditions.map((condition) =>
    condition === 'subindustry_match' && subindustry.subindustryBlockingReason !== null
      ? subindustry.subindustryBlockingReason
      : condition,
  );

  return {
    ...base,
    completeValid: base.countsTowardTarget,
    reviewOnly: !base.countsTowardTarget,
    reviewOnlyReasons,
    blockingReasons: base.failedConditions,
    subindustryRequirementApplied: subindustry.subindustryRequirementApplied,
    requestedSubindustries: subindustry.requestedSubindustries,
    perRequestedSubindustryEvaluations: subindustry.perRequestedSubindustryEvaluations,
    matchedRequestedSubindustry: subindustry.matchedRequestedSubindustry,
    matchedSubindustryFamily: subindustry.matchedSubindustryFamily,
    subindustryMapped: subindustry.subindustryMapped,
    subindustryMatch: subindustry.subindustryMatch,
    subindustryBlockingReason: subindustry.subindustryBlockingReason,
  };
}

// ─── Contadores separados (§ 5 del addendum) ──────────────────────────────────

/**
 * Métricas que NO se mezclan: persistir no es completar, y completar no es
 * alcanzar el target.
 */
export type CandidateCompletenessCounters = {
  /** Candidatos escritos en `prospect_candidates`. */
  persisted_candidates: number;
  /** Persistidos que cumplen TODAS las condiciones del contrato. */
  complete_valid_candidates: number;
  /**
   * Persistidos con al menos una condición incumplida: existen para que alguien
   * los revise, y por eso NO pueden contarse como resultado exitoso.
   *
   * `review_only_candidates = persisted_candidates - complete_valid_candidates`,
   * por definición y no por acumulación: las dos cifras salen de la misma lista.
   */
  review_only_candidates: number;
  /** Lo único que puede compararse con el target de la modalidad. */
  target_count: number;
  /** Cuántas veces falló cada condición, para diagnóstico agregado. */
  failed_condition_counts: Record<string, number>;
};

/**
 * Lo MÍNIMO que un contador o un resolvedor de estado necesita de una
 * elegibilidad.
 *
 * Se declara aparte del tipo completo a propósito: `CandidateTargetEligibility`
 * creció (STABLE-TARGET-WRITER-PARITY § 1) con el desglose por condición que
 * sólo el orquestador consume, y exigirlo aquí obligaría a todo llamador —y a
 * toda prueba— a construir una estructura que estas dos funciones no miran.
 */
export type CandidateTargetEligibilitySummary = Pick<
  CandidateTargetEligibility,
  'countsTowardTarget' | 'failedConditions'
>;

export function buildCandidateCompletenessCounters(
  eligibilities: readonly CandidateTargetEligibilitySummary[],
): CandidateCompletenessCounters {
  const failedConditionCounts: Record<string, number> = {};
  let complete = 0;

  for (const eligibility of eligibilities) {
    if (eligibility.countsTowardTarget) {
      complete++;
      continue;
    }
    for (const condition of eligibility.failedConditions) {
      failedConditionCounts[condition] = (failedConditionCounts[condition] ?? 0) + 1;
    }
  }

  return {
    persisted_candidates: eligibilities.length,
    complete_valid_candidates: complete,
    review_only_candidates: eligibilities.length - complete,
    target_count: complete,
    failed_condition_counts: failedConditionCounts,
  };
}

// ─── Revisión obligatoria del candidato incompleto ────────────────────────────

/** Marca de revisión que un candidato incompleto lleva siempre. */
export const INCOMPLETE_CANDIDATE_REVIEW_FLAG = 'incomplete_provider_company_fields';

/**
 * Clave del bloque canónico de métricas de objetivo en la metadata del lote.
 *
 * Es la única fuente que responde «cuántas cuentan hacia el objetivo». Vive en
 * su propia clave para que ningún consumidor tenga que deducirlo del total de
 * filas persistidas.
 */
export const CANDIDATE_TARGET_METRICS_METADATA_KEY = 'candidate_target_metrics' as const;

/** Estado de revisión con el que se persiste todo candidato incompleto o ambiguo. */
export const REVIEW_ONLY_CANDIDATE_STATUS = 'needs_review';

/**
 * Estados que YA dicen algo más específico que «revísalo» y por eso no se
 * sobrescriben: `duplicate` nombra la causa exacta, y degradarlo a
 * `needs_review` perdería información sin ganar ninguna.
 */
const MORE_SPECIFIC_THAN_REVIEW: readonly string[] = ['duplicate'];

/**
 * Estado con el que se persiste un candidato según su completitud.
 *
 * Contrato de integración (§ D): un candidato que NO cuenta hacia el objetivo se
 * persiste como `needs_review`. Sigue persistiéndose —la información parcial es
 * útil y el usuario puede revisarla— pero nunca queda con un estado que se lea
 * como «este ya está bien».
 */
export function resolveCandidateStatusForCompleteness(
  baseStatus: string,
  eligibility: CandidateTargetEligibilitySummary,
): string {
  if (eligibility.countsTowardTarget) return baseStatus;
  if (MORE_SPECIFIC_THAN_REVIEW.includes(baseStatus)) return baseStatus;
  return REVIEW_ONLY_CANDIDATE_STATUS;
}
