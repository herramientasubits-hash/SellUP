/**
 * AGENT1-LUSHA-CUT-L3 — una tabla de OPERACIONES en memoria que sobrevive al
 * «proceso».
 *
 * Mismo principio que `lusha-request-fence-table`: lo que el arreglo afirma es una
 * propiedad de DURABILIDAD, y una propiedad de durabilidad no se puede probar con
 * un doble que muere junto al caso. La TABLA es el objeto de larga vida y el STORE
 * es efímero; un «reinicio» se modela creando un store nuevo sobre la MISMA tabla,
 * que es lo que hace un proceso que vuelve a arrancar contra Postgres.
 *
 * Las transiciones replican, una a una, las dos RPC de operación de la migración
 * 135 —incluido que `complete` se NIEGUE mientras alguna petición siga sin verdad
 * de facturación asentada—. La suite de PostgreSQL real comprueba que la migración
 * las implementa así.
 *
 * NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde
 * `src` fuera de las pruebas, no llama a ningún proveedor y no gasta nada.
 */

import type {
  LushaOperationClaimResult,
  LushaOperationCompleteResult,
  LushaProspectingOperationIdentity,
  LushaProspectingOperationState,
  LushaProspectingOperationStore,
} from '../../lusha-prospecting-operation';
import type { FenceTable } from './lusha-request-fence-table';

export type OperationRow = {
  operationId: string;
  actorScope: string;
  signatureVersion: string;
  signatureHash: string;
  state: LushaProspectingOperationState;
  lastClientRequestId: string | null;
  resumeAttempts: number;
};

export type OperationTable = {
  rows: Map<string, OperationRow>;
  /** Operaciones REALMENTE acuñadas. Una reanudación NO debe incrementarla. */
  operationsCreated: number;
  /** Fuerza `capability_absent`: la migración 135 no está aplicada. */
  capabilityAbsent: boolean;
  /** Fuerza una avería de la RPC. El llamador debe fallar CERRADO. */
  failClaim: boolean;
  /**
   * La valla de peticiones de la MISMA base. `complete` la consulta, igual que la
   * RPC real: sin ella, cerrar sería una promesa que la base no comprueba.
   */
  fence: FenceTable | null;
  /** Ids deterministas: nada de aleatoriedad en una prueba de identidad. */
  nextId: number;
};

export function createOperationTable(fence: FenceTable | null = null): OperationTable {
  return {
    rows: new Map(),
    operationsCreated: 0,
    capabilityAbsent: false,
    failClaim: false,
    fence,
    nextId: 1,
  };
}

const UNRESOLVED: readonly LushaProspectingOperationState[] = [
  'open',
  'reconciliation_required',
];

/** El índice único PARCIAL de la migración, modelado como búsqueda. */
function findUnresolved(
  table: OperationTable,
  identity: LushaProspectingOperationIdentity,
): OperationRow | undefined {
  for (const row of table.rows.values()) {
    if (
      row.actorScope === identity.actorScope &&
      row.signatureVersion === identity.signatureVersion &&
      row.signatureHash === identity.signatureHash &&
      UNRESOLVED.includes(row.state)
    ) {
      return row;
    }
  }
  return undefined;
}

/**
 * Estados de valla con verdad de facturación ASENTADA. Sólo desde aquí se puede
 * cerrar una operación: `prepared` y `dispatch_unsafe` no se liquidaron, y
 * `indeterminate` y `unknown` no dicen si se cobró.
 */
const SETTLED_FENCE_STATES: readonly string[] = ['succeeded', 'definitely_not_charged'];

function countUnsettled(table: OperationTable, operationId: string): number {
  if (table.fence === null) return 0;
  let n = 0;
  for (const row of table.fence.rows.values()) {
    if (row.operationId === operationId && !SETTLED_FENCE_STATES.includes(row.state)) n += 1;
  }
  return n;
}

/** Un «proceso» nuevo conectado a la MISMA tabla durable. */
export function createOperationStoreOn(
  table: OperationTable,
): LushaProspectingOperationStore {
  return {
    async claimOrResume(
      identity: LushaProspectingOperationIdentity,
    ): Promise<LushaOperationClaimResult> {
      if (table.capabilityAbsent) return { status: 'capability_absent' };
      if (table.failClaim) return { status: 'failed', code: 'operation_claim_rpc_error' };

      const existing = findUnresolved(table, identity);
      if (existing) {
        // 🔴 Reanudar TRANSICIONA a `reconciliation_required`: si alguien vuelve a
        // entrar mientras sigue abierta, o hay un proceso vivo (duplicarlo sería
        // pagar dos veces) o hay uno muerto (hace falta reconciliar). Ninguna de
        // las dos autoriza a gastar, y el estado tiene que poder decirlo.
        existing.state = 'reconciliation_required';
        existing.resumeAttempts += 1;
        existing.lastClientRequestId =
          identity.clientRequestId ?? existing.lastClientRequestId;
        return {
          status: 'resumed_unresolved',
          operationId: existing.operationId,
          state: existing.state,
        };
      }

      const operationId = `op-${table.nextId}`;
      table.nextId += 1;
      table.rows.set(operationId, {
        operationId,
        actorScope: identity.actorScope,
        signatureVersion: identity.signatureVersion,
        signatureHash: identity.signatureHash,
        state: 'open',
        lastClientRequestId: identity.clientRequestId,
        resumeAttempts: 0,
      });
      table.operationsCreated += 1;
      return { status: 'created', operationId };
    },

    async complete(operationId: string): Promise<LushaOperationCompleteResult> {
      if (table.capabilityAbsent) return { status: 'capability_absent' };
      const row = table.rows.get(operationId);
      if (!row) return { status: 'not_found' };
      if (row.state === 'completed') return { status: 'already_completed' };

      const unsettled = countUnsettled(table, operationId);
      if (unsettled > 0) {
        row.state = 'reconciliation_required';
        return { status: 'blocked_unsettled_requests', unsettled };
      }
      row.state = 'completed';
      return { status: 'completed' };
    },
  };
}

export function readOperationRow(
  table: OperationTable,
  operationId: string,
): OperationRow | undefined {
  return table.rows.get(operationId);
}
