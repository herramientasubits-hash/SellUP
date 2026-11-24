'use client';

// Agente 2A — Las formas de buscar contactos.
//
// Bryan 17-11: dejaron de ser botones de la cabecera y pasaron a ser opciones bajo la
// conversación, OPCIONALES (la caja aceptaba una empresa sin elegir nada).
//
// Dueña 24-11: eso confundía. La caja dejaba escribir antes de elegir, alguien pegaba un perfil de
// LinkedIn en «Contactos de una empresa» y la búsqueda no servía; y al elegir una opción aparecía
// otra lista «¿Prefieres otra forma de buscar?». Ahora el panel guía como la búsqueda de empresas
// (Agente 1): primero «¿Cómo quieres buscar contactos?» con las opciones numeradas y la caja
// APAGADA; elegida una, se enciende la caja de esa forma y abajo sólo queda «Volver» para cambiar.

import * as React from 'react';
import { ArrowLeft } from '@/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AgentChatTimeline, useProgressiveReveal } from '@/components/agent-chat';
import type { AgentChatMessage } from '@/components/agent-chat';
import { ChatComposer, ChatQuestionPanel, type ChatQuestionOptionDetail } from '@/components/chat';

/**
 * Las formas de buscar. «Por empresa» (`single`) es el asistente de siempre; las tres se eligen
 * en el primer paso del panel.
 */
export type EnrichmentPanelMode = 'single' | 'hubspot_id_batch' | 'linkedin';

export const SEARCH_MODE_QUESTION = '¿Cómo quieres buscar contactos?';

export const SEARCH_MODE_GREETING = 'Hola. Te ayudo a encontrar contactos para prospectar.';

/** Lo que dice la caja mientras no se ha elegido una forma de buscar. */
export const SEARCH_MODE_CHOOSER_PLACEHOLDER = 'Elige primero cómo quieres buscar';

/** El mismo «Volver» de las preguntas de la búsqueda de empresas (Agente 1). */
export const SEARCH_MODE_BACK_LABEL = 'Volver';

/** Nombre de cada modo: la opción, y el subtítulo del panel cuando está activo. */
export const SEARCH_MODE_LABEL: Record<EnrichmentPanelMode, string> = {
  single: 'Contactos de una empresa',
  hubspot_id_batch: 'Varias empresas por HubSpot ID',
  linkedin: 'Un contacto por LinkedIn, correo o ID de HubSpot',
};

export const SEARCH_MODE_DESCRIPTION: Record<EnrichmentPanelMode, string> = {
  single: 'Escribe el nombre, dominio o HubSpot ID de la empresa y busco sus contactos.',
  hubspot_id_batch: 'Hasta 10 HubSpot IDs de empresa, separados por coma o uno por fila.',
  linkedin: 'El perfil de LinkedIn de la persona, su correo o su ID de contacto en HubSpot. Antes de gastar créditos reviso si ya lo tenemos.',
};

/** Orden fijo de las opciones. */
const MODE_ORDER: readonly EnrichmentPanelMode[] = ['single', 'hubspot_id_batch', 'linkedin'];

/** Las formas de buscar que se ofrecen (LinkedIn, sólo con su bandera). */
export function searchModeOptionsFor(linkedinEnabled: boolean): EnrichmentPanelMode[] {
  return MODE_ORDER.filter((mode) => mode !== 'linkedin' || linkedinEnabled);
}

export function isEnrichmentPanelMode(value: string): value is EnrichmentPanelMode {
  return MODE_ORDER.some((mode) => mode === value);
}

const CHOOSER_MESSAGES: AgentChatMessage[] = [
  { id: 'mode-greeting', role: 'assistant', content: SEARCH_MODE_GREETING },
  { id: 'mode-question', role: 'assistant', content: SEARCH_MODE_QUESTION },
];

interface SearchModeChooserProps {
  linkedinEnabled: boolean;
  /** Falso mientras llega la bandera de LinkedIn: así las opciones no cambian a la vista. */
  optionsReady?: boolean;
  onSelect: (mode: EnrichmentPanelMode) => void;
}

/**
 * El primer paso del panel: la pregunta con las formas de buscar y la caja apagada hasta elegir.
 * Las opciones se eligen tocándolas o con su número (la caja está apagada: no hay con qué chocar).
 */
export function SearchModeChooser({ linkedinEnabled, optionsReady = true, onSelect }: SearchModeChooserProps) {
  const { visibleCount, isRevealing } = useProgressiveReveal(CHOOSER_MESSAGES.length);
  const options = React.useMemo<ChatQuestionOptionDetail[]>(
    () =>
      searchModeOptionsFor(linkedinEnabled).map((mode) => ({
        value: mode,
        label: SEARCH_MODE_LABEL[mode],
        description: SEARCH_MODE_DESCRIPTION[mode],
      })),
    [linkedinEnabled],
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" data-testid="search-mode-chooser">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <AgentChatTimeline messages={CHOOSER_MESSAGES} visibleCount={visibleCount} isTyping={isRevealing} />
      </div>
      <div className="shrink-0 px-4 pb-4 pt-2">
        {!isRevealing && optionsReady && (
          <div className="mb-3" data-testid="search-mode-options">
            <ChatQuestionPanel
              aria-label="Formas de buscar contactos"
              title={SEARCH_MODE_QUESTION}
              options={options}
              onBack={null}
              onAnswer={(value) => {
                if (isEnrichmentPanelMode(value)) onSelect(value);
              }}
            />
          </div>
        )}
        <ChatComposer
          compact
          value=""
          onChange={() => {}}
          onSend={() => {}}
          placeholder={SEARCH_MODE_CHOOSER_PLACEHOLDER}
          disabled
        />
      </div>
    </div>
  );
}

/**
 * «Volver» a elegir la forma de buscar, encima de la caja de cada modo cuando está libre. Mismo
 * botón que el «Volver» de las preguntas del Agente 1 (`ChatQuestionPanel`).
 */
export function SearchModeBackLink({ onBack, className }: { onBack: () => void; className?: string }) {
  return (
    <div className={cn('flex justify-end', className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        aria-label="Volver a elegir cómo buscar contactos"
        data-testid="search-mode-back"
      >
        <ArrowLeft aria-hidden="true" />
        {SEARCH_MODE_BACK_LABEL}
      </Button>
    </div>
  );
}
