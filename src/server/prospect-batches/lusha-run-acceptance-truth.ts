/**
 * lusha-run-acceptance-truth.ts — AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1.
 *
 * LA ÚNICA COSTURA que convierte una corrida Lusha en cifras. Metadata, la fila
 * de uso del proveedor y la publicación durable leen de aquí; ninguna las
 * recalcula por su cuenta.
 *
 * El defecto que cierra: existían dos expresiones para el mismo nombre.
 * `acceptedForTargetTotal` valía `useful.length` en la metadata del lote (escrita
 * ANTES del insert) y `min(insertedCount, useful.length)` en la fila de uso
 * (escrita DESPUÉS). El mismo concepto, dos números, y ningún consumidor podía
 * saber cuál leía.
 *
 * ── Los seis conceptos, con nombre propio cada uno ───────────────────────────
 *
 *   `survivors`        empresas que pasaron los gates OBLIGATORIOS. El objetivo
 *                      del usuario NO las limita. Todas se persisten.
 *
 *   `purchaseCredit`   supervivientes de la página/rama, como medida de
 *                      RENDIMIENTO. Es lo que decide si seguir pidiendo páginas
 *                      tiene sentido. No depende de completitud ni del objetivo:
 *                      una página que trajo cuarenta empresas útiles rindió,
 *                      sepamos o no si están completas.
 *
 *   `complete`         CUT-7 dice que cumple TODAS sus condiciones.
 *   `incomplete`       CUT-7 encontró al menos una condición resuelta EN CONTRA.
 *   `unknown`          ninguna en contra, y al menos una que este proveedor NO
 *                      PUEDE producir. No es un rechazo y no es un pase.
 *
 *   `acceptedForTarget` sólo las `complete`. Es lo ÚNICO que el objetivo acota,
 *                      y lo hace aguas abajo, en `resolveAcceptedForTarget`.
 *
 * ── Invariantes, verificadas por la suite ────────────────────────────────────
 *
 *   survivors      = complete + incomplete + unknown
 *   purchaseCredit = survivors
 *   acceptedForTarget = complete            SI la aceptación es medible
 *   acceptedForTarget = null                si NO lo es — «no medido», no cero
 *   acceptedForTarget <= survivors          cuando es un número
 *
 * Nótese lo que NO aparece en ninguna fórmula: `target`. Aquí no se acota nada
 * contra el objetivo — ni supervivientes, ni filas, ni completas. Ese recorte
 * vive en `accepted-for-target.ts`, que es su sitio.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

import {
  buildCandidateCompletenessCounters,
  evaluateCandidateTargetEligibility,
  type CandidateCompletenessVerdict,
} from '@/server/agents/prospecting-toolkit/candidate-completeness-contract';
import { LUSHA_PROSPECTING_EVIDENCE_CAPABILITY } from '@/server/agents/prospecting-toolkit/provider-evidence-capability';

/**
 * Lo mínimo que hace falta de un superviviente para juzgar su completitud.
 *
 * Estructural a propósito: este módulo no importa el tipo del pipeline de Lusha,
 * así que la suite puede ejercitarlo con formas de cualquier proveedor y la
 * paridad Apollo/Lusha/mock es demostrable sin montar una corrida entera.
 */
export type SurvivorCompletenessInput = {
  /** Número de empleados declarado por el proveedor. `null` ⇒ no lo entregó. */
  employeeCount: number | null;
  /** Tal como se persiste en `prospect_candidates.duplicate_status`. */
  duplicateStatus: string | null;
};

/**
 * El veredicto de UN superviviente, por el contrato CANÓNICO.
 *
 * No hay aquí ninguna regla de completitud propia de Lusha. Lo único que este
 * módulo aporta es DECLARAR qué condiciones su proveedor no puede producir
 * (`LUSHA_PROSPECTING_EVIDENCE_CAPABILITY`, un registro de hechos), y la regla
 * la aplica `evaluateCandidateTargetEligibility` — la misma función que usa el
 * writer de Apollo.
 *
 * `qualityGate: 'pass'` no es un pase inventado: llegar a esta lista ya exige
 * haber superado la precisión macro y el dedupe exacto, que son los dos gates de
 * calidad que esta ruta ejecuta de verdad.
 */
