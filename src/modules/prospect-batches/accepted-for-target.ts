/**
 * accepted-for-target.ts — cuántos candidatos cuentan REALMENTE hacia el
 * objetivo que la persona pidió.
 *
 * AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET §§ 1, 4, 5, 6, 7, 9, 10.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * En la corrida existen siete cantidades emparentadas y NINGUNA es la misma:
 *
 *   descubiertas · persistidas · durables · únicas · visibles · revisables ·
 *   ACEPTADAS HACIA EL OBJETIVO
 *
 * Antes de este corte la última no existía como concepto, así que el wizard
 * usaba la segunda en su lugar: el veredicto de «objetivo alcanzado» se decidía
 * con `persistedCount` gratuito más `candidatesCreated` de pago, es decir con
 * FILAS. Y una fila persistida no es una empresa útil: desde
 * `candidate-completeness-contract.ts` § D un candidato incompleto o ambiguo se
 * guarda a propósito —con `needs_review`— para que alguien lo revise. Contarlo
 * hacia el objetivo declara alcanzada una meta que nadie alcanzó.
 *
 * La ecuación canónica de § 1 vive aquí y sólo aquí:
 *
 *   accepted_for_target_total = accepted_free_for_target + accepted_paid_for_target
 *   0 <= accepted_for_target_total <= requestedTarget
 *   remainingTarget = max(0, requestedTarget - accepted_for_target_total)
 *
 * ── 🔴 NO se inventa una política de calidad (§ 3) ───────────────────────────
 *
 * Este módulo no decide qué candidato es bueno. No sabe de precisión, de
 * identidad fiscal, de dominios ni de duplicados. Recibe de cada mitad la
 * cifra que su PROPIA autoridad —ya existente— resolvió, y se limita a
 * combinarlas con la aritmética del § 6:
 *
 *   · mitad GRATUITA — `ProviderResultDemand`, que a su vez lee el
 *     `residualGap` de `buildPrePaidNoveltyContext`: precisión macro canónica,
 *     dedupe de SellUp y comprobación de HubSpot, ya reajustado a lo REALMENTE
 *     persistido por `withFreeSourcePersistenceOutcome`.
 *   · mitad PAGADA — `complete_valid_candidates` de
 *     `candidate-completeness-contract.ts`, que el writer publica como
 *     `target_count` con el comentario literal «lo único que puede compararse
 *     con el target». Existía desde antes de este corte y el wizard la
 *     ignoraba.
 *
 * Que la mitad gratuita entre como `ProviderResultDemand` no es comodidad: es
 * lo que impide que existan DOS aritméticas del hueco. El número que la ruta de
 * pago recibe para saber cuánto pedir y el número con el que después se juzga
 * si el objetivo se cerró son literalmente el mismo (§ 6).
 *
 * ── 🔴 PERSISTIDO ≠ ACEPTADO, y ninguna fila se borra (§ 10) ─────────────────
 *
 * El resultado lleva las dos familias de cifras a la vez y con nombres
 * distintos. Un candidato durable que no cuenta hacia el objetivo SIGUE
 * existiendo: este módulo no oculta, no borra y no reescribe procedencia. La
 * separación que produce es
 *
 *   UNIVERSO DURABLE   ≠   SUBCONJUNTO ACEPTADO
 *
 * y la primera nunca se recorta para que la segunda cuadre.
 *
 * ── 🔴 Fail-closed: no medir no es cumplir ──────────────────────────────────
 *
 * Una mitad que no midió su aceptación aporta CERO, nunca sus filas. Es la
 * misma postura que `apollo-persisted-candidate-truth.ts` ya sostenía para
 * `complete_valid_candidates === null` («sin medición de completitud el
 * objetivo NO se da por alcanzado»), traída al único sitio donde ahora se
 * decide. Sustituir la ausencia por el total de filas sería exactamente el
 * defecto que este corte cierra, escrito en el camino de degradación.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import type { ProviderResultDemand } from './prepaid-novelty/provider-result-demand';

// ─── Por qué una mitad no pudo declarar su aceptación ─────────────────────────

/**
 * Códigos estáticos, sin PII. Viajan a telemetría y al resultado de la acción.
 *
 * 🔴 Ninguno significa «cero aceptadas»: significan «no se sabe». El efecto
 * sobre el conteo es el mismo —no suma— pero el motivo tiene que quedar dicho,
 * porque «el writer no midió» y «el writer midió cero» son dos corridas
 * distintas y sólo una es un fallo de instrumentación.
 */
