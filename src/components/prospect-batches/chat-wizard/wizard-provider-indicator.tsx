'use client';

/**
 * A1-APOLLO-WIZARD-1 — fila «Proveedor de búsqueda: …» del wizard moderno.
 *
 * Componente tonto: no resuelve nada, no lee env, no consulta flags. Recibe el
 * estado ya resuelto por el backend (`WizardProviderIndicator`) y lo pinta en
 * una sola línea debajo de la barra de progreso.
 *
 * Antes de esto el wizard no decía con qué proveedor buscaba: en preview, con
 * Apollo apagado, la búsqueda corría por Tavily y nada en pantalla lo indicaba.
 */

import type { WizardProviderIndicator } from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator';
import { presentProviderIndicator } from './wizard-provider-execution-summary';

type WizardProviderIndicatorRowProps = {
  indicator: WizardProviderIndicator;
};

export function WizardProviderIndicatorRow({ indicator }: WizardProviderIndicatorRowProps) {
  const presentation = presentProviderIndicator(indicator);

  return (
    <p
      className="text-xs leading-5 text-muted-foreground"
      data-testid="wizard-provider-indicator"
    >
      {presentation.prefix}:{' '}
      <span className="font-medium text-foreground">{presentation.value}</span>
      {presentation.notice && (
        <span className="text-muted-foreground"> · {presentation.notice}</span>
      )}
    </p>
  );
}
