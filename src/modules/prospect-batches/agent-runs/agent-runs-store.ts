/**
 * agent-runs-store.ts — las búsquedas del Agente IA que el usuario lanzó, FUERA
 * del chat (AGENT1-PARALLEL-RUNS-TRAY-1, fase 1).
 *
 * Antes la corrida vivía dentro del asistente: al cerrar el panel se desmontaba y
 * con él la promesa, el lote y el resultado. La corrida seguía en el servidor,
 * pero nadie la miraba. Aquí vive en un almacén del navegador que monta el shell
 * de la app, así que sobrevive al chat, y el Centro de procesos de la cabecera la pinta.
 *
 * Fase 2 (AGENT1-PARALLEL-RUNS-PHASE2-1): hasta `AGENT_RUNS_MAX_CONCURRENT` a la
 * vez. Apollo y Tavily no reservan del pool del piloto (cuota del proveedor), así
 * que la base no las limita; Lusha sí, con `max_active_executions_per_user`
 * (migración 144). Dos corridas del MISMO país × industria nunca corren juntas:
 * pelearían por las mismas empresas. Las demás quedan EN ESPERA y arrancan solas.
 *
 * Puro respecto al framework: sin React, sin fetch propio, sin reloj global. La
 * ejecución y el almacenamiento se inyectan (pruebas sin red).
 */

import type { WizardExecutionActionResult } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type AgentRun = {
  clientRequestId: string;
  /** «México · Retail». */
  title: string;
  /**
   * Corridas con la misma clave no corren juntas (país × industria). Ausente en
   * filas guardadas antes de la fase 2: se usa el título.
   */
  concurrencyKey?: string;
  status: AgentRunStatus;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  batchId: string | null;
  redirectPath: string | null;
  candidateCount: number | null;
  /** De esas empresas, cuántas esperan la revisión de tamaño (sólo Competidores). */
  sizePendingCount?: number | null;
  /** Texto corto para la bandeja cuando falla o termina sin empresas nuevas. */
  message: string | null;
  /** La corrida terminó EN PAUSA con trabajo de Apollo encolado (lo declara el servidor). */
  continuationPending?: boolean;
  /**
   * La corrida se lanzó en una carga ANTERIOR de la página: su respuesta ya no
   * llega aquí y su estado se sigue consultando por su identificador.
   */
  detached: boolean;
};

export type AgentRunPayload = Record<string, unknown> & { clientRequestId: string };

export type AgentRunsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type AgentRunsStoreDeps = {
  execute: (payload: AgentRunPayload) => Promise<WizardExecutionActionResult>;
  storage?: AgentRunsStorage | null;
  nowMs?: () => number;
};

/** Cuántas corridas a la vez desde este navegador. */
export const AGENT_RUNS_MAX_CONCURRENT = 3;
/** Cuántas filas recuerda la bandeja. */
export const AGENT_RUNS_MAX_KEPT = 12;
export const AGENT_RUNS_STORAGE_KEY = 'sellup:agent-runs:v1';

const NOT_STARTED_AFTER_RELOAD =
  'No llegó a iniciarse porque la página se recargó. Vuelve a lanzarla desde el Agente IA.';

/**
 * AGENT1-AUDIT-WS2 § 8 — una corrida desligada (lanzada en otra carga de la página)
 * que lleva más de esto sin cerrarse ya no está corriendo: una invocación vive como
 * mucho 300 s. Antes se quedaba «En curso» para siempre —si su lote quedó en
 * `draft`/`generating`, o nunca nació— y ocupaba uno de los tres lugares.
 */
export const DETACHED_RUN_STALE_AFTER_MS = 10 * 60 * 1000;

export const DETACHED_RUN_STALE_MESSAGE =
  'Esta búsqueda dejó de dar noticias. Revisa el lote por si dejó empresas, o vuelve a lanzarla.';

