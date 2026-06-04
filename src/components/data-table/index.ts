/**
 * DataTable system — composable data table built on TanStack Table v8.
 *
 * @see /docs/DESIGN_SYSTEM_FOUNDATION.md § "DataTable system"
 *
 * Barrel exports.
 */

export { DataTable } from "./data-table";
export type {
  DataTableDensity,
  DataTableBulkAction,
  DataTableContextMenuConfig,
} from "./data-table";
export { DataTableColumnHeader } from "./data-table-column-header";
export { DataTableToolbar } from "./data-table-toolbar";
export { DataTablePagination } from "./data-table-pagination";
export {
  DataTableFacetedFilter,
  type DataTableFacetedFilterOption,
} from "./data-table-faceted-filter";
export { DataTableViewOptions } from "./data-table-view-options";
export { DataTableRowActions } from "./data-table-row-actions";
export { DataTableBulkActions } from "./data-table-bulk-actions";
export { DataTableDensityToggle } from "./data-table-density-toggle";
export {
  DataTableContextMenu,
  type DataTableContextMenuItem,
} from "./data-table-context-menu";
