import type { WizardExecutionActionResult } from '../chat-wizard-execution/wizard-execution-types';
import {
  applySucceededRound,
  classifyRoundFailure,
  decideBulkNextStep,
  BULK_RETRY_AFTER_MS,
} from './bulk-search-decision';
import { confirmedCapCoversEstimate, estimateBulkSearch, type BulkSearchEstimate } from './bulk-search-estimate';
import { bulkSearchCreateSchema, validateBulkCriteria, type BulkSearchControlAction } from './bulk-search-schema';
import {
  BULK_TARGET_OPTIONS,
  isBulkTargetCount,
  type BulkRoundWorstCase,
  type BulkSearchProgress,
  type BulkSearchStatus,
  type BulkStopReason,
  type BulkTargetCount,
} from './bulk-search-types';
import { currentRoundRequestIdOf,
  readPerRoundPaidCredits,
  toBulkSearchView,
  toCreditCapBreakdown,
  type BulkSearchRoundRow,
  type BulkSearchRow,
  type BulkSearchView,
} from './bulk-search-view';

/**
 * El motor de la búsqueda masiva (GROWTH-BULK-SEARCH-1 · PR 2). Puro: todo lo
 * que toca base de datos, sesión o proveedores llega como dependencia, y lo
 * cablea `bulk-search-service.server.ts`.
 *
 * Una ronda es UNA corrida normal del asistente (`runWizard`), con todos sus
 * topes. Aquí sólo se decide si lanzarla, se anota y se recuenta. Los números
 * de avance y de gasto se recalculan SIEMPRE desde los lotes de las rondas, no
 * se suman: una ronda que murió a mitad de camino no deja la cuenta torcida.
 */

/** Lo que dura el lease de una ronda: su corrida (300 s) y un margen para anotar. */
export const BULK_ROUND_LEASE_SECONDS = 330;
/** Cuánto esperar cuando otra pestaña ya la está conduciendo. */
export const BULK_BUSY_RETRY_MS = 15_000;

/** Lo que cada proveedor tiene disponible en su cupo del mes. `null` = sin límite configurado. */
export interface BulkBudgetAvailability {
  apollo: number | null;
  tavily: number | null;
  /** Lusha se paga del pool mensual del asistente. */
  lusha: number | null;
}

export interface BulkSearchInsert {
  createdBy: string;
  targetCount: BulkTargetCount;
  request: Record<string, unknown>;
  creditCap: number;
  creditCapBreakdown: Record<string, number>;
  maxRounds: number;
}

/** Lo que se escribe de vuelta. `status` sólo se aplica si la fila sigue `running`. */
export interface BulkSearchPatch {
  deliveredCount: number;
  creditsUsed: number;
  roundsDone: number;
  consecutiveEmptyRounds: number;
  consecutiveFailedRounds: number;
  lastRoundAt?: string;
  terminal?: { status: BulkSearchStatus; stopReason: BulkStopReason | null };
}

export interface BulkSearchEngineDeps {
  now: () => number;
  newUuid: () => string;
  resolvePerRoundWorstCase: () => Promise<BulkRoundWorstCase>;
  readBudgetAvailability: () => Promise<BulkBudgetAvailability>;
  findLiveSearch: (userId: string) => Promise<BulkSearchRow | null>;
  insertSearch: (row: BulkSearchInsert) => Promise<BulkSearchRow>;
  loadSearch: (bulkSearchId: string, userId: string) => Promise<BulkSearchRow | null>;
  /** El reclamo con lease de la migración 159. `null` = no se pudo (otra pestaña, o no está en curso). */
  claimSearch: (bulkSearchId: string, userId: string, leaseSeconds: number) => Promise<{ leaseToken: string } | null>;
  listRounds: (bulkSearchId: string) => Promise<BulkSearchRoundRow[]>;
  insertRound: (row: { bulkSearchId: string; roundIndex: number; clientRequestId: string }) => Promise<void>;
  finishRound: (
    clientRequestId: string,
    patch: { status: 'succeeded' | 'failed' | 'skipped'; batchId: string | null; deliveredNew: number; creditsUsed: number; outcomeCode: string | null },
  ) => Promise<void>;
  /** El lote de una corrida por su identidad (la ronda murió antes de anotarlo). */
  findBatchByClientRequestId: (userId: string, clientRequestId: string) => Promise<string | null>;
  /** Candidatas revisables (ni duplicadas ni descartadas) de esos lotes. */
  countDelivered: (batchIds: string[]) => Promise<number>;
  /** Créditos pagos (Apollo + Lusha) que registraron esos lotes. */
  sumPaidCredits: (batchIds: string[]) => Promise<number>;
  hasPendingContinuation: (batchId: string) => Promise<boolean>;
  /** La corrida NORMAL del asistente, tal cual (`executeProspectWizardGenerationAction`). */
  runWizard: (request: Record<string, unknown>) => Promise<WizardExecutionActionResult>;
  /** Escribe con el token del lease; el cambio de estado sólo si sigue `running`. */
  writeProgress: (bulkSearchId: string, leaseToken: string, patch: BulkSearchPatch) => Promise<void>;
  releaseLease: (bulkSearchId: string, leaseToken: string) => Promise<void>;
  applyControl: (
    bulkSearchId: string,
    userId: string,
    from: readonly BulkSearchStatus[],
    to: { status: BulkSearchStatus; stopReason: BulkStopReason | null; terminal: boolean },
  ) => Promise<BulkSearchRow | null>;
  listSearches: (userId: string) => Promise<BulkSearchRow[]>;
}

