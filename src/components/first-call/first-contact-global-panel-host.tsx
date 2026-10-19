'use client';

/**
 * El panel de Rumbo que abre el Centro de procesos (dueña 19-10). «Abrir» una
 * preparación en curso no lleva a otra página: abre el panel de esa empresa donde se
 * esté, con el cargador y el avance. Vive junto al Centro de procesos, en la cabecera,
 * así que está en todas las pantallas.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { firstCallHref } from '@/modules/speech/first-call-links';
import { FIRST_CONTACT_PANEL_OPEN_EVENT } from '@/modules/speech/first-contact-runs-client';
import { FirstContactPanelHost, type FirstContactTarget } from './first-contact-panel-host';

export function FirstContactGlobalPanelHost() {
  const router = useRouter();
  const [target, setTarget] = React.useState<FirstContactTarget | null>(null);
  const close = React.useCallback(() => setTarget(null), []);

  React.useEffect(() => {
    const open = (event: Event) => {
      const accountId = (event as CustomEvent<{ accountId?: string }>).detail?.accountId;
      if (accountId) setTarget({ kind: 'account', accountId });
    };
    window.addEventListener(FIRST_CONTACT_PANEL_OPEN_EVENT, open);
    return () => window.removeEventListener(FIRST_CONTACT_PANEL_OPEN_EVENT, open);
  }, []);

  return (
    <FirstContactPanelHost
      target={target}
      onClose={close}
      onDone={() => router.refresh()}
      onViewResult={(accountId) => router.push(firstCallHref(accountId))}
    />
  );
}
