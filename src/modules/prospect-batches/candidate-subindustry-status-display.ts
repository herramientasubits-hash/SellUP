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
export type SubindustryVerdictKey =
  | 'confirmed'
  | 'ambiguous'
  | 'rejected'
  | 'unmapped'
  | 'evaluation_unavailable';

export const SUBINDUSTRY_VERDICT_LABELS: Record<SubindustryVerdictKey, string> = {
  confirmed: 'Confirmada',
  ambiguous: 'Ambigua',
  rejected: 'Rechazada',
  unmapped: 'Sin confirmar',
  // § 5 — «no se evaluó» no es «no se confirmó»: la primera es una carencia del
  // sistema, la segunda un veredicto sobre la empresa.
  evaluation_unavailable: 'Sin evaluar',
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
  | 'subindustry_rejected'
  | 'subindustry_evaluation_unavailable'
  | 'linkedin_missing'
  | 'employee_count_missing'
  | 'size_outside_icp'
  | 'other';

/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 5 — cuatro estados, cuatro
 * frases que dicen lo que de verdad pasó.
 *
 * Antes había dos, y una de ellas mentía por omisión: un candidato cuya evidencia
 * CONTRADECÍA la subindustria pedida se mostraba como «Subindustria ambigua»,
 * como si le hubiera faltado un dato. Y «Subindustria sin mapeo» era jerga
 * interna: describía el estado del catálogo de SellUp, no lo que la usuaria tenía
 * que hacer con la empresa.
 */
export const SUBINDUSTRY_REVIEW_REASON_LABELS: Record<SubindustryReviewReasonKey, string> = {
  subindustry_ambiguous: 'Subindustria ambigua',
  subindustry_not_mapped: 'No se pudo confirmar automáticamente la subindustria solicitada',
  subindustry_rejected: 'La evidencia disponible no coincide con la subindustria solicitada',
  subindustry_evaluation_unavailable:
    'No fue posible evaluar automáticamente la subindustria solicitada',
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
  'subindustry_rejected',
  'subindustry_evaluation_unavailable',
  'linkedin_missing',
  'employee_count_missing',
  'size_outside_icp',
  'other',
];

/**
 * § 5 — motivos que el writer ya publica en `target_completeness
 * .review_only_reasons` con su nombre propio.
 *
 * Cuando ese campo existe no hay nada que deducir: el evaluador ya decidió entre
 * ambigua, sin mapeo, rechazada y no evaluable. Las filas escritas antes de que
 * el campo existiera siguen resolviéndose desde `failed_conditions` +
 * `subindustry_mapped`, que es todo lo que tenían.
 */
const SELF_DESCRIBING_REASONS: Record<string, SubindustryReviewReasonKey> = {
  subindustry_ambiguous: 'subindustry_ambiguous',
  subindustry_not_mapped: 'subindustry_not_mapped',
  subindustry_rejected: 'subindustry_rejected',
  subindustry_evaluation_unavailable: 'subindustry_evaluation_unavailable',
};

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
  conditions: readonly unknown[],
  icpBlocked: boolean,
  subindustryFallbackReason: SubindustryReviewReasonKey,
): SubindustryReviewReason[] {
  const keys = new Set<SubindustryReviewReasonKey>();

  for (const condition of conditions) {
    const name = readString(condition);
    if (name === null) continue;
    // § 5 — un motivo que ya se nombra a sí mismo se respeta tal cual; sólo la
    // condición genérica del contrato necesita que alguien decida su causa.
    const selfDescribing = SELF_DESCRIBING_REASONS[name];
    if (selfDescribing !== undefined) {
      keys.add(selfDescribing);
      continue;
    }
    if (name === 'subindustry_match') {
      keys.add(subindustryFallbackReason);
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

  /**
   * § 5 — sin precisión, la subindustria pedida se lee del contrato. Es el caso
   * «no evaluable»: la frase debe poder nombrar lo que se pidió aunque nadie
   * llegara a evaluarlo.
   */
  const requestedSubindustry =
    (precision ? readString(precision['requested_subindustry']) : null) ??
    (Array.isArray(completeness?.['requested_subindustries'])
      ? readString((completeness['requested_subindustries'] as unknown[])[0])
      : null);
  // Ausente ⇒ se asume `true` (dato escrito antes de que este campo existiera):
  // no inventar «sin mapeo» donde el evaluador nunca lo declaró.
  const subindustryMapped =
    typeof precision?.['subindustry_mapped'] === 'boolean'
      ? (precision['subindustry_mapped'] as boolean)
      : true;
  /**
   * § 5 — el veredicto sale de la precisión cuando existe; si NO existe pero el
   * contrato registró que la subindustria no se pudo evaluar, ése es el
   * veredicto. Es el caso Tavily/legacy con subindustria pedida: antes no había
   * precisión que leer, así que la ficha decía «Sin medir» —indistinguible de un
   * candidato de otra modalidad— sobre un candidato que sí se pidió evaluar.
   */
  const contractMatch = readString(completeness?.['subindustry_match']);
  const verdict = precision
    ? readVerdict(precision['subindustry_match'], subindustryMapped)
    : contractMatch === 'evaluation_unavailable'
      ? 'evaluation_unavailable'
      : null;

  const countsTowardTarget =
    completeness && typeof completeness['counts_toward_target'] === 'boolean'
      ? (completeness['counts_toward_target'] as boolean)
      : null;

  /**
   * § 5 — `review_only_reasons` manda porque ya trae la causa concreta de la
   * subindustria. `failed_conditions` es el respaldo para las filas escritas
   * antes de que ese campo existiera.
   */
  const reviewOnlyReasons = Array.isArray(completeness?.['review_only_reasons'])
    ? (completeness['review_only_reasons'] as unknown[])
    : null;
  const failedConditions = Array.isArray(completeness?.['failed_conditions'])
    ? (completeness['failed_conditions'] as unknown[])
    : [];

  const reviewReasons = collectReasons(
    reviewOnlyReasons ?? failedConditions,
    isIcpSizeGateBlocked(metadata),
    // Respaldo para la condición genérica del contrato: `rejected` y
    // `evaluation_unavailable` nunca se deducen —se leen— porque deducirlos de
    // `subindustry_mapped` es exactamente el contrasentido que el § 5 prohíbe.
    verdict === 'rejected'
      ? 'subindustry_rejected'
      : verdict === 'evaluation_unavailable'
        ? 'subindustry_evaluation_unavailable'
        : subindustryMapped
          ? 'subindustry_ambiguous'
          : 'subindustry_not_mapped',
  );

  // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 9 — «ambigua» y «sin
  // mapeo» exigen explicaciones distintas: una dice que la evidencia no
  // alcanzó, la otra dice que SellUp todavía no sabe evaluar esa subindustria.
  // Fusionarlas en un solo texto es lo que hacía parecer, ante una subindustria
  // sin mapeo, que el candidato «casi» calificaba.
  const notConfirmedMessage = (() => {
    if (verdict === null || verdict === 'confirmed') return null;
    if (verdict === 'unmapped') {
      return 'Se guardó para revisión, pero SellUp todavía no tiene reglas suficientes para confirmar automáticamente esta subindustria.';
    }
    if (verdict === 'evaluation_unavailable') {
      return 'Se guardó para revisión: no fue posible evaluar automáticamente la subindustria solicitada para esta empresa.';
    }
    // § 5 — «rechazada» no dice «faltó evidencia», dice que la que hay
    // CONTRADICE lo que se pidió. Redactarla como una ambigüedad hacía leer
    // como «casi califica» a una empresa que el evaluador descartó.
    if (verdict === 'rejected') {
      return requestedSubindustry === null
        ? 'La evidencia disponible no coincide con la subindustria solicitada.'
        : `La evidencia disponible no coincide con «${requestedSubindustry}».`;
    }
    return requestedSubindustry === null
      ? 'No se confirmó la subindustria solicitada para esta empresa.'
      : `No se confirmó que esta empresa pertenezca a «${requestedSubindustry}».`;
  })();

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