export function evaluateLushaSurvivorCompleteness(
  survivor: SurvivorCompletenessInput,
): CandidateCompletenessVerdict {
  return evaluateCandidateTargetEligibility({
    persistenceSuccess: true,
    // Los tres declarados NO DISPONIBLES viajan por `unavailableConditions`, así
    // que el valor que se pase aquí es irrelevante por construcción: el contrato
    // lo sobrescribe. Se pasa el más conservador de todos modos.
    subindustryMatch: 'not_confirmed',
    linkedinStatus: 'not_returned',
    ownershipGate: 'fail',
    employeeCountStatus: typeof survivor.employeeCount === 'number' ? 'confirmed' : 'not_returned',
    duplicateStatus: survivor.duplicateStatus,
    qualityGate: 'pass',
    unavailableConditions: LUSHA_PROSPECTING_EVIDENCE_CAPABILITY.unavailableConditions,
  }).completenessVerdict;
}

/** Las cifras de la corrida. Una sola fuente para todas las superficies. */
export type LushaRunAcceptanceTruth = {
  survivors: number;
  purchaseCredit: number;
  complete: number;
  incomplete: number;
  unknown: number;
  /**
   * 🔴 AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1 — `null` ⇒ NO MEDIDO.
   *
   * La distinción que este campo existe para hacer:
   *
   *   `0`     medimos la aceptación y ninguna candidata la alcanzó
   *   `null`  no es posible medirla con la evidencia que este proveedor entrega
   *
   * Publicar un cero donde la verdad es «no medible» afirma una medición que no
   * ocurrió. Con tres condiciones del contrato declaradas NO DISPONIBLES,
   * ninguna candidata Lusha puede satisfacer las siete, así que un `0` sería
   * constante por construcción — y un número que no puede variar no es una
   * medida, es un adorno.
   *
   * Aguas abajo, `paidAcceptedContributionFromWriterTruth` ya sabe leer `null`:
   * produce `{ measured: false, reason: 'acceptance_not_measured' }`, que es
   * exactamente el vocabulario que faltaba usar.
   */
  acceptedForTarget: number | null;
  /**
   * Si la aceptación es medible con lo que este proveedor entrega. Derivado del
   * registro de capacidad, NUNCA del nombre del proveedor: un adaptador futuro
   * que sí satisfaga las siete condiciones mide, y éste no.
   */
  acceptanceMeasurable: boolean;
};

/**
 * Resuelve las seis cifras a partir de los supervivientes de la corrida.
 *
 * 🔴 `survivors` es la longitud de la lista, sin recortar. Si alguien vuelve a
 * meter un `Math.min(…, target)` antes de llamar aquí, la invariante
 * `survivors = complete + incomplete + unknown` sigue cuadrando —los tres
 * cubos se derivan de la misma lista— pero el universo ya llegaría mutilado, y
 * por eso el recorte se prohíbe aguas arriba y se prueba allí.
 */
export function resolveLushaRunAcceptanceTruth(
  survivors: readonly SurvivorCompletenessInput[],
): LushaRunAcceptanceTruth {
  const counters = buildCandidateCompletenessCounters(
    survivors.map((survivor) => {
      const verdict = evaluateLushaSurvivorCompleteness(survivor);
      return {
        countsTowardTarget: verdict === 'complete',
        // Sin condiciones que enumerar: el desglose por condición de esta ruta
        // vive en el veredicto, y fabricar nombres aquí inventaría diagnóstico.
        failedConditions: [],
        completenessVerdict: verdict,
      };
    }),
  );

  // 🔴 Provider-neutral: la medibilidad sale del REGISTRO DE CAPACIDAD, no del
  // nombre del proveedor. Si un adaptador futuro puede producir las siete
  // condiciones, su lista de no disponibles está vacía y su aceptación SÍ se
  // mide — sin tocar una línea de esta función.
  const acceptanceMeasurable =
    LUSHA_PROSPECTING_EVIDENCE_CAPABILITY.unavailableConditions.length === 0;

  return {
    survivors: survivors.length,
    // 🔴 El rendimiento de una página pagada es cuántas empresas útiles trajo.
    // NO se deriva de la completitud ni del objetivo: una página con cuarenta
    // supervivientes rindió, sepamos o no si están completas. Que sea
    // exactamente `survivors` es deliberado y está probado como invariante.
    purchaseCredit: survivors.length,
    complete: counters.complete_valid_candidates,
    incomplete: counters.incomplete_candidates,
    unknown: counters.unknown_candidates,
    // 🔴 `null` cuando no es medible. Cuando SÍ lo sea, son las completas y
    // nada más; el objetivo acota esa cifra AGUAS ABAJO, en
    // `resolveAcceptedForTarget`, y aquí no se le aplica ningún tope.
    acceptedForTarget: acceptanceMeasurable ? counters.complete_valid_candidates : null,
    acceptanceMeasurable,
  };
}
