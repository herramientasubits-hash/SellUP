import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Escala de títulos del sistema. Cada nivel fija tamaño e interlínea; la
 * etiqueta HTML sale del nivel (`h2` para `level={2}`) salvo que `as` diga
 * otra cosa, para que la jerarquía semántica y la visual no se separen.
 *
 * Se usan las clases estándar de Tailwind donde coinciden con la escala
 * (36, 30, 24, 20, 18, 16) y solo se ajusta la interlínea donde la escala
 * Thema difiere del valor por defecto. La familia es la del producto (Inter):
 * SellUp no tiene una fuente de títulos aparte.
 */
const headingVariants = cva("tracking-tight", {
  variants: {
    level: {
      1: "text-4xl leading-11 lg:text-5xl lg:leading-14",
      2: "text-3xl leading-9.5",
      3: "text-2xl leading-8",
      4: "text-xl leading-7",
      5: "text-lg leading-6.5",
      6: "text-base leading-6",
    },
    weight: {
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
    },
    tone: {
      default: "text-foreground",
      muted: "text-text-muted",
      /** Sobre una superficie primaria (`bg-primary`). */
      inverse: "text-primary-foreground",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
  },
  defaultVariants: {
    weight: "semibold",
    tone: "default",
    truncate: false,
  },
});

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingWeight = NonNullable<VariantProps<typeof headingVariants>["weight"]>;
export type HeadingTone = NonNullable<VariantProps<typeof headingVariants>["tone"]>;

type HeadingTag = `h${HeadingLevel}`;

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Nivel de la jerarquía. Fija tamaño, interlínea y la etiqueta por defecto. */
  level: HeadingLevel;
  /** Etiqueta a renderizar cuando la semántica del documento no coincide con el nivel visual. */
  as?: keyof React.JSX.IntrinsicElements;
  weight?: HeadingWeight;
  tone?: HeadingTone;
  /** Una sola línea con elipsis; el contenedor tiene que acotar el ancho. */
  truncate?: boolean;
}

/**
 * Heading
 *
 * Título con la escala del sistema.
 *
 * @example
 * <Heading level={2}>Cuentas</Heading>
 * <Heading level={6} as="h2" tone="muted">Actividad reciente</Heading>
 */
function Heading({ level, as, weight, tone, truncate, className, ...props }: HeadingProps) {
  const headingTag: HeadingTag = `h${level}`;
  const Comp = (as ?? headingTag) as React.ElementType;
  return (
    <Comp
      data-slot="heading"
      data-level={level}
      className={cn(headingVariants({ level, weight, tone, truncate }), className)}
      {...props}
    />
  );
}

export { Heading, headingVariants };