export type AcceptanceUnknownReason =
  /** El contribuyente escribió filas pero no publicó su conteo de completitud. */
  | 'acceptance_not_measured'
  /** El contribuyente no llegó a ejecutarse en esta corrida. */
  | 'contributor_did_not_run';

// ─── Lo que una mitad aporta ──────────────────────────────────────────────────

/**
 * El aporte de UN contribuyente: cuántas filas dejó y cuántas de ellas cuentan.
 *
 * 🔴 Las dos cifras viajan JUNTAS y por campos distintos a propósito. Un tipo
 * que sólo llevara la aceptada dejaría al consumidor reconstruir el universo
 * durable por su cuenta, y un tipo que sólo llevara las filas es el defecto de
 * partida. Que estén juntas es lo que permite comprobar la invariante
 * `aceptadas <= persistidas` en el único sitio donde se combina todo.
 */
export type AcceptedContribution =
  | {
      measured: true;
      acceptedForTarget: number;
      persistedCandidates: number;
      /**
       * 🔴 X6.13 — la IDENTIDAD DURABLE de cada candidata que este aporte
       * declara aceptada.
       *
       * Existe porque el techo de filas NO basta: con ocho filas de las que
       * sólo cinco cumplen el contrato, un aporte que vuelva a incluir tres de
       * esas cinco suma ocho, y ocho ≤ ocho. El techo no puede verlo; la
       * identidad sí.
       *
       * Cadenas OPACAS y con ESPACIO DE NOMBRES (`candidate:<uuid>`,
       * `lusha:<identity_key>`): dos escritores distintos no comparten formato
       * de id, y conflatarlos inventaría coincidencias. Ausente ⇒ el aporte se
       * suma por su cuenta, que es el comportamiento anterior a este corte.
       */
      acceptedIdentities?: readonly string[];
      /**
       * 🔴 ¿`acceptedForTarget` es un CONTEO EXACTO o una COTA INFERIOR?
       *
       * Ausente ⇒ exacto, que es el caso normal y el comportamiento anterior.
       * `false` ⇒ el escritor no pudo saber CUÁLES filas quedaron persistidas
       * —una escritura parcial por la ruta sin valla— y lo que publica es el
       * peor caso honesto: nunca más de lo real, posiblemente menos.
       *
       * No se colapsa con `measured: false`: una cota es una medición útil
       * —`targetReached` con una cota ≥ objetivo sigue siendo cierto— y borrarla
       * perdería información que sí se tiene.
       */
      exact?: boolean;
    }
  | {
      measured: false;
      reason: AcceptanceUnknownReason;
      /** Las filas SÍ se conocen aunque la aceptación no: § 10, el durable no se pierde. */
      persistedCandidates: number;
    };

/** El contribuyente no corrió: cero filas y cero aceptadas, ambas CONOCIDAS. */
export const CONTRIBUTOR_NOT_RUN: AcceptedContribution = {
  measured: true,
  acceptedForTarget: 0,
  persistedCandidates: 0,
};

/**
 * El aporte de PAGO, derivado de las cifras que el writer ya publica.
 *
 * 🔴 `completeValidCandidates` es la autoridad EXISTENTE
 * (`candidate-completeness-contract.ts` → `target_count`), no una regla nueva.
 * `null`/`undefined` significa «no medido» y produce un aporte SIN medir, que
 * suma cero. Nunca se sustituye por `persistedCandidates`.
 */
