/**
 * run-budget-ledger.ts — el presupuesto ACUMULADO de una corrida.
 *
 * AGENT1-APOLLO-DURABLE-RUN-BUDGET § 1.
 *
 * ── 🔴 El defecto que cierra ─────────────────────────────────────────────────
 *
 * Hasta este corte el control era `recorded <= input.reservedCredits`, evaluado
 * DESPUÉS de gastar. Tres agujeros, y los tres importan:
 *
 *   1. es POSTERIOR. Sólo sabe lo ya registrado, así que la operación que CRUZA
 *      el límite se llama igual: el tope se descubre cuando ya se pagó;
 *   2. NO acumula. `reservedCredits` viaja en el `runInput`, y una continuación
 *      replica ese mismo input: cada invocación empieza con el máximo intacto.
 *      Con tres continuaciones, un tope de 15 autoriza 60;
 *   3. una operación con cobro INDETERMINADO suma sus `credits`, que son 0
 *      cuando el cobro no se pudo confirmar. Es decir, libera presupuesto como
 *      si hubiera sido gratuita — justo al revés de lo que el hecho significa.
 *
 * Este módulo es la autoridad del gasto: se RESERVA antes de llamar, la reserva
 * es durable y acumulativa, y nada la reduce salvo una liquidación que confirme
 * un coste menor. Puro: sin reloj, sin red, sin base.
 */

export type RunBudgetOperationKey = 'organizations_search' | 'organization_enrichment';

export type RunBudgetEntryState =
  /** Reservada antes de llamar. El proveedor puede haber cobrado o no. */
  | 'reserved'
  /** Liquidada con el coste REAL confirmado. */
  | 'settled'
  /** Ejecutada con cobro sin confirmar. NO libera presupuesto. */
  | 'indeterminate';

export type RunBudgetEntry = {
  readonly operationId: string;
  readonly operationKey: RunBudgetOperationKey;
  /** Coste reservado ANTES de la llamada. Nunca se reduce. */
  readonly reservedCredits: number;
  /** Coste real. `null` mientras la operación no liquide. */
  readonly settledCredits: number | null;
  readonly state: RunBudgetEntryState;
};

export type RunBudgetLedger = {
  /**
   * Máximo DURABLE de la corrida ORIGINAL.
   *
   * Se fija una vez, en la primera invocación, y ninguna continuación ni
   * reintento lo vuelve a escribir. Es lo que impide que replicar el `runInput`
   * reinicie el tope.
   */
  readonly maxCredits: number;
  readonly entries: readonly RunBudgetEntry[];
};

export type RunBudgetRefusalReason = 'insufficient_budget' | 'invalid_cost';

export type RunBudgetReservation =
  | { readonly ok: true; readonly ledger: RunBudgetLedger; readonly alreadyReserved: boolean }
  | {
      readonly ok: false;
      readonly reason: RunBudgetRefusalReason;
      readonly remainingCredits: number;
      readonly requestedCredits: number;
    };

/** Ledger vacío con el máximo de la corrida. */
export function createRunBudgetLedger(maxCredits: number): RunBudgetLedger {
  return { maxCredits: Math.max(0, Math.trunc(maxCredits)), entries: [] };
}

/**
 * Lo que el presupuesto ya NO tiene disponible.
 *
 * 🔴 La regla del estado `indeterminate` es el corazón de este módulo: cuenta
 * como `max(reservado, liquidado)`, nunca como cero. Una operación cuyo cobro
 * no se pudo confirmar PUDO haber cobrado; tratarla como gratuita convierte una
 * duda en presupuesto nuevo, y es exactamente así como un tope de 15 termina
 * autorizando más de 15.
 */
export function committedCredits(ledger: RunBudgetLedger): number {
  return ledger.entries.reduce((total, entry) => {
    if (entry.state === 'settled') return total + (entry.settledCredits ?? 0);
    if (entry.state === 'indeterminate') {
      return total + Math.max(entry.reservedCredits, entry.settledCredits ?? 0);
    }
    return total + entry.reservedCredits;
  }, 0);
}

export function remainingCredits(ledger: RunBudgetLedger): number {
  return Math.max(0, ledger.maxCredits - committedCredits(ledger));
}

const findEntry = (ledger: RunBudgetLedger, operationId: string): RunBudgetEntry | undefined =>
  ledger.entries.find((entry) => entry.operationId === operationId);

/**
 * Reserva el coste de UNA operación cobrable antes de llamar al proveedor.
 *
 * Idempotente por `operationId`: un reintento de la MISMA operación —incluida
 * la que perdió su respuesta— no vuelve a reservar. Sin esa idempotencia, el
 * reintento consumiría presupuesto dos veces por un solo cargo posible.
 */
