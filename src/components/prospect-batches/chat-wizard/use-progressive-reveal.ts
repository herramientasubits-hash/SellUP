'use client';

import * as React from 'react';

/** Pausa antes del primer mensaje de un tramo nuevo y entre los siguientes. */
export const REVEAL_FIRST_DELAY_MS = 400;
export const REVEAL_NEXT_DELAY_MS = 450;

/**
 * Muestra los mensajes del asistente de a uno, con su pausa de «escribiendo».
 *
 * El avance depende SÓLO de cuántos mensajes hay y cuántos se ven. Antes el
 * temporizador vivía en un efecto que dependía de la lista de mensajes: cualquier
 * redibujo que la recreara sin agregar mensajes (un dato que termina de cargar y
 * cambia el estado) lo cancelaba y no se volvía a programar, y Rumbo quedaba en
 * «Escribiendo…» para siempre sin mostrar el tipo de búsqueda (Prod 11 y 12-11).
 *
 * `onReveal(index)` avisa cada mensaje que aparece (para el sonido).
 */
export function useProgressiveReveal(
  messageCount: number,
  onReveal?: (index: number) => void,
): { visibleCount: number; isTyping: boolean } {
  const [visibleCount, setVisibleCount] = React.useState(0);
  // Se quitaron mensajes (p. ej. reiniciar): se muestran los que quedan y lo que
  // llegue después vuelve a aparecer de a uno. Ajuste durante el render (patrón
  // de React para estado derivado), no en un efecto.
  if (visibleCount > messageCount) setVisibleCount(messageCount);

  const settledRef = React.useRef(0);
  React.useEffect(() => {
    if (visibleCount >= messageCount) {
      settledRef.current = messageCount;
      return;
    }
    const delay = visibleCount === settledRef.current ? REVEAL_FIRST_DELAY_MS : REVEAL_NEXT_DELAY_MS;
    const timer = setTimeout(() => setVisibleCount((count) => Math.min(count + 1, messageCount)), delay);
    return () => clearTimeout(timer);
  }, [messageCount, visibleCount]);

  const onRevealRef = React.useRef(onReveal);
  React.useLayoutEffect(() => {
    onRevealRef.current = onReveal;
  });
  const announcedRef = React.useRef(0);
  React.useEffect(() => {
    if (visibleCount > announcedRef.current) onRevealRef.current?.(visibleCount - 1);
    announcedRef.current = visibleCount;
  }, [visibleCount]);

  return { visibleCount: Math.min(visibleCount, messageCount), isTyping: visibleCount < messageCount };
}