export function paidAcceptedContributionFromWriterTruth(input: {
  completeValidCandidates: number | null | undefined;
  persistedCandidates: number;
  /** 🔴 X6.13 — identidades durables de las aceptadas. Ver `AcceptedContribution`. */
  acceptedIdentities?: readonly string[] | null;
  /** `false` ⇒ `completeValidCandidates` es una COTA INFERIOR, no un conteo. */
  exact?: boolean;
}): AcceptedContribution {
  const persisted = sanitizeCount(input.persistedCandidates);
  if (input.completeValidCandidates === null || input.completeValidCandidates === undefined) {
    // Un contribuyente que no escribió NADA sí sabe su aceptación: es cero. No
    // hay medición que echar de menos, así que declararlo «no medido» apagaría
    // el objetivo de una corrida que simplemente no encontró empresas.
    if (persisted === 0) return CONTRIBUTOR_NOT_RUN;
    return { measured: false, reason: 'acceptance_not_measured', persistedCandidates: persisted };
  }
  const identities = sanitizeIdentities(input.acceptedIdentities);
  return {
    measured: true,
    acceptedForTarget: sanitizeCount(input.completeValidCandidates),
    persistedCandidates: persisted,
    ...(identities === null ? {} : { acceptedIdentities: identities }),
    ...(input.exact === false ? { exact: false } : {}),
  };
}

/**
 * Identidades utilizables: cadenas no vacías, sin repetir y en orden estable.
 * `null` ⇒ el aporte NO declara identidades (distinto de declararlas vacías).
 */
function sanitizeIdentities(
  value: readonly string[] | null | undefined,
): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed !== '') seen.add(trimmed);
  }
  return [...seen];
}

// ─── El resultado canónico ────────────────────────────────────────────────────

/**
 * La respuesta ÚNICA a «¿cuántos cuentan hacia el objetivo?» (§ 7).
 *
 * No hay una versión del servidor y otra de la UI, ni una del lado gratuito y
 * otra del de pago: los consumidores reutilizan ESTE tipo. Un mismo hecho con
 * varias formas es cómo dos capas empiezan a discrepar sin que nadie lo note.
 */
export type AcceptedForTargetResult = {
  /** El objetivo del USUARIO. Nunca se reescribe (§ 1). */
  requestedTarget: number;
  acceptedFreeForTarget: number;
  acceptedPaidForTarget: number;
  /** `acceptedFree + acceptedPaid`, acotado por construcción a `requestedTarget`. */
  acceptedForTargetTotal: number;
  /** `max(0, requestedTarget - acceptedForTargetTotal)`. Nunca negativo. */
  remainingTarget: number;
  /** SÓLO `acceptedForTargetTotal >= requestedTarget`. Jamás filas persistidas. */
  targetReached: boolean;
  // ── Universo durable: se reporta, no se recorta (§ 10) ────────────────────
  persistedFreeCandidates: number;
  persistedPaidCandidates: number;
  persistedTotalCandidates: number;
  // ── Trazabilidad de la medición ───────────────────────────────────────────
  freeAcceptanceMeasured: boolean;
  /**
   * 🔴 `true` sólo si el total de pago es un CONTEO EXACTO.
   *
   * Una cota inferior —escritura parcial por la ruta sin valla— no puede
   * publicarse como si se conociera el total, así que esta bandera baja aunque
   * los dos aportes estén medidos. Lo que la cota SÍ sigue sosteniendo es
   * `targetReached`: si la cota alcanza el objetivo, el objetivo se alcanzó.
   */
  paidAcceptanceMeasured: boolean;
  /** `false` ⇒ `acceptedForTargetTotal` es una COTA INFERIOR, no un conteo. */
  acceptedCountExact: boolean;
  /** Motivos declarados, en orden libre→pago. Vacío en una corrida medida. */
  acceptanceUnknownReasons: readonly AcceptanceUnknownReason[];
};

function sanitizeCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Combina las dos mitades con la aritmética del § 6.
 *
 * 🔴 La mitad gratuita entra como `ProviderResultDemand` —la demanda que la
 * ruta de pago YA recibió— y no como un par de números sueltos. Así el hueco
 * con el que se pidió y el hueco con el que se juzga son el mismo objeto, y no
 * puede aparecer una segunda definición que discrepe.
 *
 * Invariantes que se cumplen por CONSTRUCCIÓN, no por comprobación posterior:
 *
 *   aceptadas <= persistidas          — un aceptado es una fila, no una promesa
 *   aceptadas <= objetivo             — nadie acepta más de lo que se pidió
 *   acceptedPaid <= hueco restante    — la mitad de pago no puede sobrellenar
 *   remainingTarget >= 0
 */
export function resolveAcceptedForTarget(input: {
  /** § 6 — el hueco de la mitad gratuita, tal como la ruta de pago lo recibió. */
  demand: ProviderResultDemand;
  /** Filas que la capa gratuita dejó en el lote. Universo durable, no aceptación. */
  freePersistedCandidates: number;
  paid: AcceptedContribution;
  /**
   * AGENT1-HARDENING-CUT-2 — la SEGUNDA pierna de pago (Lusha, waterfall).
   *
   * 🔴 Entra aquí y no en una aritmética aparte porque la ecuación canónica del
   * § 1 vive en esta función y sólo en ella. Sumar la pierna Lusha fuera —en el
   * wizard, después de resolver— habría creado la segunda autoridad que este
   * módulo existe para impedir, y con ella la posibilidad de aceptar por encima
   * del objetivo: el tope `remainingTarget` sólo se puede sostener donde se
   * conocen todos los aportes a la vez.
   *
   * Ausente ⇒ `CONTRIBUTOR_NOT_RUN` ⇒ resultado IDÉNTICO al anterior al corte,
   * campo por campo. Es el caso de toda corrida sin waterfall.
   */
  paidWaterfall?: AcceptedContribution;
  /**
   * 🔴 X6.13 — el TECHO REAL de la corrida: cuántas filas ÚNICAS existen de
   * verdad en el lote.
   *
   * Sustituye al tope por objetivo que este módulo aplicaba a cada aporte. El
   * objetivo es el MÍNIMO que la búsqueda persigue, nunca el máximo que puede
   * contar: una corrida que encuentra ocho válidas vale ocho.
   *
   * Lo que el tope por objetivo SÍ hacía y no se puede perder es impedir que la
   * misma empresa se cuente dos veces cuando dos piernas producen de más. Esa
   * garantía pasa aquí a apoyarse en el universo DURABLE —filas únicas ya
   * escritas, con la identidad de lote ya aplicada— en vez de en una resta:
   * dos aportes no pueden sumar más candidatas de las que la base confirma, y
   * un reintento que vuelva a reportar lo mismo tampoco puede inflar el total.
   *
   * Ausente ⇒ sólo rigen las cotas por contribuyente (cada aporte contra SUS
   * filas), que es el comportamiento de toda llamada que no conoce el lote.
   */
  persistedUniqueCeiling?: number | null;
}): AcceptedForTargetResult {
  const requestedTarget = sanitizeCount(input.demand.requestedTarget);
  const persistedFree = sanitizeCount(input.freePersistedCandidates);

  // 🔴 Acotado por las FILAS, y ya NO por el objetivo (X6.13). La cota por filas
  // es la que impide que una aceptación mayor que lo escrito —un estado
  // imposible que sólo puede venir de un error de conteo— fabrique cobertura.
  // La cota por objetivo se retira porque convertía el mínimo en techo: una capa
  // gratuita que trae ocho válidas con objetivo cinco aportaba cinco.
  const acceptedFree = Math.min(
    sanitizeCount(input.demand.acceptedBeforeProvider),
    persistedFree,
  );

  const waterfall = input.paidWaterfall ?? CONTRIBUTOR_NOT_RUN;

  const persistedPaidPrimary = sanitizeCount(input.paid.persistedCandidates);
  const persistedPaidWaterfall = sanitizeCount(waterfall.persistedCandidates);
  const persistedPaid = persistedPaidPrimary + persistedPaidWaterfall;

  // 🔴 X6.13 — cada aporte se acota contra SUS PROPIAS filas y nada más. El
  // `remainingTarget` desapareció de las dos cotas: era lo que hacía que un
  // proveedor con doce válidas aportara sólo el hueco.
  const acceptedPaidPrimary = input.paid.measured
    ? Math.min(sanitizeCount(input.paid.acceptedForTarget), persistedPaidPrimary)
    : 0;

  const acceptedPaidWaterfall = waterfall.measured
    ? Math.min(sanitizeCount(waterfall.acceptedForTarget), persistedPaidWaterfall)
    : 0;

  /**
   * 🔴 X6.13 — EL AGREGADO CUENTA IDENTIDADES, NO SUMAS.
   *
   * El techo de filas (`persistedUniqueCeiling`, abajo) impide exceder el
   * número de filas, pero NO impide contar dos veces a una candidata válida
   * cuando el lote tiene además filas incompletas que absorben la inflación:
   * con ocho filas de las que cinco cumplen el contrato, un aporte que vuelva a
   * incluir tres de esas cinco suma ocho — y ocho ≤ ocho.
   *
   * Cuando los aportes declaran la IDENTIDAD DURABLE de lo que aceptaron, el
   * agregado es el tamaño de la UNIÓN. Un replay que reporta las mismas filas
   * no añade nada, que es exactamente la idempotencia que hacía falta.
   *
   * 🔴 La unión NO puede superar lo que cada aporte podía aceptar por sus
   * propias filas: se acota por la suma de esos topes. Una lista de identidades
   * más larga que las filas del aporte es un error de conteo, no una licencia.
   *
   * 🔴 LIMITACIÓN DECLARADA: dos escritores con espacios de nombres distintos no
   * pueden reconocerse entre sí. Lo que impide ahí el doble conteo es otra cosa
   * —el dedupe físico, que impide una segunda FILA, y la cota por filas de cada
   * aporte—, no esta unión.
   */
  const identifiedContributions = [input.paid, waterfall].filter(
    (contribution): contribution is Extract<AcceptedContribution, { measured: true }> =>
      contribution.measured && Array.isArray(contribution.acceptedIdentities),
  );
  const identifiedCap = identifiedContributions.reduce(
    (total, contribution) =>
      total +
      Math.min(
        sanitizeCount(contribution.acceptedForTarget),
        sanitizeCount(contribution.persistedCandidates),
      ),
    0,
  );
  const identityUnion = new Set<string>();
  for (const contribution of identifiedContributions) {
    for (const identity of contribution.acceptedIdentities ?? []) identityUnion.add(identity);
  }
  const acceptedFromIdentities = Math.min(identityUnion.size, identifiedCap);

  /** Lo que aportan los que NO declararon identidad, cada uno por su cuenta. */
  const acceptedFromCounts =
    (Array.isArray(input.paid.measured ? input.paid.acceptedIdentities : undefined)
      ? 0
      : acceptedPaidPrimary) +
    (Array.isArray(waterfall.measured ? waterfall.acceptedIdentities : undefined)
      ? 0
      : acceptedPaidWaterfall);

  const acceptedPaidRaw = acceptedFromIdentities + acceptedFromCounts;

  /**
   * 🔴 X6.13 — LA COTA QUE SUSTITUYE AL OBJETIVO.
   *
   * Sumar dos aportes sin ninguna cota común permitiría que la misma empresa
   * contara dos veces si las dos piernas la reportaran. Con el tope por objetivo
   * eso era imposible por accidente aritmético; ahora se impide por el hecho que
   * de verdad lo gobierna: no puede haber más ACEPTADAS que filas ÚNICAS
   * escritas en el lote.
   *
   * 🔴 Es un techo, no una verdad: recorta un total imposible, nunca eleva uno
   * honesto. Y se aplica al TOTAL —no aporte por aporte— porque el solapamiento
   * vive entre piernas, no dentro de una.
   */
  const uniqueCeiling =
    typeof input.persistedUniqueCeiling === 'number' &&
    Number.isFinite(input.persistedUniqueCeiling)
      ? sanitizeCount(input.persistedUniqueCeiling)
      : null;
  // 🔴 El recorte cae sobre la mitad de PAGO, no sobre el total, para que la
  // identidad `total = libre + pago` se conserve en la metadata. La mitad
  // gratuita ya está acotada por sus propias filas y es anterior en el tiempo:
  // recortarla a ella describiría un solapamiento que no ocurrió ahí.
  const acceptedPaid =
    uniqueCeiling === null
      ? acceptedPaidRaw
      : Math.min(acceptedPaidRaw, Math.max(0, uniqueCeiling - acceptedFree));
  /**
   * 🔴 Un aporte MEDIDO puede seguir siendo una cota inferior. Basta con que uno
   * lo sea para que el total deje de ser un conteo.
   */
  const acceptedCountExact = [input.paid, waterfall].every(
    (contribution) => !contribution.measured || contribution.exact !== false,
  );
  const acceptedTotal = acceptedFree + acceptedPaid;
  const unknownReasons: AcceptanceUnknownReason[] = [];
  if (!input.paid.measured) unknownReasons.push(input.paid.reason);
  // 🔴 Una pierna que corrió y no midió deja el resultado SIN MEDIR, igual que
  // la primera. No medir no es cumplir, y con dos piernas tampoco.
  if (!waterfall.measured) unknownReasons.push(waterfall.reason);

  return {
    requestedTarget,
    acceptedFreeForTarget: acceptedFree,
    acceptedPaidForTarget: acceptedPaid,
    acceptedForTargetTotal: acceptedTotal,
    remainingTarget: Math.max(0, requestedTarget - acceptedTotal),
    // 🔴 `requestedTarget > 0`: un objetivo de cero no se «alcanza» con cero
    // empresas. Sin esta guarda una corrida degradada a objetivo 0 se anunciaría
    // como cumplida sin haber encontrado nada.
    targetReached: requestedTarget > 0 && acceptedTotal >= requestedTarget,
    persistedFreeCandidates: persistedFree,
    persistedPaidCandidates: persistedPaid,
    persistedTotalCandidates: persistedFree + persistedPaid,
    // La mitad gratuita entra por la demanda, que es una cifra ya resuelta: no
    // hay un caso «sin medir» que declarar por este lado.
    freeAcceptanceMeasured: true,
    // 🔴 Medido Y exacto. Publicar `true` con una cota inferior afirmaría un
    // total que nadie conoce.
    paidAcceptanceMeasured: input.paid.measured && waterfall.measured && acceptedCountExact,
    acceptedCountExact,
    acceptanceUnknownReasons: unknownReasons,
  };
}

