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
import { getFirstContactLaunchData } from '@/modules/speech/actions';
import { FIRST_CONTACT_PANEL_OPEN_EVENT, requestViewFirstContactResult } from '@/modules/speech/first-contact-runs-client';
import { FirstContactPanelHost, type FirstContactTarget } from './first-contact-panel-host';

export function FirstContactGlobalPanelHost() {
  const router = useRouter();
  const [target, setTarget] = React.useState<FirstContactTarget | null>(null);
  // La última apertura: si se cierra (o se abre otra) antes de que lleguen los decisores,
  // esa respuesta ya no vuelve a abrir el panel.
  const latest = React.useRef(0);
  const close = React.useCallback(() => {
    latest.current += 1;
    setTarget(null);
  }, []);

  React.useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId?: string; accountName?: string }>).detail;
      const accountId = detail?.accountId;
      if (!accountId) return;
      latest.current += 1;
      const ticket = latest.current;
      // Se abre YA con lo que hay (para la espera basta la empresa) y los decisores
      // llegan después: «Abrir» no espera al servidor.
      setTarget({
        kind: 'request',
        request: { accountId, accountName: detail?.accountName ?? 'la empresa', contacts: [], hasFreshBrief: true },
      });
      void getFirstContactLaunchData(accountId)
        .then((data) => {
          if (data && ticket === latest.current) setTarget({ kind: 'request', request: data });
        })
        .catch(() => {
          // Sin los decisores, el panel igual muestra el avance.
        });
    };
    window.addEventListener(FIRST_CONTACT_PANEL_OPEN_EVENT, open);
    return () => window.removeEventListener(FIRST_CONTACT_PANEL_OPEN_EVENT, open);
  }, []);

  return (
    <FirstContactPanelHost
      target={target}
      onClose={close}
      onDone={() => router.refresh()}
      onViewResult={(accountId) => {
        if (!requestViewFirstContactResult(accountId)) router.push(firstCallHref(accountId));
      }}
    />
  );
}
