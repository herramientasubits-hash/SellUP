/**
 * wizard-result-copy.ts — qué se le dice al usuario cuando una corrida termina,
 * con la CAUSA de mayor prioridad ganando siempre.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 8.
 *
 * El defecto observado: LIVE-QA-2 (lote `62fdf47b`) encontró UNA empresa
 * elegible, el writer no la pudo guardar porque `prospect_candidates.identity_key`
 * no existía en Producción, y la UI dijo
 *
 *   «Todos los resultados ya habían sido sugeridos recientemente.»
 *
 * Ese texto no era una elección arbitraria: la distribución de descartes de la
 * corrida tenía 3 `duplicate_in_hubspot` + 5 `seen_in_previous_round`, así que
 * `recentlySuggestedCount = 8` y el resolutor de QUERY-QUALITY-2 lo eligió con
 * toda corrección. Lo que faltaba era la causa que estaba POR ENCIMA: un fallo
 * de almacenamiento no es una razón de historial, y decirle al usuario que sus
 * resultados «ya se habían sugerido» le pide justo lo contrario de lo que debe
 * hacer (repetir la búsqueda y pagarla otra vez).
 *
 * Orden de prioridad, en un solo lugar y testeado:
 *
 *   1. fallo de persistencia   — error técnico; el gasto ya ocurrió
 *   2. persistencia parcial    — hay algo que revisar, y algo se perdió
 *   3. historial / calidad     — la distribución real de descartes
 *
 * Puro: sin I/O, sin React, sin env.
 */

import {
  resolveNoNewCandidatesCopy,
  type NoNewCandidatesBreakdown,
  type NoNewCandidatesCopy,
} from './wizard-no-new-candidates-copy';
// AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 § 7 — «no medido» ya tiene un texto
// en el resumen de objetivo. Reutilizarlo evita que dos tablas de la misma
// pantalla digan cosas distintas para la misma ausencia.
import { NOT_MEASURED_VALUE } from './wizard-target-summary-copy';

// ─── Entrada ──────────────────────────────────────────────────────────────────

/** Éxito, éxito PARCIAL y fracaso, tal como los publica el writer. */
export type WizardPersistenceStatus = 'success' | 'partial_failure' | 'failed';

/**
 * Cifras de persistencia proyectadas hacia el cliente. `null` cuando el servidor
 * no las envió (una corrida previa a este hito, o un camino que no persiste).
 *
 * Los campos de FORENSICS-1 son OPCIONALES a propósito: una corrida anterior al
 * hito no los trae, y `undefined` significa «no medido», nunca cero. Un cero
 * afirmaría que no hubo ninguno, que es una afirmación distinta y más fuerte.
 */
export type WizardPersistenceOutcome = {
  eligibleBeforePersistence: number;
  persistedCandidates: number;
  persistenceFailureCount: number;
  persistenceFailed: boolean;
  persistenceErrorCode: string | null;
  /** FORENSICS-1 § 7 — el estado de tres valores que un booleano no distingue. */
  persistenceStatus?: WizardPersistenceStatus | null;
  persistenceAttemptedCount?: number | null;
  persistenceSucceededCount?: number | null;
  persistenceFailedCount?: number | null;
  persistenceGap?: number | null;
  /** § 4 — choques contra índice único: duplicidad tardía, no avería. */
  lateDuplicateCount?: number | null;
  completeValidCandidates?: number | null;
  reviewOnlyCandidates?: number | null;
};

export type WizardResultCopyCause =
  | 'persistence_failed'
  | 'persistence_partial'
  | NoNewCandidatesCopy['cause'];

export type WizardResultCopy = {
  /** De qué familia salió el texto. Es lo que un test afirma sin leer prosa. */
  source: 'persistence_failure' | 'no_new_candidates';
  cause: WizardResultCopyCause;
  /** Titular. `null` cuando lo pone el panel (familia `no_new_candidates`). */
  heading: string | null;
  body: string;
  /** Nota de auditoría; NO se muestra al usuario final. */
  auditNote: string | null;
  /**
   * § 8 — afirmación explícita de que este texto NO habla de historial. La UI y
   * los tests la leen en vez de comparar prosa.
   */
  claimsRecentlySuggested: boolean;
};

// ─── Textos de fallo de almacenamiento ────────────────────────────────────────

export const PERSISTENCE_FAILED_HEADING = 'No pudimos guardar los resultados.';
export const PERSISTENCE_PARTIAL_HEADING = 'Guardamos solo parte de los resultados.';

/**
 * Advertencia común a los dos casos: el gasto ya ocurrió, así que repetir la
 * búsqueda no recupera nada y sí vuelve a cobrar.
 */
const ALREADY_SPENT_WARNING =
  'La búsqueda ya fue ejecutada y pudo consumir créditos. No vuelvas a generar ' +
  'la búsqueda. Intenta nuevamente después de que se corrija el problema de ' +
  'almacenamiento.';

