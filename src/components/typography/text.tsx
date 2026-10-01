import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Texto de interfaz y de lectura. `size`, `weight` y `tone` son los ejes
 * base; `variant` es un atajo que fija una combinación habitual (lead,
 * caption, code…). Cualquier eje pasado de forma explícita gana al preset
 * del variant, así `variant="caption" tone="negative"` sigue siendo 12px
 * pero en rojo.
 */
const textVariants = cva("", {
  variants: {
    size: {
      xs: "text-xs leading-4",
      sm: "text-sm leading-5",
      base: "text-base leading-6",
      lg: "text-lg leading-7",
      xl: "text-xl leading-7",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    tone: {
      default: "text-foreground",
      secondary: "text-muted-foreground",
      muted: "text-text-muted",
      /** Sobre una superficie primaria (`bg-primary`). */
      inverse: "text-primary-foreground",
      primary: "text-primary",
      positive: "text-success",
      negative: "text-destructive",
      warning: "text-warning",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
    tabular: {
      true: "tabular-nums",
      false: "",
    },
  },
  defaultVariants: {
    size: "sm",
    weight: "normal",
    tone: "default",
    truncate: false,
    tabular: false,
  },
});

export type TextSize = NonNullable<VariantProps<typeof textVariants>["size"]>;
export type TextWeight = NonNullable<VariantProps<typeof textVariants>["weight"]>;
export type TextTone = NonNullable<VariantProps<typeof textVariants>["tone"]>;
export type TextVariant = "body" | "lead" | "muted" | "small" | "label" | "caption" | "code";

interface TextPreset {
  size?: TextSize;
  weight?: TextWeight;
  tone?: TextTone;
  /** Etiqueta por defecto cuando el variant pide una distinta de `p`. */
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}

/** Combinaciones listas. Un eje explícito en las props siempre gana a lo que fija aquí el variant. */
const TEXT_PRESETS: Record<TextVariant, TextPreset> = {
  body: {},
  lead: { size: "base", tone: "secondary", className: "leading-relaxed" },
  muted: { size: "sm", tone: "muted" },
  small: { size: "xs", weight: "medium" },
  label: { size: "sm", weight: "medium", tone: "default" },
  caption: { size: "xs", tone: "muted" },
  code: { size: "xs", as: "span", className: "font-mono rounded-xs bg-surface-subtle px-1" },
};

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  size?: TextSize;
  weight?: TextWeight;
  tone?: TextTone;
  /** Atajo de tamaño, peso y tono; los ejes explícitos lo sobreescriben. */
  variant?: TextVariant;
  /** Etiqueta a renderizar. `p` por defecto; `span` para `variant="code"`. */
  as?: keyof React.JSX.IntrinsicElements;
  /** Una sola línea con elipsis; el contenedor tiene que acotar el ancho. */
  truncate?: boolean;
  /** Cifras de ancho fijo para columnas de números y KPIs. */
  tabular?: boolean;
}

/**
 * Text
 *
 * @example
 * <Text variant="lead">Empresas que encajan con tu perfil de cliente ideal.</Text>
 * <Text variant="caption" tone="negative">El NIT no coincide.</Text>
 * <Text as="span" tabular weight="semibold">1.284</Text>
 */
function Text({ size, weight, tone, variant = "body", as, truncate, tabular, className, ...props }: TextProps) {
  const preset = TEXT_PRESETS[variant];
  const Comp = (as ?? preset.as ?? "p") as React.ElementType;
  return (
    <Comp
      data-slot="text"
      data-variant={variant}
      className={cn(
        textVariants({
          size: size ?? preset.size,
          weight: weight ?? preset.weight,
          tone: tone ?? preset.tone,
          truncate,
          tabular,
        }),
        preset.className,
        className,
      )}
      {...props}
    />
  );
}

export { Text, textVariants };
