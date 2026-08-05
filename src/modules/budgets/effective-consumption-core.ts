/**
 * effective-consumption-core.ts — La fuente económica CANÓNICA del presupuesto
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4N).
 *
 * ── EL AGUJERO QUE CIERRA ────────────────────────────────────────────────────
 *
 * Hasta este hito el consumo presupuestario se agregaba EXCLUSIVAMENTE desde
 * `provider_usage_logs.credits_used`. Eso funciona mientras el proveedor reporte lo que
 * cobró, y Apollo NO lo reporta en el reveal de teléfono: sus usage logs llevan
 * `credits_used = NULL`. La primera corrida real del waterfall (`cec34235`, 2026-08-05)
 * dejó exactamente ese rastro — dos filas de `person_phone_reveal` con `credits_used`
 * NULL y una reserva `confirmed` de 8 con `cost_truth = 'assumed_cap'` — así que los 8
 * créditos que la plataforma SÍ contabilizó como gastados no aparecían en ningún
 * cálculo de presupuesto. El pozo de Apollo se leía con 8 créditos de más disponibles.
 *
 * La reserva confirmada es la única cifra económica que existe en ese caso, así que el
 * consumo pasa a ser:
 *
 *   effective_consumed
 *     = créditos de `provider_usage_logs` NO representados ya por una reserva confirmada
 *     + SUM(`phone_reveal_credit_reservations.credits_confirmed`) del MISMO pozo
 *
 * ── POR QUÉ HAY QUE EXCLUIR, Y NO SOLO SUMAR ─────────────────────────────────
 *
 * Sumar las reservas confirmadas sin más produce DOBLE CONTEO en cuanto el proveedor sí
 * reporta. La corrida `543e40ca` es el contraejemplo real: Lusha reportó 5 créditos en
 * su usage log Y su reserva se confirmó en 5 con `cost_truth = 'reported'`. Sumar las
 * dos cosas da 10 sobre un pozo de 10 con 5 de consumo histórico ⇒ 15, cuando el gasto
 * real del mes son 10. El mismo gasto contado dos veces bloquearía operaciones viables.
 *
 * La exclusión es por PATA LIQUIDADA, no por corrida: un usage log correlacionado con
 * una corrida waterfall deja de contar SOLO si esa corrida tiene una reserva
 * `confirmed` para ESE proveedor. Si la pata se liberó, si la reserva no existe
 * (corridas anteriores a la migración 104) o si todavía está `reserved`, el usage log
 * SIGUE contando: la alternativa sería hacer desaparecer gasto real.
 *
 * ── DIRECCIÓN DEL ERROR CUANDO HAY DUDA ──────────────────────────────────────
 *
 * Mientras una pata está `reserved` y su usage log ya está escrito, el usage log cuenta
 * COMO CONSUMO y la reserva cuenta COMO EXPOSICIÓN: el mismo gasto ocupa saldo dos
 * veces durante esa ventana. Es deliberado y es la dirección segura del error —
 * sobre-bloquear una operación es recuperable, sobre-gastar créditos ajenos no. En
 * cuanto la reserva pasa a `confirmed` la exclusión entra y la cifra se corrige.
 *
 * ── LA VENTANA DE DOBLE DISPONIBILIDAD (§3) ──────────────────────────────────
 *
 * `reserved → confirmed` NO puede devolver crédito a `available` ni por un instante.
 * Eso obliga a algo que este core no puede garantizar solo: las filas `reserved` y
 * `confirmed` tienen que llegar de UNA SOLA LECTURA. Con dos consultas separadas una
 * fila que transiciona entre ellas se lee `reserved` en la primera y `confirmed` en la
 * segunda —o al revés, y entonces no se cuenta en NINGUNA—, que es precisamente el
 * hueco. Por eso la entrada de este core es un ÚNICO snapshot de reservas con todos los
 * estados dentro, y la partición por estado se hace aquí, sobre datos ya coherentes.
 *
 * ── USD NO SE EXCLUYE ────────────────────────────────────────────────────────
 *
 * Las reservas están denominadas en CRÉDITOS y no llevan USD, así que aportan 0 al
 * subtotal en dólares. Excluir el USD de un usage log correlacionado perdería dólares
 * realmente reportados sin que nada los reemplace, así que la exclusión afecta
 * ÚNICAMENTE a los créditos. El USD sigue viniendo entero de los usage logs, con su
 * `hasUnknownCost` calculado sobre TODAS las filas (incluidas las excluidas: su dólar
 * sigue siendo desconocido).
 *
 * PURO por contrato: sin I/O, sin Supabase, sin fetch, sin process.env, sin Date.now().
 * Las filas llegan ya leídas como dato, lo que hace verificable OFFLINE la aritmética
 * que decide si se gastan créditos reales.
 */