/** Clave del bloque en `metadata`. */
export const ACCEPTED_FOR_TARGET_METADATA_KEY = 'accepted_for_target' as const;

/** Bloque plano y sin PII. snake_case, como el resto de la metadata de corrida. */
export function toAcceptedForTargetMetadata(
  result: AcceptedForTargetResult,
): Record<string, unknown> {
  return {
    requested_target: result.requestedTarget,
    accepted_free_for_target: result.acceptedFreeForTarget,
    accepted_paid_for_target: result.acceptedPaidForTarget,
    accepted_for_target_total: result.acceptedForTargetTotal,
    remaining_target: result.remainingTarget,
    target_reached: result.targetReached,
    persisted_free_candidates: result.persistedFreeCandidates,
    persisted_paid_candidates: result.persistedPaidCandidates,
    persisted_total_candidates: result.persistedTotalCandidates,
    paid_acceptance_measured: result.paidAcceptanceMeasured,
    // 🔴 `exact` vs `lower_bound`: la cifra de arriba no siempre es un conteo.
    accepted_count_kind: result.acceptedCountExact ? 'exact' : 'lower_bound',
    acceptance_unknown_reasons: [...result.acceptanceUnknownReasons],
  };
}

// ─── Proyección para la UI ────────────────────────────────────────────────────

