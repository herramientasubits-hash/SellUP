'use client';

// Agente 2A — Las formas de buscar contactos, como opciones bajo la conversación (Bryan 17-11).
//
// Antes eran dos botones de la cabecera (HubSpot y LinkedIn). Ahora son opciones como el
// «¿Qué tipo de prospectos quieres encontrar?» del Agente 1, pero OPCIONALES: si el usuario no
// elige nada y escribe una empresa, Rumbo sigue como siempre. Cada modo las muestra encima de su
// caja cuando está libre (al empezar y al terminar una búsqueda) y sin el modo en que ya está.
// Elegir una empieza esa conversación limpia; «Nueva conversación» vuelve a «Por empresa».
// Sin atajos de teclado: en el Agente 2 las opciones se eligen tocándolas.

import * as React from 'react';
import { ChatQuestionPanel, type ChatQuestionOptionDetail } from '@/components/chat';

/**
 * Los modos del panel. «Por empresa» (`single`) es el de siempre; los otros dos se eligen en
 * las opciones de abajo y se dejan con «Nueva conversación» o eligiendo otra opción.
 */
export type EnrichmentPanelMode = 'single' | 'hubspot_id_batch' | 'linkedin';

export const SEARCH_MODE_OPTIONS_TITLE = '¿Prefieres otra forma de buscar?';

/** Nombre de cada modo: la opción, y el subtítulo del panel cuando está activo. */
export const SEARCH_MODE_LABEL: Record<EnrichmentPanelMode, string> = {
  single: 'Contactos de una empresa',
  hubspot_id_batch: 'Varias empresas por HubSpot ID',
  linkedin: 'Un contacto por LinkedIn, correo o ID de HubSpot',
};

export const SEARCH_MODE_DESCRIPTION: Record<EnrichmentPanelMode, string> = {
  single: 'Escribe su nombre, dominio o HubSpot ID y busco sus contactos.',
  hubspot_id_batch: 'Hasta 10 HubSpot IDs de empresa, separados por coma o uno por fila.',
  linkedin: 'Su perfil de LinkedIn, su correo o su ID de contacto en HubSpot. Antes de gastar créditos reviso si ya lo tenemos.',
};

/** Orden fijo de las opciones. */
const MODE_ORDER: readonly EnrichmentPanelMode[] = ['single', 'hubspot_id_batch', 'linkedin'];

/** Las opciones que se ofrecen estando en `current`: todas menos esa (LinkedIn, sólo con su bandera). */
export function searchModeOptionsFor(current: EnrichmentPanelMode, linkedinEnabled: boolean): EnrichmentPanelMode[] {
  return MODE_ORDER.filter((mode) => mode !== current && (mode !== 'linkedin' || linkedinEnabled));
}

interface SearchModeOptionsProps {
  current: EnrichmentPanelMode;
  linkedinEnabled: boolean;
  onSelect: (mode: EnrichmentPanelMode) => void;
}

export function SearchModeOptions({ current, linkedinEnabled, onSelect }: SearchModeOptionsProps) {
  const options = React.useMemo<ChatQuestionOptionDetail[]>(
    () =>
      searchModeOptionsFor(current, linkedinEnabled).map((mode) => ({
        value: mode,
        label: SEARCH_MODE_LABEL[mode],
        description: SEARCH_MODE_DESCRIPTION[mode],
      })),
    [current, linkedinEnabled],
  );
  if (options.length === 0) return null;
  return (
    <div data-testid="search-mode-options">
      <ChatQuestionPanel
        aria-label="Otras formas de buscar contactos"
        title={SEARCH_MODE_OPTIONS_TITLE}
        options={options}
        keyboardShortcuts={false}
        onBack={null}
        className="pb-3"
        onAnswer={(value) => {
          const mode = MODE_ORDER.find((candidate) => candidate === value);
          if (mode) onSelect(mode);
        }}
      />
    </div>
  );
}
