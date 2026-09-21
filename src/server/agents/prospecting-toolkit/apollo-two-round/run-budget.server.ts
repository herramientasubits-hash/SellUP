/**
 * run-budget.server.ts — el presupuesto de la corrida, DURABLE y con reserva
 * previa.
 *
 * AGENT1-APOLLO-DURABLE-RUN-BUDGET § 1.
 *
 * Vive en `prospect_batches.metadata`, con la MISMA disciplina de
 * comparación-y-cambio que el checkpoint y la valla de páginas: releer, fusionar
 * y escribir con guarda de versión. No hace falta ninguna migración.
 *
 * ── La secuencia que hace que el tope sea un tope ────────────────────────────
 *
 *   1. se RESERVA el coste de la operación y la reserva se ESCRIBE durablemente;
 *   2. sólo si esa escritura gana el CAS se llama al proveedor;
 *   3. al volver, se LIQUIDA con el coste real, o se marca INDETERMINADA.
 *
 * El orden importa: reservar después de llamar no es un tope, es un recuento. Y
 * si el paso 1 no queda durable, el paso 2 no ocurre — perder la reserva y
 * llamar igual es exactamente cómo dos ejecutores gastan el mismo último
 * crédito.
 *
 * Server-only.
 */
import {
  tryGetAdminClientForTwoRound,
  type CheckpointStoreClient,
} from './checkpoint.server';
import {
  hydrateRunBudgetLedger,
  reserveOperation,
  settleOperation,
  markOperationIndeterminate,
  remainingCredits,
  type RunBudgetLedger,
  type RunBudgetOperationKey,
  type RunBudgetRefusalReason,
} from './run-budget-ledger';

export const APOLLO_RUN_BUDGET_METADATA_KEY = 'apollo_run_budget';
const RUN_BUDGET_CONTRACT_VERSION = 1 as const;
/** Intentos ante conflicto. Acotado: no es un candado distribuido. */
const MAX_WRITE_ATTEMPTS = 5;

const VERSION_FILTER_PATH =
  `metadata->${APOLLO_RUN_BUDGET_METADATA_KEY}->>budget_version` as const;
const PRESENCE_FILTER_PATH = `metadata->${APOLLO_RUN_BUDGET_METADATA_KEY}` as const;

export type RunBudgetIdentity = { idempotencyKey: string; requestFingerprint: string };

export type RunBudgetAuthorization =
  | { readonly authorized: true; readonly alreadyReserved: boolean; readonly remainingCredits: number }
  | {
      readonly authorized: false;
      readonly reason: RunBudgetRefusalReason | 'not_durable';
      readonly remainingCredits: number;
      readonly detail?: string;
    };

type StoredDoc = {
  version: typeof RUN_BUDGET_CONTRACT_VERSION;
  budget_version: number;
  idempotency_key: string;
  request_fingerprint: string;
  ledger: { maxCredits: number; entries: RunBudgetLedger['entries'] };
};

function readStoredVersion(metadata: Record<string, unknown>): number | null {
  const stored = metadata[APOLLO_RUN_BUDGET_METADATA_KEY];
  if (stored === null || typeof stored !== 'object') return null;
  const version = (stored as { budget_version?: unknown }).budget_version;
  return typeof version === 'number' && Number.isFinite(version) ? version : 0;
}

/**
 * Lee el documento SÓLO si pertenece a esta corrida.
 *
 * Una identidad distinta es otro trabajo: reutilizar su presupuesto mezclaría
 * dos corridas en un mismo tope.
 */
function readStoredLedger(
  metadata: Record<string, unknown>,
  identity: RunBudgetIdentity,
  fallbackMaxCredits: number,
): RunBudgetLedger {
  const stored = metadata[APOLLO_RUN_BUDGET_METADATA_KEY] as StoredDoc | undefined;
  if (
    !stored ||
    typeof stored !== 'object' ||
    stored.idempotency_key !== identity.idempotencyKey ||
    stored.request_fingerprint !== identity.requestFingerprint
  ) {
    return hydrateRunBudgetLedger(null, fallbackMaxCredits);
  }
  return hydrateRunBudgetLedger(stored.ledger, fallbackMaxCredits);
}

