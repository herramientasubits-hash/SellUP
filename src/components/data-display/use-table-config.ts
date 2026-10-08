"use client";

import * as React from "react";

/**
 * El estado de «cómo quiero ver esta tabla» (Thema · `useTableConfig`): qué
 * columnas, en qué orden, cuáles quedan fijadas y cómo llegan las filas.
 *
 * «Dónde van las acciones» NO vive aquí: es una preferencia de la persona,
 * la misma en todas las tablas (`action-rail/actions-placement.ts`). Un valor
 * `actions` guardado por tabla en versiones anteriores se ignora sin romper.
 *
 * Vive en `localStorage` por tabla y no en la URL: es una preferencia de quien
 * mira, no parte de lo que se comparte.
 *
 * Se lee con `useSyncExternalStore` (igual que el menú lateral): en el
 * servidor y durante la hidratación la tabla sale con lo de fábrica, y solo
 * después se aplica lo guardado. Leerlo en el estado inicial haría que
 * servidor y cliente pintaran tablas distintas.
 */

/** Cómo se sirven las filas: de corrido o página por página. */
export type TableRowsMode = "lazy" | "paged";
/** Rejilla con todas las columnas, o una fila-tarjeta por registro. */
export type TableView = "table" | "list";
/** Casillas y lote, o un menú de acciones en cada fila. */
export type TableRowControl = "checkbox" | "menu";

export const DEFAULT_ROWS_MODE: TableRowsMode = "lazy";
export const DEFAULT_TABLE_VIEW: TableView = "table";
export const DEFAULT_ROW_CONTROL: TableRowControl = "checkbox";

export interface TableColumnSpec {
  /** Identificador estable: es lo que se guarda, así que no puede cambiar. */
  id: string;
  /** Cómo se nombra la columna en el panel de configuración. */
  label: string;
  /**
   * Una columna fija no se arrastra, ni se oculta, ni se fija: ya está donde
   * tiene que estar (la de selección, la de acciones). «Fija» aquí es
   * *inamovible*, no «fijada» (`pinned`).
   */
  fixed?: boolean;
  /** Falso cuando la columna se puede mover y fijar pero nunca ocultar. */
  hideable?: boolean;
  /** Arranca oculta y se pide desde el panel. */
  hiddenByDefault?: boolean;
  /** El objeto al que pertenece («Contacto», «Empresa»): agrupa la lista del panel. */
  group?: string;
}

/** Lo que se guarda por tabla entre sesiones. */
export interface StoredTableConfig {
  order: string[];
  hidden: string[];
  /** Las que se quedan quietas a la izquierda al desplazar la tabla de lado. */
  pinned: string[];
  mode: TableRowsMode;
  view: TableView;
  rowControl: TableRowControl;
  /** Filas por página cuando se pagina. `null` = el tamaño de fábrica. */
  pageSize: number | null;
}

const STORAGE_PREFIX = "sellup:table:";
/** Aviso dentro de la misma pestaña: `storage` solo se dispara en las demás. */
const CHANGE_EVENT = "sellup-table-config-change";

/** Respaldo en memoria si el almacenamiento está bloqueado (modo privado, políticas). */
const memoryStore = new Map<string, string>();
/** Última lectura por tabla: `useSyncExternalStore` exige la misma referencia si nada cambió. */
const snapshotCache = new Map<string, { raw: string | null; value: Partial<StoredTableConfig> | null }>();

function readRaw(tableId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + tableId);
  } catch {
    return memoryStore.get(tableId) ?? null;
  }
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : undefined;
}

function parse(raw: string | null): Partial<StoredTableConfig> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      order: strings(parsed.order),
      hidden: strings(parsed.hidden),
      pinned: strings(parsed.pinned),
      mode: parsed.mode === "paged" || parsed.mode === "lazy" ? parsed.mode : undefined,
      view: parsed.view === "list" || parsed.view === "table" ? parsed.view : undefined,
      rowControl:
        parsed.rowControl === "menu" || parsed.rowControl === "checkbox" ? parsed.rowControl : undefined,
      pageSize:
        typeof parsed.pageSize === "number" && parsed.pageSize > 0 ? Math.floor(parsed.pageSize) : undefined,
    };
  } catch {
    // Algo ilegible guardado no es un error que deba ver nadie: lo de fábrica.
    return null;
  }
}

function readSnapshot(tableId: string): Partial<StoredTableConfig> | null {
  const raw = readRaw(tableId);
  const cached = snapshotCache.get(tableId);
  if (cached && cached.raw === raw) return cached.value;
  const value = parse(raw);
  snapshotCache.set(tableId, { raw, value });
  return value;
}

