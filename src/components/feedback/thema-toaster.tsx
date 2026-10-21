"use client";

import * as React from "react";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

/**
 * Deja libre la cabecera de la app (h-14 más el relleno exterior del shell)
 * con margen, para que la pila no arranque pegada a ella.
 */
export const TOASTER_TOP_OFFSET_PX = 76;

const CLAMPED_TEXT_SELECTOR =
  "[data-sonner-toast] [data-title], [data-sonner-toast] [data-description]";

/**
 * El título y la descripción se cortan en dos líneas (`line-clamp-2`, en
 * `ui/sonner.tsx`). Cuando el texto realmente se corta, el aviso lleva el texto
 * completo en `title` para leerlo al pasar el mouse; si cabe, no lleva tooltip.
 */
export function syncTruncatedToastTooltips(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(CLAMPED_TEXT_SELECTOR).forEach((el) => {
    const text = el.textContent?.trim() ?? "";
    const isTruncated = el.scrollHeight > el.clientHeight + 1;
    if (isTruncated && text) {
      if (el.getAttribute("title") !== text) el.setAttribute("title", text);
    } else if (el.hasAttribute("title")) {
      el.removeAttribute("title");
    }
  });
}

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
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sync = () => syncTruncatedToastTooltips(host);
    const observer = new MutationObserver(sync);
    observer.observe(host, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, []);

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
    // `contents`: el contenedor sólo sirve para observar los avisos; no pinta caja.
    <div ref={hostRef} className="contents">
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
    </div>
  );
}
