import type { ReactNode } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

interface DataTablePageProps {
  /** Page title — renders via <PageHeader>. */
  title: string;
  /** Page description — renders via <PageHeader>. */
  description?: string;
  /** Action buttons rendered on the right of the page header. */
  actions?: ReactNode;
  /** Optional back link rendered before the title. */
  backHref?: string;
  /**
   * Optional module-level navigation (e.g. pill tabs) rendered directly under
   * the page header, above the metrics row. Stays fixed at the top.
   */
  tabs?: ReactNode;
  /**
   * Optional sticky row rendered between the page header and the table area
   * (e.g. metric cards, filters, status banner). Stays fixed at the top.
   */
  metrics?: ReactNode;
  /**
   * The scrollable content area. Typically a `<DataTable fillHeight />`,
   * but any node that benefits from filling the remaining viewport height
   * and scrolling internally works (e.g. long form, kanban board).
   */
  children: ReactNode;
  className?: string;
}

/**
 * DataTablePage — page-level layout for the "header + metrics fixed, table
 * scrolls internally" pattern.
 *
 * Wraps <PageHeader> (sticky), an optional metrics row (sticky), and a
 * `flex-1 min-h-0` content area for the table. Pair with
 * `<DataTable fillHeight />` so only the table rows scroll.
 *
 * **Requires a flex parent with a defined height** — AppShell's <main> is
 * already a flex column that fills the viewport, so most pages just need
 * to return `<DataTablePage>...</DataTablePage>` at the root.
 *
 * @example
 * ```tsx
 * <DataTablePage
 *   title="Catálogo de fuentes"
 *   description="Vista operativa de las fuentes de datos."
 *   backHref="/settings"
 *   actions={<Button>Nueva fuente</Button>}
 *   metrics={<MetricsRow cards={...} />}
 * >
 *   <DataTable fillHeight columns={cols} data={rows} ... />
 * </DataTablePage>
 * ```
 *
 * @see /docs/DESIGN_SYSTEM_FOUNDATION.md § 15 — Scroll interno de tabla
 */
export function DataTablePage({
  title,
  description,
  actions,
  backHref,
  tabs,
  metrics,
  children,
  className,
}: DataTablePageProps) {
  return (
    <div className={cn("flex flex-1 min-h-0 flex-col gap-6", className)}>
      <div className="shrink-0">
        <PageHeader
          title={title}
          description={description}
          actions={actions}
          backHref={backHref}
        />
      </div>
      {tabs && <div className="shrink-0">{tabs}</div>}
      {metrics && <div className="shrink-0">{metrics}</div>}
      <div className="flex flex-1 min-h-0 flex-col">{children}</div>
    </div>
  );
}