/**
 * AGENT1-LOCAL-CUT8-ACCEPTANCE-REPORTING-PROPAGATION — el subconjunto del
 * resultado canónico que viaja al mago y que el panel de éxito PINTA.
 *
 * 🔴 No es una segunda autoridad ni una segunda aritmética: es una SELECCIÓN de
 * campos ya resueltos. No suma, no resta, no compara y no vuelve a acotar. Si
 * alguna vez hiciera falta un número que no está aquí, el sitio donde se calcula
 * sigue siendo `resolveAcceptedForTarget` y nada más.
 *
 * El desglose libre/pago y los motivos de no-medición NO viajan: son procedencia
 * y su sitio es la metadata durable del lote (`toAcceptedForTargetMetadata`), no
 * un panel que la persona lee para saber si consiguió lo que pidió.
 */
export type AcceptedForTargetSummary = {
  /** El objetivo del USUARIO. Jamás se sustituye por filas ni por el hueco. */
  requestedTarget: number;
  /** Cuántas cuentan hacia el objetivo. Jamás las filas persistidas. */
  acceptedForTargetTotal: number;
  remainingTarget: number;
  targetReached: boolean;
  /** Universo durable: se reporta junto al aceptado, nunca en su lugar (§ 10). */
  persistedTotalCandidates: number;
  /**
   * 🔴 Viaja porque «no se midió» y «se midió cero» son corridas distintas y el
   * panel no puede pintarlas igual. Sin este campo la UI sólo podría elegir
   * entre inventar un cero y afirmar un fallo de objetivo que nadie comprobó.
   */
  paidAcceptanceMeasured: boolean;
};

