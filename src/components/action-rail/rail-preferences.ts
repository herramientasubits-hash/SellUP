"use client";

import * as React from "react";

/**
 * Las preferencias de la barra de acciones flotante: si se oculta sola, hacia
 * dónde se tiende y dónde la dejó quien la arrastró.
 *
 * Viven fuera de React a propósito: cada pantalla monta su propia barra, así
 * que una preferencia guardada dentro de una de ellas se perdería al cambiar
 * de pantalla. Para quien la usa es UNA barra, y por eso tiene un único estado,
 * recordado en este navegador.
 *
 * Se leen con `useSyncExternalStore`: en el servidor y durante la hidratación
 * la barra sale con sus valores de fábrica, y solo después se aplica lo
 * guardado. Leerlo en el estado inicial haría que servidor y cliente pintaran
 * barras distintas (mismo motivo que `layout/sidebar-context.tsx`).
 */

export type RailOrientation = "horizontal" | "vertical";

export interface RailPosition {
  /**
   * El CENTRO horizontal de la barra, no su borde izquierdo: su ancho cambia
   * al recogerse en la pastilla, y un borde fijo dejaría que el centro visible
   * se desplazara con cada cambio de tamaño.
   */
  x: number;
  y: number;
}

const AUTO_HIDE_KEY = "sellup:action-rail:auto-hide";
const ORIENTATION_KEY = "sellup:action-rail:orientation";
const POSITION_KEY = "sellup:action-rail:position";
/** Aviso dentro de la misma pestaña: `storage` solo se dispara en las demás. */
const CHANGE_EVENT = "sellup-action-rail-change";

/** Respaldo en memoria si el almacenamiento está bloqueado (modo privado, políticas). */
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento la barra sigue funcionando; solo no se recuerda.
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  // `window.Event` y no el global: es el constructor del mismo documento que
  // recibe el aviso (en el navegador son el mismo).
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

// ── Auto-ocultar ─────────────────────────────────────────────────────────────

const readAutoHide = (): boolean => readRaw(AUTO_HIDE_KEY) === "true";

export function setRailAutoHide(value: boolean): void {
  writeRaw(AUTO_HIDE_KEY, String(value));
}

/** Si la barra se recoge sola al apartar el cursor, y cómo cambiarlo. */
export function useRailAutoHide(): readonly [boolean, (value: boolean) => void] {
  const value = React.useSyncExternalStore(subscribe, readAutoHide, () => false);
  return [value, setRailAutoHide];
}

// ── Orientación ──────────────────────────────────────────────────────────────

const readOrientation = (): RailOrientation =>
  readRaw(ORIENTATION_KEY) === "vertical" ? "vertical" : "horizontal";

const serverOrientation = (): RailOrientation => "horizontal";

export function setRailOrientation(value: RailOrientation): void {
  writeRaw(ORIENTATION_KEY, value);
}

/** Si la barra va tendida abajo o de pie en el borde derecho, y cómo cambiarlo. */
export function useRailOrientation(): readonly [RailOrientation, (value: RailOrientation) => void] {
  const value = React.useSyncExternalStore(subscribe, readOrientation, serverOrientation);
  return [value, setRailOrientation];
}

/**
 * El eje de la barra que rodea a una pieza. Botones, recuento y divisorias
 * necesitan la misma respuesta —hacia dónde tender una regla, de qué lado
 * abrir un tooltip— y ninguna debería recibirla por props: el marco la da una
 * vez.
 */
export const RailOrientationContext = React.createContext<RailOrientation | null>(null);

/** El eje contra el que se dibuja: el del marco o, fuera de él, la preferencia. */
export function useRailAxis(): RailOrientation {
  const fromShell = React.useContext(RailOrientationContext);
  const [preference] = useRailOrientation();
  return fromShell ?? preference;
}

export function useRailIsVertical(): boolean {
  return useRailAxis() === "vertical";
}

/**
 * Hacia dónde se abre un tooltip o un popover de la barra: arriba cuando va
 * tendida, a la izquierda cuando va de pie. Siempre alejándose de ella.
 */
export function useRailPopoutSide(): "top" | "left" {
  return useRailIsVertical() ? "left" : "top";
}

// ── Posición ─────────────────────────────────────────────────────────────────

let cachedPositionRaw: string | null = null;
let cachedPosition: RailPosition | null = null;

function parsePosition(raw: string | null): RailPosition | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

/** Devuelve el mismo objeto mientras lo guardado no cambie (lo exige el store). */
function readPosition(): RailPosition | null {
  const raw = readRaw(POSITION_KEY);
  if (raw !== cachedPositionRaw) {
    cachedPositionRaw = raw;
    cachedPosition = parsePosition(raw);
  }
  return cachedPosition;
}

const serverPosition = (): RailPosition | null => null;

export function setRailPosition(value: RailPosition | null): void {
  writeRaw(POSITION_KEY, value ? JSON.stringify({ x: Math.round(value.x), y: Math.round(value.y) }) : null);
}

/**
 * Dónde quedó la barra después de arrastrarla. `null` = en su sitio de
 * fábrica (abajo al centro, o en el borde derecho si va de pie).
 */
export function useRailPosition(): readonly [RailPosition | null, (value: RailPosition | null) => void] {
  const value = React.useSyncExternalStore(subscribe, readPosition, serverPosition);
  return [value, setRailPosition];
}