/**
 * Aplica una transformación al ledger durable con relectura + CAS.
 *
 * `apply` devuelve `null` para ABORTAR sin escribir —es lo que hace una reserva
 * que no cabe—, de forma que el rechazo nunca deja rastro ni consume una versión.
 */
async function mutateRunBudget(
  batchId: string,
  identity: RunBudgetIdentity,
  fallbackMaxCredits: number,
  apply: (ledger: RunBudgetLedger) => RunBudgetLedger | null,
  clientOverride?: CheckpointStoreClient | null,
): Promise<
  { kind: 'written'; ledger: RunBudgetLedger } | { kind: 'aborted'; ledger: RunBudgetLedger } | { kind: 'failed'; reason: string }
> {
  const client = clientOverride ?? (tryGetAdminClientForTwoRound() as CheckpointStoreClient | null);
  if (!client) return { kind: 'failed', reason: 'no_supabase_client' };

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    let current: Record<string, unknown> = {};
    let storedVersion: number | null = null;
    try {
      const { data, error } = await client
        .from('prospect_batches')
        .select('metadata')
        .eq('id', batchId)
        .maybeSingle();
      if (error) return { kind: 'failed', reason: error.message };
      if (!data) return { kind: 'failed', reason: 'batch_not_found' };
      current =
        data.metadata !== null && typeof data.metadata === 'object'
          ? (data.metadata as Record<string, unknown>)
          : {};
      storedVersion = readStoredVersion(current);
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : 'read_failed' };
    }

    const ledger = readStoredLedger(current, identity, fallbackMaxCredits);
    const next = apply(ledger);
    if (next === null) return { kind: 'aborted', ledger };

    const nextDoc: StoredDoc = {
      version: RUN_BUDGET_CONTRACT_VERSION,
      budget_version: Math.max(1, (storedVersion ?? 0) + 1),
      idempotency_key: identity.idempotencyKey,
      request_fingerprint: identity.requestFingerprint,
      ledger: { maxCredits: next.maxCredits, entries: next.entries },
    };

    try {
      const update = client
        .from('prospect_batches')
        .update({ metadata: { ...current, [APOLLO_RUN_BUDGET_METADATA_KEY]: nextDoc } })
        .eq('id', batchId);
      const guarded =
        storedVersion === null
          ? update.is(PRESENCE_FILTER_PATH, null)
          : update.eq(VERSION_FILTER_PATH, String(storedVersion));
      const { data, error } = await guarded.select('id');
      if (error) return { kind: 'failed', reason: error.message };
      if (Array.isArray(data) && data.length > 0) return { kind: 'written', ledger: next };
      // Cero filas = otro ejecutor escribió entre la lectura y el UPDATE.
      // Se relee y se vuelve a DECIDIR: el remanente pudo cambiar, así que la
      // reserva se evalúa otra vez contra el estado nuevo.
    } catch (err) {
      return { kind: 'failed', reason: err instanceof Error ? err.message : 'update_failed' };
    }
  }
  return { kind: 'failed', reason: 'cas_contention_exhausted' };
}

/**
 * § 1 — autoriza (o no) UNA operación cobrable, reservando su coste.
 *
 * 🔴 `authorized: false` significa NO LLAMAR al proveedor. Incluye el caso
 * `not_durable`: si la reserva no se pudo escribir, la llamada no sale. Preferir
 * llamar «porque seguramente cabía» es justo lo que rompe el tope.
 */
