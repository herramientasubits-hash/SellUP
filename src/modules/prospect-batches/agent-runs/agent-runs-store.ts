/**
 * agent-runs-store.ts — las búsquedas del Agente IA que el usuario lanzó, FUERA
 * del chat (AGENT1-PARALLEL-RUNS-TRAY-1, fase 1).
 *
 * Antes la corrida vivía dentro del asistente: al cerrar el panel se desmontaba y
 * con él la promesa, el lote y el resultado. La corrida seguía en el servidor,
 * pero nadie la miraba. Aquí vive en un almacén del navegador que monta el shell
 * de la app, así que sobrevive al chat, y la bandeja flotante la pinta.
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

export type AgentRunsStore = {
  getSnapshot(): readonly AgentRun[];
  subscribe(listener: () => void): () => void;
  startRun(input: { title: string; concurrencyKey?: string; payload: AgentRunPayload }): Promise<WizardExecutionActionResult>;
  /** Cierra una corrida lanzada en otra carga de la página (la bandeja la consultó). */
  settleDetached(clientRequestId: string, outcome: { status: 'succeeded' | 'failed'; batchId?: string | null; message?: string | null }): void;
  dismiss(clientRequestId: string): void;
  dismissFinished(): void;
};

function isFinished(run: AgentRun): boolean {
  return run.status === 'succeeded' || run.status === 'failed';
}

function summarize(
  result: WizardExecutionActionResult,
): Pick<AgentRun, 'status' | 'batchId' | 'redirectPath' | 'candidateCount' | 'message' | 'continuationPending'> {
  if (result.ok) {
    return {
      status: 'succeeded',
      continuationPending: result.apolloContinuation !== undefined,
      batchId: result.batchId ?? null,
      redirectPath: result.redirectPath ?? null,
      candidateCount: typeof result.candidateCount === 'number' ? result.candidateCount : null,
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
    if (run.status === 'running') return { ...run, detached: true };
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
          update(next.clientRequestId, {
            status: 'failed',
            finishedAtMs: now(),
            message: 'No fue posible completar la búsqueda.',
          });
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
    dismiss(clientRequestId) {
      const run = runs.find((r) => r.clientRequestId === clientRequestId);
      if (!run || !isFinished(run)) return;
      runs = runs.filter((r) => r.clientRequestId !== clientRequestId);
      emit();
    },
    dismissFinished() {
      runs = runs.filter((run) => !isFinished(run));
      emit();
    },
  };
}
