import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Los anchos de página de Thema (`layout/PageShell`):
 *
 * - `narrow` · 720px: formularios y asistentes, donde una línea larga cansa.
 * - `normal` · 1140px: la mayoría de las pantallas de lectura y detalle.
 * - `wide` · 1440px: tablas y tableros. Es el ancho que ya da `AppShell`.
 * - `full`: sin tope (un lienzo, un tablero kanban ancho).
 */
export type PageWidth = "narrow" | "normal" | "wide" | "full";

export const PAGE_WIDTH_CLASSES: Readonly<Record<PageWidth, string>> = {
  narrow: "max-w-180",
  normal: "max-w-285",
  wide: "max-w-360",
  full: "max-w-none",
};

export interface PageShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Ancho máximo del contenido. Por defecto `wide`, el del shell. */
  width?: PageWidth;
}

/**
 * PageShell — port de Thema `layout/PageShell.tsx`.
 *
 * El contenedor de una página: centra el contenido y le pone uno de los cuatro
 * anchos del sistema. Va dentro de `AppShell` (que ya da márgenes y el tope de
 * 1440px), así que solo ESTRECHA: una pantalla de formulario pide `narrow` en
 * vez de inventarse su `max-w-…`.
 *
 * Es una columna flex que llena el alto, así que `DataTablePage` sigue
 * funcionando dentro.
 *
 * @example
 * <PageShell width="narrow">
 *   <PageHeader title="Nueva regla" />
 *   <form>…</form>
 * </PageShell>
 */
export function PageShell({ width = "wide", className, ...props }: PageShellProps) {
  return (
    <div
      data-slot="page-shell"
      data-width={width}
      className={cn(
        "mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col",
        PAGE_WIDTH_CLASSES[width],
        className,
      )}
      {...props}
    />
  );
}
