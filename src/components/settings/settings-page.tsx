import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { SurfaceCard } from "@/components/shared/surface-card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/navigation/breadcrumbs";

export type SettingsTrail = readonly (string | BreadcrumbItem)[];

interface SettingsPageProps {
  title: string;
  description?: string;
  /**
   * El camino DENTRO de la sección, solo para pantallas anidadas:
   * `[{ label: "Integraciones comerciales", href: "/settings/integrations" }]`.
   * La página actual se añade sola al final. Una sección de primer nivel no
   * lleva migas: la barra superior ya dice «SellUp › Configuración» y la
   * navegación lateral marca en cuál se está.
   */
  trail?: SettingsTrail;
  /** Acciones de la pantalla. Una sola primaria. */
  actions?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Las migas de una pantalla anidada de Configuración, o nada si es de primer nivel. */
export function settingsBreadcrumbs(trail: SettingsTrail | undefined, title: string): ReactNode {
  if (!trail || trail.length === 0) return undefined;
  return <Breadcrumbs items={[...trail, title]} />;
}

/**
 * SettingsPage — la cabecera y el contenedor de toda pantalla de Configuración.
 *
 * Existe para que las subpáginas dejen de decidir cada una su ancho, sus
 * márgenes y cuántas formas de «volver» pintan: el ancho es el de la columna de
 * contenido (el mismo en todas), el ritmo vertical es uno, y la ubicación se
 * dice una sola vez. No hay flecha de volver: para eso están las migas (en las
 * anidadas) y la navegación lateral.
 *
 * Las pantallas con una tabla que llena el alto usan `DataTablePage` con las
 * mismas reglas (sin `backHref`, migas con `settingsBreadcrumbs`).
 *
 * @example
 * <SettingsPage
 *   title="HubSpot"
 *   description="Sincroniza empresas y contactos con tu CRM."
 *   trail={[{ label: "Integraciones comerciales", href: "/settings/integrations" }]}
 * >
 *   …
 * </SettingsPage>
 */
export function SettingsPage({
  title,
  description,
  trail,
  actions,
  meta,
  children,
  className,
}: SettingsPageProps) {
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-6", className)}>
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={settingsBreadcrumbs(trail, title)}
        actions={actions}
        meta={meta}
      />
      {children}
    </div>
  );
}

interface TechnicalDetailsProps {
  /** Qué hay dentro, en una frase: ayuda a decidir si abrirlo. */
  summary?: string;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * TechnicalDetails — la sección plegada «Detalles técnicos» de una pantalla de
 * Configuración. Guarda lo que solo le sirve a quien da soporte (identificadores,
 * permisos concedidos, nombres internos) fuera de la vista de quien solo quiere
 * saber si algo funciona.
 *
 * Es un `Collapsible` dentro de una `SurfaceCard`: el disparador es un botón
 * de verdad (se abre con teclado y anuncia si está abierto) y el contenido
 * plegado sigue apareciendo al buscar en la página.
 */
export function TechnicalDetails({
  title = "Detalles técnicos",
  summary,
  children,
  className,
}: TechnicalDetailsProps) {
  return (
    <SurfaceCard noPadding className={className}>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl px-6 py-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            {summary && (
              <span className="mt-0.5 block text-xs text-muted-foreground">{summary}</span>
            )}
          </span>
          <span className="shrink-0 text-xs font-medium text-primary group-data-[panel-open]:hidden">
            Ver
          </span>
          <span className="hidden shrink-0 text-xs font-medium text-primary group-data-[panel-open]:inline">
            Ocultar
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent hiddenUntilFound>
          <div className="space-y-4 border-t border-border/60 px-6 py-5">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </SurfaceCard>
  );
}
