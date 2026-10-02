import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@/icons";
import { cn } from "@/lib/utils";
import { Heading, Text } from "@/components/typography";
import { ShellBreadcrumbs } from "@/components/layout/shell-header-slot";
import { PAGE_WIDTH_CLASSES, type PageWidth } from "@/components/layout/page-shell";

interface PageHeaderProps {
  title: string;
  description?: string;
  /**
   * Las migas de la pantalla (`<Breadcrumbs items={…} />`). Dentro de la app
   * se publican en la cabecera del shell, junto a «SellUp › sección»; no
   * ocupan un renglón sobre el título.
   */
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
  backHref?: string;
  /**
   * Ancho máximo de la cabecera, cuando la página estrecha su contenido sin
   * envolverse en `PageShell`: `narrow` 720 · `normal` 1140 · `wide` 1600 ·
   * `full`. Sin valor, ocupa el ancho que le dé su contenedor.
   */
  width?: PageWidth;
}

/**
 * PageHeader — port de Thema `utility/PageHeader.tsx`.
 *
 * La cabecera de una pantalla: título, descripción, acciones (una sola
 * primaria) y metadatos. La ubicación la dice la cabecera del shell: aquí solo
 * se le pasan las `breadcrumbs`.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  className,
  backHref,
  width,
}: PageHeaderProps) {
  return (
    <header
      data-width={width}
      className={cn(
        "flex flex-col gap-3 pb-6",
        width && "mx-auto w-full",
        width && PAGE_WIDTH_CLASSES[width],
        className,
      )}
    >
      {/* Las migas se publican en la cabecera del shell; fuera de él, quedan aquí. */}
      {breadcrumbs && <ShellBreadcrumbs>{breadcrumbs}</ShellBreadcrumbs>}

      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            {backHref && (
              <Link
                href={backHref}
                aria-label="Volver"
                className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
            )}
            <Heading level={3} as="h1" weight="bold">
              {title}
            </Heading>
          </div>
          {description && (
            <Text as="p" tone="secondary" className="max-w-3xl leading-relaxed">
              {description}
            </Text>
          )}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      {meta && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {meta}
        </div>
      )}
    </header>
  );
}
