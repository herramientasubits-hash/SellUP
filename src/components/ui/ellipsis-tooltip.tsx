"use client";

import { useEffect, useId, useState } from "react";

import { ellipsisTooltipText, findEllipsizedElement } from "@/lib/ellipsis-tooltip";

/**
 * Tooltip global para texto recortado con «…» (`truncate`, `line-clamp-N`).
 *
 * Se monta UNA vez en `Providers`. Al apuntar (o enfocar) un elemento que de verdad está
 * cortando su texto, muestra el texto completo; si el texto cabe, no muestra nada.
 * Excluir un bloque: `data-no-ellipsis-tooltip`. Un `title` propio se respeta como texto
 * y se retira mientras el tooltip está visible para no duplicar el del navegador.
 */

const SHOW_DELAY_MS = 350;
const VIEWPORT_MARGIN_PX = 8;
const HALF_MAX_WIDTH_PX = 160;
const FLIP_BELOW_THRESHOLD_PX = 72;
const GAP_PX = 8;
const STASHED_TITLE_ATTRIBUTE = "data-ellipsis-title";

type Tip = { text: string; left: number; top: number; below: boolean };

function placementFor(element: HTMLElement, text: string): Tip {
  const rect = element.getBoundingClientRect();
  const below = rect.top < FLIP_BELOW_THRESHOLD_PX;
  const center = rect.left + rect.width / 2;
  const min = HALF_MAX_WIDTH_PX + VIEWPORT_MARGIN_PX;
  const max = Math.max(min, window.innerWidth - min);
  return {
    text,
    left: Math.min(Math.max(center, min), max),
    top: below ? rect.bottom + GAP_PX : rect.top - GAP_PX,
    below,
  };
}

export function EllipsisTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tooltipId = useId();

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const release = () => {
      clearTimer();
      if (current !== null) {
        const stashed = current.getAttribute(STASHED_TITLE_ATTRIBUTE);
        if (stashed !== null) {
          current.setAttribute("title", stashed);
          current.removeAttribute(STASHED_TITLE_ATTRIBUTE);
        }
        current.removeAttribute("aria-describedby");
      }
      current = null;
      setTip(null);
    };

    const show = () => {
      if (current === null || !current.isConnected) return release();
      const text = ellipsisTooltipText(current);
      if (text === null) return release();
      current.setAttribute("aria-describedby", tooltipId);
      setTip(placementFor(current, text));
    };

    const track = (target: EventTarget | null, delayMs: number) => {
      const next = findEllipsizedElement(target instanceof Element ? target : null);
      if (next === current) return;
      release();
      if (next === null) return;
      current = next;
      // El `title` nativo saldría a los ~1 s junto al nuestro: se guarda mientras dura.
      const title = next.getAttribute("title");
      if (title !== null) {
        next.setAttribute(STASHED_TITLE_ATTRIBUTE, title);
        next.removeAttribute("title");
      }
      if (delayMs === 0) show();
      else timer = setTimeout(show, delayMs);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      track(event.target, SHOW_DELAY_MS);
    };
    const onFocusIn = (event: FocusEvent) => track(event.target, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    const onLeaveWindow = () => release();

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerdown", onLeaveWindow);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onLeaveWindow);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onLeaveWindow, true);
    document.documentElement.addEventListener("mouseleave", onLeaveWindow);
    window.addEventListener("blur", onLeaveWindow);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", onLeaveWindow);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onLeaveWindow);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onLeaveWindow, true);
      document.documentElement.removeEventListener("mouseleave", onLeaveWindow);
      window.removeEventListener("blur", onLeaveWindow);
      release();
    };
  }, [tooltipId]);

  if (tip === null) return null;
  return (
    <div
      id={tooltipId}
      role="tooltip"
      data-slot="ellipsis-tooltip"
      style={{
        left: tip.left,
        top: tip.top,
        transform: tip.below ? "translateX(-50%)" : "translate(-50%, -100%)",
      }}
      className="pointer-events-none fixed z-[80] w-max max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-card break-words animate-in fade-in-0"
    >
      {tip.text}
    </div>
  );
}
