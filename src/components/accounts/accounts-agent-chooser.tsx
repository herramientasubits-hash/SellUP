'use client';

/**
 * El agente de «Empresas» pregunta primero qué hacer (dueña 18-10): prospectar
 * empresas (Agente 1), buscar contactos (Agente 2) o preparar el primer contacto
 * (Agente 3). Cada respuesta abre su flujo; «Generar con IA» directo queda sólo en
 * «Por revisar».
 */

import { ChatPanel, ChatQuestionPanel } from '@/components/chat';
import { AgentChatTimeline } from '@/components/agent-chat/agent-chat-timeline';

export type AccountsAgentFlow = 'prospect' | 'contacts' | 'first-contact';

export function AccountsAgentChooser({
  open,
  onOpenChange,
  onChoose,
  prospect,
  firstContactAvailable,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (flow: AccountsAgentFlow) => void;
  /**
   * La búsqueda de empresas (Agente 1): lista, no disponible (abre la explicación de
   * por qué, como antes) o sin resolver (no se ofrece).
   */
  prospect: 'available' | 'unavailable' | 'none';
  /** El Agente 3 está encendido. */
  firstContactAvailable: boolean;
}) {
  return (
    <ChatPanel open={open} onOpenChange={onOpenChange} subtitle="¿Qué hacemos?">
      <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="accounts-agent-chooser">
        <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <AgentChatTimeline
            messages={[
              {
                id: 'intro',
                role: 'assistant',
                // Rumbo: estratega sereno, va al grano y dice qué sigue (dueña 18-10).
                content: 'Hola, soy Rumbo. Te ayudo a decidir qué sigue: buscar empresas nuevas, encontrar a sus decisores o preparar el primer contacto. ¿Por dónde empezamos?',
              },
            ]}
          />
        </div>
        <div className="shrink-0 px-4 pb-4 pt-2">
          <ChatQuestionPanel
            title="¿Qué quieres hacer?"
            options={[
              ...(prospect === 'none'
                ? []
                : [
                    {
                      value: 'prospect',
                      label: prospect === 'available' ? 'Prospectar empresas' : 'Prospectar empresas (no disponible)',
                      description:
                        prospect === 'available'
                          ? 'Buscar empresas nuevas por país e industria, competidores o proveedores.'
                          : 'La búsqueda de empresas no se puede usar ahora: te explicamos por qué.',
                    },
                  ]),
              { value: 'contacts', label: 'Buscar contactos', description: 'Encontrar a los decisores de una empresa (esté o no en SellUp).' },
              ...(firstContactAvailable
                ? [
                    {
                      value: 'first-contact',
                      label: 'Preparar el primer contacto',
                      description: 'Investigar la empresa y a su decisor y escribir qué decirle, por cada canal.',
                    },
                  ]
                : []),
            ]}
            onAnswer={(value) => onChoose(value as AccountsAgentFlow)}
          />
        </div>
      </div>
    </ChatPanel>
  );
}
