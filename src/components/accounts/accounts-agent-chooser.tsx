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

/** Lo que Rumbo dice y ofrece, sin nada marcado o con empresas marcadas en la tabla. */
export function chooserCopy(companies: readonly { name: string }[] | undefined, prospect: 'available' | 'unavailable' | 'none', firstContactAvailable: boolean) {
  if (!companies || companies.length === 0) {
    return {
      intro: 'Hola, soy Rumbo. Te ayudo a decidir qué sigue: buscar empresas nuevas, encontrar a sus decisores o preparar el primer contacto. ¿Por dónde empezamos?',
      options: [
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
          ? [{ value: 'first-contact', label: 'Preparar el primer contacto', description: 'Investigar la empresa y a su decisor y escribir qué decirle, por cada canal.' }]
          : []),
      ],
    };
  }
  // Dueña 20-10: con empresas marcadas, el botón de Rumbo de la barra abre este mismo panel
  // ya con ellas: buscar sus contactos o (con una sola) preparar el primer contacto.
  const one = companies.length === 1 ? companies[0].name : null;
  return {
    intro: one
      ? `Hola, soy Rumbo. ¿Qué hacemos con ${one}? Puedo encontrar a sus decisores${firstContactAvailable ? ' o preparar el primer contacto' : ''}.`
      : `Hola, soy Rumbo. Tienes ${companies.length} empresas marcadas: puedo buscar los contactos de todas a la vez.`,
    options: [
      {
        value: 'contacts',
        label: 'Buscar contactos',
        description: one ? `Encontrar a los decisores de ${one}.` : `Encontrar a los decisores de las ${companies.length} empresas, en lote.`,
      },
      ...(firstContactAvailable && one
        ? [{ value: 'first-contact', label: 'Preparar el primer contacto', description: `Investigar ${one} y a su decisor y escribir qué decirle, por cada canal.` }]
        : []),
    ],
  };
}

export function AccountsAgentChooser({
  open,
  onOpenChange,
  onChoose,
  prospect,
  firstContactAvailable,
  companies,
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
  /** Las empresas marcadas en la tabla (desde la barra de selección); sin ellas, la pantalla. */
  companies?: readonly { name: string }[];
}) {
  const copy = chooserCopy(companies, prospect, firstContactAvailable);
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
                content: copy.intro,
              },
            ]}
          />
        </div>
        <div className="shrink-0 px-4 pb-4 pt-2">
          <ChatQuestionPanel
            title="¿Qué quieres hacer?"
            options={copy.options}
            onAnswer={(value) => onChoose(value as AccountsAgentFlow)}
          />
        </div>
      </div>
    </ChatPanel>
  );
}