function pluralizeCompanies(count: number): string {
  return count === 1 ? '1 empresa candidata' : `${count} empresas candidatas`;
}

function buildPersistenceFailedBody(eligible: number): string {
  const subject = eligible > 0 ? pluralizeCompanies(eligible) : 'empresas candidatas';
  const pronoun = eligible === 1 ? 'guardarla' : 'guardarlas';
  return `Encontramos ${subject}, pero no fue posible ${pronoun}. ${ALREADY_SPENT_WARNING}`;
}

/**
 * Cuerpo del éxito PARCIAL.
 *
 * FORENSICS-1 § 7. La corrida `9a9acf99` intentó 4 escrituras, guardó 3 y perdió
 * una: la única con subindustria confirmada. La UI no podía decirlo porque el
 * único texto disponible hablaba de «las demás», sin decir cuántas eran ni
 * cuántas sí habían entrado. Ni éxito total ni error total: las dos cifras
 * juntas, en la misma frase.
 */
function buildPersistencePartialBody(counts: WizardPersistenceCounts): string {
  const failedPhrase =
    counts.failed === 1
      ? 'Uno no pudo guardarse.'
      : `${counts.failed} no pudieron guardarse.`;
  return (
    `Se guardaron ${counts.succeeded} de ${counts.attempted} candidatos. ` +
    `${failedPhrase} ${ALREADY_SPENT_WARNING}`
  );
}

// ─── Cifras normalizadas ──────────────────────────────────────────────────────

/**
 * Las cinco cantidades administrativas de una escritura, ya saneadas.
 *
 * `attempted`, `succeeded` y `failed` son SIEMPRE números: las tres se pueden
 * reconstruir de la forma previa al hito. Las otras tres son `number | null`
 * porque sólo existen si el servidor las midió, y un `null` se muestra como
 * «Sin medir» en vez de como un cero que nadie contó.
 */
export type WizardPersistenceCounts = {
  attempted: number;
  succeeded: number;
  failed: number;
  lateDuplicates: number | null;
  completeValid: number | null;
  reviewOnly: number | null;
};

function toCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

/**
 * Normaliza el resultado del servidor a las cifras que la UI enseña.
 *
 * `attempted` nunca puede quedar por debajo de `succeeded + failed`: una corrida
 * previa al hito sólo traía «elegibles antes de persistir», y si un gate barato
 * descartó a alguien después de contarlo, ese total podría ser menor que la suma
 * real de intentos. Un «3 de 2» no se muestra jamás.
 */
export function resolveWizardPersistenceCounts(
  persistence: WizardPersistenceOutcome,
): WizardPersistenceCounts {
  const succeeded =
    toCount(persistence.persistenceSucceededCount) ?? toCount(persistence.persistedCandidates) ?? 0;
  const failed =
    toCount(persistence.persistenceFailedCount) ?? toCount(persistence.persistenceFailureCount) ?? 0;
  const declaredAttempted =
    toCount(persistence.persistenceAttemptedCount) ??
    toCount(persistence.eligibleBeforePersistence) ??
    0;
  const attempted = Math.max(declaredAttempted, succeeded + failed);

  // El hueco es `intentos - guardados`, y sólo dos cosas lo llenan: los fallos y
  // los duplicados tardíos. Con el hueco medido, restar los fallos da los
  // duplicados sin que el servidor tenga que enviarlos por separado.
  const gap = toCount(persistence.persistenceGap);
  const lateDuplicates =
    toCount(persistence.lateDuplicateCount) ?? (gap === null ? null : Math.max(0, gap - failed));

  return {
    attempted,
    succeeded,
    failed,
    lateDuplicates,
    completeValid: toCount(persistence.completeValidCandidates),
    reviewOnly: toCount(persistence.reviewOnlyCandidates),
  };
}

/**
 * Estado de tres valores. Se prefiere el que el servidor declaró; si no llegó, se
 * reconstruye con la misma regla del writer (`resolvePersistenceStatus`).
 */
export function resolveWizardPersistenceStatus(
  persistence: WizardPersistenceOutcome,
): WizardPersistenceStatus {
  if (persistence.persistenceStatus != null) return persistence.persistenceStatus;
  const counts = resolveWizardPersistenceCounts(persistence);
  if (counts.failed <= 0) return 'success';
  return counts.succeeded > 0 ? 'partial_failure' : 'failed';
}

// ─── Desglose administrativo ──────────────────────────────────────────────────

/**
 * § 7 — las cinco filas que un administrador necesita para cerrar una corrida
 * parcial sin abrir la base de datos.
 *
 * «Guardados» y «candidatos completos» son cantidades distintas, y separarlas es
 * el punto: la corrida `9a9acf99` guardó 3 filas y ninguna estaba completa.
 */
export const WIZARD_PERSISTENCE_BREAKDOWN_LABELS = {
  persisted: 'Guardados',
  persistence_failures: 'Fallos de persistencia',
  late_duplicates: 'Duplicados tardíos',
  complete_valid: 'Candidatos completos',
  review_only: 'Candidatos para revisión',
} as const;

