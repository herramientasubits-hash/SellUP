"use client";

import * as React from "react";

/**
 * El mismo corte que usa el shell para volver el sidebar un cajón: por debajo
 * de `lg` no hay sitio para una barra horizontal con sus grupos, y las
 * acciones pasan a un botón flotante.
 */
export const COMPACT_QUERY = "(max-width: 1023px)";

/** Sin `matchMedia` (navegador muy viejo, entorno de pruebas) se asume escritorio. */
function compactMedia(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const media = compactMedia();
  if (!media) return () => {};
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Cierto mientras la ventana sea estrecha. Reacciona al girar el teléfono. */
export function useCompactViewport(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => compactMedia()?.matches ?? false,
    // En el servidor no hay ventana: se asume escritorio y el primer render en
    // el cliente corrige, que es el caso menos frecuente de los dos.
    () => false,
  );
}
