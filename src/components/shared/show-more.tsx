"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ShowMoreProps<T> {
  items: readonly T[];
  /** Cuántos se ven siempre. */
  initial: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** La clase de la lista (se repite en la parte que se despliega). */
  listClassName?: string;
  /**
   * El aire entre los primeros y los que se despliegan, igual al de la lista
   * (`pt-1.5` para `space-y-1.5`). Va dentro del panel: fuera, aparecía de golpe.
   */
  tailGapClassName?: string;
  /** El botón plegado, con el total: «Ver todas (5)». */
  moreLabel: (total: number) => string;
  lessLabel?: string;
  className?: string;
}

/**
 * ShowMore — una lista larga que enseña los primeros `initial` y despliega el
 * resto con «Ver más». Lo que se suma entra con la altura animada (Collapsible)
 * en vez de aparecer de golpe, y al plegar vuelve a subir.
 *
 * Los primeros quedan fijos en su lista; el resto va en una segunda lista con
 * la misma clase, dentro del panel que se pliega. Todo el aire va dentro del
 * panel o en el botón, nunca como margen del panel: un margen no se anima.
 *
 * @example
 * <ShowMore
 *   items={needs}
 *   initial={3}
 *   listClassName="space-y-1.5"
 *   renderItem={(need) => <li key={need}>{need}</li>}
 *   moreLabel={(total) => `Ver todas (${total})`}
 * />
 */
export function ShowMore<T>({
  items,
  initial,
  renderItem,
  listClassName,
  tailGapClassName = "pt-1.5",
  moreLabel,
  lessLabel = "Ver menos",
  className,
}: ShowMoreProps<T>) {
  const [open, setOpen] = React.useState(false);
  const head = items.slice(0, initial);
  const tail = items.slice(initial);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <ul className={listClassName}>{head.map((item, index) => renderItem(item, index))}</ul>
      {tail.length > 0 && (
        <>
          <CollapsibleContent>
            <div className={tailGapClassName}>
              <ul className={listClassName}>{tail.map((item, index) => renderItem(item, initial + index))}</ul>
            </div>
          </CollapsibleContent>
          <CollapsibleTrigger render={<Button type="button" variant="link" size="xs" className="mt-2 px-0" />}>
            {open ? lessLabel : moreLabel(items.length)}
          </CollapsibleTrigger>
        </>
      )}
    </Collapsible>
  );
}
