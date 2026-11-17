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
  /**
   * Qué embudo lleva la columna (ver `data-table-filters.ts`):
   * - `options` (por defecto): casillas con los valores, tramos o «tiene / no tiene».
   * - `text`: «contiene» y «con dato / sin dato» (nombres, cargos, dominios).
   * - `date`: rango, atajos y «sin fecha».
   */
  filterVariant?: "options" | "text" | "date";
  /** Fechas: atajos de fechas pasadas (por defecto) o por venir. */
  datePresets?: "past" | "future";
  /**
   * Casillas sobre una clave calculada a partir de la celda (tramos de un
   * número, «tiene / no tiene»). La usan el recuento de cada opción y el filtro.
   */
  filterKey?: (value: unknown) => string;
  /**
   * Casillas con los valores de la columna aunque pasen de 50 (empresas,
   * departamentos): el embudo trae buscador.
   */
  unboundedFacets?: boolean;
  /** Columna sin orden: la etiqueta es texto, no un botón. */
  disableSort?: boolean;
  /**
   * Cómo se lee en el chip de «filtros activos» un filtro que no es una lista
   * de valores (p. ej. un rango de fechas).
   */
  filterChipLabel?: (value: unknown) => string;
  /**
   * El objeto al que pertenece el dato («Contacto», «Empresa»…). En «Configurar
   * tabla» las columnas con grupo se listan bajo su encabezado; sin grupo van
   * arriba, como siempre.
   */
  group?: string;
  /** Arranca oculta: se pide desde «Configurar tabla». */
  hiddenByDefault?: boolean;
  /** @deprecated Sin efecto: el embudo siempre es de selección múltiple. */
  enableMultiSelectFilter?: boolean;
  /** @deprecated Sin efecto: el buscador del embudo aparece solo con más de 8 opciones. */
  disablePopoverSearch?: boolean;
};

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
  interface ColumnMeta<TData extends RowData, TValue> extends DataTableColumnMeta {}
}