function writeStored(tableId: string, value: StoredTableConfig | null): void {
  try {
    if (value) window.localStorage.setItem(STORAGE_PREFIX + tableId, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_PREFIX + tableId);
  } catch {
    // Sin almacenamiento la tabla sigue funcionando; solo no se recuerda al recargar.
    if (value) memoryStore.set(tableId, JSON.stringify(value));
    else memoryStore.delete(tableId);
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

const getServerSnapshot = () => null;

/**
 * Mezcla el orden recordado con las columnas que la tabla declara hoy: las
 * conocidas conservan su sitio, una columna nueva entra donde la declaró la
 * tabla (no al final, donde nadie la vería) y las que ya no existen se caen.
 */
export function reconcileOrder(stored: readonly string[], specIds: readonly string[]): string[] {
  const declared = new Set(specIds);
  const order = stored.filter((id, index) => declared.has(id) && stored.indexOf(id) === index);
  const known = new Set(order);

  specIds.forEach((id, natural) => {
    if (known.has(id)) return;
    const at = order.findIndex((other) => specIds.indexOf(other) > natural);
    order.splice(at === -1 ? order.length : at, 0, id);
  });

  return order;
}

export interface TableConfig {
  /** Las columnas movibles visibles, ya en el orden elegido. */
  columns: readonly TableColumnSpec[];
  /** Todas las movibles —visibles y ocultas—, para el panel. */
  movableColumns: readonly TableColumnSpec[];
  /** Las que nunca se mueven ni se ocultan. */
  fixedColumns: readonly TableColumnSpec[];
  /** Los ids movibles en el orden elegido (incluye las ocultas). */
  order: readonly string[];
  hidden: ReadonlySet<string>;
  hiddenCount: number;
  /** Las columnas que se quedan quietas mientras la tabla se desplaza de lado. */
  pinned: ReadonlySet<string>;
  /** Los ids fijados visibles, en orden. */
  pinnedOrder: readonly string[];
  mode: TableRowsMode;
  isLazy: boolean;
  view: TableView;
  rowControl: TableRowControl;
  pageSize: number;
  /** Cierto cuando algo se salió de fábrica: enciende el punto del botón. */
  isDirty: boolean;
  setMode: (mode: TableRowsMode) => void;
  setView: (view: TableView) => void;
  setRowControl: (rowControl: TableRowControl) => void;
  setPageSize: (pageSize: number) => void;
  toggleVisibility: (id: string) => void;
  togglePin: (id: string) => void;
  showAllColumns: () => void;
  /** Mueve `sourceId` justo antes o después de `targetId`. */
  moveColumn: (sourceId: string, targetId: string, before: boolean) => void;
  reset: () => void;
}

export interface UseTableConfigOptions {
  defaultMode?: TableRowsMode;
  defaultPageSize?: number;
}

const FALLBACK_PAGE_SIZE = 20;

/**
 * useTableConfig
 *
 * @param tableId Único por tabla: es la llave con la que se recuerda
 *   (`sellup:table:<tableId>`). Sin él la tabla funciona igual pero no
 *   recuerda nada al recargar.
 *
 * @example
 * const config = useTableConfig("accounts", [
 *   { id: "select", label: "Selección", fixed: true },
 *   { id: "name", label: "Empresa", hideable: false },
 *   { id: "country", label: "País" },
 * ]);
 */
export function useTableConfig(
  tableId: string | undefined,
  columns: readonly TableColumnSpec[],
  options?: UseTableConfigOptions,
): TableConfig {
  const defaultMode = options?.defaultMode ?? DEFAULT_ROWS_MODE;
  const defaultPageSize = options?.defaultPageSize ?? FALLBACK_PAGE_SIZE;

  const getSnapshot = React.useCallback(() => (tableId ? readSnapshot(tableId) : null), [tableId]);
  const stored = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [local, setLocal] = React.useState<StoredTableConfig | null>(null);
  const saved: Partial<StoredTableConfig> | null = tableId ? stored : local;

  const fixedColumns = React.useMemo(() => columns.filter((column) => column.fixed), [columns]);
  const movableSpecs = React.useMemo(() => columns.filter((column) => !column.fixed), [columns]);
  const specById = React.useMemo(
    () => new Map(movableSpecs.map((column) => [column.id, column])),
    [movableSpecs],
  );
  const specIds = React.useMemo(() => movableSpecs.map((column) => column.id), [movableSpecs]);
  const defaultHidden = React.useMemo(
    () =>
      movableSpecs
        .filter((column) => column.hiddenByDefault && column.hideable !== false)
        .map((column) => column.id),
    [movableSpecs],
  );

  const state: StoredTableConfig = React.useMemo(() => {
    const canHide = (id: string) => {
      const spec = specById.get(id);
      return spec !== undefined && spec.hideable !== false;
    };
    // Una columna que la tabla estrena después de que la persona guardó su
    // configuración no está en su `order` guardado: si arranca oculta, se
    // respeta eso en vez de aparecerle de golpe en la tabla.
    const savedOrder = saved?.order;
    const unseenDefaultHidden = savedOrder
      ? defaultHidden.filter((id) => !savedOrder.includes(id))
      : [];
    const hidden = (saved?.hidden ? [...saved.hidden, ...unseenDefaultHidden] : defaultHidden).filter(
      (id, index, all) => canHide(id) && all.indexOf(id) === index,
    );
    return {
      order: reconcileOrder(saved?.order ?? [], specIds),
      hidden,
      pinned: (saved?.pinned ?? []).filter((id) => specById.has(id) && !hidden.includes(id)),
      mode: saved?.mode ?? defaultMode,
      view: saved?.view ?? DEFAULT_TABLE_VIEW,
      rowControl: saved?.rowControl ?? DEFAULT_ROW_CONTROL,
      pageSize: saved?.pageSize ?? null,
    };
  }, [saved, defaultHidden, defaultMode, specById, specIds]);

  const commit = React.useCallback(
    (next: StoredTableConfig | null) => {
      if (tableId) writeStored(tableId, next);
      else setLocal(next);
    },
    [tableId],
  );

  const hidden = React.useMemo(() => new Set(state.hidden), [state.hidden]);
  const pinned = React.useMemo(() => new Set(state.pinned), [state.pinned]);

  const movableColumns = React.useMemo(
    () =>
      state.order
        .map((id) => specById.get(id))
        .filter((column): column is TableColumnSpec => column !== undefined),
    [state.order, specById],
  );
  const visibleColumns = React.useMemo(
    () => movableColumns.filter((column) => !hidden.has(column.id)),
    [movableColumns, hidden],
  );
  const pinnedOrder = React.useMemo(
    () => visibleColumns.filter((column) => pinned.has(column.id)).map((column) => column.id),
    [visibleColumns, pinned],
  );

  const isDirty =
    state.mode !== defaultMode ||
    state.hidden.length !== defaultHidden.length ||
    !state.hidden.every((id) => defaultHidden.includes(id)) ||
    state.pinned.length > 0 ||
    !state.order.every((id, index) => id === specIds[index]) ||
    state.view !== DEFAULT_TABLE_VIEW ||
    state.rowControl !== DEFAULT_ROW_CONTROL ||
    (state.pageSize !== null && state.pageSize !== defaultPageSize);

  return {
    columns: visibleColumns,
    movableColumns,
    fixedColumns,
    order: state.order,
    hidden,
    hiddenCount: movableColumns.filter((column) => hidden.has(column.id)).length,
    pinned,
    pinnedOrder,
    mode: state.mode,
    isLazy: state.mode === "lazy",
    view: state.view,
    rowControl: state.rowControl,
    pageSize: state.pageSize ?? defaultPageSize,
    isDirty,
    setMode: (mode) => commit({ ...state, mode }),
    setView: (view) => commit({ ...state, view }),
    setRowControl: (rowControl) => commit({ ...state, rowControl }),
    setPageSize: (pageSize) => commit({ ...state, pageSize }),
    toggleVisibility: (id) => {
      const spec = specById.get(id);
      if (!spec || spec.hideable === false) return;
      commit({
        ...state,
        hidden: hidden.has(id) ? state.hidden.filter((other) => other !== id) : [...state.hidden, id],
        // Esconder una columna fijada la suelta: lo que no se ve no puede
        // quedarse quieto en ninguna parte.
        pinned: hidden.has(id) ? state.pinned : state.pinned.filter((other) => other !== id),
      });
    },
    togglePin: (id) => {
      if (!specById.has(id)) return;
      commit({
        ...state,
        pinned: pinned.has(id) ? state.pinned.filter((other) => other !== id) : [...state.pinned, id],
        // Y fijar una escondida la devuelve a la vista, por lo mismo.
        hidden: pinned.has(id) ? state.hidden : state.hidden.filter((other) => other !== id),
      });
    },
    showAllColumns: () => commit({ ...state, hidden: [] }),
    moveColumn: (sourceId, targetId, before) => {
      if (sourceId === targetId) return;
      const order = state.order.filter((id) => id !== sourceId);
      const at = order.indexOf(targetId);
      if (at === -1 || order.length === state.order.length) return;
      order.splice(before ? at : at + 1, 0, sourceId);
      commit({ ...state, order });
    },
    reset: () => commit(null),
  };
}
