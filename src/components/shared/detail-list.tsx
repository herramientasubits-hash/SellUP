import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DetailListColumns = 2 | 3 | 4;

const COLUMNS: Record<DetailListColumns, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

interface DetailListProps {
  /** Columnas cuando hay ancho. En móvil siempre es una. */
  columns?: DetailListColumns;
  /** Cómo se anuncia la lista cuando no tiene un título visible encima. */
  "aria-label"?: string;
  className?: string;
  children: ReactNode;
}

/**
 * DetailList — los pares etiqueta/valor de una ficha, como lista de
 * definiciones (`dl`): una columna en móvil y dos o más cuando hay ancho.
 *
 * Es la pieza con la que se arma el resumen de una página de detalle (empresa,
 * contacto): la etiqueta apagada arriba, el dato debajo. No pinta superficie:
 * vive dentro de la tarjeta de su sección, nunca como una caja dentro de otra.
 *
 * @example
 * <DetailList>
 *   <DetailItem icon={Globe} label="Sitio web">acme.com</DetailItem>
 *   <DetailItem label="Responsable">{owner}</DetailItem>
 * </DetailList>
 */
export function DetailList({
  columns = 2,
  className,
  children,
  "aria-label": ariaLabel,
}: DetailListProps) {
  return (
    <dl aria-label={ariaLabel} className={cn("grid grid-cols-1 gap-x-6 gap-y-4", COLUMNS[columns], className)}>
      {children}
    </dl>
  );
}

interface DetailItemProps {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** El dato. Vacío (`null`, `undefined`, `""`) se lee como «Sin dato». */
  children?: ReactNode;
  /** Qué decir cuando no hay dato. */
  emptyLabel?: string;
  className?: string;
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === false || value === "";
}

/** Un par etiqueta/valor de `DetailList`. */
export function DetailItem({
  label,
  icon: Icon,
  children,
  emptyLabel = "Sin dato",
  className,
}: DetailItemProps) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2.5", className)}>
      {Icon && (
        <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
          <Icon className="size-3.5 text-text-muted" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-foreground">
          {isEmpty(children) ? <span className="text-text-muted">{emptyLabel}</span> : children}
        </dd>
      </div>
    </div>
  );
}
