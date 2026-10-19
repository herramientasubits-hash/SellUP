'use client';

/**
 * El registro ÚNICO de preparaciones del Agente 3 en este navegador: vive fuera del
 * panel (el panel se puede minimizar o cerrar) y lo muestra el Centro de procesos.
 * Al terminar dispara el aviso «¡Primer contacto listo!», esté o no el panel abierto.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { firstContactDoneToast } from './first-contact-wizard';
import {
  createFirstContactRunsStore,
  type FirstContactRun,
  type FirstContactRunResponse,
  type FirstContactRunsStore,
} from './first-contact-runs-store';

async function executeFirstContactRun(body: unknown): Promise<FirstContactRunResponse> {
  const response = await fetch('/api/agent3/first-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  // Sin sesión, el proxy redirige a /login y la respuesta es la página, no JSON.
  if (response.redirected && new URL(response.url).pathname.startsWith('/login')) {
    return { ok: false, code: 'session', message: 'Tu sesión se cerró. Vuelve a iniciar sesión e inténtalo de nuevo.' };
  }
  const parsed = (await response.json().catch(() => null)) as FirstContactRunResponse | null;
  return parsed ?? { ok: false, code: 'bad_response', message: 'Algo falló al preparar el primer contacto. Vuelve a intentarlo.' };
}

/** Un id para una corrida nueva (se llama al lanzarla, nunca al pintar). */
export function newFirstContactRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * «Abrir» una preparación en curso desde el Centro de procesos (dueña 19-10): abre el
 * panel de Rumbo de esa empresa con el avance, en la pantalla en la que se esté.
 */
export const FIRST_CONTACT_PANEL_OPEN_EVENT = 'sellup:agent3-panel:open';

export function requestOpenFirstContactPanel(accountId: string): void {
  window.dispatchEvent(new window.CustomEvent(FIRST_CONTACT_PANEL_OPEN_EVENT, { detail: { accountId } }));
}

/** Evento para que quien muestra la empresa recargue sus preparaciones al terminar. */
export const FIRST_CONTACT_RUN_SETTLED_EVENT = 'sellup:agent3-run:settled';

function announce(run: FirstContactRun) {
  if (run.status === 'succeeded') {
    const notice = firstContactDoneToast(run.packStatuses, run.title);
    toast[notice.tone](notice.title, { description: `${run.accountName}: ${notice.description}`, duration: 8000 });
  } else {
    toast.error('No pudimos preparar el primer contacto', { description: `${run.accountName}: ${run.message ?? 'Vuelve a intentarlo.'}` });
  }
  window.dispatchEvent(new window.CustomEvent(FIRST_CONTACT_RUN_SETTLED_EVENT, { detail: { accountId: run.accountId, runId: run.id } }));
}

let singleton: FirstContactRunsStore | null = null;

/** El registro del navegador. En el servidor no existe (devuelve `null`). */
export function getFirstContactRunsStore(): FirstContactRunsStore | null {
  if (typeof window === 'undefined') return null;
  if (singleton === null) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    singleton = createFirstContactRunsStore({ execute: executeFirstContactRun, storage, onSettled: announce });
  }
  return singleton;
}

const EMPTY: readonly FirstContactRun[] = [];
const noopSubscribe = () => () => {};

export function useFirstContactRuns(): readonly FirstContactRun[] {
  const store = getFirstContactRunsStore();
  return React.useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => EMPTY,
    () => EMPTY,
  );
}

/** Sólo para pruebas: un registro nuevo (con otro `execute`). */
export function resetFirstContactRunsStoreForTests(store: FirstContactRunsStore | null): void {
  singleton = store;
}
