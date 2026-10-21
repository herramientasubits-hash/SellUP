/**
 * Las preparaciones del Agente 3 en curso (puro, sin React ni red): viven fuera del
 * panel para poder minimizarlo o cerrarlo y seguirlas en el Centro de procesos, como
 * las búsquedas del Agente 1 (dueña 18-10). Se guardan en el navegador: al recargar,
 * lo que estaba en curso sigue en el servidor y se vuelve a mirar («desligada»).
 * Además cada corrida queda en el servidor (`agent_runs`, mismo id): `hydrate` trae las
 * de otro equipo o pestaña y cierra las desligadas que el servidor ya terminó.
 */

import type { FirstContactServerRun } from './first-contact-run-registry';

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
  /** «Quitar»: también se quitan en el servidor para que no vuelvan en otro equipo. */
  onDismiss?: (ids: string[]) => void;
}

export const FIRST_CONTACT_RUNS_STORAGE_KEY = 'sellup:agent3-runs:v1';
const MAX_KEPT = 12;
/** Una invocación vive como mucho 300 s: desligada y sin cerrar después de esto, ya no corre. */
export const FIRST_CONTACT_DETACHED_STALE_MS = 6 * 60 * 1000;
const STALE_MESSAGE = 'No pudimos seguirla después de recargar la página. Revisa la pestaña «Primer contacto» de la empresa.';
/**
 * Se perdió la respuesta (la página se recargó, se cayó la red o el servidor cortó la
 * conexión) pero el servidor puede seguir escribiendo (dueña 19-10: «No pudimos conectar
 * con el servidor» al recargar tras un deploy). No es un fallo: la corrida queda
 * desligada y el Centro de procesos la cierra cuando aparecen sus preparaciones.
 */
export const FIRST_CONTACT_DETACHED_CODE = 'detached';
const DETACHED_MESSAGE = 'Perdimos la conexión con la preparación, pero sigue en el servidor: la verás en el Centro de procesos.';
/** Respuestas que no dicen cómo terminó (no son un «no» del servidor). */
const LOST_RESPONSE_CODES: ReadonlySet<string> = new Set(['bad_response', 'network']);

export interface FirstContactRunsStore {
  getSnapshot(): readonly FirstContactRun[];
  subscribe(listener: () => void): () => void;
  /** Una por empresa a la vez: si ya hay una en curso, devuelve esa misma. */
  startRun(input: { id: string; accountId: string; accountName: string; title: string; expected: number; body: unknown }): Promise<FirstContactRunResponse>;
  isRunning(accountId: string): boolean;
  settleDetached(id: string, outcome: { status: 'succeeded' | 'failed'; packStatuses: string[]; message?: string | null }): void;
  expireStaleDetached(): void;
  /** Lo que dice el servidor: agrega las que no estaban y cierra las desligadas ya terminadas. */
  hydrate(serverRuns: readonly FirstContactServerRun[]): void;
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
      const detach = (): FirstContactRunResponse => {
        update(id, { detached: true });
        return { ok: false, code: FIRST_CONTACT_DETACHED_CODE, message: DETACHED_MESSAGE };
      };
      // El id, el título y cuántas se esperan viajan con la solicitud: el servidor registra
      // la corrida con ESE id (si el cuerpo no es un objeto, se manda tal cual).
      const payload =
        body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as Record<string, unknown>), run: { id, title, expected, accountName } } : body;
      const promise = deps
        .execute(payload)
        .then((response) => {
          if (!response.ok && LOST_RESPONSE_CODES.has(response.code)) return detach();
          // El servidor ya la cerró por otro lado (hydrate): no se avisa dos veces.
          if (runs.find((r) => r.id === id)?.status !== 'running') return response;
          update(
            id,
            response.ok
              ? { status: 'succeeded', finishedAtMs: now(), packStatuses: response.packStatuses, message: null }
              : { status: 'failed', finishedAtMs: now(), message: response.message },
          );
          return response;
        })
        .catch(detach)
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
    hydrate(serverRuns) {
      let changed = false;
      const settled: string[] = [];
      for (const server of serverRuns) {
        const local = runs.find((r) => r.id === server.id);
        if (!local) {
          // De otro equipo o pestaña: en curso queda desligada (la sigue el Centro de procesos).
          runs = [...runs, { ...server, detached: server.status === 'running' }];
          changed = true;
        } else if (local.status === 'running' && local.detached && server.status !== 'running') {
          runs = runs.map((r) =>
            r.id === server.id
              ? { ...r, status: server.status, finishedAtMs: server.finishedAtMs ?? now(), packStatuses: server.packStatuses, message: server.message, detached: false }
              : r,
          );
          settled.push(server.id);
          changed = true;
        }
      }
      if (!changed) return;
      runs = [...runs].sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, MAX_KEPT);
      emit();
      for (const id of settled) {
        const run = runs.find((r) => r.id === id);
        if (!run) continue;
        try {
          deps.onSettled?.(run);
        } catch {
          // El aviso es cosmético.
        }
      }
    },
    dismiss(id) {
      const run = runs.find((r) => r.id === id);
      if (!run || (run.status === 'running' && !run.detached)) return;
      runs = runs.filter((r) => r.id !== id);
      emit();
      deps.onDismiss?.([id]);
    },
    dismissFinished() {
      const finished = runs.filter((r) => r.status !== 'running').map((r) => r.id);
      runs = runs.filter((r) => r.status === 'running');
      emit();
      if (finished.length > 0) deps.onDismiss?.(finished);
    },
  };
}