// ── Superficie: lo que la pantalla ofrece antes de arrancar ───────────────────

export interface BulkSearchOption {
  targetCount: BulkTargetCount;
  estimate: BulkSearchEstimate;
  allowed: boolean;
  blockedReason: string | null;
}

export function budgetBlockReason(estimate: BulkSearchEstimate, budget: BulkBudgetAvailability): string | null {
  const over = (need: number, available: number | null) => available !== null && need > available;
  if (over(estimate.breakdown.apollo, budget.apollo)) return 'No alcanza el cupo de la fuente principal de este mes.';
  if (over(estimate.breakdown.lusha, budget.lusha)) return 'No alcanza el presupuesto de búsquedas de este mes.';
  if (over(estimate.breakdown.tavily, budget.tavily)) return 'No alcanza el cupo de búsqueda web de este mes.';
  return null;
}

export async function resolveBulkSearchOptions(deps: Pick<BulkSearchEngineDeps, 'resolvePerRoundWorstCase' | 'readBudgetAvailability'>): Promise<BulkSearchOption[]> {
  const [perRound, budget] = await Promise.all([deps.resolvePerRoundWorstCase(), deps.readBudgetAvailability()]);
  return BULK_TARGET_OPTIONS.map((targetCount) => {
    const estimate = estimateBulkSearch(targetCount, perRound);
    const blockedReason = budgetBlockReason(estimate, budget);
    return { targetCount, estimate, allowed: blockedReason === null, blockedReason };
  });
}

// ── Crear ─────────────────────────────────────────────────────────────────────

export type BulkSearchCreateResult =
  | { ok: true; search: BulkSearchView }
  | { ok: false; code: 'INVALID_REQUEST'; message: string }
  | { ok: false; code: 'BULK_SEARCH_ALREADY_LIVE'; message: string; search: BulkSearchView }
  | { ok: false; code: 'ESTIMATE_CHANGED'; message: string; estimate: BulkSearchEstimate }
  | { ok: false; code: 'BULK_CAP_EXCEEDS_MONTHLY_BUDGET'; message: string };

