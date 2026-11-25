// TABLEROS-1 — Vistas guardadas de los tableros, versión 1 (sin base de datos).
//
// Una vista es un nombre y una URL de /dashboards (pestaña + filtros). Se guarda
// en el navegador de quien la crea; para compartirla se copia su enlace. La
// tabla que las haría seguir a la persona en cualquier equipo y compartirlas con
// el equipo está en «Lo que falta» (docs/tableros-faltantes.md).
//
// Un periodo con atajo («Últimos 30 días») se guarda como atajo, así que se
// mueve solo; un rango a mano se guarda con sus fechas, fijo.
//
// Aquí sólo hay reglas puras: leer, limpiar y escribir la lista. El acceso a
// `localStorage` (que puede fallar) vive en el cliente.

import { DASHBOARD_PARAM_NAMES } from './dashboard-filters';

export const SAVED_VIEWS_STORAGE_KEY = 'sellup:dashboards:views:v1';
export const MAX_SAVED_VIEWS = 30;
export const MAX_VIEW_NAME_LENGTH = 60;

/** Los parámetros que una vista conserva: la pestaña y los filtros. Nada más viaja. */
const ALLOWED_PARAMS = new Set<string>(['tab', ...DASHBOARD_PARAM_NAMES]);

export interface SavedDashboardView {
  id: string;
  name: string;
  /** La query de la URL, sin `?`. */
  query: string;
  createdAt: string;
}

/** Deja en la query sólo la pestaña y los filtros de los tableros. */
export function sanitizeViewQuery(query: string): string {
  const source = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const clean = new URLSearchParams();
  for (const [key, value] of source) {
    if (ALLOWED_PARAMS.has(key) && value.length <= 2000) clean.set(key, value);
  }
  return clean.toString();
}

export function normalizeViewName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_VIEW_NAME_LENGTH);
}

function isSavedView(value: unknown): value is SavedDashboardView {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.query === 'string' &&
    typeof record.createdAt === 'string'
  );
}

/** Lee la lista guardada. Cualquier cosa rara (JSON roto, versión vieja) da una lista vacía. */
export function parseSavedViews(raw: string | null | undefined): SavedDashboardView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSavedView)
      .map((view) => ({ ...view, name: normalizeViewName(view.name), query: sanitizeViewQuery(view.query) }))
      .filter((view) => view.name.length > 0)
      .slice(0, MAX_SAVED_VIEWS);
  } catch {
    return [];
  }
}

export function serializeSavedViews(views: readonly SavedDashboardView[]): string {
  return JSON.stringify(views.slice(0, MAX_SAVED_VIEWS));
}

export type AddViewResult =
  | { ok: true; views: SavedDashboardView[]; view: SavedDashboardView }
  | { ok: false; reason: 'empty_name' | 'limit_reached' };

/**
 * Añade una vista. Un nombre que ya existe (sin distinguir mayúsculas) se
 * REEMPLAZA con los filtros de ahora: es «actualizar la vista», no un duplicado.
 */
export function addSavedView(
  views: readonly SavedDashboardView[],
  input: { name: string; query: string; id: string; now: string },
): AddViewResult {
  const name = normalizeViewName(input.name);
  if (!name) return { ok: false, reason: 'empty_name' };
  const view: SavedDashboardView = { id: input.id, name, query: sanitizeViewQuery(input.query), createdAt: input.now };
  const existing = views.findIndex((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (existing !== -1) {
    const next = [...views];
    next[existing] = { ...view, id: views[existing].id };
    return { ok: true, views: next, view: next[existing] };
  }
  if (views.length >= MAX_SAVED_VIEWS) return { ok: false, reason: 'limit_reached' };
  return { ok: true, views: [...views, view], view };
}

export function removeSavedView(views: readonly SavedDashboardView[], id: string): SavedDashboardView[] {
  return views.filter((view) => view.id !== id);
}

/** ¿La URL de ahora es exactamente la de esta vista? (para marcarla como puesta). */
export function isCurrentView(view: SavedDashboardView, currentQuery: string): boolean {
  const normalize = (query: string) => {
    const params = new URLSearchParams(sanitizeViewQuery(query));
    params.sort();
    return params.toString();
  };
  return normalize(view.query) === normalize(currentQuery);
}
