import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Frame — un marco tenue que envuelve uno o varios paneles blancos.
 *
 * Es el patrón de la referencia de UX (Playground UX · «Frame»): la franja gris
 * de fuera agrupa lo que va junto (una tira de métricas, una tabla con su
 * barra de herramientas, el detalle de un registro) y el panel de dentro es la
 * superficie de trabajo. El resultado se lee como UNA pieza aunque tenga
 * cabecera, cuerpo y pie, y deja de verse como tarjetas sueltas apiladas.
 *
 * Anatomía:
 *
 *   <Frame>
 *     <FrameHeader title="Tareas" description="12 tareas" actions={…} />
 *     <FramePanel>…</FramePanel>
 *     <FrameFooter>…</FrameFooter>
 *   </Frame>
 *
 * Radios del sistema (§ 5): el marco es una tarjeta de página (`rounded-2xl`)
 * y el panel va anidado (`rounded-xl`). Sombra solo en el panel: es lo que
 * está «encima».
 */
export function Frame({
  children,
  className,
}: {
  children: ReactNode;
  /** Solo layout (ancho, alto, `flex-1 min-h-0`…). Nunca color ni borde. */
  className?: string;
}) {
  return (
    <div
      data-slot="frame"
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-2xl border border-border/60 bg-surface-muted/60 p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * La cabecera del marco: va sobre la franja gris, fuera del panel, como en la
 * referencia. Título y descripción a la izquierda; acciones a la derecha.
 */
export function FrameHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="frame-header"
      className={cn("flex flex-wrap items-center justify-between gap-3 px-3 pt-2 pb-1.5", className)}
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** La superficie de trabajo, dentro del marco. */
export function FramePanel({
  children,
  className,
  noPadding = false,
}: {
  children: ReactNode;
  /** Solo layout. Nunca color ni borde. */
  className?: string;
  /** Sin padding interno: tablas, listas con divisorias de borde a borde. */
  noPadding?: boolean;
}) {
  return (
    <div
      data-slot="frame-panel"
      className={cn(
        "relative min-w-0 grow overflow-hidden rounded-xl border border-border/60 bg-card shadow-card",
        !noPadding && "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** El pie del marco: una nota o un enlace bajo el panel, sobre la franja gris. */
export function FrameFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="frame-footer"
      className={cn("flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground", className)}
    >
      {children}
    </div>
  );
}