export async function createBulkSearch(
  deps: BulkSearchEngineDeps,
  userId: string,
  body: unknown,
): Promise<BulkSearchCreateResult> {
  const parsed = bulkSearchCreateSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_REQUEST', message: parsed.error.issues[0]?.message ?? 'Petición inválida.' };
  }
  const input = parsed.data;
  if (!isBulkTargetCount(input.targetCount)) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'Elige 25, 50, 100 o 200.' };
  }
  const criteria = validateBulkCriteria(input.criteria, input.clientRequestId);
  if (!criteria.ok) return { ok: false, code: 'INVALID_REQUEST', message: criteria.message };

  // Una sola viva por persona (también lo impone el índice de la 159): un doble
  // clic devuelve la que ya existe en vez de crear otra.
  const live = await deps.findLiveSearch(userId);
  if (live) {
    return {
      ok: false,
      code: 'BULK_SEARCH_ALREADY_LIVE',
      message: 'Ya tienes una búsqueda masiva en curso. Termínala o cancélala para lanzar otra.',
      search: toBulkSearchView(live, [], deps.now()),
    };
  }

  // El tope lo calcula el SERVIDOR. Si el que confirmó Growth no lo cubre (cambió
  // un precio, se encendió Lusha), hay que volver a confirmar con el número nuevo.
  const [perRound, budget] = await Promise.all([deps.resolvePerRoundWorstCase(), deps.readBudgetAvailability()]);
  const estimate = estimateBulkSearch(input.targetCount, perRound);
  if (!confirmedCapCoversEstimate(input.confirmedCreditCap, estimate)) {
    return {
      ok: false,
      code: 'ESTIMATE_CHANGED',
      message: `El tope cambió a ${estimate.creditCap} créditos. Revísalo y confírmalo otra vez.`,
      estimate,
    };
  }
  const blocked = budgetBlockReason(estimate, budget);
  if (blocked) return { ok: false, code: 'BULK_CAP_EXCEEDS_MONTHLY_BUDGET', message: blocked };

  const row = await deps.insertSearch({
    createdBy: userId,
    targetCount: input.targetCount,
    request: { ...criteria.criteria, label: input.label, creationRequestId: input.clientRequestId },
    creditCap: estimate.creditCap,
    creditCapBreakdown: toCreditCapBreakdown(estimate),
    maxRounds: estimate.maxRounds,
  });
  return { ok: true, search: toBulkSearchView(row, [], deps.now()) };
}

// ── Avance: recontado desde las rondas ────────────────────────────────────────

/** Contadores de racha a partir de la lista de rondas (las saltadas no cuentan). */
export function streaksFromRounds(rounds: readonly BulkSearchRoundRow[]): {
  roundsDone: number;
  consecutiveEmptyRounds: number;
  consecutiveFailedRounds: number;
} {
  const counted = [...rounds]
    .filter((round) => round.status === 'succeeded' || round.status === 'failed')
    .sort((a, b) => a.round_index - b.round_index);
  let consecutiveEmptyRounds = 0;
  let consecutiveFailedRounds = 0;
  for (const round of counted) {
    if (round.status === 'failed') {
      consecutiveFailedRounds += 1;
      continue;
    }
    const next = applySucceededRound({ roundsDone: 0, consecutiveEmptyRounds }, round.delivered_new);
    consecutiveEmptyRounds = next.consecutiveEmptyRounds;
    consecutiveFailedRounds = 0;
  }
  return { roundsDone: counted.length, consecutiveEmptyRounds, consecutiveFailedRounds };
}

function batchIdsOf(rounds: readonly BulkSearchRoundRow[]): string[] {
  return [...new Set(rounds.map((round) => round.batch_id).filter((id): id is string => Boolean(id)))];
}

async function recount(
  deps: BulkSearchEngineDeps,
  rounds: readonly BulkSearchRoundRow[],
): Promise<Pick<BulkSearchPatch, 'deliveredCount' | 'creditsUsed' | 'roundsDone' | 'consecutiveEmptyRounds' | 'consecutiveFailedRounds'>> {
  const batchIds = batchIdsOf(rounds);
  const [deliveredCount, creditsUsed] = batchIds.length
    ? await Promise.all([deps.countDelivered(batchIds), deps.sumPaidCredits(batchIds)])
    : [0, 0];
  return { deliveredCount, creditsUsed, ...streaksFromRounds(rounds) };
}

function progressOf(row: BulkSearchRow, counts: Awaited<ReturnType<typeof recount>>): BulkSearchProgress {
  return {
    status: row.status,
    targetCount: row.target_count as BulkTargetCount,
    deliveredCount: counts.deliveredCount,
    roundsDone: counts.roundsDone,
    maxRounds: row.max_rounds,
    creditCap: Number(row.credit_cap),
    creditsUsed: counts.creditsUsed,
    consecutiveEmptyRounds: counts.consecutiveEmptyRounds,
    consecutiveFailedRounds: counts.consecutiveFailedRounds,
  };
}

// ── Ronda ─────────────────────────────────────────────────────────────────────

