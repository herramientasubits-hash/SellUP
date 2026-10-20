/**
 * Las búsquedas de contactos con Rumbo en curso (puro, sin React ni red).
 *
 * Dueña 20-10: «que se puedan hacer varias al tiempo, como con empresas: minimizar o
 * cerrar el panel y que la búsqueda quede en el Centro de procesos». Viven fuera del
 * panel, como las preparaciones del Agente 3: el panel se puede cerrar y la búsqueda
 * sigue. Se guardan en el navegador; al recargar, lo que estaba en curso sigue en el
 * servidor pero su respuesta ya no llega aquí («desligada») y, pasado el tope de una
 * invocación, se da por cerrada con un aviso para mirar «Por revisar».
 */

import type { RunAutomaticContactEnrichmentForRequestResult } from './automatic-routing-action-core';

export type ContactSearchRunStatus = 'running' | 'succeeded' | 'failed';

export interface ContactSearchRun {
  id: string;
  requestId: string;
  accountId: string | null;
  companyName: string;
  status: ContactSearchRunStatus;
  startedAtMs: number;
  finishedAtMs: number | null;
  /** Contactos nuevos que quedaron para revisar (o `null` si no se sabe). */
  found: number | null;
  message: string | null;
  /** Lanzada en otra carga de la página: su respuesta ya no llega aquí. */
  detached: boolean;
  /** La respuesta del servidor, para que el asistente muestre el resumen al terminar. */
  result?: RunAutomaticContactEnrichmentForRequestResult;
}

export type ContactSearchRunResponse =
  | { ok: true; result: RunAutomaticContactEnrichmentForRequestResult }
  | { ok: false; code: string; message: string };

export interface ContactSearchRunsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ContactSearchRunsDeps {
  execute: (requestId: string) => Promise<ContactSearchRunResponse>;
  storage?: ContactSearchRunsStorage | null;
  nowMs?: () => number;
  /** Al terminar (el aviso con «Ver en Por revisar» vive aquí, esté o no el panel abierto). */
  onSettled?: (run: ContactSearchRun) => void;
}

export const CONTACT_SEARCH_RUNS_STORAGE_KEY = 'sellup:contact-search-runs:v1';
const MAX_KEPT = 12;
/** Una invocación vive como mucho 300 s: desligada y sin cerrar después de esto, ya no corre. */
export const CONTACT_SEARCH_DETACHED_STALE_MS = 6 * 60 * 1000;
export const CONTACT_SEARCH_STALE_MESSAGE =
  'Recargaste la página mientras buscaba: lo que encontró está en «Por revisar».';
const LOST_MESSAGE = 'Perdimos la conexión con la búsqueda, pero sigue en el servidor: lo que encuentre quedará en «Por revisar».';
/** Respuestas que no dicen cómo terminó (no son un «no» del servidor). */
const LOST_RESPONSE_CODES: ReadonlySet<string> = new Set(['bad_response', 'network']);

/** Contactos nuevos que dejó para revisar: lo que creó cada proveedor más lo que ya estaba. */
export function contactsFound(result: RunAutomaticContactEnrichmentForRequestResult): number {
  const created = result.providerCandidatesCreated ?? { apollo: null, lusha: null };
  return (created.apollo ?? 0) + (created.lusha ?? 0) + (result.reusedExistingCandidates ?? 0);
}

export interface ContactSearchRunsStore {
  getSnapshot(): readonly ContactSearchRun[];
  subscribe(listener: () => void): () => void;
  /** Una búsqueda por pedido: si ya hay una en curso para ese pedido, devuelve esa misma. */
  startRun(input: { id: string; requestId: string; accountId: string | null; companyName: string }): Promise<ContactSearchRunResponse>;
  expireStaleDetached(): void;
  dismiss(id: string): void;
  dismissFinished(): void;
}

