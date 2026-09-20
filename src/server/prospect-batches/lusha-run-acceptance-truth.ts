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
  resolveCandidateSubindustryRequirement,
  type CandidateCompletenessVerdict,
} from '@/server/agents/prospecting-toolkit/candidate-completeness-contract';
import { resolveLushaProspectingEvidenceCapability } from '@/server/agents/prospecting-toolkit/provider-evidence-capability';

/**
 * Lo mínimo que hace falta de un superviviente para juzgar su completitud.
 *
 * Estructural a propósito: este módulo no importa el tipo del pipeline de Lusha,
 * así que la suite puede ejercitarlo con formas de cualquier proveedor y la
 * paridad Apollo/Lusha/mock es demostrable sin montar una corrida entera.
 *
 * 🔴 X6.12 — los tres campos nuevos son EVIDENCIA, no opciones. Ninguno tiene
 * valor por defecto que pueda «pasar»: ausente el ownership, la condición se
 * lee `fail`; ausente el LinkedIn, `not_returned`. Un olvido de cableado
 * produce una candidata que NO cuenta, nunca una que cuenta de más.
 */
export type SurvivorCompletenessInput = {
  /** Número de empleados declarado por el proveedor. `null` ⇒ no lo entregó. */
  employeeCount: number | null;
  /** Tal como se persiste en `prospect_candidates.duplicate_status`. */
  duplicateStatus: string | null;
  /**
   * 🔴 X6.12 — el veredicto de `evaluateLushaOwnershipEvidence`, que sale de la
   * costura de admisión de X6.10-C. Ausente ⇒ `fail`.
   */
  ownershipGate?: 'pass' | 'fail';
  /**
   * 🔴 X6.12 — la URL de LinkedIn que la fila persiste, ya ACREDITADA como
   * página de empresa (`isLinkedInCompanyUrl`). `null` ⇒ el proveedor no la dio
   * o lo que dio no es una página de empresa: las dos son respuestas, no huecos.
   */
  linkedinUrl?: string | null;
  /**
   * 🔴 X6.12 — ¿la precisión macro CONFIRMÓ la industria pedida para esta
   * empresa? Es el análogo exacto de `sectorEvidenceState` en Apollo: un
   * veredicto de INDUSTRIA, por candidata, y nunca de subindustria. Ausente o
   * `false` ⇒ `not_confirmed`, que es la postura fail-closed de siempre.
   */
  macroIndustryConfirmed?: boolean;
  /**
   * 🔴 X6.14 — el veredicto de `evaluateLushaQualityGate`, con sus TRES valores
   * y tres significados distintos:
   *
   *   · `pass`    — se evaluó y la identidad del registro quedó acreditada.
   *   · `fail`    — se evaluó y un check con respaldo la rechazó.
   *   · `unknown` — la pregunta aplica y no se pudo responder. NO es un rechazo
   *                 y NO es un pase: la condición se declara NO DISPONIBLE, así
   *                 que la candidata no cuenta pero tampoco se la acusa.
   *
   * 🔴 AUSENTE es una cuarta cosa, y la más severa: el gate obligatorio no se
   * ejecutó. Eso ⇒ `fail`, fail-closed, porque una evaluación que falta no
   * puede leerse como aprobada.
   */
  qualityGate?: 'pass' | 'fail' | 'unknown';
};

/**
 * Los HECHOS de la corrida que deciden qué puede contestar esta ruta.
 *
 * Viven en la CORRIDA y no en el superviviente porque la subindustria la pide la
 * búsqueda, no la empresa: dos candidatas de la misma corrida no pueden diferir
 * en si se pidió una.
 */
export type LushaRunAcceptanceFacts = {
  /**
   * 🔴 X6.12 — las subindustrias que la búsqueda PIDIÓ, transportadas desde los
   * criterios originales. Vacío ⇒ no se pidió ninguna, y entonces la condición
   * `subindustry_match` NO aplica (`not_requested`), igual que en Apollo.
   */
  readonly requestedSubindustries: readonly (string | null | undefined)[];
};