/**
 * Clave de `provider_usage_logs.metadata` que correlaciona un usage log con la corrida
 * del waterfall que lo originó. La escriben los cuatro caminos que pueden gastar bajo
 * una autorización de reveal (start de Apollo, webhook de Apollo, recuperación y pata
 * Lusha), y es la ÚNICA correlación disponible: `provider_usage_logs` no tiene columna
 * de corrida.
 */
export const WATERFALL_USAGE_CORRELATION_KEY = 'phone_reveal_waterfall_id';

// ── Entradas ───────────────────────────────────────────────────

/** Una fila de `provider_usage_logs` reducida a lo que el presupuesto necesita. */
export interface UsageConsumptionRow {
  providerKey: string;
  /** `credits_used`. NULL = el proveedor no reportó cuánto cobró (no es 0). */
  creditsUsed: number | null;
  /** `estimated_cost_usd`. NULL = costo en dólares desconocido. */
  estimatedCostUsd: number | null;
  /** `metadata.phone_reveal_waterfall_id`, o null si el log no nació de una corrida. */
  waterfallRunId: string | null;
}

export type ReservationSnapshotStatus = 'reserved' | 'confirmed' | 'released';

/**
 * Una fila de `phone_reveal_credit_reservations` del pozo consultado, tal como estaba
 * en el snapshot. Los tres estados llegan juntos a propósito (ver la cabecera).
 */
export interface ReservationSnapshotRow {
  providerKey: string;
  status: ReservationSnapshotStatus;
  /** Tope de la pata. Es la EXPOSICIÓN mientras el estado sea `reserved`. */
  creditsReserved: number | null;
  /** Costo liquidado. Solo tiene sentido en `confirmed` (lo garantiza un CHECK). */
  creditsConfirmed: number | null;
  /** Procedencia de la cifra liquidada: reportada por el proveedor o tope asumido. */
  costTruth: 'reported' | 'assumed_cap' | null;
  /** Back-reference a la corrida. Puede ser null (lado de conveniencia, mig. 104). */
  runId: string | null;
  /** Grupo de la autorización. Lado AUTORITATIVO de la asociación con la corrida. */
  reservationGroupId: string | null;
}

// ── Salida ─────────────────────────────────────────────────────

/**
 * Desglose auditable de cómo se formó la cifra. Existe para que la UI pueda decir
 * "Costo reportado por Apollo: no disponible / Costo contabilizado: 8 créditos / Fuente:
 * tope autorizado asumido" sin volver a derivar nada, y para que un cuadre manual pueda
 * comprobar la resta en vez de creérsela.
 */
export interface EffectiveConsumptionBreakdown {
  /** Créditos de usage logs que SÍ cuentan (los no representados por una reserva). */
  usageLogCredits: number;
  /** Créditos aportados por reservas `confirmed` del pozo. */
  confirmedReservationCredits: number;
  /** Créditos de usage logs excluidos por estar ya representados por una reserva. */
  excludedUsageLogCredits: number;
  /** Cuántas filas se excluyeron. Con Apollo son ≥ 2 por corrida (start + webhook). */
  excludedUsageLogCount: number;
  /**
   * true cuando alguna reserva contada se liquidó con `assumed_cap`. La cifra en
   * créditos es entonces el TOPE autorizado, no un costo reportado por el proveedor.
   * NO cambia ninguna aritmética ni ninguna decisión: hace explícito el hueco, igual
   * que `hasUnknownCost` con el USD.
   */
  hasAssumedCapCredits: boolean;
  /**
   * Filas `confirmed` sin `credits_confirmed` legible. El CHECK
   * `..._confirmation_shape_check` las prohíbe, así que esto solo puede ser > 0 si algo
   * escribió por fuera de las funciones de la migración 104. Se cuentan como 0 créditos
   * —no se inventa una cifra— pero quedan visibles en vez de desaparecer.
   */
  malformedConfirmedReservationCount: number;
}

