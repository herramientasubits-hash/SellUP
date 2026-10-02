import type * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";

import type { TableRowsMode } from "@/components/data-display/use-table-config";
import type { DataTableContextMenuItem } from "./data-table-context-menu";

export interface DataTableBulkAction<TData> {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: "default" | "destructive";
  /** Ignored when `items` is set — a grouped action has no direct click target. */
  onClick?: (rows: TData[]) => void | Promise<void>;
  loading?: boolean;
  /**
   * Optional predicate evaluated with the currently selected rows. Return
   * `true` to disable the button (e.g. "Ver detalle" only valid with exactly
   * one selected row, "Abrir URLs" only when at least one row has a URL).
   */
  disabled?: (rows: TData[]) => boolean;
  /**
   * Optional tooltip copy shown while the button is disabled (e.g. "Aprobación
   * masiva pendiente" when more than one row is selected). Returning
   * `undefined` renders no tooltip.
   */
  disabledLabel?: (rows: TData[]) => string | undefined;
  confirm?: {
    title: string;
    description: (rows: TData[]) => string;
    confirmLabel?: string;
  };
  /**
   * When set, renders this action as a dropdown trigger instead of a button —
   * each entry is its own mini bulk action (own disabled/disabledLabel/onClick).
   * Used to group not-yet-available actions under a single "Más acciones"
   * menu, matching the side panel footer hierarchy.
   */
  items?: DataTableBulkAction<TData>[];
  /**
   * Con cuántas filas marcadas se ofrece: `["single"]` solo con una (editar,
   * ver detalle), `["bulk"]` solo con varias. Por defecto, con una y con
   * varias. Fuera de su ámbito la acción desaparece de la barra en vez de
   * quedarse apagada.
   */
  scope?: readonly ("single" | "bulk")[];
  /** Añade el recuento a la etiqueta cuando hay varias: «Archivar (3)». */
  countInLabel?: boolean;
}

export interface DataTableHandle {
  /** Clears the current row selection (and, with it, the rail goes back to the screen actions). */
  clearSelection: () => void;
}

export interface DataTableContextMenuConfig<TData> {
  items: (row: TData) => DataTableContextMenuItem[];
}


/** Lo que la tabla le cuenta a quien dibuja una fila de la vista «Lista». */
export interface DataTableListRowState {
  selected: boolean;
  toggle: () => void;
  /** La casilla de la fila, o `null` si se opera por menú. Va en `leading`. */
  checkbox: React.ReactNode;
  /** El menú de acciones de la fila, o `null` si se opera marcando. Va al final. */
  menu: React.ReactNode;
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];

  /** Required for stable selection / context menu keys. */
  getRowId: (row: TData) => string;

  /**
   * Identidad de la tabla. Con ella se recuerda en este navegador la
   * configuración de quien mira (`localStorage`, clave `sellup:table:<tableId>`):
   * orden de columnas, ocultas, fijadas, scroll infinito o paginación y tamaño
   * de página. Tiene que ser estable: si cambia, se
   * pierden los ajustes. Sin ella la tabla funciona igual pero no recuerda.
   */
  tableId?: string;
  /** Sustantivo en plural de lo que se lista: «empresas», «contactos». */
  noun?: string;
  /** Género del sustantivo: «3 seleccionadas» frente a «3 seleccionados». */
  nounGender?: "f" | "m";
  /** Cómo llegan las filas de fábrica. Por defecto, scroll infinito. */
  defaultRowsMode?: TableRowsMode;
  /** Cómo se nombra una fila en su menú de acciones («Acciones de <nombre>»). */
  getRowLabel?: (row: TData) => string;
  /**
   * El dibujo de una fila en la vista «Lista» (típicamente un `<ListItem>`).
   * Sin ella la tabla se queda siempre en rejilla y el panel no ofrece la vista.
   */
  renderListItem?: (row: TData, state: DataTableListRowState) => React.ReactNode;

  /** Title shown in the toolbar (e.g. "Listado de Cursos de Formación"). */
  title?: React.ReactNode;
  /** Description shown below the title. */
  description?: React.ReactNode;
  /** Right-aligned action buttons in the toolbar (CSV, New, etc). */
  actions?: React.ReactNode;
  /** Optional count badge next to the title. */
  count?: number;

  /**
   * Selection: enable checkbox column. Con filas marcadas, las `bulkActions`
   * sustituyen a las acciones de pantalla en la barra flotante (Foundation § 12).
   */
  enableRowSelection?: boolean;
  bulkActions?: DataTableBulkAction<TData>[];
  /**
   * Avisa de cuántas filas hay marcadas en la barra flotante cada vez que
   * cambia (con las acciones «En la pantalla» la selección no va a la barra,
   * así que informa 0). Solo informa: la barra de la pantalla ya recibe la
   * selección por su cuenta (`ListActionRailProvider`). Pásale una función
   * estable.
   */
  onSelectionCountChange?: (count: number) => void;

  /**
   * Right-click context menu per row. Son también las acciones del «Menú en
   * cada fila» cuando quien mira elige operar así.
   */
  contextMenu?: DataTableContextMenuConfig<TData>;

  /** Sticky header inside a scrollable container. */
  stickyHeader?: boolean;

  /** Tamaño de página (y tramo del scroll infinito) de fábrica. Default: 20. */
  initialPageSize?: number;
  pageSizeOptions?: number[];

  /** Enable column reordering via drag-and-drop on header cells. */
  enableColumnReorder?: boolean;
  /** Column ids that cannot be reordered, hidden or pinned (e.g. selection, actions). */
  pinnedColumnIds?: string[];

  /**
   * Enable row drag-and-drop. Adds a pinned "reorder" column on the left
   * with a grip handle; drag rows to reorder them. When enabled, the
   * table's internal sort is bypassed and the data is rendered in the
   * exact order provided — the parent is responsible for reordering the
   * data via `onRowReorder`.
   */
  enableRowReorder?: boolean;
  /** Called with the new data array after a successful row drop. */
  onRowReorder?: (newData: TData[]) => void;

  /** Server-side or external state control for sorting. */
  manualSorting?: boolean;
  manualFiltering?: boolean;

  /** Custom row click handler. Sin ella, picar en una fila la marca. */
  onRowClick?: (row: TData) => void;
  rowClickable?: boolean;

  /** Custom className for the wrapper. */
  className?: string;

  /** Optional empty state override. */
  emptyState?: React.ReactNode;

  /** Optional loading state (skeleton overlay). */
  loading?: boolean;

  /** Hide the toolbar entirely. */
  hideToolbar?: boolean;

  /**
   * Secciones propias de la pantalla dentro del panel «Configurar tabla»,
   * encima de las columnas (p. ej. filtros de alcance).
   */
  settingsExtraSections?: React.ReactNode;

  /**
   * Fill the parent's height and scroll the table internally (sticky thead
   * inside the scroll container). The parent must be a flex container with
   * a defined height (e.g. <DataTablePage>).
   */
  fillHeight?: boolean;
}
