/**
 * AGENT1-LUSHA-CUT-L3 — una tabla de valla EN MEMORIA que sobrevive al «proceso».
 *
 * Por qué existe: lo que el corte afirma es una propiedad de DURABILIDAD, y una
 * propiedad de durabilidad no se puede probar con un doble que muere junto al
 * caso. Aquí la TABLA es el objeto de larga vida y el STORE es efímero: un
 * «reinicio» se modela creando un store nuevo sobre la MISMA tabla, que es
 * exactamente lo que hace un proceso que vuelve a arrancar contra Postgres.
 *
 * Las transiciones replican, una a una, las tres RPC de la migración 135. La
 * suite de PostgreSQL real comprueba que la migración las implementa así; esta
 * tabla existe para que los casos de caída y concurrencia se puedan escribir sin
 * levantar una base por caso.
 *
 * NO es código de producción: vive bajo `__tests__/support`, nadie la importa
 * desde `src` fuera de las pruebas, no llama a ningún proveedor y no gasta nada.
 */

import type {
  LushaRequestFenceClaimResult,
  LushaRequestFenceContext,
  LushaRequestFenceDispatchMarkResult,
  LushaRequestFenceIdentity,
  LushaRequestFenceRetryClaimResult,
  LushaRequestFenceSettlement,
  LushaRequestFenceSettleResult,
  LushaRequestFenceState,
  LushaRequestFenceStore,
} from '../../lusha-request-fence';
import { buildLushaRequestFenceKey } from '../../lusha-request-fence';
import { LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST } from '../../lusha-safe-retry-policy';

/**
 * AGENT1-LUSHA-CUT-L4 — UN intento, es decir UN despacho HTTP posible.
 *
 * Réplica en memoria de una fila de `lusha_prospecting_request_attempts`. Que sea
 * una lista y no un par de campos en `FenceRow` no es cosmética: lo que las
 * suites tienen que poder afirmar es que el intento 1 SIGUE ahí después de que
 * arranque el 2, y eso sólo se puede afirmar sobre algo que se acumula.
 */
export type AttemptRow = {
  attemptNo: number;
  state: LushaRequestFenceState;
  settlement: LushaRequestFenceSettlement | null;
  dispatched: boolean;
};

export type FenceRow = {
  fenceKey: string;
  state: LushaRequestFenceState;
  /** Identidad DURABLE. La que valla. */
  operationId: string;
  /** TRAZA. No valla nada. */
  clientRequestId: string | null;
  branchIndex: number;
  page: number;
  reservationId: string | null;
  triggeredByUserId: string | null;
  dispatched: boolean;
  settled: boolean;
  settlement: LushaRequestFenceSettlement | null;
  /**
   * AGENT1-LUSHA-CUT-L4. El HISTORIAL, en orden. `state`/`settlement` de arriba
   * son la PROYECCIÓN del último intento —igual que en la 136— y se reinician
   * cuando arranca el intento 2; esta lista NO.
   */
  attempts: AttemptRow[];
};

export type FenceTable = {
  rows: Map<string, FenceRow>;
  /** Cuenta de reclamos concedidos. Un duplicado NO debe incrementarla. */
  claimsGranted: number;
  /** Cuenta de marcas de despacho comprometidas. */
  dispatchMarks: number;
  /**
   * Simula la MUERTE del proceso: a partir de aquí ninguna liquidación llega a
   * la tabla. Es lo que distingue una caída dura de un error manejado.
   */
  settleDisabled: boolean;
  /** Fuerza `capability_absent`: la migración 135 no está aplicada. */
  capabilityAbsent: boolean;
  /**
   * AGENT1-LUSHA-CUT-L4 — fuerza `capability_absent` SÓLO en el reclamo de
   * reintento: la 135 aplicada y la 136 NO. Es la topología de despliegue del
   * § 37, y tiene que poder probarse por separado.
   */
  retryCapabilityAbsent: boolean;
  /** Reclamos de reintento CONCEDIDOS. Un duplicado NO debe incrementarla. */
  retryClaimsGranted: number;
};

export function createFenceTable(): FenceTable {
  return {
    rows: new Map(),
    claimsGranted: 0,
    dispatchMarks: 0,
    settleDisabled: false,
    capabilityAbsent: false,
    retryCapabilityAbsent: false,
    retryClaimsGranted: 0,
  };
}

