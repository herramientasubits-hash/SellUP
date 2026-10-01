import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AttentionTone = "brand" | "positive" | "warning" | "negative" | "neutral";

/** El acento de cada tono, para el icono de un botón. */
const TONE_TEXT: Record<AttentionTone, string> = {
  brand: "text-primary",
  positive: "text-success",
  warning: "text-warning",
  negative: "text-destructive",
  neutral: "text-text-muted",
};

/** El filete lateral y el disco del icono de la franja. */
const TONE_STRIP: Record<AttentionTone, { rail: string; chip: string }> = {
  brand: { rail: "bg-primary", chip: "bg-primary/10 text-primary" },
  positive: { rail: "bg-success", chip: "bg-success/10 text-success" },
  warning: { rail: "bg-warning", chip: "bg-warning/15 text-warning" },
  negative: { rail: "bg-destructive", chip: "bg-destructive/10 text-destructive" },
  neutral: { rail: "bg-border", chip: "bg-surface-muted text-text-muted" },
};

interface AttentionStripProps {
  /** Cómo se anuncia el grupo a un lector de pantalla. */
  label: string;
  icon: LucideIcon;
  tone?: AttentionTone;
  /** La cifra de arriba: cuánto reclama atención. */
  title: string;
  /** La línea de abajo: qué hacer con la fila. */
  detail?: string;
  /** Los botones — un `AttentionAction` por motivo. */
  children?: ReactNode;
  className?: string;
}

/**
 * AttentionStrip — la franja de avisos (anatomía de Thema,
 * `feedback/AttentionStrip`): una sola fila que dice cuánto reclama atención y
 * ofrece un botón por motivo.
 *
 * El ánimo va en el filete lateral y en el disco del icono, no en un lavado de
 * color sobre toda la fila: la franja se apoya en la misma superficie blanca
 * que las tarjetas. Sustituye a las banderolas teñidas apiladas.
 */
export function AttentionStrip({
  label,
  icon: Icon,
  tone = "warning",
  title,
  detail,
  children,
  className,
}: AttentionStripProps) {
  const toneClasses = TONE_STRIP[tone];

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/60 bg-card py-2.5 pl-5 pr-3.5 shadow-card",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("absolute bottom-3 left-2 top-3 w-[3px] rounded-full", toneClasses.rail)}
      />
      <div className="mr-auto flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            toneClasses.chip,
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
          {detail && (
            <span className="truncate text-xs font-medium text-text-muted">{detail}</span>
          )}
        </div>
      </div>

      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

interface AttentionActionProps {
  icon: LucideIcon;
  label: string;
  value?: number;
  tone?: AttentionTone;
  /** Para un aviso que además es un filtro puesto: se pinta encendido. */
  active?: boolean;
  onClick?: () => void;
}

/** Un motivo: su icono, su nombre, su cifra y la flecha de que lleva a algo. */
export function AttentionAction({
  icon: Icon,
  label,
  value,
  tone = "brand",
  active = false,
  onClick,
}: AttentionActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border/60 bg-card text-foreground hover:bg-surface-muted",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", TONE_TEXT[tone])} />
      <span className="truncate">{label}</span>
      {value !== undefined && (
        <span className="tabular-nums text-foreground">{value.toLocaleString("es-CO")}</span>
      )}
      <ChevronRight aria-hidden className="size-3 shrink-0 text-text-muted" />
    </button>
  );
}