/** Sin hechos declarados, la postura es la más conservadora posible. */
export const LUSHA_RUN_ACCEPTANCE_FACTS_UNKNOWN: LushaRunAcceptanceFacts = {
  requestedSubindustries: [],
};

/**
 * El veredicto de UN superviviente, por el contrato CANÓNICO.
 *
 * No hay aquí ninguna regla de completitud propia de Lusha. Lo único que este
 * módulo aporta es DECLARAR qué condiciones esta ruta no puede producir
 * (`resolveLushaProspectingEvidenceCapability`, derivada de hechos), y la regla
 * la aplica `evaluateCandidateTargetEligibility` — la misma función que usa el
 * writer de Apollo.
 *
 * 🔴 X6.14 — `qualityGate` DEJA DE SER FIJO.
 *
 * Hasta este corte valía `'pass'` con esta justificación: «llegar aquí ya exige
 * precisión macro y dedupe exacto». Eso describe dos gates reales, pero
 * `quality_gate` en el contrato canónico agrega lo que el writer de Apollo
 * evalúa —intermediario de contenido, plataforma externa, página de contenido,
 * encaje de negocio—, y ninguno de ésos se estaba mirando. Declarar `pass` sin
 * evaluarlos era exactamente lo prohibido: una condición no evaluada no puede
 * declararse aprobada.
 *
 * Ahora lo decide `evaluateLushaQualityGate`, cuyo veredicto viaja en el
 * superviviente. Ausente ⇒ `fail`, fail-closed, igual que `ownershipGate`.
 *
 * 🔴 NO hay paridad completa con Apollo, y la salida del gate lo declara
 * (`parityComplete: false`): `source_url_quality` no aplica en esta ruta y el
 * nivel `low` de `business_fit` está pendiente de decisión de producto.
 *
 * 🔴 X6.12 — la subindustria se resuelve con `resolveCandidateSubindustryRequirement`,
 * la MISMA función que usa el writer de Apollo. No se reimplementa la regla: se
 * le pasan las subindustrias pedidas y el veredicto de industria, y ella decide
 * si la pregunta aplica.
 */
export function evaluateLushaSurvivorCompleteness(
  survivor: SurvivorCompletenessInput,
  facts: LushaRunAcceptanceFacts = LUSHA_RUN_ACCEPTANCE_FACTS_UNKNOWN,
): CandidateCompletenessVerdict {
  const subindustry = resolveCandidateSubindustryRequirement({
    sectorEvidenceState: survivor.macroIndustryConfirmed === true
      ? 'sector_evidence_confirmed'
      : null,
    requestedSubindustries: facts.requestedSubindustries,
    // Lusha no produce el assessment de precisión de Apollo. Declararlo `null`
    // es el hecho: con subindustria pedida, la pregunta se queda sin respuesta.
    subindustryPrecision: null,
  });

  return evaluateCandidateTargetEligibility({
    persistenceSuccess: true,
    subindustryMatch: subindustry.eligibilityVerdict,
    // 🔴 La URL ya viene ACREDITADA por quien la persiste; aquí sólo se lee si
    // existe. Fabricar `confirmed` sin URL sería exactamente el pase encubierto
    // que X5.1 prohibió.
    linkedinStatus: survivor.linkedinUrl ? 'confirmed' : 'not_returned',
    ownershipGate: survivor.ownershipGate ?? 'fail',
    employeeCountStatus: typeof survivor.employeeCount === 'number' ? 'confirmed' : 'not_returned',
    duplicateStatus: survivor.duplicateStatus,
    // 🔴 `unknown` no viaja como veredicto: viaja como condición NO DISPONIBLE
    // (abajo). Aquí se manda `fail` para que jamás pueda satisfacerse por
    // accidente; la lista de `unavailableConditions` es la que gana y la que
    // distingue «no se pudo responder» de «se respondió que no».
    qualityGate: survivor.qualityGate === 'pass' ? 'pass' : 'fail',
    unavailableConditions: [
      ...resolveLushaProspectingEvidenceCapability({
        subindustryRequested: subindustry.subindustryRequirementApplied,
      }).unavailableConditions,
      // 🔴 X6.14 — la única condición NO DISPONIBLE por CANDIDATA, no por
      // corrida: su identidad no se pudo juzgar. `unavailable` gana a todo en
      // el contrato, así que esto no aprueba nada; lo que evita es afirmar un
      // rechazo que nadie midió.
      ...(survivor.qualityGate === 'unknown' ? (['quality_gate'] as const) : []),
    ],
  }).completenessVerdict;
}

