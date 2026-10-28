import { cn } from "@/lib/utils";

interface AIOrbProps {
  className?: string;
}

/**
 * El orbe de la IA de UBITS: la esfera de vidrio con la estrella (imagen de diseño,
 * la misma del playground). Marca de la IA en los botones y piezas de IA; se ve
 * bien de 16px a 180px. Es decorativo: el texto de al lado dice qué hace.
 */
export function AIOrb({ className }: AIOrbProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- imagen fija de 64/360px; no necesita optimización
    <img
      src="/ai/orb-64.png"
      srcSet="/ai/orb-64.png 64w, /ai/orb.png 360w"
      sizes="(min-width: 0px) 32px"
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("size-4.5 shrink-0 rounded-full object-cover select-none", className)}
    />
  );
}
