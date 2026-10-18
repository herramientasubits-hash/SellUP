/**
 * Las preparaciones del Agente 3 en curso (puro, sin React ni red): viven fuera del
 * panel para poder minimizarlo o cerrarlo y seguirlas en el Centro de procesos, como
 * las búsquedas del Agente 1 (dueña 18-10). Se guardan en el navegador: al recargar,
 * lo que estaba en curso sigue en el servidor y se vuelve a mirar («desligada»).
 */

export type FirstContactRunStatus = 'running' | 'succeeded' | 'failed';

export interface FirstContactRun {
  id: string;
  accountId: string;
  accountName: string;
  /** Lo que se pidió, en una línea («Emily Cerdas · Llamada, Correo»). */
  title: string;
  /** Cuántas preparaciones se pidieron (para saber cuándo terminó una desligada). */
  expected: number;
  status: FirstContactRunStatus;
  startedAtMs: number;
  finishedAtMs: number | null;
  packStatuses: string[];
  message: string | null;
  /** Lanzada en otra carga de la página: su respuesta ya no llega aquí. */
  detached: boolean;
}

export type FirstContactRunResponse =
  | { ok: true; packIds: string[]; packStatuses: string[]; reusedBrief: boolean }
  | { ok: false; code: string; message: string };

export interface FirstContactRunsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FirstContactRunsDeps {
  execute: (body: unknown) => Promise<FirstContactRunResponse>;
  storage?: FirstContactRunsStorage | null;
  nowMs?: () => number;
  /** Al terminar una corrida (el aviso «¡Primer contacto listo!» vive aquí, no en el panel). */
  onSettled?: (run: FirstContactRun) => void;
}

export const FIRST_CONTACT_RUNS_STORAGE_KEY = 'sellup:agent3-runs:v1';
const MAX_KEPT = 12;
/** Una invocación vive como mucho 300 s: desligada y sin cerrar después de esto, ya no corre. */
export const FIRST_CONTACT_DETACHED_STALE_MS = 6 * 60 * 1000;
const STALE_MESSAGE = 'No pudimos seguirla después de recargar la página. Revisa la pestaña «Primer contacto» de la empresa.';
const NETWORK_MESSAGE = 'No pudimos conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.';

export interface FirstContactRunsStore {
  getSnapshot(): readonly FirstContactRun[];
  subscribe(listener: () => void): () => void;
  /** Una por empresa a la vez: si ya hay una en curso, devuelve esa misma. */
  startRun(input: { id: string; accountId: string; accountName: string; title: string; expected: number; body: unknown }): Promise<FirstContactRunResponse>;
  isRunning(accountId: string): boolean;
  settleDetached(id: string, outcome: { status: 'succeeded' | 'failed'; packStatuses: string[]; message?: string | null }): void;
  expireStaleDetached(): void;
  dismiss(id: string): void;
  dismissFinished(): void;
}

function readStored(storage: FirstContactRunsStorage | null | undefined): FirstContactRun[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(FIRST_CONTACT_RUNS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FirstContactRun =>
        typeof item === 'object' && item !== null && typeof (item as FirstContactRun).id === 'string' && typeof (item as FirstContactRun).accountId === 'string',
    );
  } catch {
    return [];
  }
}

/** Al recargar: lo que estaba en curso queda desligado (o vencido, si ya no puede seguir). */
export function restoreFirstContactRuns(stored: readonly FirstContactRun[], nowMs: number): FirstContactRun[] {
  return stored.map((run) => {
    if (run.status !== 'running') return run;
    if (nowMs - run.startedAtMs > FIRST_CONTACT_DETACHED_STALE_MS) {
      return { ...run, status: 'failed', finishedAtMs: nowMs, detached: false, message: STALE_MESSAGE };
    }
    return { ...run, detached: true };
  });
}

export function createFirstContactRunsStore(deps: FirstContactRunsDeps): FirstContactRunsStore {
  const now = deps.nowMs ?? (() => Date.now());
  let runs: FirstContactRun[] = restoreFirstContactRuns(readStored(deps.storage), now());
  const listeners = new Set<() => void>();
  const inFlight = new Map<string, Promise<FirstContactRunResponse>>();

  const emit = () => {
    try {
      deps.storage?.setItem(FIRST_CONTACT_RUNS_STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_KEPT)));
    } catch {
      // Sin almacenamiento (modo privado): la bandeja vive sólo en esta carga de la página.
    }
    for (const listener of listeners) listener();
  };

  const update = (id: string, patch: Partial<FirstContactRun>) => {
    runs = runs.map((run) => (run.id === id ? { ...run, ...patch } : run));
    const settled = runs.find((run) => run.id === id);
    emit();
    if (settled && settled.status !== 'running') {
      try {
        deps.onSettled?.(settled);
      } catch {
        // El aviso es cosmético: un fallo al avisar no cambia cómo terminó la corrida.
      }
    }
  };

  return {
    getSnapshot: () => runs,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isRunning: (accountId) => runs.some((run) => run.accountId === accountId && run.status === 'running'),
    startRun({ id, accountId, accountName, title, expected, body }) {
      const existing = runs.find((run) => run.accountId === accountId && run.status === 'running' && !run.detached);
      if (existing && inFlight.has(existing.id)) return inFlight.get(existing.id)!;
      const run: FirstContactRun = {
        id,
        accountId,
        accountName,
        title,
        expected,
        status: 'running',
        startedAtMs: now(),
        finishedAtMs: null,
        packStatuses: [],
        message: null,
        detached: false,
      };
      runs = [run, ...runs.filter((r) => r.id !== id)].slice(0, MAX_KEPT);
      emit();
      const promise = deps
        .execute(body)
        .then((response) => {
          update(
            id,
            response.ok
              ? { status: 'succeeded', finishedAtMs: now(), packStatuses: response.packStatuses, message: null }
              : { status: 'failed', finishedAtMs: now(), message: response.message },
          );
          return response;
        })
        .catch((): FirstContactRunResponse => {
          update(id, { status: 'failed', finishedAtMs: now(), message: NETWORK_MESSAGE });
          return { ok: false, code: 'network', message: NETWORK_MESSAGE };
        })
        .finally(() => inFlight.delete(id));
      inFlight.set(id, promise);
      return promise;
    },
    settleDetached(id, outcome) {
      const run = runs.find((r) => r.id === id);
      if (!run || run.status !== 'running') return;
      update(id, { status: outcome.status, finishedAtMs: now(), packStatuses: outcome.packStatuses, message: outcome.message ?? null, detached: false });
    },
    expireStaleDetached() {
      const at = now();
      const stale = runs.filter((r) => r.status === 'running' && r.detached && at - r.startedAtMs > FIRST_CONTACT_DETACHED_STALE_MS);
      for (const run of stale) update(run.id, { status: 'failed', finishedAtMs: at, detached: false, message: STALE_MESSAGE });
    },
    dismiss(id) {
      const run = runs.find((r) => r.id === id);
      if (!run || (run.status === 'running' && !run.detached)) return;
      runs = runs.filter((r) => r.id !== id);
      emit();
    },
    dismissFinished() {
      runs = runs.filter((r) => r.status === 'running');
      emit();
    },
  };
}
