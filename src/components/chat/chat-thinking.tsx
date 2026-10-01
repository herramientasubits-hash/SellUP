"use client";

import * as React from "react";

import { ChatMark } from "./chat-mark";
import { t } from "./messages";

export interface ChatThinkingProps {
  /** Por defecto «Razonando…». */
  label?: string;
  /** Desde cuándo piensa (ms de época). Sin él, cuenta desde que aparece. */
  since?: number;
}

/** El agente está pensando: el destello gira, el rótulo brilla y se cuentan los segundos. */
export function ChatThinking({ label, since }: ChatThinkingProps) {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const start = since ?? Date.now();
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return (
    <div className="flex items-center gap-3" role="status" aria-live="polite" data-testid="chat-thinking">
      <ChatMark size="sm" motion="thinking" />
      <span className="chat-shimmer text-sm font-medium">{label ?? t("chat.thinking")}</span>
      {seconds > 0 && (
        <span className="text-xs tabular-nums text-text-muted">{t("chat.thinkingSeconds", { seconds })}</span>
      )}
    </div>
  );
}