export type BulkRoundResponse =
  | { ok: false; code: 'NOT_FOUND' }
  | {
      ok: true;
      /** `continue`: pide la siguiente ya · `wait`: vuelve a pedir en `retryAfterMs` · `done`: no hay más que hacer. */
      next: 'continue' | 'wait' | 'done';
      retryAfterMs: number;
      search: BulkSearchView;
      round?: { index: number; outcome: 'succeeded' | 'failed' | 'skipped'; deliveredNew: number };
    };

async function snapshot(deps: BulkSearchEngineDeps, bulkSearchId: string, userId: string): Promise<BulkSearchView | null> {
  const row = await deps.loadSearch(bulkSearchId, userId);
  if (!row) return null;
  const rounds = await deps.listRounds(bulkSearchId);
  return toBulkSearchView(row, batchIdsOf(rounds), deps.now(), currentRoundRequestIdOf(rounds));
}

export async function runBulkSearchRound(
  deps: BulkSearchEngineDeps,
  bulkSearchId: string,
  userId: string,
): Promise<BulkRoundResponse> {
  const claim = await deps.claimSearch(bulkSearchId, userId, BULK_ROUND_LEASE_SECONDS);
  if (!claim) {
    // O no está en curso (pausada, terminada) o la conduce otra pestaña.
    const view = await snapshot(deps, bulkSearchId, userId);
    if (!view) return { ok: false, code: 'NOT_FOUND' };
    if (view.status === 'running') return { ok: true, next: 'wait', retryAfterMs: BULK_BUSY_RETRY_MS, search: view };
    return { ok: true, next: 'done', retryAfterMs: 0, search: view };
  }
  const { leaseToken } = claim;

  try {
    const row = await deps.loadSearch(bulkSearchId, userId);
    if (!row) return { ok: false, code: 'NOT_FOUND' };

    // Una ronda que quedó `running` con el lease libre murió con su función: se
    // cierra con lo que haya dejado su lote.
    let rounds = await deps.listRounds(bulkSearchId);
    for (const orphan of rounds.filter((round) => round.status === 'running')) {
      const batchId = orphan.batch_id ?? (await deps.findBatchByClientRequestId(userId, orphan.client_request_id));
      const deliveredNew = batchId ? await deps.countDelivered([batchId]) : 0;
      const creditsUsed = batchId ? await deps.sumPaidCredits([batchId]) : 0;
      await deps.finishRound(orphan.client_request_id, {
        status: batchId ? 'succeeded' : 'failed',
        batchId,
        deliveredNew,
        creditsUsed,
        outcomeCode: 'orphan_reconciled',
      });
    }
    rounds = await deps.listRounds(bulkSearchId);

    const before = await recount(deps, rounds);
    const perRoundPaidCredits = readPerRoundPaidCredits(row);
    const lastBatchId = [...rounds].sort((a, b) => b.round_index - a.round_index).find((round) => round.batch_id)?.batch_id;
    const step = decideBulkNextStep(progressOf(row, before), {
      perRoundPaidCredits,
      continuationPending: lastBatchId ? await deps.hasPendingContinuation(lastBatchId) : false,
    });

    if (step.kind === 'stop') {
      await deps.writeProgress(bulkSearchId, leaseToken, {
        ...before,
        terminal: step.status === 'running' ? undefined : { status: step.status, stopReason: step.reason },
      });
      return { ok: true, next: 'done', retryAfterMs: 0, search: (await snapshot(deps, bulkSearchId, userId))! };
    }
    if (step.kind === 'wait') {
      await deps.writeProgress(bulkSearchId, leaseToken, before);
      return { ok: true, next: 'wait', retryAfterMs: step.retryAfterMs, search: (await snapshot(deps, bulkSearchId, userId))! };
    }

    // ── Lanzar la ronda: una corrida normal, con los criterios que guardó el servidor.
    const roundIndex = rounds.reduce((max, round) => Math.max(max, round.round_index + 1), 0);
    const clientRequestId = deps.newUuid();
    await deps.insertRound({ bulkSearchId, roundIndex, clientRequestId });
    const { label: _label, creationRequestId: _creation, ...criteria } = (row.request ?? {}) as Record<string, unknown>;
    void _label;
    void _creation;

    let outcome: 'succeeded' | 'failed' | 'skipped';
    let terminal: BulkSearchPatch['terminal'];
    let retryAfterMs = 0;
    let deliveredNew = 0;
    let result: WizardExecutionActionResult | null = null;
    try {
      result = await deps.runWizard({ ...criteria, clientRequestId });
    } catch {
      result = null;
    }

    const batchId =
      result && result.ok ? result.batchId : await deps.findBatchByClientRequestId(userId, clientRequestId).catch(() => null);
    const roundCredits = batchId ? await deps.sumPaidCredits([batchId]) : 0;
    if (result && result.ok) {
      outcome = 'succeeded';
      deliveredNew = batchId ? await deps.countDelivered([batchId]) : 0;
    } else {
      const effect = result && !result.ok ? classifyRoundFailure(result.code) : ({ kind: 'retry' } as const);
      if (effect.kind === 'skip') {
        outcome = 'skipped';
        retryAfterMs = effect.retryAfterMs;
      } else {
        outcome = 'failed';
        retryAfterMs = BULK_RETRY_AFTER_MS;
        if (effect.kind === 'stop') terminal = { status: effect.status, stopReason: effect.reason };
      }
    }
    await deps.finishRound(clientRequestId, {
      status: outcome,
      batchId,
      deliveredNew,
      creditsUsed: roundCredits,
      outcomeCode: result ? (result.ok ? result.status : result.code) : 'ROUND_THREW',
    });

    // Recontar y decidir si con esto ya terminó (llegó a N, se agotó, se acabó el tope).
    const after = await recount(deps, await deps.listRounds(bulkSearchId));
    if (!terminal) {
      const nextStep = decideBulkNextStep(progressOf(row, after), { perRoundPaidCredits, continuationPending: false });
      if (nextStep.kind === 'stop' && nextStep.status !== 'running') {
        terminal = { status: nextStep.status, stopReason: nextStep.reason };
      }
    }
    await deps.writeProgress(bulkSearchId, leaseToken, {
      ...after,
      lastRoundAt: new Date(deps.now()).toISOString(),
      terminal,
    });
    const view = (await snapshot(deps, bulkSearchId, userId))!;
    return {
      ok: true,
      next: view.status === 'running' ? (retryAfterMs > 0 ? 'wait' : 'continue') : 'done',
      retryAfterMs,
      search: view,
      round: { index: roundIndex, outcome, deliveredNew },
    };
  } finally {
    await deps.releaseLease(bulkSearchId, leaseToken).catch(() => undefined);
  }
}

