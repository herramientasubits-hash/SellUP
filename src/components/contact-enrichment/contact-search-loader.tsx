'use client';

import * as React from 'react';
import { AiAnalyzingState } from '@/components/ai/ai-analyzing-state';
import { useContactSearchProgress } from '@/modules/contact-enrichment/contact-search-runs-client';

/** El mismo aviso que la búsqueda de empresas: la búsqueda no depende de este panel. */
export const CONTACT_SEARCH_BACKGROUND_NOTE =
  'Puedes minimizar esta ventana o empezar otra búsqueda con «+»: esta sigue en el Centro de procesos, arriba a la derecha.';

/**
 * La espera de la búsqueda de contactos (dueña 20-10: «el loader con el progreso y el texto
 * que dice qué está haciendo Rumbo, como en empresas»): `AiAnalyzingState` con la etapa
 * real que anota el servidor, la barra por etapas y los segundos reales.
 */
export function ContactSearchLoader({
  requestId,
  startedAtMs,
  companyName,
}: {
  requestId: string;
  startedAtMs: number;
  companyName: string;
}) {
  const progress = useContactSearchProgress(requestId, true);
  const [seconds, setSeconds] = React.useState(() => Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
  React.useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAtMs) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAtMs]);

  const found = progress.found > 0 ? ` · ${progress.found === 1 ? '1 contacto' : `${progress.found} contactos`} hasta ahora` : '';
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="contact-search-loader">
      <AiAnalyzingState
        className="flex-1"
        title={progress.label}
        progress={progress.percent}
        detail={`Buscando contactos en ${companyName}`}
        caption={`${seconds > 0 ? `${seconds} s` : 'Empezando'}${found}`}
      />
      <p className="px-6 pb-6 pt-5 text-center text-xs leading-relaxed text-muted-foreground">{CONTACT_SEARCH_BACKGROUND_NOTE}</p>
    </div>
  );
}
