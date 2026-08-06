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

/**
 * Veredicto sobre la subindustria PEDIDA, tal como se muestra al usuario.
 *
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 9 — `unmapped` es un
 * ESTADO DE PANTALLA, no un valor que publique el evaluador: éste siempre
 * reporta `subindustry_match='ambiguous'` cuando la subindustria pedida no
 * tiene catálogo de anclas (`subindustry_mapped=false`). La ficha los separa
 * porque el motivo es distinto —«no se pudo confirmar» contra «SellUp todavía
 * no sabe evaluar esta subindustria»— y confundirlos deja al usuario sin poder
 * distinguir un candidato que necesita revisión de uno que necesita un mapeo
 * nuevo en el catálogo.
 */
export type SubindustryVerdictKey = 'confirmed' | 'ambiguous' | 'rejected' | 'unmapped';

export const SUBINDUSTRY_VERDICT_LABELS: Record<SubindustryVerdictKey, string> = {
  confirmed: 'Confirmada',
  ambiguous: 'Ambigua',
  rejected: 'Rechazada',
  unmapped: 'Sin mapeo',
};

/**
 * Motivos de revisión, en vocabulario cerrado.
 *
 * `other` no es relleno: existe para que una condición incumplida que no tiene
 * motivo propio siga siendo VISIBLE en vez de desaparecer del listado.
 */
export type SubindustryReviewReasonKey =
  | 'subindustry_ambiguous'
  | 'subindustry_not_mapped'
  | 'linkedin_missing'
  | 'employee_count_missing'
  | 'size_outside_icp'
  | 'other';

export const SUBINDUSTRY_REVIEW_REASON_LABELS: Record<SubindustryReviewReasonKey, string> = {
  subindustry_ambiguous: 'Subindustria ambigua',
  subindustry_not_mapped: 'Subindustria sin mapeo',
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
 *
 * `subindustry_match` tiene DOS motivos posibles, no uno: `resolveReasonForSubindustryMatch`
 * decide entre ellos según `subindustry_mapped`, porque «ambigua» y «sin mapeo»
 * exigen acciones distintas (revisar el candidato, contra pedir un mapeo nuevo).
 */
const FAILED_CONDITION_REASONS: Record<string, SubindustryReviewReasonKey> = {
  linkedin_status: 'linkedin_missing',
  employee_count_status: 'employee_count_missing',
};

/** Orden estable de presentación. No depende del orden de `failed_conditions`. */
const REASON_ORDER: readonly SubindustryReviewReasonKey[] = [
  'subindustry_ambiguous',
  'subindustry_not_mapped',
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

/**
 * `mapped` decide si `ambiguous` se muestra como «Ambigua» o como «Sin mapeo»
 * (§ 9): el evaluador publica `ambiguous` en ambos casos —nunca un valor
 * `unmapped` propio—, y sólo `subindustry_mapped` distingue «no se confirmó
 * la evidencia» de «SellUp no tiene reglas para esta subindustria todavía».
 * `confirmed` y `rejected` no dependen de `mapped`: el evaluador sólo los
 * devuelve para una subindustria que SÍ tiene catálogo de anclas.
 */
function readVerdict(rawMatch: unknown, mapped: boolean): SubindustryVerdictKey | null {
  const raw = readString(rawMatch);
  if (raw === 'confirmed' || raw === 'rejected') return raw;
  if (raw === 'ambiguous') return mapped ? 'ambiguous' : 'unmapped';
  return null;
}

/**
 * Motivos derivados de las condiciones incumplidas del contrato, más el gate de
 * tamaño ICP cuando bloqueó.
 *
 * El gate de tamaño no es una condición del contrato —descarta antes del
 * INSERT— pero es una de las causas reales de que una empresa no llegue al
 * objetivo, así que se muestra en la misma lista.
 *
 * `subindustry_match` incumplida tiene DOS motivos posibles: `mapped` decide
 * entre «Subindustria ambigua» y «Subindustria sin mapeo», igual que en
 * `readVerdict`.
 */
function collectReasons(
  failedConditions: readonly unknown[],
  icpBlocked: boolean,
  subindustryMapped: boolean,
): SubindustryReviewReason[] {
  const keys = new Set<SubindustryReviewReasonKey>();

  for (const condition of failedConditions) {
    const name = readString(condition);
    if (name === null) continue;
    if (name === 'subindustry_match') {
      keys.add(subindustryMapped ? 'subindustry_ambiguous' : 'subindustry_not_mapped');
      continue;
    }
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
  // Ausente ⇒ se asume `true` (dato escrito antes de que este campo existiera):
  // no inventar «sin mapeo» donde el evaluador nunca lo declaró.
  const subindustryMapped =
    typeof precision?.['subindustry_mapped'] === 'boolean'
      ? (precision['subindustry_mapped'] as boolean)
      : true;
  const verdict = precision ? readVerdict(precision['subindustry_match'], subindustryMapped) : null;

  const countsTowardTarget =
    completeness && typeof completeness['counts_toward_target'] === 'boolean'
      ? (completeness['counts_toward_target'] as boolean)
      : null;

  const failedConditions = Array.isArray(completeness?.['failed_conditions'])
    ? (completeness['failed_conditions'] as unknown[])
    : [];

  const reviewReasons = collectReasons(
    failedConditions,
    isIcpSizeGateBlocked(metadata),
    subindustryMapped,
  );

  // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 9 — «ambigua» y «sin
  // mapeo» exigen explicaciones distintas: una dice que la evidencia no
  // alcanzó, la otra dice que SellUp todavía no sabe evaluar esa subindustria.
  // Fusionarlas en un solo texto es lo que hacía parecer, ante una subindustria
  // sin mapeo, que el candidato «casi» calificaba.
  const notConfirmedMessage =
    verdict === null || verdict === 'confirmed'
      ? null
      : verdict === 'unmapped'
        ? 'Se guardó para revisión, pero SellUp todavía no tiene reglas suficientes para confirmar automáticamente esta subindustria.'
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
