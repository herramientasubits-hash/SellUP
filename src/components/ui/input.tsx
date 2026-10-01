import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

interface InputProps extends React.ComponentProps<"input"> {
  /**
   * Alto del campo. `default` (40px) es el de todo formulario; `sm` (32px) es
   * para barras de herramientas y buscadores dentro de una tabla o un popover.
   * Se llama `inputSize` porque `size` ya es un atributo nativo de `<input>`.
   */
  inputSize?: "default" | "sm";
}

function Input({ className, type, inputSize = "default", ...props }: InputProps) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-size={inputSize}
      className={cn(
        // El tamaño va como clases normales (no como variante data-*) para que
        // un `pl-8` de quien lo usa —el hueco de un icono— gane sin trucos.
        inputSize === "sm" ? "h-8 px-2.5 py-1 text-xs" : "h-10 px-3.5 py-2 text-sm",
        "w-full min-w-0 rounded-md border border-input bg-card text-foreground transition-all outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-muted dark:focus-visible:border-primary dark:focus-visible:ring-primary/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
