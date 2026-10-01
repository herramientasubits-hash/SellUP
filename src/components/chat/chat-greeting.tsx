"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { ChatMark } from "./chat-mark";
import { greetingKey } from "./greeting";
import { t } from "./messages";

export interface ChatGreetingProps {
  name: string;
  /** `panel` es más pequeño y sin marca; `screen` lleva el destello grande arriba. */
  variant?: "panel" | "screen";
  className?: string;
}

// La hora es del navegador de quien mira. En el servidor se escribe el saludo de
// la mañana y el cliente lo corrige al hidratar, sin desajuste de hidratación.
const subscribeToNothing = () => () => {};
const readClientHour = () => new Date().getHours();
const readServerHour = () => 9;

/**
 * El arranque de una conversación nueva (Thema · `ChatGreeting`): el destello
 * y «¡Buenos días, Carolina!».
 */
export function ChatGreeting({ name, variant = "screen", className }: ChatGreetingProps) {
  const firstName = name.split(" ")[0] ?? name;
  const hour = React.useSyncExternalStore(subscribeToNothing, readClientHour, readServerHour);
  return (
    <div className={cn("chat-rise flex flex-col items-center text-center", className)}>
      {variant === "screen" && <ChatMark size="lg" motion="breathing" className="mb-6" />}
      <p
        className={cn(
          "font-semibold tracking-tight text-foreground",
          variant === "screen" ? "text-3xl lg:text-4xl" : "text-xl",
        )}
      >
        <span className="text-ai-gradient">{t(greetingKey(hour))}</span> {firstName}!
      </p>
    </div>
  );
}
