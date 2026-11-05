'use client';

/**
 * El registro ÚNICO de búsquedas de contactos con Rumbo en este navegador: vive fuera del
 * panel (se puede minimizar o cerrar) y lo muestra el Centro de procesos. Al terminar
 * avisa con la empresa y sus cifras (y «Ver en Por revisar» si hay qué aprobar), esté o no
 * el panel abierto.
 *
 * Todo va por rutas, no por acciones del servidor: las acciones van una a la vez y las
 * navegaciones esperan detrás de ellas (Prod 19-10, Agente 3), así que dos búsquedas a
 * la vez se habrían puesto en fila.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { CONTACTS_CANDIDATES_ROUTE } from '@/config/navigation';
import {
  CONTACT_SEARCH_FALLBACK_PROGRESS,
  CONTACT_SEARCH_PROGRESS_POLL_MS,
  contactSearchProgressPath,
  contactSearchRunPath,
  nextContactSearchPercent,
  type ContactSearchProgress,
} from './contact-search-progress';
import {
  buildContactSearchNotice,
  createContactSearchRunsStore,
  type ContactSearchNotice,
  type ContactSearchRun,
  type ContactSearchRunResponse,
  type ContactSearchRunsStore,
} from './contact-search-runs-store';

async function executeContactSearch(requestId: string): Promise<ContactSearchRunResponse> {
  let response: Response;
  try {
    response = await fetch(contactSearchRunPath(requestId), { method: 'POST', cache: 'no-store' });
  } catch {
    return { ok: false, code: 'network', message: 'No pudimos conectar con el servidor.' };
  }
  // Sin sesión, el proxy redirige a /login y la respuesta es la página, no JSON.
  if (response.redirected && new URL(response.url).pathname.startsWith('/login')) {
    return { ok: false, code: 'session', message: 'Tu sesión se cerró. Vuelve a iniciar sesión e inténtalo de nuevo.' };
  }
  const parsed = (await response.json().catch(() => null)) as ContactSearchRunResponse | null;
  return parsed ?? { ok: false, code: 'bad_response', message: 'Algo falló al buscar contactos. Vuelve a intentarlo.' };
}

/** Evento para que la pantalla de contactos (o quien muestre la empresa) recargue al terminar. */
export const CONTACT_SEARCH_SETTLED_EVENT = 'sellup:contact-search:settled';

/** «Ver en Por revisar»: la cola de candidatos, con lo más nuevo arriba. */
export const CONTACT_SEARCH_REVIEW_HREF = CONTACTS_CANDIDATES_ROUTE;

/**
 * Clases para un aviso que no se corta: los avisos van a dos líneas (`ui/sonner.tsx`), pero
 * el de la búsqueda lleva dos líneas de cifras bajo el nombre de la empresa (Bryan 04-11).
 */
export const CONTACT_SEARCH_TOAST_CLASSNAMES = {
  description: 'whitespace-pre-line !line-clamp-none',
} as const;

const reviewAction = () => ({
  label: 'Ver en Por revisar',
  onClick: () => window.location.assign(CONTACT_SEARCH_REVIEW_HREF),
});

/** Muestra el aviso de una búsqueda (o de un lote) terminada. */
export function showContactSearchNotice(notice: ContactSearchNotice, duration = 10000) {
  const options = {
    description: notice.description,
    classNames: CONTACT_SEARCH_TOAST_CLASSNAMES,
    ...(notice.review ? { action: reviewAction() } : {}),
    duration,
  };
  if (notice.kind === 'error') toast.error(notice.title, options);
  else if (notice.kind === 'info') toast.info(notice.title, options);
  else toast.success(notice.title, options);
}

function announce(run: ContactSearchRun) {
  // Las de un lote salen en el Centro de procesos; el aviso es uno solo, al final del lote.
  if (!run.quiet) showContactSearchNotice(buildContactSearchNotice(run));
  window.dispatchEvent(new window.CustomEvent(CONTACT_SEARCH_SETTLED_EVENT, { detail: { runId: run.id, accountId: run.accountId } }));
}

let singleton: ContactSearchRunsStore | null = null;

/** El registro del navegador. En el servidor no existe (devuelve `null`). */
export function getContactSearchRunsStore(): ContactSearchRunsStore | null {
  if (typeof window === 'undefined') return null;
  if (singleton === null) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    singleton = createContactSearchRunsStore({ execute: executeContactSearch, storage, onSettled: announce });
  }
  return singleton;
}

const EMPTY: readonly ContactSearchRun[] = [];
const noopSubscribe = () => () => {};

export function useContactSearchRuns(): readonly ContactSearchRun[] {
  const store = getContactSearchRunsStore();
  return React.useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => EMPTY,
    () => EMPTY,
  );
}

/** Un id para una búsqueda nueva (se llama al lanzarla, nunca al pintar). */
export function newContactSearchRunId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fetchContactSearchProgress(requestId: string): Promise<ContactSearchProgress | null> {
  try {
    const response = await fetch(contactSearchProgressPath(requestId), { cache: 'no-store' });
    if (!response.ok) return null;
    return ((await response.json()) as { progress: ContactSearchProgress }).progress;
  } catch {
    return null;
  }
}

/**
 * La etapa real de la búsqueda, leída del servidor cada pocos segundos mientras corre.
 * Si una lectura falla, se queda la última que sí llegó; la barra nunca retrocede.
 */
export function useContactSearchProgress(requestId: string | null, active: boolean): ContactSearchProgress {
  const [progress, setProgress] = React.useState<ContactSearchProgress>(CONTACT_SEARCH_FALLBACK_PROGRESS);
  React.useEffect(() => {
    if (!requestId || !active) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const snapshot = await fetchContactSearchProgress(requestId);
      if (cancelled) return;
      if (snapshot) setProgress((previous) => ({ ...snapshot, percent: nextContactSearchPercent(previous.percent, snapshot) }));
      timer = setTimeout(poll, CONTACT_SEARCH_PROGRESS_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [requestId, active]);
  return progress;
}
