"use client";

import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

import { cn } from "@/lib/utils";

/**
 * Collapsible — port de Thema `ui/collapsible` sobre `@base-ui/react`.
 *
 * Un bloque que se pliega: el disparador es un botón de verdad
 * (`aria-expanded`, `aria-controls`) y el panel se anuncia. Sustituye al
 * `<details>` a mano. Para varios bloques que se excluyen entre sí, `Accordion`.
 *
 * El panel anima su altura: el padding va en un hijo, no en
 * `CollapsibleContent`, o el cierre se frena en la altura del padding.
 *
 * @example
 * <Collapsible>
 *   <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>Detalles técnicos</CollapsibleTrigger>
 *   <CollapsibleContent>…</CollapsibleContent>
 * </Collapsible>
 */
function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Panel>) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        // Como flux-ui: la altura viaja de 0 a la del contenido (Base UI la deja
        // en --collapsible-panel-height) al abrir y al cerrar, así lo de abajo
        // se desliza en vez de saltar.
        "h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-starting-style:h-0 data-starting-style:opacity-0 data-ending-style:h-0 data-ending-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