/** AGENT1-AUDIT-WS2 § 5 — la pausa de Apollo no se pudo dejar en cola. */
export const CONTINUATION_NOT_QUEUED_MESSAGE =
  'Apollo no alcanzó a revisar todas las empresas y no se pudo dejar en cola para terminar. Revisa el lote: lo encontrado sí quedó guardado.';

/** ¿La corrida desligada ya lleva demasiado sin cerrarse? Puro. */
export function isDetachedRunStale(run: AgentRun, nowMs: number): boolean {
  if (run.status !== 'running' || !run.detached) return false;
  const since = run.startedAtMs ?? run.createdAtMs;
  return Number.isFinite(since) && nowMs - since > DETACHED_RUN_STALE_AFTER_MS;
}

export type AgentRunsStore = {
  getSnapshot(): readonly AgentRun[];
  subscribe(listener: () => void): () => void;
  startRun(input: { title: string; concurrencyKey?: string; payload: AgentRunPayload }): Promise<WizardExecutionActionResult>;
  /**
   * AGENT1-CORPORATE-TREE-1 — la respuesta no llegó (red, proxy) pero el servidor SÍ
   * terminó: quien la siguió por su id la cierra con lo que encontró. Sólo corridas
   * ya salidas del navegador (en curso o falladas), nunca en espera.
   */
  reconcile(clientRequestId: string, outcome: { status: 'succeeded' | 'failed'; batchId?: string | null; candidateCount?: number | null; message?: string | null }): void;
  /** Cierra una corrida lanzada en otra carga de la página (la bandeja la consultó). */
  settleDetached(clientRequestId: string, outcome: { status: 'succeeded' | 'failed'; batchId?: string | null; message?: string | null }): void;
  /**
   * AGENT1-AUDIT-WS2 § 8 — cierra como fallidas las corridas desligadas que ya no
   * pueden estar corriendo (`isDetachedRunStale`). La bandeja lo llama en cada
   * sondeo; también corre al restaurar.
   */
  expireStaleDetached(): void;
  /** Quita una fila terminada, o una desligada (la persona deja de seguirla). */
  dismiss(clientRequestId: string): void;
  dismissFinished(): void;
};

function isFinished(run: AgentRun): boolean {
  return run.status === 'succeeded' || run.status === 'failed';
}

function summarize(
  result: WizardExecutionActionResult,
): Pick<
  AgentRun,
  'status' | 'batchId' | 'redirectPath' | 'candidateCount' | 'sizePendingCount' | 'message' | 'continuationPending'
> {
  if (result.ok && result.apolloContinuationFailure !== undefined) {
    // AGENT1-AUDIT-WS2 § 5 — la pausa no quedó en cola: nadie la retomará. Pide
    // atención (con enlace al lote, que sí tiene lo encontrado), no «en pausa».
    return {
      status: 'failed',
      continuationPending: false,
      batchId: result.batchId ?? null,
      redirectPath: result.redirectPath ?? null,
      candidateCount: typeof result.candidateCount === 'number' ? result.candidateCount : null,
      message: CONTINUATION_NOT_QUEUED_MESSAGE,
    };
  }
  if (result.ok) {
    return {
      status: 'succeeded',
      // AGENT1-AUDIT-WS2 § 5 — «en pausa» sólo con la continuación DE VERDAD en cola.
      continuationPending: result.apolloContinuation?.enqueued === true,
      batchId: result.batchId ?? null,
      redirectPath: result.redirectPath ?? null,
      // AGENT1-AUDIT-WS2 § F — «Terminada: N empresas» cuenta lo REVISABLE cuando
      // el servidor lo pudo medir (sin duplicadas ni descartadas).
      candidateCount:
        typeof result.reviewableCandidateCount === 'number'
          ? result.reviewableCandidateCount
          : typeof result.candidateCount === 'number'
            ? result.candidateCount
            : null,
      sizePendingCount:
        typeof result.competitorSizePendingCount === 'number' ? result.competitorSizePendingCount : null,
      message: null,
    };
  }
  const contribution = result.freeContribution;
  return {
    status: 'failed',
    batchId: contribution?.batchId ?? null,
    redirectPath: contribution?.redirectPath ?? null,
    candidateCount: contribution?.persistedCandidates ?? null,
    message: result.message ?? 'No fue posible completar la búsqueda.',
  };
}

