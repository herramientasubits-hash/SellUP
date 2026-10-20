import * as React from "react";

import { cn } from "@/lib/utils";
import { Rumbo, RUMBO_NEEDLE_PATH, RUMBO_TAIL_PATH } from "@/icons";

export interface ChatMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** `xs` 20px para una fila, `sm` 24px junto a un mensaje, `md` 36px en cabeceras, `lg` 56px en el saludo. */
  size?: "xs" | "sm" | "md" | "lg";
  /**
   * `still` quieta; `breathing` la aguja oscila despacio y la baldosa late (en reposo);
   * `thinking` la aguja da vueltas continuas (mientras prepara la respuesta).
   * Las dos son cíclicas: el final de cada vuelta coincide con el inicio, sin saltos.
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
const COMPASS_NEEDLE = RUMBO_NEEDLE_PATH;
const COMPASS_TAIL = RUMBO_TAIL_PATH;
/** El nombre del agente (también el título de su panel). */
export const AGENT_NAME = "Rumbo";

/** La brújula de Rumbo sola, para botones e íconos (toma el color y el tamaño del texto). */
export function RumboIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return <Rumbo aria-hidden="true" className={cn("size-4", className)} {...(props as Record<string, unknown>)} />;
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
        {/* El aro queda quieto; lo que se mueve es la aguja (en ciclo, sin saltos). */}
        <g className="chat-mark-needle">
          <g transform="rotate(32 12 12)">
            <path d={COMPASS_NEEDLE} />
            <path d={COMPASS_TAIL} opacity="0.55" />
          </g>
        </g>
        <circle cx="12" cy="12" r="1.2" />
      </svg>
    </span>
  );
}
