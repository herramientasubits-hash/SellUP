import * as React from "react";

import { cn } from "@/lib/utils";

export interface ChatMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `xs` 20px para una fila, `sm` 24px junto a un mensaje, `md` 36px en cabeceras, `lg` 56px en el saludo. */
  size?: "xs" | "sm" | "md" | "lg";
  /**
   * `still` quieta; `breathing` late despacio (en reposo);
   * `thinking` gira y late rápido (mientras prepara la respuesta).
   */
  motion?: "still" | "breathing" | "thinking";
}

const SIZE: Record<NonNullable<ChatMarkProps["size"]>, string> = {
  xs: "size-5",
  sm: "size-6",
  md: "size-9",
  lg: "size-14",
};

/**
 * Rumbo (dueña 18-10): una brújula cuya aguja es una flecha que sube — el agente
 * que te dice qué sigue con cada empresa. En una caja de 24, girada hacia «arriba y
 * adelante». La aguja va llena; la cola, más tenue.
 */
const COMPASS_NEEDLE = "M12 3.6 L15.4 12.6 L12 10.7 L8.6 12.6 Z";
const COMPASS_TAIL = "M12 20.4 L10.3 14.9 L12 15.9 L13.7 14.9 Z";
/** El nombre del agente (también el título de su panel). */
export const AGENT_NAME = "Rumbo";

/** La brújula de Rumbo sola, para botones e íconos (toma el color y el tamaño del texto). */
export function RumboIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-icon="rumbo" className={cn("size-4", className)} {...props}>
      <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <g transform="rotate(32 12 12)">
        <path d={COMPASS_NEEDLE} />
        <path d={COMPASS_TAIL} opacity="0.55" />
      </g>
      <circle cx="12" cy="12" r="1.2" />
    </svg>
  );
}

/**
 * La marca del agente, Rumbo (Thema · `ChatMark`): la brújula con la flecha que
 * sube, en blanco sobre una baldosa con el gradiente de IA del tema. Va donde el
 * agente habla: junto a cada respuesta, en la cabecera del panel y en el saludo.
 */
export function ChatMark({ size = "sm", motion = "still", className, ...props }: ChatMarkProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="chat-mark"
      data-motion={motion}
      className={cn(
        "chat-mark-tile relative inline-flex shrink-0 items-center justify-center bg-ai-gradient text-primary-foreground",
        size === "xs" || size === "sm" ? "rounded-md" : "rounded-xl",
        SIZE[size],
        motion === "breathing" && "chat-mark--breathing",
        motion === "thinking" && "chat-mark--thinking",
        className,
      )}
      {...props}
    >
      <svg viewBox="0 0 24 24" className="size-[66%]" fill="currentColor" data-mark="rumbo">
        <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <g transform="rotate(32 12 12)">
          <path d={COMPASS_NEEDLE} />
          <path d={COMPASS_TAIL} opacity="0.55" />
        </g>
        <circle cx="12" cy="12" r="1.2" />
      </svg>
    </span>
  );
}