// ── Pausar · continuar · cancelar ─────────────────────────────────────────────

export type BulkControlResult = { ok: true; search: BulkSearchView } | { ok: false; code: 'NOT_FOUND' | 'INVALID_TRANSITION' };

const CONTROL: Record<
  BulkSearchControlAction,
  { from: readonly BulkSearchStatus[]; to: { status: BulkSearchStatus; stopReason: BulkStopReason | null; terminal: boolean } }
> = {
  pause: { from: ['running'], to: { status: 'paused', stopReason: 'paused_by_user', terminal: false } },
  resume: { from: ['paused'], to: { status: 'running', stopReason: null, terminal: false } },
  // Cancelar deja terminar la ronda en vuelo: lo que encuentre se queda.
  cancel: { from: ['running', 'paused'], to: { status: 'cancelled', stopReason: 'cancelled_by_user', terminal: true } },
};

export async function controlBulkSearch(
  deps: BulkSearchEngineDeps,
  bulkSearchId: string,
  userId: string,
  action: BulkSearchControlAction,
): Promise<BulkControlResult> {
  const transition = CONTROL[action];
  const row = await deps.applyControl(bulkSearchId, userId, transition.from, transition.to);
  if (row) {
    const rounds = await deps.listRounds(bulkSearchId);
    return { ok: true, search: toBulkSearchView(row, batchIdsOf(rounds), deps.now(), currentRoundRequestIdOf(rounds)) };
  }
  const existing = await deps.loadSearch(bulkSearchId, userId);
  return { ok: false, code: existing ? 'INVALID_TRANSITION' : 'NOT_FOUND' };
}

export async function listBulkSearches(deps: BulkSearchEngineDeps, userId: string): Promise<BulkSearchView[]> {
  const rows = await deps.listSearches(userId);
  return Promise.all(
    rows.map(async (row) => {
      const rounds = await deps.listRounds(row.id);
      return toBulkSearchView(row, batchIdsOf(rounds), deps.now(), currentRoundRequestIdOf(rounds));
    }),
  );
}
