import type { LucideIcon } from "@/icons";
import { cn } from "@/lib/utils";
import { TONE_CHIP, type Tone } from "@/lib/tone";

const SIZE = {
  sm: { box: "size-7", icon: "size-3.5" },
  md: { box: "size-9", icon: "size-4" },
  lg: { box: "size-11", icon: "size-5" },
} as const;

/**
 * IconChip — el icono dentro de su caja tintada.
 *
 * Es el gesto de color más repetido de la interfaz: al lado de un título de
 * sección, en una fila de pendientes, en una tarjeta de acción. El tono dice
 * qué significa (marca, bien, cuidado, mal, información); el tamaño, cuánto
 * pesa en su fila. Sustituye a las cajas `bg-primary/10 text-primary` que cada
 * pantalla escribía a mano.
 */
export function IconChip({
  icon: Icon,
  tone = "brand",
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      data-slot="icon-chip"
      data-tone={tone}
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl",
        SIZE[size].box,
        TONE_CHIP[tone],
        className,
      )}
    >
      <Icon className={SIZE[size].icon} />
    </span>
  );
}
