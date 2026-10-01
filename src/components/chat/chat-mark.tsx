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

/** El destello de cuatro puntas, en una caja de 24. */
const SPARK =
  "M12 1.5C12.7 7.4 16.6 11.3 22.5 12C16.6 12.7 12.7 16.6 12 22.5C11.3 16.6 7.4 12.7 1.5 12C7.4 11.3 11.3 7.4 12 1.5Z";
/** El destello pequeño que lo acompaña, arriba a la derecha. */
const SPARK_SMALL =
  "M19 2.5C19.25 4.4 20.1 5.25 22 5.5C20.1 5.75 19.25 6.6 19 8.5C18.75 6.6 17.9 5.75 16 5.5C17.9 5.25 18.75 4.4 19 2.5Z";

/**
 * La marca del agente (Thema · `ChatMark`): un destello de cuatro puntas en
 * blanco sobre una baldosa con el gradiente de IA del tema. Va donde el agente
 * habla: junto a cada respuesta, en la cabecera del panel y en el saludo.
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
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="currentColor">
        <path d={SPARK} />
        <path d={SPARK_SMALL} opacity="0.75" />
      </svg>
    </span>
  );
}