function readStored(storage: ContactSearchRunsStorage | null | undefined): ContactSearchRun[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CONTACT_SEARCH_RUNS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ContactSearchRun =>
        typeof item === 'object' && item !== null && typeof (item as ContactSearchRun).id === 'string' && typeof (item as ContactSearchRun).requestId === 'string',
    );
  } catch {
    return [];
  }
}

/** Al recargar: lo que estaba en curso queda desligado (o cerrado, si ya no puede seguir). */
export function restoreContactSearchRuns(stored: readonly ContactSearchRun[], nowMs: number): ContactSearchRun[] {
  return stored.map((run) => {
    if (run.status !== 'running') return run;
    if (nowMs - run.startedAtMs > CONTACT_SEARCH_DETACHED_STALE_MS) {
      return { ...run, status: 'succeeded', finishedAtMs: nowMs, detached: false, message: CONTACT_SEARCH_STALE_MESSAGE };
    }
    return { ...run, detached: true };
  });
}

export function createContactSearchRunsStore(deps: ContactSearchRunsDeps): ContactSearchRunsStore {
  const now = deps.nowMs ?? (() => Date.now());
  let runs: ContactSearchRun[] = restoreContactSearchRuns(readStored(deps.storage), now());
  const listeners = new Set<() => void>();
  const inFlight = new Map<string, Promise<ContactSearchRunResponse>>();

  const emit = () => {
    try {
      deps.storage?.setItem(CONTACT_SEARCH_RUNS_STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_KEPT)));
    } catch {
      // Sin almacenamiento (modo privado): la bandeja vive sólo en esta carga de la página.
    }
    for (const listener of listeners) listener();
  };

  const update = (id: string, patch: Partial<ContactSearchRun>) => {
    runs = runs.map((run) => (run.id === id ? { ...run, ...patch } : run));
    const settled = runs.find((run) => run.id === id);
    emit();
    if (settled && settled.status !== 'running') {
      try {
        deps.onSettled?.(settled);
      } catch {
        // El aviso es cosmético: un fallo al avisar no cambia cómo terminó la búsqueda.
      }
    }
  };

  return {
    getSnapshot: () => runs,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    startRun({ id, requestId, accountId, companyName }) {
      const existing = runs.find((run) => run.requestId === requestId && run.status === 'running' && !run.detached);
      if (existing && inFlight.has(existing.id)) return inFlight.get(existing.id)!;
      const run: ContactSearchRun = {
        id,
        requestId,
        accountId,
        companyName,
        status: 'running',
        startedAtMs: now(),
        finishedAtMs: null,
        found: null,
        message: null,
        detached: false,
      };
      runs = [run, ...runs.filter((r) => r.id !== id)].slice(0, MAX_KEPT);
      emit();
      const lost = (): ContactSearchRunResponse => {
        update(id, { detached: true, message: LOST_MESSAGE });
        return { ok: false, code: 'detached', message: LOST_MESSAGE };
      };
      const promise = deps
        .execute(requestId)
        .then((response) => {
          if (!response.ok && LOST_RESPONSE_CODES.has(response.code)) return lost();
          if (response.ok && response.result.success) {
            update(id, { status: 'succeeded', finishedAtMs: now(), found: contactsFound(response.result), message: null, result: response.result });
          } else {
            const message = response.ok
              ? response.result.blockedReason ?? 'No se pudo hacer la búsqueda de contactos.'
              : response.message;
            update(id, { status: 'failed', finishedAtMs: now(), message, ...(response.ok ? { result: response.result } : {}) });
          }
          return response;
        })
        .catch(lost)
        .finally(() => inFlight.delete(id));
      inFlight.set(id, promise);
      return promise;
    },
    expireStaleDetached() {
      const at = now();
      const stale = runs.filter((r) => r.status === 'running' && r.detached && at - r.startedAtMs > CONTACT_SEARCH_DETACHED_STALE_MS);
      for (const run of stale) update(run.id, { status: 'succeeded', finishedAtMs: at, detached: false, message: CONTACT_SEARCH_STALE_MESSAGE });
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