/** Un «proceso» nuevo conectado a la MISMA tabla durable. */
export function createFenceStoreOn(table: FenceTable): LushaRequestFenceStore {
  return {
    async claim(
      identity: LushaRequestFenceIdentity,
      context: LushaRequestFenceContext,
    ): Promise<LushaRequestFenceClaimResult> {
      if (table.capabilityAbsent) return { status: 'capability_absent' };
      const fenceKey = buildLushaRequestFenceKey(identity);
      const existing = table.rows.get(fenceKey);
      if (existing) return { status: 'already_claimed', state: existing.state };
      table.rows.set(fenceKey, {
        fenceKey,
        state: 'prepared',
        operationId: identity.operationId,
        clientRequestId: context.clientRequestId,
        branchIndex: identity.branchIndex,
        page: identity.page,
        reservationId: context.reservationId,
        triggeredByUserId: context.triggeredByUserId,
        dispatched: false,
        settled: false,
        settlement: null,
        // El intento 1 nace CON la valla, en la misma «transacción». Una valla sin
        // intento sería el único estado desde el que no se puede decidir nada.
        attempts: [{ attemptNo: 1, state: 'prepared', settlement: null, dispatched: false }],
      });
      table.claimsGranted += 1;
      return { status: 'claimed' };
    },

    async markDispatchUnsafe(fenceKey: string): Promise<LushaRequestFenceDispatchMarkResult> {
      if (table.capabilityAbsent) return { status: 'capability_absent' };
      const row = table.rows.get(fenceKey);
      if (!row) return { status: 'not_claimable', state: null };
      if (row.state !== 'prepared') return { status: 'not_claimable', state: row.state };
      const attempt = latestAttempt(row);
      // O se marcan la valla Y el intento, o no se marca ninguno.
      if (!attempt || attempt.state !== 'prepared') {
        return { status: 'not_claimable', state: attempt?.state ?? row.state };
      }
      attempt.state = 'dispatch_unsafe';
      attempt.dispatched = true;
      row.state = 'dispatch_unsafe';
      row.dispatched = true;
      table.dispatchMarks += 1;
      return { status: 'marked' };
    },

    async settle(
      fenceKey: string,
      settlement: LushaRequestFenceSettlement,
    ): Promise<LushaRequestFenceSettleResult> {
      if (table.capabilityAbsent) return { status: 'capability_absent' };
      // 🔴 El proceso murió: la liquidación NUNCA llega. La fila se queda en el
      // estado que la frontera dejó, que es justo el punto del caso L3-D.
      if (table.settleDisabled) return { status: 'failed', code: 'process_died' };
      const row = table.rows.get(fenceKey);
      if (!row) return { status: 'not_found' };
      if (row.state === 'prepared' && settlement.state === 'succeeded') {
        // Un éxito exige despacho: la migración lo rechaza y el doble también.
        return { status: 'failed', code: 'fence_settle_invalid_transition' };
      }
      if (row.state !== 'prepared' && row.state !== 'dispatch_unsafe') {
        return { status: 'already_terminal', state: row.state };
      }
      const attempt = latestAttempt(row);
      if (!attempt || (attempt.state !== 'prepared' && attempt.state !== 'dispatch_unsafe')) {
        return { status: 'already_terminal', state: row.state };
      }
      // 🔴 El intento se liquida y queda INMUTABLE. La valla sólo lo PROYECTA.
      attempt.state = settlement.state;
      attempt.settlement = settlement;
      row.state = settlement.state;
      row.settled = true;
      row.settlement = settlement;
      return { status: 'settled' };
    },

    /**
     * AGENT1-LUSHA-CUT-L4 — el reclamo del intento siguiente, replicando una a una
     * las comprobaciones de `claim_lusha_prospecting_retry_attempt` de la 136.
     *
     * 🔴 La elegibilidad se lee de la EVIDENCIA del intento anterior, no de un
     * argumento. Si el doble aceptara que el llamador declarase «esto es
     * reintentable», la suite estaría probando su propia afirmación.
     */
    async claimRetryAttempt(fenceKey: string): Promise<LushaRequestFenceRetryClaimResult> {
      if (table.capabilityAbsent || table.retryCapabilityAbsent) {
        return { status: 'capability_absent' };
      }
      const row = table.rows.get(fenceKey);
      if (!row) return { status: 'failed', code: 'fence_retry_fence_not_found' };
      const last = latestAttempt(row);
      if (!last) return { status: 'failed', code: 'fence_retry_no_attempt_history' };

      const evidence = last.settlement;
      const eligible =
        last.state === 'definitely_not_charged' &&
        evidence !== null &&
        evidence.billingCertainty === 'definitely_not_charged' &&
        evidence.retryContract === 'retryable_by_contract' &&
        (evidence.outcomeClass === 'http_429_rate_limited' ||
          evidence.outcomeClass === 'http_5xx_provider_failure');

      if (!eligible) {
        return {
          status: 'not_retryable',
          state: last.state,
          code: 'fence_retry_not_retryable',
        };
      }

      const nextNo = last.attemptNo + 1;
      if (nextNo > LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST) {
        return { status: 'attempts_exhausted', attemptNo: last.attemptNo };
      }
      if (row.attempts.some((a) => a.attemptNo === nextNo)) {
        return { status: 'already_claimed', attemptNo: nextNo };
      }

      row.attempts.push({
        attemptNo: nextNo,
        state: 'prepared',
        settlement: null,
        dispatched: false,
      });
      // La PROYECCIÓN se reinicia; el intento 1 sigue en `row.attempts[0]`.
      row.state = 'prepared';
      row.dispatched = false;
      row.settled = false;
      row.settlement = null;
      table.retryClaimsGranted += 1;
      return { status: 'claimed', attemptNo: nextNo };
    },
  };
}

function latestAttempt(row: FenceRow): AttemptRow | undefined {
  return row.attempts.length === 0 ? undefined : row.attempts[row.attempts.length - 1];
}

/** El HISTORIAL de intentos de una petición lógica, en orden. */
export function readAttempts(table: FenceTable, key: string): AttemptRow[] {
  return table.rows.get(key)?.attempts ?? [];
}

export function readFenceRow(table: FenceTable, key: string): FenceRow | undefined {
  return table.rows.get(key);
}
