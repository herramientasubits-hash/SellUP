import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@/icons";
import { PageHeader } from "@/components/shared/page-header";
import { ShellBreadcrumbs } from "@/components/layout/shell-header-slot";
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
  /**
   * Cabecera en una sola banda: título, descripción y pestañas comparten
   * renglón y los huecos entre bloques se estrechan. Es la forma de las
   * pantallas de lista con pestañas de módulo, donde la cabecera alta dejaba a
   * la tabla sin filas. Por defecto, la cabecera de siempre (`PageHeader`).
   */
  compact?: boolean;
  /**
   * Deja que se desplace la PÁGINA (la caja de todo el ancho del shell) en vez de
   * una caja propia con alto fijo. Para pantallas de lista + detalle cuyo detalle
   * es largo: el detalle fluye con la página y la lista se queda pegada
   * (`sticky`) con su propio scroll. Sin esto habría dos barras de scroll
   * verticales anidadas.
   */
  pageScroll?: boolean;
  className?: string;
}

interface CompactHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  breadcrumbs?: ReactNode;
  tabs?: ReactNode;
}

/**
 * La cabecera compacta: una banda de la altura de las pestañas. El título y su
 * descripción van a la izquierda (la descripción en letra pequeña, hasta dos
 * renglones, sin recortar con puntos suspensivos en móvil) y las pestañas a la
 * derecha; en pantalla estrecha las pestañas bajan a su propio renglón.
 */
function CompactHeader({ title, description, actions, backHref, breadcrumbs, tabs }: CompactHeaderProps) {
  return (
    <header data-slot="page-header-compact" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
      {breadcrumbs && <ShellBreadcrumbs className="basis-full">{breadcrumbs}</ShellBreadcrumbs>}
      <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex shrink-0 items-center gap-2">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Volver"
              className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        </div>
        {description && (
          <p className="min-w-0 max-w-xl text-xs leading-snug text-muted-foreground sm:line-clamp-2">
            {description}
          </p>
        )}
      </div>
      {tabs && <div className="max-w-full shrink-0">{tabs}</div>}
      {/* `contents`: una barra flotante (portal) no deja aquí un hueco vacío. */}
      {actions && <div className="contents">{actions}</div>}
    </header>
  );
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
  compact = false,
  pageScroll = false,
  className,
}: DataTablePageProps) {
  return (
    // La página es su propia caja con scroll: en una pantalla alta no hace
    // falta (cabecera y métricas quedan fijas y la tabla llena el resto); en una
    // baja, la tabla conserva su alto mínimo y lo que se desplaza es la página,
    // en vez de aplastar la tabla a cuatro filas. El hueco inferior que reserva
    // `ListActionRailProvider` queda fuera de esta caja, así que la barra
    // flotante nunca tapa el pie. El margen negativo deja sitio a las sombras
    // y a los anillos de foco, que una caja con scroll recortaría.
    <div
      className={cn(
        pageScroll
          ? "flex shrink-0 flex-col pb-4"
          : "-mx-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-1",
        compact ? "gap-3" : "gap-5",
        className,
      )}
    >
      {compact ? (
        <CompactHeader
          title={title}
          description={description}
          actions={actions}
          backHref={backHref}
          breadcrumbs={breadcrumbs}
          tabs={tabs}
        />
      ) : (
        <>
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
        </>
      )}
      {metrics && <div className="shrink-0">{metrics}</div>}
      {/* La tabla ocupa todo el alto que queda, con un mínimo: el de la
          pantalla visible, hasta 32rem. */}
      <div className={pageScroll ? "flex flex-col" : "flex min-h-[min(100%,32rem)] flex-1 flex-col"}>{children}</div>
    </div>
  );
}
