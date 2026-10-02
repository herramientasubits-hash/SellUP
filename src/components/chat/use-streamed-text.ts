"use client";

import * as React from "react";

const WORDS_PER_TICK = 2;
const TICK_MS = 40;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * Enseña un texto palabra a palabra, como si se escribiera (Thema ·
 * `useStreamedText`). `active` enciende la escritura; apagado, devuelve el
 * texto entero de golpe. `onDone` avisa cuando terminó, y `onProgress` cada vez
 * que crece, para seguirlo con el scroll. Con `prefers-reduced-motion` se
 * muestra entero.
 */
export function useStreamedText(
  text: string,
  active: boolean,
  callbacks: { onDone?: () => void; onProgress?: () => void } = {},
): { shown: string; done: boolean } {
  // Cuántas piezas del split (palabras y espacios) se enseñan; solo cuenta mientras `active`.
  const [count, setCount] = React.useState(0);
  const words = React.useMemo(() => text.split(/(\s+)/), [text]);
  const total = words.length;
  const reduced = prefersReducedMotion();
  const streaming = active && !reduced;
  const latest = React.useRef(callbacks);
  React.useEffect(() => {
    latest.current = callbacks;
  });

  // Sin animación (reducida) la respuesta cuenta como terminada en cuanto está activa.
  React.useEffect(() => {
    if (active && reduced) latest.current.onDone?.();
  }, [active, reduced]);

  React.useEffect(() => {
    if (!streaming) return;
    let shown = 0;
    const timer = window.setInterval(() => {
      shown = Math.min(total, shown + WORDS_PER_TICK * 2);
      setCount(shown);
      latest.current.onProgress?.();
      if (shown >= total) {
        window.clearInterval(timer);
        latest.current.onDone?.();
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [streaming, total]);

  const done = !streaming || count >= total;
  const shown = done ? text : words.slice(0, count).join("");
  return { shown, done };
}
