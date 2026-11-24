'use client';

import * as React from 'react';

// ── Progressive message reveal ────────────────────────────────────────────────
// Reveals newly-appended messages one-by-one with a short "typing" delay, giving
// the conversational feel of the Agente 1 wizard. Pure UI timing — no audio, no
// domain logic. Returns the count of currently-visible messages and whether a
// reveal animation is in progress.

const REVEAL_START_DELAY_MS = 350;
const REVEAL_STEP_DELAY_MS = 420;

export interface ProgressiveReveal {
  visibleCount: number;
  isRevealing: boolean;
}

export function useProgressiveReveal(messageCount: number): ProgressiveReveal {
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [isRevealing, setIsRevealing] = React.useState(false);
  const prevCountRef = React.useRef(0);
  // Lo que de verdad se alcanzó a mostrar. Si el efecto se limpia a mitad sin mensajes nuevos
  // (StrictMode en desarrollo vuelve a correrlo), se retoma desde aquí: antes quedaba en
  // «Escribiendo…» para siempre con mensajes sin revelar.
  const revealedRef = React.useRef(0);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const prevCount = prevCountRef.current;
    const nextCount = messageCount;

    // Mensajes nuevos, o un revelado que quedó cortado sin que llegara ninguno.
    const resumeFrom =
      nextCount > prevCount
        ? prevCount
        : nextCount === prevCount && revealedRef.current < nextCount
          ? revealedRef.current
          : null;

    if (resumeFrom !== null) {
      let revealed = resumeFrom;
      setIsRevealing(true);

      const revealNext = () => {
        if (revealed >= nextCount) {
          setIsRevealing(false);
          return;
        }
        revealed += 1;
        revealedRef.current = revealed;
        setVisibleCount(revealed);
        if (revealed < nextCount) {
          timerRef.current = setTimeout(revealNext, REVEAL_STEP_DELAY_MS);
        } else {
          setIsRevealing(false);
        }
      };

      timerRef.current = setTimeout(revealNext, REVEAL_START_DELAY_MS);
    } else if (nextCount < prevCount) {
      // Messages reset (e.g. "enriquecer otra empresa") — show everything at once.
      revealedRef.current = nextCount;
      setVisibleCount(nextCount);
      setIsRevealing(false);
    }

    prevCountRef.current = nextCount;

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [messageCount]);

  return { visibleCount, isRevealing };
}