export type WizardPersistenceBreakdownRowKey =
  keyof typeof WIZARD_PERSISTENCE_BREAKDOWN_LABELS;

export type WizardPersistenceBreakdownRow = {
  key: WizardPersistenceBreakdownRowKey;
  label: string;
  /** Texto ya formateado. `Sin medir` cuando la cifra no se midió. */
  value: string;
  hint: string | null;
};

const BREAKDOWN_HINTS: Record<WizardPersistenceBreakdownRowKey, string> = {
  persisted: 'Filas realmente escritas en el listado de prospectos.',
  persistence_failures: 'Escrituras rechazadas por la base de datos. El gasto ya ocurrió.',
  late_duplicates:
    'Empresas que ya existían y chocaron con un índice único al guardarse. No son una avería.',
  complete_valid: 'De las guardadas, las que cumplen todas las condiciones del objetivo.',
  review_only: 'Guardadas para que las revises. No cuentan hacia el objetivo.',
};

function formatBreakdownCount(value: number | null): string {
  return value === null ? NOT_MEASURED_VALUE : String(value);
}

/**
 * Desglose administrativo de la escritura. Devuelve `[]` cuando no hay cifras:
 * una tabla de ceros afirmaría cinco cosas que nadie midió.
 */
export function buildWizardPersistenceBreakdown(
  persistence: WizardPersistenceOutcome | null | undefined,
): WizardPersistenceBreakdownRow[] {
  if (!persistence) return [];
  const counts = resolveWizardPersistenceCounts(persistence);
  const values: Record<WizardPersistenceBreakdownRowKey, number | null> = {
    persisted: counts.succeeded,
    persistence_failures: counts.failed,
    late_duplicates: counts.lateDuplicates,
    complete_valid: counts.completeValid,
    review_only: counts.reviewOnly,
  };

  return (
    Object.keys(WIZARD_PERSISTENCE_BREAKDOWN_LABELS) as WizardPersistenceBreakdownRowKey[]
  ).map((key) => ({
    key,
    label: WIZARD_PERSISTENCE_BREAKDOWN_LABELS[key],
    value: formatBreakdownCount(values[key]),
    hint: BREAKDOWN_HINTS[key],
  }));
}

// ─── Resolución ───────────────────────────────────────────────────────────────

/**
 * Cierto cuando hay que hablar de almacenamiento antes que de cualquier otra
 * cosa. Exige las DOS señales: que el writer declare el fallo y que hubiera algo
 * que perder. Un `persistenceFailed` sin empresas elegibles no tiene nada que
 * anunciar como pérdida.
 */
export function isPersistenceFailureRelevant(
  persistence: WizardPersistenceOutcome | null | undefined,
): boolean {
  if (!persistence) return false;
  if (!persistence.persistenceFailed && persistence.persistenceFailureCount <= 0) return false;
  return persistence.eligibleBeforePersistence > 0;
}

/**
 * Texto final de la corrida.
 *
 * Cuando la persistencia falla, el resolutor de historial/calidad NI SE CONSULTA:
 * su distribución sigue siendo verdad, pero no es la causa que el usuario tiene
 * que leer, y una disyunción entre ambas es cómo se produjo el copy engañoso.
 */
export function resolveWizardResultCopy(input: {
  persistence?: WizardPersistenceOutcome | null;
  noNewCandidates?: NoNewCandidatesBreakdown | null;
}): WizardResultCopy {
  const persistence = input.persistence ?? null;

  if (isPersistenceFailureRelevant(persistence) && persistence !== null) {
    const counts = resolveWizardPersistenceCounts(persistence);
    // § 7 — el estado del writer manda cuando llegó. Sin él se reconstruye, y la
    // reconstrucción es la MISMA regla: guardar algo y perder algo es parcial.
    const partial = resolveWizardPersistenceStatus(persistence) === 'partial_failure';
    return {
      source: 'persistence_failure',
      cause: partial ? 'persistence_partial' : 'persistence_failed',
      heading: partial ? PERSISTENCE_PARTIAL_HEADING : PERSISTENCE_FAILED_HEADING,
      body: partial
        ? buildPersistencePartialBody(counts)
        : buildPersistenceFailedBody(counts.attempted),
      auditNote: null,
      claimsRecentlySuggested: false,
    };
  }

  const fallback = resolveNoNewCandidatesCopy(
    input.noNewCandidates ?? {
      hubspotDuplicateCount: 0,
      sellupDuplicateCount: 0,
      cooldownCount: 0,
      repeatedAcrossRoundsCount: 0,
      qualityRejectedCount: 0,
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
      noveltyExhausted: false,
      secondRoundSkippedReason: null,
    },
  );

  return {
    source: 'no_new_candidates',
    cause: fallback.cause,
    heading: null,
    body: fallback.body,
    auditNote: fallback.auditNote,
    claimsRecentlySuggested: fallback.cause === 'cooldown' || fallback.cause === 'mixed',
  };
}
