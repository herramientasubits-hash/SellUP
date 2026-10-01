import type * as React from "react";
import type { RowData } from "@tanstack/react-table";

export interface DataTableColumnFilterOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export type DataTableColumnMeta = {
  /** Cómo se nombra la columna en «Configurar tabla» y en los chips de filtro. */
  label?: string;
  /**
   * Cómo se nombra lo que filtra el embudo cuando no es el título de la
   * columna («Filtrar por <popoverTitle>»). Por defecto, el título.
   */
  popoverTitle?: string;
  /**
   * Opciones del embudo (lo preferible para valores conocidos: estado, país,
   * fuente…). Sin ellas el embudo ofrece los valores únicos de la columna,
   * siempre que sean pocos.
   */
  filterOptions?: DataTableColumnFilterOption[];
  /** Columna solo ordenable (número, fecha) o de texto libre: sin embudo. */
  disableFilter?: boolean;
  /** Columna sin orden: la etiqueta es texto, no un botón. */
  disableSort?: boolean;
  /**
   * Cómo se lee en el chip de «filtros activos» un filtro que no es una lista
   * de valores (p. ej. un rango de fechas).
   */
  filterChipLabel?: (value: unknown) => string;
  /** @deprecated Sin efecto: el embudo siempre es de selección múltiple. */
  enableMultiSelectFilter?: boolean;
  /** @deprecated Sin efecto: el buscador del embudo aparece solo con más de 8 opciones. */
  disablePopoverSearch?: boolean;
};

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface ColumnMeta<TData extends RowData, TValue> extends DataTableColumnMeta {}
}
