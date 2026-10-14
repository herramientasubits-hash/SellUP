/**
 * Cuándo empezó DE VERDAD la función que está importando (AGENT1-CORPORATE-TREE-1).
 *
 * La búsqueda en árbol llama a la ruta de importación dentro de su propia
 * petición, después de esperar a Claude. El rescate en segundo plano de la
 * importación reparte el tiempo que le queda a la función de Vercel contando
 * desde el inicio de la ACCIÓN; si contara desde que empezó la importación,
 * creería tener más tiempo del que hay y Vercel lo cortaría a mitad de ronda.
 *
 * Sólo se fija dentro del servidor (no viene de la petición): un cliente no
 * puede alterarlo.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage<number>();

export function runWithImportActionStartedAt<T>(startedAtMs: number, fn: () => Promise<T>): Promise<T> {
  return store.run(startedAtMs, fn);
}

/** El inicio de la acción que envuelve esta importación, o `null` si es una importación normal. */
export function readImportActionStartedAt(): number | null {
  return store.getStore() ?? null;
}