/** Selección pura de campos ya resueltos. Cero aritmética. */
export function toAcceptedForTargetSummary(
  result: AcceptedForTargetResult,
): AcceptedForTargetSummary {
  return {
    requestedTarget: result.requestedTarget,
    acceptedForTargetTotal: result.acceptedForTargetTotal,
    remainingTarget: result.remainingTarget,
    targetReached: result.targetReached,
    persistedTotalCandidates: result.persistedTotalCandidates,
    paidAcceptanceMeasured: result.paidAcceptanceMeasured,
  };
}

// ─── La ruta de pago que NO llegó a existir ───────────────────────────────────

/**
 * AGENT1-LOCAL-CUT8B — el aporte de PAGO de una corrida en la que la ruta de
 * pago no corrió, expresado en el vocabulario de la costura del writer.
 *
 * 🔴 Existe para que la rama sólo-gratuita entre por la MISMA puerta que la
 * mixta. La alternativa —llamar a `resolveAcceptedForTarget` con
 * `CONTRIBUTOR_NOT_RUN` desde la rama libre y con
 * `paidAcceptedContributionFromWriterTruth` desde la mixta— dejaba dos entradas
 * a la misma aritmética, que es cómo dos ramas del mismo hecho empiezan a
 * discrepar. Con esta constante las dos llaman al MISMO helper de corrida.
 *
 * 🔴 `completeValidCandidates: null` NO significa aquí «no medido»: con
 * `persistedCandidates: 0` el traductor lo resuelve a `CONTRIBUTOR_NOT_RUN`
 * —cero CONOCIDO— porque un contribuyente que no escribió nada sí sabe su
 * aceptación. Es la misma regla que ya vivía en
 * `paidAcceptedContributionFromWriterTruth`, no una excepción nueva.
 */
export const PAID_ROUTE_NOT_RUN_WRITER_TRUTH: {
  completeValidCandidates: null;
  persistedCandidates: 0;
  reviewOnlyCandidates: null;
} = {
  completeValidCandidates: null,
  persistedCandidates: 0,
  reviewOnlyCandidates: null,
};