/**
 * 🔴 LA COTA CONSERVADORA CUANDO LA BASE CONFIRMÓ MENOS FILAS DE LAS ENTREGADAS.
 *
 * ── El defecto que cierra ───────────────────────────────────────────────────
 *
 * `insertCandidates` devuelve `{ insertedCount }` y nada más: dice CUÁNTAS filas
 * entraron, nunca CUÁLES. Con una escritura parcial, recortar la aceptación con
 * `Math.min(completas, insertadas)` acredita una completitud que nadie probó.
 *
 * Caso reproducido: se entregan una candidata COMPLETA y una INCOMPLETA, y la
 * base confirma UNA fila. `min(1, 1) = 1` ⇒ se publicaba una aceptación. Si la
 * fila que entró fue la incompleta, la verdad es CERO.
 *
 * ── La cota ─────────────────────────────────────────────────────────────────
 *
 *   aceptadas ≥ completas − fallidas,   con fallidas = entregadas − insertadas
 *
 * Es el peor caso honesto: suponer que las filas que NO entraron eran
 * precisamente las completas. Nunca supera `insertadas`, porque
 * `completas − fallidas ≤ entregadas − fallidas = insertadas`.
 *
 * 🔴 Con escritura TOTAL (`fallidas = 0`) devuelve las completas tal cual, así
 * que el caso normal —una transacción vallada todo-o-nada— no se toca.
 */
export function boundAcceptedByUnconfirmedWrites(input: {
  /** Candidatas que la evaluación declaró completas. */
  readonly complete: number;
  /** Filas que se ENTREGARON a la base. */
  readonly attempted: number;
  /** Filas que la base CONFIRMÓ. */
  readonly inserted: number;
}): number {
  const complete = Math.max(0, Math.trunc(input.complete));
  const attempted = Math.max(0, Math.trunc(input.attempted));
  const inserted = Math.max(0, Math.trunc(input.inserted));
  const failed = Math.max(0, attempted - inserted);
  return Math.max(0, complete - failed);
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
  facts: LushaRunAcceptanceFacts = LUSHA_RUN_ACCEPTANCE_FACTS_UNKNOWN,
): LushaRunAcceptanceTruth {
  const counters = buildCandidateCompletenessCounters(
    survivors.map((survivor) => {
      const verdict = evaluateLushaSurvivorCompleteness(survivor, facts);
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
  //
  // 🔴 X6.12 — la capacidad se RESUELVE con los hechos de la corrida en vez de
  // leerse de una constante. Con subindustria pedida sigue habiendo un hueco y
  // la aceptación sigue siendo `null`: ninguna candidata podría cumplir las
  // siete, y un número que no puede variar no es una medida. Sin subindustria
  // pedida la lista queda vacía y la aceptación SÍ se mide.
  const acceptanceMeasurable =
    resolveLushaProspectingEvidenceCapability({
      subindustryRequested: resolveCandidateSubindustryRequirement({
        // La medibilidad depende SÓLO de si se pidió subindustria; el veredicto
        // de industria es por candidata y no puede decidirla.
        sectorEvidenceState: null,
        requestedSubindustries: facts.requestedSubindustries,
        subindustryPrecision: null,
      }).subindustryRequirementApplied,
    }).unavailableConditions.length === 0;

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

