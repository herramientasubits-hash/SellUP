import { cn } from "@/lib/utils";

import { AiSparkGlyph } from "./ai-spark-glyph";

export interface AiAnalyzingStateProps {
  /** El titular. Puede cambiar mientras el proceso avanza: cada cambio entra
   * con un fundido, que es lo que hace que el trabajo se lea como una
   * secuencia y no como una barra que sube sola. */
  title: string;
  /** 0–100. Sin él el trabajo se lee como indeterminado y la barra no sale:
   * hay esperas que no saben cuánto les queda. */
  progress?: number;
  /** La línea de la izquierda, sobre la barra: qué se está produciendo. */
  detail?: string;
  /** La frase de abajo: qué está pasando, en una línea. */
  caption?: string;
  /**
   * `panel` es el bloque grande, para cuando la espera ocupa la pantalla.
   * `inline` es la misma chispa reducida a una línea, para huecos donde el
   * bloque no cabe —una tarjeta que se está rehaciendo, por ejemplo—.
   */
  variant?: "panel" | "inline";
  className?: string;
}

/**
 * El estado «la IA está trabajando» de la plataforma (Thema · `AiAnalyzingState`).
 *
 * Es la única forma en que la IA dice «dame un momento» en todo el producto:
 * dos versiones distintas del mismo momento le harían dudar a la persona de si
 * está viendo el mismo sistema. Lo que cambia entre sitios es el texto y el
 * tamaño, nunca la pieza.
 *
 * Thema funde el titular con framer-motion; aquí cada titular nuevo se monta
 * con `key` y entra con `chat-rise` (CSS, se apaga con `prefers-reduced-motion`).
 */
export function AiAnalyzingState({
  title,
  progress,
  detail,
  caption,
  variant = "panel",
  className,
}: AiAnalyzingStateProps) {
  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-slot="ai-analyzing-state"
        data-variant="inline"
        className={cn("flex min-w-0 select-none items-center gap-2", className)}
      >
        <AiSparkGlyph size={18} />
        <span key={title} className="chat-rise truncate text-xs font-semibold text-ai-gradient">
          {title}
        </span>
      </div>
    );
  }

  const value = typeof progress === "number" ? Math.max(0, Math.min(100, Math.round(progress))) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="ai-analyzing-state"
      data-variant="panel"
      className={cn(
        "shimmer-mirror relative flex min-h-[300px] select-none flex-col rounded-xl bg-ai-gradient p-[2px] shadow-card animate-su-fade-in",
        className,
      )}
    >
      <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center gap-6 rounded-[calc(var(--radius-xl)-2px)] bg-card p-6">
        <div className="relative mb-1 flex h-16 w-16 items-center justify-center">
          <div className="absolute h-11 w-11 animate-pulse rounded-full bg-ai-gradient opacity-20 blur-xl motion-reduce:animate-none" />
          <AiSparkGlyph size={42} />
        </div>

        <div className="flex min-h-6 flex-col items-center gap-1.5 text-center">
          <p key={title} className="chat-rise text-base font-bold text-ai-gradient">
            {title}
          </p>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-2">
          {value !== null && (
            <>
              <div className="flex items-end justify-between text-xs font-bold">
                <span className="text-muted-foreground">{detail}</span>
                <span className="text-ai-gradient">{value}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={value}
                aria-label={detail ?? title}
                className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full w-full origin-left rounded-full bg-ai-gradient transition-transform duration-300"
                  style={{ transform: `scaleX(${value / 100})` }}
                />
              </div>
            </>
          )}
          {caption && <p className="mt-2 text-center text-xs text-muted-foreground">{caption}</p>}
        </div>
      </div>
    </div>
  );
}
