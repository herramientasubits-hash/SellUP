"use client";

import * as React from "react"

/**
 * El mismo corte que usa el shell para volver el sidebar un cajón: por debajo
 * de `lg` no hay sitio para una barra horizontal con sus grupos, y las
 * acciones pasan a un botón flotante.
 */
const COMPACT_QUERY = "(max-width: 1023px)"

/** Cierto mientras la ventana sea estrecha. Reacciona al girar el teléfono. */
export function useCompactViewport(): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    const media = window.matchMedia(COMPACT_QUERY)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    // En el servidor no hay ventana: se asume escritorio y el primer render en
    // el cliente corrige, que es el caso menos frecuente de los dos.
    () => false
  )
}
