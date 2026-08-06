/**
 * candidate-subindustry-status-display.ts — qué se pidió, qué se demostró y si
 * cuenta hacia el objetivo, por candidato.
 *
 * AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 · § 11.
 *
 * El defecto que cierra: la corrida `9a9acf99` buscaba una subindustria concreta
 * y guardó tres empresas cuya subindustria quedó AMBIGUA (Juan Valdez, Alpina,
 * Grupo Diana). La ficha no lo decía en ninguna parte: se veían como candidatas
 * normales de la búsqueda, indistinguibles de una empresa cuya pertenencia sí
 * estaba demostrada. El dato existía —`metadata.apollo_enrichment_capture
 * .precision` y `metadata.target_completeness`— pero nadie lo mostraba.
 *
 * Cuatro preguntas, cuatro respuestas explícitas:
 *
 *   ¿qué subindustria se pidió?
 *   ¿qué veredicto obtuvo?           Confirmada · Ambigua · Rechazada
 *   ¿cuenta hacia el objetivo?       Sí · No
 *   ¿por qué quedó para revisión?    vocabulario cerrado de cinco motivos
 *
 * Fail-closed: lo que no se midió se reporta como `null` y se muestra «Sin
 * medir». Un `null` NUNCA se convierte en «Confirmada» ni en «Sí»: afirmar una
 * pertenencia que la evidencia no sostiene es justo el defecto de origen.
 *
 * Puro: sólo lee metadata. Sin I/O, sin React, sin env.
 */

type MetadataBag = Record<string, unknown>;

// ─── Vocabulario ──────────────────────────────────────────────────────────────

/** Veredicto sobre la subindustria PEDIDA, tal como lo publica el evaluador. */
export type SubindustryVerdictKey = 'confirmed' | 'ambiguous' | 'rejected';

export const SUBINDUSTRY_VERDICT_LABELS: Record<SubindustryVerdictKey, string> = {
  confirmed: 'Confirmada',
  ambiguous: 'Ambigua',
  rejected: 'Rechazada',
};

/**
 * Motivos de revisión, en vocabulario cerrado.
 *
 * `other` no es relleno: existe para que una condición incumplida que no tiene
 * motivo propio siga siendo VISIBLE en vez de desaparecer del listado.
 */
export type SubindustryReviewReasonKey =
  | 'subindustry_ambiguous'
  | 'linkedin_missing'
  | 'employee_count_missing'
  | 'size_outside_icp'
  | 'other';

export const SUBINDUSTRY_REVIEW_REASON_LABELS: Record<SubindustryReviewReasonKey, string> = {
  subindustry_ambiguous: 'Subindustria ambigua',
  linkedin_missing: 'LinkedIn ausente',
  employee_count_missing: 'Número de empleados ausente',
  size_outside_icp: 'Tamaño fuera de ICP',
  other: 'Otro',
};

/**
 * Condiciones del contrato de completitud (`candidate-completeness-contract.ts`)
 * que tienen un motivo con nombre propio.
 *
 * Las que no aparecen aquí —`persistence_success`, `duplicate_status`,
 * `ownership_gate`, `quality_gate`— caen en `other` a propósito: se cuentan y se
 * muestran, pero no se les inventa una etiqueta que el usuario no pueda accionar.
 */
const FAILED_CONDITION_REASONS: Record<string, SubindustryReviewReasonKey> = {
  subindustry_match: 'subindustry_ambiguous',
  linkedin_status: 'linkedin_missing',
  employee_count_status: 'employee_count_missing',
};

/** Orden estable de presentación. No depende del orden de `failed_conditions`. */
const REASON_ORDER: readonly SubindustryReviewReasonKey[] = [
  'subindustry_ambiguous',
  'linkedin_missing',
  'employee_count_missing',
  'size_outside_icp',
  'other',
];

// ─── Salida ───────────────────────────────────────────────────────────────────

export type SubindustryReviewReason = {
  key: SubindustryReviewReasonKey;
  label: string;
};

