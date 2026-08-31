/**
 * AGENT1-LUSHA-CUT-L3 — una tabla de valla EN MEMORIA que sobrevive al «proceso».
 *
 * Por qué existe: lo que el corte afirma es una propiedad de DURABILIDAD, y una
 * propiedad de durabilidad no se puede probar con un doble que muere junto al
 * caso. Aquí la TABLA es el objeto de larga vida y el STORE es efímero: un
 * «reinicio» se modela creando un store nuevo sobre la MISMA tabla, que es
 * exactamente lo que hace un proceso que vuelve a arrancar contra Postgres.
 *
 * Las transiciones replican, una a una, las tres RPC de la migración 134. La
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
  LushaRequestFenceSettlement,
  LushaRequestFenceSettleResult,
  LushaRequestFenceState,
  LushaRequestFenceStore,
} from '../../lusha-request-fence';
import { buildLushaRequestFenceKey } from '../../lusha-request-fence';

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
  /** Fuerza `capability_absent`: la migración 134 no está aplicada. */
  capabilityAbsent: boolean;
};

export function createFenceTable(): FenceTable {
  return {
    rows: new Map(),
    claimsGranted: 0,
    dispatchMarks: 0,
    settleDisabled: false,
    capabilityAbsent: false,
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
      });
      table.claimsGranted += 1;
      return { status: 'claimed' };
    },

    async markDispatchUnsafe(fenceKey: string): Promise<LushaRequestFenceDispatchMarkResult> {
      if (table.capabilityAbsent) return { status: 'capability_absent' };
      const row = table.rows.get(fenceKey);
      if (!row) return { status: 'not_claimable', state: null };
      if (row.state !== 'prepared') return { status: 'not_claimable', state: row.state };
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
      row.state = settlement.state;
      row.settled = true;
      row.settlement = settlement;
      return { status: 'settled' };
    },
  };
}

export function readFenceRow(table: FenceTable, key: string): FenceRow | undefined {
  return table.rows.get(key);
}
