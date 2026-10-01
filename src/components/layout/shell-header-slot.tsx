"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * La ranura de la cabecera del shell — port de Thema
 * `app-shell/shellHeaderSlot.tsx`.
 *
 * Una pantalla sabe cosas que la cabecera no puede saber de antemano: el nombre
 * de la empresa que se está viendo, el camino hasta una subpágina. En vez de
 * subir ese estado hasta el layout, la pantalla lo PINTA aquí (un portal al
 * hueco de la cabecera) y sigue siendo su dueña.
 *
 * Thema reparte el hueco por contexto; aquí es un almacén de módulo porque la
 * cabecera y la página no comparten un proveedor propio (`AppShell` los monta
 * como hermanos). Se lee con `useSyncExternalStore`: en el servidor y durante
 * la hidratación no hay hueco, así que ambos pintan lo mismo.
 */

interface PublishedCrumbs {
  id: string;
  /** El primer tramo, para que la cabecera no repita la sección. */
  firstLabel?: string;
}

const NO_CRUMBS: readonly PublishedCrumbs[] = [];

let hostElement: HTMLElement | null = null;
let publishedCrumbs: readonly PublishedCrumbs[] = NO_CRUMBS;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function subscribeNever(): () => void {
  return () => {};
}

/** `ref` del hueco de la cabecera: lo registra al montar y lo retira al salir. */
export function setShellHeaderHost(element: HTMLElement | null): void {
  if (hostElement === element) return;
  hostElement = element;
  notify();
}

function publishCrumbs(entry: PublishedCrumbs): () => void {
  publishedCrumbs = [...publishedCrumbs.filter((item) => item.id !== entry.id), entry];
  notify();
  return () => {
    const next = publishedCrumbs.filter((item) => item.id !== entry.id);
    publishedCrumbs = next.length === 0 ? NO_CRUMBS : next;
    notify();
  };
}

function useShellHeaderHost(): HTMLElement | null {
  return React.useSyncExternalStore(
    subscribe,
    () => hostElement,
    () => null,
  );
}

/** Lo que las pantallas montadas han publicado. Vacío = la cabecera pinta su ruta fija. */
export function usePublishedCrumbs(): readonly PublishedCrumbs[] {
  return React.useSyncExternalStore(
    subscribe,
    () => publishedCrumbs,
    () => NO_CRUMBS,
  );
}

/**
 * Pinta `children` en la cabecera del shell, junto a la ruta. Sin shell (una
 * pantalla fuera de la app, una prueba) no pinta nada.
 */
export function ShellHeaderSlot({ children }: { children: React.ReactNode }) {
  const host = useShellHeaderHost();
  if (!host) return null;
  return createPortal(children, host);
}

/** El rótulo del primer tramo de un `<Breadcrumbs items={…} />`. */
function firstCrumbLabel(node: React.ReactNode): string | undefined {
  if (!React.isValidElement(node)) return undefined;
  const items = (node.props as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const first: unknown = items[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object" && "label" in first) {
    const label = (first as { label?: unknown }).label;
    return typeof label === "string" ? label : undefined;
  }
  return undefined;
}

interface ShellBreadcrumbsProps {
  /** Las migas de la pantalla, típicamente `<Breadcrumbs items={…} />`. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Publica las migas de la pantalla en la cabecera del shell, que es donde vive
 * la ruta («SellUp › Empresas › Acme S.A.»). Lo usan `PageHeader` y
 * `DataTablePage`: una pantalla solo pasa `breadcrumbs` y no decide dónde se
 * pintan.
 *
 * Sin shell (pantalla fuera de la app, pruebas) las migas se quedan donde
 * estaban: sobre el título.
 */
export function ShellBreadcrumbs({ children, className }: ShellBreadcrumbsProps) {
  const host = useShellHeaderHost();
  const isClient = React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const id = React.useId();
  const firstLabel = firstCrumbLabel(children);

  React.useEffect(() => {
    if (!host) return undefined;
    return publishCrumbs({ id, firstLabel });
  }, [host, id, firstLabel]);

  if (host) return createPortal(children, host);
  // Servidor e hidratación: nada. Dentro del shell las recoge la cabecera en
  // cuanto monta; así no hay un renglón que aparece y desaparece.
  if (!isClient) return null;
  return (
    <div data-slot="page-breadcrumbs" className={className}>
      {children}
    </div>
  );
}
