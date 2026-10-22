'use client';

/**
 * Una sola capa visible a la vez (dueña 22-10: «que no se pueda abrir modal sobre modal en
 * ningún lado, sólo uno a la vez»).
 *
 * Cada panel lateral, diálogo o confirmación abierto se apila aquí. Sólo el último se ve; los
 * de abajo quedan ocultos (siguen montados: no pierden lo escrito ni la pestaña) y reaparecen
 * cuando se cierra el de arriba. Ejemplo: la ficha de la empresa se oculta mientras se edita
 * la empresa y vuelve al guardar o cancelar.
 *
 * No reemplaza a `exclusive-panels`, que CIERRA paneles (abrir Rumbo cierra la ficha); esto
 * sólo decide cuál se ve cuando uno se abre desde otro.
 */

import * as React from 'react';

let stack: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Apila una capa; devuelve cómo sacarla. Exportado para pruebas. */
export function pushOverlayLayer(id: string): () => void {
  stack = [...stack.filter((entry) => entry !== id), id];
  emit();
  return () => {
    stack = stack.filter((entry) => entry !== id);
    emit();
  };
}

/** La capa que se ve (la última abierta); null sin capas. Exportado para pruebas. */
export function topOverlayLayer(): string | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/**
 * Para el contenido de una capa (se monta sólo mientras está abierta). Devuelve `true` cuando
 * otra capa se abrió encima y ésta debe ocultarse.
 */
export function useOverlayCovered(): boolean {
  const id = React.useId();
  useIsomorphicLayoutEffect(() => pushOverlayLayer(id), [id]);
  const top = React.useSyncExternalStore(subscribe, topOverlayLayer, () => null);
  return top !== null && top !== id;
}

/** Clases para la capa cubierta: invisible y sin recibir clics, pero montada. */
export const OVERLAY_COVERED_CLASS = 'invisible pointer-events-none';
