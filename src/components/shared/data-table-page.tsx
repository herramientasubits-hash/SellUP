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
  /** Migas sobre el título (típicamente `<Breadcrumbs items={…} />`). */
  breadcrumbs?: ReactNode;
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
 * Wraps <PageHeader>, an optional metrics row, and a `flex-1` content area
 * for the table. Pair with `<DataTable fillHeight />` so only the table rows
 * scroll.
 *
 * En pantallas altas la cabecera y las métricas quedan fijas y la tabla llena
 * el resto. En pantallas bajas la tabla no baja de su alto mínimo
 * (`min(100%, 32rem)`): la página se desplaza y la tabla sigue con su scroll
 * interno y su cabecera pegada.
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
  breadcrumbs,
  tabs,
  metrics,
  children,
  className,
}: DataTablePageProps) {
  return (
    // La página es su propia caja con scroll: en una pantalla alta no hace
    // falta (cabecera y métricas quedan fijas y la tabla llena el resto); en una
    // baja, la tabla conserva su alto mínimo y lo que se desplaza es la página,
    // en vez de aplastar la tabla a cuatro filas. El hueco inferior que reserva
    // `ScreenActionRailProvider` queda fuera de esta caja, así que la barra
    // flotante nunca tapa el pie. El margen negativo deja sitio a las sombras
    // y a los anillos de foco, que una caja con scroll recortaría.
    <div
      className={cn(
        "-mx-3 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-1",
        className,
      )}
    >
      <div className="shrink-0">
        <PageHeader
          title={title}
          description={description}
          actions={actions}
          backHref={backHref}
          breadcrumbs={breadcrumbs}
        />
      </div>
      {tabs && <div className="shrink-0">{tabs}</div>}
      {metrics && <div className="shrink-0">{metrics}</div>}
      {/* La tabla ocupa todo el alto que queda, con un mínimo: el de la
          pantalla visible, hasta 32rem. */}
      <div className="flex min-h-[min(100%,32rem)] flex-1 flex-col">{children}</div>
    </div>
  );
}
