'use client';

import * as React from 'react';

/**
 * El orden en que cada persona dejó las fuentes del catálogo al arrastrarlas.
 *
 * El catálogo es un registro en código (no hay columna de orden ni acción de
 * servidor que lo guarde), así que el orden es una preferencia de quien mira:
 * vive en este navegador (`localStorage`), no se comparte con el equipo ni
 * viaja a otro dispositivo.
 *
 * Se lee con `useSyncExternalStore`: en el servidor y durante la hidratación
 * la lista sale en su orden de fábrica, y solo después se aplica lo guardado.
 */
export const SOURCE_CATALOG_ORDER_KEY = 'sellup:source-catalog:order';
/** Aviso dentro de la misma pestaña: `storage` solo se dispara en las demás. */
const CHANGE_EVENT = 'sellup-source-catalog-order-change';

const NO_ORDER: readonly string[] = [];

/** Respaldo en memoria si el almacenamiento está bloqueado. */
let memory: string | null = null;
let cachedRaw: string | null = null;
let cachedOrder: readonly string[] = NO_ORDER;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SOURCE_CATALOG_ORDER_KEY);
  } catch {
    return memory;
  }
}

function parse(raw: string | null): readonly string[] {
  if (!raw) return NO_ORDER;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return NO_ORDER;
    return value.filter((key): key is string => typeof key === 'string');
  } catch {
    // Algo ilegible guardado no es un error que deba ver nadie: el orden de fábrica.
    return NO_ORDER;
  }
}

/** Devuelve la misma lista mientras lo guardado no cambie (lo exige el store). */
function readOrder(): readonly string[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedOrder = parse(raw);
  }
  return cachedOrder;
}

function writeOrder(order: readonly string[] | null): void {
  const raw = order && order.length > 0 ? JSON.stringify(order) : null;
  try {
    if (raw === null) window.localStorage.removeItem(SOURCE_CATALOG_ORDER_KEY);
    else window.localStorage.setItem(SOURCE_CATALOG_ORDER_KEY, raw);
  } catch {
    // Sin almacenamiento el orden vale mientras dure la sesión.
    memory = raw;
  }
  window.dispatchEvent(new window.Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const serverOrder = (): readonly string[] => NO_ORDER;

/**
 * Aplica el orden guardado a las filas de hoy: las conocidas van en el orden
 * elegido; una fuente nueva (que no estaba al guardar) conserva su sitio de
 * fábrica respecto a sus vecinas; una clave que ya no existe se ignora.
 */
export function applySourceOrder<T extends { key: string }>(rows: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...rows];
  const rank = new Map(order.map((key, index) => [key, index]));
  const known = rows.filter((row) => rank.has(row.key)).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
  const result: T[] = [];
  let nextKnown = 0;
  // Cada hueco de fábrica de una fila conocida lo ocupa la siguiente conocida
  // en el orden elegido; las nuevas se quedan donde estaban.
  for (const row of rows) {
    result.push(rank.has(row.key) ? known[nextKnown++] : row);
  }
  return result;
}

/**
 * El orden completo tras soltar una fila en una vista parcial (una pestaña o
 * un filtro): las filas visibles se recolocan entre sí en los mismos huecos
 * que ocupaban dentro de la lista completa; las demás no se mueven.
 */
export function mergeVisibleOrder(allKeys: readonly string[], visibleKeys: readonly string[]): string[] {
  const visible = new Set(visibleKeys);
  let next = 0;
  return allKeys.map((key) => (visible.has(key) ? visibleKeys[next++] : key));
}

/**
 * useSourceCatalogOrder
 *
 * @example
 * const { order, hasCustomOrder, saveOrder, resetOrder } = useSourceCatalogOrder();
 * const rows = applySourceOrder(serverRows, order);
 */
export function useSourceCatalogOrder(): {
  order: readonly string[];
  hasCustomOrder: boolean;
  saveOrder: (keys: readonly string[]) => void;
  resetOrder: () => void;
} {
  const order = React.useSyncExternalStore(subscribe, readOrder, serverOrder);
  return React.useMemo(
    () => ({
      order,
      hasCustomOrder: order.length > 0,
      saveOrder: (keys: readonly string[]) => writeOrder(keys),
      resetOrder: () => writeOrder(null),
    }),
    [order],
  );
}