/**
 * Consumo efectivo de UN pozo. Es un superconjunto estructural de `PeriodConsumption`
 * (`credits` / `usd` / `hasUnknownCost`) para poder sustituirlo allí donde antes se leía
 * solo de `provider_usage_logs`, sin que ningún consumidor cambie de forma. Los campos se
 * declaran aquí en vez de heredarlos de `./types` para que la dependencia entre los dos
 * módulos sea de UN SOLO sentido: `types.ts` importa el desglose de este core.
 */
export interface EffectiveConsumption {
  /** `effective_consumed`: usage logs no representados + reservas confirmadas. */
  credits: number;
  /** Subtotal en dólares, agregado ÍNTEGRO de los usage logs (las reservas no llevan USD). */
  usd: number;
  /** true si alguna fila no tenía `estimated_cost_usd`: `usd` no es el total completo. */
  hasUnknownCost: boolean;
  /**
   * Exposición VIVA del pozo: SUM(`credits_reserved`) de las filas `reserved`. No es
   * consumo (nadie ha cobrado todavía) pero ocupa disponibilidad, así que la fórmula
   * completa es `available = limit - credits - reservedCredits`, exactamente la de
   * `reserve_and_create_phone_reveal_run`.
   */
  reservedCredits: number;
  breakdown: EffectiveConsumptionBreakdown;
}

// ── Patas liquidadas ───────────────────────────────────────────

/** Clave de una pata: una corrida × un proveedor. */
function settledLegKey(runId: string, providerKey: string): string {
  return `${runId}|${providerKey}`;
}

/**
 * Patas cuyo costo ya está representado por una reserva `confirmed`, y cuyos usage logs
 * por tanto NO deben volver a sumarse.
 *
 * La asociación reserva → corrida se resuelve por los DOS caminos que la migración 104
 * define, porque ninguno está garantizado por separado: `run_id` es el lado de
 * conveniencia (nullable, se escribe después del INSERT de la corrida) y
 * `phone_reveal_waterfall_runs.credit_reservation_group_id` es el AUTORITATIVO (se
 * escribe dentro del INSERT). Usar solo `run_id` dejaría sin excluir las corridas cuya
 * back-reference nunca se escribió, y esas son precisamente las que sí gastaron.
 */
export function collectSettledWaterfallLegs(args: {
  reservations: readonly ReservationSnapshotRow[];
  /** `credit_reservation_group_id` → `phone_reveal_waterfall_runs.id`. */
  runIdByReservationGroupId?: ReadonlyMap<string, string>;
}): ReadonlySet<string> {
  const settled = new Set<string>();

  for (const reservation of args.reservations) {
    if (reservation.status !== 'confirmed') continue;

    if (reservation.runId) {
      settled.add(settledLegKey(reservation.runId, reservation.providerKey));
    }

    if (reservation.reservationGroupId) {
      const runId = args.runIdByReservationGroupId?.get(reservation.reservationGroupId);
      if (runId) settled.add(settledLegKey(runId, reservation.providerKey));
    }
  }

  return settled;
}

// ── Cálculo ────────────────────────────────────────────────────

