"use client";

import * as React from "react";

/**
 * Dónde viven las acciones de una pantalla: en la barra flotante o en el
 * propio layout (la cabecera de la página y el marco de la tabla).
 *
 * Port de Thema `action-rail/actionsPlacement.ts`. Es una preferencia de la
 * persona, no de cada tabla: quien prefiere la barra la quiere en todas las
 * pantallas. Por eso vive fuera de React, igual que la orientación o el
 * ocultarse sola (`rail-preferences.ts`), y se guarda en este navegador para
 * sobrevivir a una recarga. Se cambia desde «Personalización» (menú de la
 * marca) y desde los ajustes de la barra.
 *
 * Se lee con `useSyncExternalStore`: en el servidor y durante la hidratación
 * manda la barra, y solo después se aplica lo guardado.
 */

export type ActionsPlacement = "rail" | "inline";

export const DEFAULT_ACTIONS_PLACEMENT: ActionsPlacement = "rail";

export const ACTIONS_PLACEMENT_KEY = "sellup:actions-placement";
/** Aviso dentro de la misma pestaña: `storage` solo se dispara en las demás. */
const CHANGE_EVENT = "sellup-actions-placement-change";

/** Respaldo en memoria si el almacenamiento está bloqueado (modo privado, políticas). */
let memory: ActionsPlacement | null = null;

function read(): ActionsPlacement {
  try {
    return window.localStorage.getItem(ACTIONS_PLACEMENT_KEY) === "inline" ? "inline" : DEFAULT_ACTIONS_PLACEMENT;
  } catch {
    return memory ?? DEFAULT_ACTIONS_PLACEMENT;
  }
}

export function setActionsPlacement(value: ActionsPlacement): void {
  try {
    window.localStorage.setItem(ACTIONS_PLACEMENT_KEY, value);
  } catch {
    // Almacenamiento bloqueado: la sesión sigue, solo que sin recordarlo.
    memory = value;
  }
  // `window.Event` y no el global: en las pruebas (jsdom sobre Node) son clases distintas.
  window.dispatchEvent(new window.Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const serverPlacement = (): ActionsPlacement => DEFAULT_ACTIONS_PLACEMENT;

/**
 * La preferencia compartida y cómo cambiarla.
 *
 * @example
 * const [placement, setPlacement] = useActionsPlacement();
 * if (placement === "inline") return <ScreenHeaderActions actions={actions} moreLabel="Más acciones" />;
 */
export function useActionsPlacement(): readonly [ActionsPlacement, (value: ActionsPlacement) => void] {
  const value = React.useSyncExternalStore(subscribe, read, serverPlacement);
  return [value, setActionsPlacement];
}