export type CandidateSubindustryStatusDisplay = {
  /** `true` cuando el candidato trae alguna señal de esta modalidad. */
  hasData: boolean;
  /** Subindustria tal como se pidió. `null` cuando la búsqueda no declaró una. */
  requestedSubindustry: string | null;
  verdict: SubindustryVerdictKey | null;
  verdictLabel: string;
  /** `null` = no medido. Nunca se convierte en `false` silenciosamente. */
  countsTowardTarget: boolean | null;
  countsTowardTargetLabel: string;
  reviewReasons: SubindustryReviewReason[];
  /**
   * Frase que niega explícitamente la pertenencia cuando el veredicto no la
   * confirma. `null` cuando sí se confirmó o cuando no hay veredicto.
   */
  notConfirmedMessage: string | null;
};

/** Lo que se muestra cuando una señal no se midió. Nunca un «No» ni un «Sí». */
export const SUBINDUSTRY_NOT_MEASURED_VALUE = 'Sin medir';

// ─── Lectura ──────────────────────────────────────────────────────────────────

function readBag(metadata: unknown, key: string): MetadataBag | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const block = (metadata as MetadataBag)[key];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  return block as MetadataBag;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readVerdict(value: unknown): SubindustryVerdictKey | null {
  const raw = readString(value);
  if (raw === 'confirmed' || raw === 'ambiguous' || raw === 'rejected') return raw;
  return null;
}

/**
 * Motivos derivados de las condiciones incumplidas del contrato, más el gate de
 * tamaño ICP cuando bloqueó.
 *
 * El gate de tamaño no es una condición del contrato —descarta antes del
 * INSERT— pero es una de las causas reales de que una empresa no llegue al
 * objetivo, así que se muestra en la misma lista.
 */
function collectReasons(
  failedConditions: readonly unknown[],
  icpBlocked: boolean,
): SubindustryReviewReason[] {
  const keys = new Set<SubindustryReviewReasonKey>();

  for (const condition of failedConditions) {
    const name = readString(condition);
    if (name === null) continue;
    keys.add(FAILED_CONDITION_REASONS[name] ?? 'other');
  }
  if (icpBlocked) keys.add('size_outside_icp');

  return REASON_ORDER.filter((key) => keys.has(key)).map((key) => ({
    key,
    label: SUBINDUSTRY_REVIEW_REASON_LABELS[key],
  }));
}

function isIcpSizeGateBlocked(metadata: unknown): boolean {
  const gate = readBag(metadata, 'icp_size_gate');
  return readString(gate?.['decision']) === 'block';
}

/**
 * Estado de la subindustria pedida para el detalle del candidato.
 *
 * `hasData` es lo que la UI mira para decidir si pinta el bloque: un candidato
 * de otra modalidad no tiene ninguna de estas señales y no debe recibir una
 * ficha llena de «Sin medir».
 */
export function resolveCandidateSubindustryStatus(
  metadata: unknown,
): CandidateSubindustryStatusDisplay {
  const capture = readBag(metadata, 'apollo_enrichment_capture');
  const precision = capture ? readBag(capture, 'precision') : null;
  const completeness = readBag(metadata, 'target_completeness');

  const requestedSubindustry = precision
    ? readString(precision['requested_subindustry'])
    : null;
  const verdict = precision ? readVerdict(precision['subindustry_match']) : null;

  const countsTowardTarget =
    completeness && typeof completeness['counts_toward_target'] === 'boolean'
      ? (completeness['counts_toward_target'] as boolean)
      : null;

  const failedConditions = Array.isArray(completeness?.['failed_conditions'])
    ? (completeness['failed_conditions'] as unknown[])
    : [];

  const reviewReasons = collectReasons(failedConditions, isIcpSizeGateBlocked(metadata));

  // La negación se escribe entera: «ambigua» a secas deja al lector deducir qué
  // significa, y la deducción cómoda es «seguramente sí es de esa subindustria».
  const notConfirmedMessage =
    verdict === null || verdict === 'confirmed'
      ? null
      : requestedSubindustry === null
        ? 'No se confirmó la subindustria solicitada para esta empresa.'
        : `No se confirmó que esta empresa pertenezca a «${requestedSubindustry}».`;

  return {
    hasData: precision !== null || completeness !== null,
    requestedSubindustry,
    verdict,
    verdictLabel: verdict === null ? SUBINDUSTRY_NOT_MEASURED_VALUE : SUBINDUSTRY_VERDICT_LABELS[verdict],
    countsTowardTarget,
    countsTowardTargetLabel:
      countsTowardTarget === null ? SUBINDUSTRY_NOT_MEASURED_VALUE : countsTowardTarget ? 'Sí' : 'No',
    reviewReasons,
    notConfirmedMessage,
  };
}