function isFiniteNumber(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * `effective_consumed` de un pozo a partir de UN snapshot de usage logs y UN snapshot de
 * reservas. No decide nada sobre autorizar o bloquear: solo produce la cifra que el
 * cálculo de disponibilidad tiene que usar.
 *
 * Las filas pueden venir de varios proveedores: la exclusión se decide por pata
 * (corrida × proveedor), así que un log de Apollo nunca se cancela con una reserva de
 * Lusha.
 */
export function computeEffectiveConsumption(args: {
  usageLogs: readonly UsageConsumptionRow[];
  reservations: readonly ReservationSnapshotRow[];
  runIdByReservationGroupId?: ReadonlyMap<string, string>;
}): EffectiveConsumption {
  const settledLegs = collectSettledWaterfallLegs({
    reservations: args.reservations,
    runIdByReservationGroupId: args.runIdByReservationGroupId,
  });

  let usageLogCredits = 0;
  let excludedUsageLogCredits = 0;
  let excludedUsageLogCount = 0;
  let usd = 0;
  let hasUnknownCost = false;

  for (const row of args.usageLogs) {
    // El USD se agrega SIEMPRE, excluido o no: las reservas no aportan dólares, así que
    // descartarlo aquí perdería un costo reportado sin reemplazo.
    if (isFiniteNumber(row.estimatedCostUsd)) {
      usd += row.estimatedCostUsd;
    } else {
      hasUnknownCost = true;
    }

    const credits = isFiniteNumber(row.creditsUsed) ? row.creditsUsed : 0;
    const isSettled =
      row.waterfallRunId !== null &&
      settledLegs.has(settledLegKey(row.waterfallRunId, row.providerKey));

    if (isSettled) {
      excludedUsageLogCredits += credits;
      excludedUsageLogCount += 1;
      continue;
    }

    usageLogCredits += credits;
  }

  let confirmedReservationCredits = 0;
  let reservedCredits = 0;
  let hasAssumedCapCredits = false;
  let malformedConfirmedReservationCount = 0;

  for (const reservation of args.reservations) {
    if (reservation.status === 'reserved') {
      // Una exposición sin cifra legible NO se trata como 0: eso liberaría
      // disponibilidad que la operación todavía puede gastar. Sin número que sumar, lo
      // único honesto es no restarla, y la reserva atómica del SQL es el gate real.
      if (isFiniteNumber(reservation.creditsReserved)) {
        reservedCredits += reservation.creditsReserved;
      }
      continue;
    }

    if (reservation.status !== 'confirmed') continue;

    if (!isFiniteNumber(reservation.creditsConfirmed)) {
      malformedConfirmedReservationCount += 1;
      continue;
    }

    confirmedReservationCredits += reservation.creditsConfirmed;
    if (reservation.costTruth === 'assumed_cap') hasAssumedCapCredits = true;
  }

  return {
    credits: usageLogCredits + confirmedReservationCredits,
    usd,
    hasUnknownCost,
    reservedCredits,
    breakdown: {
      usageLogCredits,
      confirmedReservationCredits,
      excludedUsageLogCredits,
      excludedUsageLogCount,
      hasAssumedCapCredits,
      malformedConfirmedReservationCount,
    },
  };
}

/**
 * Igual que `computeEffectiveConsumption` pero agrupando por proveedor, para el resumen
 * de administración, que resuelve todos los pozos en una pasada. Las patas liquidadas se
 * calculan UNA vez sobre el snapshot completo: la clave ya lleva el proveedor, así que
 * agrupar después no puede cruzar pozos.
 */
export function computeEffectiveConsumptionByProvider(args: {
  usageLogs: readonly UsageConsumptionRow[];
  reservations: readonly ReservationSnapshotRow[];
  runIdByReservationGroupId?: ReadonlyMap<string, string>;
}): Map<string, EffectiveConsumption> {
  const providerKeys = new Set<string>([
    ...args.usageLogs.map((row) => row.providerKey),
    ...args.reservations.map((row) => row.providerKey),
  ]);

  const result = new Map<string, EffectiveConsumption>();
  for (const providerKey of providerKeys) {
    result.set(
      providerKey,
      computeEffectiveConsumption({
        usageLogs: args.usageLogs.filter((row) => row.providerKey === providerKey),
        reservations: args.reservations.filter((row) => row.providerKey === providerKey),
        runIdByReservationGroupId: args.runIdByReservationGroupId,
      }),
    );
  }
  return result;
}