export function reserveOperation(
  ledger: RunBudgetLedger,
  input: {
    readonly operationId: string;
    readonly operationKey: RunBudgetOperationKey;
    readonly estimatedCredits: number;
  },
): RunBudgetReservation {
  const existing = findEntry(ledger, input.operationId);
  if (existing) return { ok: true, ledger, alreadyReserved: true };

  const cost = Math.trunc(input.estimatedCredits);
  if (!Number.isFinite(cost) || cost < 0) {
    return {
      ok: false,
      reason: 'invalid_cost',
      remainingCredits: remainingCredits(ledger),
      requestedCredits: input.estimatedCredits,
    };
  }

  const remaining = remainingCredits(ledger);
  if (cost > remaining) {
    return {
      ok: false,
      reason: 'insufficient_budget',
      remainingCredits: remaining,
      requestedCredits: cost,
    };
  }

  return {
    ok: true,
    alreadyReserved: false,
    ledger: {
      maxCredits: ledger.maxCredits,
      entries: [
        ...ledger.entries,
        {
          operationId: input.operationId,
          operationKey: input.operationKey,
          reservedCredits: cost,
          settledCredits: null,
          state: 'reserved',
        },
      ],
    },
  };
}

/**
 * Liquida una operación con su coste REAL.
 *
 * Puede liberar presupuesto sólo si el coste real fue menor que el reservado.
 * Una operación desconocida se ignora: liquidar lo que nunca se reservó
 * significaría que alguien llamó al proveedor sin pasar por la reserva.
 */
export function settleOperation(
  ledger: RunBudgetLedger,
  input: { readonly operationId: string; readonly credits: number },
): RunBudgetLedger {
  return {
    maxCredits: ledger.maxCredits,
    entries: ledger.entries.map((entry) =>
      entry.operationId === input.operationId
        ? {
            ...entry,
            settledCredits: Math.max(0, Math.trunc(input.credits)),
            state: 'settled' as const,
          }
        : entry,
    ),
  };
}

/**
 * Marca una operación con cobro SIN CONFIRMAR.
 *
 * Conserva la reserva: el presupuesto sigue comprometido. Es el único
 * tratamiento honesto de «pudo cobrar y no lo sé».
 */
export function markOperationIndeterminate(
  ledger: RunBudgetLedger,
  input: { readonly operationId: string; readonly observedCredits?: number | null },
): RunBudgetLedger {
  return {
    maxCredits: ledger.maxCredits,
    entries: ledger.entries.map((entry) =>
      entry.operationId === input.operationId
        ? {
            ...entry,
            settledCredits:
              typeof input.observedCredits === 'number'
                ? Math.max(0, Math.trunc(input.observedCredits))
                : entry.settledCredits,
            state: 'indeterminate' as const,
          }
        : entry,
    ),
  };
}

/** ¿Alguna operación quedó con el cobro sin confirmar? */
export function hasIndeterminateSpend(ledger: RunBudgetLedger): boolean {
  return ledger.entries.some((entry) => entry.state === 'indeterminate');
}

/**
 * Rehidrata el ledger de un documento durable.
 *
 * `maxCredits` NUNCA se toma del llamador cuando el documento ya lo tiene: ése
 * es el punto exacto donde un `runInput` replicado reiniciaría el tope.
 */
export function hydrateRunBudgetLedger(
  stored: unknown,
  fallbackMaxCredits: number,
): RunBudgetLedger {
  const doc = (stored ?? {}) as { maxCredits?: unknown; entries?: unknown };
  const storedMax = typeof doc.maxCredits === 'number' ? Math.trunc(doc.maxCredits) : null;
  const entries = Array.isArray(doc.entries) ? doc.entries : [];

  return {
    maxCredits: storedMax !== null && storedMax >= 0 ? storedMax : Math.max(0, Math.trunc(fallbackMaxCredits)),
    entries: entries.flatMap((raw): RunBudgetEntry[] => {
      const entry = raw as Partial<RunBudgetEntry>;
      if (typeof entry.operationId !== 'string' || entry.operationId === '') return [];
      const state: RunBudgetEntryState =
        entry.state === 'settled' || entry.state === 'indeterminate' ? entry.state : 'reserved';
      return [
        {
          operationId: entry.operationId,
          operationKey:
            entry.operationKey === 'organization_enrichment'
              ? 'organization_enrichment'
              : 'organizations_search',
          reservedCredits: Math.max(0, Math.trunc(Number(entry.reservedCredits ?? 0))),
          settledCredits:
            typeof entry.settledCredits === 'number'
              ? Math.max(0, Math.trunc(entry.settledCredits))
              : null,
          state,
        },
      ];
    }),
  };
}