export async function authorizeRunBudgetSpend(
  batchId: string,
  identity: RunBudgetIdentity,
  input: {
    readonly operationId: string;
    readonly operationKey: RunBudgetOperationKey;
    readonly estimatedCredits: number;
    /** Máximo de la corrida. Sólo se usa si el documento todavía no existe. */
    readonly maxCredits: number;
  },
  clientOverride?: CheckpointStoreClient | null,
): Promise<RunBudgetAuthorization> {
  let refusal: { reason: RunBudgetRefusalReason; remaining: number } | null = null;
  let alreadyReserved = false;

  const outcome = await mutateRunBudget(
    batchId,
    identity,
    input.maxCredits,
    (ledger) => {
      const reservation = reserveOperation(ledger, {
        operationId: input.operationId,
        operationKey: input.operationKey,
        estimatedCredits: input.estimatedCredits,
      });
      if (!reservation.ok) {
        refusal = { reason: reservation.reason, remaining: reservation.remainingCredits };
        return null;
      }
      alreadyReserved = reservation.alreadyReserved;
      // Una reserva ya existente no necesita escritura: el presupuesto ya la
      // tiene comprometida y reescribirla sólo gastaría una versión.
      return reservation.alreadyReserved ? null : reservation.ledger;
    },
    clientOverride,
  );

  if (outcome.kind === 'failed') {
    return { authorized: false, reason: 'not_durable', remainingCredits: 0, detail: outcome.reason };
  }
  if (outcome.kind === 'aborted') {
    if (alreadyReserved) {
      return { authorized: true, alreadyReserved: true, remainingCredits: remainingCredits(outcome.ledger) };
    }
    const refused = refusal as { reason: RunBudgetRefusalReason; remaining: number } | null;
    return {
      authorized: false,
      reason: refused?.reason ?? 'insufficient_budget',
      remainingCredits: refused?.remaining ?? remainingCredits(outcome.ledger),
    };
  }
  return { authorized: true, alreadyReserved: false, remainingCredits: remainingCredits(outcome.ledger) };
}

/** Liquida con el coste real. Puede liberar si costó menos de lo reservado. */
export async function settleRunBudgetSpend(
  batchId: string,
  identity: RunBudgetIdentity,
  input: { readonly operationId: string; readonly credits: number; readonly maxCredits: number },
  clientOverride?: CheckpointStoreClient | null,
): Promise<void> {
  await mutateRunBudget(
    batchId,
    identity,
    input.maxCredits,
    (ledger) => settleOperation(ledger, { operationId: input.operationId, credits: input.credits }),
    clientOverride,
  );
}

/** Marca cobro sin confirmar. NO libera presupuesto. */
export async function markRunBudgetSpendIndeterminate(
  batchId: string,
  identity: RunBudgetIdentity,
  input: {
    readonly operationId: string;
    readonly observedCredits?: number | null;
    readonly maxCredits: number;
  },
  clientOverride?: CheckpointStoreClient | null,
): Promise<void> {
  await mutateRunBudget(
    batchId,
    identity,
    input.maxCredits,
    (ledger) =>
      markOperationIndeterminate(ledger, {
        operationId: input.operationId,
        observedCredits: input.observedCredits ?? null,
      }),
    clientOverride,
  );
}

/** Lectura sin efectos, para diagnóstico y métricas. */
export async function readRunBudgetLedger(
  batchId: string,
  identity: RunBudgetIdentity,
  fallbackMaxCredits: number,
  clientOverride?: CheckpointStoreClient | null,
): Promise<RunBudgetLedger | null> {
  const client = clientOverride ?? (tryGetAdminClientForTwoRound() as CheckpointStoreClient | null);
  if (!client) return null;
  const { data, error } = await client
    .from('prospect_batches')
    .select('metadata')
    .eq('id', batchId)
    .maybeSingle();
  if (error || !data) return null;
  const metadata =
    data.metadata !== null && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, unknown>)
      : {};
  return readStoredLedger(metadata, identity, fallbackMaxCredits);
}
