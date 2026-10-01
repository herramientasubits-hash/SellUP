import type { ElementType } from "react";
import { cn } from "@/lib/utils";

interface ModulePlaceholderProps {
  /** Qué parte está a medio hacer: «Tablero de pipeline». */
  module: string;
  /** Qué falta y qué puede hacer la persona mientras tanto, en una frase. */
  description: string;
  icon?: ElementType;
  className?: string;
}

/**
 * ModulePlaceholder — la nota de «en construcción» de un módulo.
 *
 * Es una línea discreta al pie de la pantalla, no una tarjeta: avisa de que
 * algo todavía no está, sin quitarle el sitio a lo que sí funciona. Nada de
 * listas de «capacidades previstas»: a quien usa la pantalla le sirve saber
 * qué puede hacer hoy, no el plan del producto.
 *
 * @example
 * <ModulePlaceholder
 *   module="Tablero de pipeline"
 *   description="Pronto podrás mover las cuentas entre etapas desde aquí."
 * />
 */
export function ModulePlaceholder({
  module,
  description,
  icon: Icon,
  className,
}: ModulePlaceholderProps) {
  return (
    <aside
      role="note"
      aria-label={`${module}: en construcción`}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-surface-muted px-2.5 py-1 font-semibold text-muted-foreground">
        {Icon ? (
          <Icon aria-hidden className="size-3.5 text-primary" />
        ) : (
          <span aria-hidden className="size-1.5 rounded-full bg-primary/60 animate-su-pulse" />
        )}
        En construcción
      </span>
      <p className="min-w-0 leading-relaxed">
        <span className="font-medium text-foreground">{module}.</span> {description}
      </p>
    </aside>
  );
}
