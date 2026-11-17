/**
 * Abrir una empresa o un contacto de SellUp EN SU FICHA LATERAL (dueña 17-11: «desde el
 * buscador, en vez de la página completa, debe abrir el drawer»). Puro: sin React ni Next.
 *
 *  - Desde otra pantalla: se navega a la lista con `?abrir=<id>` y la lista abre la ficha
 *    al montarse (y quita el parámetro, para que recargar no la vuelva a abrir).
 *  - Estando ya en la lista: navegar a la misma ruta no la vuelve a montar, así que se le
 *    avisa con un evento de ventana.
 */

import { ACCOUNTS_ROUTE } from '@/config/navigation';
import { OPEN_ACCOUNT_PARAM, openAccountHref } from '@/components/accounts/open-account-link';

export type OpenRecordKind = 'account' | 'contact';

/** Evento de ventana: «abre la ficha de este registro» (`detail: { kind, id }`). */
export const OPEN_RECORD_EVENT = 'sellup:open-record';

export interface OpenRecordDetail {
  kind: OpenRecordKind;
  id: string;
}

const CONTACTS_ROUTE = '/contacts';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value.trim());
}

/** La lista que abre la ficha: `/accounts?abrir=<id>` o `/contacts?abrir=<id>`. */
export function openRecordHref(kind: OpenRecordKind, id: string): string {
  if (kind === 'account') return openAccountHref(id);
  return `${CONTACTS_ROUTE}?${OPEN_ACCOUNT_PARAM}=${encodeURIComponent(id)}`;
}

/** El registro pedido en la dirección (si tiene forma de id) y la dirección sin él. */
export function readOpenRecordParam(search: string): { id: string | null; rest: string } {
  const params = new URLSearchParams(search);
  const raw = params.get(OPEN_ACCOUNT_PARAM)?.trim() ?? '';
  params.delete(OPEN_ACCOUNT_PARAM);
  const rest = params.toString();
  return { id: isRecordId(raw) ? raw : null, rest: rest ? `?${rest}` : '' };
}

/** Pestañas de cada ruta que montan la lista con fichas (sin pestaña = la principal). */
const LIST_TABS: Record<OpenRecordKind, { path: string; tabs: ReadonlyArray<string> }> = {
  account: { path: ACCOUNTS_ROUTE, tabs: ['', 'empresas'] },
  contact: { path: CONTACTS_ROUTE, tabs: ['', 'approved'] },
};

/** ¿La pantalla actual es la lista que tiene la ficha de ese tipo de registro? */
export function isOnRecordList(currentHref: string, kind: OpenRecordKind): boolean {
  const url = new URL(currentHref, 'http://local');
  const list = LIST_TABS[kind];
  return url.pathname === list.path && list.tabs.includes(url.searchParams.get('tab') ?? '');
}

/** Escucha el evento para un tipo de registro. Devuelve cómo dejar de escuchar. */
export function onOpenRecord(kind: OpenRecordKind, handler: (id: string) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<Partial<OpenRecordDetail>>).detail;
    if (detail?.kind === kind && isRecordId(detail.id)) handler(detail.id);
  };
  window.addEventListener(OPEN_RECORD_EVENT, listener);
  return () => window.removeEventListener(OPEN_RECORD_EVENT, listener);
}
