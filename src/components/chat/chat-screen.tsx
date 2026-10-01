import * as React from "react";

import { cn } from "@/lib/utils";

import { ChatHistoryPanel, type ChatHistoryPanelProps } from "./chat-history-panel";

export interface ChatScreenProps {
  /** El historial al lado, con «Nueva conversación». Sin esto no se pinta. */
  history?: ChatHistoryPanelProps;
  /** Hay conversación: el hilo ocupa la pantalla y la caja se queda abajo. */
  hasThread: boolean;
  /** El hilo (`ChatThread`). */
  thread?: React.ReactNode;
  /** El saludo de una conversación nueva (`ChatGreeting`). */
  greeting?: React.ReactNode;
  /** La caja de escribir (`ChatComposer`). */
  composer: React.ReactNode;
  className?: string;
}

/**
 * El chat a pantalla completa (Thema · `ChatScreen`). Una conversación nueva
 * arranca en el centro, con el saludo y la caja; con hilo, los mensajes ocupan
 * la pantalla y la caja se queda abajo. A la izquierda, el historial, que se
 * pliega para dejarle todo el ancho al hilo.
 *
 * Thema lo alimenta de su almacén de conversaciones; aquí las piezas llegan
 * por props. Ninguna pantalla de SellUp lo usa todavía.
 */
export function ChatScreen({ history, hasThread, thread, greeting, composer, className }: ChatScreenProps) {
  const main = hasThread ? (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="mx-auto w-full max-w-3xl py-6">{thread}</div>
      </div>
      <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">{composer}</div>
      </div>
    </div>
  ) : (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col py-8">
        {greeting && <div className="mb-8">{greeting}</div>}
        {composer}
      </div>
    </div>
  );

  return (
    <div className={cn("flex h-full min-h-0", className)} data-testid="chat-screen">
      {history && <ChatHistoryPanel {...history} />}
      {main}
    </div>
  );
}
