"use client";

import * as React from "react";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

/**
 * Deja libre la cabecera de la app (h-14 más el relleno exterior del shell)
 * con margen, para que la pila no arranque pegada a ella.
 */
export const TOASTER_TOP_OFFSET_PX = 76;

/**
 * ThemaToaster — port de Thema `feedback/ThemaToaster.tsx`.
 *
 * Los avisos se apilan arriba a la derecha, bajo la cabecera, para que lo que
 * acaba de pasar no tape la barra de acciones inferior ni se confunda con ella.
 * Sobrios (`richColors={false}`), con botón de cerrar e iconos del sistema.
 * Sigue el tema leyendo la clase `dark` de `<html>`.
 *
 * Se monta UNA sola vez, en `src/app/layout.tsx`: una segunda instancia
 * pintaría cada aviso dos veces (ambas leen la misma cola).
 */
export function ThemaToaster({
  className,
  style,
  topOffset = TOASTER_TOP_OFFSET_PX,
}: {
  className?: string;
  style?: React.CSSProperties;
  /** Distancia en px desde el borde superior hasta la pila de avisos. */
  topOffset?: number;
}) {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const read = () =>
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <SonnerToaster
      theme={theme}
      position="top-right"
      offset={{ top: topOffset }}
      closeButton
      richColors={false}
      expand={false}
      className={className}
      style={style}
    />
  );
}