function readStored(storage: AgentRunsStorage | null | undefined): AgentRun[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(AGENT_RUNS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AgentRun =>
        typeof item === 'object' && item !== null && typeof (item as AgentRun).clientRequestId === 'string' && typeof (item as AgentRun).title === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Al recargar la página: lo que estaba EN CURSO sigue en el servidor y se vuelve
 * a mirar por su id (detached); lo que estaba EN ESPERA nunca salió del navegador,
 * así que se dice tal cual en vez de fingir que corre.
 */
export function restoreAgentRuns(stored: readonly AgentRun[], nowMs: number): AgentRun[] {
  return stored.map((run) => {
    if (run.status === 'running') {
      const detached: AgentRun = { ...run, detached: true };
      // AGENT1-AUDIT-WS2 § 8 — lanzada hace más de lo que puede vivir: no sigue en curso.
      return isDetachedRunStale(detached, nowMs)
        ? { ...detached, status: 'failed', finishedAtMs: nowMs, detached: false, message: DETACHED_RUN_STALE_MESSAGE }
        : detached;
    }
    if (run.status === 'queued') {
      return { ...run, status: 'failed', finishedAtMs: nowMs, message: NOT_STARTED_AFTER_RELOAD, detached: false };
    }
    return run;
  });
}

export function createAgentRunsStore(deps: AgentRunsStoreDeps): AgentRunsStore {
  const now = deps.nowMs ?? Date.now;
  let runs: readonly AgentRun[] = restoreAgentRuns(readStored(deps.storage), now());
  const listeners = new Set<() => void>();
  const pending = new Map<string, { payload: AgentRunPayload; resolve: (r: WizardExecutionActionResult) => void; reject: (e: unknown) => void }>();
  const inFlight = new Map<string, Promise<WizardExecutionActionResult>>();

  const persist = () => {
    try {
      deps.storage?.setItem(AGENT_RUNS_STORAGE_KEY, JSON.stringify(runs));
    } catch {
      // Sin almacenamiento (ventana privada): la bandeja sigue funcionando en memoria.
    }
  };
  const emit = () => {
    persist();
    for (const listener of listeners) listener();
  };
  const update = (clientRequestId: string, patch: Partial<AgentRun>) => {
    runs = runs.map((run) => (run.clientRequestId === clientRequestId ? { ...run, ...patch } : run));
    emit();
  };
  const trim = (list: readonly AgentRun[]) => {
    if (list.length <= AGENT_RUNS_MAX_KEPT) return list;
    const active = list.filter((run) => !isFinished(run));
    const finished = list.filter(isFinished).slice(0, Math.max(0, AGENT_RUNS_MAX_KEPT - active.length));
    const keep = new Set([...active, ...finished].map((run) => run.clientRequestId));
    return list.filter((run) => keep.has(run.clientRequestId));
  };

  const runningCount = () => runs.filter((run) => run.status === 'running').length;
  const keyOf = (run: AgentRun) => run.concurrencyKey ?? run.title;

  const pump = () => {
    while (runningCount() < AGENT_RUNS_MAX_CONCURRENT) {
      // La más antigua en espera cuya clave no esté corriendo ya.
      const busy = new Set(runs.filter((run) => run.status === 'running').map(keyOf));
      const next = [...runs].reverse().find((run) => run.status === 'queued' && !busy.has(keyOf(run)));
      if (!next) return;
      const job = pending.get(next.clientRequestId);
      if (!job) {
        update(next.clientRequestId, { status: 'failed', finishedAtMs: now(), message: NOT_STARTED_AFTER_RELOAD });
        continue;
      }
      pending.delete(next.clientRequestId);
      update(next.clientRequestId, { status: 'running', startedAtMs: now() });
      deps
        .execute(job.payload)
        .then((result) => {
          update(next.clientRequestId, { ...summarize(result), finishedAtMs: now() });
          job.resolve(result);
        })
        .catch((error: unknown) => {
          // AGENT1-CORPORATE-TREE-1 — la búsqueda en árbol se sigue por su id cuando
          // la respuesta no llega (su lote se reconoce por `client_request_id`): queda
          // en curso, desligada, hasta que quien la lanzó o la bandeja la cierren.
          if (job.payload.searchMode === 'corporate_tree') {
            update(next.clientRequestId, { detached: true });
          } else {
            update(next.clientRequestId, {
              status: 'failed',
              finishedAtMs: now(),
              message: 'No fue posible completar la búsqueda.',
            });
          }
          job.reject(error);
        })
        .finally(() => {
          inFlight.delete(next.clientRequestId);
          pump();
        });
    }
  };

  return {
    getSnapshot: () => runs,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startRun({ title, concurrencyKey, payload }) {
      const id = payload.clientRequestId;
      // El mismo id dos veces (doble clic) = la misma corrida.
      const existing = inFlight.get(id);
      if (existing) return existing;
      const promise = new Promise<WizardExecutionActionResult>((resolve, reject) => {
        pending.set(id, { payload, resolve, reject });
      });
      inFlight.set(id, promise);
      const run: AgentRun = {
        clientRequestId: id,
        title,
        ...(concurrencyKey ? { concurrencyKey } : {}),
        status: 'queued',
        createdAtMs: now(),
        startedAtMs: null,
        finishedAtMs: null,
        batchId: null,
        redirectPath: null,
        candidateCount: null,
        message: null,
        detached: false,
      };
      runs = trim([run, ...runs.filter((r) => r.clientRequestId !== id)]);
      emit();
      pump();
      return promise;
    },
    reconcile(clientRequestId, outcome) {
      const run = runs.find((r) => r.clientRequestId === clientRequestId);
      if (!run || run.status === 'queued') return;
      update(clientRequestId, {
        status: outcome.status,
        finishedAtMs: now(),
        detached: false,
        batchId: outcome.batchId ?? run.batchId,
        redirectPath: outcome.batchId ? `/prospect-batches/${outcome.batchId}` : run.redirectPath,
        candidateCount: outcome.candidateCount ?? run.candidateCount,
        message: outcome.message ?? null,
      });
    },
    settleDetached(clientRequestId, outcome) {
      const run = runs.find((r) => r.clientRequestId === clientRequestId);
      if (!run || !run.detached || isFinished(run)) return;
      update(clientRequestId, {
        status: outcome.status,
        finishedAtMs: now(),
        detached: false,
        batchId: outcome.batchId ?? run.batchId,
        redirectPath: outcome.batchId ? `/prospect-batches/${outcome.batchId}` : run.redirectPath,
        message: outcome.message ?? null,
      });
    },
    expireStaleDetached() {
      const nowMs = now();
      const stale = runs.filter((run) => isDetachedRunStale(run, nowMs));
      if (stale.length === 0) return;
      const ids = new Set(stale.map((run) => run.clientRequestId));
      runs = runs.map((run) =>
        ids.has(run.clientRequestId)
          ? { ...run, status: 'failed', finishedAtMs: nowMs, detached: false, message: DETACHED_RUN_STALE_MESSAGE }
          : run,
      );
      emit();
      // Se liberó lugar: lo que esperaba puede arrancar.
      pump();
    },
    dismiss(clientRequestId) {
      const run = runs.find((r) => r.clientRequestId === clientRequestId);
      // AGENT1-AUDIT-WS2 § 8 — también una desligada: su respuesta ya no llega a
      // esta página, y sin esto una fila trabada no se podía quitar nunca.
      if (!run || !(isFinished(run) || (run.status === 'running' && run.detached))) return;
      runs = runs.filter((r) => r.clientRequestId !== clientRequestId);
      emit();
      pump();
    },
    dismissFinished() {
      runs = runs.filter((run) => !isFinished(run));
      emit();
    },
  };
}
