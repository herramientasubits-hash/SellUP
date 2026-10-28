import type { ReactNode } from "react";
import { Info } from "@/icons";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Frame, FrameHeader, FramePanel } from "./frame";

/** Una cifra de la fila. */
export interface MetricStripItem {
  /** Qué se mide: «Costo estimado», «Por revisar»… */
  label: string;
  value: ReactNode;
  /** La línea gris de abajo: contra qué se compara o qué significa. */
  description?: ReactNode;
  /** La ayuda del «i» junto al nombre. */
  hint?: string;
  /** Algo junto a la cifra: una insignia «Requiere atención», un «+12 %». */
  aside?: ReactNode;
  /** La cifra se pulsa para ver su detalle (p. ej. elegir un agente). */
  onSelect?: () => void;
  /** Con `onSelect`: es la elegida. */
  pressed?: boolean;
  /** Con `onSelect`: lo que dice el botón a quien no ve la pantalla. */
  selectLabel?: string;
}

interface MetricStripProps {
  items: readonly MetricStripItem[];
  /** Con título, la fila va con su cabecera en el gris del marco («Cómo va tu base»). */
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  "aria-label"?: string;
}

/** Columnas por cantidad de cifras; la línea divisoria sólo cuando caben todas en una fila. */
const LAYOUT: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2 sm:gap-0 sm:divide-x sm:[&>div]:px-5 sm:[&>div:first-child]:ps-0 sm:[&>div:last-child]:pe-0",
  3: "sm:grid-cols-3 sm:gap-0 sm:divide-x sm:[&>div]:px-5 sm:[&>div:first-child]:ps-0 sm:[&>div:last-child]:pe-0",
  4: "sm:grid-cols-2 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:[&>div]:px-5 lg:[&>div:first-child]:ps-0 lg:[&>div:last-child]:pe-0",
  5: "sm:grid-cols-3 lg:grid-cols-5 lg:gap-0 lg:divide-x lg:[&>div]:px-5 lg:[&>div:first-child]:ps-0 lg:[&>div:last-child]:pe-0",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 xl:gap-0 xl:divide-x xl:[&>div]:px-5 xl:[&>div:first-child]:ps-0 xl:[&>div:last-child]:pe-0",
};

/**
 * La «Fila de cifras» de UBITS (Design system › Métricas): las cifras de un tablero
 * en UN marco, separadas por una línea, sin íconos. Nombre en gris, cifra de 20px
 * en semibold y una línea pequeña debajo. Es la fila de indicadores de toda pantalla
 * (Uso de IA, Prospección masiva…): nunca una tarjeta suelta por cifra.
 */
export function MetricStrip({ items, title, description, className, ...props }: MetricStripProps) {
  const layout = LAYOUT[Math.min(items.length, 6)] ?? LAYOUT[6];
  return (
    <Frame className={className}>
      {title && <FrameHeader title={title} description={description} />}
      <FramePanel>
        <dl
          aria-label={props["aria-label"]}
          className={cn("grid gap-5 divide-border", layout)}
        >
          {items.map((item) => {
            // Dentro de un botón no van dt/dd: la cifra elegible usa spans en bloque.
            const Term = item.onSelect ? "span" : "dt";
            const Detail = item.onSelect ? "span" : "dd";
            const body = (
              <>
                <Term className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  <span className={cn("truncate", item.pressed && "font-medium text-primary")}>{item.label}</span>
                  {item.hint && !item.onSelect && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`Qué es ${item.label}`}
                            className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          />
                        }
                      >
                        <Info className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{item.hint}</TooltipContent>
                    </Tooltip>
                  )}
                </Term>
                <Detail className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xl font-semibold text-foreground tabular-nums">{item.value}</span>
                  {item.aside}
                </Detail>
                {item.description && <Detail className="block truncate text-xs text-muted-foreground">{item.description}</Detail>}
              </>
            );
            return (
              <div key={item.label} className="flex min-w-0 flex-col">
                {item.onSelect ? (
                  // Una cifra que se elige: toda la celda es el botón, y la elegida se tiñe.
                  <button
                    type="button"
                    aria-pressed={item.pressed ?? false}
                    title={item.selectLabel}
                    onClick={item.onSelect}
                    className={cn(
                      "-m-2 flex min-w-0 flex-col gap-1 rounded-lg p-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      item.pressed && "bg-primary/8 hover:bg-primary/10",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-col gap-1">{body}</div>
                )}
              </div>
            );
          })}
        </dl>
      </FramePanel>
    </Frame>
  );
}
