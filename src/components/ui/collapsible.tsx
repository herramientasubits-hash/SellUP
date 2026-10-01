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
        "overflow-hidden data-open:animate-su-fade-in motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
