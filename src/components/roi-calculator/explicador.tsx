"use client";

import { Info } from "@/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  fmtCantidad,
  fmtDecimal1,
  fmtEntero,
  fmtUSD,
  fmtUSD2,
} from "@/modules/roi-calculator/lib/format";
import type { DesgloseLinea, Explicacion } from "@/modules/roi-calculator/domain/types";

function valorLinea(l: DesgloseLinea): string {
  switch (l.unidad) {
    case "usd":
      return fmtUSD(l.valor);
    case "usd_unitario":
      return fmtUSD2(l.valor);
    case "porcentaje":
      return `${fmtDecimal1(l.valor * 100)}%`;
    case "usuarios":
    case "cursos":
      return fmtCantidad(l.valor);
    case "meses":
      return `${fmtEntero(l.valor)} ${l.valor === 1 ? "mes" : "meses"}`;
    case "horas":
      return `${fmtDecimal1(l.valor)} h`;
    case "minutos":
      return `${fmtEntero(l.valor)} min`;
    default:
      return fmtDecimal1(l.valor);
  }
}

/**
 * El icono de información junto a cada cifra: la fórmula, el desglose y las
 * notas que emitió el motor. El comercial tiene que poder defender cada número
 * sin abrir otra pantalla.
 *
 * El tooltip del sistema es una etiqueta oscura y corta; aquí el contenido es
 * una tabla de datos, así que se pinta como una tarjeta clara.
 */
export function Explicador({
  explicacion,
  titulo,
  className,
}: {
  explicacion: Explicacion;
  titulo?: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`Cómo se calcula: ${titulo ?? explicacion.formula}`}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
              "hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
              className,
            )}
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>

      <TooltipContent
        side="top"
        className="w-80 max-w-none flex-col items-stretch gap-0 rounded-xl border border-border/60 bg-popover p-0 text-popover-foreground shadow-drawer"
      >
        <div className="border-b border-border/60 px-3 py-2">
          {titulo && <p className="text-xs font-semibold text-foreground">{titulo}</p>}
          <p className="mt-0.5 font-mono text-xs text-primary">{explicacion.formula}</p>
        </div>

        <p className="px-3 py-2 text-xs leading-relaxed text-foreground">{explicacion.texto}</p>

        {explicacion.lineas.length > 0 && (
          <dl className="border-t border-border/60 px-3 py-2">
            {explicacion.lineas.map((l) => (
              <div key={l.etiqueta} className="flex justify-between gap-3 py-0.5">
                <dt className="text-xs text-muted-foreground">{l.etiqueta}</dt>
                <dd className="text-xs font-medium tabular-nums text-foreground">{valorLinea(l)}</dd>
              </div>
            ))}
          </dl>
        )}

        {explicacion.notas.filter(Boolean).map((nota) => (
          <p
            key={nota}
            className="border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground"
          >
            {nota}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
